const Logger = require("./logger.js");
const { track } = require("../config.js");

// 应用主日志实例
const logger = new Logger();

// 消息日志实例 - 用于记录玩家聊天消息
const messageLogger = new Logger("message");

module.exports = { logger, messageLogger };
