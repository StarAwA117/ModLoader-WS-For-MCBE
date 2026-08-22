import OpenAI from "openai";

// OpenAI 客户端（无密钥时不构造，chat 时给出明确报错）
let openai = null;

// AI 对话类
// 通过 OpenAI 兼容接口与 AI 模型交互，支持单次对话和上下文对话模式
export default class AIHelper {
	// 玩家数据存储
	// 结构: Map<玩家名, { lastAIChat: number, AIChatContents: Array, AICommandContents: Array }>
	static playerData = new Map();

	// 注入的配置（启动时由 mods.js 设置）
	static config = null;

	// 清理定时器
	static cleanupInterval = null;

	// 启动自动清理
	// 注意：不绑定具体客户端，实时取当前主客户端，避免主客户端重连后清理逻辑对着已断开连接空转
	static startCleanup() {
		if (AIHelper.cleanupInterval) return;

		AIHelper.cleanupInterval = setInterval(() => {
			const client = AIHelper.Current.client;
			if (!client) return;

			// 获取当前在线玩家列表
			const onlinePlayers = new Set();
			client.runCommand("list").then(data => {
				const playersRaw = data?.body?.players;
				if (playersRaw && playersRaw !== "") {
					playersRaw.split(", ").forEach(name => onlinePlayers.add(name));
				}

				// 销毁不在线玩家的数据
				for (const [name] of AIHelper.playerData) {
					if (!onlinePlayers.has(name)) {
						AIHelper.playerData.delete(name);
					}
				}
			}).catch(() => {});
		}, 45_000);
	}

	// 停止自动清理
	static stopCleanup() {
		if (AIHelper.cleanupInterval) {
			clearInterval(AIHelper.cleanupInterval);
			AIHelper.cleanupInterval = null;
		}
	}

	// 销毁（服务端关闭时调用）
	static onDestroy() {
		AIHelper.stopCleanup();
		AIHelper.playerData.clear();
	}

	// 获取或创建玩家数据
	static getPlayerData(name) {
		if (!AIHelper.playerData.has(name)) {
			AIHelper.playerData.set(name, {
				lastAIChat: 0,
				AIChatContents: [],
				AICommandContents: []
			});
		}
		return AIHelper.playerData.get(name);
	}

	// 聊天方法（sendMsg: 用户输入, mode: 模式, contents: 上下文）
	static async chat(sendMsg, mode, contents = null) {
		if (!AIHelper.config || !AIHelper.config.options || !AIHelper.config.models) throw new Error("AI 配置未加载");

		// 惰性初始化 OpenAI 客户端（避免模块加载时即依赖配置）
		if (!openai && AIHelper.config.options?.apiKey) {
			openai = new OpenAI(AIHelper.config.options);
		}

		if (!AIHelper.config.models[mode]) throw new Error("该模式不存在");
		const sendData = JSON.parse(JSON.stringify(AIHelper.config.models[mode]));

		// 上文模式下将历史对话追加到请求中（过滤缺失 content 的异常历史，避免报 missing field）
		if (contents) {
			const validContents = contents.filter(msg => typeof msg?.content === "string");
			sendData.messages.push(...validContents);
		}

		// 追加当前用户消息
		sendData.messages.push({
			role: "user",
			content: sendMsg
		});

		if (!openai) throw new Error("未配置 AI apiKey，请在 config.json 中填写");
		const completion = await openai.chat.completions.create(sendData);

		// 提取回复内容（兼容字符串、数组及推理模型返回值）
		const rawContent = completion.choices?.[0]?.message?.content;
		const returnMsg = (() => {
			if (typeof rawContent === "string") return rawContent;
			if (Array.isArray(rawContent)) {
				return rawContent.map(part => part?.text ?? "").join("");
			}
			return completion.choices?.[0]?.message?.reasoning_content ?? "";
		})();

		// 上文模式下保存本次对话并限制历史长度
		if (contents) {
			contents.push({
				role: "user",
				content: sendMsg
			}, {
				role: "assistant",
				content: returnMsg ?? ""
			});
			if (contents.length > 40) contents.splice(0, contents.length - 40);
		}

		return returnMsg;
	}

	// 构造函数
	constructor(client) {
		this.client = client;
		AIHelper.startCleanup();
	}

	// 返回命令定义
	onCommand() {
		return {
			normal: [
this.Command.create("ai", "与 AI 进行对话")
				.addString("对话内容", true)
				.setFunc(async (commander, text) => {
					await this.chat(text, commander);
				}),

this.Command.create("ai:reset", "重置对话上下文")
				.setFunc(commander => {
					this.reset(commander);
					this.client.tellAll(`§eAI | §fSystem > §i对话上下文已重置`);
				})
			],

			op: [
this.Command.create("ai:c", "让 AI 执行基岩版命令")
				.addString("对话内容", true)
				.setFunc(async (commander, text) => {
					await this.command(text, commander);
				})
			]
		}
	}

	// 冷却检查函数
	cooldownTest(name) {
		const data = AIHelper.getPlayerData(name);
		const now = Date.now();
		const lastTime = data.lastAIChat || 0;

		// 发言过快检测（先判定，通过后再更新时间，避免冷却被每次失败发言后移）
		if (now - lastTime < AIHelper.config.chatCooldown) {
			this.client.tellAll(`§cAI | §fCooldown > §i聊天速度过快`);
			return false;
		}

		data.lastAIChat = now;
		return true;
	}

	// 聊天方法
	async chat(sendMsg, name) {
		if (!this.cooldownTest(name)) return;

		const data = AIHelper.getPlayerData(name);
		const contents = data.AIChatContents;

		try {
			const result = await AIHelper.chat(sendMsg, "chat", contents);
			this.client.tellAll(`§bAI | §f${name} > §i${result}`);
		} catch (e) {
			this.client.tellAll(`§cAI | §fError > §i${e.message}`);
		}
	}

	// 命令方法
	async command(sendMsg, name) {
		if (!this.cooldownTest(name)) return;

		const data = AIHelper.getPlayerData(name);
		const contents = data.AICommandContents;

		try {
			let result = await AIHelper.chat(sendMsg, "command", contents);
			result = result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
			const resultObject = JSON.parse(result);
			this.client.tellAll(`§bAI | §f${name} > §i${resultObject.message}`);
			resultObject.commands.forEach(command => {
				this.client.sendCommand(command);
				this.client.tellAll(`§bAI | §fCommand > §i${command.startsWith("/") ? command : "/" + command}`);
			});
		} catch (e) {
			this.client.tellAll(`§cAI | §fError > §i${e.message}`);
		}
	}

	// 清空对话上下文
	reset(name) {
		const data = AIHelper.getPlayerData(name);
		data.AIChatContents = [];
		data.AICommandContents = [];
	}

	// 销毁方法
	onDestroy() {
		AIHelper.stopCleanup();
		this.client = null;
	}
}
