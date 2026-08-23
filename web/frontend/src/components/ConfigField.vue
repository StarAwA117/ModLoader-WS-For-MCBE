<script setup>
defineOptions({ name: "ConfigField" });
const props = defineProps(["field", "config", "depth"]);

function lbl(key) { return key; }

function getVal(obj, path) { return path.split(".").reduce((o, k) => o?.[k], obj); }
function setVal(obj, path, val) {
	const keys = path.split(".");
	let cur = obj;
	for (let i = 0; i < keys.length - 1; i++) { if (!cur[keys[i]]) cur[keys[i]] = {}; cur = cur[keys[i]]; }
	cur[keys[keys.length - 1]] = val;
}
function toText(val) {
	if (val === undefined || val === null) return "";
	if (typeof val === "string") return val;
	return JSON.stringify(val, null, 2);
}
function fromText(path, raw) {
	try { setVal(props.config, path, JSON.parse(raw)); } catch {}
}
</script>

<template>
	<div v-if="field.type === 'group'" class="cfg-group" :style="{ marginLeft: depth > 0 ? '12px' : '0' }">
		<label class="cfg-group-label">{{ lbl(field.key) }}</label>
		<div class="cfg-group-body">
			<ConfigField v-for="c in field.children" :key="c.path" :field="c" :config="config" :depth="depth + 1" />
		</div>
	</div>
	<div v-else-if="field.type === 'row'" class="cfg-row" :style="{ marginLeft: depth > 0 ? '12px' : '0' }">
		<div v-for="c in field.children" :key="c.path" class="cfg-cell">
			<label>{{ lbl(c.key) }}</label>
			<input v-if="c.type === 'boolean'" type="checkbox" :checked="getVal(config, c.path)" @change="setVal(config, c.path, $event.target.checked)" />
			<input v-else-if="c.type === 'number'" type="number" :value="getVal(config, c.path)" @input="setVal(config, c.path, Number($event.target.value))" />
			<input v-else type="text" :value="getVal(config, c.path)" @input="setVal(config, c.path, $event.target.value)" />
		</div>
	</div>
	<div v-else-if="field.type === 'json' || field.type === 'array'" class="cfg-field" :style="{ marginLeft: depth > 0 ? '12px' : '0' }">
		<label>{{ lbl(field.key) }}</label>
		<textarea :value="toText(getVal(config, field.path))" @blur="fromText(field.path, $event.target.value)" rows="4" spellcheck="false"></textarea>
	</div>
	<div v-else class="cfg-field" :style="{ marginLeft: depth > 0 ? '12px' : '0' }">
		<label>{{ lbl(field.key) }}</label>
		<input v-if="field.type === 'boolean'" type="checkbox" :checked="getVal(config, field.path)" @change="setVal(config, field.path, $event.target.checked)" />
		<input v-else-if="field.type === 'number'" type="number" :value="getVal(config, field.path)" @input="setVal(config, field.path, Number($event.target.value))" />
		<input v-else type="text" :value="getVal(config, field.path)" @input="setVal(config, field.path, $event.target.value)" />
	</div>
</template>

<style scoped>
.cfg-group { margin-bottom: 12px; }
.cfg-group-label { font-weight: 600; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; display: block; }
.cfg-group-body { padding-left: 10px; border-left: 2px solid var(--border); }
.cfg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
.cfg-cell label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 3px; }
.cfg-field { margin-bottom: 10px; }
.cfg-field label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 3px; }
.cfg-field input[type="text"], .cfg-field input[type="number"], .cfg-cell input[type="text"], .cfg-cell input[type="number"] {
	width: 100%; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
	background: var(--bg-input); color: var(--text); font-size: 13px;
}
.cfg-field input[type="checkbox"], .cfg-cell input[type="checkbox"] { width: 16px; height: 16px; }
.cfg-field textarea {
	width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px;
	background: var(--bg-input); color: var(--text); font-family: "Cascadia Code", "Fira Code", monospace;
	font-size: 12px; resize: vertical; tab-size: 2;
}
</style>
