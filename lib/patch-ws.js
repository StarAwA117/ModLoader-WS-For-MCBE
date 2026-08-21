// MCBE 兼容补丁：容忍客户端发送的 close 帧状态码 0
//
// 背景：Minecraft Bedrock 客户端断开连接时发送的 WebSocket close 帧状态码为 0，
// 而 RFC 6455 规定 0 是非法状态码。ws 库（receiver.js / sender.js）通过
// validation.isValidStatusCode 校验，将 code 0 视为致命协议错误
// （WS_ERR_INVALID_CLOSE_CODE），导致连接被强制终止并输出
// "Invalid WebSocket frame: invalid status code 0"。
//
// 修复：在 ws 被加载前替换 validation.isValidStatusCode，
// 将 0 视为合法关闭码，使连接按正常关闭流程处理（触发 close 事件，不报错）。
//
// 注意：必须在使用 `import ... from "ws"` 之前导入本模块（放在 ws.js 顶部）。
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

try {
	// 通过 ws/package.json（exports 允许的入口）定位 ws 实际安装位置，
	// 再用绝对路径加载 lib/validation.js，绕过 exports 映射限制。
	// 绝对路径与 receiver.js / sender.js 内部的 require('./validation') 命中同一个
	// CJS 模块缓存，保证解构引用到的是修补后的函数。
	const wsRoot = path.dirname(require.resolve("ws/package.json"));
	const validation = require(path.join(wsRoot, "lib", "validation.js"));

	const originalIsValidStatusCode = validation.isValidStatusCode;
	validation.isValidStatusCode = (code) => {
		// MCBE 客户端会发送状态码 0 的 close 帧，按正常关闭处理
		if (code === 0) return true;
		return originalIsValidStatusCode(code);
	};
} catch {
	// ws 内部结构变化时静默降级，不影响服务启动（仅影响 close code 0 的报错显示）
}
