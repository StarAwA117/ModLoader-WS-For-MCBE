<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import ConfigField from "../components/ConfigField.vue";

const mods = ref([]);
const loading = ref(false);
const reloading = ref({});
const modal = ref({ open: false, type: "", modName: "", mod: null, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" });

const sortedMods = computed(() => [...mods.value].sort((a, b) => a.name.localeCompare(b.name)));

async function refresh() {
	const data = await api.getMods();
	const map = new Map();
	for (const m of [...data.server, ...data.client]) {
		const existing = map.get(m.name);
		if (existing) {
			if (data.server.some(s => s.name === m.name)) existing.entry.server = true;
			if (data.client.some(c => c.name === m.name)) existing.entry.client = true;
		} else {
			map.set(m.name, { ...m, entry: { server: data.server.some(s => s.name === m.name), client: data.client.some(c => c.name === m.name) } });
		}
	}
	mods.value = [...map.values()];
}

async function reloadAll() {
	loading.value = true;
	try { await api.reloadAllMods(); await refresh(); } catch {}
	loading.value = false;
}

async function toggleMod(mod) {
	if (mod.enabled) { await api.disableMod(mod.name); } else { await api.enableMod(mod.name); }
	mod.enabled = !mod.enabled;
}

async function reloadMod(mod) {
	reloading.value[mod.name] = true;
	try { await api.reloadMod(mod.name); } catch {}
	reloading.value[mod.name] = false;
}

function lockScroll() { document.body.classList.add("modal-open"); }
function unlockScroll() { document.body.classList.remove("modal-open"); }
function closeModal() { modal.value.open = false; unlockScroll(); }

function buildFields(obj, prefix) {
	if (!obj || typeof obj !== "object") return [];
	return Object.entries(obj).map(([key, val]) => {
		const path = prefix ? prefix + "." + key : key;
		if (val === null) return { path, key, type: "string" };
		if (typeof val === "boolean") return { path, key, type: "boolean" };
		if (typeof val === "number") return { path, key, type: "number" };
		if (typeof val === "string") return { path, key, type: "string" };
		if (Array.isArray(val)) {
			if (val.length > 0 && typeof val[0] === "object") return { path, key, type: "json" };
			return { path, key, type: "array" };
		}
		if (typeof val === "object") {
			const children = buildFields(val, path);
			const hasNested = children.some(c => c.type === "group");
			const childCount = Object.keys(val).length;
			if (!hasNested && childCount <= 4 && children.every(c => c.type !== "json" && c.type !== "array")) {
				return { path, key, type: "row", children };
			}
			return { path, key, type: "group", children };
		}
		return { path, key, type: "string" };
	});
}

async function openSettings(mod) {
	modal.value = { open: true, type: "settings", modName: mod.name, mod, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" };
	lockScroll();
	try {
		const res = await api.getModConfig(mod.name);
		if (res.ok) {
			modal.value.config = JSON.parse(JSON.stringify(res.config));
			modal.value.fields = buildFields(res.config, "");
		}
	} catch { modal.value.message = "加载失败"; }
}

async function openManifest(mod) {
	modal.value = { open: true, type: "manifest", modName: mod.name, mod, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" };
	lockScroll();
	try {
		const res = await api.getModManifest(mod.name);
		if (res.ok) modal.value.manifest = res.manifest;
	} catch { modal.value.message = "加载失败"; }
}

async function openReadme(mod) {
	modal.value = { open: true, type: "readme", modName: mod.name, mod, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" };
	lockScroll();
	try {
		const res = await api.getModReadme(mod.name);
		if (res.ok) modal.value.readme = res.readme || "无 README 内容";
		else modal.value.readme = res.message || "无 README 文件";
	} catch { modal.value.readme = "加载失败"; }
}

async function saveConfig() {
	modal.value.saving = true;
	modal.value.message = "";
	try {
		const res = await api.saveModConfig(modal.value.modName, modal.value.config);
		if (res.ok) { modal.value.message = "已保存"; setTimeout(closeModal, 800); }
		else { modal.value.message = res.message || "失败"; }
	} catch (e) { modal.value.message = e.message; }
	modal.value.saving = false;
}

function modType(m) {
	if (m.entry?.server && m.entry?.client) return "双端互通";
	if (m.entry?.server) return "仅服务端";
	return "仅客户端";
}

function simpleMd(text) {
	if (!text) return "";
	return text
		.replace(/^### (.+)$/gm, '<h3>$1</h3>')
		.replace(/^## (.+)$/gm, '<h2>$1</h2>')
		.replace(/^# (.+)$/gm, '<h1>$1</h1>')
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/^- (.+)$/gm, '<li>$1</li>')
		.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
		.replace(/\n/g, '<br>');
}

onMounted(refresh);
onBeforeUnmount(unlockScroll);
</script>

<template>
	<div>
		<div class="card-header">
			<h2>Mod 列表</h2>
			<button class="btn btn-sm btn-ghost reload-btn" @click="reloadAll" :disabled="loading">{{ loading ? "..." : "重载" }}</button>
			<span class="badge">{{ sortedMods.length }}</span>
		</div>
		<div v-if="!sortedMods.length" class="empty-state"><p>暂无插件</p></div>
		<div v-for="m in sortedMods" :key="m.name" class="card mod-card" :class="{ disabled: !m.enabled }">
			<div class="mod-top">
				<div class="mod-info">
					<div class="mod-name">{{ m.name }}</div>
					<div v-if="m.description" class="mod-desc">{{ m.description }}</div>
				</div>
				<label class="switch" @click.stop>
					<input type="checkbox" :checked="m.enabled" @change="toggleMod(m)" />
					<span class="slider"></span>
				</label>
			</div>
			<div class="mod-bottom">
				<div class="mod-meta">
					<span v-if="m.version">v{{ m.version }}</span>
					<span v-if="m.author">{{ m.author }}</span>
				</div>
				<div class="mod-actions">
					<button v-if="m.enabled" class="icon-btn" title="重载" @click="reloadMod(m)" :disabled="reloading[m.name]">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
					</button>
					<button class="icon-btn" title="清单" @click="openManifest(m)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
					</button>
					<button v-if="m.hasReadme" class="icon-btn" title="文档" @click="openReadme(m)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
					</button>
					<button v-if="m.hasConfig" class="icon-btn" title="设置" @click="openSettings(m)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82.48V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15H4.59a1.65 1.65 0 0 0-1.51 1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V4.59a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H19.41a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
					</button>
				</div>
			</div>
		</div>
	</div>

	<div v-if="modal.open" class="modal-overlay" @click.self="closeModal">
		<div class="modal">
			<div class="modal-header">
				<h3>{{ modal.modName }}{{ modal.type === "settings" ? " - 设置" : modal.type === "manifest" ? " - 清单" : " - 文档" }}</h3>
				<button class="modal-close" @click="closeModal">&times;</button>
			</div>
			<div class="modal-body">
				<div v-if="modal.type === 'settings'">
					<div v-if="!modal.config" class="empty-state"><p>{{ modal.message || "加载中..." }}</p></div>
					<ConfigField v-else v-for="f in modal.fields" :key="f.path" :field="f" :config="modal.config" :depth="0" />
				</div>

				<div v-if="modal.type === 'manifest'">
					<div v-if="modal.manifest" class="manifest-info">
						<p><b>名称：</b>{{ modal.manifest.name || modal.modName }}</p>
						<p><b>版本：</b>{{ modal.manifest.version || "未知" }}</p>
						<p><b>简介：</b>{{ modal.manifest.description || "无" }}</p>
						<p><b>作者：</b>{{ modal.manifest.author || "未知" }}</p>
						<p><b>类型：</b>{{ modType(modal.mod) }}</p>
					</div>
					<div v-else class="empty-state"><p>{{ modal.message || "无 manifest" }}</p></div>
				</div>

				<div v-if="modal.type === 'readme'" class="modal-markdown" v-html="simpleMd(modal.readme)"></div>
			</div>
			<div v-if="modal.type === 'settings' && modal.config" class="modal-footer">
				<span v-if="modal.message" class="modal-msg">{{ modal.message }}</span>
				<button class="btn btn-ghost" @click="closeModal">取消</button>
				<button class="btn btn-primary" @click="saveConfig" :disabled="modal.saving">{{ modal.saving ? "保存中..." : "保存" }}</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.mod-card { margin-bottom: 10px; transition: opacity 0.2s; }
.mod-card.disabled { opacity: 0.5; }
.mod-top { display: flex; align-items: flex-start; gap: 14px; }
.mod-info { flex: 1; min-width: 0; }
.mod-name { font-weight: 600; font-size: 15px; color: var(--text); }
.mod-desc { font-size: 13px; color: var(--text-secondary); margin-top: 4px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mod-bottom { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.mod-meta { display: flex; gap: 10px; font-size: 12px; color: var(--text-muted); align-items: center; }
.mod-actions { display: flex; gap: 2px; }

.icon-btn {
	display: inline-flex; align-items: center; justify-content: center;
	width: 30px; height: 30px; border-radius: 6px; border: none;
	background: transparent; color: var(--text-secondary); cursor: pointer;
	transition: all 0.15s;
}
.icon-btn:hover { background: var(--primary-dim); color: var(--primary); }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-btn:disabled:hover { background: transparent; color: var(--text-secondary); }
.icon-btn svg { width: 16px; height: 16px; }

.card-header { display: flex; flex-direction: row; align-items: center; flex-wrap: nowrap; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); gap: 8px; }
.card-header h2 { font-size: 15px; color: var(--text); font-weight: 600; margin: 0; white-space: nowrap; flex-shrink: 0; }
.reload-btn { margin-left: auto; white-space: nowrap; flex-shrink: 0; }
.badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; font-size: 12px; font-weight: 600; background: var(--primary-dim); color: var(--primary); white-space: nowrap; flex-shrink: 0; }

.switch { position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0; cursor: pointer; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: var(--border); border-radius: 24px; transition: background 0.25s; }
.slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: transform 0.25s; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.switch input:checked + .slider { background: var(--primary); }
.switch input:checked + .slider::before { transform: translateX(18px); }

.manifest-info p { margin: 6px 0; font-size: 14px; }
.manifest-info b { color: var(--text-secondary); }
</style>
