<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { routes } from "./router";

const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(false);
const authChecked = ref(false);

onMounted(() => {
	if (sessionStorage.getItem("auth_token")) {
		authChecked.value = true;
	}
});

const isLoginPage = computed(() => route.path === "/login");

const navGroups = computed(() => [
	{ label: "控制", items: routes.filter(r => ["/", "/commands", "/clients"].includes(r.path)) },
	{ label: "管理", items: routes.filter(r => ["/mods", "/permissions"].includes(r.path)) },
	{ label: "监控", items: routes.filter(r => ["/logs", "/chat"].includes(r.path)) },
	{ label: "系统", items: routes.filter(r => ["/config"].includes(r.path)) }
]);

const iconMap = {
	dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
	mods: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
	commands: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
	permissions: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
	clients: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
	logs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
	chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
	config: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};

function navigate(path) {
	router.push(path);
	sidebarOpen.value = false;
}
</script>

<template>
	<!-- 登录页：完全独立，无侧边栏 -->
	<div v-if="isLoginPage" class="app-layout">
		<router-view />
	</div>

	<!-- 未完成 auth 检查前不渲染任何内容 -->
	<div v-else-if="authChecked" class="app-layout">
		<button v-show="!sidebarOpen" class="hamburger" @click="sidebarOpen = true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<line x1="3" y1="6" x2="21" y2="6"/>
				<line x1="3" y1="12" x2="21" y2="12"/>
				<line x1="3" y1="18" x2="21" y2="18"/>
			</svg>
		</button>

		<div class="sidebar-overlay" :class="{ open: sidebarOpen }" @click="sidebarOpen = false"></div>

		<aside class="sidebar" :class="{ open: sidebarOpen }">
			<div class="sidebar-header">
				<div class="sidebar-title">
					<span class="sidebar-title-bar"></span>
					<h1>ModLoader</h1>
				</div>
				<button class="sidebar-close" @click="sidebarOpen = false">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="6" x2="6" y2="18"/>
						<line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</div>
			<nav class="sidebar-nav">
				<template v-for="group in navGroups" :key="group.label">
					<div class="nav-section">{{ group.label }}</div>
					<a
						v-for="item in group.items"
						:key="item.path"
						class="nav-item"
						:class="{ active: route.path === item.path }"
						@click="navigate(item.path)"
					>
						<span class="nav-icon" v-html="iconMap[item.meta.icon]"></span>
						{{ item.meta.title }}
					</a>
				</template>
			</nav>
		</aside>

		<main class="main-content">
			<router-view />
		</main>
	</div>
</template>
