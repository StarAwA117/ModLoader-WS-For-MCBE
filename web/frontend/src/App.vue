<script setup>
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { routes } from "./router";

const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(false);

const navGroups = computed(() => [
	{ label: "控制", items: routes.filter(r => ["/", "/commands", "/clients"].includes(r.path)) },
	{ label: "管理", items: routes.filter(r => ["/mods", "/permissions", "/config"].includes(r.path)) },
	{ label: "监控", items: routes.filter(r => ["/logs", "/chat"].includes(r.path)) }
]);

function navigate(path) {
	router.push(path);
	sidebarOpen.value = false;
}
</script>

<template>
	<div class="app-layout">
		<aside class="sidebar" :class="{ open: sidebarOpen }">
			<div class="sidebar-header">
				<h1>StarWS</h1>
				<div class="subtitle">Minecraft Bedrock Bridge</div>
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
						<span class="icon">{{ item.meta.icon }}</span>
						{{ item.meta.title }}
					</a>
				</template>
			</nav>
			<div class="sidebar-footer">StarWS v1.0</div>
		</aside>
		<main class="main-content">
			<router-view />
		</main>
	</div>
</template>
