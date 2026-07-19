const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const Command = require("../lib/command");

// 扩展 WebSocket 连接类
// 允许客户端同时连接到多个外部 WebSocket 服务端，实现消息的双向转发
class MoreWS {
	// 构造函数
	constructor(client) {
		// 用于存储客户端
		this.client = client;
		// 用于存储连接的外部 WebSocket 实例
		this.wss = new Set();
		// 用于存储包订阅的 UUID，便于销毁时取消订阅
		this.packageUUID = null;

		// 调用包处理方法
		this.onPackage();
	}

	// 用于获取 commands
	commands() {
		return {
			op: [
				Command.create("c:connect", "Connect 操作 - 连接")
				.addString("WebSocket IP")
				.setFunc((_, ip) => {
					this.connect(ip);
				})
			]
		};
	}

	// 连接函数
	connect(url) {
		// 若没有协议头，自动添加 ws:// 头
		if (!(url.startsWith("ws://") || url.startsWith("wss://"))) url = "ws://" + url;

		// 连接与操作 ws
		// 放入 try - catch 防报错
		try {
			// 连接 ws 服务端
			const ws = new WebSocket(url);

			// 检测 ws 连接
			ws.on("open", () => {
				// 发送消息
				this.client.tellAll("§eMoreWS §f已连接");
				// 添加 ws
				this.wss.add(ws);
			});

			// 检测 ws 传来的消息
			ws.on("message", (message) => {
				// 处理
				let msg = message;

				try {
					msg = String(msg);
				} catch {}

				// 直接发送给客户端
				this.client.send(msg);
			});

			// 检测 ws 是否关闭
			ws.on("close", (code, reason) => {
				// 提示
				this.client.tellAll(`§cMoreWS §f已关闭 -> ${url}`);
				// 删除 ws
				if (this.wss.has(ws)) this.wss.delete(ws);
			});

			// ws 错误
			ws.on("error", (error) => {
				// 提示
				this.client.tellAll(`§cMoreWS Error: §f${error.message}`);
				// 删除连接
				if (this.wss.has(ws)) this.wss.delete(ws);
			});
		} catch (e) {
			// 提示连接失败
			this.client.tellAll(`§cMoreWS §f连接失败 ${e}`);
		}
	}

	// 获取并处理来自客户端的所有包
	onPackage() {
		// 生成唯一 UUID 用于包订阅标识
		this.packageUUID = uuidv4();

		// 订阅客户端发出的所有包
		this.client.utils.subscribePackage(this.packageUUID, msg => {
			// 将 msg 由 JSON 对象转为字符串
			let str;
			try {
				str = JSON.stringify(msg);
			} catch {
				str = String(msg);
			}

			// 遍历所有外部服务端
			this.wss.forEach(ws => {
				// 检测连接有效性
				if (ws && ws.readyState === WebSocket.OPEN) {
					// 转发消息
					ws.send(str);
				}
			});
		});
	}

	// 销毁方法
	destroy() {
		// 取消包订阅，防止内存泄漏
		if (this.packageUUID) {
			this.client.utils.unsubscribePackage(this.packageUUID);
			this.packageUUID = null;
		}

		// 遍历所有外部服务端连接
		this.wss.forEach((ws) => {
			// 强制断开连接
			ws.terminate();
		});

		// 清空连接集合
		this.wss.clear();
	}
}

module.exports = MoreWS;
