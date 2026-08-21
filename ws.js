import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// 首次运行判定来自模板 config.example.js（永不缺失；config.js 只存储用户真实配置，不含 isFirstRun）
import { isFirstRun } from "./config.example.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_JS = path.join(ROOT, "config.js");
const CONFIG_EXAMPLE = path.join(ROOT, "config.example.js");
const WANT_RESET = process.argv.includes("--reset-all");

// ===== 依赖检测（必须早于任何第三方模块使用） =====
// ws / uuid 使用动态导入：静态 import 在模块解析阶段执行，依赖缺失会直接抛出
// ERR_MODULE_NOT_FOUND 导致进程崩溃、无法引导安装。动态导入可捕获该错误，
// 缺失时自动运行 setup.js 安装依赖，成功后继续启动。
// MCBE 兼容补丁（lib/patch-ws.js）需要 ws 已安装才能生效，因此也改为在依赖
// 检测通过后、ws 加载前执行，保证 patch 始终先于 ws 生效。
let WebSocket, WebSocketServer, uuidv4;
try {
	// 先加载 MCBE 兼容补丁（必须在 ws 加载之前替换 validation.isValidStatusCode）
	await import("./lib/patch-ws.js");
	({ default: WebSocket, WebSocketServer } = await import("ws"));
	({ v4: uuidv4 } = await import("uuid"));
} catch (error) {
	if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND") {
		console.log("========================================");
		console.log("  检测到缺少依赖，正在运行 setup.js 安装依赖...");
		console.log("========================================");
		const { spawnSync } = await import("child_process");
		const res = spawnSync(process.execPath, ["setup.js"], { cwd: ROOT, stdio: "inherit" });
		if (res.status !== 0) {
			console.error("依赖安装失败，请手动运行 node setup.js 排查");
			process.exit(1);
		}
		// 安装成功后重新加载（失败的 import 不会进入模块缓存，可重新解析）
		try {
			await import("./lib/patch-ws.js");
			({ default: WebSocket, WebSocketServer } = await import("ws"));
			({ v4: uuidv4 } = await import("uuid"));
		} catch (e2) {
			console.error(`依赖安装后仍无法加载: ${e2.message}`);
			process.exit(1);
		}
	} else {
		throw error;
	}
}

// ===== 引导阶段（必须早于下方任何依赖 config.js 的模块加载） =====
// 依赖 config.js 的模块（lib/logger.js、lib/utils.js、lib/mods.js 等）都是动态导入的，
// 因此 config.js 缺失时（如 --reset-all 之后）可先在此根据模板自动补全，保证程序可启动。
if (!WANT_RESET && !fs.existsSync(CONFIG_JS)) {
	const tpl = fs.readFileSync(CONFIG_EXAMPLE, "utf8");
	// config.js 只存真实配置：剔除模板携带的 isFirstRun 标记块
	const cfg = tpl.replace(/\/\/ ===== 首次运行 =====[\s\S]*?export const isFirstRun = (true|false);\r?\n(\r?\n)?/, "");
	fs.writeFileSync(CONFIG_JS, cfg, "utf8");
	console.log("未找到 config.js，已根据模板自动生成默认配置（可在向导中修改）");
}

// ===== 一键重置：node ws.js --reset-all =====
// 清除所有配置文件（不启动服务器）：删除 config.js / permission.json 及其 .bak 备份，
// 并将模板 config.example.js 的 isFirstRun 复位为 true，下次启动自动进入配置向导
if (WANT_RESET) {
	const files = ["config.js", "config.js.bak", "permission.json", "permission.json.bak"];
	const removed = [];
	for (const name of files) {
		const p = path.join(ROOT, name);
		if (fs.existsSync(p)) {
			fs.rmSync(p, { force: true });
			removed.push(name);
		}
	}
	// 复位模板标记，下次启动自动进入向导重新配置
	try {
		const src = fs.readFileSync(CONFIG_EXAMPLE, "utf8");
		const next = src.replace(/export const isFirstRun = (true|false);/, "export const isFirstRun = true;");
		if (next !== src) fs.writeFileSync(CONFIG_EXAMPLE, next, "utf8");
	} catch {
		// 模板不可写时静默忽略
	}
	console.log("========================================");
	console.log("  配置已重置");
	console.log("========================================");
	process.exit(0);
}

// ===== 动态加载依赖 config.js 的本地模块（此时 config.js 必然已存在） =====
// 保持与原来静态导入相同的变量名，后续代码无需改动
const shared = await import("./lib/shared.js");
const { closeLogStreams } = await import("./lib/logger.js");
const { wsConfig } = await import("./config.js");
const Utils = (await import("./lib/utils.js")).default;
const Current = (await import("./lib/current.js")).default;
const { ClientModManager, ServerModManager } = await import("./lib/mods.js");

// 首次运行检查：模板 config.example.js 的 isFirstRun 为 true 时启动图形化配置向导，
// 不启动 WebSocket 服务；配置保存后模板标记自动写为 false，重启服务器即正常启动
if (isFirstRun) {
	shared.logger.info("检测到首次运行，启动图形化配置向导...");
	const { startSetupServer } = await import("./lib/setup.js");
	try {
		await startSetupServer();
		shared.logger.info("配置已保存，请重新启动服务器以应用配置");
	} catch (error) {
		shared.logger.error(`配置向导异常: ${error.message}`);
		shared.logger.debug(error.stack);
	}
	closeLogStreams();
	process.exit(0);
}

// 创建 WebSocket 服务端，监听端口 wsConfig.port
const server = new WebSocketServer({
	port: wsConfig.port
});

// 立即注册错误监听，避免端口占用等错误在异步加载期间未被捕获
server.on("error", (error) => {
	shared.logger.error(`服务器错误: ${error.message}`);
	shared.logger.debug(error.stack);
});

// 加载服务端 Mod 和客户端 Mod 的静态定义
await ServerModManager.load();
await ClientModManager.load();
shared.logger.info("服务器已启动");

// 处理客户端连接
server.on("connection", (ws) => {
	// 获取客户端 IP
	const clientIP = ws._socket.remoteAddress;
	shared.logger.info(`客户端 ${clientIP} 已连接`);

	// 分配唯一 ID，用于客户端 Mod 存储和事件总线隔离
	ws.id = uuidv4();

	// 延迟初始化：MCBE 客户端建立 WebSocket 连接后需约 1 秒完成内部握手，
	// 若立即发送命令（权限检测 /list、SAPI 检测 /gmsg、订阅、欢迎消息等），
	// 客户端会主动断开并重连（表现为"每次启动都要断开一次才能连上"）。
	let clientMod = null;
	const initTimer = setTimeout(() => {
		// 延迟期间客户端可能已断开，检查连接状态
		if (ws.readyState !== WebSocket.OPEN) return;

		// 为当前客户端绑定工具方法（runCommand, subscribe, tell 等）
		ws.utils = new Utils(ws);

		// 记录第一个连接的客户端为主客户端
		const isMainClient = !Current.client;
		if (isMainClient) {
			Current.client = ws;
			shared.logger.info("主客户端已连接");
		}

		// 实例化客户端 Mod，注入当前连接
		clientMod = new ClientModManager(ws);
		ws.clientMod = clientMod;
		Current.clientMods.set(ws, clientMod);

		// 通知服务端 Mod 客户端已连接
		ServerModManager.onClientConnect(ws, isMainClient);

		// 广播连接通知
		ws.tell(`§e${wsConfig.name} | §fSystem > §i已连接`);
	}, 1000);

	// 处理客户端消息
	ws.on("message", (message) => {
		// 初始化完成前忽略客户端消息（客户端握手期间无业务消息）
		if (!ws.utils) return;

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
		// 取消待执行的延迟初始化
		clearTimeout(initTimer);

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
		if (clientMod) clientMod.destroy();

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
		client.tell(`§c${wsConfig.name} | §fSystem > §i已关闭连接`);
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
