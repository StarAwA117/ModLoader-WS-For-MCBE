import PermissionManager from "../lib/permission.js";
import Command from "../lib/command.js";

// 权限管理命令类
// 提供游戏内权限查询、添加、删除的命令接口
export default class PermissionCommands {
	constructor(client) {
		this.client = client;
	}

	// 返回命令定义
	onCommand() {
		return {
			// 普通命令：权限查询
			normal: [
				Command.create("p:q", "查询自身权限等级")
				.setFunc(async (commander) => {
					// 查询自身权限等级
					const permission = await PermissionManager.query(commander);
					this.client.tell(`§ePermission | §fQuery > §i${commander} 权限: ${permission}`, commander);
				}),

				Command.create("p:query", "查询指定账号权限等级")
				.addString("账号", true)
				.setFunc(async (commander, queried) => {
					// 查询指定账号的权限等级
					const permission = await PermissionManager.query(queried);
					this.client.tell(`§ePermission | §fQuery > §i${queried} 权限: ${permission}`, commander);
				})
			],

			// Owner 命令：权限增删
			owner: [
				Command.create("p:add", "添加指定账号权限")
				.addString("权限类型", true)
				.addString("账号", true)
				.setFunc(async (_, object, value) => {
					const result = await PermissionManager.add(object, value);
					if (result instanceof Error) {
						this.client.tellAll(`§cPermission | §fError > §i${result.message}`);
						return;
					}

					this.client.tellAll(`§ePermission | §fAdd > §i${value} -> ${object}`);
				}),

				Command.create("p:remove", "删除指定账号权限")
				.addString("权限类型", true)
				.addString("账号", true)
				.setFunc(async (_, object, value) => {
					const result = await PermissionManager.remove(object, value);
					if (result instanceof Error) {
						this.client.tellAll(`§cPermission | §fError > §i${result.message}`);
						return;
					}

					this.client.tellAll(`§ePermission | §fRemove > §i${value} <- ${object}`);
				})
			]
		}
	}
}
