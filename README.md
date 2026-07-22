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

服务器启动后监听 8080 端口，MCBE 客户端在本地世界可通过如下命令连接。

```
/connect 127.0.0.1:8080
```

## 配置

编辑 `config.js`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `wsConfig.name` | `string` | `ModLoader` | 服务端外显名称 |
| `wsConfig.port` | `number` | `8080` | 端口号 |
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
const Command = require("../lib/command.js");

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

WebSocket 工具类，封装 Minecraft 基岩版协议。构造时自动将多个实用方法挂载到 `client` 对象上。

```js
const Utils = require("../lib/utils.js");
const utils = new Utils(ws);
// 此后可直接通过 client.runCommand(...)、client.tell(...) 等调用
```

#### 静态方法

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `setMulti(multimap, key, value)` | `Map, string, any` | `void` | 向 MultiMap 添加键值对（一个 key 对应多个 value） |
| `splitByBytes(str, maxBytes)` | `string, number` | `string[]` | 按字节长度分割字符串，用于消息自动分割 |

#### 挂载到 client 的方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `sendCommand` | `(command: string) => Promise<void>` | 静默执行命令，不返回结果，不抛出错误 |
| `runCommand` | `(command: string) => Promise<object>` | 执行命令并返回响应数据（`data.body`）。命令字节长度 > 461 时抛出错误 |
| `subscribe` | `(event: string, callback?: Function) => void` | 订阅游戏事件，同一事件可多次订阅。回调签名为 `(data) => {}`，`data.body` 包含事件数据 |
| `unsubscribe` | `(event: string) => void` | 取消订阅游戏事件并移除所有回调 |
| `tellAll` | `(msg: string) => void` | 向所有玩家广播消息（通过 `me` 命令），消息按 420 字节自动分割 |
| `tell` | `(msg: string, target?: string, isPrefix?: boolean) => void` | 向指定目标发送 `tellraw` 消息。`target` 默认 `"@a"`；`isPrefix` 默认 `true`，添加 `* 外部` 前缀。消息按 300 字节自动分割 |
| `getLocation` | `(target: string) => Promise<{x, y, z, dimension} \| null>` | 获取目标位置及维度 |
| `getPosition` | `(target: string) => Promise<{x, y, z} \| null>` | 获取目标坐标 |
| `getDimension` | `(target: string) => Promise<string \| null>` | 获取目标维度 |
| `getInventory` | `(target: string) => Promise<object \| undefined>` | 获取目标物品栏数据 |
| `getLocolPlayer` | `() => Promise<string \| undefined>` | 获取本地玩家名称 |
| `closechat` | `() => Promise<boolean>` | 关闭聊天框，返回状态码是否为 0 |

常用事件名：

| 事件名 | 说明 |
|---|---|---|
| `PlayerMessage` | 玩家发送消息，`data.body` 含 `sender`、`message`、`type` |
| `PlayerJoin` | 玩家加入游戏 |
| `PlayerLeave` | 玩家离开游戏 |
| `BlockUpdate` | 方块更新 |

#### 实例方法

需通过 `client.utils` 访问：

| 方法 | 签名 | 说明 |
|---|---|---|
| `sendCommandUnsafe` | `(command: string) => Promise<string>` | 不校验长度的命令执行，返回 UUID，用于特殊场景 |
| `sendCommandWithCheck` | `(command: string) => Promise<string>` | 校验参数和命令长度后执行，返回 UUID |
| `sendCommand` | `(command: string) => Promise<void>` | 静默执行命令，不返回结果 |
| `runCommand` | `(command: string) => Promise<object>` | 执行命令并返回响应数据 |
| `subscribe` | `(event: string, callback?: Function) => void` | 订阅游戏事件 |
| `unsubscribe` | `(event: string) => void` | 取消订阅游戏事件 |
| `subscribePackage` | `(uuid: string, callback: Function) => void` | 订阅所有游戏返回包（底层管理用），回调签名为 `(data) => {}` |
| `unsubscribePackage` | `(uuid: string) => void` | 取消订阅游戏返回包 |
| `tellAll` | `(msg: string) => void` | 广播消息 |
| `tell` | `(msg: string, target?: string, isPrefix?: boolean) => void` | 发送 tellraw 消息 |
| `getLocation` | `(target: string) => Promise<{x, y, z, dimension} \| null>` | 获取目标位置及维度 |
| `getPosition` | `(target: string) => Promise<{x, y, z} \| null>` | 获取目标坐标 |
| `getDimension` | `(target: string) => Promise<string \| null>` | 获取目标维度 |
| `getInventory` | `(target: string) => Promise<object \| undefined>` | 获取目标物品栏数据 |
| `getLocolPlayer` | `() => Promise<string \| undefined>` | 获取本地玩家名称 |
| `closechat` | `() => Promise<boolean>` | 关闭聊天框 |
| `onMessage` | `(data: object) => void` | 接收并分发消息到对应回调（内部使用） |
| `destroy` | `() => void` | 销毁实例，清空所有回调 Map |

---

### Current

全局状态单例，存储当前主客户端引用和运行时数据。所有方法和属性均为 `static`。

```js
const Current = require("../lib/current.js");

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
const PermissionManager = require("../lib/permission.js");

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
const shared = require("../lib/shared.js");

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

---

### Player

玩家处理类，管理客户端连接的所有玩家实例。自动通过 `/list` 命令轮询获取在线玩家列表。

```js
const Player = require("../lib/player.js");

// 初始化玩家管理
Player.init(client);

// 手动获取玩家列表
await Player.getPlayers(client);

// 销毁客户端所有玩家
Player.destroyAll(client);
```

#### 静态方法

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `init(client)` | `WebSocket` | `void` | 初始化客户端的玩家管理器，创建 `client.players` Map 并启动轮询 |
| `getPlayers(client)` | `WebSocket` | `Promise<void>` | 执行 `/list` 命令获取在线玩家，自动更新 `client.players`（增删） |
| `destroyAll(client)` | `WebSocket` | `void` | 销毁该客户端所有 Player 实例并停止轮询 |

#### 实例属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `name` | `string \| null` | 玩家名称 |
| `client` | `WebSocket \| null` | 所属客户端连接 |
| `properties` | `object` | 自定义属性存储（可用于 Mod 存储玩家数据） |

#### 实例方法

| 方法 | 说明 |
|---|---|
| `destroy()` | 销毁玩家实例，从 `client.players` 中移除并清空引用 |

---

### ClientModManager

客户端 Mod 管理器，每个客户端连接实例化一次，负责加载、实例化和管理该连接的所有客户端 Mod。

```js
const { ClientModManager } = require("../lib/mods.js");

// 静态加载所有配置的客户端 Mod
ClientModManager.load();

// 创建管理器实例（在客户端连接时调用）
const manager = new ClientModManager(client);

// 销毁管理器
manager.destroy();
```

#### 静态方法

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `load()` | - | `void` | 从 `config.js` 读取 `mods.client` 路径并 require 加载所有客户端 Mod 类 |

#### 静态属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `loadedMod` | `object` | 已加载的 Mod 类定义 `{ 名称: ModClass }` |

#### 实例属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `client` | `WebSocket` | 所属客户端连接 |
| `modInstances` | `object` | 已实例化的 Mod `{ 名称: 实例 }`，同时挂载到 `client[名称]` |
| `commands` | `object` | 按权限分类的命令列表 `{ normal: [...], user: [...], op: [...], owner: [...] }` |

#### 实例方法

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `destroy()` | - | `void` | 销毁所有 Mod 实例，调用各 Mod 的 `destroy()` 方法并清空引用 |

---

### ServerModManager

服务端 Mod 管理器，静态单例，管理全局服务端级别的 Mod（不随客户端连接创建）。

```js
const { ServerModManager } = require("../lib/mods.js");

// 静态加载所有配置的服务端 Mod（启动时自动调用）
ServerModManager.load();

// 销毁所有服务端 Mod
ServerModManager.destroy();
```

#### 静态方法

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `load()` | - | `void` | 从 `config.js` 读取 `mods.server` 路径并 require 加载，同时调用 Mod 的 `start()` 方法 |
| `destroy()` | - | `void` | 遍历所有已加载的服务端 Mod，调用各 Mod 的 `destroy()` 方法并清空 |

#### 静态属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `loadedMod` | `object` | 已加载的 Mod 类定义 `{ 名称: ModClass }` |

---

## 备注
- 该 README.md 文档与项目中部分代码注释由 **AI** 辅助生成，经人工审校后整理。
