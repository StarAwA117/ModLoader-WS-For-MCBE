import { readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const permissionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../permission.json");
const tempPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../permission.json.tmp");

/**
 * 权限管理类
 * 基于 JSON 文件的权限系统，支持 blocker/user/op/owner 四级权限的增删查改
 * 使用缓存机制避免频繁读取磁盘
 */
export default class PermissionManager {
	/**
	 * 权限缓存（避免每次查询都读取磁盘）
	 * @type {Object|null}
	 */
	static _cache = null;

	/**
	 * 读取权限配置
	 * @param {string} object - "all" 返回完整配置，"blocker"/"user"/"op"/"owner" 返回对应列表
	 * @returns {Promise<Object|Array>} 返回权限配置或指定权限组
	 * @throws {Error} 当对象参数非法时抛出错误
	 */
	static async get(object = "all") {
		// 缓存命中时直接使用，避免重复读取磁盘
		if (!PermissionManager._cache) {
			const content = await readFile(permissionPath, "utf-8");
			PermissionManager._cache = JSON.parse(content);
		}

		const permission = PermissionManager._cache;

		if (object === "all") return permission;

		if (!["owner", "op", "user", "blocker"].includes(object)) {
			throw new Error("非法对象");
		}

		return permission[object];
	}

	/**
	 * 写入完整权限配置
	 * @param {Object} newPermission - 新的权限配置
	 * @returns {Promise<boolean|Error>} 成功返回 true，失败返回 Error
	 */
	static async set(newPermission) {
		try {
			// 先写入临时文件再原子替换，避免进程中断导致原文件损坏
			await writeFile(tempPath, JSON.stringify(newPermission, null, 2));
			await rename(tempPath, permissionPath);
			// 写入后清除缓存，下次读取重新加载
			PermissionManager._cache = null;
			return true;
		} catch (error) {
			return error;
		}
	}

	/**
	 * 向指定权限组添加成员
	 * @param {string} object - 权限组名称（blocker/user/op）
	 * @param {string} value - 要添加的成员标识
	 * @returns {Promise<boolean|Error>} 成功返回 true，失败返回 Error
	 */
	static async add(object, value) {
		try {
			if (!["op", "user", "blocker"].includes(object)) {
				throw new Error("非法对象");
			}

			const permission = JSON.parse(JSON.stringify(await PermissionManager.get()));

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

	/**
	 * 从指定权限组移除成员
	 * @param {string} object - 权限组名称（blocker/user/op）
	 * @param {string} value - 要移除的成员标识
	 * @returns {Promise<boolean|Error>} 成功返回 true，失败返回 Error
	 */
	static async remove(object, value) {
		try {
			if (!["op", "user", "blocker"].includes(object)) {
				throw new Error("非法对象");
			}

			const permission = JSON.parse(JSON.stringify(await PermissionManager.get()));

			if (!Array.isArray(permission[object])) {
				permission[object] = [];
			}

			// 过滤掉目标成员
			permission[object] = permission[object].filter(item => item !== value);

			const result = await PermissionManager.set(permission);
			if (result instanceof Error) throw result;
			return true;
		} catch (error) {
			return error;
		}
	}

	/**
	 * 查询成员权限等级
	 * 按 owner > blocker > op > user > normal 优先级返回最高权限
	 * @param {string} queried - 要查询的成员标识
	 * @returns {Promise<number|Error>} 权限等级数字或 Error
	 * -1 - blocker
	 * 0 - normal
	 * 1 - user
	 * 2 - op
	 * 3 - owner
	 */
	static async query(queried) {
		try {
			const permission = await PermissionManager.get();

			if (permission["owner"] === queried) {
				return 3;
			}

			if (permission["blocker"]?.includes(queried)) {
				return -1;
			}

			if (permission["op"]?.includes(queried)) {
				return 2;
			}

			if (permission["user"]?.includes(queried)) {
				return 1;
			}

			return 0;
		} catch (e) {
			return new Error(e.message);
		}
	}
}


