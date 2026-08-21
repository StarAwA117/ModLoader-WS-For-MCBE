import { NCWebsocket, Structs } from "node-napcat-ts";
import { config } from "../../lib/mods.js";
import * as shared from "../../lib/shared.js";
import Current from "../../lib/current.js";

let napcat = null;
let mainClient = null;

function extractText(segments) {
	if (!Array.isArray(segments)) return "";
	return segments
		.filter(s => s.type === "text")
		.map(s => s.data?.text || "")
		.join("")
		.trim();
}

export default class QQ {
	static onStart() {}

	static connect() {
		if (napcat) return;
		if (!config.features.qq.enabled) return;

		if (!config.features.qq.accessToken) {
			shared.logger.warning("未配置 QQ accessToken，QQ 连接可能被服务端拒绝");
		}

		napcat = new NCWebsocket({
			protocol: "ws",
			host: config.features.qq.host,
			port: config.features.qq.port,
			// 令牌直接取自配置
			accessToken: config.features.qq.accessToken,
			reconnection: {
				enable: true,
				// 底层库在 nowAttempts >= attempts 后彻底放弃重连，导致连接一旦断开就永久不可用
				// 使用极大值使重连在断线后持续自愈，配合合理延时快速恢复
				attempts: Number.MAX_SAFE_INTEGER,
				delay: 10000
			}
		}, false);

		napcat.on("message.group.normal", (data) => {
			if (!config.features.qq.enabled) return;
			if (data.group_id !== config.features.qq.groupId) return;
			if (!mainClient) return;

			const nickname = data.sender.card || data.sender.nickname || "QQ用户";
			const text = extractText(data.message);
			if (!text) return;

			try {
				mainClient.tell(`§dQQ | §f<${nickname}> > §i${text}`, "@a", false);
			} catch {}
		});

		napcat.on("socket.close", () => {
			shared.logger.warning("QQ 连接已断开");
		});

		napcat.connect().then(() => {
			shared.logger.info("QQ 已连接");
		}).catch((e) => {
			shared.logger.error("QQ 连接失败");
			shared.logger.debug(e.message);
		});
	}

	static setMainClient(client) {
		mainClient = client;
		if (client) {
			this.connect();
		}
	}

	static getMainClient() {
		return mainClient;
	}

	// 主客户端接入/断开钩子（由 lib/mods.js 的 ServerModManager 分发）
	// 修复：主客户端断开重连后 mainClient 仍指向已断开 socket 的问题
	static onMainClientConnect(client) {
		this.setMainClient(client);
	}

	static onMainClientDisconnect() {
		this.setMainClient(null);
	}

	// 手动自愈检测：强制断开并重建连接，再用真实 API 请求验证链路是否畅通
	static async check() {
		if (!config.features.qq.enabled) return { ok: false, reason: "QQ 互通未启用" };
		if (!napcat) this.connect();
		if (!napcat) return { ok: false, reason: "napcat 未初始化" };

		try {
			// disconnect() 会清空旧 socket，connect() 再建立全新连接，避免旧连接残留
			await napcat.disconnect();
			await napcat.connect();
			// get_login_info 需要真正的 socket 往返，失败即说明链路不通
			const info = await napcat.get_login_info();
			return { ok: true, nickname: info?.nickname ?? info?.data?.nickname ?? "QQ" };
		} catch (e) {
			return { ok: false, reason: e?.message ?? String(e) };
		}
	}

	static async sendToGroup(text) {
		if (!config.features.qq.enabled) return false;
		if (!napcat) return false;

		// 若底层 socket 尚未建立/已断开，先尝试（重）连接，避免“总是发送失败”
		try {
			await napcat.connect();
		} catch {}

		try {
			await napcat.send_group_msg({
				group_id: config.features.qq.groupId,
				message: [Structs.text(text)]
			});
			return true;
		} catch (e) {
			shared.logger.error("QQ 消息发送失败");
			shared.logger.debug(e.message);
			return false;
		}
	}

	// 销毁（服务端关闭时调用）
	static destroy() {
		mainClient = null;
		if (napcat) {
			napcat.disconnect();
			napcat = null;
		}
	}

	static onDestroy() {
		this.destroy();
	}
}
