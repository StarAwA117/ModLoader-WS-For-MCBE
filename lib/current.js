/**
 * 全局状态类
 * 存储当前主客户端引用和全局运行时属性
 * 用于管理全局状态和跨模块通信
 */
export default class Current {
	/**
	 * 当前主客户端连接实例
	 * @type {Object|null}
	 */
	static client = null;

	/**
	 * 客户端 Mod 管理器映射（ws -> ClientModManager）
	 * @type {Map<Object, Object>}
	 */
	static clientMods = new Map();

	/**
	 * 运行时属性键值存储（如循环定时器 ID 等）
	 * @type {Object}
	 */
	static properties = {};

	/**
	 * 检查指定属性是否存在
	 * @param {string} key - 属性键名
	 * @returns {boolean} 属性是否存在且为真值
	 */
	static has(key) {
		return Boolean(this.properties[key]);
	}

	/**
	 * 获取指定属性值
	 * @param {string} key - 属性键名
	 * @returns {*} 属性值
	 */
	static get(key) {
		return this.properties[key];
	}

	/**
	 * 设置指定属性值
	 * @param {string} key - 属性键名
	 * @param {*} value - 属性值
	 * @returns {*} 设置的值
	 */
	static set(key, value) {
		return this.properties[key] = value;
	}

	/**
	 * 重置所有状态（主客户端断开时调用）
	 */
	static reset() {
		this.client = null;
		this.clientMods.clear();
		this.properties = {};
	}
}


