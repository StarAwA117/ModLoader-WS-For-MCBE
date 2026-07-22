const PermissionManager = require("../lib/permission.js");
const Command = require("../lib/command.js");

// 权限管理命令类
// 提供游戏内权限查询、添加、删除的命令接口
class PermissionCommands {
	constructor(client) {
		this.client = client;
	}

	// 返回命令定义
	commands() {
		return {
			// 普通命令：权限查询
			normal: [
				Command.create("p:q", "权限 - 快速查询")
				.setFunc(async (commander) => {
					// 查询自身权限等级
					const permission = await PermissionManager.query(commander);
					this.client.tell(`§b${permission} §f-> ${commander}`, commander);
				}),

				Command.create("p:query", "权限 - 指定查询")
				.addString("账号")
				.setFunc(async (commander, queried) => {
					// 查询指定账号的权限等级
					const permission = await PermissionManager.query(queried);
					this.client.tell(`§b${permission} §f-> ${queried}`, commander);
				})
			],

			// Owner 命令：权限增删
			owner: [
				Command.create("p:add", "权限 - 添加权限")
				.addString("类型")
				.addString("账号")
				.setFunc(async (_, object, value) => {
					const result = await PermissionManager.add(object, value);
					if (result instanceof Error) {
						this.client.tellAll(`§cPermission §f${result.message}`);
						return;
					}

					this.client.tellAll(`§aAdd ${object} §f-> ${value}`);
				}),

				Command.create("p:remove", "权限 - 删除权限")
				.addString("类型")
				.addString("账号")
				.setFunc(async (_, object, value) => {
					const result = await PermissionManager.remove(object, value);
					if (result instanceof Error) {
						this.client.tellAll(`§cPermission §f${result.message}`);
						return;
					}

					this.client.tellAll(`§cRemove ${object} §f-> ${value}`);
				})
			]
		}
	}
}

module.exports = PermissionCommands;
