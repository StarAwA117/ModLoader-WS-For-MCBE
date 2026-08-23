<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { api } from "../api";

const clients = ref([]);
let timer = null;

async function refresh() {
	clients.value = await api.getClients();
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
				class="client-card"
			>
				<div style="flex: 1;">
					<div style="font-weight: 500; font-size: 14px;">
						{{ c.localPlayerName || "未命名客户端" }}
						<span v-if="c.isMain" class="badge badge-accent" style="margin-left: 6px;">主客户端</span>
					</div>
					<div class="client-meta">
						<span>IP: {{ c.ip }}</span>
					</div>
				</div>
				<div v-if="!c.isMain" class="btn-group">
					<button class="btn btn-primary btn-sm" @click="setMain(c.id)">设为主</button>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.client-card {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	background: var(--bg-input);
	border-radius: 8px;
	margin-bottom: 8px;
}

.client-meta {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 2px;
}
</style>
