import fs from "fs";
import path from "path";
import Command from "../lib/command.js";

// Minecraft 函数文件执行类
// 支持加载和执行 .mcfunction 格式的指令文件，支持嵌套调用和循环执行
export default class MCFunc {
	constructor(client) {
		this.client = client;
		// 存储循环执行的定时器
		this.loops = new Map();
	}

	// 返回命令定义
	onCommand() {
		return {
			op: [
				Command.create("f:function", "运行 Function 文件")
				.addString("文件路径", true)
				.setFunc((_, filePath) => {
					this.run(filePath);
				}),

				Command.create("f:loop", "循环运行 Function")
				.addString("文件路径", true)
				.addString("循环名称", true)
				.addFloat("间隔秒数", true)
				.setFunc((_, filePath, name, interval) => {
					this.loop(filePath, name, interval);
				}),

				Command.create("f:stop", "停止循环（不带参数停止所有）")
				.addOptionalString("循环名称")
				.setFunc((_, name) => {
					this.stop(name);
				})
			]
		};
	}

	// 加载函数文件
	// 返回按行分割的指令数组，失败返回 false
	async load(fileName) {
		try {
			const file = await fs.promises.readFile(path.join(this.config.basePath.mcfunc, fileName), "utf-8");
			const commands = file.split("\n");
			return commands;
		} catch {
			return false;
		}
	}

	// 执行函数文件
	// deep: 当前嵌套深度（防止无限递归，上限 16）
	// commands: 已加载的指令数组（首次调用时为 null，内部加载）
	async run(fileName, deep = 0, commands = null) {
		if (!commands) {
			commands = await this.load(fileName);

			if (!commands) {
				this.client.tellAll(`§cMCFunc | §fError > §i函数文件 "${fileName}" 加载失败`);
				return;
			}

			if (deep === 0) {
				this.client.tellAll(`§eMCFunc | §fRun > §i函数文件 "${fileName}" 已运行`);
			}
		}
		

		// 嵌套深度限制
		if (deep >= 16) return;

		for (const command of commands) {
			// 跳过注释行（以 # 开头）
			if (command.startsWith("#")) continue;

			// 嵌套调用其他函数文件
			if (command.startsWith("function ")) {
				await this.run(command.slice("function ".length), deep + 1);
				continue;
			}

			// 执行普通指令
			await this.client.sendCommand(command);
		}
	}

	// 循环执行函数文件
	// loopName: 循环标识名称
	// loopInterval: 循环间隔（秒），未指定则默认 50ms（1 游戏刻）
	async loop(fileName, loopName = null,  loopInterval = null) {
		// 未指定名称时使用文件名作为循环名
		if (!loopName) loopName = fileName;

		const commands = await this.load(fileName);

		if (!commands) {
			this.client.tellAll(`§cMCFunc | §fError > §i函数文件 "${fileName}" 加载失败`);
			return;
		}

		// 检查循环名是否已存在
		if (this.loops.has(loopName)) {
			this.client.tellAll(`§cMCFunc | §fError > §i循环 "${loopName}" 已存在`);
			return;
		}

		// 默认间隔 50ms（1 游戏刻），否则将秒转换为毫秒（负数/异常值按 0 处理，避免 setInterval 空转）
		if (!loopInterval || !(loopInterval > 0)) {
			loopInterval = 50;
		} else {
			loopInterval *= 1000;
		}

		this.client.tellAll(`§eMCFunc | §fLoop > §i循环 "${loopName}" 已开启`);

		// 创建定时器循环执行
		this.loops.set(loopName, setInterval(async () => {
			await this.run(fileName, 0, commands);
		}, loopInterval));
	}

	// 停止循环
	// loopName: 指定循环名停止，为 null 时停止全部
	stop(loopName = null) {
		if (loopName === null || loopName === undefined) {
			// 停止所有循环
			for (let loop of this.loops.values()) {
				clearInterval(loop);
			}

			this.loops.clear();
			this.client.tellAll(`§eMCFunc | §fLoop > §i已停止所有循环`);
			return;
		}

		if (this.loops.has(loopName)) {
			let loop = this.loops.get(loopName);
			clearInterval(loop);
			this.loops.delete(loopName);

			this.client.tellAll(`§eMCFunc | §fLoop > §i循环 "${loopName}" 已关闭`);
		} else {
			this.client.tellAll(`§cMCFunc | §fError > §i循环 "${loopName}" 不存在`);
		}
	}

	// 销毁方法 - 停止所有循环并释放引用
	onDestroy() {
		this.stop();
		this.client = null;
	}
}


