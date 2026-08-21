<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api";

const config = ref(null);
const saving = ref(false);
const message = ref("");

async function refresh() {
	config.value = await api.getConfig();
}

async function save() {
	saving.value = true;
	message.value = "";
	try {
		const res = await api.saveConfig(config.value);
		if (res.ok) {
			message.value = "配置已保存";
		} else {
			message.value = res.message || "保存失败";
		}
	} catch (e) {
		message.value = e.message;
	}
	saving.value = false;
	setTimeout(() => message.value = "", 3000);
}

onMounted(refresh);
</script>

<template>
	<div v-if="config">
		<div class="card">
			<div class="card-header">
				<h2>基础设置</h2>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label>服务器名称</label>
					<input v-model="config.ws.name" type="text" />
				</div>
				<div class="form-group">
					<label>WebSocket 端口</label>
					<input v-model.number="config.ws.port" type="number" />
				</div>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label>命令前缀</label>
					<input v-model="config.commandPrefix" type="text" maxlength="4" />
				</div>
				<div class="form-group">
					<label>日志等级</label>
					<select v-model="config.logLevel">
						<option value="debug">debug</option>
						<option value="info">info</option>
						<option value="warning">warning</option>
						<option value="error">error</option>
					</select>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>AI 设置</h2>
			</div>
			<div class="form-group">
				<label>API Key</label>
				<input v-model="config.ai.options.apiKey" type="password" placeholder="sk-..." />
			</div>
			<div class="form-group">
				<label>Base URL</label>
				<input v-model="config.ai.options.baseURL" type="text" />
			</div>
			<div class="form-row">
				<div class="form-group">
					<label>对话模型</label>
					<input v-model="config.ai.models.chat.model" type="text" />
				</div>
				<div class="form-group">
					<label>指令模型</label>
					<input v-model="config.ai.models.command.model" type="text" />
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>限流设置</h2>
			</div>
			<div class="checkbox-row">
				<input id="rlEnabled" type="checkbox" v-model="config.rateLimit.command.enabled" />
				<label for="rlEnabled">启用命令限流</label>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label>窗口时间（毫秒）</label>
					<input v-model.number="config.rateLimit.command.windowMs" type="number" />
				</div>
				<div class="form-group">
					<label>窗口内上限（次）</label>
					<input v-model.number="config.rateLimit.command.maxPerWindow" type="number" />
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>资源路径</h2>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label>音乐文件路径</label>
					<input v-model="config.basePath.music" type="text" />
				</div>
				<div class="form-group">
					<label>MCFunc 文件路径</label>
					<input v-model="config.basePath.mcfunc" type="text" />
				</div>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label>Litematic 文件路径</label>
					<input v-model="config.basePath.litematic" type="text" />
				</div>
				<div class="form-group">
					<label>图片文件路径</label>
					<input v-model="config.basePath.image" type="text" />
				</div>
			</div>
		</div>

		<div style="display: flex; align-items: center; gap: 12px; margin-top: 8px;">
			<button class="btn btn-primary" @click="save" :disabled="saving">
				{{ saving ? "保存中..." : "保存配置" }}
			</button>
			<span v-if="message" style="font-size: 13px;">{{ message }}</span>
		</div>
	</div>
	<div v-else class="empty-state">
		<p>加载中...</p>
	</div>
</template>
