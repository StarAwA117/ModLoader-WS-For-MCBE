<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";

const currentVersion = ref("加载中...");
const latestVersion = ref(null);
const tags = ref([]);
const releaseInfo = ref(null);
const checking = ref(false);
const actionStatus = ref({ loading: false, message: "" });
const selectedTag = ref(null);
const showModal = ref(false);
const modalStatus = ref({ loading: false, message: "" });

function lockScroll() { document.body.classList.add("modal-open"); }
function unlockScroll() { document.body.classList.remove("modal-open"); }
function openModal() {
	selectedTag.value = latestVersion.value ? `v${latestVersion.value}` : (tags.value[0]?.name || null);
	modalStatus.value = { loading: false, message: "" };
	showModal.value = true;
	lockScroll();
}
function closeModal() {
	showModal.value = false;
	unlockScroll();
}

async function loadCurrentVersion() {
	try {
		const p = await api.getProcess();
		currentVersion.value = p.version || "未知";
	} catch {
		currentVersion.value = "未知";
	}
}

async function checkUpdate() {
	checking.value = true;
	actionStatus.value = { loading: false, message: "" };
	try {
		const res = await api.checkUpdate();
		latestVersion.value = res.latest;
		releaseInfo.value = res;
		if (res.error) {
			actionStatus.value = { loading: false, message: "检查更新失败: " + res.error };
		} else if (res.hasUpdate) {
			actionStatus.value = { loading: false, message: `发现新版本 v${res.latest}（当前 v${res.current}）` };
		} else if (res.latest) {
			actionStatus.value = { loading: false, message: "当前已是最新版本" };
		} else {
			actionStatus.value = { loading: false, message: "无法获取云端版本信息" };
		}
	} catch (e) {
		actionStatus.value = { loading: false, message: "检查更新失败: " + e.message };
	}
	checking.value = false;
}

async function loadTags() {
	try {
		const res = await api.getTags();
		tags.value = res.tags || [];
	} catch {
		tags.value = [];
	}
}

function getActionLabel() {
	if (!latestVersion.value || !selectedTag.value) return "更新";
	const selVer = selectedTag.value.replace(/^v/, "");
	const latVer = latestVersion.value;
	if (selVer === latVer) return "保持";
	if (selVer < latVer) return "回退";
	return "更新";
}

async function confirmAction() {
	if (!selectedTag.value) return;
	const tag = selectedTag.value.startsWith("v") ? selectedTag.value : `v${selectedTag.value}`;
	const label = getActionLabel();
	if (label === "保持") { closeModal(); return; }
	if (!confirm(`确定要${label === "更新" ? "更新" : "回退"}到 ${tag} 吗？\n\n操作完成后进程将退出，请手动重启服务。`)) return;
	modalStatus.value = { loading: true, message: `${label === "更新" ? "更新" : "回退"}中，请稍候...` };
	try {
		const res = label === "更新" ? await api.doUpdate() : await api.rollback(tag);
		if (res.ok) {
			modalStatus.value = { loading: false, message: res.message || `${label}完成` };
		} else {
			modalStatus.value = { loading: false, message: res.message || `${label}失败` };
		}
	} catch (e) {
		modalStatus.value = { loading: false, message: `${label}失败: ` + e.message };
	}
}

onMounted(() => {
	loadCurrentVersion();
	checkUpdate();
	loadTags();
});

onBeforeUnmount(unlockScroll);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>版本信息</h2>
		</div>
		<div class="stats-grid">
			<div class="stat-card">
				<div class="label">当前版本</div>
				<div class="value">v{{ currentVersion }}</div>
			</div>
			<div class="stat-card">
				<div class="label">云端版本</div>
				<div class="value blue">{{ latestVersion ? "v" + latestVersion : "未检查" }}</div>
			</div>
		</div>
		<div style="margin-top: 16px; display: flex; align-items: center; gap: 12px;">
			<button class="btn btn-primary" @click="checkUpdate" :disabled="checking || actionStatus.loading">
				{{ checking ? "检查中..." : "检查更新" }}
			</button>
			<button v-if="latestVersion" class="btn btn-secondary" @click="openModal" :disabled="actionStatus.loading">
				版本列表
			</button>
		</div>
		<p v-if="actionStatus.message" style="margin-top: 12px; font-size: 13px;">{{ actionStatus.message }}</p>
	</div>

	<div v-if="showModal" class="modal-overlay" @click.self="closeModal">
		<div class="modal">
			<div class="modal-header">
				<h3>选择版本</h3>
				<button class="modal-close" @click="closeModal">&times;</button>
			</div>
			<div class="modal-body">
				<label style="font-size: 13px; color: var(--text-muted); display: block; margin-bottom: 6px;">可用的 Release 版本：</label>
				<select v-model="selectedTag" class="modal-select" :disabled="modalStatus.loading">
					<option v-for="tag in tags" :key="tag.name" :value="tag.name">{{ tag.name }}</option>
				</select>
				<p v-if="modalStatus.message" style="margin-top: 12px; font-size: 13px;">{{ modalStatus.message }}</p>
			</div>
			<div class="modal-footer">
				<button class="btn btn-ghost" @click="closeModal" :disabled="modalStatus.loading">取消</button>
				<button class="btn btn-primary" @click="confirmAction" :disabled="modalStatus.loading">
					{{ modalStatus.loading ? "处理中..." : getActionLabel() }}
				</button>
			</div>
		</div>
	</div>
</template>
