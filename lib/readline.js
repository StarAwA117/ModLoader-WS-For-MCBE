import readline from "readline";
import * as shared from "./shared.js";
import Command from "./command.js";
import Current from "./current.js";
import { reloadConfig } from "./mods.js";

// 终端命令（内置 + 服务端 Mod 自动收集）
const commands = { normal: [], ws: [] };

let rl = null;

/**
 * 收集所有服务端 Mod 的终端命令（加载后调用一次）
 * 服务端 Mod 可定义 onCommand() 或 static onCommand()
 * 返回 { normal: [...], ws: [...] }
 */
export function collectCommands(ServerModManager, ClientModManager) {
	commands.normal = [];
	commands.ws = [];

	// 内置 p: 命令
	commands.normal.push(
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

		Command.create("p:reload", "重载所有服务端 Mod + 所有客户端 Mod 全部实例（并重新读取 config.json）")
			.setFunc(async (_) => {
				console.log(`< 正在重载所有 Mod...`);
				try {
					reloadConfig();
					console.log(`< §a配置已按 config.json 刷新`);
				} catch (e) {
					console.error(`< §c配置刷新失败: ${e.message}`);
					return;
				}
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
					serverMods.forEach(name => console.log(`  §b${name}`));
				}

				const clientMods = Object.keys(ClientModManager.loadedMod || {});
				console.log(`< 客户端 Mod (${clientMods.length}):`);
				if (clientMods.length === 0) {
					console.log("  §7无");
				} else {
					clientMods.forEach(name => console.log(`  §b${name}`));
				}
			})
	);

	// 从服务端 Mod 收集终端命令（onTerminalCommand）
	const inst = ServerModManager._instance;
	if (!inst) return;

	for (const [name, instance] of Object.entries(inst.modInstances)) {
		const commandMethod = instance.onTerminalCommand || instance.constructor?.onTerminalCommand;
		if (!commandMethod || typeof commandMethod !== "function") continue;
		try {
			const cmdMap = commandMethod.call(instance);
			if (cmdMap.normal) commands.normal.push(...cmdMap.normal);
			if (cmdMap.ws) commands.ws.push(...cmdMap.ws);
		} catch (e) {
			shared.logger.error(`Server Mod ${name} 命令收集失败`);
			shared.logger.debug(e.message);
		}
	}
}

/**
 * 获取当前所有终端命令
 */
export function getCommands() {
	return { normal: [...commands.normal], ws: [...commands.ws] };
}

/**
 * 启动终端交互监听
 */
export function start() {
	if (rl) return;
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	rl.on("line", onLine);
}

/**
 * 停止终端交互
 */
export function stop() {
	if (rl) {
		rl.close();
		rl.removeAllListeners();
		rl = null;
	}
}

/**
 * 执行命令列表（返回 true 表示已匹配）
 */
function execute(msg, cmds) {
	try {
		for (const cmd of cmds) {
			cmd.onError = (e) => {
				console.error(e.message);
				shared.logger.error(`Command ${e.message}`);
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

/**
 * 处理终端输入
 */
function onLine(input) {
	const isCommand = input.startsWith(Command.commandPrefix);

	// 执行普通命令（不需要 websocket）
	if (isCommand) {
		if (!execute(input, commands.normal)) return;
	}

	// 检测主客户端连接状态
	if (!Current.client) {
		console.log("主客户端未连接");
		return;
	}

	// 游戏命令转发（以 / 开头）
	if (input.startsWith("/")) {
		Current.client.runCommand(input).then(data => {
			console.log(`CMD ${data.body.statusCode} -> ${data.body.statusMessage || "Null"}`);
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
	if (!execute(input, commands.ws)) return;

	// 未知命令提示
	console.log(`未知的命令 ${input.split(" ")[0]}`);
}
