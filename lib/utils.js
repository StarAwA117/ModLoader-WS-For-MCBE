const { OPEN: wsOPEN } = require("ws");
const { v4: uuidv4 } = require("uuid");
const shared = require("./shared.js");
const { track } = require("../config.js");

// 工具类
class Utils {
	// 设置 Multi Map
	// 用于 subscribeBack & packageBack ...
	static setMulti(multimap, key, value) {
		if (!multimap.has(key)) {
			multimap.set(key, []);
		}
		multimap.get(key).push(value);
	}

	// 字符串分割方法
	// 用于分割所发送的消息命令
	// 消息命令 me tellraw
	static splitByBytes(str, maxBytes) {
		const result = [];
		let start = 0;
		while (start < str.length) {
			let end = start + 1;
			while (end <= str.length && Buffer.byteLength(str.slice(start, end), "utf8") <= maxBytes) {
				end++;
			}
			result.push(str.slice(start, end - 1));
			start = end - 1;
		}
		return result;
	}

	// 构造函数
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
		client.getLocolPlayer = this.getLocolPlayer.bind(this);
		client.closechat = this.closechat.bind(this);

		// 各种操作的返回 Map
		this.commandBack = new Map();
		this.subscribeBack = new Map();
		this.packageBack = new Map();
	}

	// 调试发包记录
	_saveLog(message, error=null) {
		// 过滤非调试状态
		if (!track) return;
		// 发包记录
		shared.logger.debug(`Server -> Client ${message}`);
		// 错误记录
		if (error) {
			shared.logger.error("服务端发包错误");
			shared.logger.debug(error.message);
		}
	}

	// 无检测的命令发送方法
	// 该方法可能会抛出错误
	sendCommandUnsafe(command) {
		return new Promise((resolve, reject) => {
			// 获取 UUID
			const uuid = uuidv4();
	
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

	// 有检测的执行命令方法
	// 该方法可能会抛出错误
	async sendCommandWithCheck(command) {
		// 过滤非法 command 与 非 null 下的非法 callback
		if (typeof command !== "string") throw new Error("命令格式错误");
		// 如果没有 client 客户端或未开启则直接返回
		if (!this.client || this.client.readyState !== wsOPEN) throw new Error("该 Client 无效或非活跃");
		// 检测 command 内容是否大于 461
		// 原因：当发送 command 内容大于 461 的包时，游戏会返回 Block / NetherNet 错误并退出房间
		if (Buffer.byteLength(command, "utf8") > 461) throw new Error("命令长度过长");

		// 执行命令发送方法并返回
		return this.sendCommandUnsafe(command);
	}

	// 无报错的执行命令方法
	sendCommand(command) {
		return this.sendCommandWithCheck(command).catch(e => {});
	}

	// 带返回的命令执行方法
	// 该方法可能会抛出错误
	runCommand(command) {
		return new Promise((resolve, reject) => {
			this.sendCommandWithCheck(command)
			.then(uuid => {
				const handler = (data) => {
					resolve(data);
				}
			
				this.commandBack.set(uuid, handler);
			})
			.catch(reject);
		});
	}

	// 订阅事件方法
	// 该方法可能会抛出错误
	subscribe(event, callback = null) {
		// 过滤非法 event 与 非 null 下的非法 callback 并报错
		if (typeof event !== "string" || (callback && typeof callback !== "function")) throw new Error("非法 Event 或 非 null 下的非法 callback");
		// 如果没有 client 客户端或未开启则直接返回
		if (!this.client || this.client.readyState !== wsOPEN) return false;

		// 仅在 callback 有效时存储，避免 null 调用
		if (callback) Utils.setMulti(this.subscribeBack, event, callback);

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

	// 取消订阅事件方法
	unsubscribe(event) {
		// 过滤非法 event
		if (typeof event !== "string") throw new Error("非法 Event");
		// 如果没有 client 客户端或未开启则直接返回
		if (!this.client || this.client.readyState !== wsOPEN) return false;

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

	// 订阅所有游戏返回的包
	// 主要用于底层管理
	subscribePackage(uuid, callback) {
		// 过滤非法 uuid 与 callback
		if (typeof uuid !== "string" || !callback || typeof callback !== "function") return false;
		// 添加到 this.packageBack Map
		this.packageBack.set(uuid, callback);
	}

	// 取消订阅所有游戏返回的包
	unsubscribePackage(uuid) {
		// 如果 this.packageBack Map 有 uuid 则删除
		if (this.packageBack.has(uuid)) this.packageBack.delete(uuid);
	}

	// 全局发送消息
	// 使用命令 me
	tellAll(msg) {
		// 分割消息并遍历
		Utils.splitByBytes(msg, 420).forEach(m => {
			// 发送
			this.sendCommand(`me ${m}`);
		});
	}

	// 对可选目标发送消息
	// 使用命令 tellraw - 需要 OP 权限（命令权限等级 2
	// isPrefix 可选择是否加标识前缀（即 * 外部 
	tell(msg, current = "@a", isPrefix = true) {
		// 分割消息并遍历
		Utils.splitByBytes(msg, 300).forEach(m => {
			// 构建 textRaw 包
			const sendObject = {
				rawtext: isPrefix 
					? [
						{ text: "* " },
						{ translate: "commands.origin.external" },
						{ text: " " },
						{ text: m }
					]
					: [
						{ text: m }
					]
			};

			// 将 sendObject 对象转 object 并用 tellraw 发送到游戏
			this.sendCommand(`tellraw ${current} ${JSON.stringify(sendObject)}`);
		});
	}

	// 获取位置方法
	// 返回 { x: int, y: int, z: int, dimension: string } or null
	async getLocation(target) {
		let data;

		try {
			data = await this.runCommand(`querytarget ${target}`);
		} catch {
			return;
		}

		if (data?.body?.statusCode) return;

		const details = data.body.details;
		if (!details) return;

		return { ...details.position, dimension: details.dimension };
	}

	// 获取坐标方法
	// 返回 { x: int, y: int, z: int } or null
	async getPosition(target) {
		const location = await this.getLocation(target);
		return location ? { x: location.x, y: location.y, z: location.z } : null;
	}

	// 获取维度方法
	// 返回 dimension: string or null
	async getDimension(target) {
		const location = await this.getLocation(target);
		return location?.dimension;
	}

	// 获取物品栏方法
	async getInventory(target) {
		try {
			const data = await this.runCommand(`codebuilder_actorinfo inventory ${target}`);
			return data?.body?.inventory;
		} catch {}
	}

	// 获取本地玩家方法
	// 返回 localPlayerName: string
	async getLocolPlayer() {
		try {
			const data = await this.runCommand("getlocolplayername");
			return data?.body?.localplayername;
		} catch {}
	}

	// 关闭聊天框方法
	// 返回 status: boolean
	async closechat() {
		try {
			const data = await this.runCommand("getlocolplayername");
			return data?.body ? data.body.statusCode === 0 : false;
		} catch {}
	}

	// 接收消息方法
	onMessage(data) {
		// 获取包类型 purpose
		const purpose = data?.header?.messagePurpose;

		// 过滤非法包
		if (!purpose) return;

		// 调试记录信息
		if (track) shared.logger.debug(`Client -> Server ${JSON.stringify(data)}`);

		// 将包直接发送给 packageBack 中存储的 callback 函数
		// 遍历到列表
		for (const callback of this.packageBack.values()) {
			// 直接调用
			// 用 try - catch 防止影响后续
			try {
				callback(data);
			} catch (e) {
				// 错误调试记录
				shared.logger.error("总返回包 Callback 函数错误");
				if (track) shared.logger.debug(e.message);
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
					shared.logger.error("订阅返回包 Callback 函数错误");
					if (track) shared.logger.debug(e.message);
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
				shared.logger.error("命令返回包 Callback 函数错误");
				if (track) shared.logger.debug(e.message);
			}

			// 直接删除 this.commandBack Map 中的元素
			this.commandBack.delete(uuid);
		}
	}

	// 销毁方法
	destroy() {
		// 清除 this.client 引用
		this.client = null;
		// 清空三个 Map
		this.commandBack.clear();
		this.subscribeBack.clear();
		this.packageBack.clear();
	}
}

module.exports = Utils;