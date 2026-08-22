import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PERMISSION_FILE = path.resolve(__dirname, "..", "permission.json");

const LEVELS = { blocker: 0, user: 1, op: 2, owner: 3 };

function load() {
	try {
		return JSON.parse(fs.readFileSync(PERMISSION_FILE, "utf-8"));
	} catch {
		return { owner: "", op: [], user: [], blocker: [] };
	}
}

function save(data) {
	fs.writeFileSync(PERMISSION_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export default class PermissionManager {
	/**
	 * 查询权限等级
	 * @param {string} name - 玩家名
	 * @returns {number|Error} 权限等级 (0-3) 或 Error
	 */
	static query(name) {
		const data = load();
		const lower = name.toLowerCase();
		if (typeof data.owner === "string" && data.owner.toLowerCase() === lower) return LEVELS.owner;
		if (Array.isArray(data.op) && data.op.some(n => n.toLowerCase() === lower)) return LEVELS.op;
		if (Array.isArray(data.user) && data.user.some(n => n.toLowerCase() === lower)) return LEVELS.user;
		if (Array.isArray(data.blocker) && data.blocker.some(n => n.toLowerCase() === lower)) return LEVELS.blocker;
		return 0;
	}

	/**
	 * 添加权限
	 * @param {string} type - 权限类型 (owner/op/user/blocker)
	 * @param {string} name - 玩家名
	 * @returns {true|Error}
	 */
	static add(type, name) {
		if (!LEVELS.hasOwnProperty(type)) return new Error(`未知权限类型: ${type}`);
		const data = load();
		if (type === "owner") {
			data.owner = name;
		} else {
			if (!Array.isArray(data[type])) data[type] = [];
			if (!data[type].includes(name)) data[type].push(name);
		}
		save(data);
		return true;
	}

	/**
	 * 删除权限
	 * @param {string} type - 权限类型 (owner/op/user/blocker)
	 * @param {string} name - 玩家名
	 * @returns {true|Error}
	 */
	static remove(type, name) {
		if (!LEVELS.hasOwnProperty(type)) return new Error(`未知权限类型: ${type}`);
		const data = load();
		if (type === "owner") {
			data.owner = "";
		} else if (Array.isArray(data[type])) {
			data[type] = data[type].filter(n => n !== name);
		}
		save(data);
		return true;
	}
}
