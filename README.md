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
| `commandPrefix` | 命令前缀（默认 `!`） |
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

| 等级 | 说明 |
|------|------|
| `normal` | 所有玩家默认可用 |
| `user` | 需要 `user` 及以上权限 |
| `op` | 需要 `op` 及以上权限 |
| `owner` | 需要 `owner` 权限（最高级） |

## 命令

所有命令以命令前缀开头（`config.js` 中的 `commandPrefix`，默认为 `!`），在**游戏聊天框**或**服务器终端**中输入。参数用空格分隔，含空格的参数可用双引号包裹（如 `!m:run "我的歌.mid"`），`[参数]` 表示可选。

### 📖 帮助与信息

| 命令 | 权限 | 说明 |
|------|------|------|
| `!t:help [页码]` | normal | 分页查看全部可用命令（每页 5 条） |
| `!p:q` | normal | 查询自身权限等级 |
| `!p:query <账号>` | normal | 查询指定账号的权限等级 |
| `!t:ping` | owner | 检测与服务器的延迟 |
| `!t:time` | owner | 查看当前时间（北京时间） |

### 🧰 客户端工具

| 命令 | 权限 | 说明 |
|------|------|------|
| `!t:send <消息内容>` | op | 向当前客户端广播消息 |
| `!t:tellall [true/false]` | op | 查看/切换 tellAll 转发模式（true=转发为 tell） |
| `!t:cmd <基岩版命令>` | op | 执行基岩版命令并显示返回状态 |
| `!t:start` | owner | 重新开始 SAPI 轮询 |
| `!t:move` | owner | 将当前客户端设为主客户端 |
| `!t:reloadmod <Mod 名称>` | owner | 重载指定客户端 Mod |
| `!t:reload` | owner | 重载当前客户端的全部 Mod（不断开连接） |
| `!t:mod` | owner | 显示所有已加载的客户端 Mod |
| `!t:exec <命令>` | owner | 在服务器终端执行系统命令（危险，慎用） |

### 📐 区域编辑（A/B 点）

先用 `!p:a` / `!p:b` 记录两个角点，再执行后续操作。

| 命令 | 权限 | 说明 |
|------|------|------|
| `!p:a [X Y Z]` | op | 设置 A 点坐标（缺省取自身坐标） |
| `!p:b [X Y Z]` | op | 设置 B 点坐标（缺省取自身坐标） |
| `!p:show` | op | 显示当前 A/B 点坐标 |
| `!p:distance` | op | 计算 A B 两点间距离（保留 3 位小数） |
| `!p:offset` | op | 计算 B 点相对于 A 点的偏移量 |
| `!p:fill <方块 ID> [目标方块 ID]` | op | 填充 A B 两点间区域（可指定替换目标方块） |
| `!p:copy` | op | 复制 A B 两点间区域 |
| `!p:paste [X Y Z]` | op | 粘贴复制的结构（缺省取自身坐标） |
| `!p:cut` | op | 剪切 A B 两点间区域（复制后填充空气） |
| `!p:cancel` | op | 中断当前操作 |
| `!p:status` | op | 查看当前任务进度 |

### 🎵 音乐播放

| 命令 | 权限 | 说明 |
|------|------|------|
| `!m:join` | normal | 加入音乐收听 |
| `!m:exit` | normal | 退出音乐收听 |
| `!m:status` | normal | 查看当前播放进度 |
| `!m:list [页码]` | normal | 查看音乐列表 |
| `!m:search <关键词> [页码]` | normal | 搜索音乐文件 |
| `!m:percussion <on/off>` | normal | 开启/关闭打击乐器 |
| `!m:run <音乐文件名>` | user | 快速播放指定音乐 |
| `!m:next` | user | 切换到下一首音乐 |
| `!m:random` | user | 随机播放音乐 |
| `!m:loop <next/random/single> [歌名]` | user | 设置循环播放模式（single 模式可指定歌名） |
| `!m:stop <music/loop/all>` | user | 停止播放（仅音乐 / 仅循环 / 全部） |

### 🏗️ Litematic 建筑导入

| 命令 | 权限 | 说明 |
|------|------|------|
| `!l:help [命令名]` | op | 查看全部命令，或查看指定命令的详细用法 |
| `!l:list [页码]` | op | 查看建筑文件列表 |
| `!l:search <关键词> [页码]` | op | 搜索建筑文件 |
| `!l:create <文件名> [X Y Z] [trim/raw]` | op | 导入 Litematic 建筑投影（返回任务 ID，需确认） |
| `!l:y` | op | 确认导入操作 |
| `!l:n` | op | 取消/中断导入、检查或修复 |
| `!l:status` | op | 查看导入/检查/修复进度 |
| `!l:preview <文件名> [X Y Z] [trim/raw]` | op | 粒子边框 + 实体标记预览建筑位置 |
| `!l:unpreview` | op | 清除建筑预览 |
| `!l:export <文件名> [导出名] [trim/raw]` | op | 导出为 MCBE 结构方块文件 (.mcstructure) |
| `!l:id` | op | 查看所有任务 ID |
| `!l:verify <ID> [map/world]` | op | 检查投影与世界的差异（map=方块映射错误，缺省=世界一致性） |
| `!l:fix <ID> [替代方块]` | op | 修复被挖掉的方块 / 替换无法映射的方块 |
| `!l:author` | op | 查看作者信息 |

### 🖼️ 图片转像素画

| 命令 | 权限 | 说明 |
|------|------|------|
| `!i:create <图片文件名> [方向] [X Y Z]` | op | 将图片转换为像素画（缩放到最大 256px，方向 x/y/z） |
| `!i:raw <图片文件名> [方向] [X Y Z]` | op | 原始尺寸转换（最大 2048px，仅支持 x/z） |
| `!i:y` | op | 确认转换操作 |
| `!i:n` | op | 取消/中断转换 |
| `!i:status` | op | 查看转换进度 |

### 🤖 AI 对话

| 命令 | 权限 | 说明 |
|------|------|------|
| `!ai <对话内容>` | normal | 与 AI 进行对话 |
| `!ai:reset` | normal | 重置对话上下文 |
| `!ai:c <对话内容>` | op | 让 AI 解析并执行基岩版命令 |

### 📜 Function 文件执行

| 命令 | 权限 | 说明 |
|------|------|------|
| `!f:function <文件路径>` | op | 运行 .mcfunction 文件 |
| `!f:loop <文件路径> <循环名称> <间隔秒>` | op | 循环运行 Function |
| `!f:stop <循环名称>` | op | 停止指定循环 |
| `!f:stopAll` | op | 停止所有循环 |

### 🛡️ 权限管理

| 命令 | 权限 | 说明 |
|------|------|------|
| `!p:add <权限类型> <账号>` | owner | 添加指定账号权限（如 `!p:add op 玩家名`） |
| `!p:remove <权限类型> <账号>` | owner | 删除指定账号权限 |

### 💬 QQ 群互通（需在 `config.js` 开启 `features.qq.enabled`）

| 命令 | 权限 | 说明 |
|------|------|------|
| `!q:send <消息内容>` | user | 向 QQ 群发送消息（仅主客户端） |
| `!q:check` | owner | 检测并手动重连 QQ |
| `!q:toggle [true/false]` | owner | 开启/关闭 QQ 互通功能 |

### 🔌 扩展连接

| 命令 | 权限 | 说明 |
|------|------|------|
| `!c:connect <WebSocket 地址>` | op | 让客户端同时连接到额外 WebSocket 服务端（缺省协议自动补 `ws://`） |

### 🖥️ 服务器终端命令

在服务器终端输入，前缀同样为 `!`：

| 命令 | 说明 |
|------|------|
| `!test` / `!testx` | 测试命令 |
| `!bye` | 强制退出当前房间 |
| `!p:list` | 列出所有连接（主客户端 + IP 或编号 + IP） |
| `!p:reload` | 重载所有服务端 Mod 与所有客户端 Mod 实例 |
| `!p:mod` | 列出所有服务端 Mod 与客户端 Mod |
| `!c:attack` | 攻击客户端聊天（刷屏攻击文本） |
| `!c:count` | 聊天室崩溃倒计时 |
| `!c:crash` | 崩溃客户端聊天（倒计时后发起攻击） |
| `!c:clear` | 清屏聊天消息 |
| `!c:ad` | 按 `spam.adInterval` 推送广告 |
| `!c:repeat <内容>` | 刷屏指定内容 |
| `!c:stop` | 停止所有刷屏 |
| `!c:line <内容>` | 换行发言 |

终端其他输入：

- `/命令` → 作为基岩版游戏命令转发给主客户端执行（如 `/time set day`）
- 普通文本 → 作为聊天消息广播给所有客户端

## 依赖

`ws`、`uuid`、`midi-file`、`openai`、`node-napcat-ts` 等（见 `package.json`）。