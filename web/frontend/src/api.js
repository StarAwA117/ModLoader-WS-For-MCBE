const BASE = "/api";

async function request(path, options = {}) {
	const res = await fetch(`${BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...options
	});
	return res.json();
}

export const api = {
	getStatus: () => request("/status"),
	getConfig: () => request("/config"),
	saveConfig: (cfg) => request("/config", { method: "PUT", body: JSON.stringify(cfg) }),
	getPermissions: () => request("/permissions"),
	savePermissions: (perm) => request("/permissions", { method: "PUT", body: JSON.stringify(perm) }),
	addPermission: (group, player) => request(`/permissions/${group}/${encodeURIComponent(player)}`, { method: "POST" }),
	removePermission: (group, player) => request(`/permissions/${group}/${encodeURIComponent(player)}`, { method: "DELETE" }),
	getMods: () => request("/mods"),
	reloadAllMods: () => request("/mods/reload-all", { method: "POST" }),
	getCommands: () => request("/commands"),
	execCommand: (command) => request("/command", { method: "POST", body: JSON.stringify({ command }) }),
	getClients: () => request("/clients"),
	tellClient: (id, message) => request(`/clients/${id}/tell`, { method: "POST", body: JSON.stringify({ message }) }),
	setMainClient: (id) => request(`/clients/${id}/set-main`, { method: "POST" }),
	getLogs: (name = "app", lines = 200) => request(`/logs?name=${name}&lines=${lines}`),
	getLiveLogs: () => request("/logs/live"),
	getChatLog: () => request("/chat"),
	sendChat: (message) => request("/chat", { method: "POST", body: JSON.stringify({ message }) }),
	getProcess: () => request("/system/process"),
};

export function useToast() {
	const toasts = [];
	function show(message, type = "info", duration = 3000) {
		const id = Date.now();
		toasts.push({ id, message, type });
		setTimeout(() => {
			const idx = toasts.findIndex(t => t.id === id);
			if (idx >= 0) toasts.splice(idx, 1);
		}, duration);
	}
	return {
		toasts,
		success: (msg) => show(msg, "success"),
		error: (msg) => show(msg, "error"),
		info: (msg) => show(msg, "info")
	};
}

export function formatUptime(ms) {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	if (d > 0) return `${d}天 ${h % 24}时`;
	if (h > 0) return `${h}时 ${m % 60}分`;
	if (m > 0) return `${m}分 ${s % 60}秒`;
	return `${s}秒`;
}

export function formatBytes(bytes) {
	if (bytes < 1024) return bytes + " B";
	if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
	return (bytes / 1048576).toFixed(1) + " MB";
}
