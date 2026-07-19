// 配置文档
// 系统配置
// 服务端配置
const wsConfig = {
	name: "ModLoader",
	port: 8080
};

// 调试开关 - 开启后输出详细调试日志
const track = false;

// 命令前缀 - 玩家消息中以此字符开头的内容被识别为命令
const commandPrefix = "!";

// Mod 加载配置
// client: 客户端 Mod，随每个客户端连接实例化
// server: 服务端 Mod，在服务启动时加载一次
const mods = {
	client: {},
	server: {}
};

/*
- Mod 配置示例
const mods = {
	client: {
		"MoreWS": "../mod/morews",
		"PermissionCommands": "../mod/permission"
	},
	server: {
		"read": "../mod/read"
	}
};
*/

module.exports = {
	wsConfig,
	track,
	commandPrefix,
	mods
};