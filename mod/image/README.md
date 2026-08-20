# Image Mod — Minecraft Bedrock 像素画生成器

将图片转换为 Minecraft Bedrock Edition 像素画，通过 WebSocket 远程控制客户端自动放置方块。

## 命令

| 命令 | 说明 |
|------|------|
| `!i:create <文件名> [方向] [X Y Z]` | 将图片转换为像素画（缩放到最大 256px） |
| `!i:raw <文件名> [方向] [X Y Z]` | 原始尺寸转换（最大 2048px，仅 x/z 方向） |
| `!i:y` | 确认开始转换 |
| `!i:n` | 取消/中断转换 |
| `!i:status` | 查看当前转换进度 |

### 方向参数

- `x`（默认）— 水平铺设，图片平放在地面上
- `y` — 垂直竖立，图片面向玩家
- `z` — 旋转 90° 水平铺设

坐标可选，不提供则使用玩家当前位置。

## 工作流程

1. **图片处理** — 读取图片，可选缩放，双线性插值采样
2. **颜色匹配** — 为每个像素找到最接近的方块（加权 RGB 距离 + HSV 回退）
3. **矩形合并** — 相邻同色方块合并为 `fill` 命令，减少指令数
4. **区域分块** — 按区块分组，每组创建 `tickingarea` 保证区块加载
5. **逐条发送** — `sendCommand` fire-and-forget，`delay(1)` 控制速率
6. **清理** — 每个区域完成后删除 `tickingarea`

## 文件结构

```
mod/image/
├── main.js           # 主模块
├── main_debug.js     # 调试版（命令前缀 id:，检查 statusCode）
├── blocks.json       # 方块调色板（48 种：混凝土、羊毛、陶瓦）
└── README.md
```

## 方块调色板 (blocks.json)

```json
{
  "blocks": [
    { "id": "minecraft:white_concrete", "rgb": [237, 237, 237] },
    { "id": "minecraft:white_wool", "rgb": [240, 240, 240] },
    { "id": "minecraft:white_terracotta", "rgb": [212, 186, 170] }
  ]
}
```

- 16 色混凝土 + 16 色羊毛 + 16 色陶瓦 = 48 种
- `id` — Bedrock Edition 方块标识符
- `rgb` — 该方块的代表 RGB 颜色值

## 颜色匹配算法

1. **量化缓存** — RGB 各量化到步长 5，缓存匹配结果，避免重复计算
2. **灰度快速路径** — 饱和度 < 0.15 时直接映射到白/浅灰/灰/黑混凝土
3. **加权 RGB 距离** — `dr²×0.299 + dg²×0.587 + db²×0.114`（NTSC 亮度权重）
4. **HSV 回退** — 若 RGB 最佳距离 > 100，用 HSV 空间重新匹配（色调权重 ×2）

## 矩形合并策略

`mergeBlocksToRects` 将相邻同色像素合并为矩形：

- 先向右扩展最大 X，再向下扩展最大 Z
- 面积 = 1 → `setblock`，面积 > 1 → `fill`
- 超过 `FILL_LIMIT`（32767）时按竖条分割，确保每条 fill 不超限

## 区域分块 (Area Chunking)

大图片会跨越多个区块，`computeAreas` 按区块分组：

- 总区块 ≤ 100 → 单区域
- 超过 → 按轴分割，每组最多 100 区块
- 每组创建临时 `tickingarea`，完成放置后删除

## 调试版 (main_debug.js)

命令前缀改为 `id:`（如 `!id:create`），与正式版共存。

差异：
- `sendCommand` → `await runCommand`，等待每条命令执行结果
- 检查 `result.body.statusCode`，非 0 时输出 `§c` 错误信息
- 完成后显示成功/失败计数

## 注意事项

- 图片路径为 `basePath.image`（配置在 `config.js`）
- 仅处理完全透明（alpha=0）的像素，半透明视为不透明
- 颜色缓存模块级共享，修改 `blocks.json` 后需重启服务
- Y 轴限制：-64 ~ 320
