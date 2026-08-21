#!/usr/bin/env node
// ============================================================
//  setup.js - 依赖安装器（用于空包主机）
// ------------------------------------------------------------
//  空包主机 = 只有项目文件、没有 node_modules 的环境
//  （例如直接从 GitHub 下载 zip 解压后运行）
//
//  用法：
//    node setup.js           检测依赖，缺失时自动 npm install
//    node setup.js --check   仅检测不安装（齐全退出 0，缺失退出 1）
//
//  npm start 会通过 prestart 自动先执行本脚本；
//  ws.js 在直接运行时也会在缺失依赖时调用本脚本。
// ============================================================
import { createRequire } from "module";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ONLY_CHECK = process.argv.includes("--check");

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

function main() {
	const pkg = loadPackageJson();
	const deps = Object.keys(pkg.dependencies || {});
	console.log(`检测到 ${deps.length} 个依赖: ${deps.join(", ")}`);

	const missing = deps.filter((dep) => !isInstalled(dep));

	if (missing.length === 0) {
		console.log("依赖已齐全，无需安装");
		process.exit(0);
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
	process.exit(0);
}

main();
