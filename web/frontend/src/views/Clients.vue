<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { api } from "../api";
import { useModal } from "../composables/useModal";

const { alert, confirm } = useModal();
const clients = ref([]);
const selected = ref(null);
const showDetail = ref(false);
let timer = null;

async function refresh() {
	clients.value = await api.getClients();
}

function openDetail(c) {
	selected.value = c;
	showDetail.value = true;
}

async function setMain() {
	if (!selected.value) return;
	const res = await api.setMainClient(selected.value.id);
	if (res.ok) { showDetail.value = false; await refresh(); }
	else await alert(res.message);
}

async function disconnect() {
	if (!selected.value) return;
	const ok = await confirm(`确定断开 ${selected.value.localPlayerName || selected.value.id.slice(0, 8)} 的连接？`);
	if (!ok) return;
	const res = await api.disconnectClient(selected.value.id);
	if (res.ok) { showDetail.value = false; await refresh(); }
	else await alert(res.message);
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
				@click="openDetail(c)"
			>
				<div style="flex: 1;">
					<div style="font-weight: 500; font-size: 14px;">
						{{ c.localPlayerName || "未命名客户端" }}
						<span v-if="c.isMain" class="badge" style="margin-left: 6px;">主客户端</span>
					</div>
					<div class="client-meta">
						<span>IP: {{ c.ip }}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- 客户端详情弹窗 -->
	<div v-if="showDetail && selected" class="modal-overlay" @click.self="showDetail = false">
		<div class="modal" style="max-width: 420px;">
			<div class="modal-header">
				<h3>客户端详情</h3>
				<button class="modal-close" @click="showDetail = false">×</button>
			</div>
			<div class="modal-body">
				<div class="detail-row"><span class="detail-label">名称</span><span>{{ selected.localPlayerName || "未命名" }}</span></div>
				<div class="detail-row"><span class="detail-label">IP</span><span style="font-family: monospace;">{{ selected.ip }}</span></div>
				<div class="detail-row"><span class="detail-label">UUID</span><span style="font-family: monospace; font-size: 12px;">{{ selected.id }}</span></div>
				<div class="detail-row"><span class="detail-label">角色</span><span :class="selected.isMain ? 'badge' : 'tag tag-user'">{{ selected.isMain ? "主客户端" : "普通" }}</span></div>
				<div class="detail-row"><span class="detail-label">连接时间</span><span>{{ new Date(selected.connectedAt).toLocaleString() }}</span></div>
			</div>
			<div class="modal-footer">
				<button v-if="!selected.isMain" class="btn btn-primary btn-sm" @click="setMain">切换</button>
				<button class="btn btn-danger btn-sm" @click="disconnect">断开</button>
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
	cursor: pointer;
	transition: background 0.15s;
}
.client-card:hover { background: var(--border); }

.client-meta {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 2px;
}

.detail-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 0;
	border-bottom: 1px solid var(--border);
	font-size: 14px;
}
.detail-row:last-child { border-bottom: none; }
.detail-label {
	color: var(--text-muted);
	font-size: 13px;
}
</style>
