import { createRouter, createWebHistory } from "vue-router";

const routes = [
	{ path: "/login", name: "login", component: () => import("../views/Login.vue"), meta: { title: "登录", public: true } },
	{ path: "/", name: "dashboard", component: () => import("../views/Dashboard.vue"), meta: { title: "仪表盘", icon: "dashboard" } },
	{ path: "/mods", name: "mods", component: () => import("../views/Mods.vue"), meta: { title: "模组管理", icon: "mods" } },
	{ path: "/commands", name: "commands", component: () => import("../views/Commands.vue"), meta: { title: "命令", icon: "commands" } },
	{ path: "/permissions", name: "permissions", component: () => import("../views/Permissions.vue"), meta: { title: "权限", icon: "permissions" } },
	{ path: "/clients", name: "clients", component: () => import("../views/Clients.vue"), meta: { title: "客户端", icon: "clients" } },
	{ path: "/logs", name: "logs", component: () => import("../views/Logs.vue"), meta: { title: "日志", icon: "logs" } },
	{ path: "/chat", name: "chat", component: () => import("../views/Chat.vue"), meta: { title: "聊天", icon: "chat" } },
	{ path: "/config", name: "config", component: () => import("../views/Config.vue"), meta: { title: "配置", icon: "config" } },
];

const router = createRouter({
	history: createWebHistory(),
	routes
});

router.beforeEach((to, from, next) => {
	const token = sessionStorage.getItem("auth_token");
	if (!to.meta.public && !token) {
		next("/login");
	} else if (to.path === "/login" && token) {
		next("/");
	} else {
		next();
	}
});

export default router;
export { routes };
