const fs = require("fs");
const path = require("path");

// 日志输出目录
const logDir = "./logs";
// 自动创建日志目录（如果不存在）
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, {
		recursive: true
	});
}

// 日志工具类
// 提供分级日志输出（控制台 + 文件），支持颜色高亮和日志文件自动创建
class Logger {
	// name: 日志名称（用于文件名和前缀）
	// ifprint: 是否输出到控制台
	// ifile: 是否写入日志文件
	constructor(name = "app", ifprint = true, ifile = true) {
		this.name = name;
		this.print = ifprint;
		this.file = ifile;
	}

	// 核心日志方法
	// message: 日志内容
	// type: 日志类型（info/warning/error/debug），默认 "def" 不加格式化前缀
	log(message, type = "def") {
		const allowTypes = ["info", "warning", "error", "debug"];
		let logMessage;

		if (allowTypes.includes(type)) {
			// 标准格式: [ISO时间戳] [类型] 名称 - 消息
			const now = new Date().toISOString();
			logMessage = `[${now}] [${type}] ${this.name} - ${message}`;
		} else {
			logMessage = `${message}`;
		}

		// 控制台输出（带颜色）
		if (this.print) {
			const colors = {
				info: "\x1b[32m",
				warning: "\x1b[33m",
				error: "\x1b[31m",
				debug: "\x1b[35m",
				reset: "\x1b[0m"
			}

			console.log(`${colors[type] || ""}${logMessage}${colors.reset}`);
		}

		// 异步写入日志文件
		if (this.file) {
			fs.appendFile(path.join(logDir, `${this.name}.log`), logMessage + "\n", "utf-8", (error) => {
				if (error) console.log("Log Error: ", error)
			});
		}
	}

	// 信息级别日志
	info(message) {
		this.log(message, "info");
	}

	// 警告级别日志
	warning(message) {
		this.log(message, "warning");
	}

	// 错误级别日志
	error(message) {
		this.log(message, "error");
	}

	// 调试级别日志
	debug(message) {
		this.log(message, "debug");
	}
}

module.exports = Logger;
