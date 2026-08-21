import * as shared from "./shared.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Current from "./current.js";
import Command from "./command.js";
import PermissionManager from "./permission.js";
import { SAPIMessageHandler } from "./sapi.js";

// 解析配置文件 config.json（一次性读取，供各 Mod 直接注入使用）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, "..", "config.json");
let rawConfig;
try {
	rawConfig = fs.readFileSync(configPath, "utf-8");
} catch (e) {
	throw new Error(`无法读取配置文件 config.json: ${e.message}`);
}
export const config = JSON.parse(rawConfig);

// 将命令前缀从配置同步到 Command 框架（避免循环依赖下的模块级求值）
Command.commandPrefix = config.commandPrefix;

/**
 * Mod 事件总线
 * 实现 Mod 间的发布/订阅通信
 */
class EventBus {
	constructor() {
		/** @type {Map<string, Map<string, Function[]>>} 事件名 -> Mod名 -> 回调列表 */
		this.listeners = new Map();
	}

	/**
	 * 订阅事件
	 * @param {string} event - 事件名
	 * @param {string} modName - Mod 名称
	 * @param {Function} callback - 回调函数
	 */
	on(event, modName, callback) {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Map());
		}
		const eventMap = this.listeners.get(event);
		if (!eventMap.has(modName)) {
			eventMap.set(modName, []);
		}
		eventMap.get(modName).push(callback);
	}

	/**
	 * 取消订阅
	 * @param {string} event - 事件名
	 * @param {string} modName - Mod 名称
	 */
	off(event, modName) {
		if (this.listeners.has(event)) {
			this.listeners.get(event).delete(modName);
		}
	}

	/**
	 * 发布事件
	 * @param {string} event - 事件名
	 * @param {*} data - 事件数据
	 * @param {string} [excludeMod] - 排除的 Mod 名称
	 */
	emit(event, data, excludeMod = null) {
		if (!this.listeners.has(event)) return;

		const eventMap = this.listeners.get(event);
		for (const [modName, callbacks] of eventMap) {
			if (modName === excludeMod) continue;
			for (const callback of callbacks) {
				try {
					callback(data);
				} catch (e) {
					shared.logger.error(`EventBus: ${modName}.${event} 执行错误`);
					shared.logger.debug(e.message);
				}
			}
		}
	}

	/**
	 * 清除指定 Mod 的所有订阅
	 * @param {string} modName - Mod 名称
	 */
	clearMod(modName) {
		for (const [, eventMap] of this.listeners) {
			eventMap.delete(modName);
		}
	}

	/**
	 * 清除所有订阅
	 */
	clear() {
		this.listeners.clear();
	}
}

/**
 * Mod 存储管理器
 * 为每个 Mod 提供独立的键值存储空间
 */
class ModStorage {
	/**
	 * @param {string} modName - Mod 名称
	 */
	constructor(modName) {
		this.modName = modName;
		this.data = new Map();
	}

	/**
	 * 获取值
	 * @param {string} key - 键
	 * @param {*} defaultValue - 默认值
	 * @returns {*} 值
	 */
	get(key, defaultValue = undefined) {
		return this.data.has(key) ? this.data.get(key) : defaultValue;
	}

	/**
	 * 设置值
	 * @param {string} key - 键
	 * @param {*} value - 值
	 */
	set(key, value) {
		this.data.set(key, value);
	}

	/**
	 * 删除值
	 * @param {string} key - 键
	 * @returns {boolean} 是否删除成功
	 */
	delete(key) {
		return this.data.delete(key);
	}

	/**
	 * 检查键是否存在
	 * @param {string} key - 键
	 * @returns {boolean} 是否存在
	 */
	has(key) {
		return this.data.has(key);
	}

	/**
	 * 清空存储
	 */
	clear() {
		this.data.clear();
	}

	/**
	 * 获取所有键
	 * @returns {string[]} 键数组
	 */
	keys() {
		return [...this.data.keys()];
	}

	/**
	 * 获取所有值
	 * @returns {*[]} 值数组
	 */
	values() {
		return [...this.data.values()];
	}

	/**
	 * 获取所有条目
	 * @returns {[string, *][]} 条目数组
	 */
	entries() {
		return [...this.data.entries()];
	}
}

/**
 * Mod 日志实例
 * 为每个 Mod 提供带前缀的日志方法
 */
class ModLogger {
	/**
	 * @param {string} modName - Mod 名称
	 */
	constructor(modName) {
		this.prefix = `[${modName}]`;
	}

	/**
	 * 记录信息日志
	 * @param {...*} args - 日志参数
	 */
	info(...args) {
		shared.logger.info(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`);
	}

	/**
	 * 记录警告日志
	 * @param {...*} args - 日志参数
	 */
	warning(...args) {
		shared.logger.warning(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`);
	}

	/**
	 * 记录错误日志
	 * @param {...*} args - 日志参数
	 */
	error(...args) {
		shared.logger.error(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`);
	}

	/**
	 * 记录调试日志
	 * @param {...*} args - 日志参数
	 */
	debug(...args) {
		shared.logger.debug(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`);
	}
}

/**
 * 全局事件总线（单例）
 * 用于 Mod 间通信
 */
export const eventBus = new EventBus();

/**
 * 全局存储管理器（单例）
 * 管理所有 Mod 的存储空间
 */
export class StorageManager {
	/** @type {Map<string, ModStorage>} */
	static stores = new Map();

	/**
	 * 获取指定 Mod 的存储空间
	 * @param {string} modName - Mod 名称
	 * @returns {ModStorage} 存储实例
	 */
	static getStore(modName) {
		if (!this.stores.has(modName)) {
			this.stores.set(modName, new ModStorage(modName));
		}
		return this.stores.get(modName);
	}

	/**
	 * 清除指定 Mod 的存储
	 * @param {string} modName - Mod 名称
	 */
	static clearStore(modName) {
		const store = this.stores.get(modName);
		if (store) {
			store.clear();
			this.stores.delete(modName);
		}
	}

	/**
	 * 清除所有存储
	 */
	static clearAll() {
		for (const [, store] of this.stores) {
			store.clear();
		}
		this.stores.clear();
	}
}

/**
 * 客户端 Mod 管理器
 * 每个客户端连接创建一个实例，管理该连接的所有客户端 Mod
 * 负责 Mod 的加载、实例化、命令注册和销毁
 */
export class ClientModManager {
	/**
	 * 存储已加载的 Mod 类定义（静态，全局共享）
	 * @type {Object<string, Function>}
	 */
	static loadedMod = {};

	/**
	 * 静态加载方法 - 从配置中读取 Mod 路径并 require 加载
	 * @returns {Promise<void>}
	 */
	static async load() {
		for (const [name, modPath] of Object.entries(config.mods.client)) {
			try {
				const modModule = await import(modPath);
				const modClass = modModule.default;
				this.loadedMod[name] = modClass;
				shared.logger.info(`Client Mod ${name} 已加载`);
			} catch (e) {
				shared.logger.error(`Client Mod ${name} 加载失败`);
				shared.logger.debug(e.message);
			}
		}
	}

	/**
	 * 构造函数 - 为指定客户端实例化所有已加载的 Mod
	 * @param {Object} client - 客户端连接对象
	 */
	constructor(client) {
		this.client = client;
		// 存储 Mod 实例
		this.modInstances = {};
		// 按权限等级分类存储 Mod 注册的命令
		this.commands = {
			normal: [],	// 所有用户可用（不含 Blocker）
			user: [],	// User 以上权限可用
			op: [],	//  OP 以上权限可用
			owner: []	// 仅 Owner 权限可用
		};

		// 实例化所有 Mod
		this.instantiate();

		// 注册消息监听
		this.message();
	}

	/**
	 * 解析 Mod 方法（兼容实例方法与静态方法）
	 * @param {Object} instance - Mod 实例
	 * @param {string} name - 方法名
	 * @returns {{ fn: Function, ctx: Object }|null}
	 */
	_resolveModMethod(instance, name) {
		if (!instance) return null;
		if (typeof instance[name] === "function") return { fn: instance[name], ctx: instance };
		const cls = instance.constructor;
		if (cls && typeof cls[name] === "function") return { fn: cls[name], ctx: cls };
		return null;
	}

	/**
	 * Mod 实例化
	 * 遍历已加载的 Mod 类，创建实例并收集命令
	 */
	instantiate() {
		// 为当前客户端创建统一的 SAPI 轮询器
		// 所有客户端 Mod 共享此轮询器，消息按 modName 下放给各 Mod
		this.sapi = new SAPIMessageHandler(this.client);

		Object.entries(ClientModManager.loadedMod).forEach(([name, ModClass]) => {
			try {
				this._instantiateMod(name, ModClass);
			} catch (e) {
				shared.logger.error(`Client Mod ${name} 实例化失败`);
				shared.logger.debug(e.message);
			}
		});

		// 重新收集全部命令（按权限等级分类）
		this._collectCommands();
	}

	/**
	 * 实例化单个 Mod（注入基础设施、SAPI、调用 onStart）
	 * @param {string} name - Mod 名称
	 * @param {Function} ModClass - Mod 类
	 * @returns {Object} Mod 实例
	 */
	_instantiateMod(name, ModClass) {
		// 注入配置到类（供构造函数 / 静态方法读取）
		if (ModClass && typeof ModClass === "function") ModClass.config = config;

		const instance = new ModClass(this.client);

		// 注入 Mod 基础设施
		instance.modName = name;
		instance.config = config;
		const clientId = this.client?.id || "unknown";
		instance.storage = StorageManager.getStore(`client_${clientId}_${name}`);
		instance.logger = new ModLogger(`Client:${name}`);

		// 事件通信
		// emit: 只发送给 CurrentClient 的 Server Mod
		instance.emit = (event, data) => {
			// 只有 CurrentClient 才能发送
			if (this.client !== Current.client) return;
			const currentClientMods = Current.clientMods.get(Current.client);
			if (!currentClientMods) return;
			for (const [modName, mod] of Object.entries(currentClientMods.modInstances)) {
				if (mod._listeners && mod._listeners[event]) {
					for (const cb of mod._listeners[event]) {
						try { cb(data); } catch (e) { shared.logger.error(`EventBus: ${modName}.${event} 执行错误`); }
					}
				}
			}
		};

		// on: 监听事件（存储到 _listeners 供 Server Mod 的 emit 调用）
		instance.on = (event, callback) => {
			instance._listeners = instance._listeners || {};
			instance._listeners[event] = instance._listeners[event] || [];
			instance._listeners[event].push(callback);
		};
		instance.off = (event) => {
			if (instance._listeners) delete instance._listeners[event];
		};

		// 注入 SAPI 处理器（共享统一轮询器，按 modName 下放）
		instance.sapi = this._createModSAPI(name);

		this.modInstances[name] = instance;
		// 将实例挂载到 client 对象上，便于命令中访问
		this.client[name] = instance;

		// 调用 onStart 方法（所有基础设施注入完成后，兼容静态方法）
		const startMethod = this._resolveModMethod(instance, "onStart") || this._resolveModMethod(instance, "start");
		if (startMethod) {
			try {
				startMethod.fn.apply(startMethod.ctx);
			} catch (e) {
				shared.logger.error(`Client Mod ${name}.start 执行错误`);
				shared.logger.debug(e.message);
			}
		}

		return instance;
	}

	/**
	 * 重新收集所有 Mod 的命令（按权限等级分类）
	 * reload 后调用，全量重建避免命令列表错位
	 */
	_collectCommands() {
		this.commands = {
			normal: [],
			user: [],
			op: [],
			owner: []
		};

		Object.entries(this.modInstances).forEach(([name, instance]) => {
			// 检查 Mod 是否导出 onCommand 方法（兼容旧的 commands 方法）
			const commandMethod = instance.onCommand || instance.commands;
			if (!commandMethod || typeof commandMethod !== "function") return;

			try {
				// 获取命令映射表 { normal: [...], user: [...], op: [...] }
				const cmdMap = commandMethod.call(instance);

				// 按权限等级合并命令到管理器
				Object.keys(cmdMap).forEach(key => {
					const cmdList = cmdMap[key];
					if (!Array.isArray(cmdList)) return;
					if (this.commands[key]) this.commands[key].push(...cmdList);
				});
			} catch (e) {
				shared.logger.error(`Client Mod ${name} 命令收集失败`);
				shared.logger.debug(e.message);
			}
		});
	}

	/**
	 * 重载单个客户端 Mod
	 * @param {string} name - Mod 名称
	 * @returns {Promise<{ success: boolean, message: string }>}
	 */
	async reload(name) {
		const ModClass = ClientModManager.loadedMod[name];
		const modPath = config.mods.client[name];
		if (!ModClass || !modPath) {
			return { success: false, message: `Client Mod "${name}" 未在配置中定义` };
		}

		// 销毁旧实例
		const oldInstance = this.modInstances[name];
		if (oldInstance) {
			const destroyMethod = this._resolveModMethod(oldInstance, "onDestroy") || this._resolveModMethod(oldInstance, "destroy");
			if (destroyMethod) {
				try {
					destroyMethod.fn.apply(destroyMethod.ctx);
				} catch (e) {
					shared.logger.error(`Client Mod ${name}.onDestroy 执行错误`);
					shared.logger.debug(e.message);
				}
			}

			// 清除 SAPI 处理器与事件订阅
			if (this.sapi && typeof this.sapi.clearMod === "function") this.sapi.clearMod(name);
			if (this.client.utils && typeof this.client.utils.removeOwner === "function") this.client.utils.removeOwner(name);
			eventBus.clearMod(`client_${this.client?.id || "unknown"}_${name}`);

			// 清理 client 上的 Mod 引用
			this.client[name] = null;
			delete this.modInstances[name];
		}

		// 重新加载（时间戳绕过缓存）
		try {
			const timestamp = Date.now();
			const modModule = await import(`${modPath}?t=${timestamp}`);
			const modClass = modModule.default;

			if (!modClass) {
				return { success: false, message: `Client Mod "${name}" 没有默认导出` };
			}

			ClientModManager.loadedMod[name] = modClass;
			this._instantiateMod(name, modClass);
			this._collectCommands();

			const message = `Client Mod ${name} 已重载`;
			shared.logger.info(message);
			return { success: true, message };
		} catch (e) {
			const errorMsg = `Client Mod ${name} 重载失败: ${e.message}`;
			shared.logger.error(errorMsg);
			shared.logger.debug(e.stack);

			// 重载失败时尝试恢复旧版本
			try {
				const modModule = await import(modPath);
				const modClass = modModule.default;
				ClientModManager.loadedMod[name] = modClass;
				this._instantiateMod(name, modClass);
				this._collectCommands();
				shared.logger.warning(`Client Mod ${name} 已恢复到旧版本`);
			} catch {
				shared.logger.error(`Client Mod ${name} 恢复失败`);
			}

			return { success: false, message: errorMsg };
		}
	}

	/**
	 * 重载当前客户端的所有 Mod
	 * @returns {Promise<{ success: string[], failed: string[] }>}
	 */
	async reloadAll() {
		const success = [];
		const failed = [];

		for (const name of Object.keys(ClientModManager.loadedMod)) {
			const result = await this.reload(name);
			if (result.success) {
				success.push(name);
			} else {
				failed.push(name);
			}
		}

		return { success, failed };
	}

	/**
	 * 重载所有客户端连接的所有 Mod 实例
	 * @returns {Promise<{ success: string[], failed: string[] }>}
	 */
	static async reloadAllClients() {
		const success = [];
		const failed = [];

		for (const [client, manager] of Current.clientMods) {
			if (!manager || typeof manager.reloadAll !== "function") continue;
			const result = await manager.reloadAll();
			success.push(...result.success.map(name => `${client?.id || "?"}:${name}`));
			failed.push(...result.failed.map(name => `${client?.id || "?"}:${name}`));
		}

		return { success, failed };
	}

	/**
	 * 创建 Mod 的 SAPI 处理句柄
	 * 所有 Mod 共享同一个轮询器，通过 modName 路由分发
	 * @param {string} modName - Mod 名称
	 * @returns {Object} SAPI 处理句柄
	 */
	_createModSAPI(modName) {
		const hub = this.sapi;
		if (!hub) return null;
		return {
			on: (type, callback) => hub.register(modName, type, callback),
			off: (type) => hub.unregister(modName, type),
			send: (type, data = {}) => hub.send(modName, type, data),
			exists: () => hub.commandExists
		};
	}

	/**
	 * 消息订阅与处理
	 * 监听 PlayerMessage 事件，根据权限等级执行对应命令
	 */
	message() {
		this.client.subscribe("PlayerMessage", async (data) => {
			// 提取消息字段
			const sender = data.body.sender;
			const msg = data.body.message;
			const type = data.body.type;

			// 过滤非法消息
			if (!msg || !type || !sender) return;

			// 记录消息日志
			this.log(sender, msg, type);

			// 仅处理 chat 类型且长度小于 256 的消息
			if (type !== "chat" || msg.length >= 256) return;

			// 检查消息是否以命令前缀开头（动态读取，与 Command.setCommandPrefix 保持同步）
			if (!msg.startsWith(Command.commandPrefix)) return;

			// 查询发送者权限
			const permission = await PermissionManager.query(sender);

			// 权限查询出错
			if (permission instanceof Error) {
				this.client.tellAll(`§cCommand | §fError > §i${permission.message}`);
				return;
			}

			// Blocker 黑名单用户直接拒绝
			if (permission < 0) {
				this.client.tell(`§cCommand | §fError > §i命令权限错误`, sender);
				return;
			}

			if (!this.execute(sender, msg, this.commands.normal)) return;

			if (permission < 1) {
				this.client.tell(`§cCommand | §fError > §i未知的命令 ${msg.split(" ")[0]}，权限受限`, sender);
				return;
			}

			if (!this.execute(sender, msg, this.commands.user)) return;

			if (permission < 2) {
				this.client.tell(`§cCommand | §fError > §i未知的命令 ${msg.split(" ")[0]}，权限受限`, sender);
				return;
			}

			if (!this.execute(sender, msg, this.commands.op)) return;

			if (permission < 3) {
				this.client.tell(`§cCommand | §fError > §i未知的命令 ${msg.split(" ")[0]}，权限受限`, sender);
				return;
			}

			if (!this.execute(sender, msg, this.commands.owner)) return;

			this.client.tell(`§cCommand | §fError > §i未知的命令 ${msg.split(" ")[0]}`, sender);
		});
	}

	/**
	 * 消息日志记录（仅记录主客户端的 chat 消息）
	 * @param {string} sender - 发送者
	 * @param {string} msg - 消息内容
	 * @param {string} type - 消息类型
	 */
	log(sender, msg, type) {
		switch (type) {
			case "chat":
				if (this.client === Current.client) shared.messageLogger.log(`<${sender}> ${msg}`);
				break;
			// 其他消息类型暂不记录
		}
	}

	/**
	 * 遍历命令列表并执行匹配的命令
	 * @param {string} sender - 命令发送者
	 * @param {string} msg - 原始命令文本
	 * @param {Array} cmds - 命令列表
	 * @returns {boolean} false 表示命令已匹配并执行，true 表示无匹配
	 */
	execute(sender, msg, cmds) {
		try {
			for (const cmd of cmds) {
				// 异步命令出错时反馈给发送者
				cmd.onError = (e) => {
					this.client.tell(`§cCommand | §fError > §i${e.message}`, sender);
					shared.logger.debug(e.stack || e.message);
				};

				const result = cmd.execute(sender, msg);

				if (result) {
					// 命令执行出错时通知发送者
					if (!result.status && result.message) this.client.tell(`§cCommand | §fError > §i${result.message}`, sender);
					return false;
				}
			}
		} catch (e) {
			this.client.tellAll(`§cModCMD | §fError > §i${e.message}`);
			return false;
		}

		return true;
	}

	/**
	 * 调用所有 Mod 的指定方法（如果存在）
	 * @param {string} methodName - 方法名
	 * @param {...*} args - 参数
	 */
	callModMethod(methodName, ...args) {
		Object.entries(this.modInstances).forEach(([name, instance]) => {
			// 兼容静态方法（以类作为 this 调用）
			const method = this._resolveModMethod(instance, methodName);
			if (method) {
				try {
					method.fn.apply(method.ctx, args);
				} catch (e) {
					shared.logger.error(`Client Mod ${name}.${methodName} 执行错误`);
					shared.logger.debug(e.message);
				}
			}
		});
	}

	/**
	 * 获取指定 Mod 实例
	 * @param {string} modName - Mod 名称
	 * @returns {Object|null} Mod 实例
	 */
	getMod(modName) {
		return this.modInstances[modName] || null;
	}

	/**
	 * 获取所有 Mod 实例
	 * @returns {Object<string, Object>} Mod 实例映射
	 */
	getAllMods() {
		return { ...this.modInstances };
	}

	/**
	 * 销毁方法 - 清理所有 Mod 实例并释放资源
	 */
	destroy() {
		// 调用所有 Mod 的 onDestroy 方法
		this.callModMethod("onDestroy");

		// 销毁统一的 SAPI 轮询器
		if (this.sapi && typeof this.sapi.destroy === "function") {
			this.sapi.destroy();
		}
		this.sapi = null;

		// 清理 Mod 实例
		const clientId = this.client?.id || "unknown";
		Object.entries(this.modInstances).forEach(([name, instance]) => {
			// 清除 SAPI 句柄引用
			instance.sapi = null;
			// 清除事件订阅与存储，避免客户端反复连接造成内存泄漏
			eventBus.clearMod(`client_${clientId}_${name}`);
			StorageManager.clearStore(`client_${clientId}_${name}`);
			// 清除 client 上的 Mod 引用
			this.client[name] = null;
		});

		this.client = null;
		this.modInstances = {};
		this.commands = {};
	}
}

/**
 * 服务端 Mod 的 SAPI 处理句柄
 * 绑定到当前主客户端的统一轮询器，只关注 Current 客户端
 * 主客户端连接时挂载，断开时卸载
 */
class ServerSAPIHandle {
	/**
	 * @param {string} modName - Mod 名称
	 */
	constructor(modName) {
		this.modName = modName;
		/** @type {SAPIMessageHandler|null} 绑定的统一轮询器 */
		this.hub = null;
		// 注册记录：未连接时暂存，挂载时恢复
		this.registered = [];
	}

	/**
	 * 挂载到指定轮询器
	 * @param {SAPIMessageHandler} hub - 主客户端的统一轮询器
	 */
	_attach(hub) {
		if (!hub || this.hub === hub) return;
		this._detach();
		this.hub = hub;
		for (const [type, callback] of this.registered) {
			hub.register(this.modName, type, callback);
		}
	}

	/**
	 * 从当前轮询器卸载
	 */
	_detach() {
		if (!this.hub) return;
		for (const [type] of this.registered) {
			this.hub.unregister(this.modName, type);
		}
		this.hub = null;
	}

	/**
	 * 注册消息处理器
	 * @param {string} type - 消息类型，"*" 表示所有类型
	 * @param {Function} callback - 处理函数
	 */
	on(type, callback) {
		if (typeof type !== "string" || typeof callback !== "function") return;
		this.registered.push([type, callback]);
		if (this.hub) this.hub.register(this.modName, type, callback);
	}

	/**
	 * 移除消息处理器
	 * @param {string} type - 消息类型
	 */
	off(type) {
		this.registered = this.registered.filter(([t]) => t !== type);
		if (this.hub) this.hub.unregister(this.modName, type);
	}

	/**
	 * 发送消息
	 * @param {string} type - 消息类型
	 * @param {Object} data - 消息数据
	 * @returns {Promise<boolean>} 是否发送成功
	 */
	send(type, data = {}) {
		if (!this.hub) return Promise.resolve(false);
		return this.hub.send(this.modName, type, data);
	}

	/**
	 * 获取命令是否存在
	 * @returns {boolean|null} 检测状态
	 */
	exists() {
		return this.hub ? this.hub.commandExists : null;
	}

	/**
	 * 销毁句柄
	 */
	destroy() {
		this._detach();
		this.registered = [];
	}
}

/**
 * 服务端 Mod 管理器
 * 静态单例，管理服务端级别的 Mod（不随客户端连接创建）
 */
export class ServerModManager {
	/**
	 * 存储已加载的 Mod 类定义
	 * @type {Object<string, Function>}
	 */
	static loadedMod = {};

	/**
	 * 存储 Mod 实例（用于调用实例方法）
	 * @type {Object<string, Object>}
	 */
	static modInstances = {};

	/**
	 * 解析 Mod 方法（兼容实例方法与静态方法）
	 * 静态方法定义在类上，须以类作为 this 调用；实例方法以实例作为 this 调用
	 * @param {Object} instance - Mod 实例
	 * @param {string} name - 方法名
	 * @returns {{ fn: Function, ctx: Object }|null} 方法与调用上下文，不存在时返回 null
	 */
	static _resolveMethod(instance, name) {
		if (!instance) return null;
		if (typeof instance[name] === "function") return { fn: instance[name], ctx: instance };
		const cls = instance.constructor;
		if (cls && typeof cls[name] === "function") return { fn: cls[name], ctx: cls };
		return null;
	}

	/**
	 * 向目标注入 Mod 基础设施（实例或类均可）
	 * @param {Object} target - 注入目标
	 * @param {string} name - Mod 名称
	 */
	static _injectInfra(target, name) {
		target.modName = name;
		target.config = config;
		target.storage = StorageManager.getStore(`server_${name}`);
		target.logger = new ModLogger(`Server:${name}`);

		// 事件通信
		// emit: 只发送给 CurrentClient 的 Client Mod
		target.emit = (event, data) => {
			if (!Current.client) return;
			const currentClientMods = Current.clientMods.get(Current.client);
			if (!currentClientMods) return;
			for (const [modName, mod] of Object.entries(currentClientMods.modInstances)) {
				if (mod._listeners && mod._listeners[event]) {
					for (const cb of mod._listeners[event]) {
						try { cb(data); } catch (e) { shared.logger.error(`EventBus: ${modName}.${event} 执行错误`); }
					}
				}
			}
		};
		// on: 监听 CurrentClient 的事件
		target.on = (event, callback) => {
			target._listeners = target._listeners || {};
			target._listeners[event] = target._listeners[event] || [];
			target._listeners[event].push(callback);
		};
		// onAll: 监听所有客户端的事件
		target.onAll = (event, callback) => eventBus.on(event, `server_${name}`, callback);
		// off: 同时移除 on() 注册的 _listeners 与 onAll() 注册的 eventBus 监听
		target.off = (event, callback) => {
			if (target._listeners && target._listeners[event]) {
				if (typeof callback === "function") {
					target._listeners[event] = target._listeners[event].filter(cb => cb !== callback);
					if (target._listeners[event].length === 0) delete target._listeners[event];
				} else {
					delete target._listeners[event];
				}
			}
			eventBus.off(event, `server_${name}`);
		};
	}

	/**
	 * 注入 SAPI 处理句柄（服务端 Mod 绑定主客户端的统一轮询器）
	 * 实例与类共享同一个句柄
	 * @param {Object} instance - Mod 实例
	 * @param {Function} modClass - Mod 类
	 * @param {string} name - Mod 名称
	 */
	static _injectSAPI(instance, modClass, name) {
		const handle = new ServerSAPIHandle(`server_${name}`);
		instance.sapi = handle;
		modClass.sapi = handle;

		// 若当前已有主客户端，立即挂载
		this.attachMainClient(Current.client);
	}

	/**
	 * 将服务端 Mod 的 SAPI 句柄挂载到指定（主）客户端
	 * 服务端 Mod 只关心 Current 客户端，不关心全局
	 * @param {Object} client - 主客户端连接
	 */
	static attachMainClient(client) {
		const hub = client?.clientMod?.sapi;
		if (!hub) return;
		for (const instance of Object.values(this.modInstances)) {
			if (instance.sapi && typeof instance.sapi._attach === "function") {
				try {
					instance.sapi._attach(hub);
				} catch (e) {
					shared.logger.error(`Server Mod ${instance.modName}.sapi 挂载错误`);
					shared.logger.debug(e.message);
				}
			}
		}
	}

	/**
	 * 将服务端 Mod 的 SAPI 句柄从当前主客户端卸载
	 */
	static detachMainClient() {
		for (const instance of Object.values(this.modInstances)) {
			if (instance.sapi && typeof instance.sapi._detach === "function") {
				try {
					instance.sapi._detach();
				} catch (e) {
					shared.logger.error(`Server Mod ${instance.modName}.sapi 卸载错误`);
					shared.logger.debug(e.message);
				}
			}
		}
	}

	/**
	 * 静态加载方法 - 从配置中读取服务端 Mod 路径并加载
	 * @returns {Promise<void>}
	 */
	static async load() {
		for (const [name, modPath] of Object.entries(config.mods.server)) {
			try {
				const modModule = await import(modPath);
				const modClass = modModule.default;
				this.loadedMod[name] = modClass;

				// 创建 Mod 实例
				const instance = new modClass();
				this.modInstances[name] = instance;

				// 注入 Mod 基础设施（实例与类都注入，兼容静态方法与实例方法）
				this._injectInfra(instance, name);
				this._injectInfra(modClass, name);
				this._injectSAPI(instance, modClass, name);

				// 调用 onStart / start（优先实例方法，兼容静态方法）
				const startMethod = this._resolveMethod(instance, "onStart") || this._resolveMethod(instance, "start");
				if (startMethod) {
					try {
						startMethod.fn.apply(startMethod.ctx);
					} catch (e) {
						shared.logger.error(`Server Mod ${name}.start 执行错误`);
						shared.logger.debug(e.message);
					}
				}

				shared.logger.info(`Server Mod ${name} 已加载`);
			} catch (e) {
				shared.logger.error(`Server Mod ${name} 加载失败`);
				shared.logger.debug(e.message);
			}
		}
	}

	/**
	 * 通知所有服务端 Mod 客户端已连接
	 * @param {Object} client - 客户端连接对象
	 * @param {boolean} isMainClient - 是否为主客户端
	 */
	static onClientConnect(client, isMainClient) {
		// 服务端 Mod 的 SAPI 只绑定主客户端的统一轮询器
		if (isMainClient) {
			this.attachMainClient(client);
		}

		Object.entries(this.modInstances).forEach(([name, instance]) => {
			// 调用 onClientConnect（兼容静态方法）
			const connectMethod = this._resolveMethod(instance, "onClientConnect");
			if (connectMethod) {
				try {
					connectMethod.fn.apply(connectMethod.ctx, [client]);
				} catch (e) {
					shared.logger.error(`Server Mod ${name}.onClientConnect 执行错误`);
					shared.logger.debug(e.message);
				}
			}

			// 如果是主客户端，调用 onMainClientConnect
			if (isMainClient) {
				const mainMethod = this._resolveMethod(instance, "onMainClientConnect");
				if (mainMethod) {
					try {
						mainMethod.fn.apply(mainMethod.ctx, [client]);
					} catch (e) {
						shared.logger.error(`Server Mod ${name}.onMainClientConnect 执行错误`);
						shared.logger.debug(e.message);
					}
				}
			}
		});
	}

	/**
	 * 通知所有服务端 Mod 客户端已断开连接
	 * @param {Object} client - 客户端连接对象
	 * @param {boolean} wasMainClient - 是否为主客户端
	 */
	static onClientDisconnect(client, wasMainClient) {
		// 主客户端断开时卸载服务端 Mod 的 SAPI，并通知 onMainClientDisconnect 钩子
		if (wasMainClient) {
			this.detachMainClient();

			Object.entries(this.modInstances).forEach(([name, instance]) => {
				const mainMethod = this._resolveMethod(instance, "onMainClientDisconnect");
				if (mainMethod) {
					try {
						mainMethod.fn.apply(mainMethod.ctx);
					} catch (e) {
						shared.logger.error(`Server Mod ${name}.onMainClientDisconnect 执行错误`);
						shared.logger.debug(e.message);
					}
				}
			});
		}

		Object.entries(this.modInstances).forEach(([name, instance]) => {
			// 调用 onClientDestroy（兼容静态方法）
			const destroyMethod = this._resolveMethod(instance, "onClientDestroy");
			if (destroyMethod) {
				try {
					destroyMethod.fn.apply(destroyMethod.ctx, [client, wasMainClient]);
				} catch (e) {
					shared.logger.error(`Server Mod ${name}.onClientDestroy 执行错误`);
					shared.logger.debug(e.message);
				}
			}
		});
	}

	/**
	 * 通知所有服务端 Mod 收到 WebSocket 消息
	 * @param {Object} client - 客户端连接对象
	 * @param {Object} data - 消息数据
	 */
	static onMessage(client, data) {
		Object.entries(this.modInstances).forEach(([name, instance]) => {
			const method = this._resolveMethod(instance, "onMessage");
			if (method) {
				try {
					method.fn.apply(method.ctx, [client, data]);
				} catch (e) {
					shared.logger.error(`Server Mod ${name}.onMessage 执行错误`);
					shared.logger.debug(e.message);
				}
			}
		});
	}

	/**
	 * 获取指定 Mod 实例
	 * @param {string} modName - Mod 名称
	 * @returns {Object|null} Mod 实例
	 */
	static getMod(modName) {
		return this.modInstances[modName] || null;
	}

	/**
	 * 获取所有 Mod 实例
	 * @returns {Object<string, Object>} Mod 实例映射
	 */
	static getAllMods() {
		return { ...this.modInstances };
	}

	/**
	 * 获取所有已加载的 Mod 名称
	 * @returns {string[]} Mod 名称数组
	 */
	static getLoadedModNames() {
		return Object.keys(this.loadedMod);
	}

	/**
	 * 获取 Mod 的文件路径
	 * @param {string} modName - Mod 名称
	 * @returns {string|null} 文件路径
	 */
	static getModPath(modName) {
		return config.mods.server[modName] || null;
	}

	/**
	 * 重载指定的服务端 Mod
	 * @param {string} modName - Mod 名称
	 * @returns {{ success: boolean, message: string }} 重载结果
	 */
	static async reload(modName) {
		// 检查 Mod 是否存在
		if (!config.mods.server[modName]) {
			return { success: false, message: `Mod "${modName}" 未在配置中定义` };
		}

		const modPath = config.mods.server[modName];

		// 销毁旧的 Mod 实例
		if (this.modInstances[modName]) {
			const oldInstance = this.modInstances[modName];
			const oldClass = oldInstance.constructor;

			// 调用 onDestroy / destroy（兼容静态方法）
			const destroyMethod = this._resolveMethod(oldInstance, "onDestroy") || this._resolveMethod(oldInstance, "destroy");
			if (destroyMethod) {
				try {
					destroyMethod.fn.apply(destroyMethod.ctx);
				} catch (e) {
					shared.logger.error(`Server Mod ${modName}.onDestroy 执行错误`);
					shared.logger.debug(e.message);
				}
			}

			// 销毁旧 SAPI 处理器（实例与类共享同一实例）
			for (const sapi of [oldInstance.sapi, oldClass && oldClass.sapi]) {
				if (sapi && typeof sapi.destroy === "function") {
					try {
						sapi.destroy();
					} catch {}
				}
			}

			// 清除旧的事件订阅
			eventBus.clearMod(`server_${modName}`);
			StorageManager.clearStore(`server_${modName}`);

			shared.logger.info(`Server Mod ${modName} 已销毁（重载中）`);
		}

		// 重新加载 Mod
		try {
			// 使用动态 import 并添加时间戳绕过缓存
			const timestamp = Date.now();
			const modModule = await import(`${modPath}?t=${timestamp}`);
			const modClass = modModule.default;

			if (!modClass) {
				return { success: false, message: `Mod "${modName}" 没有默认导出` };
			}

			// 更新已加载的 Mod
			this.loadedMod[modName] = modClass;

			// 创建新实例
			const instance = new modClass();

			// 注入 Mod 基础设施（实例与类都注入，兼容静态方法与实例方法）
			this._injectInfra(instance, modName);
			this._injectInfra(modClass, modName);
			this._injectSAPI(instance, modClass, modName);

			this.modInstances[modName] = instance;

			// 调用 onStart / start（优先实例方法，兼容静态方法）
			const startMethod = this._resolveMethod(instance, "onStart") || this._resolveMethod(instance, "start");
			if (startMethod) {
				try {
					startMethod.fn.apply(startMethod.ctx);
				} catch (e) {
					shared.logger.error(`Server Mod ${modName}.start 执行错误`);
					shared.logger.debug(e.message);
				}
			}

			const message = `Server Mod ${modName} 已重载`;
			shared.logger.info(message);

			return { success: true, message };
		} catch (e) {
			const errorMsg = `Server Mod ${modName} 重载失败: ${e.message}`;
			shared.logger.error(errorMsg);
			shared.logger.debug(e.stack);

			// 尝试从配置重新加载旧版本
			if (config.mods.server[modName]) {
				try {
					const modModule = await import(modPath);
					const modClass = modModule.default;
					this.loadedMod[modName] = modClass;

					const instance = new modClass();

					this._injectInfra(instance, modName);
					this._injectInfra(modClass, modName);
					this._injectSAPI(instance, modClass, modName);

					this.modInstances[modName] = instance;

					const startMethod = this._resolveMethod(instance, "onStart") || this._resolveMethod(instance, "start");
					if (startMethod) {
						try {
							startMethod.fn.apply(startMethod.ctx);
						} catch (e2) {
							shared.logger.error(`Server Mod ${modName}.start 执行错误`);
							shared.logger.debug(e2.message);
						}
					}

					shared.logger.warning(`Server Mod ${modName} 已恢复到旧版本`);
				} catch {
					shared.logger.error(`Server Mod ${modName} 恢复失败`);
				}
			}

			return { success: false, message: errorMsg };
		}
	}

	/**
	 * 重载所有服务端 Mod
	 * @returns {{ success: string[], failed: string[] }} 重载结果
	 */
	static async reloadAll() {
		const success = [];
		const failed = [];

		for (const modName of Object.keys(config.mods.server)) {
			const result = await this.reload(modName);
			if (result.success) {
				success.push(modName);
			} else {
				failed.push(modName);
			}
		}

		return { success, failed };
	}

	/**
	 * 静态销毁方法 - 遍历并销毁所有已加载的服务端 Mod
	 */
	static destroy() {
		Object.entries(this.modInstances).forEach(([name, instance]) => {
			const modClass = instance && instance.constructor;

			// 调用 onDestroy / destroy（兼容静态方法）
			const destroyMethod = this._resolveMethod(instance, "onDestroy") || this._resolveMethod(instance, "destroy");
			if (destroyMethod) {
				try {
					destroyMethod.fn.apply(destroyMethod.ctx);
				} catch (e) {
					shared.logger.error(`Server Mod ${name}.onDestroy 执行错误`);
					shared.logger.debug(e.message);
				}
			}

			// 销毁 SAPI 处理器（实例与类共享同一实例，重复销毁安全）
			for (const sapi of [instance.sapi, modClass && modClass.sapi]) {
				if (sapi && typeof sapi.destroy === "function") {
					try {
						sapi.destroy();
					} catch {}
				}
			}

			// 清除事件订阅和存储
			eventBus.clearMod(`server_${name}`);
			StorageManager.clearStore(`server_${name}`);

			shared.logger.info(`Server Mod ${name} 已销毁`);
		});

		this.loadedMod = {};
		this.modInstances = {};
	}
}
