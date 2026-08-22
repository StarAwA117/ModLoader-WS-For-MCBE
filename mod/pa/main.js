import { spawn, spawnSync } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { StringDecoder } from "string_decoder";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== pi 配置 =====
// 由 _init() 在注入后延迟初始化
let PA_CONFIG = {};
let PI_BIN, AI_MODEL, AI_MODEL_ID;
let LOCAL_PROXY_START = 18080, LOCAL_PROXY_END = 18110;
let LOCAL_PROVIDER = "bansos-local";
let MODELS_FILE, SESSION_DIR;
let CONTEXT_WINDOW, TOKEN_LIMIT, PROMPT_TIMEOUT, RPC_START_TIMEOUT, WARMUP_DELAY, THINKING;
let BANSOS_EXT, PERSONA_EXT, LOADED_EXTS;
let AI_STYLE;
let idleEnabled = true;
const IDLE_MESSAGES = ["xxx"];

class PA {
	static _initialized = false;

	static _init(config) {
		if (PA._initialized) return;
		PA._initialized = true;

		const paCfg = (config && typeof config.pa === "object") ? config.pa : {};
		PI_BIN = process.env.PA_PI_BIN || "pi";
		AI_MODEL = process.env.PA_MODEL || paCfg.model || "bansos/nemotron-3-ultra-free";
		AI_MODEL_ID = AI_MODEL.includes("/") ? AI_MODEL.split("/").pop() : AI_MODEL;
		MODELS_FILE = path.join(os.homedir(), ".pi", "agent", "models.json");
		SESSION_DIR = path.join(__dirname, "pa-sessions");
		CONTEXT_WINDOW = Number(paCfg.contextWindow) > 0 ? Math.floor(Number(paCfg.contextWindow)) : 1000000;
		TOKEN_LIMIT = Number(process.env.PA_TOKEN_LIMIT)
			|| (Number(paCfg.tokenLimit) > 0 ? Math.floor(Number(paCfg.tokenLimit)) : 0)
			|| Math.floor(CONTEXT_WINDOW * (Number(paCfg.tokenLimitRatio) > 0 ? Number(paCfg.tokenLimitRatio) : 0.7));
		PROMPT_TIMEOUT = Number(process.env.PA_TIMEOUT) || 300000;
		RPC_START_TIMEOUT = Number(process.env.PA_START_TIMEOUT) || 90000;
		WARMUP_DELAY = Number(process.env.PA_WARMUP_MS) || 3000;
		THINKING = process.env.PA_THINKING || "low";

		// 扩展路径解析
		function resolveExtPath(pkgName, relPath, envOverride) {
			if (envOverride && fs.existsSync(envOverride)) return envOverride;
			const candidates = [];
			try {
				const res = spawnSync("npm", ["root", "-g"], { timeout: 5000, encoding: "utf8" });
				const root = (res.stdout || "").trim();
				if (root) candidates.push(path.join(root, pkgName, relPath));
			} catch {}
			candidates.push(path.join("/usr/lib/node_modules", pkgName, relPath));
			for (const c of candidates) { if (fs.existsSync(c)) return c; }
			return null;
		}
		BANSOS_EXT = resolveExtPath("pi-bansos", "extensions/index.ts", process.env.PA_BANSOS_EXT);
		PERSONA_EXT = resolveExtPath("@smoose/pi-persona", "extensions/index.ts", process.env.PA_PERSONA_EXT);
		LOADED_EXTS = [BANSOS_EXT, PERSONA_EXT].filter(Boolean);

		AI_STYLE = `你是Minecraft游戏里的AI助手(基于 pi coding agent)。规则：
1. 只用文字回答。严禁使用 rm、mkfs、dd、shutdown、reboot 这类危险命令。
2. 每次输出的话不要太多，防止token消耗速度快，也避免刷屏。
3. 如果需要在游戏里执行Minecraft基岩版命令，用 [cmd] 开头写命令，例如：
[cmd] /tp @p 100 64 100
[cmd] /give @a diamond 1
每条命令独占一行
关于新版命令用法:
execute as 人 at xxx run 要执行的命令
deop 撤回op权限, op 给予op权限。
4. 不要用代码块包裹 [cmd]
5. 主人:暂未定义`;
	}

	constructor(client) {
		PA._init(client.config || {});
		this.client = client;
		// 每个玩家 -> 会话文件路径(null 表示尚未开始会话)
		this.sessions = new Map();
		// 每个玩家 -> 当前会话累计 token
		this.tokenUsage = new Map();
		// 每个玩家 -> 历史最高 token
		this.maxTokenUsage = new Map();
		// 每个玩家 -> 最后活跃时间(用于空闲消息)
		this.lastActive = new Map();

		// ===== RPC 常驻进程状态 =====
		this._rpc = null;            // pi --mode rpc 子进程
		this._rpcReady = false;      // 模型是否已就绪
		this._rpcSessionFile = null; // rpc 当前加载的会话文件
		this._rpcPending = new Map();// 请求 id -> resolve
		this._rpcAgentEnd = [];      // agent_end 等待者
		this._rpcCollectors = [];    // assistant message 收集器
		this._rpcId = 0;             // 请求计数
		this._queueTail = Promise.resolve(); // 串行队列
		this._startPromise = null;   // 启动中的 promise(防并发启动)

		// 创建会话目录
		try {
			fs.mkdirSync(SESSION_DIR, { recursive: true });
		} catch {}

		// 空闲消息定时器
		this._idleTimer = setInterval(() => this._checkIdle(), 60000);

		// 预热: 延迟后台启动常驻进程, 首次对话省去启动等待
		this._warmupTimer = setTimeout(() => {
			if (this.client && !this._rpc) {
				this._spawnRPC().catch(() => {});
			}
		}, WARMUP_DELAY);
	}

	// ===== 会话管理 =====

	_getSessionFile(player) {
		return this.sessions.get(player) || null;
	}

	// 开启新会话(将当前会话置空, 下次聊天自动创建全新 pi 会话)
	_startNewSession(player, announce = false) {
		this.sessions.set(player, null);
		this.tokenUsage.set(player, 0);
		this.lastActive.set(player, Date.now());
		if (announce && this.client) {
			this.client.tellAll(`§apa§r | new > §7${player} 开始了新的话题 喵~`);
		}
	}

	// ===== RPC 进程管理 =====

	// 串行队列: 保证 RPC 请求(切换会话/prompt)不会交叉
	_enqueue(op) {
		const run = this._queueTail.then(op, op);
		this._queueTail = run.catch(() => {});
		return run;
	}

	// 等待队列空闲(用于测试/调试)
	_whenIdle() {
		return this._queueTail;
	}

	// 探测指定端口的 bansos 代理是否能成功响应当前模型(健康代理 = 能成功)
	_probeProxy(port, modelId) {
		return new Promise((resolve) => {
			const body = JSON.stringify({
				model: modelId,
				messages: [{ role: "user", content: "hi" }],
				max_tokens: 1,
				stream: false
			});
			const req = http.request({
				host: "127.0.0.1",
				port,
				path: "/v1/chat/completions",
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(body)
				},
				timeout: 8000
			}, (res) => {
				let data = "";
				res.on("data", (c) => data += c);
				res.on("end", () => {
					try {
						const d = JSON.parse(data);
						resolve(res.statusCode === 200 && !d.error && d.id ? true : false);
					} catch { resolve(false); }
				});
				res.on("error", () => resolve(false));
			});
			req.on("error", () => resolve(false));
			req.on("timeout", () => { req.destroy(); resolve(false); });
			req.write(body);
			req.end();
		});
	}

	// 扫描本机所有 bansos 代理, 找到第一个能成功响应当前模型的健康代理端口
	// (终端 pi 的代理通常健康; 游戏自起的"新代理"会被上游限流, 探测会失败并跳过)
	async _findHealthyProxy(modelId) {
		for (let port = LOCAL_PROXY_START; port <= LOCAL_PROXY_END; port++) {
			const ok = await this._probeProxy(port, modelId);
			if (ok) return port;
		}
		return null;
	}

	// 把全局 models.json 里 bansos-local 的 baseUrl 指向健康代理端口
	_writeModelsBaseUrl(port) {
		try {
			let cfg = { providers: {} };
			try { cfg = JSON.parse(fs.readFileSync(MODELS_FILE, "utf8")); } catch {}
			if (!cfg.providers) cfg.providers = {};
			const prov = cfg.providers[LOCAL_PROVIDER] = cfg.providers[LOCAL_PROVIDER] || {};
			prov.baseUrl = `http://127.0.0.1:${port}/v1`;
			fs.mkdirSync(path.dirname(MODELS_FILE), { recursive: true });
			fs.writeFileSync(MODELS_FILE, JSON.stringify(cfg, null, 2));
		} catch {}
	}

	// 启动(或复用)常驻 pi RPC 进程
	async _spawnRPC() {
		if (this._rpc && this._rpc.exitCode === null) return;
		if (this._startPromise) return this._startPromise;

		this._startPromise = new Promise(async (resolve, reject) => {
			try {
				// 扫描本机所有 bansos 代理, 找到对当前模型健康的那一个(通常就是终端 pi 的代理)。
				// 注意: 不能只检测固定端口 —— 终端 pi 的代理可能占 18080 也可能占 18081, 取决于谁先启动;
				// 而自起的"新代理"会被上游限流(429), 探测会失败并自动跳过。
				const healthyPort = await this._findHealthyProxy(AI_MODEL_ID);
				const useLocal = healthyPort !== null;
				if (useLocal) {
					// 动态把 models.json 的 bansos-local 指向健康代理端口
					this._writeModelsBaseUrl(healthyPort);
				}
				const rpcModel = useLocal ? `${LOCAL_PROVIDER}/${AI_MODEL_ID}` : AI_MODEL;
				// 复用健康代理时不需要加载 bansos 扩展(避免它再起一个新代理), 但仍保留 persona
				const rpcExts = useLocal ? [PERSONA_EXT].filter(Boolean) : LOADED_EXTS;

				const args = [
					"--mode", "rpc",
					"--model", rpcModel,
					"--session-dir", SESSION_DIR,
					"--thinking", THINKING,
					"--no-context-files"
				];
				// 精确加载指定扩展: 复用本地代理时只加载 persona; 自起代理时加载 bansos + persona
				if (rpcExts.length) {
					args.push("--no-extensions");
					for (const e of rpcExts) args.push("-e", e);
				}

			const child = spawn(PI_BIN, args, {
				cwd: path.join(__dirname, ".."),
				env: process.env,
				stdio: ["pipe", "pipe", "pipe"]
			});
			this._rpc = child;
			this._rpcReady = false;
			this._rpcSessionFile = null;
			this._rpcPending.clear();
			this._rpcAgentEnd = [];
			this._rpcCollectors = [];

			// 解析 stdout 的 JSONL 事件流
			const decoder = new StringDecoder("utf8");
			let buffer = "";
			child.stdout.on("data", (chunk) => {
				buffer += decoder.write(chunk);
				while (true) {
					const idx = buffer.indexOf("\n");
					if (idx === -1) break;
					const line = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 1);
					this._handleRPCLine(line);
				}
			});

			child.on("error", (e) => {
				this._rpc = null;
				this._startPromise = null;
				reject(new Error(`pi RPC 进程启动失败: ${e.message}`));
			});

			child.on("exit", (code) => {
				this._rpc = null;
				this._rpcReady = false;
				this._startPromise = null;
				// 拒绝所有挂起请求
				for (const [id, p] of this._rpcPending) p.reject(new Error(`pi RPC 进程退出(${code})`));
				this._rpcPending.clear();
				for (const w of this._rpcAgentEnd) w();
				this._rpcAgentEnd = [];
				this._rpcCollectors = [];
			});

			// 等待模型就绪
			const deadline = Date.now() + RPC_START_TIMEOUT;
			const poll = async () => {
				if (Date.now() > deadline) {
					try { child.kill("SIGKILL"); } catch {}
					this._rpc = null;
					this._startPromise = null;
					reject(new Error("pi RPC 启动超时(模型健康检查未完成)"));
					return;
				}
				try {
					const st = await this._rpcSend({ type: "get_state" });
					if (st.success && st.data && st.data.model) {
						this._rpcReady = true;
						this._startPromise = null;
						resolve();
						return;
					}
				} catch {}
				setTimeout(poll, 800);
			};
				setTimeout(poll, 1500);
			} catch (e) {
				this._startPromise = null;
				reject(e);
			}
		});

		return this._startPromise;
	}

	// 发送 RPC 命令, 返回 response
	_rpcSend(cmd) {
		if (!this._rpc || this._rpc.exitCode !== null) {
			return Promise.reject(new Error("pi RPC 进程未运行"));
		}
		return new Promise((resolve, reject) => {
			const id = "req-" + (++this._rpcId);
			this._rpcPending.set(id, { resolve, reject });
			const payload = { ...cmd, id };
			this._rpc.stdin.write(JSON.stringify(payload) + "\n");
		});
	}

	// 处理 RPC stdout 一行
	_handleRPCLine(line) {
		let d;
		try { d = JSON.parse(line); } catch { return; }

		if (d.type === "response" && d.id) {
			const p = this._rpcPending.get(d.id);
			if (p) {
				this._rpcPending.delete(d.id);
				if (d.success) p.resolve(d);
				else p.reject(new Error(d.error || "RPC 命令失败"));
			}
			return;
		}

		if (d.type === "agent_end") {
			// pi 遇到可重试错误(如 502 upstream error)时会自动重试:
			// 第一次 agent_end 会带 willRetry=true, 此时不能收工,
			// 要等重试成功后的第二个 agent_end(willRetry=false)才算结束。
			// 否则重连后的输出就没人收集, 丢在游戏外面了。
			const willRetry = Boolean(d.willRetry);
			if (!willRetry) {
				for (const w of this._rpcAgentEnd) w(false);
				this._rpcAgentEnd = [];
			}
			return;
		}

		if (d.type === "message_end" && d.message && d.message.role === "assistant") {
			for (const c of this._rpcCollectors) c(d.message);
			return;
		}

		// 扩展 dialog 类 UI 请求: 直接取消, 避免扩展挂起
		if (d.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(d.method)) {
			try {
				this._rpc.stdin.write(JSON.stringify({ type: "extension_ui_response", id: d.id, cancelled: true }) + "\n");
			} catch {}
		}
	}

	// 确保 rpc 进程就绪(仅首次启动慢, 之后秒回)
	async _ensureReady() {
		if (this._rpcReady && this._rpc && this._rpc.exitCode === null) return;
		await this._spawnRPC();
	}

	// 确保 rpc 当前会话是玩家的会话
	async _ensureSession(player) {
		let file = this._getSessionFile(player);
		if (!file) {
			// 新会话
			await this._rpcSend({ type: "new_session" });
			const st = await this._rpcSend({ type: "get_state" });
			file = st.data && st.data.sessionFile;
			if (!file) throw new Error("无法创建新会话");
			this.sessions.set(player, file);
			this._rpcSessionFile = file;
		} else if (file !== this._rpcSessionFile) {
			// 切换到玩家的已有会话
			await this._rpcSend({ type: "switch_session", sessionPath: file });
			this._rpcSessionFile = file;
		}
		return file;
	}

	// 发送一次对话, 等待 agent_end, 收集结果
	async _promptOnce(prompt) {
		const texts = [];
		let usage = null;
		let lastMsg = null;
		const collect = (m) => {
			lastMsg = m;
			if (m.usage) usage = m.usage;
			if (m.stopReason === "stop" || m.stopReason === "length") {
				const t = (m.content || []).filter(c => c.type === "text").map(c => c.text).join("");
				if (t) texts.push(t);
			}
		};
		this._rpcCollectors.push(collect);

		// 超时保护
		let timer;
		const timeout = new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error("对话超时")), PROMPT_TIMEOUT);
		});
		const done = new Promise((resolve) => {
			this._rpcAgentEnd.push((willRetry) => {
				// 只有最终 agent_end(willRetry=false) 才算结束;
				// willRetry=true 说明 pi 正在自动重试, 继续等重试后的输出
				if (!willRetry) resolve();
			});
		});

		try {
			await this._rpcSend({ type: "prompt", message: prompt });
			await Promise.race([done, timeout]);
		} catch (e) {
			clearTimeout(timer);
			this._rpcCollectors = this._rpcCollectors.filter(c => c !== collect);
			// 超时 => 进程可能已卡住, 杀掉让下次自动重启
			if (e.message === "对话超时" && this._rpc) {
				try { this._rpc.kill("SIGKILL"); } catch {}
				this._rpc = null;
				this._rpcReady = false;
			}
			throw e;
		}
		clearTimeout(timer);
		this._rpcCollectors = this._rpcCollectors.filter(c => c !== collect);

		return {
			text: texts.join("\n").trim(),
			totalTokens: usage ? (usage.totalTokens || 0) : 0,
			stopReason: lastMsg ? lastMsg.stopReason : null,
			errorMessage: lastMsg ? lastMsg.errorMessage : null
		};
	}

	// 判断错误是否为"上下文/token 用尽"类(此时需要自动开新会话)
	_isContextError(msg) {
		if (!msg) return false;
		return /context|上下文|token limit|context_length|maximum.*token|too many tokens|输入.*过长/i.test(msg);
	}

	// ===== 核心对话逻辑 =====

	async handlePA(sender, prompt) {
		if (!this.client) return;
		this.client.tellAll("§apa§r | chat > §7pi 思考中... 喵");
		this.lastActive.set(sender, Date.now());

		// 串行入队, 防止多玩家并发破坏 rpc 会话状态
		this._enqueue(async () => {
			try {
				// Token 已用尽 => 自动创建新会话
				const used = this.tokenUsage.get(sender) || 0;
				if (this._getSessionFile(sender) && used >= TOKEN_LIMIT) {
					this.client.tellAll(`§apa§r | ${sender} > §7Token 快用完了，自动开启新会话 喵~`);
					this._startNewSession(sender);
				}

				// 确保常驻进程就绪 + 当前会话正确
				await this._ensureReady();
				await this._ensureSession(sender);

				// 判断是否为该会话的第一条消息: token 记录为 0 说明尚未聊过
				// (新会话/pa:new/自动重置后都会归 0) => 首条消息附带系统人设
				const isFresh = (this.tokenUsage.get(sender) || 0) === 0;
				// 注入玩家 ID 与权限: 仅主人(FLT18355)可让 AI 执行 bash, 其他人只能聊天
				const perm = await PermissionManager.query(sender);
				const isOwner = perm === 3;
				const permRule = isOwner
					? `当前玩家: ${sender}（主人）\n可以执行 bash 命令、读取/编辑文件, 但仅在玩家明确要求时执行。`
					: `当前玩家: ${sender}（普通玩家）\n禁止执行任何 bash 命令、系统命令或文件操作, 只能纯聊天。`;
				const styledPrompt = isFresh
					? `${AI_STYLE}\n\n${permRule}\n\n玩家的话: ${prompt}`
					: `${permRule}\n\n玩家的话: ${prompt}`;

				// 发起对话
				const r = await this._promptOnce(styledPrompt);

				// 记录 token 用量
				if (r.totalTokens > 0) {
					this.tokenUsage.set(sender, r.totalTokens);
					const prev = this.maxTokenUsage.get(sender) || 0;
					if (r.totalTokens > prev) this.maxTokenUsage.set(sender, r.totalTokens);
				}

				// 输出 AI 回复
				if (r.text) {
					this._outputText(r.text, sender);
				} else if (r.stopReason === "error") {
					this.client.tellAll(`§apa§r | ${sender} > §7pi 出错了: ${r.errorMessage || "未知错误"} 喵`);
					if (this._isContextError(r.errorMessage)) {
						this._startNewSession(sender);
						this.client.tellAll(`§apa§r | ${sender} > §7已自动创建新会话 喵~`);
					}
				} else {
					this.client.tellAll(`§apa§r | ${sender} > §7唔...pi 没有说出话呢 喵`);
				}

				// 本次回复后 Token 已用尽 => 自动创建新会话
				if (r.totalTokens >= TOKEN_LIMIT) {
					this._startNewSession(sender);
					this.client.tellAll(`§apa§r | ${sender} > §7本次对话 Token 已用尽，已自动创建新会话 喵~`);
				}
			} catch (error) {
				if (this.client) this.client.tellAll(`§apa§r | ${sender} > §7出错了: ${error.message} 喵`);
				// 进程级错误 => 下次自动重启
				if (this._rpc && this._rpc.exitCode !== null) {
					this._rpc = null;
					this._rpcReady = false;
				}
			}
		}).catch(() => {});
	}

	// 输出回复文本, 并执行 [cmd] 开头的 Minecraft 命令
	_outputText(text, sender = "") {
		const cmdRegex = /^\s*(?:\[cmd\]\s*|cmd\s+)(.+)$/i;
		const lines = text.split("\n");
		const name = (sender || "").trim() || "pa";

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (!trimmed) continue;
			const cmdMatch = line.match(cmdRegex);
			if (cmdMatch) {
				const cmd = cmdMatch[1].trim().replace(/^\//, "");
				if (this.client) {
					this.client.tellAll(`§apa§r | ${name} > §7→ /${cmd}`);
					this.client.sendCommand(cmd);
				}
			} else if (this.client) {
				this.client.tellAll(`§apa§r | ${name} > §7${trimmed}`);
			}
		}
	}

	// ===== 空闲消息 =====

	_checkIdle() {
		if (!idleEnabled || !this.client) return;
		const now = Date.now();
		for (const [player, lastTime] of this.lastActive) {
			if (now - lastTime >= 300000) {
				const msg = IDLE_MESSAGES[Math.floor(Math.random() * IDLE_MESSAGES.length)];
				this.client.tellAll(`§apa§r | ${player} > §7${msg}`);
				this.lastActive.set(player, now);
			}
		}
	}

	// ===== 命令注册 =====

	commands() {
		return {
			normal: [
				{
					name: `${this.Command.commandPrefix}pa`,
					execute: (sender, msg) => {
						const prefix = `${this.Command.commandPrefix}pa `;
						if (!msg.startsWith(prefix)) return false;
						const prompt = msg.slice(prefix.length).trim();
						if (!prompt) {
							if (this.client) this.client.tellAll(`§apa§r | ${sender} > §7要说些什么呢 喵~`);
							return { status: true };
						}

						// 首次聊天自动开启新会话
						if (!this._getSessionFile(sender)) {
							this._startNewSession(sender);
						}

						this.handlePA(sender, prompt);
						return { status: true };
					}
				},
				{
					name: `${this.Command.commandPrefix}pa:new`,
					execute: (sender, msg) => {
						if (msg !== `${this.Command.commandPrefix}pa:new`) return false;
						this._startNewSession(sender, true);
						return { status: true };
					}
				},
				{
					name: `${this.Command.commandPrefix}pa:info`,
					execute: (sender, msg) => {
						if (msg !== `${this.Command.commandPrefix}pa:info`) return false;
						const file = this._getSessionFile(sender);
						const tokens = this.tokenUsage.get(sender) || 0;
						const maxTokens = this.maxTokenUsage.get(sender) || 0;
						let piVersion = "未知";
						try {
							const res = spawnSync(PI_BIN, ["--version"], { timeout: 5000, encoding: "utf8" });
							piVersion = (res.stdout || "").trim() || (res.stderr || "").trim() || "未知";
						} catch {}
						if (!this.client) return { status: true };
						this.client.tellAll(`§apa§r | info > §7模型: ${AI_MODEL}`);
						this.client.tellAll(`§apa§r | info > §7平台: pi | Node.js ${process.version}`);
						const extNames = [];
						if (BANSOS_EXT) extNames.push("bansos");
						if (PERSONA_EXT) extNames.push("persona");
						this.client.tellAll(`§apa§r | info > §7扩展: ${extNames.length ? extNames.join(" + ") : "无"} | 常驻进程: ${this._rpc ? "运行中" : "未启动"}`);
						this.client.tellAll(`§apa§r | info > §7会话文件: ${file ? path.basename(file) : "无"}`);
						this.client.tellAll(`§apa§r | info > §7上下文窗口: ${CONTEXT_WINDOW} | Token用量: ${tokens} | 最高: ${maxTokens} | 上限: ${TOKEN_LIMIT}`);
						this.client.tellAll(`§apa§r | info > §7空闲消息: ${idleEnabled ? "开启" : "关闭"}`);
						return { status: true };
					}
				},
				{
					name: `${this.Command.commandPrefix}pa:idle`,
					execute: (sender, msg) => {
						const prefix = `${this.Command.commandPrefix}pa:idle`;
						if (msg === prefix) {
							idleEnabled = !idleEnabled;
							if (this.client) this.client.tellAll(`§apa§r | idle > §7空闲消息已${idleEnabled ? "开启" : "关闭"} 喵~`);
							return { status: true };
						}
						if (msg === `${prefix} test`) {
							const idleMsg = IDLE_MESSAGES[Math.floor(Math.random() * IDLE_MESSAGES.length)];
							if (this.client) this.client.tellAll(`§apa§r | idle > §7${idleMsg}`);
							return { status: true };
						}
						return false;
					}
				}
			],
			owner: [
				{
					name: `${this.Command.commandPrefix}pa:status`,
					execute: (sender, msg) => {
						if (msg !== `${this.Command.commandPrefix}pa:status`) return false;
						const file = this._getSessionFile(sender);
						if (file) {
							if (this.client) this.client.tellAll(`§apa§r | status > §7正在用对话: ${path.basename(file)} 喵`);
						} else {
							if (this.client) this.client.tellAll("§apa§r | status > §7还没有对话呢，说点什么开始吧 喵~");
						}
						return { status: true };
					}
				},
				{
					name: `${this.Command.commandPrefix}pa:session`,
					execute: (sender, msg) => {
						const prefix = `${this.Command.commandPrefix}pa:session`;
						if (msg !== prefix && msg !== `${prefix} clear`) return false;
						// 清空所有会话
						if (msg === `${prefix} clear`) {
							this.sessions.clear();
							this.tokenUsage.clear();
							this.maxTokenUsage.clear();
							this.lastActive.clear();
							// 释放 RPC 当前加载的会话
							if (this._rpc && this._rpc.exitCode === null) {
								try { this._rpc.kill("SIGKILL"); } catch {}
								this._rpc = null;
								this._rpcReady = false;
								this._rpcSessionFile = null;
							}
							// 删除磁盘上的会话文件
							try {
								for (const f of fs.readdirSync(SESSION_DIR)) {
									fs.unlinkSync(path.join(SESSION_DIR, f));
								}
							} catch {}
							if (this.client) this.client.tellAll("§apa§r | session > §7所有会话已清空 喵~");
							return { status: true };
						}
						// 查看当前会话数量
						const total = this.sessions.size;
						const active = [...this.sessions.values()].filter(f => f !== null).length;
						if (this.client) this.client.tellAll(`§apa§r | session > §7当前会话: 共 ${total} 个 (活跃 ${active} 个) 喵~`);
						return { status: true };
					}
				}
			]
		};
	}

	destroy() {
		clearInterval(this._idleTimer);
		clearTimeout(this._warmupTimer);
		if (this._rpc) {
			try { this._rpc.kill("SIGKILL"); } catch {}
			this._rpc = null;
		}
		this._rpcReady = false;
		this._rpcSessionFile = null;
		this._rpcPending.clear();
		this._rpcAgentEnd = [];
		this._rpcCollectors = [];
		this.sessions.clear();
		this.tokenUsage.clear();
		this.maxTokenUsage.clear();
		this.lastActive.clear();
		this.client = null;
	}
}

export default PA;
