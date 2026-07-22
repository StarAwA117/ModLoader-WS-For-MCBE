const shared = require("./shared.js");
const { track, commandPrefix, mods } = require("../config.js");
const Current = require("./current.js");
const Command = require("./command.js");
const PermissionManager = require("./permission.js");

// 客户端 Mod 管理器
// 每个客户端连接创建一个实例，管理该连接的所有客户端 Mod
class ClientModManager {
	// 存储已加载的 Mod 类定义（静态，全局共享）
	static loadedMod = {};

	// 静态加载方法 - 从配置中读取 Mod 路径并 require 加载
	static load() {
		Object.entries(mods.client).forEach(mod => {
			try {
				const modClass = require(mod[1]);
				this.loadedMod[mod[0]] = modClass;
				shared.logger.info(`Client Mod ${mod[0]} 已加载`);
			} catch (e) {
				shared.logger.error(`Client Mod ${mod[0]} 加载失败`);
				if (track) shared.logger.debug(e.message);
			}
		});
	}

	// 构造函数 - 为指定客户端实例化所有已加载的 Mod
	constructor(client) {
		this.client = client;
		// 存储 Mod 实例（键为 Mod 名）
		this.modInstances = {};
		// 按权限等级分类存储 Mod 注册的命令
		this.commands = {
			normal: [],	// 所有用户可用（不含 Blocker）
			user: [],	// User 以上权限可用
			op: [],	//  OP 以上权限可用
			owner: []	// 仅 Owner 权限可用
		};

		// 实例化所有 Mod
		this.instantiate();

		// 注册消息监听
		this.message();
	}

	// Mod 实例化
	// 遍历已加载的 Mod 类，创建实例并收集命令
	instantiate() {
		Object.entries(ClientModManager.loadedMod).forEach(mod => {
			try {
				// 创建 Mod 实例，传入当前客户端连接
				const instance = new mod[1](this.client);
				this.modInstances[mod[0]] = instance;
				// 将实例挂载到 client 对象上，便于命令中访问
				this.client[mod[0]] = instance;

				// 检查 Mod 是否导出 commands 方法
				if (!instance.commands || typeof instance.commands !== "function") return;

				// 获取命令映射表 { normal: [...], user: [...], op: [...] }
				const cmdMap = instance.commands();

				// 按权限等级合并命令到管理器
				Object.keys(cmdMap).forEach(key => {
					const cmdList = cmdMap[key];
					if (!Array.isArray(cmdList)) return;
					if (this.commands[key]) this.commands[key].push(...cmdList);
				});

			} catch (e) {
				shared.logger.error(`Client Mod ${mod[0]} 实例化失败`);
				if (track) shared.logger.debug(e.message);
			}
		});
	}

	// 消息订阅与处理
	// 监听 PlayerMessage 事件，根据权限等级执行对应命令
	message() {
		this.client.subscribe("PlayerMessage", async (data) => {
			// 提取消息字段
			const sender = data.body.sender;
			const msg = data.body.message;
			const type = data.body.type;

			// 过滤非法消息
			if (!msg || !type || !sender) return;

			// 记录消息日志
			this.log(sender, msg, type);

			// 仅处理 chat 类型且长度小于 256 的消息
			if (type !== "chat" || msg.length >= 256) return;

			// 检查消息是否以命令前缀开头
			if (!msg.startsWith(commandPrefix)) return;

			// 查询发送者权限
			const permission = await PermissionManager.query(sender);

			// 权限查询出错
			if (permission instanceof Error) {
				this.client.tellAll(`Permission ${permission.message}`);
				return;
			}

			// Blocker 黑名单用户直接拒绝
			if (permission < 0) {
				this.client.tell(`§c命令权限错误`, sender);
				return;
			}

			// 执行 Normal 级别命令（所有用户可用）
			if (!this.execute(sender, msg, this.commands.normal)) return;

			// 以下命令需要 User 以上权限
			if (permission < 1) {
				this.client.tell(`§c未知的命令 ${msg.split(" ")[0]} -> 权限受限下`, sender);
				return;
			}

			// 执行 User 级别命令
			if (!this.execute(sender, msg, this.commands.user)) return;

			// 以下命令需要 OP 以上权限
			if (permission < 2) {
				this.client.tell(`§c未知的命令 ${msg.split(" ")[0]} -> 权限受限下`, sender);
				return;
			}

			// 执行 OP 级别命令
			if (!this.execute(sender, msg, this.commands.op)) return;

			// 以下命令需要 Owner 权限
			if (permission < 3) {
				this.client.tell(`§c未知的命令 ${msg.split(" ")[0]} -> 权限受限下`, sender);
				return;
			}

			// 执行 Owner 级别命令
			if (!this.execute(sender, msg, this.commands.owner)) return;

			// 无匹配命令时提示未知命令
			this.client.tell(`§c未知的命令 ${msg.split(" ")[0]}`, sender);
		});
	}

	// 消息日志记录（仅记录主客户端的 chat 消息）
	log(sender, msg, type) {
		switch (type) {
			case "chat":
				if (this.client === Current.client) shared.messageLogger.log(`<${sender}> ${msg}`);
				break;
			// 其他消息类型暂不记录
		}
	}

	// 遍历命令列表并执行匹配的命令
	// 返回 false 表示命令已匹配并执行，true 表示无匹配
	execute(sender, msg, cmds) {
		try {
			for (const cmd of cmds) {
				const result = cmd.execute(sender, msg);

				if (result) {
					// 命令执行出错时通知发送者
					if (!result.status && result.message) this.client.tell(`Command §c${result.message}`, sender);
					return false;
				}
			}
		} catch (e) {
			this.client.tellAll(`ModCMD Error §c${e.message}`);
			return false;
		}

		return true;
	}

	// 销毁方法 - 清理所有 Mod 实例并释放资源
	destroy() {
		Object.entries(this.modInstances).forEach(mod => {
			// 调用 Mod 的 destroy 方法（如果存在）
			if (mod[1].destroy && typeof mod[1].destroy === "function") {
				mod[1].destroy();
			}
			// 清除 client 上的 Mod 引用
			this.client[mod[0]] = null;
		});

		this.client = null;
		this.modInstances = {};
		this.commands = {};
	}
}

// 服务端 Mod 管理器
// 静态单例，管理服务端级别的 Mod（不随客户端连接创建）
class ServerModManager {
	// 存储已加载的 Mod 类定义
	static loadedMod = {};

	// 静态加载方法 - 从配置中读取服务端 Mod 路径并加载
	static load() {
		Object.entries(mods.server).forEach(mod => {
			try {
				const modClass = require(mod[1]);
				this.loadedMod[mod[0]] = modClass;

				// 调用 Mod 的 start 方法（如果存在）
				if (modClass.start && typeof modClass.start === "function") {
					modClass.start();
				}

				shared.logger.info(`Server Mod ${mod[0]} 已加载`);
			} catch (e) {
				shared.logger.error(`Server Mod ${mod[0]} 加载失败`);
				if (track) shared.logger.debug(e.message);
			}
		});
	}

	// 静态销毁方法 - 遍历并销毁所有已加载的服务端 Mod
	static destroy() {
		Object.entries(this.loadedMod).forEach(mod => {
			if (mod[1].destroy && typeof mod[1].destroy === "function") {
				mod[1].destroy();
			}

			shared.logger.info(`Server Mod ${mod[0]} 已销毁`);
		});

		this.loadedMod = {};
	}
}


module.exports = { ClientModManager, ServerModManager };
