const { commandPrefix } = require("../config.js");

// 用于创建与执行命令
class Command {
	// 当前命令前缀（从配置读取）
	static commandPrefix = commandPrefix;

	// 动态设置命令前缀
	static setCommandPrefix(text) {
		if (text.includes(" ")) return false;
		Command.commandPrefix = text;
		return true;
	}

	// 解析命令参数字符串
	// 支持双引号包裹的含空格参数
	static parseArgs(input) {
		const tokens = [];
		let cur = '',
			inQuote = false;
		for (let i = 0; i < input.length; i++) {
			const ch = input[i];
			if (ch === '"') {
				if (inQuote) tokens.push(cur), cur = '';
				inQuote = !inQuote;
			} else if (!inQuote && ch === ' ') {
				if (cur) tokens.push(cur), cur = '';
			} else {
				cur += ch;
			}
		}
		if (cur) tokens.push(cur);
		if (inQuote) throw new Error('未闭合的双引号');
		return tokens;
	}

	// 创建命令实例的静态工厂方法
	static create(name, description = null) {
		return new Command(name, description);
	}

	constructor(name, description) {
		this.name = name;
		this.description = description;
		this.parameters = [];
		this.func = null;
	}

	// 添加布尔类型参数
	addBoolean(description = null) {
		this.parameters.push(["Boolean", description]);
		return this;
	}

	// 添加字符串类型参数
	addString(description = null) {
		this.parameters.push(["String", description]);
		return this;
	}

	// 添加整型参数
	addInteger(description = null) {
		this.parameters.push(["Integer", description]);
		return this;
	}

	// 添加浮点型参数
	addFloat(description = null) {
		this.parameters.push(["Float", description]);
		return this;
	}

	// 添加枚举类型参数（限定可选值）
	addEnum(e, description = null) {
		if (typeof e !== "object") return;
		this.parameters.push([e, description]);
		return this;
	}

	// 添加自定义类型参数
	add(type, description = null) {
		this.parameters.push([type, description]);
		return this;
	}

	// 设置命令执行函数
	setFunc(func) {
		this.func = func;
		return this;
	}

	// 执行命令
	// commander: 命令发起者标识
	// text: 原始命令文本
	execute(commander, text) {
		let textList;

		try {
			textList = Command.parseArgs(text);
		} catch (e) {
			return {
				status: false,
				message: e.message
			};
		}

		// 校验命令名称是否匹配
		if (textList[0] !== `${Command.commandPrefix}${this.name}`) return false;

		// 校验参数数量是否匹配
		if (textList.length !== this.parameters.length + 1) return {
			status: false,
			message: "字符长度不匹配"
		};

		const resultList = [];

		// 逐个解析并校验参数类型
		for (let i = 1; i <= this.parameters.length; i++) {
			const nowText = textList[i];
			const nowType = this.parameters[i - 1][0];

			let result;

			// 枚举类型校验
			if (typeof nowType === "object") {
				if (!nowType.includes(nowText)) return {
					status: false,
					message: `"${nowText}" 处应为枚举 ${nowType}`
				};

				result = nowText;

				resultList.push(result);

				continue;
			}

			if (typeof nowType !== "string") return {
				status: false,
				message: `未知错误`
			};

			// 基础类型校验
			switch (nowType) {
				case "Boolean": {
					if (!["true", "false"].includes(nowText)) return {
						status: false,
						message: `"${nowText}" 处应为布尔型`
					};

					if (nowText === "true") result = true;
					if (nowText === "false") result = false;
					break;
				}

				case "String": {
					result = nowText;
					break;
				}

				case "Integer": {
					const num = Number(nowText);
					if (!Number.isInteger(num)) return {
						status: false,
						message: `"${nowText}" 处应为整型`
					};

					result = num;
					break;
				}

				case "Float": {
					const num = parseFloat(nowText);
					if (isNaN(num)) return {
						status: false,
						message: `"${nowText}" 处应为浮点型`
					};

					result = num;
					break;
				}
			}

			resultList.push(result);
		}

		// 调用命令执行函数
		if (this.func && typeof this.func === "function") {
			try {
				this.func(commander, ...resultList);
			} catch (e) {
				return {
					status: false,
					message: e.message
				};
			}
		}

		return {
			status: true,
			message: resultList
		};
	}
}

module.exports = Command;
