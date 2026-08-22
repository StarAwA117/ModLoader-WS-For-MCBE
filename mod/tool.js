import { exec } from "child_process";
import Command from "../lib/command.js";
import Current from "../lib/current.js";
import PermissionManager from "../lib/permission.js";
import QQ from "./qq/main.js";
import { ServerModManager, ClientModManager, reloadConfig } from "../lib/mods.js";

export default class Tool {
	/**
	 * 格式化命令帮助列表
	 * @param {Array} commands - 命令对象数组
	 * @param {number} page - 页码（从 1 开始）
	 * @param {number} perPage - 每页显示数量
	 * @param {string} navCommand - 翻页导航命令（不含页码，默认 t:help，如搜索传 t:search 关键词）
	 * @param {string} title - 列表标题（默认为 "命令帮助"）
	 * @returns {string[]} 格式化后的帮助信息行
	 */
	static formatHelp(commands, page = 1, perPage = 5, navCommand = "t:help", title = "命令帮助") {
		const prefix = Command.commandPrefix;
		const sorted = [...commands].sort((a, b) => {
			if (a.name === "t:help") return -1;
			if (b.name === "t:help") return 1;
			return a.name.localeCompare(b.name);
		});

		const total = sorted.length;
		const totalPages = Math.max(1, Math.ceil(total / perPage));
		const p = Math.min(Math.max(1, page), totalPages);
		const start = (p - 1) * perPage;
		const pageItems = sorted.slice(start, start + perPage);

		const lines = [];
		lines.push(`§d─── ${prefix}${title} §f[${p}/${totalPages}] §d───`);

		for (const cmd of pageItems) {
			const desc = cmd.description || "§7无描述";
			lines.push(`§c${prefix}${cmd.name} §f- §b${desc}`);
			if (cmd.parameters && cmd.parameters.length > 0) {
				const paramStr = cmd.parameters.map(p => {
					const [type, desc] = p;
					const optional = p[2];
					const typeName = typeof type === "object" ? type.join("|") : type;
					const descPart = desc ? ` §7${desc}` : "";
					return optional ? `§u(${typeName}§u)${descPart}` : `§b${typeName}${descPart}`;
				}).join(" ");
				lines.push(`  §iParams: ${paramStr}`);
			}
		}

		if (p < totalPages) {
			lines.push(`§7输入 ${prefix}${navCommand} ${p + 1} 查看下一页`);
		}
		return lines;
	}

	constructor(client) {
		this.client = client;
	}

	onCommand() {
		return {
			normal: [
				Command.create("t:help", "查看命令帮助")
				.addOptionalInteger("页码", false)
				.setFunc(async (sender, page) => {
					const perm = await PermissionManager.query(sender);
					if (perm instanceof Error) {
						this.client.tell(`§cTool | §fError > §i权限查询失败`, sender);
						return;
					}

					const cmdMap = this.client.clientMod.commands;
					let cmds = [...cmdMap.normal];

					if (perm >= 1) cmds.push(...cmdMap.user);
					if (perm >= 2) cmds.push(...cmdMap.op);
					if (perm >= 3) cmds.push(...cmdMap.owner);

					const lines = Tool.formatHelp(cmds, page || 1, 5);
					lines.forEach(line => this.client.tell(line, sender));
				}),

				Command.create("t:search", "搜索命令")
				.addString("关键词", true)
				.addOptionalInteger("页码", false)
				.setFunc(async (sender, keyword, page) => {
					const perm = await PermissionManager.query(sender);
					if (perm instanceof Error) {
						this.client.tell(`§cTool | §fError > §i权限查询失败`, sender);
						return;
					}

					const cmdMap = this.client.clientMod.commands;
					let cmds = [...cmdMap.normal];

					if (perm >= 1) cmds.push(...cmdMap.user);
					if (perm >= 2) cmds.push(...cmdMap.op);
					if (perm >= 3) cmds.push(...cmdMap.owner);

					const kw = keyword.toLowerCase();
					const matched = cmds.filter(cmd =>
						(cmd.name && cmd.name.toLowerCase().includes(kw)) ||
						(cmd.description && cmd.description.toLowerCase().includes(kw))
					);

					if (!matched.length) {
						this.client.tell(`§cTool | §fSearch > §i没有找到与 "${keyword}" 相关的命令`, sender);
						return;
					}

					const lines = Tool.formatHelp(matched, page || 1, 5, `t:search ${keyword}`, `命令搜索 "${keyword}"`);
					lines.forEach(line => this.client.tell(line, sender));
				})
			],

			op: [
				Command.create("t:send", "向外部发送消息")
				.addString("消息内容", true)
				.setFunc((_, text) => {
					this.client.tellAll(text);
				}),

				Command.create("t:tellall", "查看/切换本客户端 tellAll 转发模式")
				.addBoolean("模式 (true=转发为 tell false=原样)", true)
				.setFunc((sender, mode) => {
					const utils = this.client.utils;
					if (!utils || typeof utils.setTellAllMode !== "function") {
						this.client.tell("§cTool | §fError > §i当前客户端不支持此设置", sender);
						return;
					}
					// 未提供参数：显示当前模式
					if (mode === undefined) {
						const cur = utils.getTellAllMode();
						this.client.tell(`§eTool | §fTellAll > §i当前 ${cur ? "转发为 tell" : "按原样广播"}`, sender);
						return;
					}
					utils.setTellAllMode(mode);
					this.client.tell(`§eTool | §fTellAll > §i已${mode ? "开启转发" : "恢复原样"}`, sender);
				}),

				Command.create("t:cmd", "执行基岩版命令")
				.addString("命令内容", true)
				.setFunc(async (_, command) => {
					try {
						const data = await this.client.runCommand(command);
						const status = data?.body?.statusCode;
						const msg = data?.body?.statusMessage || "无返回消息";
						this.client.tellAll(`§eTool | §fCommand > §i[${status}] ${msg}`);
					} catch (e) {
						this.client.tellAll(`§cTool | §fError > §i命令执行失败: ${e.message}`);
					}
				})
			],

			owner: [
				Command.create("t:ping", "检测与服务器的延迟")
				.setFunc(() => {
					const start = Date.now();
					this.client.runCommand("list").then(() => {
						const ms = Date.now() - start;
						this.client.tellAll(`§eTool | §fPing > §i${ms}ms`);
					}).catch(() => {
						this.client.tellAll(`§cTool | §fError > §i命令执行失败`);
					});
				}),

				Command.create("t:time", "查看当前时间（北京时间）")
				.setFunc((sender) => {
					const bj = new Date(Date.now() + 8 * 3600 * 1000);
					const pad = (n) => String(n).padStart(2, "0");
					const date = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`;
					const time = `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`;
					this.client.tell(`§eTool | §fTime > §i${date} ${time}`, sender);
				}),

				Command.create("t:start", "重新开始 SAPI 轮询")
				.setFunc(async (sender) => {
					// 重置当前客户端与主客户端的统一 SAPI 轮询器
					const hubs = new Set();
					const localHub = this.client.clientMod?.sapi;
					const mainHub = Current.client?.clientMod?.sapi;
					if (localHub) hubs.add(localHub);
					if (mainHub) hubs.add(mainHub);

					for (const hub of hubs) {
						hub.commandExists = null;
						hub.start();
					}

					this.client.tell(`§eTool | §fSAPI > §i已重新开始 ${hubs.size} 个 SAPI 轮询器`, sender);
				}),

				Command.create("t:move", "将当前客户端设为主客户端")
				.setFunc((sender) => {
					if (this.client === Current.client) {
						this.client.tell(`§cTool | §fError > §i你已经是主客户端`, sender);
						return;
					}

					const oldMods = Current.clientMods.get(Current.client);
					if (oldMods) {
						oldMods.destroy();
						Current.clientMods.delete(Current.client);
					}

					try {
						Current.client.close();
					} catch {}

					Current.client = this.client;
					QQ.setMainClient(this.client);
					// 主客户端切换后重新挂载服务端 Mod 的 SAPI
					ServerModManager.attachMainClient(this.client);

					this.client.tellAll(`§eTool | §fMove > §i主客户端已切换至 ${sender}`);
				}),

				Command.create("t:reload", "重载客户端 Mod（带名称重载单个，不带重载全部客户端）")
				.addOptionalString("Mod 名称")
				.setFunc(async (sender, modName) => {
					const client = this.client;
					// 先按磁盘最新 config.json 刷新内存配置（支持运行中改文件后热更新）
					try {
						reloadConfig();
					} catch (e) {
						client.tell(`§cTool | §fError > §i配置刷新失败: ${e.message}`, sender);
						return;
					}
					if (modName) {
						const manager = client.clientMod;
						if (!manager || typeof manager.reload !== "function") {
							client.tell("§cTool | §fError > §i无法重载：客户端 Mod 管理器不可用", sender);
							return;
						}
						const result = await manager.reload(modName);
						client.tellAll(`§eTool | §fReload > §i${result.message}`);
					} else {
						const result = await ClientModManager.reloadAllClients();
						client.tellAll(`§eTool | §fReload > §i客户端 Mod 全量重载完成 成功: ${result.success.length || 0} 失败: ${result.failed.length || 0}`);
						if (result.failed.length > 0) {
							result.failed.forEach(f => client.tellAll(`§cTool | §fError > §i${f}`));
						}
					}
				}),

				Command.create("t:mod", "显示所有客户端 Mod")
				.setFunc((sender) => {
					const client = this.client;
					const modNames = Object.keys(ClientModManager.loadedMod || {});
					client.tell(`§eTool | §fMods > §i共 ${modNames.length} 个`, sender);
					if (modNames.length === 0) {
						client.tell("§i无", sender);
					} else {
						modNames.forEach(name => client.tell(`§f${name}`, sender));
					}
				}),

				Command.create("t:exec", "在服务器终端执行命令")
				.addString("命令内容", true)
				.setFunc((_, command) => {
					exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
						const output = stdout || stderr || "";
						const lines = output.split("\n").filter(l => l.length > 0);

						this.client.tellAll(`§eTool | §fexec > §i共 ${lines.length} 行`);
						if (lines.length === 0) {
							this.client.tellAll("§i(无输出)");
							return;
						}

						lines.forEach(line => this.client.tellAll(line));
					});
				})
			]
		};
	}

	onDestroy() {
		this.client = null;
	}
}
