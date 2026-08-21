<script setup>
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import { api } from "../api";

const logType = ref("app");
const logLines = ref([]);
const autoScroll = ref(true);
const logRef = ref(null);
let timer = null;

async function refresh() {
	const res = await api.getLogs(logType.value, 300);
	logLines.value = res.lines || [];
	if (autoScroll.value) {
		await nextTick();
		if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
	}
}

function setLogType(type) {
	logType.value = type;
	refresh();
}

onMounted(() => {
	refresh();
	timer = setInterval(refresh, 2000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>日志查看</h2>
			<div class="btn-group">
				<button
					class="btn btn-sm"
					:class="logType === 'app' ? 'btn-primary' : 'btn-ghost'"
					@click="setLogType('app')"
				>应用日志</button>
				<button
					class="btn btn-sm"
					:class="logType === 'message' ? 'btn-primary' : 'btn-ghost'"
					@click="setLogType('message')"
				>消息日志</button>
				<button
					class="btn btn-sm"
					:class="autoScroll ? 'btn-success' : 'btn-ghost'"
					@click="autoScroll = !autoScroll"
				>{{ autoScroll ? '自动滚动' : '手动滚动' }}</button>
			</div>
		</div>

		<div ref="logRef" class="log-viewer" style="height: 500px;">
			<div v-if="logLines.length === 0" style="color: var(--text-muted); text-align: center; padding: 40px;">
				暂无日志
			</div>
			<div
				v-for="(line, i) in logLines"
				:key="i"
				class="log-line"
				:class="line.includes('[error]') ? 'error' : line.includes('[warning]') ? 'warning' : line.includes('[debug]') ? 'debug' : 'info'"
			>{{ line }}</div>
		</div>
	</div>
</template>
