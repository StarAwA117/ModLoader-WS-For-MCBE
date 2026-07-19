# ModLoader-WS-For-MCBE

基于 WebSocket 的 Minecraft: Bedrock Edition Mod 加载器。服务器拦截 MCBE 的 WebSocket 协议，提供事件驱动接口，用于接收游戏事件并向客户端执行命令。

## 环境要求

- Node.js >= 14
- npm 包：`ws`、`uuid`

## 安装与运行

```bash
git clone https://github.com/StarAwA117/ModLoader-WS-For-MCBE.git
cd ModLoader-WS-For-MCBE
npm install ws uuid
node ws.js
```

服务器启动后监听 19132 端口，MCBE 客户端在本地世界可通过如下命令连接。

```
/connect 127.0.0.1:19132
```

## 配置

编辑 `config.js`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `track` | `boolean` | `false` | 调试日志开关 |
| `commandPrefix` | `string` | `"!"` | 聊天中触发命令的前缀字符 |
| `mods.client` | `object` | `{}` | 客户端 Mod 注册表 `{ 名称: require路径 }` |
| `mods.server` | `object` | `{}` | 服务端 Mod 注册表 `{ 名称: require路径 }` |

## 权限系统

权限数据主要存储于 `permission.json`，共五个层级：

- **Owner** — 拥有者，最高权限，可执行所有命令
- **OP** — 管理员，可执行 `op`、`user` 和 `normal` 级别命令
- **User** — 普通注册用户，可执行 `user` 和 `normal` 级别命令
- **Normal** — 普通玩家，不在 `permission.json` 定义。所有玩家默认为该权限
- **Blocker** — 黑名单玩家，连接时拒绝

权限大小排序：`Owner > OP > User > Normal > Blocker`

## Mod 机制

### 客户端 Mod

每个连接实例化一次。在 `config.js` 中注册：

```js
mods: {
  client: { myMod: "../mod/myMod.js" },
  server: {}
}
```

导出对象需包含 构造函数、`commands` 方法（返回按权限等级分类的命令映射表）、`destroy` 方法。

```js
// commands() 返回格式示例
{
  normal: [...],  // 所有用户可用（不含 Blocker）
  user: [...],    // User 以上权限可用
  op: [...],      // OP 以上权限可用
  owner: [...]    // 仅 Owner 权限可用
}
```

### 服务端 Mod

全局单例，启动时加载。在 `config.js` 中注册：

```js
mods: {
  client: {},
  server: { myMod: "../mod/myMod.js" }
}
```

导出对象需包含 `start` 静态方法与 `destroy` 静态方法。

## 项目结构

```
ModLoader-WS-For-MCBE/
├── ws.js              入口，WebSocket 服务与连接处理
├── config.js          运行时配置
├── permission.json    权限数据
├── lib/
│   ├── command.js     命令定义与参数解析
│   ├── current.js     全局连接状态单例
│   ├── logger.js      日志（控制台 + 文件）
│   ├── mods.js        Mod 管理器
│   ├── permission.js  权限读写与查询
│   ├── player.js      玩家管理类
│   ├── shared.js      共享日志实例
│   └── utils.js       WebSocket 工具类（协议封装）
└── mod/               Mod 存放目录
```

---

## API

### Command

命令定义与参数解析。支持链式调用构建命令。

```js
const Command = require("../lib/command");

const cmd = Command.create("greet", "打招呼")
  .addString("target")
  .setFunc((commander, target) => {
    utils.tell(`你好, ${target}!`, commander);
  });
```

#### 静态方法

| 方法 | 说明 |
|---|---|
| `Command.create(name, description?)` | 创建命令实例 |
| `Command.setCommandPrefix(text)` | 动态修改命令前缀，不允许包含空格，返回 `boolean` |
| `Command.parseArgs(input)` | 解析参数字符串，支持双引号包裹含空格参数，返回 `string[]` |

#### 实例方法

| 方法 | 参数 | 说明 |
|---|---|---|
| `.addBoolean(desc?)` | `string?` | 添加布尔参数（`"true"` / `"false"`） |
| `.addString(desc?)` | `string?` | 添加字符串参数 |
| `.addInteger(desc?)` | `string?` | 添加整型参数 |
| `.addFloat(desc?)` | `string?` | 添加浮点参数 |
| `.addEnum(values, desc?)` | `string[], string?` | 添加枚举参数，限定可选值 |
| `.add(type, desc?)` | `string, string?` | 添加自定义类型参数 |
| `.setFunc(func)` | `Function` | 设置执行回调，签名为 `(commander, ...args) => {}` |

#### execute 返回值

```js
// 命令匹配并执行成功
{ status: true, message: [解析后的参数...] }

// 命令匹配但参数校验失败或执行异常
{ status: false, message: "错误信息" }

// 命令名不匹配（不是本命令）
false
```

---

### Utils

WebSocket 工具类，封装 Minecraft 基岩版协议。构造时自动将 `runCommand`、`subscribe`、`tellAll`、`tell` 四个方法挂载到 `client` 对象上。

```js
const Utils = require("../lib/utils");
const utils = new Utils(ws);
// 此后可直接通过 client.runCommand(...) 调用
```

#### 挂载到 client 的方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `runCommand` | `(command: string, callback?: Function) => boolean` | 执行游戏命令。命令字节长度 >= 462 时返回 `false`（游戏限制，超出会导致客户端断开连接）。可选 `callback` 在收到命令响应时被调用 |
| `subscribe` | `(event: string, callback?: Function) => boolean` | 订阅游戏事件，同一事件可订阅多次。回调签名为 `(data) => {}`，`data.body` 包含事件数据 |
| `tellAll` | `(msg: string) => void` | 向所有玩家广播消息（通过 `/me` 命令），消息按 420 字节自动分割 |
| `tell` | `(msg: string, target?: string, isPrefix?: boolean) => void` | 向指定目标发送 `tellraw` 消息。`target` 默认 `"@a"`；`isPrefix` 默认 `true`，添加 `* 外部` 前缀。消息按 300 字节自动分割 |

常用事件名：

| 事件名 | 说明 |
|---|---|
| `PlayerMessage` | 玩家发送消息，`data.body` 含 `sender`、`message`、`type` |
| `PlayerJoin` | 玩家加入游戏 |
| `PlayerLeave` | 玩家离开游戏 |
| `BlockUpdate` | 方块更新 |

#### 实例方法

需通过 `client.utils` 访问：

| 方法 | 签名 | 说明 |
|---|---|---|
| `runCommandUnsafe` | `(command: string, callback?: Function) => void` | 不校验长度的命令执行，用于特殊场景（如超长文本触发断开） |
| `subscribePackage` | `(uuid: string, callback: Function) => void` | 订阅所有游戏返回包（底层管理用），回调签名为 `(data) => {}` |
| `unsubscribePackage` | `(uuid: string) => void` | 取消订阅游戏返回包 |
| `destroy` | `() => void` | 销毁实例，清空所有回调 Map |

---

### Current

全局状态单例，存储当前主客户端引用和运行时数据。所有方法和属性均为 `static`。

```js
const Current = require("../lib/current");

// 存储定时器 ID
Current.set("loop", setInterval(() => { ... }, 1000));

// 取消定时器
if (Current.has("loop")) clearInterval(Current.get("loop"));
```

| 成员 | 类型 | 说明 |
|---|---|---|
| `Current.client` | `WebSocket \| null` | 当前主客户端连接实例 |
| `Current.has(key)` | `(string) => boolean` | 检查属性是否存在 |
| `Current.get(key)` | `(string) => any` | 获取属性值 |
| `Current.set(key, value)` | `(string, any) => any` | 设置属性值，返回赋的值 |
| `Current.reset()` | `() => void` | 重置 `client` 和所有属性 |

---

### PermissionManager

异步权限管理类，读写 `permission.json` 文件。所有方法均为 `static async`。

```js
const PermissionManager = require("../lib/permission");

const level = await PermissionManager.query("Steve");
// -1 (Blocker) | 0 (Normal) | 1 (User) | 2 (OP) | 3 (Owner)

await PermissionManager.add("user", "Notch");
await PermissionManager.remove("op", "Notch");
```

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `get(object?)` | `"all"` \| `"blocker"` \| `"user"` \| `"op"` | `Promise<object \| string[]>` | 读取权限配置，`object` 为 `"all"` 时返回完整对象 |
| `set(newPer)` | `object` | `Promise<true \| Error>` | 写入完整权限配置 |
| `add(object, value)` | `string, string` | `Promise<true \| Error>` | 向指定权限组添加成员，已存在则直接返回 `true` |
| `remove(object, value)` | `string, string` | `Promise<true \| Error>` | 从指定权限组移除成员 |
| `query(queried)` | `string` | `Promise<number \| Error>` | 查询成员权限等级，返回 `-1`(Blocker)、`0`(Normal)、`1`(User)、`2`(OP)、`3`(Owner)，按 Owner > Blocker > OP > User > Normal 优先级匹配 |

---

### shared / Logger

共享日志实例，通过 `shared` 模块直接引用。

```js
const shared = require("../lib/shared");

shared.logger.info("服务启动");
shared.logger.error("连接失败");
shared.messageLogger.log("收到消息");
```

#### Logger 实例

| 实例 | 说明 |
|---|---|
| `shared.logger` | 应用主日志，输出到控制台和 `./logs/app.log` |
| `shared.messageLogger` | 消息日志，输出到 `./logs/message.log` |

#### Logger 方法

| 方法 | 说明 |
|---|---|
| `log(message, type?)` | 核心方法，`type` 为 `"info"` / `"warning"` / `"error"` / `"debug"` 时加格式化前缀和颜色，其他值原样输出 |
| `info(message)` | 信息级别（绿色） |
| `warning(message)` | 警告级别（黄色） |
| `error(message)` | 错误级别（红色） |
| `debug(message)` | 调试级别（紫色） |

---

## 备注
- 该 README.md 文档与项目中部分代码注释由 **AI** 辅助生成，经人工审校后整理。
