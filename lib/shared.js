import Logger from "./logger.js";

/**
 * 应用主日志实例
 * 用于记录应用程序的主要日志信息
 * @type {Logger}
 */
export const logger = new Logger();

/**
 * 消息日志实例 - 用于记录玩家聊天消息
 * @type {Logger}
 */
export const messageLogger = new Logger("message");


