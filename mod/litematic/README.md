# Litematic 建筑导入模块

Minecraft Bedrock Edition 的 Litematic 建筑投影导入工具，通过 WebSocket 桥接在游戏内执行命令。

## 功能

- 解析 `.litematic` 格式的建筑文件（NBT 格式）
- Java 版方块到 Bedrock 版方块的自动映射
- 智能矩形合并，减少指令数量
- 分区域导入，支持常加载区块
- 实时进度显示

## 命令列表

| 命令 | 权限 | 说明 |
|------|------|------|
| `!l:create <文件名> [x] [y] [z]` | op | 导入建筑投影 |
| `!l:list [页码]` | op | 查看建筑文件列表 |
| `!l:search <关键词> [页码]` | op | 搜索建筑文件 |
| `!l:y` | op | 确认导入 |
| `!l:n` | op | 取消/中断导入 |
| `!l:status` | op | 查看导入进度 |
| `!l:verify <ID> [map\|world]` | op | 检查世界差异 / 方块映射错误 |
| `!l:fix <ID> [替代方块]` | op | 修复被挖掉的方块 / 替换无法映射的方块 |
| `!l:preview <文件名> [x] [y] [z]` | op | 粒子边框 + 实体标记预览 |
| `!l:unpreview` | op | 清除建筑预览 |
| `!l:export <文件名> [导出名]` | op | 导出为 .mcstructure 结构文件 |
| `!l:help [命令名]` | op | 查看命令用法 |
| `!l:id` | op | 查看所有任务 ID |

## 工作流程

1. **解析阶段** - 读取 `.litematic` 文件，解析 NBT 数据
2. **映射阶段** - 将 Java 版方块 ID 映射为 Bedrock 版标识符
3. **合并阶段** - 将相邻同种方块合并为矩形，生成 `/fill` 指令
4. **预览阶段** - 显示建筑信息、指令数量、预计耗时
5. **确认阶段** - 用户发送 `!l:y` 确认，`!l:n` 取消
6. **导入阶段** - 分区域执行：
   - 创建常加载区块
   - 清除空气
   - 放置方块
   - 删除常加载区块

## 区域分割

建筑按区块边界（16x16）分割为多个区域，每个区域最多 100 个区块：

- X 轴方向：`Math.floor(100 / totalChunksZ)` 个区块
- Z 轴方向：若 `totalChunksZ > 100` 则沿 Z 轴分割

## 文件结构

```
mod/litematic/
├── main.js              # 主模块代码
├── main_debug.js        # 调试版（命令前缀 ld:，检查 statusCode）
├── generator_blocks.json # Java→Bedrock 方块映射表（9.2MB）
└── README.md            # 本文档
```

## 调试版 (main_debug.js)

命令前缀改为 `ld:`（如 `!ld:create`），与正式版共存。

差异：
- `sendCommand` → `await runCommand`，等待每条命令执行结果
- 检查 `result.body.statusCode`，非 0 时输出 `§c` 错误信息
- `tickingarea add/remove`、`fill air` 命令同样检查返回码
- 完成后显示成功/失败计数

## 技术细节

### NBT 解析

支持的标签类型：
- TAG_BYTE (1), TAG_SHORT (2), TAG_INT (3), TAG_LONG (4)
- TAG_FLOAT (5), TAG_DOUBLE (6), TAG_BYTE_ARRAY (7)
- TAG_STRING (8), TAG_LIST (9), TAG_COMPOUND (10)
- TAG_INT_ARRAY (11), TAG_LONG_ARRAY (12)

### 方块映射

映射表来自 GeyserMC/mappings-generator v2.0.0，包含 32366 条映射。

映射优先级：
1. 完整匹配 `名称::属性=值`
2. 仅名称匹配（无属性时）

### 常加载区块

使用 `/tickingarea add` 命令创建常加载区块，确保区块在导入过程中保持加载状态。

Bedrock 版限制：
- 区块大小：16x16 方块
- `/fill` 命令限制：32767 个方块
- Y 轴范围：-64 ~ 320

### 指令合并

将同一 Y 层的相邻同种方块合并为矩形：
- 单个方块 → `/setblock`
- 多个方块 → `/fill`

## 依赖

- Node.js ES Module
- `../../lib/command.js` - 命令系统
- `../../config.js` - 配置（basePath.litematic）
- `generator_blocks.json` - 方块映射表

## 常见问题

**Q: 导入后有漏方块？**
A: 检查常加载区块是否正常创建，可通过 `!l:status` 查看当前阶段。

**Q: 导入速度慢？**
A: 正常现象，每次命令间隔 1ms，每个区域清空空气后等待 1000ms。

**Q: Y 轴超出限制？**
A: 建筑必须在 -64 ~ 320 范围内，否则会在预览时报错。