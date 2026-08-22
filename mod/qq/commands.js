import { Detector } from "./detector.js";
import QQ from "./main.js";

export default class QQClient {
	constructor(client) {
		this.client = client;
		this._isMain = false;
	}

	onStart() {
		this._isMain = this.client === this.Current.client;
		if (this._isMain) {
			QQ.setMainClient(this.client);
		}
	}

	onCommand() {
		return {
			user: [
this.Command.create("q:send", "向 QQ 群发送消息")
				.addString("消息内容", true)
				.setFunc(async (sender, text) => {
					if (!this._isMain) {
						this.client.tell("§cQQ | §fError > §i仅主客户端可使用此命令", sender);
						return;
					}

					const check = Detector.detect(text);
					if (!check.passed) {
						this.client.tell(`§cQQ | §fError > §i消息未通过检测: ${check.reason}`, sender);
						return;
					}

					const ok = await QQ.sendToGroup(`[MCBE]<${sender}> ${text}`);
					if (ok) {
						this.client.tell("§eQQ | §fSend > §i消息已发送", sender);
					} else {
						this.client.tell("§cQQ | §fError > §i消息发送失败", sender);
					}
				})
			],

			owner: [
this.Command.create("q:check", "检测并手动重连 QQ")
				.setFunc(async (sender) => {
					if (!this._isMain) {
						this.client.tell("§cQQ | §fError > §i仅主客户端可使用此命令", sender);
						return;
					}

					const result = await QQ.check();
					if (result.ok) {
						this.client.tell(`§eQQ | §fCheck > §i连接正常 (${result.nickname})`, sender);
					} else {
						this.client.tell(`§cQQ | §fError > §i自愈失败: ${result.reason}`, sender);
					}
				}),

this.Command.create("q:toggle", "开启/关闭 QQ 互通功能")
				.addBoolean("启用或禁用", true)
				.setFunc((sender, enabled) => {
					if (!this._isMain) {
						this.client.tell("§cQQ | §fError > §i仅主客户端可使用此命令", sender);
						return;
					}
					this.config.features.qq.enabled = enabled;
					this.client.tellAll(`§eQQ | §fToggle > §i互通已${enabled ? "启用" : "禁用"}`);
				})
			]
		};
	}

	onDestroy() {
		if (this._isMain) {
			QQ.setMainClient(null);
			QQ.destroy();
		}
		this.client = null;
	}
}
