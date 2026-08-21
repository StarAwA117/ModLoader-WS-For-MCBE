import fs from "fs";
import path from "path";
import { config } from "./mods.js";

/**
 * 日志输出目录
 * @type {string}
 */
const logDir = "./logs";

/**
 * 日志等级数值映射（数字越大越严重）
 * @type {Object<string, number>}
 */
const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warning: 2,
	error: 3
};

/**
 * 配置的最低日志等级，低于该等级的消息不输出
 * @returns {number}
 */
function getMinLevel() {
	return LOG_LEVELS[config?.logLevel] ?? LOG_LEVELS.info;
}

/**
 * 获取北京时间字符串（UTC+8）
 * @returns {string} 形如 2026-08-07T12:34:56.789+08:00
 */
function beijingTime() {
	return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 23) + "+08:00";
}

if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, {
		recursive: true
	});
}

/**
 * 日志文件流缓存（避免每次创建新的写入流）
 * @type {Object<string, fs.WriteStream>}
 */
const logStreams = {};

/**
 * 获取或创建日志文件流
 * @param {string} name - 日志名称
 * @returns {fs.WriteStream} 日志文件写入流
 */
function getLogStream(name) {
	if (!logStreams[name]) {
		const logPath = path.join(logDir, `${name}.log`);
		logStreams[name] = fs.createWriteStream(logPath, { flags: 'a' });
	}
	return logStreams[name];
}

/**
 * 关闭所有日志文件流（进程退出前调用，避免丢失缓冲中的日志）
 */
export function closeLogStreams() {
	for (const name of Object.keys(logStreams)) {
		try {
			logStreams[name].end();
		} catch {}
		delete logStreams[name];
	}
}

/**
 * 日志工具类
 * 提供分级日志输出（控制台 + 文件），支持颜色高亮和日志文件自动创建
 */
export default class Logger {
	/**
	 * 构造函数
	 * @param {string} name - 日志名称（用于文件名和前缀）
	 * @param {boolean} ifprint - 是否输出到控制台
	 * @param {boolean} ifile - 是否写入日志文件
	 */
	constructor(name = "app", ifprint = true, ifile = true) {
		this.name = name;
		this.print = ifprint;
		this.file = ifile;
	}

	/**
	 * 核心日志方法
	 * @param {string} message - 日志内容
	 * @param {string} type - 日志类型（info/warning/error/debug），默认 "def" 不加格式化前缀
	 */
	log(message, type = "def") {
		const allowTypes = ["info", "warning", "error", "debug"];
		let logMessage;

		if (allowTypes.includes(type)) {
			// 等级过滤：低于配置等级的消息不输出
			if ((LOG_LEVELS[type] ?? 0) < getMinLevel()) return;
			// 标准格式: [北京时间戳] [类型] 名称 - 消息
			logMessage = `[${beijingTime()}] [${type}] ${this.name} - ${message}`;
		} else {
			logMessage = `${message}`;
		}

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

		// 通过 Stream 写入日志文件
		if (this.file) {
			try {
				const stream = getLogStream(this.name);
				stream.write(logMessage + "\n");
			} catch (error) {
				console.log("Log Error: ", error);
			}
		}
	}

	/**
	 * 信息级别日志
	 * @param {string} message - 日志内容
	 */
	info(message) {
		this.log(message, "info");
	}

	/**
	 * 警告级别日志
	 * @param {string} message - 日志内容
	 */
	warning(message) {
		this.log(message, "warning");
	}

	/**
	 * 错误级别日志
	 * @param {string} message - 日志内容
	 */
	error(message) {
		this.log(message, "error");
	}

	/**
	 * 调试级别日志
	 * @param {string} message - 日志内容
	 */
	debug(message) {
		this.log(message, "debug");
	}
}


