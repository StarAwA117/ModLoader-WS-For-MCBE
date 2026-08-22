<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api";

const mods = ref({ server: [], client: [] });
const loading = ref(false);

async function refresh() {
	mods.value = await api.getMods();
}

async function reloadAll() {
	loading.value = true;
	try {
		const res = await api.reloadAllMods();
		if (res.ok) {
			alert("重载成功");
			await refresh();
		} else {
			alert("重载失败: " + res.message);
		}
	} catch (e) {
		alert("请求失败: " + e.message);
	}
	loading.value = false;
}

onMounted(refresh);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>模组管理</h2>
			<button class="btn btn-primary btn-sm" @click="reloadAll" :disabled="loading">
				{{ loading ? "重载中..." : "重载全部" }}
			</button>
		</div>

		<div class="form-row">
			<div>
				<label style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px; display: block; font-weight: 600;">服务端模组</label>
				<div v-if="mods.server.length === 0" class="empty-state" style="padding: 20px;">
					<p>无已加载的服务端模组</p>
				</div>
				<div v-else>
					<div v-for="m in mods.server" :key="m.name" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-input); border-radius: 8px; margin-bottom: 6px;">
						<span style="font-weight: 500;">{{ m.name }}</span>
						<span class="badge" style="margin-left: auto;">{{ m.enabled ? '已启用' : '已禁用' }}</span>
					</div>
				</div>
			</div>
			<div>
				<label style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px; display: block; font-weight: 600;">客户端模组</label>
				<div v-if="mods.client.length === 0" class="empty-state" style="padding: 20px;">
					<p>无已加载的客户端模组</p>
				</div>
				<div v-else>
					<div v-for="m in mods.client" :key="m.name" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-input); border-radius: 8px; margin-bottom: 6px;">
						<span style="font-weight: 500;">{{ m.name }}</span>
						<span class="badge" style="margin-left: auto;">{{ m.enabled ? '已启用' : '已禁用' }}</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
