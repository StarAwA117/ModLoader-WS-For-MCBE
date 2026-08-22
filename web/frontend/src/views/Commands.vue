<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api";

const commands = ref([]);
const input = ref("");
const output = ref([]);
const loading = ref(false);

async function refresh() {
	commands.value = await api.getCommands();
}

const levelColors = {
	normal: "tag-user",
	user: "tag-user",
	op: "tag-op",
	owner: "tag-owner"
};

const levelNames = {
	normal: "普通",
	user: "用户",
	op: "管理员",
	owner: "服主"
};

async function exec() {
	if (!input.value.trim()) return;
	loading.value = true;
	const cmd = input.value.trim();
	output.value.push({ type: "input", text: cmd });
	try {
		const res = await api.execCommand(cmd);
		if (res.ok) {
			output.value.push({ type: "success", text: JSON.stringify(res.result, null, 2) });
		} else {
			output.value.push({ type: "error", text: res.message || "执行失败" });
		}
	} catch (e) {
		output.value.push({ type: "error", text: e.message });
	}
	input.value = "";
	loading.value = false;
}

onMounted(refresh);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>命令执行</h2>
			<button class="btn btn-ghost btn-sm" @click="refresh">刷新列表</button>
		</div>

		<div style="display: flex; gap: 8px; margin-bottom: 16px;">
			<input
				v-model="input"
				type="text"
				placeholder="输入基岩版命令..."
				@keydown.enter="exec"
				style="flex: 1;"
			/>
			<button class="btn btn-primary" @click="exec" :disabled="loading">
				{{ loading ? "执行中..." : "执行" }}
			</button>
		</div>

		<div v-if="output.length" class="log-viewer" style="max-height: 200px; margin-bottom: 16px;">
			<div v-for="(line, i) in output" :key="i" class="log-line" :class="line.type === 'error' ? 'error' : line.type === 'success' ? 'info' : ''">
				{{ line.type === 'input' ? '> ' : '' }}{{ line.text }}
			</div>
		</div>
	</div>

	<div class="card">
		<div class="card-header">
			<h2>可用命令</h2>
			<span class="badge badge-info">{{ commands.length }} 个</span>
		</div>
		<div v-if="commands.length === 0" class="empty-state">
			<p>请先连接 Minecraft 客户端</p>
		</div>
		<div v-else class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>命令</th>
						<th>描述</th>
						<th>权限</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="cmd in commands" :key="cmd.name">
						<td style="font-family: monospace; color: var(--info);">{{ cmd.name }}</td>
						<td>{{ cmd.description }}</td>
						<td><span :class="'tag ' + levelColors[cmd.level]">{{ levelNames[cmd.level] }}</span></td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
