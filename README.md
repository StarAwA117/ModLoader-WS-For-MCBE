[English](./README_EN.md) | 简体中文

# StarWS

Minecraft 基岩版 WebSocket 桥接服务器。通过游戏内置 WebSocket API 连接客户端，以 Mod 方式注入命令与自动化能力。

## 功能

- 游戏内命令执行与自动化（Litematic 建筑导入、图片转像素画、.mcfunction 等）
- AI 对话与 AI 执行命令（OpenAI 兼容接口）
- MIDI 音乐播放、区域填充复制、权限管理、QQ 群互通
- 客户端/服务端分层 Mod 加载机制

## 快速开始

```bash
npm install
npm start
```

首次运行会启动图形化配置向导，按提示填写后重启服务器即可。

游戏内输入 `/connect 127.0.0.1:8080` 连接。

## 命令

游戏聊天栏输入 `t:help` 获取命令帮助。完整命令列表见 [文档](./docs/)。

## 许可

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
