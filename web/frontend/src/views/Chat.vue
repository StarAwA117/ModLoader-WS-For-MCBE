<script setup>
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import { api } from "../api";

const messages = ref([]);
const input = ref("");
const chatRef = ref(null);
let timer = null;

async function refresh() {
	const res = await api.getChatLog();
	messages.value = res.lines || [];
	if (chatRef.value) chatRef.value.scrollTop = chatRef.value.scrollHeight;
}

async function send() {
	if (!input.value.trim()) return;
	const msg = input.value.trim();
	input.value = "";
	const res = await api.sendChat(msg);
	if (!res.ok) alert(res.message);
	await refresh();
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
			<h2>聊天</h2>
			<span class="badge badge-blue">{{ messages.length }} 条</span>
		</div>

		<div ref="chatRef" class="log-viewer" style="height: 400px; margin-bottom: 12px;">
			<div v-if="messages.length === 0" style="color: var(--text-muted); text-align: center; padding: 40px;">
				暂无聊天记录
			</div>
			<div
				v-for="(msg, i) in messages"
				:key="i"
				class="log-line"
				style="color: #94a3b8;"
			>{{ msg }}</div>
		</div>

		<div style="display: flex; gap: 8px;">
			<input
				v-model="input"
				type="text"
				placeholder="输入要发送的聊天消息..."
				@keydown.enter="send"
				style="flex: 1;"
			/>
			<button class="btn btn-primary" @click="send">发送</button>
		</div>
	</div>
</template>
