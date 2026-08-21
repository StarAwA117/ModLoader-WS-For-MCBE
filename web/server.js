import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config, reloadConfig, eventBus, ServerModManager, ClientModManager } from "../lib/mods.js";
import Current from "../lib/current.js";
import PermissionManager from "../lib/permission.js";
import Command from "../lib/command.js";
import * as shared from "../lib/shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "frontend", "dist");
const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");

const WEB_PORT = config.web?.port || 18889;
let logBuffer = [];
const LOG_BUFFER_MAX = 500;

const originalLog = shared.logger.log.bind(shared.logger);
shared.logger.log = function (message, type) {
	originalLog(message, type);
	if (type && ["info", "warning", "error", "debug"].includes(type)) {
		const entry = { time: Date.now(), type, message };
		logBuffer.push(entry);
		if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
	}
};

function json(res, obj, status = 200) {
	if (res.headersSent) return;
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*"
	});
	res.end(JSON.stringify(obj));
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (c) => { body += c; });
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function getClientInfo(ws) {
	return {
		id: ws.id,
		ip: ws._socket?.remoteAddress || "未知",
		isMain: ws === Current.client,
		connectedAt: ws._connectedAt || Date.now()
	};
}

const startTime = Date.now();

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff"
};

function serveStatic(res, filePath) {
	if (!fs.existsSync(filePath)) {
		const indexPath = path.join(DIST_DIR, "index.html");
		if (fs.existsSync(indexPath)) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			fs.createReadStream(indexPath).pipe(res);
		} else {
			res.writeHead(404);
			res.end("Not Found");
		}
		return;
	}
	const ext = path.extname(filePath);
	const mime = MIME_TYPES[ext] || "application/octet-stream";
	res.writeHead(200, { "Content-Type": mime });
	fs.createReadStream(filePath).pipe(res);
}

async function handleAPI(req, res, url) {
	const method = req.method;
	const pathname = url.pathname;

	if (method === "OPTIONS") {
		res.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type"
		});
		res.end();
		return;
	}

	try {
		// Status
		if (pathname === "/api/status" && method === "GET") {
			const clients = [];
			for (const [ws] of Current.clientMods) clients.push(getClientInfo(ws));
			return json(res, {
				server: { uptime: Date.now() - startTime, wsPort: config.ws.port, name: config.ws.name, webPort: WEB_PORT },
				connections: { count: Current.clientMods.size, mainClient: Current.client?.id || null, clients },
				mods: { server: Object.keys(ServerModManager.loadedMod || {}), client: Object.keys(ClientModManager.loadedMod || {}) },
				sapi: { commandExists: Current.client?.clientMod?.sapi?.commandExists ?? null, polling: Current.client?.clientMod?.sapi?.polling ?? false },
				properties: Current.properties
			});
		}

		// Config
		if (pathname === "/api/config" && method === "GET") {
			const cfg = JSON.parse(JSON.stringify(config));
			if (cfg.ai?.options?.apiKey) cfg.ai.options.apiKey = "***";
			return json(res, cfg);
		}
		if (pathname === "/api/config" && method === "PUT") {
			const body = await readBody(req);
			const newCfg = JSON.parse(body);
			fs.writeFileSync(CONFIG_PATH, JSON.stringify(newCfg, null, "\t") + "\n", "utf-8");
			reloadConfig();
			return json(res, { ok: true, message: "配置已保存" });
		}

		// Permissions
		if (pathname === "/api/permissions" && method === "GET") {
			const perm = await PermissionManager.get();
			return json(res, perm);
		}
		if (pathname === "/api/permissions" && method === "PUT") {
			const body = await readBody(req);
			const perm = JSON.parse(body);
			const result = await PermissionManager.set(perm);
			if (result instanceof Error) throw result;
			return json(res, { ok: true });
		}
		const permMatch = pathname.match(/^\/api\/permissions\/(owner|op|user|blocker)\/(.+)$/);
		if (permMatch && method === "DELETE") {
			const [, group, player] = permMatch;
			const r = await PermissionManager.remove(group, decodeURIComponent(player));
			if (r instanceof Error) throw r;
			return json(res, { ok: true });
		}

		// Mods
		if (pathname === "/api/mods" && method === "GET") {
			const serverMods = Object.keys(ServerModManager.loadedMod || {}).map(name => ({ name, type: "server" }));
			const clientMods = Object.keys(ClientModManager.loadedMod || {}).map(name => ({ name, type: "client" }));
			return json(res, { server: serverMods, client: clientMods });
		}
		if (pathname === "/api/mods/reload-all" && method === "POST") {
			reloadConfig();
			const serverResult = await ServerModManager.reloadAll();
			const clientResult = await ClientModManager.reloadAllClients();
			return json(res, {
				ok: true,
				server: { success: serverResult.success, failed: serverResult.failed },
				client: { success: clientResult.success.length, failed: clientResult.failed }
			});
		}

		// Commands
		if (pathname === "/api/commands" && method === "GET") {
			const cmds = [];
			if (Current.client?.clientMod) {
				const cm = Current.client.clientMod;
				for (const level of ["normal", "user", "op", "owner"]) {
					for (const cmd of (cm.commands[level] || [])) {
						cmds.push({
							name: `${Command.commandPrefix}${cmd.name}`,
							description: cmd.description,
							level,
							params: cmd.parameters.map(p => ({ type: typeof p[0] === "object" ? "enum" : p[0], desc: p[1], optional: p[2] }))
						});
					}
				}
			}
			return json(res, cmds);
		}
		if (pathname === "/api/command" && method === "POST") {
			const body = await readBody(req);
			const { command } = JSON.parse(body);
			if (!command) throw new Error("命令不能为空");
			if (!Current.client) throw new Error("主客户端未连接");
			const result = await Current.client.runCommand(command);
			return json(res, { ok: true, result });
		}

		// Clients
		if (pathname === "/api/clients" && method === "GET") {
			const clients = [];
			for (const [ws] of Current.clientMods) clients.push(getClientInfo(ws));
			return json(res, clients);
		}
		const clientTellMatch = pathname.match(/^\/api\/clients\/(.+)\/tell$/);
		if (clientTellMatch && method === "POST") {
			const clientId = clientTellMatch[1];
			const body = await readBody(req);
			const { message } = JSON.parse(body);
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) { ws.tell(message); return json(res, { ok: true }); }
			}
			return json(res, { ok: false, message: "客户端未找到" }, 404);
		}
		const clientMoveMatch = pathname.match(/^\/api\/clients\/(.+)\/set-main$/);
		if (clientMoveMatch && method === "POST") {
			const clientId = clientMoveMatch[1];
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) { Current.client = ws; return json(res, { ok: true }); }
			}
			return json(res, { ok: false, message: "客户端未找到" }, 404);
		}

		// Logs
		if (pathname === "/api/logs" && method === "GET") {
			const logName = url.searchParams.get("name") || "app";
			const lines = parseInt(url.searchParams.get("lines") || "200", 10);
			const logPath = path.resolve(__dirname, "..", "logs", `${logName}.log`);
			if (!fs.existsSync(logPath)) return json(res, { lines: [] });
			const content = fs.readFileSync(logPath, "utf-8");
			return json(res, { lines: content.split("\n").filter(Boolean).slice(-lines) });
		}
		if (pathname === "/api/logs/live" && method === "GET") {
			return json(res, { lines: logBuffer.slice(-100) });
		}

		// Chat
		if (pathname === "/api/chat" && method === "GET") {
			const logPath = path.resolve(__dirname, "..", "logs", "message.log");
			if (!fs.existsSync(logPath)) return json(res, { lines: [] });
			const content = fs.readFileSync(logPath, "utf-8");
			return json(res, { lines: content.split("\n").filter(Boolean).slice(-100) });
		}
		if (pathname === "/api/chat" && method === "POST") {
			const body = await readBody(req);
			const { message } = JSON.parse(body);
			if (!Current.client) throw new Error("主客户端未连接");
			Current.client.tellAll(message);
			return json(res, { ok: true });
		}

		// System
		if (pathname === "/api/system/process" && method === "GET") {
			const mem = process.memoryUsage();
			return json(res, { pid: process.pid, uptime: process.uptime(), memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal }, nodeVersion: process.version, platform: process.platform });
		}

		json(res, { error: "Not Found" }, 404);
	} catch (e) {
		json(res, { ok: false, message: e.message }, 400);
	}
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, "http://127.0.0.1");
	if (url.pathname.startsWith("/api/")) {
		handleAPI(req, res, url);
		return;
	}
	let filePath = path.join(DIST_DIR, url.pathname);
	if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
	serveStatic(res, filePath);
});

export function startWebServer() {
	return new Promise((resolve) => {
		server.listen(WEB_PORT, "0.0.0.0", () => {
			shared.logger.info(`WebUI 服务器已启动: http://0.0.0.0:${WEB_PORT}`);
			resolve();
		});
	});
}

export default { startWebServer };
