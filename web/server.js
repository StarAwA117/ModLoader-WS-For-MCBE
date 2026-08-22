import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { config, reloadConfig, eventBus, ServerModManager, ClientModManager, modRegistry } from "../lib/mods.js";
import Current from "../lib/current.js";
import PermissionManager from "../lib/permission.js";
import Command from "../lib/command.js";
import { logger } from "../lib/logger.js";
import { collectCommands as collectTerminalCommands } from "../lib/readline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "frontend", "dist");
const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");

const WEB_PORT = config.web?.port || 18889;
const authConfig = config.web?.auth || {};
const AUTH_PASSWORD = authConfig.password || crypto.randomBytes(8).toString("hex");
const AUTH_MAX_ATTEMPTS = authConfig.maxAttempts || 3;
const AUTH_WINDOW_MS = authConfig.windowMs || 60000;
const AUTH_LOCKOUT_MS = authConfig.lockoutMs || 60000;

let logBuffer = [];
const LOG_BUFFER_MAX = 500;

const originalLog = logger.log.bind(logger);
logger.log = function (message, type) {
	originalLog(message, type);
	if (type && ["info", "warning", "error", "debug"].includes(type)) {
		const entry = { time: Date.now(), type, message };
		logBuffer.push(entry);
		if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
	}
};

// --- Auth rate limiting ---
const authAttempts = new Map();

function getAuthState(ip) {
	const now = Date.now();
	let state = authAttempts.get(ip);
	if (!state) {
		state = { attempts: [], lockedUntil: 0 };
		authAttempts.set(ip, state);
	}
	state.attempts = state.attempts.filter(t => now - t < AUTH_WINDOW_MS);
	if (state.lockedUntil && now > state.lockedUntil) {
		state.lockedUntil = 0;
		state.attempts = [];
	}
	return state;
}

function checkAuth(ip, password) {
	const state = getAuthState(ip);
	if (state.lockedUntil && Date.now() < state.lockedUntil) {
		const waitSec = Math.ceil((state.lockedUntil - Date.now()) / 1000);
		logger.warning(`WebUI 登录锁定中: IP=${ip}, 剩余 ${waitSec}s`);
		return { ok: false, locked: true, waitSec };
	}
	if (password !== AUTH_PASSWORD) {
		state.attempts.push(Date.now());
		logger.warning(`WebUI 登录失败: IP=${ip} (已尝试 ${state.attempts.length}/${AUTH_MAX_ATTEMPTS})`);
		if (state.attempts.length >= AUTH_MAX_ATTEMPTS) {
			state.lockedUntil = Date.now() + AUTH_LOCKOUT_MS;
			logger.error(`WebUI 登录锁定: IP=${ip} 已被锁定 ${AUTH_LOCKOUT_MS / 1000}s`);
			return { ok: false, locked: true, waitSec: Math.ceil(AUTH_LOCKOUT_MS / 1000) };
		}
		return { ok: false, locked: false, remaining: AUTH_MAX_ATTEMPTS - state.attempts.length };
	}
	state.attempts = [];
	state.lockedUntil = 0;
	return { ok: true };
}

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
		connectedAt: ws._connectedAt || Date.now(),
		localPlayerName: ws.localPlayerName || null
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
			"Access-Control-Allow-Headers": "Content-Type, X-Auth-Token"
		});
		res.end();
		return;
	}

	// Login endpoint (no auth required)
	if (pathname === "/api/login" && method === "GET") {
		const password = url.searchParams.get("pwd") || "";
		const ip = req.socket.remoteAddress || "未知";
		const result = checkAuth(ip, password);
		if (result.ok) {
			logger.info(`WebUI 登录成功: IP=${ip}`);
			return json(res, { ok: true, token: AUTH_PASSWORD });
		}
		return json(res, { ok: false, locked: result.locked, remaining: result.remaining, waitSec: result.waitSec }, 401);
	}

	// Auth check for all other API routes
	const token = req.headers["x-auth-token"];
	if (token !== AUTH_PASSWORD) {
		return json(res, { ok: false, message: "未授权" }, 401);
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
		if (permMatch && method === "POST") {
			const [, group, player] = permMatch;
			const r = PermissionManager.add(group, decodeURIComponent(player));
			if (r instanceof Error) throw r;
			return json(res, { ok: true });
		}
		if (permMatch && method === "DELETE") {
			const [, group, player] = permMatch;
			const r = PermissionManager.remove(group, decodeURIComponent(player));
			if (r instanceof Error) throw r;
			return json(res, { ok: true });
		}

		// Mods
		if (pathname === "/api/mods" && method === "GET") {
			const allMods = modRegistry.list();
			const serverMods = allMods.filter(m => m.entry.server).map(m => ({
				name: m.name, description: m.description, version: m.version, author: m.author,
				enabled: m.enabled, hasConfig: m.hasConfig, hasReadme: m.hasReadme, entry: m.entry
			}));
			const clientMods = allMods.filter(m => m.entry.client).map(m => ({
				name: m.name, description: m.description, version: m.version, author: m.author,
				enabled: m.enabled, hasConfig: m.hasConfig, hasReadme: m.hasReadme, entry: m.entry
			}));
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

		// Mod enable/disable
		const modEnableMatch = pathname.match(/^\/api\/mods\/(.+)\/enable$/);
		if (modEnableMatch && method === "POST") {
			const modEntry = modRegistry.list().find(m => m.name === modEnableMatch[1]);
			if (!modEntry) return json(res, { ok: false, message: "模组未找到" }, 404);
			const r = modRegistry.enable(modEntry.id);
			if (r.ok) {
				try {
					if (modEntry.entry.server) {
						const sm = ServerModManager._inst();
						if (sm) await sm.reload(modEntry.name);
					}
					if (modEntry.entry.client) {
						const ts = Date.now();
						const modPath = path.join(modEntry.path, modEntry.entry.client);
						const modModule = await import(`${modPath}?t=${ts}`);
						if (modModule.default) {
							modEntry.clientClass = modModule.default;
							ClientModManager.loadedMod[modEntry.name] = modModule.default;
							for (const [, mgr] of Current.clientMods) {
								if (!mgr || mgr.modInstances[modEntry.name]) continue;
								try { mgr._instantiateMod(modEntry.name, modModule.default); mgr._collectCommands(); } catch {}
							}
						}
					}
				} catch (e) { logger.error(`Mod ${modEntry.name} 启用热加载失败: ${e.message}`); }
			}
			collectTerminalCommands(ServerModManager, ClientModManager);
			return json(res, r);
		}
		const modDisableMatch = pathname.match(/^\/api\/mods\/(.+)\/disable$/);
		if (modDisableMatch && method === "POST") {
			const modEntry = modRegistry.list().find(m => m.name === modDisableMatch[1]);
			if (!modEntry) return json(res, { ok: false, message: "模组未找到" }, 404);
			if (modEntry.entry.server) {
				const sm = ServerModManager._inst();
				if (sm?.modInstances[modEntry.name]) {
					const dm = sm._resolveMethod(sm.modInstances[modEntry.name], "onDestroy") || sm._resolveMethod(sm.modInstances[modEntry.name], "destroy");
					if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
					eventBus.clearMod(modEntry.name);
					delete sm.modInstances[modEntry.name];
					delete ServerModManager.loadedMod[modEntry.name];
				}
			}
			if (modEntry.entry.client) {
				for (const [, mgr] of Current.clientMods) {
					if (mgr?.modInstances[modEntry.name]) {
						const dm = mgr._resolveModMethod(mgr.modInstances[modEntry.name], "onDestroy") || mgr._resolveModMethod(mgr.modInstances[modEntry.name], "destroy");
						if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
						if (mgr.sapi && typeof mgr.sapi.clearMod === "function") mgr.sapi.clearMod(modEntry.name);
						if (mgr.client.utils && typeof mgr.client.utils.removeOwner === "function") mgr.client.utils.removeOwner(modEntry.name);
						delete mgr.modInstances[modEntry.name];
						delete ClientModManager.loadedMod[modEntry.name];
						mgr.client[modEntry.name] = null;
						mgr._collectCommands();
					}
				}
			}
			const r = modRegistry.disable(modEntry.id);
			collectTerminalCommands(ServerModManager, ClientModManager);
			return json(res, r);
		}

		// Mod hot reload
		const modReloadMatch = pathname.match(/^\/api\/mods\/(.+)\/reload$/);
		if (modReloadMatch && method === "POST") {
			const modEntry = modRegistry.list().find(m => m.name === modReloadMatch[1]);
			if (!modEntry) return json(res, { ok: false, message: "模组未找到" }, 404);
			const results = { server: null, client: null };
			if (modEntry.entry.server) {
				const sm = ServerModManager._inst();
				results.server = sm ? await sm.reload(modEntry.name) : { success: false, message: "服务端 Mod 管理器未初始化" };
			}
			if (modEntry.entry.client) {
				const successes = [], faileds = [];
				for (const [, mgr] of Current.clientMods) {
					if (!mgr || typeof mgr.reload !== "function") continue;
					const r = await mgr.reload(modEntry.name);
					r.success ? successes.push("ok") : faileds.push("fail");
				}
				results.client = { success: successes.length, failed: faileds.length };
			}
			collectTerminalCommands(ServerModManager, ClientModManager);
			return json(res, { ok: true, results });
		}

		// Mod config
		const modConfigMatch = pathname.match(/^\/api\/mods\/(.+)\/config$/);
		if (modConfigMatch && method === "GET") {
			const modEntry = modRegistry.list().find(m => m.name === modConfigMatch[1]);
			if (!modEntry) return json(res, { ok: false, message: "模组未找到" }, 404);
			const configPath = path.join(modEntry.path, "config.json");
			const examplePath = path.join(modEntry.path, "config.example.json");
			if (!fs.existsSync(configPath) && !fs.existsSync(examplePath)) {
				return json(res, { ok: false, message: "该模组没有配置文件" }, 404);
			}
			let modConfig = {};
			if (fs.existsSync(configPath)) {
				modConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			}
			return json(res, { ok: true, config: modConfig });
		}
		if (modConfigMatch && method === "PUT") {
			const modEntry = modRegistry.list().find(m => m.name === modConfigMatch[1]);
			if (!modEntry) return json(res, { ok: false, message: "模组未找到" }, 404);
			const body = await readBody(req);
			const newConfig = JSON.parse(body);
			const configPath = path.join(modEntry.path, "config.json");
			fs.writeFileSync(configPath, JSON.stringify(newConfig, null, "\t") + "\n", "utf-8");
			return json(res, { ok: true, message: "配置已保存" });
		}

		// Mod manifest
		const modManifestMatch = pathname.match(/^\/api\/mods\/(.+)\/manifest$/);
		if (modManifestMatch && method === "GET") {
			const modEntry = modRegistry.list().find(m => m.name === modManifestMatch[1]);
			if (!modEntry) return json(res, { ok: false, message: "模组未找到" }, 404);
			const manifestPath = path.join(modEntry.path, "manifest.json");
			if (!fs.existsSync(manifestPath)) return json(res, { ok: false, message: "清单文件不存在" }, 404);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			return json(res, { ok: true, manifest });
		}

		// Mod README
		const modReadmeMatch = pathname.match(/^\/api\/mods\/(.+)\/readme$/);
		if (modReadmeMatch && method === "GET") {
			const modEntry = modRegistry.list().find(m => m.name === modReadmeMatch[1]);
			if (!modEntry) return json(res, { ok: false, message: "模组未找到" }, 404);
			const readmePath = path.join(modEntry.path, "README.md");
			if (!fs.existsSync(readmePath)) return json(res, { ok: false, message: "无 README 文件" });
			const readme = fs.readFileSync(readmePath, "utf-8");
			return json(res, { ok: true, readme });
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
			const isCustom = config.web?.auth?.password;
			const source = isCustom ? "配置文件" : "随机生成";
			logger.info(`WebUI 已启动: http://127.0.0.1:${WEB_PORT}/login?pwd=${AUTH_PASSWORD} [${source}]`);
			resolve();
		});
	});
}

export default { startWebServer };
