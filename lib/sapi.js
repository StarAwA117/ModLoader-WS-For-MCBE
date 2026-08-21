import * as shared from "./shared.js";
import { config } from "./mods.js";

/**
 * 命令不存在的状态码
 * @type {number}
 */
const COMMAND_NOT_FOUND = -2147483648;

/**
 * SAPI 桥接模块
 * 用于与 Minecraft Bedrock 的 SAPI (Server API) 进行通信
 *
 * 命令说明（命令名见 config.json 的 sapi，SAPI 端需要注册）：
 * - config.sapi.gmsg: 获取等待处理的消息列表（JSON 数组）
 * - config.sapi.smsg <json>: 设置要传递给 WebSocket 的消息（JSON 对象）
 *
 * 消息格式：
 * {
 *   "mod": "ModName",      // 目标 Mod 标识
 *   "type": "msgType",     // 消息类型
 *   "data": {}             // 消息数据
 * }
 */
export default class SAPIBridge {
	/**
	 * 检测 /gmsg 和 /smsg 命令是否存在
	 * @param {Object} client - 客户端连接
	 * @returns {Promise<boolean>} 命令是否存在
	 */
	static async detect(client) {
		if (!client) return false;

		try {
			const data = await client.runCommand(config.sapi.gmsg);
			const statusCode = data?.body?.statusCode;

			// -2147483648 表示命令不存在
			if (statusCode === COMMAND_NOT_FOUND) return false;

			return true;
		} catch (e) {
			shared.logger.debug(`SAPI 检测失败: ${e.message}`);
			return false;
		}
	}

	/**
	 * 获取消息列表
	 * @param {Object} client - 客户端连接
	 * @returns {Promise<Array|null>} 消息列表；命令不存在时返回 null
	 */
	static async getMessages(client) {
		if (!client) return [];

		try {
			const data = await client.runCommand(config.sapi.gmsg);
			const statusCode = data?.body?.statusCode;

			// 检查命令是否存在
			if (statusCode === COMMAND_NOT_FOUND) return null;

			// 从 statusMessage 获取消息（JSON 字符串）
			const statusMessage = data?.body?.statusMessage;
			if (!statusMessage) return [];

			// 尝试 JSON 解析
			try {
				const messages = JSON.parse(statusMessage);
				return Array.isArray(messages) ? messages : [];
			} catch {
				return [];
			}
		} catch (e) {
			shared.logger.debug(`SAPI getMessages 失败: ${e.message}`);
			return [];
		}
	}

	/**
	 * 发送消息
	 * @param {Object} client - 客户端连接
	 * @param {string} mod - Mod 标识
	 * @param {string} type - 消息类型
	 * @param {Object} data - 消息数据
	 * @returns {Promise<boolean|null>} true 成功；false 失败但命令存在；null 命令不存在
	 */
	static async sendMessage(client, mod, type, data = {}) {
		if (!client) return false;

		const message = JSON.stringify({ mod, type, data });

		// 检查消息长度
		if (Buffer.byteLength(message, "utf8") > 400) {
			shared.logger.warning(`SAPI 消息过长: ${Buffer.byteLength(message, "utf8")} bytes`);
			return false;
		}

		const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const command = `${config.sapi.smsg} "${escaped}"`;

		// 检查完整命令长度（不能超过 runCommand 的 461 字节限制）
		if (Buffer.byteLength(command, "utf8") > 461) {
			shared.logger.warning(`SAPI 命令过长: ${Buffer.byteLength(command, "utf8")} bytes`);
			return false;
		}

		try {
			const result = await client.runCommand(command);
			const statusCode = result?.body?.statusCode;

			// 检查命令是否存在
			if (statusCode === COMMAND_NOT_FOUND) return null;

			// statusCode 为 0 表示成功
			if (statusCode === 0) {
				shared.logger.debug(`SAPI 发送成功: ${mod}/${type}`);
				return true;
			}

			shared.logger.debug(`SAPI 发送失败: statusCode=${statusCode}`);
			return false;
		} catch (e) {
			shared.logger.debug(`SAPI sendMessage 失败: ${e.message}`);
			return false;
		}
	}
}

/**
 * SAPI 消息处理器（统一轮询器）
 * 为每个客户端实例化一个，负责：
 * - 统一轮询 /gmsg 消息队列
 * - 按消息中的 mod 字段将消息下放给对应 Mod 注册的处理器
 * - 检测状态为实例级（每个客户端独立），互不影响
 * - 命令不存在时停止轮询，并每 45 秒重试一次
 *
 * 特性：
 * - 实例化后自动开始轮询
 * - 轮询过程中如果命令不存在（-2147483648）自动停止，并周期性重试
 * - 可通过 start() 手动重新开始轮询
 * - 销毁时自动停止轮询
 */
export class SAPIMessageHandler {
	/**
	 * 构造函数
	 * @param {Object} client - 客户端连接
	 */
	constructor(client) {
		this.client = client;
		// 命令是否存在（实例级状态，null=未检测，false=不存在，true=存在）
		this.commandExists = null;
		this.polling = false;
		this.pollTimer = null;
		this.retryTimer = null;
		// 处理器注册表: modName -> Map<type, callback>
		this.handlers = new Map();
		this.pollInterval = 1000;
		this.retryInterval = 45_000;
		this.destroyed = false;

		// 自动开始轮询
		this.start();
	}

	/**
	 * 注册消息处理器（按 modName 下放）
	 * @param {string} modName - Mod 名称
	 * @param {string} type - 消息类型，"*" 表示该 Mod 的所有类型
	 * @param {Function} callback - 处理函数
	 */
	register(modName, type, callback) {
		if (!modName || typeof type !== "string" || typeof callback !== "function") return;
		if (!this.handlers.has(modName)) {
			this.handlers.set(modName, new Map());
		}
		this.handlers.get(modName).set(type, callback);
	}

	/**
	 * 移除消息处理器
	 * @param {string} modName - Mod 名称
	 * @param {string} type - 消息类型
	 */
	unregister(modName, type) {
		const modHandlers = this.handlers.get(modName);
		if (!modHandlers) return;
		modHandlers.delete(type);
		if (modHandlers.size === 0) this.handlers.delete(modName);
	}

	/**
	 * 清除指定 Mod 的全部处理器
	 * @param {string} modName - Mod 名称
	 */
	clearMod(modName) {
		this.handlers.delete(modName);
	}

	/**
	 * 发送消息（以指定 Mod 名义）
	 * @param {string} modName - Mod 名称
	 * @param {string} type - 消息类型
	 * @param {Object} data - 消息数据
	 * @returns {Promise<boolean>} 是否发送成功
	 */
	async send(modName, type, data = {}) {
		if (!this.client || this.destroyed) return false;

		const result = await SAPIBridge.sendMessage(this.client, modName, type, data);

		// 命令不存在时禁用并周期重试
		if (result === null) {
			this._disable();
			return false;
		}

		// 发送成功说明命令已恢复，立即重新启用轮询
		if (result === true && this.commandExists === false) {
			this._enable();
		}

		return result === true;
	}

	/**
	 * 开始轮询消息
	 * 如果已经在轮询中，则忽略
	 */
	start() {
		if (this.polling || !this.client || this.destroyed) return;
		this.polling = true;
		// 清除待定的重试定时器，以当前轮询为准
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		shared.logger.debug(`SAPI 开始轮询`);
		this._poll();
	}

	/**
	 * 停止轮询消息
	 */
	stop() {
		if (!this.polling) return;
		this.polling = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		shared.logger.debug(`SAPI 停止轮询`);
	}

	/**
	 * 内部轮询方法
	 */
	async _poll() {
		if (!this.polling || !this.client || this.destroyed) return;

		try {
			// 首次轮询前先检测命令是否存在
			if (this.commandExists === null) {
				const exists = await SAPIBridge.detect(this.client);
				if (!exists) {
					this._disable();
					return;
				}
				this.commandExists = true;
				shared.logger.info("SAPI 命令已检测到，桥接功能已启用");
			}

			const messages = await SAPIBridge.getMessages(this.client);

			// 命令不存在，停止轮询并周期重试
			if (messages === null) {
				this._disable();
				return;
			}

			// 按 mod 下放处理接收到的消息
			for (const msg of messages) {
				this._handleMessage(msg);
			}
		} catch (e) {
			shared.logger.debug(`SAPI 轮询错误: ${e.message}`);
		}

		// 安排下次轮询
		if (this.polling) {
			this.pollTimer = setTimeout(() => this._poll(), this.pollInterval);
		}
	}

	/**
	 * 处理单条消息
	 * 优先根据消息中的 mod 字段路由到对应 Mod；
	 * 若 mod 未注册或为空，则广播给所有通配符（"*"）处理器
	 * @param {Object} msg - 消息对象 { mod, type, data }
	 */
	_handleMessage(msg) {
		if (!msg || typeof msg !== "object") return;

		const { mod, type, data } = msg;
		const msgData = { mod, type, data };

		const modHandlers = typeof mod === "string" ? this.handlers.get(mod) : undefined;

		if (modHandlers) {
			this._callHandler(modHandlers.get(type), msgData);
			this._callHandler(modHandlers.get("*"), msgData);
		} else {
			// 无对应 Mod（或 mod 为空）时，广播到所有通配符处理器
			for (const handlers of this.handlers.values()) {
				this._callHandler(handlers.get("*"), msgData);
			}
		}
	}

	/**
	 * 安全调用单个处理器
	 * @param {Function|null} handler - 处理函数
	 * @param {Object} msg - 消息对象
	 */
	_callHandler(handler, msg) {
		if (typeof handler !== "function") return;
		try {
			handler(msg);
		} catch (e) {
			shared.logger.error(`SAPI 消息处理错误: ${msg.type}`);
			shared.logger.debug(e.message);
		}
	}

	/**
	 * 禁用桥接（命令不存在）
	 * 停止轮询并安排周期性重试
	 */
	_disable() {
		if (this.commandExists === false) return;
		this.commandExists = false;
		this.stop();
		shared.logger.info("SAPI 命令不存在，已禁用桥接功能");
		this._scheduleRetry();
	}

	/**
	 * 启用桥接（命令恢复）
	 */
	_enable() {
		if (this.commandExists === true) return;
		this.commandExists = true;
		shared.logger.info("SAPI 命令已恢复，桥接功能已启用");
		this.start();
	}

	/**
	 * 安排周期重试检测
	 */
	_scheduleRetry() {
		if (this.retryTimer || this.destroyed) return;
		this.retryTimer = setTimeout(async () => {
			this.retryTimer = null;
			if (this.destroyed || !this.client) return;
			try {
				const exists = await SAPIBridge.detect(this.client);
				if (exists) {
					this._enable();
				} else {
					this._scheduleRetry();
				}
			} catch {
				this._scheduleRetry();
			}
		}, this.retryInterval);
	}

	/**
	 * 销毁处理器
	 */
	destroy() {
		this.destroyed = true;
		this.stop();
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		this.handlers.clear();
		this.client = null;
	}
}
