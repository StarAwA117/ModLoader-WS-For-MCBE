// 玩家处理类
class Player {
	// 客户端初始化
	static init(client) {
		if (client.players) return;

		// 用于存储该客户端的所有玩家
		client.players = new Map();

		// 检测是否存在循环
		if (!client.getPlayersInterval) {
			// 初始更新
			Player.getPlayers(client);
			// 循环更新
			client.getPlayersInterval = setInterval(() => Player.getPlayers(client), 45_000);
		}
	}

	// 获取所有玩家
	// 返回 void
	static async getPlayers(client) {
		// 检测 client.players 是否为 {}
		// 如果不是，则创建 {}
		if (!(client.players instanceof Map)) this.init(client);
		// 使用 /list 并获取回调
		let data;
		try {
			data = await client.runCommand("list");
		} catch {
			return;
		}
		// 检测是否存在 client.players
		if (!client?.players) return;
		// 获取 players 字符串
		const playersRaw = data?.body?.players;
		// 检测 players 是否存在（不存在则返回
		if (!playersRaw || playersRaw === "") return;
		// 将 players 字符串切割成并转换为 Set
		const players = new Set(playersRaw.split(", "));

		// 新增
		// 遍历所有 players name
		players.forEach(name => {
			// 如果 client.players 中出现则直接返回 终端进程
			if (client.players.has(name)) return;
			// 将新 player 加入至 client.players
			client.players.set(name, new Player(name, client));
		});

		// 移除
		// 待清理元素汇总
		const toRemove = [];
		// 遍历所有 client.players 中的元素
		client.players.forEach((player, name) => {
			// 如果 players 中出现则直接返回 终端进程
			if (players.has(name)) return;
			// 将旧 player 加入至 toRemove
			toRemove.push(player);
		});

		// 清理
		// 遍历 toRemove 中所有元素
		toRemove.forEach(player => player.destroy());
	}

	// 以客户端为单位销毁该客户端的所有 Player
	static destroyAll(client) {
		// 空值保护
		if (!client?.players) return;
		// 终止循环
		clearInterval(client.getPlayersInterval);
		client.getPlayersInterval = null;

		// 将 Map 转列表并遍历所有玩家销毁（destroy 内部会删除条目）
		[...client.players.values()].forEach(p => p.destroy());
	}

	// 构造函数
	constructor(name, client) {
		// 名称
		this.name = name;
		// 所属客户端
		this.client = client;
		// 自定义属性
		this.properties = {};
	}

	// 销毁方法
	destroy() {
		if (this.client?.players?.has(this.name)) this.client.players.delete(this.name);
		this.name = null;
		this.client = null;
		this.properties = {};
	}
}

module.exports = Player;
