[English](./README_EN.md) | 简体中文

# MCWSLoader

Minecraft 基岩版 WebSocket 桥接服务器。通过游戏内置 WebSocket API 连接客户端，以 Mod 方式注入命令与自动化能力。

## 功能

- 游戏内命令执行与自动化（Litematic 建筑导入、图片转像素画、.mcfunction 等）
- AI 对话与 AI 执行命令（OpenAI 兼容接口）
- MIDI 音乐播放、区域填充复制、权限管理、QQ 群互通
- 客户端/服务端分层 Mod 加载机制
- Web 管理界面（端口 18889），支持在线配置、Mod 管理、日志查看、版本更新

## 快速开始

```bash
npm start
```

首次运行会自动从 `config.example.json` 初始化 `config.json`。启动后访问 WebUI（`http://127.0.0.1:18889`）即可在线配置。

游戏内输入 `/connect 127.0.0.1:8080` 连接。

## WebUI 功能

启动后访问 `http://127.0.0.1:18889` 即可打开管理面板：

- **仪表盘**：服务器状态、运行时间、连接客户端数、进程信息
- **模组管理**：启用/禁用/重载 Mod，查看清单与文档
- **命令**：执行基岩版命令并查看结果
- **客户端**：查看已连接客户端，切换主客户端
- **日志**：查看运行日志与聊天记录
- **配置**：在线修改服务器、WebUI、SAPI、限流等配置
- **更新**：检查 GitHub 最新版本，支持版本列表选择更新或回退

## 自更新

WebUI 内置更新功能，可自动检测 GitHub 最新 Release 版本，支持：
- 一键更新到最新版本
- 从版本列表选择任意 Release 版本回退
- 更新完成后自动提示重启

## 命令

游戏聊天栏输入 `t:help` 获取命令帮助。完整命令列表见 [文档](./docs/)。

## 许可

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
