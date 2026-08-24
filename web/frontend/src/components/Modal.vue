<script setup>
import { modalState as state, closeModal as close } from "../composables/useModal";
import { ref, watch } from "vue";

const inputRef = ref(null);

watch(() => state.open, (v) => {
	if (v && state.type === "prompt") {
		setTimeout(() => inputRef.value?.focus(), 100);
	}
});

function onConfirm() {
	if (state.type === "prompt") {
		if (!state.inputValue.trim()) { state._error = "不能为空"; return; }
		close(state.inputValue.trim());
	} else {
		close(true);
	}
}
function onCancel() { close(false); }
function onKeydown(e) {
	if (e.key === "Enter") onConfirm();
	if (e.key === "Escape") onCancel();
}
</script>

<template>
	<div v-if="state.open" class="modal-overlay" @click.self="state.type === 'alert' ? close(true) : onCancel()">
		<div class="modal" @keydown="onKeydown">
			<div class="modal-header">
				<h3>{{ state.title }}</h3>
				<button class="modal-close" @click="state.type === 'alert' ? close(true) : onCancel()">×</button>
			</div>
			<div class="modal-body">
				<p style="margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-secondary); white-space: pre-line;">{{ state.message }}</p>
				<p v-if="state._error" style="margin: 8px 0 0; font-size: 13px; color: var(--danger);">{{ state._error }}</p>
				<input
					v-if="state.type === 'prompt'"
					ref="inputRef"
					v-model="state.inputValue"
					type="text"
					:placeholder="state.inputPlaceholder"
					style="margin-top: 12px; width: 100%; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-input); color: var(--text); font-size: 14px; font-family: inherit; outline: none;"
				/>
			</div>
			<div class="modal-footer">
				<button v-if="state.showCancel" class="btn btn-ghost btn-sm" @click="onCancel">取消</button>
				<button class="btn btn-primary btn-sm" @click="onConfirm">确定</button>
			</div>
		</div>
	</div>
</template>
