export default class Notify {
	onClientConnect(client, isMainClient) {
		const role = isMainClient ? "主客户端" : "客户端";
		client.tell(`§e${this.config.ws.name} | §fSystem > §i${role}已连接`);
	}

	onClientDisconnect(client, isMainClient) {
		const role = isMainClient ? "主客户端" : "客户端";
		client.tell(`§e${this.config.ws.name} | §fSystem > §i${role}已断开连接`);
	}
}
