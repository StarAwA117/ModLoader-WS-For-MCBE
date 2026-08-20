# Minecraft 基岩版 WebSocket 服务器

一个面向 Minecraft Bedrock Edition 的 WebSocket 桥接服务器。通过基岩版内置的 WebSocket API 与游戏客户端建立连接，在服务器端以模块（Mod）方式注入命令与自动化能力，实现游戏内命令执行、建造、音乐、AI 对话、跨平台互通等功能。

## 功能

- 游戏内命令执行与自动化（Litematic 建筑导入、图片转像素画、.mcfunction 执行等）
- 通过 OpenAI 兼容接口对接 AI 对话与 AI 执行命令
- MIDI 音乐播放、区域填充复制、权限管理、QQ 群互通
- 客户端/服务端分层的 Mod 加载机制，可独立启停

## 快速开始

### 环境要求

- Node.js（ES Module 支持，推荐 v18+）

### 安装与启动

```bash
npm install
npm start
```

启动后服务器监听 `config.js` 中的 `wsConfig.port`（默认 8080）。

### 游戏端连接

在基岩版游戏内输入命令：

```
/connect 127.0.0.1:8080
```

将 `127.0.0.1` 替换为服务器实际地址。连接成功后第一个接入的客户端自动成为**主客户端**。

## 配置

复制 `config.example.js` 为 `config.js` 并按需修改，主要配置项：

| 配置 | 说明 |
|------|------|
| `wsConfig.port` | 服务器端口（默认 8080） |
| `commandPrefix` | 命令前缀（默认 `$`） |
| `logLevel` | 日志等级（debug < info < warning < error） |
| `AIConfig` | AI 接口地址、API Key、模型参数 |
| `mods.client` / `mods.server` | 客户端/服务端 Mod 加载清单 |
| `basePath` | 各 Mod 资源目录 |
| `rateLimit` | 命令限流 |
| `spam` | 聊天刷屏/广告模板与频率 |

## 目录结构

```
ws/
├── ws.js                # 服务器入口
├── config.js            # 全局配置
├── permission.json      # 权限配置
├── lib/                 # 框架核心（命令/工具/Mod 管理/SAPI/权限/日志）
├── mod/                 # 功能模块
├── resources/           # 资源文件（litematic/midi/mcfunc/pictures 等）
└── logs/                # 运行日志
```

## 权限

命令按权限分级：`normal` / `user` / `op` / `owner`，由 `permission.json` 配置账号权限与黑名单。

## 依赖

`ws`、`uuid`、`midi-file`、`openai`、`node-napcat-ts` 等（见 `package.json`）。