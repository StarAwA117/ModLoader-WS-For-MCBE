// lib/setup.js - 首次运行图形化配置向导
//
// 由 setup.js（独立配置脚本）在首次运行 / 重新配置时调用 startSetupServer()：
// 1. 启动一个临时 HTTP 服务器（仅监听 127.0.0.1，不对外网开放）
// 2. 用户在浏览器中填写配置表单（含模组列表，启用某模组才弹出其相关配置）
// 3. 保存时直接生成 config.json（config.json 只存储用户真实配置），
//    并将玩家权限写入 permission.json（旧文件自动备份为 .bak），
//    同时写入 .configured 标记，避免下次启动重复进入向导
// 4. 保存成功后关闭临时服务器，提示用户重启

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { markConfigured } from "../setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CONFIG_EXAMPLE = path.join(ROOT, "config.example.json");
const CONFIG_JSON = path.join(ROOT, "config.json");
const PERMISSION_EXAMPLE = path.join(ROOT, "permission.example.json");
const PERMISSION_JSON = path.join(ROOT, "permission.json");

const SETUP_PORT_START = 18888;
const SETUP_PORT_MAX = 18899;
const LOG_LEVELS = ["debug", "info", "warning", "error"];

const json = (v) => JSON.stringify(v);
const num = (v) => Number(v);

/**
 * 基础模组注册表：仅单端（客户端或服务端）的模组，向导据此渲染基础模组列表。
 * config 字段非空表示该模组启用时需要填写对应配置段（向导中条件显示）。
 * basePath 字段表示该模块在 config.basePath 下的子键名（向导中条件显示对应路径输入框）。
 * @type {{ client: Object<string, {path: string, label: string, config?: string, basePath?: string}>, server: Object<string, {path: string, label: string, config?: string, basePath?: string}> }}
 */
const MOD_REGISTRY = {
	client: {
		"PermissionCommands": { path: "../mod/permission.js", label: "权限命令" },
		"Tool": { path: "../mod/tool.js", label: "工具" },
		"Position": { path: "../mod/position.js", label: "坐标" },
		"Music": { path: "../mod/music.js", label: "音乐", config: "music", basePath: "music" },
		"MCFunc": { path: "../mod/mcfunc.js", label: "MCFunc", basePath: "mcfunc" },
		"MoreWS": { path: "../mod/morews.js", label: "MoreWS" },
		"Litematic": { path: "../mod/litematic/main.js", label: "Litematic 结构", basePath: "litematic" },
		"ImageMod": { path: "../mod/image/main.js", label: "图片", basePath: "image" }
	},
	server: {
		"Read": { path: "../mod/read.js", label: "读取", config: "spam" }
	}
};

/**
 * 高级模组注册表：同时具备客户端与服务端的模组（如 AI、QQ 群互通），单独成组展示。
 * AI 启用后会同时写入 client 与 server 两侧；QQ 通过 features.qq 开关控制，不进 mods 列表。
 * @type {Object<string, {label: string, config?: string, clientPath?: string, serverPath?: string}>}
 */
const ADVANCED_MODS = {
	"AI": { label: "AI 对话（客户端 + 服务端）", clientPath: "../mod/ai.js", serverPath: "../mod/ai.js", config: "ai" },
	"QQ": { label: "QQ 群互通（客户端 + 服务端）", config: "qq" }
};

/**
 * 根据表单数据生成 config.json 配置对象。
 * 模块专属配置（AI、Music、QQ、Read/spam）仅在对应模块启用时写入；
 * basePath 各子路径仅在对应模块启用时写入；
 * sapi/utils/rateLimit 从表单高级配置读取，始终写入。
 * @param {object} f - 表单数据
 * @returns {object} 生成的配置对象
 */
function buildConfig(f) {
	const clientModList = f.clientMods || [];
	const serverModList = f.serverMods || [];
	const advModList = f.advancedMods || [];

	const cfg = {
		ws: { name: f.name, port: num(f.port) },
		logLevel: f.logLevel,
		commandPrefix: f.commandPrefix,
		sapi: {
			gmsg: f.sapiGmsg || "gmsg",
			smsg: f.sapiSmsg || "smsg"
		},
		features: {},
		mods: { client: {}, server: {} },
		utils: {
			tellAllToTell: !!f.utilsTellAllToTell,
			enablePolling: !!f.utilsEnablePolling
		},
		basePath: {},
		rateLimit: {
			command: {
				enabled: !!f.rateLimitEnabled,
				windowMs: num(f.rateLimitWindow) || 1000,
				maxPerWindow: num(f.rateLimitMax) || 20
			}
		}
	};

	// basePath: 仅写入已启用模块对应的子路径
	const basePathMap = { music: f.basePathMusic, mcfunc: f.basePathMcfunc, litematic: f.basePathLitematic, image: f.basePathImage };
	for (const [key, val] of Object.entries(basePathMap)) {
		if (val) cfg.basePath[key] = val;
	}

	// Music: 仅在客户端模组启用时写入 features.music
	if (clientModList.includes("Music")) {
		cfg.features.music = { playPercussion: !!f.playPercussion };
	}

	// QQ: 仅在高级模组启用 QQ 时写入 features.qq
	if (advModList.includes("QQ")) {
		cfg.features.qq = {
			enabled: true,
			groupId: num(f.qqGroupId),
			host: f.qqHost,
			port: num(f.qqPort),
			accessToken: f.qqToken
		};
	}

	// AI: 仅在高级模组启用时写入 config.ai
	if (advModList.includes("AI")) {
		cfg.ai = {
			options: { baseURL: f.baseURL, apiKey: f.apiKey },
			models: {
				chat: { model: f.chatModel || "deepseek-chat" },
				command: { model: f.commandModel || "deepseek-chat" }
			},
			chatCooldown: num(f.aiChatCooldown) || 5000
		};
	}

	// Read/spam: 仅在服务端模组启用 read 时写入 config.spam
	if (serverModList.includes("read")) {
		cfg.spam = {
			attack: f.spamAttack || "",
			ad: splitList(f.spamAd),
			adInterval: num(f.spamAdInterval) || 60000
		};
	}

	// 写入基础模组路径
	for (const name of clientModList) {
		if (MOD_REGISTRY.client[name]) cfg.mods.client[name] = MOD_REGISTRY.client[name].path;
	}
	for (const name of serverModList) {
		if (MOD_REGISTRY.server[name]) cfg.mods.server[name] = MOD_REGISTRY.server[name].path;
	}

	// 高级模组：AI 同时写入客户端与服务端；QQ 通过 features.qq 控制
	for (const name of advModList) {
		const m = ADVANCED_MODS[name];
		if (!m) continue;
		if (m.clientPath) cfg.mods.client[name] = m.clientPath;
		if (m.serverPath) cfg.mods.server[name] = m.serverPath;
	}

	return cfg;
}

/**
 * 将逗号/换行分隔的玩家名文本解析为去重数组
 * @param {string} str
 * @returns {string[]}
 */
function splitList(str) {
	if (typeof str !== "string") return [];
	return [...new Set(str.split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * 读取表单默认值：优先读取现有 config.json / permission.json（重新配置场景），
 * 不存在或损坏时回退到模板文件。
 * @returns {Promise<object>}
 */
async function loadDefaults() {
	let cfg = null;
	try {
		cfg = JSON.parse(fs.readFileSync(CONFIG_JSON, "utf8"));
	} catch {
		try {
			cfg = JSON.parse(fs.readFileSync(CONFIG_EXAMPLE, "utf8"));
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

	// 已启用的高级模组列表（用于勾选 checkbox）
	const enabledAdvanced = [
		...(("AI" in (cfg.mods?.client || {}) || "AI" in (cfg.mods?.server || {})) ? ["AI"] : []),
		...(cfg.features?.qq?.enabled ? ["QQ"] : [])
	];

	// basePath 默认值
	const bp = cfg.basePath || {};

	return {
		name: cfg.ws?.name ?? "ModLoader",
		port: cfg.ws?.port ?? 8080,
		commandPrefix: cfg.commandPrefix ?? "!",
		logLevel: cfg.logLevel ?? "info",
		clientMods: Object.keys(cfg.mods?.client || {}).filter((n) => !ADVANCED_MODS[n]),
		serverMods: Object.keys(cfg.mods?.server || {}).filter((n) => !ADVANCED_MODS[n]),
		advancedMods: enabledAdvanced,
		advancedModRegistry: ADVANCED_MODS,
		// AI
		apiKey: cfg.ai?.options?.apiKey ?? "",
		baseURL: cfg.ai?.options?.baseURL ?? "https://api.deepseek.com",
		chatModel: cfg.ai?.models?.chat?.model ?? "deepseek-chat",
		commandModel: cfg.ai?.models?.command?.model ?? "deepseek-chat",
		aiChatCooldown: cfg.ai?.chatCooldown ?? 5000,
		// Music
		playPercussion: cfg.features?.music?.playPercussion ?? false,
		// QQ
		qqGroupId: cfg.features?.qq?.groupId ?? 123456789,
		qqHost: cfg.features?.qq?.host ?? "127.0.0.1",
		qqPort: cfg.features?.qq?.port ?? 3001,
		qqToken: cfg.features?.qq?.accessToken ?? "",
		// Read/spam
		spamAttack: cfg.spam?.attack ?? "",
		spamAd: Array.isArray(cfg.spam?.ad) ? cfg.spam.ad.join("\n") : "",
		spamAdInterval: cfg.spam?.adInterval ?? 60000,
		// SAPI
		sapiGmsg: cfg.sapi?.gmsg ?? "gmsg",
		sapiSmsg: cfg.sapi?.smsg ?? "smsg",
		// Utils
		utilsTellAllToTell: cfg.utils?.tellAllToTell ?? false,
		utilsEnablePolling: cfg.utils?.enablePolling ?? true,
		// basePath
		basePathMusic: bp.music ?? "./resources/midi",
		basePathMcfunc: bp.mcfunc ?? "./resources/mcfunc",
		basePathLitematic: bp.litematic ?? "./resources/litematic",
		basePathImage: bp.image ?? "./resources/pictures",
		// rateLimit
		rateLimitEnabled: cfg.rateLimit?.command?.enabled ?? true,
		rateLimitWindow: cfg.rateLimit?.command?.windowMs ?? 1000,
		rateLimitMax: cfg.rateLimit?.command?.maxPerWindow ?? 20,
		// Permissions
		owner: perm.owner ?? "YourXboxName",
		op: Array.isArray(perm.op) ? perm.op : [],
		user: Array.isArray(perm.user) ? perm.user : [],
		blocker: Array.isArray(perm.blocker) ? perm.blocker : [],
		// Registries (for JS rendering)
		modRegistry: MOD_REGISTRY
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
 * 标记配置已完成（写入 .configured），避免下次启动重复进入向导。
 * 具体实现见 setup.js 的 markConfigured()。
 */
function clearFirstRunFlag() {
	markConfigured();
}

/**
 * 基于表单数据生成 config.json 并写入 permission.json（均先备份旧文件）
 * @param {object} f - 表单数据
 */
function saveConfig(f) {
	const cfg = buildConfig(f);

	if (fs.existsSync(CONFIG_JSON)) {
		fs.copyFileSync(CONFIG_JSON, CONFIG_JSON + ".bak");
	}
	fs.writeFileSync(CONFIG_JSON, JSON.stringify(cfg, null, "\t") + "\n", "utf8");

	// 保存成功后写入 .configured 标记，下次启动正常进入服务
	markConfigured();

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
.mod-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.mod-row input { width: auto; }
.mod-row label { margin: 0; font-size: 14px; color: #cdd6f4; }
.mod-group { margin-bottom: 10px; }
.mod-group h3 { font-size: 13px; color: #a6e3a1; margin: 6px 0; }
button[type=submit] { width: 100%; padding: 12px; background: #89b4fa; color: #1e1e2e; font-size: 16px; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; margin-top: 8px; }
button[type=submit]:hover { background: #a6c8ff; }
#result { margin-top: 14px; padding: 12px 14px; border-radius: 8px; font-size: 14px; display: none; white-space: pre-line; }
#result.ok { background: #1a3a2a; color: #a6e3a1; border: 1px solid #3d6b4f; }
#result.err { background: #3a1a1a; color: #f38ba8; border: 1px solid #6b3d3d; }
.hint { font-size: 12px; color: #7f849c; margin-top: 4px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
details.advanced { margin-bottom: 16px; }
details.advanced summary { background: #313244; border-radius: 10px; padding: 14px 20px; font-size: 15px; color: #a6adc8; cursor: pointer; list-style: none; }
details.advanced summary::-webkit-details-marker { display: none; }
details.advanced summary::before { content: "▶ "; font-size: 12px; }
details.advanced[open] summary::before { content: "▼ "; }
details.advanced[open] summary { border-radius: 10px 10px 0 0; border-bottom: 1px solid #45475a; }
details.advanced .adv-body { background: #313244; border-radius: 0 0 10px 10px; padding: 18px 20px; }
</style>
</head>
<body>
<div class="container">
<h1>⚙️ ModLoader 配置向导</h1>
<p class="sub">首次运行配置。勾选要启用的模组，相关配置段会随之出现。填写完成后点击「保存配置」，将生成 config.json 与 permission.json。</p>
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
    <h2>基础模组</h2>
    <p class="hint">勾选要启用的模组；带「配置」标记的模组启用后会显示对应设置项。</p>
    <div class="mod-group"><h3>客户端模组</h3><div id="clientMods"></div></div>
    <div class="mod-group"><h3>服务端模组</h3><div id="serverMods"></div></div>
  </section>

  <section>
    <h2>高级模组</h2>
    <p class="hint">同时具备客户端与服务端的模组（如 AI、QQ 群互通）。启用后两侧都会加载，并出现对应配置项。</p>
    <div class="mod-group"><div id="advancedMods"></div></div>
  </section>

  <section id="aiFields" style="display:none;">
    <h2>AI 设置</h2>
    <label for="apiKey">API Key</label>
    <input id="apiKey" name="apiKey" type="password" placeholder="sk-..." autocomplete="off">
    <label for="baseURL">Base URL</label>
    <input id="baseURL" name="baseURL" type="text">
    <div class="grid">
      <div><label for="chatModel">对话模型</label><input id="chatModel" name="chatModel" type="text"></div>
      <div><label for="commandModel">指令模型</label><input id="commandModel" name="commandModel" type="text"></div>
    </div>
    <label for="aiChatCooldown">对话冷却（毫秒）</label>
    <input id="aiChatCooldown" name="aiChatCooldown" type="number" min="0">
    <p class="hint">启用了 AI 模组才需要填写；API Key 留空表示不启用 AI 功能。</p>
  </section>

  <section id="musicFields" style="display:none;">
    <h2>音乐设置</h2>
    <div class="checkbox-row"><input id="playPercussion" name="playPercussion" type="checkbox"><label for="playPercussion">音乐 Mod：播放打击乐</label></div>
  </section>

  <section id="qqFields" style="display:none;">
    <h2>QQ 群互通设置</h2>
    <div class="grid">
      <div><label for="qqGroupId">QQ 群号</label><input id="qqGroupId" name="qqGroupId" type="number"></div>
      <div><label for="qqPort">桥接端口</label><input id="qqPort" name="qqPort" type="number" min="1" max="65535"></div>
    </div>
    <div class="grid">
      <div><label for="qqHost">桥接主机</label><input id="qqHost" name="qqHost" type="text"></div>
      <div><label for="qqToken">访问令牌</label><input id="qqToken" name="qqToken" type="password" autocomplete="off"></div>
    </div>
    <p class="hint">启用「高级模组 - QQ 群互通」后才需要填写。</p>
  </section>

  <section id="spamFields" style="display:none;">
    <h2>Read / 刷屏设置</h2>
    <label for="spamAttack">攻击文本（c:attack 命令使用）</label>
    <textarea id="spamAttack" name="spamAttack" rows="2"></textarea>
    <label for="spamAd">广告文本（每行一条，c:ad 命令随机推送）</label>
    <textarea id="spamAd" name="spamAd" rows="4" placeholder="§u广告文本 1&#10;§u广告文本 2"></textarea>
    <label for="spamAdInterval">广告推送间隔（毫秒）</label>
    <input id="spamAdInterval" name="spamAdInterval" type="number" min="0">
    <p class="hint">启用「服务端模组 - 读取」后才需要填写。</p>
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

  <details class="advanced">
    <summary>高级配置</summary>
    <div class="adv-body">
      <section style="background:transparent;padding:0;margin:0;">
        <h2>SAPI</h2>
        <p class="hint">Minecraft Bedrock 服务端指令接口，用于获取/发送游戏内消息。</p>
        <div class="grid">
          <div><label for="sapiGmsg">gmsg（获取消息指令）</label><input id="sapiGmsg" name="sapiGmsg" type="text"></div>
          <div><label for="sapiSmsg">smsg（发送消息指令）</label><input id="sapiSmsg" name="sapiSmsg" type="text"></div>
        </div>
      </section>

      <section style="background:transparent;padding:0;margin:16px 0 0;">
        <h2>Utils</h2>
        <div class="checkbox-row"><input id="utilsTellAllToTell" name="utilsTellAllToTell" type="checkbox"><label for="utilsTellAllToTell">tellall 转发为 tell</label></div>
        <div class="checkbox-row"><input id="utilsEnablePolling" name="utilsEnablePolling" type="checkbox"><label for="utilsEnablePolling">启用轮询</label></div>
      </section>

      <section style="background:transparent;padding:0;margin:16px 0 0;">
        <h2>资源路径（basePath）</h2>
        <p class="hint">各模块的资源文件路径，仅启用对应模块时生效。</p>
        <div id="basePathFields">
          <div class="basePathRow" data-basepath="music" style="display:none;">
            <label for="basePathMusic">音乐文件路径（Music 模组）</label>
            <input id="basePathMusic" name="basePathMusic" type="text">
          </div>
          <div class="basePathRow" data-basepath="mcfunc" style="display:none;">
            <label for="basePathMcfunc">MCFunc 文件路径</label>
            <input id="basePathMcfunc" name="basePathMcfunc" type="text">
          </div>
          <div class="basePathRow" data-basepath="litematic" style="display:none;">
            <label for="basePathLitematic">Litematic 文件路径</label>
            <input id="basePathLitematic" name="basePathLitematic" type="text">
          </div>
          <div class="basePathRow" data-basepath="image" style="display:none;">
            <label for="basePathImage">图片文件路径（ImageMod）</label>
            <input id="basePathImage" name="basePathImage" type="text">
          </div>
        </div>
      </section>

      <section style="background:transparent;padding:0;margin:16px 0 0;">
        <h2>命令限流（rateLimit）</h2>
        <div class="checkbox-row"><input id="rateLimitEnabled" name="rateLimitEnabled" type="checkbox"><label for="rateLimitEnabled">启用命令限流</label></div>
        <div class="grid">
          <div><label for="rateLimitWindow">窗口时间（毫秒）</label><input id="rateLimitWindow" name="rateLimitWindow" type="number" min="1"></div>
          <div><label for="rateLimitMax">窗口内上限（次）</label><input id="rateLimitMax" name="rateLimitMax" type="number" min="1"></div>
        </div>
      </section>
    </div>
  </details>

  <button type="submit">保存配置</button>
  <div id="result"></div>
</form>
</div>

<script>
var DEFAULTS = __DEFAULTS__;
function $(id) { return document.getElementById(id); }
function buildModList(containerId, side) {
  var box = $(containerId);
  var reg = DEFAULTS.modRegistry[side];
  Object.keys(reg).forEach(function (name) {
    var m = reg[name];
    var row = document.createElement("div");
    row.className = "mod-row";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = side + "_" + name;
    cb.name = side + "Mod";
    cb.value = name;
    if (m.config) cb.setAttribute("data-config", m.config);
    if (m.basePath) cb.setAttribute("data-basepath", m.basePath);
    if ((side === "client" ? DEFAULTS.clientMods : DEFAULTS.serverMods).indexOf(name) >= 0) cb.checked = true;
    var lab = document.createElement("label");
    lab.setAttribute("for", cb.id);
    lab.textContent = m.label + (m.config ? "（含配置）" : "");
    row.appendChild(cb);
    row.appendChild(lab);
    box.appendChild(row);
  });
}
function buildAdvancedList(containerId) {
  var box = $(containerId);
  var reg = DEFAULTS.advancedModRegistry;
  Object.keys(reg).forEach(function (name) {
    var m = reg[name];
    var row = document.createElement("div");
    row.className = "mod-row";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "adv_" + name;
    cb.name = "advancedMod";
    cb.value = name;
    if (m.config) cb.setAttribute("data-config", m.config);
    if (DEFAULTS.advancedMods.indexOf(name) >= 0) cb.checked = true;
    var lab = document.createElement("label");
    lab.setAttribute("for", cb.id);
    lab.textContent = m.label + (m.config ? "（含配置）" : "");
    row.appendChild(cb);
    row.appendChild(lab);
    box.appendChild(row);
  });
}
function syncConfig() {
  var aiOn = document.querySelector('input[data-config="ai"]:checked') ? true : false;
  $("aiFields").style.display = aiOn ? "block" : "none";
  var musicOn = document.querySelector('input[data-config="music"]:checked') ? true : false;
  $("musicFields").style.display = musicOn ? "block" : "none";
  var qqOn = document.querySelector('input[data-config="qq"]:checked') ? true : false;
  $("qqFields").style.display = qqOn ? "block" : "none";
  var readOn = document.querySelector('input[data-config="spam"]:checked') ? true : false;
  $("spamFields").style.display = readOn ? "block" : "none";
  // basePath: 仅显示已启用模块对应的路径
  document.querySelectorAll(".basePathRow").forEach(function (row) {
    var key = row.getAttribute("data-basepath");
    var on = document.querySelector('input[data-basepath="' + key + '"]:checked') ? true : false;
    row.style.display = on ? "block" : "none";
  });
}
function fill() {
  $("name").value = DEFAULTS.name;
  $("port").value = DEFAULTS.port;
  $("commandPrefix").value = DEFAULTS.commandPrefix;
  $("logLevel").value = DEFAULTS.logLevel;
  buildModList("clientMods", "client");
  buildModList("serverMods", "server");
  buildAdvancedList("advancedMods");
  $("apiKey").value = DEFAULTS.apiKey;
  $("baseURL").value = DEFAULTS.baseURL;
  $("chatModel").value = DEFAULTS.chatModel;
  $("commandModel").value = DEFAULTS.commandModel;
  $("aiChatCooldown").value = DEFAULTS.aiChatCooldown;
  $("playPercussion").checked = !!DEFAULTS.playPercussion;
  $("qqGroupId").value = DEFAULTS.qqGroupId;
  $("qqHost").value = DEFAULTS.qqHost;
  $("qqPort").value = DEFAULTS.qqPort;
  $("qqToken").value = DEFAULTS.qqToken;
  $("spamAttack").value = DEFAULTS.spamAttack;
  $("spamAd").value = DEFAULTS.spamAd;
  $("spamAdInterval").value = DEFAULTS.spamAdInterval;
  $("sapiGmsg").value = DEFAULTS.sapiGmsg;
  $("sapiSmsg").value = DEFAULTS.sapiSmsg;
  $("utilsTellAllToTell").checked = !!DEFAULTS.utilsTellAllToTell;
  $("utilsEnablePolling").checked = !!DEFAULTS.utilsEnablePolling;
  $("basePathMusic").value = DEFAULTS.basePathMusic;
  $("basePathMcfunc").value = DEFAULTS.basePathMcfunc;
  $("basePathLitematic").value = DEFAULTS.basePathLitematic;
  $("basePathImage").value = DEFAULTS.basePathImage;
  $("rateLimitEnabled").checked = !!DEFAULTS.rateLimitEnabled;
  $("rateLimitWindow").value = DEFAULTS.rateLimitWindow;
  $("rateLimitMax").value = DEFAULTS.rateLimitMax;
  $("owner").value = DEFAULTS.owner;
  $("op").value = (DEFAULTS.op || []).join(", ");
  $("user").value = (DEFAULTS.user || []).join(", ");
  $("blocker").value = (DEFAULTS.blocker || []).join(", ");
  syncConfig();
}
function collectMods(side) {
  var out = [];
  document.querySelectorAll('input[name="' + side + 'Mod"]:checked').forEach(function (el) { out.push(el.value); });
  return out;
}
function collectAdvanced() {
  var out = [];
  document.querySelectorAll('input[name="advancedMod"]:checked').forEach(function (el) { out.push(el.value); });
  return out;
}
function showResult(ok, msg) {
  var r = $("result");
  r.className = ok ? "ok" : "err";
  r.textContent = msg;
  r.style.display = "block";
}
document.getElementById("cfg").addEventListener("submit", function (e) {
  e.preventDefault();
  var adv = collectAdvanced();
  var data = {
    name: $("name").value.trim(),
    port: parseInt($("port").value, 10),
    commandPrefix: $("commandPrefix").value.trim(),
    logLevel: $("logLevel").value,
    clientMods: collectMods("client"),
    serverMods: collectMods("server"),
    advancedMods: adv,
    apiKey: $("apiKey").value.trim(),
    baseURL: $("baseURL").value.trim(),
    chatModel: $("chatModel").value.trim(),
    commandModel: $("commandModel").value.trim(),
    aiChatCooldown: parseInt($("aiChatCooldown").value, 10) || 5000,
    playPercussion: $("playPercussion").checked,
    qqGroupId: parseInt($("qqGroupId").value, 10),
    qqHost: $("qqHost").value.trim(),
    qqPort: parseInt($("qqPort").value, 10),
    qqToken: $("qqToken").value.trim(),
    spamAttack: $("spamAttack").value,
    spamAd: $("spamAd").value,
    spamAdInterval: parseInt($("spamAdInterval").value, 10) || 60000,
    sapiGmsg: $("sapiGmsg").value.trim(),
    sapiSmsg: $("sapiSmsg").value.trim(),
    utilsTellAllToTell: $("utilsTellAllToTell").checked,
    utilsEnablePolling: $("utilsEnablePolling").checked,
    basePathMusic: $("basePathMusic").value.trim(),
    basePathMcfunc: $("basePathMcfunc").value.trim(),
    basePathLitematic: $("basePathLitematic").value.trim(),
    basePathImage: $("basePathImage").value.trim(),
    rateLimitEnabled: $("rateLimitEnabled").checked,
    rateLimitWindow: parseInt($("rateLimitWindow").value, 10) || 1000,
    rateLimitMax: parseInt($("rateLimitMax").value, 10) || 20,
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
document.addEventListener("change", syncConfig);
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
