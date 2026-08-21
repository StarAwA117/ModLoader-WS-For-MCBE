import { createRequire } from "module";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_JSON = path.join(ROOT, "config.json");
const CONFIG_EXAMPLE = path.join(ROOT, "config.example.json");
const MARKER = path.join(ROOT, ".configured"); // 首次运行标记：配置向导完成后写入
const WANT_RESET = process.argv.includes("--reset-all");

export const configPaths = { ROOT, CONFIG_JSON, CONFIG_EXAMPLE, MARKER };

//  配置初始化

/**
 * 是否首次运行：标记文件不存在即视为首次（需走图形化配置向导）
 * @returns {boolean}
 */
export function isFirstRun() {
	return !fs.existsSync(MARKER);
}

/**
 * 标记配置已完成（配置向导保存成功后调用）
 */
export function markConfigured() {
	try {
		fs.writeFileSync(MARKER, new Date().toISOString(), "utf8");
	} catch {
		// 标记不可写时静默忽略，下次启动仍会进入向导
	}
}

/**
 * 按模板生成 config.json
 */
export function scaffoldConfig() {
	const tpl = fs.readFileSync(CONFIG_EXAMPLE, "utf8");
	fs.writeFileSync(CONFIG_JSON, tpl, "utf8");
	console.log("未找到 config.json，已根据模板自动生成默认配置");
}

/**
 * 确保 config.json 存在（依赖 config.json 的模块加载前必须调用）
 * @returns {string} config.json 路径
 */
export function ensureConfig() {
	if (!fs.existsSync(CONFIG_JSON)) scaffoldConfig();
	return CONFIG_JSON;
}

/**
 * 一键重置：删除 config.json / permission.json 及其 .bak 备份与首次运行标记（不启动服务器）
 * @returns {string[]} 已删除的文件名列表
 */
export function resetConfig() {
	const files = ["config.json", "config.json.bak", "permission.json", "permission.json.bak", ".configured"];
	const removed = [];
	for (const name of files) {
		const p = path.join(ROOT, name);
		if (fs.existsSync(p)) {
			fs.rmSync(p, { force: true });
			removed.push(name);
		}
	}
	console.log("========================================");
	console.log("  配置已重置，下次启动将进入配置向导");
	console.log("========================================");
	return removed;
}

//  依赖安装

/** 读取 package.json，失败则退出 */
function loadPackageJson() {
	try {
		return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	} catch (e) {
		console.error(`无法读取 package.json: ${e.message}`);
		process.exit(1);
	}
}

/** 检测单个依赖是否真正可加载（含传递依赖解析，最接近真实运行环境） */
function isInstalled(dep) {
	const require = createRequire(import.meta.url);
	try {
		require.resolve(dep, { paths: [ROOT] });
		return true;
	} catch {
		return false;
	}
}

/** 检测 npm 是否可用 */
function hasNpm() {
	const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
	const res = spawnSync(npmCmd, ["--version"], { encoding: "utf8" });
	return res.status === 0;
}

const ONLY_CHECK = process.argv.includes("--check");

/**
 * 检测并安装依赖（缺失时自动 npm install），失败直接退出
 */
export function installDeps() {
	const pkg = loadPackageJson();
	const deps = Object.keys(pkg.dependencies || {});
	console.log(`检测到 ${deps.length} 个依赖: ${deps.join(", ")}`);

	const missing = deps.filter((dep) => !isInstalled(dep));

	if (missing.length === 0) {
		console.log("依赖已齐全，无需安装");
		return;
	}

	console.log(`缺少 ${missing.length} 个依赖: ${missing.join(", ")}`);

	if (ONLY_CHECK) {
		console.error("依赖不完整（--check 模式，不执行安装）");
		process.exit(1);
	}

	if (!hasNpm()) {
		console.error("未检测到 npm，请先安装 Node.js（https://nodejs.org）后再试");
		process.exit(1);
	}

	console.log("正在执行 npm install（首次安装可能需要几分钟）...");
	const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
	const res = spawnSync(npmCmd, ["install"], { cwd: ROOT, stdio: "inherit" });

	if (res.status !== 0) {
		console.error(`npm install 失败（退出码 ${res.status}），请手动运行 npm install 查看详细报错`);
		process.exit(1);
	}

	// 安装后二次验证
	const stillMissing = deps.filter((dep) => !isInstalled(dep));
	if (stillMissing.length > 0) {
		console.error(`安装完成后仍缺少: ${stillMissing.join(", ")}`);
		process.exit(1);
	}

	console.log("========================================");
	console.log("  依赖安装完成，可以启动服务器了");
	console.log("  运行: npm start  或  node ws.js");
	console.log("========================================");
}

//  直接运行入口（被导入时不执行，避免污染调用方进程）
//  注意：此处使用异步 IIFE 而非顶层 await，否则 Node 会报
//  "unsettled top-level await" 并直接退出（HTTP 服务器无法保持事件循环）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	(async () => {
		if (WANT_RESET) {
			resetConfig();
			process.exit(0);
		}

		// 1) 安装依赖（缺失时自动 npm install）
		installDeps();

		// 2) 启动图形化配置向导，生成 config.json / permission.json
		//    保存成功后会自行关闭临时服务器
		const { startSetupServer } = await import("./lib/setup.js");
		try {
			await startSetupServer();
			console.log("配置已保存，请运行 node ws.js 启动服务器");
		} catch (e) {
			console.error(`配置向导异常: ${e.message}`);
			process.exit(1);
		}
		process.exit(0);
	})();
}
