<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { api, formatUptime, formatBytes } from "../api";

const status = ref(null);
const process = ref(null);
let timer = null;

async function refresh() {
	try {
		const [s, p] = await Promise.all([api.getStatus(), api.getProcess()]);
		status.value = s;
		process.value = p;
	} catch {}
}

onMounted(() => {
	refresh();
	timer = setInterval(refresh, 3000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
	<div v-if="status">
		<div class="stats-grid">
			<div class="stat-card">
				<div class="label">服务器状态</div>
				<div class="value blue">运行中</div>
			</div>
			<div class="stat-card">
				<div class="label">运行时间</div>
				<div class="value blue">{{ formatUptime(status.server.uptime) }}</div>
			</div>
			<div class="stat-card">
				<div class="label">连接客户端</div>
				<div class="value">{{ status.connections.count }}</div>
			</div>
			<div class="stat-card">
				<div class="label">WS 端口</div>
				<div class="value">{{ status.server.wsPort }}</div>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>连接的客户端</h2>
				<span class="badge">{{ status.connections.count }} 个</span>
			</div>
			<div v-if="status.connections.clients.length === 0" class="empty-state">
				<p>暂无客户端连接</p>
			</div>
			<div v-else class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>ID</th>
							<th>IP</th>
							<th>角色</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="c in status.connections.clients" :key="c.id">
							<td style="font-family: monospace; font-size: 12px;">{{ c.id.slice(0, 8) }}...</td>
							<td>{{ c.ip }}</td>
							<td>
								<span :class="c.isMain ? 'badge' : 'tag tag-user'">
									{{ c.isMain ? "主客户端" : "普通" }}
								</span>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>已加载模组</h2>
			</div>
			<div class="form-row">
				<div>
					<label style="color: var(--text-muted); font-size: 12px; margin-bottom: 6px; display: block;">服务端模组</label>
					<div v-if="status.mods.server.length === 0" style="color: var(--text-muted); font-size: 13px;">无</div>
					<div v-else style="display: flex; flex-wrap: wrap; gap: 6px;">
						<span v-for="m in status.mods.server" :key="m" class="tag tag-op">{{ m }}</span>
					</div>
				</div>
				<div>
					<label style="color: var(--text-muted); font-size: 12px; margin-bottom: 6px; display: block;">客户端模组</label>
					<div v-if="status.mods.client.length === 0" style="color: var(--text-muted); font-size: 13px;">无</div>
					<div v-else style="display: flex; flex-wrap: wrap; gap: 6px;">
						<span v-for="m in status.mods.client" :key="m" class="tag tag-user">{{ m }}</span>
					</div>
				</div>
			</div>
		</div>

		<div v-if="process" class="card">
			<div class="card-header">
				<h2>进程信息</h2>
			</div>
			<div class="stats-grid">
				<div class="stat-card">
					<div class="label">PID</div>
					<div class="value">{{ process.pid }}</div>
				</div>
				<div class="stat-card">
					<div class="label">内存使用</div>
					<div class="value blue">{{ formatBytes(process.memory.rss) }}</div>
				</div>
				<div class="stat-card">
					<div class="label">堆内存</div>
					<div class="value">{{ formatBytes(process.memory.heapUsed) }}</div>
				</div>
				<div class="stat-card">
					<div class="label">Node.js</div>
					<div class="value" style="font-size: 16px;">{{ process.nodeVersion }}</div>
				</div>
			</div>
		</div>
	</div>
	<div v-else class="empty-state">
		<p>加载中...</p>
	</div>
</template>
