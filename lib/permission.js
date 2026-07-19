const fs = require("fs").promises;

// 权限管理类
// 基于 JSON 文件的权限系统，支持 blocker/user/op 三级权限的增删查改
class PermissionManager {
	// 权限缓存（避免每次查询都读取磁盘）
	static _cache = null;

	// 读取权限配置
	// object: "all" 返回完整配置，"blocker"/"user"/"op" 返回对应列表
	static async get(object = "all") {
		// 缓存命中时直接使用，避免重复读取磁盘
		if (!PermissionManager._cache) {
			const content = await fs.readFile("./permission.json", "utf-8");
			PermissionManager._cache = JSON.parse(content);
		}

		const permission = PermissionManager._cache;

		if (object === "all") return permission;

		if (!["owner", "op", "user", "blocker"].includes(object)) {
			throw new Error("非法对象");
		}

		return permission[object];
	}

	// 写入完整权限配置
	static async set(newPermission) {
		try {
			await fs.writeFile("./permission.json", JSON.stringify(newPermission, null, 2));
			// 写入后清除缓存，下次读取重新加载
			PermissionManager._cache = null;
			return true;
		} catch (error) {
			return error;
		}
	}

	// 向指定权限组添加成员
	// object: 权限组名称（blocker/user/op）
	// value: 要添加的成员标识
	static async add(object, value) {
		try {
			if (!["op", "user", "blocker"].includes(object)) {
				throw new Error("非法对象");
			}

			const permission = await PermissionManager.get();

			// 确保目标组为数组
			if (!Array.isArray(permission[object])) {
				permission[object] = [];
			}

			// 已存在则直接返回
			if (permission[object].includes(value)) {
				return true;
			}

			permission[object].push(value);
			const result = await PermissionManager.set(permission);
			if (result instanceof Error) throw result;
			return true;
		} catch (error) {
			return error;
		}
	}

	// 从指定权限组移除成员
	static async remove(object, value) {
		try {
			if (!["op", "user", "blocker"].includes(object)) {
				throw new Error("非法对象");
			}

			const Per = await PermissionManager.get();

			if (!Array.isArray(Per[object])) {
				Per[object] = [];
			}

			// 过滤掉目标成员
			Per[object] = Per[object].filter(item => item !== value);

			const result = await PermissionManager.set(Per);
			if (result instanceof Error) throw result;
			return true;
		} catch (error) {
			return error;
		}
	}

	// 查询成员权限等级
	// 按 owner > blocker > op > user > normal 优先级返回最高权限
	// 返回值: 
	// -1 - blocker
	// 0 - normal
	// 1 - user
	// 2 - op
	// 3 - owner
	static async query(queried) {
		try {
			const permission = await PermissionManager.get();

			if (permission["owner"] === queried) {
				return 3;
			}

			if (permission["blocker"].includes(queried)) {
				return -1;
			}

			if (permission["op"].includes(queried)) {
				return 2;
			}

			if (permission["user"].includes(queried)) {
				return 1;
			}

			return 0;
		} catch (e) {
			return e;
		}
	}
}

module.exports = PermissionManager;
