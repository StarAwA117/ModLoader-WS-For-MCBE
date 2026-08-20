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
				Command.create("p:query", "查询权限等级（不带参数查询自身）")
				.addOptionalString("账号")
				.setFunc(async (commander, queried) => {
					// 无参数查询自身权限；带参数查询指定账号
					const target = queried || commander;
					const permission = await PermissionManager.query(target);
					this.client.tell(`§ePermission | §fQuery > §i${target} 权限: ${permission}`, commander);
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
