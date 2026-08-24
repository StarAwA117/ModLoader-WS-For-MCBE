import { reactive } from "vue";

const state = reactive({
	open: false,
	type: "alert",
	title: "",
	message: "",
	inputValue: "",
	inputPlaceholder: "",
	showCancel: false,
	_error: null,
	_resolve: null,
});

function lockScroll() { document.body.classList.add("modal-open"); }
function unlockScroll() { document.body.classList.remove("modal-open"); }

function openModal(options) {
	state.type = options.type || "alert";
	state.title = options.title || "";
	state.message = options.message || "";
	state.inputValue = options.inputValue || "";
	state.inputPlaceholder = options.inputPlaceholder || "";
	state.showCancel = options.type === "confirm" || options.type === "prompt";
	state._error = null;
	state.open = true;
	lockScroll();
	return new Promise((resolve) => { state._resolve = resolve; });
}

function close(result) {
	state.open = false;
	unlockScroll();
	if (state._resolve) { state._resolve(result); state._resolve = null; }
}

export function useModal() {
	return {
		state,
		alert: (message, title) => openModal({ type: "alert", message, title: title || "提示" }),
		confirm: (message, title) => openModal({ type: "confirm", message, title: title || "确认" }),
		prompt: (message, defaultValue, title) => openModal({ type: "prompt", message, title: title || "输入", inputValue: defaultValue || "" }),
		close,
	};
}

// 全局单例，供 Modal.vue 直接导入
export { state as modalState, close as closeModal };
