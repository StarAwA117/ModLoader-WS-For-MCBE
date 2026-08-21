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

### 首次运行（图形化配置）

首次运行（无 `config.json` 或无 `.configured` 标记）时，服务器自动启动**临时配置向导**并提示访问地址：

```
=========================================
  ModLoader 配置向导已启动
  请在浏览器打开: http://127.0.0.1:18888
  配置完成后请重新启动服务器
=========================================
```

1. 在浏览器中填写服务器名称、端口、模组选择、AI、QQ 桥接、玩家权限等信息
2. 点击「保存配置」后，自动生成 `config.json` 与 `permission.json`（旧文件自动备份为 `.bak`），并写入 `.configured` 标记
3. 重新启动服务器即完成配置

> 提示：配置向导仅监听 `127.0.0.1`（本机），不会对外网开放。如需重新配置，删除项目根目录下的 `.configured` 文件后重启即可。

### 手动配置

复制 `config.example.json` 为 `config.json` 并按需修改，详见下方配置表。

### 游戏端连接

在基岩版游戏内输入命令：

```
/connect 127.0.0.1:8080
```

将 `127.0.0.1` 替换为服务器实际地址。连接成功后第一个接入的客户端自动成为**主客户端**。

## 配置

配置存储在 `config.json`（不纳入版本控制），模板为 `config.example.json`。

| 配置项 | 说明 |
|--------|------|
| `ws.name` | 服务器名称 |
| `ws.port` | WebSocket 端口（默认 8080） |
| `commandPrefix` | 命令前缀（默认 `!`） |
| `logLevel` | 日志等级（debug < info < warning < error） |
| `mods.client` / `mods.server` | 客户端/服务端 Mod 加载清单 |
| `features.music` | 音乐设置（播放打击乐等） |
| `features.qq` | QQ 群互通设置（群号、桥接地址等） |
| `ai` | AI 接口地址、API Key、模型参数、对话冷却 |
| `spam` | 刷屏攻击文本、广告模板与推送间隔 |
| `sapi` | Minecraft Bedrock 服务端指令接口（gmsg/smsg） |
| `utils` | 工具设置（tellAll 转发模式、轮询开关） |
| `basePath` | 各模块资源目录（music/mcfunc/litematic/image） |
| `rateLimit` | 命令限流（窗口时间、上限次数） |

## 目录结构

```
ws/
├── ws.js                # 服务器入口
├── setup.js             # 独立配置脚本（首次运行 / 重新配置）
├── config.json          # 全局配置（gitignore）
├── config.example.json  # 配置模板
├── permission.json      # 权限配置
├── lib/                 # 框架核心（命令/工具/Mod 管理/SAPI/权限/日志）
├── mod/                 # 功能模块
├── resources/           # 资源文件（litematic/midi/mcfunc/pictures 等）
└── logs/                # 运行日志
```

## 权限

命令按权限分级：`normal` / `user` / `op` / `owner`，由 `permission.json` 配置账号权限与黑名单。

| 等级 | 说明 |
|------|------|
| `normal` | 所有玩家默认可用 |
| `user` | 需要 `user` 及以上权限 |
| `op` | 需要 `op` 及以上权限 |
| `owner` | 需要 `owner` 权限（最高级） |

## 命令

在游戏聊天栏输入 `t:help` 获取命令帮助。

## 依赖

`ws`、`uuid`、`midi-file`、`openai`、`node-napcat-ts` 等（见 `package.json`）。

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
