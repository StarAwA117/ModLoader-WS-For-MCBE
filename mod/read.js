import readline from "readline";
import { spam } from "../config.js";
import Command from "../lib/command.js";
import Current from "../lib/current.js";
import { ServerModManager, ClientModManager } from "../lib/mods.js";

// 清屏文本
const CLEAR_TEXT = "\n§r\n".repeat(31);

// 终端读取类
// 监听标准输入，提供终端级别的命令执行和消息发送功能
// 支持游戏命令转发、聊天刷屏、Lumine 广告推送等
export default class Read {
	// 0 值替换
	static replaceZeros(str) {
		const chars = [];
		for (let i = 33; i <= 126; i++) {
			if (i < 48 || i > 57) chars.push(String.fromCharCode(i));
		}
		for (let i = chars.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[chars[i], chars[j]] = [chars[j], chars[i]];
		}
		let idx = 0;
		return str.replace(/0/g, () => {
			if (idx >= chars.length) idx = 0;
			return chars[idx++];
		});
	}

	// 通用刷屏启动方法
	static startSpam(interval, generator, logMessage) {
		if (Current.has("loop")) clearInterval(Current.get("loop"));
		console.log(`< ${logMessage}`);
		Current.set("loop", setInterval(generator, interval));
	}

	// 命令定义
	static commands = {
		// 进程命令
		normal: [
			Command.create("test", "测试命令")
			.setFunc((_) => {
				console.log("< 测试成功");
			}),

			Command.create("p:list", "列出所有连接（主客户端 + IP 或 编号 + IP）")
			.setFunc((_) => {
				if (Current.clientMods.size === 0) {
					console.log("< 无已连接客户端");
					return;
				}
				console.log(`< 当前连接 (${Current.clientMods.size}):`);
				let index = 0;
				for (const [ws] of Current.clientMods) {
					index += 1;
					const isMain = ws === Current.client ? "主客户端" : `编号 ${index}`;
					const ip = ws._socket?.remoteAddress || "未知 IP";
					console.log(`  §b${isMain} §f- §e${ip}`);
				}
			}),

			Command.create("p:reload", "重载所有服务端 Mod + 所有客户端 Mod 全部实例")
			.setFunc(async (_) => {
				console.log(`< 正在重载所有 Mod...`);
				const serverResult = await ServerModManager.reloadAll();
				console.log(`< §a服务端成功: ${serverResult.success.join(", ") || "无"}`);
				if (serverResult.failed.length > 0) {
					console.error(`< §c服务端失败: ${serverResult.failed.join(", ")}`);
				}

				const clientResult = await ClientModManager.reloadAllClients();
				console.log(`< §a客户端成功: ${clientResult.success.length || 0} 个实例`);
				if (clientResult.failed.length > 0) {
					console.error(`< §c客户端失败:`);
					clientResult.failed.forEach(f => console.error(`  §c${f}`));
				}
			}),

			Command.create("p:mod", "列出所有服务端 Mod 与客户端 Mod")
			.setFunc((_) => {
				const serverMods = ServerModManager.getLoadedModNames();
				console.log(`< 服务端 Mod (${serverMods.length}):`);
				if (serverMods.length === 0) {
					console.log("  §7无");
				} else {
					serverMods.forEach(name => {
						console.log(`  §b${name}`);
					});
				}

				const clientMods = Object.keys(ClientModManager.loadedMod || {});
				console.log(`< 客户端 Mod (${clientMods.length}):`);
				if (clientMods.length === 0) {
					console.log("  §7无");
				} else {
					clientMods.forEach(name => {
						console.log(`  §b${name}`);
					});
				}
			})
		],

		// WebSocket 级别命令（终端专用）
		ws: [
			Command.create("bye", "强制退出当前房间 (WebSocket 专用)")
			.setFunc((_) => {
				// 发送大量重复文本触发断开
				Current.client.utils.sendCommandUnsafe("/me 正在尝试退出...".repeat(100) + "退出失败");
			}),

			Command.create("testx", "小测试 (WebSocket 专用)")
			.setFunc((_) => {
				// 发送大量重复文本触发断开
				Current.client.utils.sendCommandUnsafe("/me testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttestte");
			}),

			Command.create("c:attack", "攻击客户端聊天")
			.setFunc((_) => {
				Read.startSpam(10, () => {
					Current.client.sendCommand(`me ${Read.replaceZeros(spam.attack)}`);
				}, "正在攻击客户端聊天…");
			}),

			Command.create("c:count", "聊天室倒计时")
			.setFunc((_) => {
				let count = 10;
				Read.startSpam(1_000, () => {
					if (count <= 0) {
						clearInterval(Current.get("loop"));
						console.log("< 倒计时结束");
						return;
					}
					Current.client.tellAll(`§uLUMINEPROXY TOP! §l§cTHIS SERVER WILL CRASH IN ${count} SECONDS!`);
					count -= 1;
				}, "正在进行倒计时…");
			}),

			Command.create("c:crash", "崩溃客户端聊天")
			.setFunc((_) => {
				let count = 10;
				Read.startSpam(1_000, () => {
					if (count <= 0) {
						clearInterval(Current.get("loop"));
						console.log("< 正在进行崩溃…");
						// 倒计时结束后启动攻击
						Read.startSpam(10, () => {
							Current.client.sendCommand(`me ${Read.replaceZeros(spam.attack)}`);
						}, "正在进行崩溃攻击…");
						return;
					}
					Current.client.tellAll(`§uLUMINEPROXY TOP! §l§cTHIS SERVER WILL CRASH IN ${count} SECONDS!`);
					count -= 1;
				}, "正在进行倒计时…");
			}),

			Command.create("c:clear", "清屏聊天消息")
			.setFunc((_) => {
				Read.startSpam(50, () => {
					for (let i = 0; i < 8; i++) {
						Current.client.tellAll(CLEAR_TEXT);
					}
				}, "正在为客户端聊天清屏…");
			}),

			Command.create("c:ad", "推送广告")
			.setFunc((_) => {
				Read.startSpam((spam.adInterval || 60000), () => {
					Current.client.tellAll(`${spam.ad[Math.floor(Math.random() * spam.ad.length)]}`);
				}, "正在为客户端推送 LUMINE AD…");
			}),

			Command.create("c:repeat", "刷屏指定内容")
			.addString("刷屏内容", true)
			.setFunc((_, text) => {
				Read.startSpam(50, () => {
					Current.client.tellAll(text);
				}, "正在为刷屏客户端…");
			}),

			Command.create("c:stop", "停止所有刷屏")
			.setFunc((_) => {
				if (Current.has("loop")) clearInterval(Current.get("loop"));
				Current.set("loop", null);
				console.log("< 已停止客户端刷屏");
			}),

			Command.create("c:line", "换行发言")
			.addString("发言内容", true)
			.setFunc((_, text) => {
				// 在消息前插入换行以实现换行效果
				Current.client.tellAll(`
§r
${text}`);
			})
		]
	};
	static rl = null;

	// 启动终端交互监听
	static start() {
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});
		this.rl.on("line", (input) => this.read(input));
	}

	// 处理终端输入
	static read(input) {
		const isCommand = input.startsWith(Command.commandPrefix);

		// 执行普通命令
		if (isCommand) {
			let result = this.execute(input, this.commands.normal);
			if (!result) return;
		}

		// 检测主客户端连接状态
		if (!Current.client) {
			console.log("主客户端未连接");
			return;
		}

		// 游戏命令转发（以 / 开头）
		if (input.startsWith("/")) {
			Current.client.runCommand(input).then(data => {
				console.log(`CMD ${data.body.statusCode} -> ${data.body.statusMessage ? data.body.statusMessage : "Null"}`);
			}).catch(e => {
				console.error(`CMD 执行失败: ${e.message}`);
			});
			return;
		}

		// 非命令文本作为聊天消息发送
		if (!isCommand) {
			Current.client.tellAll(input);
			return;
		}

		// 执行 WebSocket 级别命令
		let result = this.execute(input, this.commands.ws);
		if (!result) return;

		// 未知命令提示
		console.log(`未知的命令 ${input.split(" ")[0]}`);
	}

	// 命令执行
	static execute(msg, cmds) {
		try {
			for (const cmd of cmds) {
				// 异步命令出错时输出到终端
				cmd.onError = (e) => {
					console.error(e.message);
					if (this.logger) this.logger.error(`Command ${e.message}`);
				};

				const result = cmd.execute("Terminal", msg);

				if (result) {
					if (!result.status && result.message) console.error(result.message);
					return false;
				}
			}
		} catch (e) {
			console.error(e.message);
			return false;
		}

		return true;
	}

	// 销毁方法 - 关闭 readline 接口
	// 必须先 close 再 removeAllListeners：readline 的 close 会清理 stdin 上的 data 监听器
	// 若先 removeAllListeners 清空内部回调，close 无法移除 stdin 监听，reload 后会出现重复回显（如输入 1 显示 11）
	static onDestroy() {
		if (this.rl) {
			this.rl.close();
			this.rl.removeAllListeners();
			this.rl = null;
		}
		// 清理刷屏定时器，防止 reload 或关闭后定时器继续回调导致崩溃/重复刷屏
		if (Current.has("loop")) {
			clearInterval(Current.get("loop"));
			Current.set("loop", null);
		}
	}
}
