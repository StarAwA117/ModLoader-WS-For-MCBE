// 清屏文本
const CLEAR_TEXT = "\n§r\n".repeat(31);

// 0 值替换
function replaceZeros(str) {
	const chars = [];
	for (let i = 33; i <= 126; i++) {
		if (i < 48 || i > 57) chars.push(String.fromCharCode(i));
	}
	for (let i = chars.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	let idx = 0;
	return str.replace(/0/g, () => {
		if (idx >= chars.length) idx = 0;
		return chars[idx++];
	});
}

// 通用刷屏启动方法
function startSpam(Current, interval, generator, logMessage) {
	if (Current.has("loop")) clearInterval(Current.get("loop"));
	console.log(`< ${logMessage}`);
	Current.set("loop", setInterval(generator, interval));
}

export default class Spam {
	onTerminalCommand() {
		const Current = this.Current;
		return {
			ws: [
				this.Command.create("c:bye", "强制退出当前房间")
					.setFunc((_) => {
						if (!Current.client) {
							console.log("< 主客户端未连接");
							return;
						}
						Current.client.utils.sendCommandUnsafe("/me 正在尝试退出...".repeat(100) + "退出失败");
					}),

				this.Command.create("c:attack", "攻击客户端聊天")
					.setFunc((_) => {
						if (!Current.client) { console.log("< 主客户端未连接"); return; }
						startSpam(Current, 10, () => {
							Current.client.sendCommand(`me ${replaceZeros(this.config.attack)}`);
						}, "正在攻击客户端聊天…");
					}),

				this.Command.create("c:clear", "清屏聊天消息")
					.setFunc((_) => {
						if (!Current.client) { console.log("< 主客户端未连接"); return; }
						startSpam(Current, 50, () => {
							for (let i = 0; i < 8; i++) {
								Current.client.tellAll(CLEAR_TEXT);
							}
						}, "正在为客户端聊天清屏…");
					}),

				this.Command.create("c:ad", "推送广告")
					.setFunc((_) => {
						if (!Current.client) { console.log("< 主客户端未连接"); return; }
						startSpam(Current, (this.config.adInterval || 60000), () => {
							Current.client.tellAll(`${this.config.ad[Math.floor(Math.random() * this.config.ad.length)]}`);
						}, "正在为客户端推送 AD…");
					}),

				this.Command.create("c:repeat", "刷屏指定内容")
					.addString("刷屏内容", true)
					.setFunc((_, text) => {
						if (!Current.client) { console.log("< 主客户端未连接"); return; }
						startSpam(Current, 50, () => {
							Current.client.tellAll(text);
						}, "正在为刷屏客户端…");
					}),

				this.Command.create("c:stop", "停止所有刷屏")
					.setFunc((_) => {
						if (Current.has("loop")) clearInterval(Current.get("loop"));
						Current.set("loop", null);
						console.log("< 已停止客户端刷屏");
					})
			]
		};
	}

	static onDestroy() {
		const Current = this.Current;
		if (Current.has("loop")) {
			clearInterval(Current.get("loop"));
			Current.set("loop", null);
		}
	}
}
