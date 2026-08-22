import * as shared from "./shared.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import readline from "readline";
import Current from "./current.js";
import Command from "./command.js";
import { SAPIMessageHandler } from "./sapi.js";

// Default client mod class (auto-loaded, no manifest scanning)
import DefaultTool from "./tool.js";

// Terminal readline lib
import * as terminal from "./readline.js";

const DEFAULT_CLIENT_MODS = { tool: DefaultTool };

// Lazy imports for injection (avoid circular deps)
let _PermissionManager = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOD_DIR = path.resolve(__dirname, "..", "mod");
const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");

// ==================== Global Config ====================

let rawConfig;
try {
	rawConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
} catch (e) {
	throw new Error(`无法读取配置文件 config.json: ${e.message}`);
}
export const config = JSON.parse(rawConfig);

Command.commandPrefix = config.commandPrefix;

export function reloadConfig() {
	const fresh = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
	for (const k of Object.keys(config)) delete config[k];
	Object.assign(config, fresh);
	Command.commandPrefix = config.commandPrefix;
	return config;
}

// ==================== Deep Merge ====================

function mergeDeep(target, ...sources) {
	for (const source of sources) {
		if (!source) continue;
		for (const key of Object.keys(source)) {
			if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
				if (!target[key] || typeof target[key] !== "object") target[key] = {};
				mergeDeep(target[key], source[key]);
			} else {
				target[key] = source[key];
			}
		}
	}
	return target;
}

// ==================== Mod Registry ====================

class ModRegistry {
	constructor() {
		this.mods = new Map();
	}

	scan() {
		this.mods.clear();
		if (!fs.existsSync(MOD_DIR)) return;

		const entries = fs.readdirSync(MOD_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const modPath = path.join(MOD_DIR, entry.name);
			const manifestPath = path.join(modPath, "manifest.json");
			if (!fs.existsSync(manifestPath)) continue;

			try {
				const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
				const modId = manifest.uuid || entry.name;

			const configPath = path.join(modPath, "config.json");
			const configExamplePath = path.join(modPath, "config.example.json");
			const hasConfig = fs.existsSync(configPath) || fs.existsSync(configExamplePath);
			const hasReadme = fs.existsSync(path.join(modPath, "README.md"));

			// 如果 config.json 不存在但 config.example.json 存在，则复制
			if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
				fs.copyFileSync(configExamplePath, configPath);
			}

			let modConfig = {};
			if (fs.existsSync(configPath)) {
				modConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			}

			this.mods.set(modId, {
				id: modId,
				name: manifest.name || entry.name,
				description: manifest.description || "",
				version: manifest.version || "0.0.0",
				author: manifest.author || "",
				enabled: manifest.enabled !== false,
				entry: {
					server: manifest.entry?.server || null,
					client: manifest.entry?.client || null
				},
				path: modPath,
				config: modConfig,
				hasConfig,
				hasReadme,
				loaded: false,
				serverClass: null,
				clientClass: null,
				serverInstance: null
			});
			} catch (e) {
				shared.logger.error(`Mod ${entry.name} manifest 解析失败: ${e.message}`);
			}
		}
	}

	getMergedConfig(modId) {
		const entry = this.mods.get(modId);
		if (!entry) return config;
		return mergeDeep({}, config, entry.config);
	}

	list() { return [...this.mods.values()]; }
	get(modId) { return this.mods.get(modId) || null; }

	enable(modId) {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" 不存在` };
		entry.enabled = true;
		this._writeManifest(entry);
		return { ok: true, message: `Mod "${entry.name}" 已启用` };
	}

	disable(modId) {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" 不存在` };
		entry.enabled = false;
		this._writeManifest(entry);
		return { ok: true, message: `Mod "${entry.name}" 已禁用` };
	}

	_writeManifest(entry) {
		const manifestPath = path.join(entry.path, "manifest.json");
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		manifest.enabled = entry.enabled;
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n", "utf-8");
	}
}

// ==================== EventBus ====================

class EventBus {
	constructor() { this.listeners = new Map(); }

	on(event, modName, callback) {
		if (!this.listeners.has(event)) this.listeners.set(event, new Map());
		const eventMap = this.listeners.get(event);
		if (!eventMap.has(modName)) eventMap.set(modName, []);
		eventMap.get(modName).push(callback);
	}

	off(event, modName) {
		if (this.listeners.has(event)) this.listeners.get(event).delete(modName);
	}

	emit(event, data, excludeMod = null) {
		if (!this.listeners.has(event)) return;
		const eventMap = this.listeners.get(event);
		for (const [modName, callbacks] of eventMap) {
			if (modName === excludeMod) continue;
			for (const cb of callbacks) {
				try { cb(data); } catch (e) {
					shared.logger.error(`EventBus: ${modName}.${event} 执行错误`);
					shared.logger.debug(e.message);
				}
			}
		}
	}

	clearMod(modName) {
		for (const [, eventMap] of this.listeners) eventMap.delete(modName);
	}

	clear() { this.listeners.clear(); }
}

// ==================== Storage ====================

class ModStorage {
	constructor(modName) { this.modName = modName; this.data = new Map(); }
	get(key, defaultValue) { return this.data.has(key) ? this.data.get(key) : defaultValue; }
	set(key, value) { this.data.set(key, value); }
	delete(key) { return this.data.delete(key); }
	has(key) { return this.data.has(key); }
	clear() { this.data.clear(); }
	keys() { return [...this.data.keys()]; }
	values() { return [...this.data.values()]; }
	entries() { return [...this.data.entries()]; }
}

class ModLogger {
	constructor(modName) { this.prefix = `[${modName}]`; }
	info(...args) { shared.logger.info(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
	warning(...args) { shared.logger.warning(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
	error(...args) { shared.logger.error(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
	debug(...args) { shared.logger.debug(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
}

// ==================== Global Singletons ====================

export const eventBus = new EventBus();

export class StorageManager {
	static stores = new Map();
	static getStore(modName) {
		if (!this.stores.has(modName)) this.stores.set(modName, new ModStorage(modName));
		return this.stores.get(modName);
	}
	static clearStore(modName) {
		const store = this.stores.get(modName);
		if (store) { store.clear(); this.stores.delete(modName); }
	}
	static clearAll() {
		for (const [, store] of this.stores) store.clear();
		this.stores.clear();
	}
}

// ==================== Mod Registry (global) ====================

export const modRegistry = new ModRegistry();


// ==================== Client Mod Manager ====================

export class ClientModManager {
	static loadedMod = {};

	static async load() {
		// 预解析懒加载依赖
		if (!_PermissionManager) _PermissionManager = (await import("./permission.js")).default;

		// 加载内置客户端 Mod
		for (const [name, ModClass] of Object.entries(DEFAULT_CLIENT_MODS)) {
			ClientModManager.loadedMod[name] = ModClass;
			shared.logger.info(`Client Mod ${name} (default) 已加载`);
		}

		for (const entry of modRegistry.list()) {
			if (!entry.enabled || !entry.entry.client) continue;
			try {
				const modPath = path.join(entry.path, entry.entry.client);
				const modModule = await import(modPath);
				const modClass = modModule.default;
				entry.clientClass = modClass;
				ClientModManager.loadedMod[entry.name] = modClass;
				shared.logger.info(`Client Mod ${entry.name} 已加载`);
			} catch (e) {
				shared.logger.error(`Client Mod ${entry.name} 加载失败: ${e.message}`);
			}
		}
	}

	constructor(client) {
		this.client = client;
		this.modInstances = {};
		this.commands = { normal: [], user: [], op: [], owner: [] };
		this.sapi = new SAPIMessageHandler(this.client);
		this.instantiate();
		this.message();
	}

	_resolveModMethod(instance, name) {
		if (!instance) return null;
		if (typeof instance[name] === "function") return { fn: instance[name], ctx: instance };
		const cls = instance.constructor;
		if (cls && typeof cls[name] === "function") return { fn: cls[name], ctx: cls };
		return null;
	}

	instantiate() {
		// Load default client mods first
		for (const [name, ModClass] of Object.entries(DEFAULT_CLIENT_MODS)) {
			if (!ClientModManager.loadedMod[name]) {
				ClientModManager.loadedMod[name] = ModClass;
			}
		}
		for (const [name, ModClass] of Object.entries(ClientModManager.loadedMod)) {
			try { this._instantiateMod(name, ModClass); }
			catch (e) {
				shared.logger.error(`Client Mod ${name} 实例化失败`);
				shared.logger.debug(e.message);
			}
		}
		this._collectCommands();
	}

	_instantiateMod(name, ModClass) {
		const entry = modRegistry.list().find(e => e.name === name);
		let mergedConfig;
		if (entry) {
			mergedConfig = modRegistry.getMergedConfig(entry.id);
		} else if (DEFAULT_CLIENT_MODS[name]) {
			// Default mod: load config from lib/<name>.config.json
			try {
				const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.config.json`);
				const modConfig = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
				mergedConfig = { ...config, ...modConfig };
			} catch {
				mergedConfig = config;
			}
		} else {
			mergedConfig = config;
		}

		if (ModClass && typeof ModClass === "function") ModClass.config = mergedConfig;
		const instance = new ModClass(this.client);

		instance.modName = name;
		instance.config = mergedConfig;
		const clientId = this.client?.id || "unknown";
		instance.storage = StorageManager.getStore(`client_${clientId}_${name}`);
		instance.logger = new ModLogger(`Client:${name}`);

		// 注入常用依赖（实例 + 类静态属性）
		const deps = {
			Command, Current, shared, fs, path, fileURLToPath, exec, readline: terminal,
			PermissionManager: _PermissionManager,
			ServerModManager, ClientModManager, reloadConfig
		};
		for (const [k, v] of Object.entries(deps)) {
			instance[k] = v;
			if (ModClass && typeof ModClass === "function") ModClass[k] = v;
		}

		instance.emit = (event, data) => {
			if (this.client !== Current.client) return;
			const ccm = Current.clientMods.get(Current.client);
			if (!ccm) return;
			for (const [mn, mod] of Object.entries(ccm.modInstances)) {
				if (mod._listeners && mod._listeners[event]) {
					for (const cb of mod._listeners[event]) {
						try { cb(data); } catch (e) { shared.logger.error(`EventBus: ${mn}.${event} 执行错误`); }
					}
				}
			}
		};
		instance.on = (event, callback) => {
			instance._listeners = instance._listeners || {};
			instance._listeners[event] = instance._listeners[event] || [];
			instance._listeners[event].push(callback);
		};
		instance.off = (event) => { if (instance._listeners) delete instance._listeners[event]; };

		instance.sapi = this._createModSAPI(name);
		this.modInstances[name] = instance;
		this.client[name] = instance;

		const startMethod = this._resolveModMethod(instance, "onStart") || this._resolveModMethod(instance, "start");
		if (startMethod) {
			try { startMethod.fn.apply(startMethod.ctx); }
			catch (e) {
				shared.logger.error(`Client Mod ${name}.start 执行错误`);
				shared.logger.debug(e.stack || e.message);
			}
		}
		return instance;
	}

	_collectCommands() {
		this.commands = { normal: [], user: [], op: [], owner: [] };
		for (const [name, instance] of Object.entries(this.modInstances)) {
			const commandMethod = instance.onCommand || instance.commands;
			if (!commandMethod || typeof commandMethod !== "function") continue;
			try {
				const cmdMap = commandMethod.call(instance);
				for (const key of Object.keys(cmdMap)) {
					if (!Array.isArray(cmdMap[key])) continue;
					if (this.commands[key]) this.commands[key].push(...cmdMap[key]);
				}
			} catch (e) {
				shared.logger.error(`Client Mod ${name} 命令收集失败`);
				shared.logger.debug(e.message);
			}
		}
	}

	async reload(name) {
		const entry = modRegistry.list().find(e => e.name === name);
		const isDefault = !entry && DEFAULT_CLIENT_MODS[name];

		if (!entry && !isBuiltin) {
			return { success: false, message: `Client Mod "${name}" 未找到` };
		}

		const oldInstance = this.modInstances[name];
		if (oldInstance) {
			const dm = this._resolveModMethod(oldInstance, "onDestroy") || this._resolveModMethod(oldInstance, "destroy");
			if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
			if (this.sapi && typeof this.sapi.clearMod === "function") this.sapi.clearMod(name);
			if (this.client.utils && typeof this.client.utils.removeOwner === "function") this.client.utils.removeOwner(name);
			eventBus.clearMod(`client_${this.client?.id || "unknown"}_${name}`);
			this.client[name] = null;
			delete this.modInstances[name];
		}

		try {
			let modClass;
			if (isDefault) {
				// Re-import default mod
				const ts = Date.now();
				const modPath = path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.js`);
				const modModule = await import(`${modPath}?t=${ts}`);
				modClass = modModule.default;
			} else {
				const ts = Date.now();
				const modPath = path.join(entry.path, entry.entry.client);
				const modModule = await import(`${modPath}?t=${ts}`);
				modClass = modModule.default;
			}
			if (!modClass) return { success: false, message: `Client Mod "${name}" 没有默认导出` };
			if (entry) entry.clientClass = modClass;
			ClientModManager.loadedMod[name] = modClass;
			this._instantiateMod(name, modClass);
			this._collectCommands();
			shared.logger.info(`Client Mod ${name} 已重载`);
			return { success: true, message: `Client Mod ${name} 已重载` };
		} catch (e) {
			shared.logger.error(`Client Mod ${name} 重载失败: ${e.message}`);
			return { success: false, message: `Client Mod ${name} 重载失败: ${e.message}` };
		}
	}

	async reloadAll() {
		const success = [], failed = [];
		for (const name of Object.keys(ClientModManager.loadedMod)) {
			const r = await this.reload(name);
			r.success ? success.push(name) : failed.push(name);
		}
		return { success, failed };
	}

	static async reloadAllClients() {
		const success = [], failed = [];
		for (const [client, manager] of Current.clientMods) {
			if (!manager || typeof manager.reloadAll !== "function") continue;
			const r = await manager.reloadAll();
			success.push(...r.success.map(n => `${client?.id || "?"}:${n}`));
			failed.push(...r.failed.map(n => `${client?.id || "?"}:${n}`));
		}
		return { success, failed };
	}

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

	message() {
		this.client.subscribe("PlayerMessage", async (data) => {
			const sender = data.body.sender;
			const msg = data.body.message;
			const type = data.body.type;
			if (!msg || !type || !sender) return;
			this.log(sender, msg, type);
			if (type !== "chat" || msg.length >= 256) return;
			if (!msg.startsWith(Command.commandPrefix)) return;

			const PermissionManager = (await import("./permission.js")).default;
			const permission = await PermissionManager.query(sender);
			if (permission instanceof Error) {
				this.client.tell(`§cCommand | §fError > §i${permission.message}`, sender);
				return;
			}
			if (permission < 0) {
				this.client.tell(`§cCommand | §fError > §i命令权限错误`, sender);
				return;
			}
			if (!this.execute(sender, msg, this.commands.normal)) return;
			if (permission < 1) { this.client.tell(`§cCommand | §fError > §i未知命令 ${msg.split(" ")[0]}`, sender); return; }
			if (!this.execute(sender, msg, this.commands.user)) return;
			if (permission < 2) { this.client.tell(`§cCommand | §fError > §i未知命令 ${msg.split(" ")[0]}`, sender); return; }
			if (!this.execute(sender, msg, this.commands.op)) return;
			if (permission < 3) { this.client.tell(`§cCommand | §fError > §i未知命令 ${msg.split(" ")[0]}`, sender); return; }
			if (!this.execute(sender, msg, this.commands.owner)) return;
			this.client.tell(`§cCommand | §fError > §i未知命令 ${msg.split(" ")[0]}`, sender);
		});
	}

	log(sender, msg, type) {
		if (type === "chat" && this.client === Current.client) shared.messageLogger.log(`<${sender}> ${msg}`);
	}

	execute(sender, msg, cmds) {
		try {
			for (const cmd of cmds) {
				cmd.onError = (e) => {
					this.client.tell(`§cCommand | §fError > §i${e.message}`, sender);
					shared.logger.debug(e.stack || e.message);
				};
				const result = cmd.execute(sender, msg);
				if (result) {
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

	callModMethod(methodName, ...args) {
		for (const [name, instance] of Object.entries(this.modInstances)) {
			const method = this._resolveModMethod(instance, methodName);
			if (method) {
				try { method.fn.apply(method.ctx, args); }
				catch (e) {
					shared.logger.error(`Client Mod ${name}.${methodName} 执行错误`);
					shared.logger.debug(e.message);
				}
			}
		}
	}

	getMod(modName) { return this.modInstances[modName] || null; }
	getAllMods() { return { ...this.modInstances }; }

	destroy() {
		this.callModMethod("onDestroy");
		if (this.sapi && typeof this.sapi.destroy === "function") this.sapi.destroy();
		this.sapi = null;
		const clientId = this.client?.id || "unknown";
		for (const [name, instance] of Object.entries(this.modInstances)) {
			instance.sapi = null;
			eventBus.clearMod(`client_${clientId}_${name}`);
			StorageManager.clearStore(`client_${clientId}_${name}`);
			this.client[name] = null;
		}
		this.client = null;
		this.modInstances = {};
		this.commands = {};
	}
}


// ==================== Server Mod Manager (Singleton) ====================

export class ServerModManager {
	static _instance = null;

	static loadedMod = {};

	static async load() {
		// 预解析懒加载依赖
		if (!_PermissionManager) _PermissionManager = (await import("./permission.js")).default;

		for (const entry of modRegistry.list()) {
			if (!entry.enabled || !entry.entry.server) continue;
			try {
				const modPath = path.join(entry.path, entry.entry.server);
				const modModule = await import(modPath);
				const modClass = modModule.default;
				entry.serverClass = modClass;
				ServerModManager.loadedMod[entry.name] = modClass;
				shared.logger.info(`Server Mod ${entry.name} 已加载`);
			} catch (e) {
				shared.logger.error(`Server Mod ${entry.name} 加载失败: ${e.message}`);
			}
		}
		// 创建单例并实例化
		ServerModManager._instance = new ServerModManager();

		// 收集内置 + 服务端 Mod 的终端命令，启动终端交互
		terminal.collectCommands(ServerModManager, ClientModManager);
		terminal.start();
	}

	constructor() {
		if (ServerModManager._instance) {
			return ServerModManager._instance;
		}
		this.modInstances = {};
		this._instantiate();
	}

	_instantiate() {
		for (const [name, ModClass] of Object.entries(ServerModManager.loadedMod)) {
			try {
				const entry = modRegistry.list().find(e => e.name === name);
				const mergedConfig = entry ? modRegistry.getMergedConfig(entry.id) : config;
				const instance = new ModClass();

				instance.modName = name;
				instance.config = mergedConfig;
				if (ModClass && typeof ModClass === "function") ModClass.config = mergedConfig;
				instance.storage = StorageManager.getStore(`server_${name}`);
				instance.logger = new ModLogger(`Server:${name}`);
				instance.emit = (event, data) => eventBus.emit(event, data, name);
				instance.on = (event, callback) => eventBus.on(event, name, callback);
				instance.off = (event) => eventBus.off(event, name);

				// 注入常用依赖（实例 + 类静态属性）
				const deps = {
					Command, Current, shared, fs, path, fileURLToPath, exec, readline: terminal,
				PermissionManager: _PermissionManager,
				ServerModManager, ClientModManager, reloadConfig
				};
				for (const [k, v] of Object.entries(deps)) {
					instance[k] = v;
					if (ModClass && typeof ModClass === "function") ModClass[k] = v;
				}

				this.modInstances[name] = instance;

				// 解析 onStart/start（兼容实例方法和静态方法）
				const startMethod = this._resolveMethod(instance, "onStart") || this._resolveMethod(instance, "start");
				if (startMethod) {
					const startName = typeof instance.onStart === "function" ? "onStart" : "start";
					try { startMethod.fn.apply(startMethod.ctx); }
					catch (e) {
						shared.logger.error(`Server Mod ${name}.${startName} 执行错误`);
						shared.logger.debug(e.stack || e.message);
					}
				}

				// 解析 onDestroy/destroy
				const destroyMethod = this._resolveMethod(instance, "onDestroy") || this._resolveMethod(instance, "destroy");
				if (destroyMethod) {
					this._destroyMethods = this._destroyMethods || {};
					this._destroyMethods[name] = destroyMethod;
				}
			} catch (e) {
				shared.logger.error(`Server Mod ${name} 实例化失败`);
				shared.logger.debug(e.message);
			}
		}
	}

	_resolveMethod(instance, name) {
		if (!instance) return null;
		if (typeof instance[name] === "function") return { fn: instance[name], ctx: instance };
		const cls = instance.constructor;
		if (cls && typeof cls[name] === "function") return { fn: cls[name], ctx: cls };
		return null;
	}

	static _inst() {
		return ServerModManager._instance;
	}

	async reload(name) {
		const entry = modRegistry.list().find(e => e.name === name);
		if (!entry || !entry.entry.server) {
			return { success: false, message: `Server Mod "${name}" 未找到` };
		}

		const oldInstance = this.modInstances[name];
		if (oldInstance) {
			if (typeof oldInstance.onDestroy === "function") {
				try { oldInstance.onDestroy(); } catch {}
			}
			eventBus.clearMod(name);
			delete this.modInstances[name];
		}

		try {
			const timestamp = Date.now();
			const modPath = path.join(entry.path, entry.entry.server);
			const modModule = await import(`${modPath}?t=${timestamp}`);
			const modClass = modModule.default;
			if (!modClass) return { success: false, message: `Server Mod "${name}" 没有默认导出` };

			const mergedConfig = modRegistry.getMergedConfig(entry.id);
			const instance = new modClass();

			instance.modName = name;
			instance.config = mergedConfig;
			instance.storage = StorageManager.getStore(`server_${name}`);
			instance.logger = new ModLogger(`Server:${name}`);
			instance.emit = (event, data) => eventBus.emit(event, data, name);
			instance.on = (event, callback) => eventBus.on(event, name, callback);
			instance.off = (event) => eventBus.off(event, name);

			this.modInstances[name] = instance;
			entry.serverClass = modClass;
			ServerModManager.loadedMod[name] = modClass;

			if (typeof instance.onStart === "function") {
				try { instance.onStart(); }
				catch (e) {
					shared.logger.error(`Server Mod ${name}.onStart 执行错误`);
					shared.logger.debug(e.message);
				}
			}
			shared.logger.info(`Server Mod ${name} 已重载`);
			return { success: true, message: `Server Mod ${name} 已重载` };
		} catch (e) {
			shared.logger.error(`Server Mod ${name} 重载失败: ${e.message}`);
			return { success: false, message: `Server Mod ${name} 重载失败: ${e.message}` };
		}
	}

	async reloadAll() {
		const success = [], failed = [];
		for (const name of Object.keys(ServerModManager.loadedMod)) {
			const result = await this.reload(name);
			result.success ? success.push(name) : failed.push(name);
		}
		return { success, failed };
	}

	static async reloadAll() {
		const inst = ServerModManager._instance;
		if (!inst) return { success: [], failed: [] };
		return inst.reloadAll();
	}

	static getLoadedModNames() {
		return Object.keys(ServerModManager.loadedMod);
	}

	static attachMainClient(client) {
		ServerModManager._inst()?.callModMethod("onMainClientConnect", client);
	}

	static onClientConnect(client, isMainClient) {
		ServerModManager._inst()?.callModMethod("onClientConnect", client, isMainClient);
	}

	static onMessage(client, data) {
		ServerModManager._inst()?.callModMethod("onMessage", client, data);
	}

	static onClientDisconnect(client, isMainClient) {
		ServerModManager._inst()?.callModMethod("onClientDisconnect", client, isMainClient);
	}

	callModMethod(methodName, ...args) {
		for (const [name, instance] of Object.entries(this.modInstances)) {
			const method = this._resolveMethod(instance, methodName);
			if (method) {
				try { method.fn.apply(method.ctx, args); }
				catch (e) {
					shared.logger.error(`Server Mod ${name}.${methodName} 执行错误`);
					shared.logger.debug(e.message);
				}
			}
		}
	}

	static onMainClientSwitch(oldClient, newClient) {
		ServerModManager._inst()?.callModMethod("onMainClientSwitch", oldClient, newClient);
	}

	getMod(modName) { return this.modInstances[modName] || null; }
	getAllMods() { return { ...this.modInstances }; }

	static destroy() {
		const inst = ServerModManager._instance;
		if (!inst) return;
		// 先调用所有 onDestroy
		for (const [name, dm] of Object.entries(inst._destroyMethods || {})) {
			try { dm.fn.apply(dm.ctx); }
			catch (e) {
				shared.logger.error(`Server Mod ${name}.onDestroy 执行错误`);
				shared.logger.debug(e.message);
			}
		}
		for (const name of Object.keys(inst.modInstances)) {
			eventBus.clearMod(name);
			StorageManager.clearStore(`server_${name}`);
		}
		inst.modInstances = {};
		inst._destroyMethods = {};
		ServerModManager._instance = null;
		terminal.stop();
	}
}
