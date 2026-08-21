// lib/setup.js - 首次运行图形化配置向导
//
// 当模板 config.example.js 中 isFirstRun 为 true 时，ws.js 会调用 startSetupServer()：
// 1. 启动一个临时 HTTP 服务器（仅监听 127.0.0.1，不对外网开放）
// 2. 用户在浏览器中填写配置表单
// 3. 保存时基于 config.example.js 模板生成 config.js（剔除 isFirstRun 标记，
//    config.js 只存储用户真实配置），并将玩家权限写入 permission.json
//    （旧文件自动备份为 .bak）
// 4. 保存成功后关闭临时服务器，提示用户重启

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CONFIG_EXAMPLE = path.join(ROOT, "config.example.js");
const CONFIG_JS = path.join(ROOT, "config.js");
const PERMISSION_EXAMPLE = path.join(ROOT, "permission.example.json");
const PERMISSION_JSON = path.join(ROOT, "permission.json");

const SETUP_PORT_START = 18888;
const SETUP_PORT_MAX = 18899;
const LOG_LEVELS = ["debug", "info", "warning", "error"];

const json = (v) => JSON.stringify(v);
const bool = (v) => (v ? "true" : "false");
const num = (v) => Number(v);

/**
 * 生成单次替换规则：模式未命中时返回 null，命中则返回替换后的文本。
 * 注意：命中但结果与原文相同（用户填写值等于模板默认值）时也返回文本，
 * 表示替换“成功”，避免误报模板结构变更。
 * @param {string|RegExp} pattern
 * @param {(form: object) => string} build - 根据表单值构造替换文本
 * @returns {(src: string, form: object) => string|null}
 */
function makeRule(pattern, build) {
	return (s, f) => {
		if (typeof pattern === "string" ? !s.includes(pattern) : !pattern.test(s)) return null;
		return s.replace(pattern, build(f));
	};
}

// chat 与 command 的 model 字段按各自后面的 max_tokens 值精确定位（互不影响）
const CHAT_MODEL = /model: "deepseek-chat"(?=,\s*\n\s*thinking: \{\s*"type": "disabled"\s*\},\s*\n\s*max_tokens: 512)/;
const COMMAND_MODEL = /model: "deepseek-chat"(?=,\s*\n\s*thinking: \{\s*"type": "disabled"\s*\},\s*\n\s*max_tokens: 1024)/;

/**
 * 替换规则表：将 config.example.js 源文本中的默认值替换为用户填写值。
 * 注意：若模板结构发生变更，需同步更新这里的匹配模式。
 * @type {Array<{key: string, apply: (src: string, form: object) => string}>}
 */
const RULES = [
	{ key: "服务器名称", apply: makeRule('name: "ModLoader"', (f) => `name: ${json(f.name)}`) },
	{ key: "WebSocket 端口", apply: makeRule("port: 8080", (f) => `port: ${num(f.port)}`) },
	{ key: "命令前缀", apply: makeRule('export const commandPrefix = "!";', (f) => `export const commandPrefix = ${json(f.commandPrefix)};`) },
	{ key: "日志等级", apply: makeRule('export const logLevel = "info";', (f) => `export const logLevel = ${json(f.logLevel)};`) },
	{ key: "AI API Key", apply: makeRule('apiKey: ""', (f) => `apiKey: ${json(f.apiKey)}`) },
	{ key: "AI Base URL", apply: makeRule('baseURL: "https://api.deepseek.com"', (f) => `baseURL: ${json(f.baseURL)}`) },
	{ key: "对话模型", apply: makeRule(CHAT_MODEL, (f) => `model: ${json(f.chatModel)}`) },
	{ key: "指令模型", apply: makeRule(COMMAND_MODEL, (f) => `model: ${json(f.commandModel)}`) },
	{ key: "音乐打击乐", apply: makeRule("playPercussion: true", (f) => `playPercussion: ${bool(f.playPercussion)}`) },
	// qq 块的 enabled 后面紧跟 groupId，用它做上下文锚点，避免误匹配其他 enabled
	{ key: "QQ 启用", apply: makeRule(/enabled: (true|false)(?=,\s*\n\s*groupId)/, (f) => `enabled: ${bool(f.qqEnabled)}`) },
	{ key: "QQ 群号", apply: makeRule("groupId: 123456789", (f) => `groupId: ${num(f.qqGroupId)}`) },
	{ key: "QQ 主机", apply: makeRule('host: "127.0.0.1"', (f) => `host: ${json(f.qqHost)}`) },
	{ key: "QQ 端口", apply: makeRule("port: 3001", (f) => `port: ${num(f.qqPort)}`) },
	{ key: "QQ 访问令牌", apply: makeRule('accessToken: ""', (f) => `accessToken: ${json(f.qqToken)}`) }
	// 注意：config.js 不包含 isFirstRun 标记（判定仅存在于模板 config.example.js）
];

/**
 * 将逗号/换行分隔的玩家名文本解析为去重数组
 * @param {string} str
 * @returns {string[]}
 */
function splitList(str) {
	if (typeof str !== "string") return [];
	return [...new Set(str.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * 读取表单默认值：优先读取现有 config.js / permission.json（重新配置场景），
 * 不存在或损坏时回退到模板文件。
 * @returns {Promise<object>}
 */
async function loadDefaults() {
	let cfg = null;
	try {
		cfg = await import(pathToFileURL(CONFIG_JS).href);
	} catch {
		try {
			cfg = await import(pathToFileURL(CONFIG_EXAMPLE).href);
		} catch {
			cfg = {};
		}
	}

	let perm = {};
	try {
		perm = JSON.parse(fs.readFileSync(PERMISSION_JSON, "utf8"));
	} catch {
		try {
			perm = JSON.parse(fs.readFileSync(PERMISSION_EXAMPLE, "utf8"));
		} catch {
			perm = {};
		}
	}

	return {
		name: cfg.wsConfig?.name ?? "ModLoader",
		port: cfg.wsConfig?.port ?? 8080,
		commandPrefix: cfg.commandPrefix ?? "!",
		logLevel: cfg.logLevel ?? "info",
		apiKey: cfg.AIConfig?.options?.apiKey ?? "",
		baseURL: cfg.AIConfig?.options?.baseURL ?? "https://api.deepseek.com",
		chatModel: cfg.AIConfig?.models?.chat?.model ?? "deepseek-chat",
		commandModel: cfg.AIConfig?.models?.command?.model ?? "deepseek-chat",
		playPercussion: cfg.features?.music?.playPercussion ?? true,
		qqEnabled: cfg.features?.qq?.enabled ?? false,
		qqGroupId: cfg.features?.qq?.groupId ?? 123456789,
		qqHost: cfg.features?.qq?.host ?? "127.0.0.1",
		qqPort: cfg.features?.qq?.port ?? 3001,
		qqToken: cfg.features?.qq?.accessToken ?? "",
		owner: perm.owner ?? "YourXboxName",
		op: Array.isArray(perm.op) ? perm.op : [],
		user: Array.isArray(perm.user) ? perm.user : [],
		blocker: Array.isArray(perm.blocker) ? perm.blocker : []
	};
}

/**
 * 校验表单数据
 * @param {object} f
 * @returns {string|null} 错误信息或 null
 */
function validate(f) {
	if (!f || !String(f.name || "").trim()) return "服务器名称不能为空";
	const port = Number(f.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) return "WebSocket 端口必须是 1-65535 的整数";
	if (!LOG_LEVELS.includes(f.logLevel)) return "日志等级无效";
	return null;
}

/**
 * 将模板 config.example.js 的 isFirstRun 标记写为 false（配置保存成功后调用，
 * 避免下次启动重复进入向导）。模板不可写时静默忽略，不影响主流程。
 */
function clearFirstRunFlag() {
	try {
		const tpl = fs.readFileSync(CONFIG_EXAMPLE, "utf8");
		const next = tpl.replace(/export const isFirstRun = (true|false);/, "export const isFirstRun = false;");
		if (next !== tpl) fs.writeFileSync(CONFIG_EXAMPLE, next, "utf8");
	} catch {
		// 忽略：下次启动仍会进入向导，由用户手动处理
	}
}

/**
 * 基于模板生成 config.js 并写入 permission.json（均先备份旧文件）
 * @param {object} f - 表单数据
 */
function saveConfig(f) {
	let src;
	try {
		src = fs.readFileSync(CONFIG_EXAMPLE, "utf8");
	} catch {
		throw new Error("找不到模板文件 config.example.js");
	}

	for (const rule of RULES) {
		const next = rule.apply(src, f);
		if (next === null) {
			throw new Error(`模板匹配失败：${rule.key}（config.example.js 结构可能已变更）`);
		}
		src = next;
	}

	// config.js 只存储用户真实配置：剔除文件头注释与 isFirstRun 标记行
	src = src.replace(/^[\s\S]*?export const isFirstRun = (true|false);\r?\n(\r?\n)?/, "");

	if (fs.existsSync(CONFIG_JS)) {
		fs.copyFileSync(CONFIG_JS, CONFIG_JS + ".bak");
	}
	fs.writeFileSync(CONFIG_JS, src, "utf8");

	// 保存成功后把模板中的 isFirstRun 写为 false，下次启动正常进入服务
	clearFirstRunFlag();

	if (fs.existsSync(PERMISSION_JSON)) {
		fs.copyFileSync(PERMISSION_JSON, PERMISSION_JSON + ".bak");
	}
	const perm = {
		owner: String(f.owner || "").trim() || "YourXboxName",
		op: splitList(f.op),
		user: splitList(f.user),
		blocker: splitList(f.blocker)
	};
	fs.writeFileSync(PERMISSION_JSON, JSON.stringify(perm, null, 2) + "\n", "utf8");
}

function respond(res, obj) {
	res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
	res.end(json(obj));
}

// 配置向导页面（内嵌 JS 不使用反引号，避免与外层模板字符串冲突）
const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ModLoader 配置向导</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #1e1e2e; color: #cdd6f4; line-height: 1.6; padding: 24px; }
.container { max-width: 720px; margin: 0 auto; }
h1 { font-size: 26px; color: #89b4fa; margin-bottom: 4px; }
.sub { color: #a6adc8; font-size: 14px; margin-bottom: 20px; }
section { background: #313244; border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
section h2 { font-size: 16px; color: #f5c2e7; margin-bottom: 12px; border-bottom: 1px solid #45475a; padding-bottom: 8px; }
label { display: block; font-size: 13px; color: #a6adc8; margin: 10px 0 4px; }
input[type=text], input[type=number], input[type=password], select, textarea {
  width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #45475a;
  background: #1e1e2e; color: #cdd6f4; font-size: 14px;
}
textarea { min-height: 48px; resize: vertical; font-family: monospace; }
.checkbox-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
.checkbox-row input { width: auto; }
.checkbox-row label { margin: 0; font-size: 14px; color: #cdd6f4; }
button[type=submit] { width: 100%; padding: 12px; background: #89b4fa; color: #1e1e2e; font-size: 16px; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; margin-top: 8px; }
button[type=submit]:hover { background: #a6c8ff; }
#result { margin-top: 14px; padding: 12px 14px; border-radius: 8px; font-size: 14px; display: none; white-space: pre-line; }
#result.ok { background: #1a3a2a; color: #a6e3a1; border: 1px solid #3d6b4f; }
#result.err { background: #3a1a1a; color: #f38ba8; border: 1px solid #6b3d3d; }
.hint { font-size: 12px; color: #7f849c; margin-top: 4px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="container">
<h1>⚙️ ModLoader 配置向导</h1>
<p class="sub">首次运行配置。填写完成后点击「保存配置」，将生成 config.js 与 permission.json。</p>
<form id="cfg">
  <section>
    <h2>基础设置</h2>
    <div class="grid">
      <div><label for="name">服务器名称</label><input id="name" name="name" type="text"></div>
      <div><label for="port">WebSocket 端口</label><input id="port" name="port" type="number" min="1" max="65535"></div>
    </div>
    <div class="grid">
      <div><label for="commandPrefix">命令前缀</label><input id="commandPrefix" name="commandPrefix" type="text" maxlength="4"></div>
      <div><label for="logLevel">日志等级</label>
        <select id="logLevel" name="logLevel">
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="error">error</option>
        </select>
      </div>
    </div>
  </section>

  <section>
    <h2>AI 设置</h2>
    <label for="apiKey">API Key</label>
    <input id="apiKey" name="apiKey" type="password" placeholder="sk-..." autocomplete="off">
    <label for="baseURL">Base URL</label>
    <input id="baseURL" name="baseURL" type="text">
    <div class="grid">
      <div><label for="chatModel">对话模型</label><input id="chatModel" name="chatModel" type="text"></div>
      <div><label for="commandModel">指令模型</label><input id="commandModel" name="commandModel" type="text"></div>
    </div>
    <p class="hint">API Key 留空表示不启用 AI 功能。</p>
  </section>

  <section>
    <h2>功能设置</h2>
    <div class="checkbox-row"><input id="playPercussion" name="playPercussion" type="checkbox"><label for="playPercussion">音乐 Mod：播放打击乐</label></div>
    <div class="checkbox-row"><input id="qqEnabled" name="qqEnabled" type="checkbox"><label for="qqEnabled">启用 QQ 群消息桥接</label></div>
    <div id="qqFields">
      <div class="grid">
        <div><label for="qqGroupId">QQ 群号</label><input id="qqGroupId" name="qqGroupId" type="number"></div>
        <div><label for="qqPort">桥接端口</label><input id="qqPort" name="qqPort" type="number" min="1" max="65535"></div>
      </div>
      <div class="grid">
        <div><label for="qqHost">桥接主机</label><input id="qqHost" name="qqHost" type="text"></div>
        <div><label for="qqToken">访问令牌</label><input id="qqToken" name="qqToken" type="password" autocomplete="off"></div>
      </div>
    </div>
  </section>

  <section>
    <h2>玩家权限</h2>
    <label for="owner">服主（拥有全部权限）</label>
    <input id="owner" name="owner" type="text" placeholder="YourXboxName">
    <label for="op">管理员（逗号分隔多个玩家名）</label>
    <textarea id="op" name="op" placeholder="PlayerA, PlayerB"></textarea>
    <label for="user">普通用户</label>
    <textarea id="user" name="user"></textarea>
    <label for="blocker">屏蔽名单</label>
    <textarea id="blocker" name="blocker"></textarea>
    <p class="hint">权限数据将保存到 permission.json。</p>
  </section>

  <button type="submit">保存配置</button>
  <div id="result"></div>
</form>
</div>

<script>
var DEFAULTS = __DEFAULTS__;
function $(id) { return document.getElementById(id); }
function fill() {
  $("name").value = DEFAULTS.name;
  $("port").value = DEFAULTS.port;
  $("commandPrefix").value = DEFAULTS.commandPrefix;
  $("logLevel").value = DEFAULTS.logLevel;
  $("apiKey").value = DEFAULTS.apiKey;
  $("baseURL").value = DEFAULTS.baseURL;
  $("chatModel").value = DEFAULTS.chatModel;
  $("commandModel").value = DEFAULTS.commandModel;
  $("playPercussion").checked = !!DEFAULTS.playPercussion;
  $("qqEnabled").checked = !!DEFAULTS.qqEnabled;
  $("qqGroupId").value = DEFAULTS.qqGroupId;
  $("qqHost").value = DEFAULTS.qqHost;
  $("qqPort").value = DEFAULTS.qqPort;
  $("qqToken").value = DEFAULTS.qqToken;
  $("owner").value = DEFAULTS.owner;
  $("op").value = (DEFAULTS.op || []).join(", ");
  $("user").value = (DEFAULTS.user || []).join(", ");
  $("blocker").value = (DEFAULTS.blocker || []).join(", ");
  toggleQq();
}
function toggleQq() {
  $("qqFields").style.display = $("qqEnabled").checked ? "block" : "none";
}
function showResult(ok, msg) {
  var r = $("result");
  r.className = ok ? "ok" : "err";
  r.textContent = msg;
  r.style.display = "block";
}
document.getElementById("cfg").addEventListener("submit", function (e) {
  e.preventDefault();
  var data = {
    name: $("name").value.trim(),
    port: parseInt($("port").value, 10),
    commandPrefix: $("commandPrefix").value.trim(),
    logLevel: $("logLevel").value,
    apiKey: $("apiKey").value.trim(),
    baseURL: $("baseURL").value.trim(),
    chatModel: $("chatModel").value.trim(),
    commandModel: $("commandModel").value.trim(),
    playPercussion: $("playPercussion").checked,
    qqEnabled: $("qqEnabled").checked,
    qqGroupId: parseInt($("qqGroupId").value, 10),
    qqHost: $("qqHost").value.trim(),
    qqPort: parseInt($("qqPort").value, 10),
    qqToken: $("qqToken").value.trim(),
    owner: $("owner").value.trim(),
    op: $("op").value,
    user: $("user").value,
    blocker: $("blocker").value
  };
  fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).then(function (res) { return res.json(); }).then(function (result) {
    showResult(result.ok, result.message || (result.ok ? "保存成功" : "保存失败"));
  }).catch(function (err) {
    showResult(false, "请求失败: " + err.message);
  });
});
$("qqEnabled").addEventListener("change", toggleQq);
fill();
</script>
</body>
</html>
`;

/**
 * 启动图形化配置向导（阻塞直到配置保存完成）
 * @param {number} [preferredPort] - 首选端口，被占用时自动递增
 */
export async function startSetupServer(preferredPort = SETUP_PORT_START) {
	const defaults = await loadDefaults();
	// 转义 < 防止用户输入（如 API Key）破坏 HTML 结构
	const html = PAGE_HTML.replace("__DEFAULTS__", json(defaults).replace(/</g, "\\u003c"));

	const server = http.createServer((req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");

		if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(html);
			return;
		}

		if (req.method === "POST" && url.pathname === "/api/save") {
			let body = "";
			req.on("data", (chunk) => { body += chunk; });
			req.on("end", () => {
				let form;
				try {
					form = JSON.parse(body);
				} catch {
					respond(res, { ok: false, message: "请求数据格式错误" });
					return;
				}
				const err = validate(form);
				if (err) {
					respond(res, { ok: false, message: err });
					return;
				}
				try {
					saveConfig(form);
				} catch (e) {
					respond(res, { ok: false, message: e.message });
					return;
				}
				respond(res, { ok: true, message: "✅ 配置已保存！\\n请关闭本页面，然后重新启动服务器。" });
				// 延迟关闭，确保响应已发送
				setTimeout(() => server.close(), 300);
			});
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("Not Found");
	});

	// 依次尝试监听端口，直到成功或超出范围
	let port = preferredPort;
	let listening = false;
	for (; port <= SETUP_PORT_MAX; port++) {
		try {
			await new Promise((resolve, reject) => {
				const onError = (e) => { server.removeListener("listening", onListening); reject(e); };
				const onListening = () => { server.removeListener("error", onError); resolve(); };
				server.once("error", onError);
				server.once("listening", onListening);
				server.listen(port, "127.0.0.1");
			});
			listening = true;
			break;
		} catch (e) {
			if (e.code === "EADDRINUSE") continue;
			throw e;
		}
	}
	if (!listening) throw new Error(`端口 ${preferredPort}-${SETUP_PORT_MAX} 均被占用，无法启动配置向导`);

	console.log("");
	console.log("========================================");
	console.log("  ModLoader 配置向导已启动");
	console.log(`  请在浏览器打开: http://127.0.0.1:${port}`);
	console.log("  配置完成后请重新启动服务器");
	console.log("========================================");
	console.log("");

	// 阻塞，直到保存成功触发 server.close()
	await new Promise((resolve) => server.on("close", resolve));
}
