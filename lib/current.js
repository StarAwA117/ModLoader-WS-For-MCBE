// 用于当前主任务的操作与销毁
class Current {
	// 当前主客户端连接实例
	static client = null;

	// 运行时属性键值存储（如循环定时器 ID 等）
	static properties = {};

	// 检查指定属性是否存在
	static has(key) {
		return Boolean(this.properties[key]);
	}

	// 获取指定属性值
	static get(key) {
		return this.properties[key];
	}

	// 设置指定属性值
	static set(key, value) {
		return this.properties[key] = value;
	}

	// 重置所有状态（主客户端断开时调用）
	static reset() {
		this.client = null;
		this.properties = {};
	}
}

module.exports = Current;
