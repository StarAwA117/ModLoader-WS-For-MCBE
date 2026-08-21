<script setup>
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { loginWithPassword } from "../api";

const router = useRouter();
const route = useRoute();
const password = ref("");
const error = ref("");
const loading = ref(false);
const locked = ref(false);
const waitSec = ref(0);
let waitTimer = null;

async function doLogin(pwd) {
	loading.value = true;
	error.value = "";
	try {
		const data = await loginWithPassword(pwd);
		if (data.ok) {
			sessionStorage.setItem("auth_token", data.token);
			router.replace("/");
		} else if (data.locked) {
			locked.value = true;
			waitSec.value = data.waitSec;
			error.value = `已锁定，请等待 ${data.waitSec} 秒`;
			if (waitTimer) clearInterval(waitTimer);
			waitTimer = setInterval(() => {
				waitSec.value--;
				if (waitSec.value <= 0) {
					locked.value = false;
					error.value = "";
					clearInterval(waitTimer);
				}
			}, 1000);
		} else {
			error.value = `密码错误，剩余 ${data.remaining} 次尝试`;
		}
	} catch {
		error.value = "连接失败";
	}
	loading.value = false;
}

onMounted(() => {
	const token = sessionStorage.getItem("auth_token");
	if (token) {
		router.replace("/");
		return;
	}
	const pwd = route.query.pwd;
	if (pwd) {
		doLogin(pwd);
	}
});

function login() {
	if (!password.value.trim()) {
		error.value = "请输入密码";
		return;
	}
	doLogin(password.value);
}
</script>

<template>
	<div class="login-page">
		<div class="login-card">
			<div class="login-header">
				<div class="login-bar"></div>
				<h1>StarWS</h1>
			</div>
			<p class="login-desc">WebUI 登录</p>
			<div class="form-group">
				<input
					v-model="password"
					type="password"
					placeholder="输入密码"
					:disabled="locked || loading"
					@keyup.enter="login"
					autofocus
				/>
			</div>
			<div v-if="error" class="login-error">{{ error }}</div>
			<button class="btn btn-primary login-btn" @click="login" :disabled="locked || loading">
				{{ loading ? "验证中..." : locked ? `等待 ${waitSec}s` : "登录" }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.login-page {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100vw;
	height: 100vh;
	position: fixed;
	inset: 0;
	padding: 20px;
	background: var(--bg);
	z-index: 9999;
}

.login-card {
	width: 100%;
	max-width: 340px;
	background: var(--bg-card);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 32px 28px;
	box-shadow: var(--shadow);
}

.login-header {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 8px;
}

.login-bar {
	width: 3px;
	height: 20px;
	background: var(--primary);
	border-radius: 2px;
}

.login-header h1 {
	font-size: 20px;
	color: var(--text);
	font-weight: 700;
}

.login-desc {
	font-size: 13px;
	color: var(--text-muted);
	margin-bottom: 20px;
}

.login-error {
	font-size: 13px;
	color: var(--danger);
	margin-bottom: 12px;
}

.login-btn {
	width: 100%;
	padding: 10px;
	font-size: 14px;
}
</style>
