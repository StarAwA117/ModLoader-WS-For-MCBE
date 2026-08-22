import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as shared from "./lib/shared.js";
import { closeLogStreams } from "./lib/logger.js";
import { config, ClientModManager, ServerModManager, modRegistry } from "./lib/mods.js";
import Utils from "./lib/utils.js";
import Current from "./lib/current.js";
import { startWebServer } from "./web/server.js";

// 如果 config.json 不存在则从 config.example.json 复制
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(__dirname, "config.json");
const configExamplePath = path.resolve(__dirname, "config.example.json");
if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
	fs.copyFileSync(configExamplePath, configPath);
	shared.logger.info("已从 config.example.json 初始化 config.json");
}

// 创建 WebSocket 服务端，监听端口 config.ws.port
const server = new WebSocketServer({
	port: config.ws.port
});

// 立即注册错误监听，避免端口占用等错误在异步加载期间未被捕获
server.on("error", (error) => {
	shared.logger.error(`服务器错误: ${error.message}`);
	shared.logger.debug(error.stack);
});

// 扫描并加载服务端 Mod 和客户端 Mod 的静态定义
modRegistry.scan();
await ServerModManager.load();
await ClientModManager.load();
shared.logger.info("服务器已启动");

// 启动 WebUI 服务器
startWebServer().catch(e => {
	shared.logger.error(`WebUI 启动失败: ${e.message}`);
});

// 处理客户端连接
server.on("connection", (ws) => {
	// 获取客户端 IP
	const clientIP = ws._socket.remoteAddress;
	shared.logger.info(`客户端 ${clientIP} 已连接`);

	// 分配唯一 ID，用于客户端 Mod 存储和事件总线隔离
	ws.id = uuidv4();

	// 为当前客户端绑定工具方法（runCommand, subscribe, tell 等）
	ws.utils = new Utils(ws);

	// 记录第一个连接的客户端为主客户端
	const isMainClient = !Current.client;
	if (isMainClient) {
		Current.client = ws;
		shared.logger.info("主客户端已连接");
	}

	// 实例化客户端 Mod，注入当前连接
	const clientMod = new ClientModManager(ws);
	ws.clientMod = clientMod;
	ws.localPlayerName = null;
	ws._connectedAt = Date.now();
	Current.clientMods.set(ws, clientMod);

	// 延迟获取 localPlayerName（等待客户端进入世界）
	setTimeout(async () => {
		try {
			const name = await ws.getLocalPlayer();
			if (name) ws.localPlayerName = name;
		} catch {}
	}, 3000);

	// 通知服务端 Mod 客户端已连接
	ServerModManager.onClientConnect(ws, isMainClient);

	// 广播连接通知
	ws.tell(`§e${config.ws.name} | §fSystem > §i已连接`);

	// 处理客户端消息
	ws.on("message", (message) => {
		// 仅 JSON 解析需捕获，非 JSON 消息直接忽略；
		// Mod 分发调用各自内部已有 try/catch，不应被外层吞掉，便于排查
		let data;
		try {
			data = JSON.parse(String(message));
		} catch {
			// 解析失败则忽略（非 JSON 消息）
			return;
		}

		// 将消息解析为 JSON 后分发给工具类处理
		ws.utils.onMessage(data);

		// 通知客户端 Mod 收到消息
		clientMod.callModMethod("onPocket", data);

		// 通知服务端 Mod 收到消息
		ServerModManager.onMessage(ws, data);
	});

	// 处理客户端断开连接
	ws.on("close", () => {
		shared.logger.info(`客户端 ${clientIP} 连接已关闭`);

		// 通知服务端 Mod 客户端已断开连接
		ServerModManager.onClientDisconnect(ws, ws === Current.client);

		// 若为主客户端断开，重置主客户端状态
		if (ws === Current.client) {
			Current.reset();
			shared.logger.info("主客户端连接已关闭");
		}

		// 销毁该客户端的所有 Mod 实例
		Current.clientMods.delete(ws);
		clientMod.destroy();

		// 清理工具类回调映射，防止内存泄漏
		if (ws.utils && typeof ws.utils.destroy === "function") {
			ws.utils.destroy();
		}

		// 移除所有事件监听器，防止内存泄漏
		ws.removeAllListeners();
	});

	// 处理客户端错误
	ws.on("error", (error) => {
		if (ws === Current.client) {
			shared.logger.error(`主客户端错误: ${error.message}`);
			shared.logger.debug(error.stack);
		}
	});
});

// 关闭函数
// 依次销毁 Mod、关闭 WebSocket 服务端
// 防重入：重复调用（如多次 SIGINT）直接忽略，避免反复启动 10s 硬超时
let destroying = false;
async function destroy() {
	if (destroying) return;
	destroying = true;

	shared.logger.info("正在关闭服务端 Mod...");
	ServerModManager.destroy();
	shared.logger.info("服务端 Mod 已关闭");

	shared.logger.info("正在通知客户端断开连接...");
	server.clients.forEach((client) => {
		client.tell(`§c${config.ws.name} | §fSystem > §i已关闭连接`);
		client.runCommand("/closewebsocket").catch(() => {});
		client.close();
	});
	shared.logger.info("客户端通知已完成");

	shared.logger.info("正在关闭服务器...");

	const hardTimeout = new Promise((_, reject) => {
		setTimeout(() => {
			shared.logger.warning("服务器关闭超时，强制退出");
			reject(new Error("服务器关闭超时"));
		}, 10000);
	});

	const close = new Promise((resolve) => {
		server.close(() => {
			shared.logger.info("服务器已关闭");
			resolve();
		});
	});

	try {
		await Promise.race([close, hardTimeout]);
	} catch {
		shared.logger.warning("服务器关闭异常，正在强制退出");
	}
}

// 信号处理
process.on("SIGINT", async () => {
	shared.logger.info("正在执行正常关闭...");
	await destroy();
	closeLogStreams();
	shared.logger.info("程序进程结束");
	process.exit(0);
});
