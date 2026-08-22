import WebSocket from "ws";
const { OPEN: wsOPEN } = WebSocket;
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { config } from "./mods.js";

/**
 * WebSocket 工具类
 * 封装了与 Minecraft Bedrock WebSocket API 的所有交互
 * 包括命令发送、事件订阅、消息分发等功能
 */
export default class Utils {
	/**
	 * 设置 Multi Map
	 * 用于 subscribeBack & packageBack 等多对多映射
	 * @param {Map} multimap - 多值映射表
	 * @param {string} key - 键
	 * @param {*} value - 值
	 */
	static setMulti(multimap, key, value) {
		if (!multimap.has(key)) {
			multimap.set(key, []);
		}
		multimap.get(key).push(value);
	}

	/**
	 * 字符串分割方法
	 * 用于分割所发送的消息命令，防止发送超长包
	 * @param {string} str - 要分割的字符串
	 * @param {number} maxBytes - 最大字节数
	 * @returns {string[]} 分割后的字符串数组
	 */
	static splitByBytes(str, maxBytes) {
		const result = [];
		let start = 0;
		while (start < str.length) {
			let end = start + 1;
			while (end <= str.length && Buffer.byteLength(str.slice(start, end), "utf8") <= maxBytes) {
				end++;
			}
			// 单个字符就超限时强制推进，避免死循环或产生空片段
			if (end - 1 <= start) end = start + 2;
			let cut = end - 1;
			// 避免把代理对（emoji）截断：若切点前一字符是高代理，则前移一位
			const c = str.charCodeAt(cut - 1);
			if (cut > start && c >= 0xD800 && c <= 0xDBFF) cut--;
			if (cut <= start) cut = start + 1; // 极端情况兜底，保证推进
			result.push(str.slice(start, cut));
			start = cut;
		}
		return result;
	}

	/**
	 * 构造函数
	 * @param {WebSocket} client - WebSocket 客户端连接
	 */
	constructor(client) {
		// 存储 client
		this.client = client;

		// 将方法绑定到 client
		client.sendCommand = this.sendCommand.bind(this);
		client.runCommand = this.runCommand.bind(this);
		client.subscribe = this.subscribe.bind(this);
		client.unsubscribe = this.unsubscribe.bind(this);
		client.tellAll = this.tellAll.bind(this);
		client.tell = this.tell.bind(this);
		client.getLocation = this.getLocation.bind(this);
		client.getPosition = this.getPosition.bind(this);
		client.getDimension = this.getDimension.bind(this);
		client.getInventory = this.getInventory.bind(this);
		client.getLocalPlayer = this.getLocalPlayer.bind(this);
		client.closechat = this.closechat.bind(this);
		client.getPermission = this.getPermission.bind(this);

		// 状态标记
		// permission: 0=未进入世界/未知 1=普通 2=OP 3=最高
		this.permission = 0;
		// tellAll 转发模式（默认取配置值，可按客户端用 Tool 命令单独开关）
		this.tellAllToTell = config.utils?.tellAllToTell ?? false;

		// 启动轮询
		if (config.utils?.enablePolling) {
			this.startPolling();
		}

		// 各种操作的返回 Map
		this.commandBack = new Map();
		this.subscribeBack = new Map();
		this.packageBack = new Map();
		// 订阅归属表: owner(Mod 名) -> Array<[event, callback]>
		this.ownerBack = new Map();
		// 已向游戏端订阅的事件集合（同一事件只订阅一次，避免事件重复接收）
		this.subscribedEvents = new Set();
	}

	/**
	 * 调试发包记录
	 * @param {string} message - 消息内容
	 * @param {Error|null} error - 错误对象（可选）
	 */
	_saveLog(message, error=null) {
		// 发包记录
		logger.debug(`Server -> Client ${message}`);
		// 错误记录
		if (error) {
			logger.error("服务端发包错误");
			logger.debug(error.message);
		}
	}

	/**
	 * 无检测的命令发送方法
	 * 该方法可能会抛出错误
	 * @param {string} command - 要发送的命令
	 * @param {string} [uuid] - 可选：指定 requestId（用于发送前预注册回调，避免响应竞态）
	 * @returns {Promise<string>} 返回命令的 UUID
	 */
	sendCommandUnsafe(command, uuid = uuidv4()) {
		return new Promise((resolve, reject) => {
			// 构造命令包
			const cmd = {
				body: {
					origin: {
						type: "player"
					},
					commandLine: command,
					version: 17104896
				},
				header: {
					requestId: uuid,
					messagePurpose: "commandRequest",
					version: 1,
					messageType: "commandRequest"
				}
			};
	
			// 发送命令
			this.client.send(JSON.stringify(cmd), (error) => {
				// 日志存储
				this._saveLog(JSON.stringify(cmd), error);
	
				// 标识完成情况
				if (error) reject(error);
				// 完成返回唯一标识符 UUID
				else resolve(uuid);
			});
		});
	}

	/**
	 * 有检测的执行命令方法
	 * 该方法可能会抛出错误
	 * @param {string} command - 要发送的命令
	 * @returns {Promise<string>} 返回命令的 UUID
	 */
	async sendCommandWithCheck(command, uuid) {
		// 过滤非法 command 与 非 null 下的非法 callback
		if (typeof command !== "string") throw new Error("命令格式错误");
		// 如果没有 client 客户端或未开启则直接返回
		if (!this.client || this.client.readyState !== wsOPEN) throw new Error("该 Client 无效或非活跃");
		// 检测 command 内容是否大于 461
		// 原因：当发送 command 内容大于 461 的包时，游戏会返回 Block / NetherNet 错误并退出房间
		if (Buffer.byteLength(command, "utf8") > 461) throw new Error("命令长度过长");

		// 执行命令发送方法并返回
		return this.sendCommandUnsafe(command, uuid);
	}

	/**
	 * 无报错的执行命令方法
	 * @param {string} command - 要发送的命令
	 * @returns {Promise<string|undefined>} 返回命令的 UUID 或 undefined
	 */
	sendCommand(command) {
		return this.sendCommandWithCheck(command).catch(e => {});
	}

	/**
	 * 带返回的命令执行方法
	 * 该方法可能会抛出错误
	 * @param {string} command - 要发送的命令
	 * @param {number} timeout - 超时时间（毫秒），默认 10 秒
	 * @returns {Promise<Object>} 返回命令执行结果
	 */
	runCommand(command, timeout = 10000) {
		return new Promise((resolve, reject) => {
			// 先以预生成 UUID 注册回调，再发送命令，避免响应先于注册到达导致命令悬挂到超时
			const uuid = uuidv4();
			let timer = null;

			const handler = (data) => {
				if (timer) clearTimeout(timer);
				resolve(data);
			};
			this.commandBack.set(uuid, handler);

			timer = setTimeout(() => {
				this.commandBack.delete(uuid);
				reject(new Error("命令响应超时"));
			}, timeout);

			this.sendCommandWithCheck(command, uuid).catch((e) => {
				if (timer) clearTimeout(timer);
				this.commandBack.delete(uuid);
				reject(e);
			});
		});
	}

	/**
	 * 订阅事件方法
	 * 该方法可能会抛出错误
	 * @param {string} event - 事件名称
	 * @param {Function|null} callback - 回调函数（可选）
	 * @param {string|null} owner - 订阅归属（Mod 名），用于按归属批量移除
	 */
	subscribe(event, callback = null, owner = null) {
		// 过滤非法 event 与 非 null 下的非法 callback 并报错
		if (typeof event !== "string" || (callback && typeof callback !== "function")) throw new Error("非法 Event 或 非 null 下的非法 callback");
		// 如果没有 client 客户端或未开启则直接返回
		if (!this.client || this.client.readyState !== wsOPEN) return false;

		// 仅在 callback 有效时存储，避免 null 调用
		if (callback) {
			Utils.setMulti(this.subscribeBack, event, callback);
			// 记录归属，便于 reload 时移除
			if (owner) {
				if (!this.ownerBack.has(owner)) this.ownerBack.set(owner, []);
				this.ownerBack.get(owner).push([event, callback]);
			}
		}

		// 同一事件已订阅过则不再重复发包，避免游戏端重复触发
		if (this.subscribedEvents.has(event)) return true;
		this.subscribedEvents.add(event);

		// 构造 subscribe 包
		const sub = {
			body: {
				eventName: event
			},
			header: {
				requestId: uuidv4(),
				messagePurpose: "subscribe",
				version: 1,
				messageType: "commandRequest"
			}
		}

		// 发送 subscribe 包
		this.client.send(JSON.stringify(sub), (error) => {
			this._saveLog(JSON.stringify(sub), error);
		});
	}

	/**
	 * 取消订阅事件方法
	 * @param {string} event - 事件名称
	 */
	unsubscribe(event) {
		// 过滤非法 event
		if (typeof event !== "string") throw new Error("非法 Event");
		// 如果没有 client 客户端或未开启则直接返回
		if (!this.client || this.client.readyState !== wsOPEN) return false;

		// 标记事件已取消订阅，允许后续重新订阅
		this.subscribedEvents.delete(event);

		// 同步清理 ownerBack 中该事件的记录，避免 removeOwner 误删重新订阅后的新回调
		for (const [owner, subs] of this.ownerBack) {
			const remain = subs.filter(([ev]) => ev !== event);
			if (remain.length === 0) this.ownerBack.delete(owner);
			else this.ownerBack.set(owner, remain);
		}

		// 构造 unsubscribe 包
		const unsub = {
			body: {
				eventName: event
			},
			header: {
				requestId: uuidv4(),
				messagePurpose: "unsubscribe",
				version: 1,
				messageType: "commandRequest"
			}
		}

		// 发送 unsubscribe 包
		this.client.send(JSON.stringify(unsub), (error) => {
			// 如果没有错误 则在 this.subscribeBack Map 中删除改事件及所有返回函数
			if (!error) this.subscribeBack.delete(event);
			this._saveLog(JSON.stringify(unsub), error);
		});
	}

	/**
	 * 订阅所有游戏返回的包
	 * 主要用于底层管理
	 * @param {string} uuid - 唯一标识符
	 * @param {Function} callback - 回调函数
	 */
	subscribePackage(uuid, callback) {
		// 过滤非法 uuid 与 callback
		if (typeof uuid !== "string" || !callback || typeof callback !== "function") return false;
		// 添加到 this.packageBack Map
		this.packageBack.set(uuid, callback);
	}

	/**
	 * 取消订阅所有游戏返回的包
	 * @param {string} uuid - 唯一标识符
	 */
	unsubscribePackage(uuid) {
		// 如果 this.packageBack Map 有 uuid 则删除
		if (this.packageBack.has(uuid)) this.packageBack.delete(uuid);
	}

	/**
	 * 全局发送消息
	 * 使用命令 me
	 * @param {string} msg - 消息内容
	 */
	tellAll(msg) {
		// 开启转发模式时：直接转发为 tell
		if (this.tellAllToTell) return this.tell(msg);
		// 分割消息并遍历
		Utils.splitByBytes(msg, 420).forEach(m => {
			// 发送
			this.sendCommand(`me ${m}`);
		});
	}

	/**
	 * 对可选目标发送消息
	 * 使用命令 tellraw - 需要 OP 权限（命令权限等级 2）
	 * @param {string} msg - 消息内容
	 * @param {string} current - 目标选择器（默认 @a）
	 * @param {boolean} isPrefix - 是否加标识前缀
	 */
	tell(msg, current = "@a", isPrefix = true) {
		// 构建前缀（复用逻辑，用于计算分割字节数）
		const prefixParts = isPrefix
			? [
				{ text: "* " },
				{ translate: "commands.origin.external" },
				{ text: " " }
			]
			: [];

		// 按最终命令的真实长度分割（含 JSON 转义），确保每条命令不超过 461 字节
		const maxCmd = 461;
		let start = 0;
		while (start < msg.length) {
			let end = start + 1;
			while (end <= msg.length) {
				const sendObject = {
					rawtext: [
						...prefixParts,
						{ text: msg.slice(start, end) }
					]
				};
				const cmd = `tellraw ${current} ${JSON.stringify(sendObject)}`;
				if (Buffer.byteLength(cmd, "utf8") > maxCmd) break;
				end++;
			}
			// 单个字符就超限时强制推进，避免死循环
			if (end - 1 <= start) end = start + 2;
			let cut = end - 1;
			// 避免把代理对（emoji）截断
			const c = msg.charCodeAt(cut - 1);
			if (cut > start && c >= 0xD800 && c <= 0xDBFF) cut--;
			if (cut <= start) cut = start + 1;
			const m = msg.slice(start, cut);
			const sendObject = {
				rawtext: [
					...prefixParts,
					{ text: m }
				]
			};
			this.sendCommand(`tellraw ${current} ${JSON.stringify(sendObject)}`);
			start = cut;
		}
	}

	/**
	 * 获取位置方法
	 * @param {string} target - 目标选择器
	 * @returns {Promise<Object|null>} 返回 { x, y, z, dimension } 或 null
	 */
	async getLocation(target) {
		let data;

		try {
			data = await this.runCommand(`querytarget ${target}`);
		} catch {
			return;
		}

		if (data?.body?.statusCode) return;

		let details = data?.body?.details;
		if (!details) return;

		// querytarget 返回的 details 是 JSON 字符串，需要解析
		if (typeof details === "string") {
			try {
				details = JSON.parse(details);
			} catch {
				return;
			}
		}

		// details 是数组，取第一个元素
		const entry = Array.isArray(details) ? details[0] : details;
		if (!entry?.position) return;

		return { ...entry.position, dimension: entry.dimension };
	}

	/**
	 * 获取坐标方法
	 * @param {string} target - 目标选择器
	 * @returns {Promise<Object|null>} 返回 { x, y, z } 或 null
	 */
	async getPosition(target) {
		const location = await this.getLocation(target);
		return location ? { x: location.x, y: location.y, z: location.z } : null;
	}

	/**
	 * 获取维度方法
	 * @param {string} target - 目标选择器
	 * @returns {Promise<string|null>} 返回维度名称或 null
	 */
	async getDimension(target) {
		const location = await this.getLocation(target);
		return location?.dimension;
	}

	/**
	 * 获取物品栏方法
	 * @param {string} target - 目标选择器
	 * @returns {Promise<Object|undefined>} 返回物品栏数据
	 */
	async getInventory(target) {
		try {
			const data = await this.runCommand(`codebuilder_actorinfo inventory ${target}`);
			return data?.body?.inventory;
		} catch {}
	}

	/**
	 * 获取本地玩家方法
	 * @returns {Promise<string|undefined>} 返回本地玩家名称
	 */
	async getLocalPlayer() {
		try {
			const data = await this.runCommand("getlocalplayername");
			return data?.body?.localplayername;
		} catch {}
	}

	/**
	 * 关闭聊天框方法
	 * @returns {Promise<boolean>} 返回操作状态
	 */
	async closechat() {
		try {
			// 使用 /closechat 命令关闭聊天框
			const data = await this.runCommand("closechat");
			return data?.body ? data.body.statusCode === 0 : false;
		} catch {}
	}

	/**
	 * 获取权限等级
	 * @returns {number} 权限等级：0=未进入世界/未知 1=普通 2=OP 3=最高
	 */
	getPermission() {
		return this.permission;
	}

	/**
	 * 获取当前 tellAll 转发模式
	 * @returns {boolean} true=转发为 tell false=按原样广播
	 */
	getTellAllMode() {
		return this.tellAllToTell;
	}

	/**
	 * 设置当前客户端的 tellAll 转发模式
	 * @param {boolean} enabled - true=转发为 tell false=按原样广播
	 * @returns {boolean} 设置后的模式
	 */
	setTellAllMode(enabled) {
		this.tellAllToTell = !!enabled;
		return this.tellAllToTell;
	}

	/**
	 * 启动轮询
	 * 每秒检查一次客户端是否进入世界（/list 超时判定）
	 * 每 45 秒检测一次权限等级（仅在已进入世界时执行）
	 */
	startPolling() {
		// 每秒一次：进入世界检测
		this._inWorldTimer = setInterval(() => this._checkInWorld(), 1000);
		// 每 45 秒一次：权限等级检测
		this._permissionTimer = setInterval(() => this._checkPermission(), 45000);
		// 立即执行一次，尽快拿到初始状态
		this._checkInWorld();
		this._checkPermission();
	}

	/**
	 * 检测客户端是否进入世界
	 * /list 使用短超时：超时说明未进入世界 → 标记 permission 为 0；成功且当前未知则临时标记为 1
	 */
	async _checkInWorld() {
		if (!this.client || this.client.readyState !== wsOPEN) return;
		try {
			await this.runCommand("list", 500);
			// 已进入世界：若当前仍为 0（未知/未进入），先临时标记为 1
			if (this.permission === 0) this.permission = 1;
		} catch {
			// 超时说明未进入世界
			this.permission = 0;
		}
	}

	/**
	 * 检测权限等级（仅在已进入世界时执行）
	 * /testfor @a 失败 → 1；成功再经 /listd：失败 → 2，成功 → 3
	 */
	async _checkPermission() {
		if (this.permission === 0) return;
		if (!this.client || this.client.readyState !== wsOPEN) return;

		try {
			// /testfor 为操作员命令，权限不足时命令会失败
			const testfor = await this.runCommand("testfor @a", 5000);
			if (testfor?.body?.statusCode) {
				this.permission = 1;
				return;
			}
			// /testfor 成功，进一步判断自身等级是否为 3
			const listd = await this.runCommand("listd", 5000);
			this.permission = listd?.body?.statusCode ? 2 : 3;
		} catch {
			// 命令超时等异常：保留当前权限值，避免误标记
		}
	}

	/**
	 * 接收消息方法
	 * @param {Object} data - 接收到的消息数据
	 */
	onMessage(data) {
		// 获取包类型 purpose
		const purpose = data?.header?.messagePurpose;

		// 过滤非法包
		if (!purpose) return;

		// 调试记录信息
		logger.debug(`Client -> Server ${JSON.stringify(data)}`);

		// 将包直接发送给 packageBack 中存储的 callback 函数
		// 遍历到列表
		for (const callback of this.packageBack.values()) {
			// 直接调用
			// 用 try - catch 防止影响后续
			try {
				callback(data);
			} catch (e) {
				// 错误调试记录
				logger.error("总返回包 Callback 函数错误");
				logger.debug(e.message);
			}
		}

		// 检测 event 包
		// event 事件包
		if (purpose === "event") {
			// 获取 eventName
			const eventName = data?.header?.eventName;

			// 如果事件不在 this.subscribeBack Map 中 则直接返回
			if (!this.subscribeBack.has(eventName)) return;

			// 遍历 this.subscribeBack Map 中该事件对应的 callback 函数并执行
			// 注：该 Map 为 Multi Map 因此需要先 get 再遍历
			this.subscribeBack.get(eventName).forEach(callback => {
				// 直接调用
				// 用 try - catch 防止影响后续
				try {
					callback(data);
				} catch (e) {
					// 错误调试记录
					logger.error("订阅返回包 Callback 函数错误");
					logger.debug(e.message);
				}
			});
		}

		// 检测 commandResponse 包
		// commandResponse 命令返回包
		else if (purpose === "commandResponse") {
			// 获取 uuid
			const uuid = data?.header?.requestId;

			// 若 this.commandBack 中没有该返回包的 uuid 则返回
			if (!this.commandBack.has(uuid)) return;

			// 调用对应的 callback 函数
			try {
				this.commandBack.get(uuid)(data);
			} catch (e) {
				// 错误调试记录
				logger.error("命令返回包 Callback 函数错误");
				logger.debug(e.message);
			}

			// 直接删除 this.commandBack Map 中的元素
			this.commandBack.delete(uuid);
		}
	}

	/**
	 * 按归属（Mod 名）批量移除订阅
	 * @param {string} owner - Mod 名
	 */
	removeOwner(owner) {
		const subs = this.ownerBack.get(owner);
		if (!subs) return;
		for (const [event, callback] of subs) {
			const list = this.subscribeBack.get(event);
			if (list) {
				const idx = list.indexOf(callback);
				if (idx !== -1) list.splice(idx, 1);
				if (list.length === 0) this.subscribeBack.delete(event);
			}
		}
		this.ownerBack.delete(owner);
	}

	/**
	 * 销毁方法
	 */
	destroy() {
		// 清除轮询定时器
		if (this._inWorldTimer) clearInterval(this._inWorldTimer);
		if (this._permissionTimer) clearInterval(this._permissionTimer);
		this._inWorldTimer = null;
		this._permissionTimer = null;
		// 清除 this.client 引用
		this.client = null;
		// 清空三个 Map
		this.commandBack.clear();
		this.subscribeBack.clear();
		this.packageBack.clear();
		this.ownerBack.clear();
		this.subscribedEvents.clear();
	}
}

