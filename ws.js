const WebSocket = require("ws");
const shared = require("./lib/shared.js");
const { wsConfig, track } = require("./config.js");
const Utils = require("./lib/utils.js");
const Player = require("./lib/player.js");
const Current = require("./lib/current.js");
const { ClientModManager, ServerModManager } = require("./lib/mods.js");

// 创建 WebSocket 服务端，监听端口 wsConfig.port
const server = new WebSocket.Server({
	port: wsConfig.port
});

// 加载服务端 Mod 和客户端 Mod 的静态定义
ServerModManager.load();
ClientModManager.load();
shared.logger.info("服务器已启动");

// 处理客户端连接
server.on("connection", (ws) => {
	// 为当前客户端绑定工具方法（runCommand, subscribe, tell 等）
	ws.utils = new Utils(ws);
	// 实例化客户端 Mod，注入当前连接
	const clientMod = new ClientModManager(ws);
	// 初始化 Player 记录
	Player.init(ws);
	// 广播连接通知
	ws.tellAll(`§a${wsConfig.name} §f已连接`);

	// 记录第一个连接的客户端为主客户端
	if (!Current.client) {
		Current.client = ws;
		shared.logger.info("主客户端已连接");
	}

	// 处理客户端消息
	ws.on("message", (message) => {
		try {
			// 将消息解析为 JSON 后分发给工具类处理
			const data = JSON.parse(String(message));
			ws.utils.onMessage(data);
		} catch {
			// 解析失败则忽略（非 JSON 消息）
			return;
		}
	});

	// 处理客户端断开连接
	ws.on("close", () => {
		// 若为主客户端断开，重置主客户端状态
		if (ws === Current.client) {
			Current.reset();
			shared.logger.info("主客户端连接已关闭");
		}

		// 销毁该客户端的所有 Mod 实例
		clientMod.destroy();
		// 清除 Player 记录
		Player.destroyAll(ws);

		// 移除所有事件监听器，防止内存泄漏
		ws.removeAllListeners();
	});

	// 处理客户端错误
	ws.on("error", (error) => {
		if (ws === Current.client) {
			shared.logger.error("主客户端错误");
			if (track) shared.logger.debug(error.message);
		}
	});
});

// 服务端错误处理
server.on("error", (error) => {
	shared.logger.error("服务器错误");
	if (track) shared.logger.debug(error.message);
});

// 关闭函数
// 依次销毁 Mod、关闭 WebSocket 服务端
function destroy() {
	shared.logger.info("正在关闭服务端 Mod...");
	ServerModManager.destroy();

	shared.logger.info("正在关闭服务器...");

	// 返回 Promise，5 秒超时后强制拒绝
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			shared.logger.warning("服务器关闭失败");
			reject(new Error("服务器关闭失败"))
		}, 5000);

		server.close(() => {
			clearTimeout(timer);
			shared.logger.info("服务器已关闭");
			resolve("服务器已关闭");
		});
	});
}

// 信号处理：收到 SIGINT 时关闭
process.on("SIGINT", async () => {
	// 仅在直接运行此文件时处理（避免被 loader 引入时重复执行）
	if (require.main === module) {
		// 通知所有已连接客户端并强制断开
		server.clients.forEach((client) => {
			client.tellAll(`§c${wsConfig.name} §f关闭连接`);
			client.sendCommand("/closewebsocket");
			client.close();
		});

		await destroy();

		shared.logger.info("程序进程结束");
		process.exit(0);
	}
});

module.exports = { destroy }
