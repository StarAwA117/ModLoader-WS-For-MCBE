import { commandPrefix, rateLimit } from "../config.js";

/**
 * 命令框架类
 * 提供声明式的命令定义和执行框架
 * 支持多种参数类型和链式调用
 */
export default class Command {
	/**
	 * 当前命令前缀（从配置读取）
	 * @type {string}
	 */
	static commandPrefix = commandPrefix;

	/**
	 * 命令限流桶：commander -> { start, count }
	 * @type {Map<string, {start:number, count:number}>}
	 */
	static _rateBuckets = new Map();

	/**
	 * 按玩家名进行命令限流检查（基于 config.rateLimit.command）
	 * @param {string} commander - 命令发起者标识
	 * @returns {boolean} true=允许执行 false=触发限流
	 */
	static _checkRateLimit(commander) {
		const cfg = rateLimit?.command;
		if (!cfg || !cfg.enabled) return true;

		const now = Date.now();
		let bucket = Command._rateBuckets.get(commander);
		if (!bucket || now - bucket.start >= cfg.windowMs) {
			bucket = { start: now, count: 0 };
			Command._rateBuckets.set(commander, bucket);
		}
		if (bucket.count >= cfg.maxPerWindow) return false;
		bucket.count++;
		return true;
	}

	/**
	 * 动态设置命令前缀
	 * @param {string} text - 新的命令前缀
	 * @returns {boolean} 设置是否成功
	 */
	static setCommandPrefix(text) {
		if (text.includes(" ")) return false;
		Command.commandPrefix = text;
		return true;
	}

	/**
	 * 解析命令参数字符串
	 * 支持双引号包裹的含空格参数
	 * @param {string} input - 原始命令字符串
	 * @returns {string[]} 解析后的参数数组
	 * @throws {Error} 当双引号未闭合时抛出错误
	 */
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

	/**
	 * 创建命令实例的静态工厂方法
	 * @param {string} name - 命令名称
	 * @param {string|null} description - 命令描述
	 * @returns {Command} 新的命令实例
	 */
	static create(name, description = null) {
		return new Command(name, description);
	}

	/**
	 * 构造函数
	 * @param {string} name - 命令名称
	 * @param {string|null} description - 命令描述
	 */
	constructor(name, description) {
		this.name = name;
		this.description = description;
		this.parameters = [];
		this.func = null;
		// 异步执行出错时的回调（由调用方注入，用于向用户反馈错误）
		this.onError = null;
	}

	/**
	 * 添加布尔类型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addBoolean(description = null, optional = false) {
		this._addParameter(["Boolean", description, optional]);
		return this;
	}

	/**
	 * 添加字符串类型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addString(description = null, optional = false) {
		this._addParameter(["String", description, optional]);
		return this;
	}

	/**
	 * 添加整型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addInteger(description = null, optional = false) {
		this._addParameter(["Integer", description, optional]);
		return this;
	}

	/**
	 * 添加浮点型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addFloat(description = null, optional = false) {
		this._addParameter(["Float", description, optional]);
		return this;
	}

	/**
	 * 添加枚举类型参数（限定可选值）
	 * @param {Array} e - 可选值数组
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addEnum(e, description = null, optional = false) {
		if (typeof e !== "object") return;
		this._addParameter([e, description, optional]);
		return this;
	}

	/**
	 * 添加自定义类型参数
	 * @param {string} type - 参数类型名称
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	add(type, description = null, optional = false) {
		this._addParameter([type, description, optional]);
		return this;
	}

	/**
	 * 内部方法：添加参数到参数列表
	 * 确保可选参数在必选参数之后
	 * @param {Array} param - 参数定义 [type, description, optional]
	 * @throws {Error} 当可选参数后面跟着必选参数时抛出错误
	 */
	_addParameter(param) {
		const optional = param[2];
		
		// 如果是必选参数，检查是否已经有可选参数
		if (!optional) {
			const hasOptional = this.parameters.some(p => p[2]);
			if (hasOptional) {
				throw new Error("必选参数不能放在可选参数之后");
			}
		}
		
		this.parameters.push(param);
	}

	/**
	 * 添加可选布尔类型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalBoolean(description = null) {
		return this.addBoolean(description, true);
	}

	/**
	 * 添加可选字符串类型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalString(description = null) {
		return this.addString(description, true);
	}

	/**
	 * 添加可选整型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalInteger(description = null) {
		return this.addInteger(description, true);
	}

	/**
	 * 添加可选浮点型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalFloat(description = null) {
		return this.addFloat(description, true);
	}

	/**
	 * 添加可选枚举类型参数
	 * @param {Array} e - 可选值数组
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalEnum(e, description = null) {
		return this.addEnum(e, description, true);
	}

	/**
	 * 添加可选自定义类型参数
	 * @param {string} type - 参数类型名称
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptional(type, description = null) {
		return this.add(type, description, true);
	}

	/**
	 * 设置命令执行函数
	 * @param {Function} func - 执行函数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	setFunc(func) {
		this.func = func;
		return this;
	}

	/**
	 * 执行命令
	 * @param {string} commander - 命令发起者标识
	 * @param {string} text - 原始命令文本
	 * @returns {Object|boolean} 返回执行结果或 false
	 */
	execute(commander, text) {
		// 命令限流检查（基于 config.rateLimit.command）
		if (!Command._checkRateLimit(commander)) {
			return {
				status: false,
				message: "命令过于频繁，请稍后再试"
			};
		}

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

		// 计算必选参数和可选参数数量
		const requiredCount = this.parameters.filter(p => !p[2]).length;
		const totalCount = this.parameters.length;
		const providedArgs = textList.length - 1; // 减去命令名称

		// 校验参数数量是否在有效范围内
		if (providedArgs < requiredCount || providedArgs > totalCount) {
			return {
				status: false,
				message: `参数数量错误：需要 ${requiredCount}-${totalCount} 个参数，但提供了 ${providedArgs} 个`
			};
		}

		const resultList = [];

		// 逐个解析并校验参数类型
		for (let i = 0; i < this.parameters.length; i++) {
			const [nowType, , optional] = this.parameters[i];
			const nowText = textList[i + 1]; // +1 跳过命令名称

			// 如果是可选参数且没有提供值，使用 undefined
			if (optional && nowText === undefined) {
				resultList.push(undefined);
				continue;
			}

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
					// 严格整数：拒绝科学计数法/Infinity 等格式
					if (!/^-?\d+$/.test(nowText)) return {
						status: false,
						message: `"${nowText}" 处应为整型`
					};

					const num = Number(nowText);
					if (!Number.isSafeInteger(num)) return {
						status: false,
						message: `"${nowText}" 处应为整型`
					};

					result = num;
					break;
				}

				case "Float": {
					// 严格浮点：拒绝 Infinity / NaN 等非法格式
					if (!/^-?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(nowText)) return {
						status: false,
						message: `"${nowText}" 处应为浮点型`
					};

					const num = parseFloat(nowText);
					if (!isFinite(num)) return {
						status: false,
						message: `"${nowText}" 处应为浮点型`
					};

					result = num;
					break;
				}

				default: {
					// 未知/自定义类型：原样透传文本，避免参数被解析成 undefined
					result = nowText;
					break;
				}
			}

			resultList.push(result);
		}

		// 调用命令执行函数
		if (this.func && typeof this.func === "function") {
			try {
				const ret = this.func(commander, ...resultList);
				// 异步命令函数（返回 Promise）出错时捕获，避免静默失败
				if (ret && typeof ret.then === "function") {
					ret.catch((e) => {
						if (this.onError) this.onError(e);
					});
				}
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


