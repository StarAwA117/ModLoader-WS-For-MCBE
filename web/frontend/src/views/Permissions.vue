<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api";

const permissions = ref({ owner: "", op: [], user: [], blocker: [] });
const newPlayer = ref({ op: "", user: "", blocker: "" });
const groups = ["owner", "op", "user", "blocker"];
const groupNames = { owner: "服主", op: "管理员", user: "普通用户", blocker: "屏蔽名单" };
const groupColors = { owner: "badge-accent", op: "badge-warning", user: "badge-info", blocker: "badge-danger" };

async function refresh() {
	permissions.value = await api.getPermissions();
}

async function addPlayer(group) {
	const name = newPlayer.value[group]?.trim();
	if (!name) return;
	const res = await api.addPermission(group, name);
	if (res.ok) {
		newPlayer.value[group] = "";
		await refresh();
	} else {
		alert(res.message || "添加失败");
	}
}

async function removePlayer(group, player) {
	if (!confirm(`确定移除 ${player} 的 ${groupNames[group]} 权限？`)) return;
	const res = await api.removePermission(group, player);
	if (res.ok) await refresh();
	else alert(res.message || "移除失败");
}

onMounted(refresh);
</script>

<template>
	<div v-for="group in groups" :key="group" class="card">
		<div class="card-header">
			<h2>{{ groupNames[group] }}</h2>
			<span :class="'badge ' + (groupColors[group])">
				{{ group === 'owner' ? (permissions[group] || '未设置') : (permissions[group]?.length || 0) + ' 人' }}
			</span>
		</div>

		<div v-if="group === 'owner'" style="color: var(--text-secondary); font-size: 14px;">
			{{ permissions.owner || "未设置" }}
		</div>

		<template v-else>
			<div style="display: flex; gap: 8px; margin-bottom: 12px;">
				<input
					v-model="newPlayer[group]"
					type="text"
					:placeholder="'输入玩家名添加到' + groupNames[group]"
					@keydown.enter="addPlayer(group)"
				/>
				<button class="btn btn-success btn-sm" @click="addPlayer(group)">添加</button>
			</div>

			<div v-if="!permissions[group]?.length" style="color: var(--text-muted); font-size: 13px; padding: 8px 0;">
				暂无成员
			</div>
			<div v-else style="display: flex; flex-wrap: wrap; gap: 6px;">
				<div
					v-for="player in permissions[group]"
					:key="player"
					style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: var(--bg-input); border-radius: 6px; font-size: 13px;"
				>
					<span>{{ player }}</span>
					<button
						style="background: none; border: none; color: var(--danger); cursor: pointer; font-size: 14px; padding: 0 2px;"
						@click="removePlayer(group, player)"
					>×</button>
				</div>
			</div>
		</template>
	</div>
</template>
