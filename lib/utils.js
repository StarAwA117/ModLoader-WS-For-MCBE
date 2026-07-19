const shared = require("./shared");
const { v4: uuidv4 } = require("uuid");
const { track } = require("../config");
const { OPEN: wsOPEN } = require("ws");

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
		client.runCommand = this.runCommand.bind(this);
		client.subscribe = this.subscribe.bind(this);
		client.tellAll = this.tellAll.bind(this);
		client.tell = this.tell.bind(this);

		// 各种操作的返回 Map
		this.commandBack = new Map();
		this.subscribeBack = new Map();
		this.packageBack = new Map();
	}

	// 调试发包记录
	sendLog(message, error=null) {
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

	// 不安全的执行命令方法
	runCommandUnsafe(command, callback = null) {
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
		}

		// 发送命令
		this.client.send(JSON.stringify(cmd), (error) => {
			// 如有返回函数 将其存储到 commandBack Map
			// uuid 作为唯一标识符
			if (!error && callback) this.commandBack.set(uuid, callback);
			this.sendLog(JSON.stringify(cmd), error);
		});
	}

	// 较安全的执行命令方法
	runCommand(command, callback = null) {
		// 过滤非法 command 与 非 null 下的非法 callback
		if (typeof command !== "string" || (callback && typeof callback !== "function")) return false;
		// 如果没有 client 客户端或未开启则直接返回
		if (!this.client || this.client.readyState !== wsOPEN) return false;
		// 检测 command 内容是否大于等于 462
		// 原因：当发送 command 内容大于等于 462 的包时，游戏会返回 Block 错误并退出房间
		if (Buffer.byteLength(command, "utf8") >= 462) return false;

		// 执行 runCommandUnsafe 方法
		this.runCommandUnsafe(command, callback);
		return true;
	}

	// 订阅事件方法
	subscribe(event, callback = null) {
		// 过滤非法 event 与 非 null 下的非法 callback
		if (typeof event !== "string" || (callback && typeof callback !== "function")) return false;
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
			this.sendLog(JSON.stringify(sub), error);
		});
	}

	// 取消订阅事件方法
	unsubscribe(event) {
		// 过滤非法 event
		if (typeof event !== "string") return false;
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
			this.sendLog(JSON.stringify(unsub), error);
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
			this.runCommand(`me ${m}`);
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
			this.runCommand(`tellraw ${current} ${JSON.stringify(sendObject)}`);
		});
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