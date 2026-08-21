<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { api } from "../api";

const clients = ref([]);
let timer = null;

async function refresh() {
	clients.value = await api.getClients();
}

async function tellClient(id) {
	const msg = prompt("输入要发送的消息:");
	if (!msg) return;
	const res = await api.tellClient(id, msg);
	if (!res.ok) alert(res.message);
}

async function setMain(id) {
	const res = await api.setMainClient(id);
	if (res.ok) await refresh();
	else alert(res.message);
}

onMounted(() => {
	refresh();
	timer = setInterval(refresh, 3000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>已连接客户端</h2>
			<span class="badge">{{ clients.length }} 个</span>
		</div>

		<div v-if="clients.length === 0" class="empty-state">
			<p>暂无客户端连接</p>
		</div>

		<div v-else>
			<div
				v-for="c in clients"
				:key="c.id"
				style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-input); border-radius: 8px; margin-bottom: 8px;"
			>
				<div style="flex: 1;">
					<div style="font-weight: 500; font-size: 14px;">
						{{ c.id.slice(0, 8) }}...
						<span v-if="c.isMain" class="badge" style="margin-left: 6px;">主客户端</span>
					</div>
					<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
						IP: {{ c.ip }}
					</div>
				</div>
				<div class="btn-group">
					<button class="btn btn-ghost btn-sm" @click="tellClient(c.id)">发消息</button>
					<button v-if="!c.isMain" class="btn btn-primary btn-sm" @click="setMain(c.id)">设为主</button>
				</div>
			</div>
		</div>
	</div>
</template>
