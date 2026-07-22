const readline = require("readline");
const Current = require("../lib/current.js");

// 终端读取类
// 监听标准输入，提供终端级别的命令执行和消息发送功能
// 支持游戏命令转发、聊天刷屏、Lumine 广告推送等
class Read {
	// readline 接口实例
	static rl = null;

	// 启动终端交互监听
	static start() {
		this.rl = new readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});
		this.rl.on("line", (input) => this.read(input));
	}

	// 处理终端输入
	static read(input) {
		// 检测主客户端连接状态
		if (!Current.client) {
			console.log("主客户端未连接");
			return;
		}

		// 游戏命令转发（以 / 开头）
		if (input.startsWith("/")) {
			Current.client.runCommand(input).then(data => {
				console.log(`CMD ${data.body.statusCode} -> ${data.body.statusMessage ? data.body.statusMessage : "Null"}`);
			});
			return;
		}

		// 非命令文本作为聊天消息发送
		Current.client.tellAll(input);
	}

	// 销毁方法 - 关闭 readline 接口
	static destroy() {
		if (!this.rl) return;
		this.rl.removeAllListeners();
		this.rl.close();
		this.rl = null;
	}
}

module.exports = Read;
