import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

// 路径解析辅助（原配置曾提供的 resolvePath，按 cwd 解析相对路径）
const resolvePath = (p) => path.resolve(p);

// NBT 标签类型常量
const TAG_END = 0, TAG_BYTE = 1, TAG_SHORT = 2, TAG_INT = 3, TAG_LONG = 4;
const TAG_FLOAT = 5, TAG_DOUBLE = 6, TAG_BYTE_ARRAY = 7, TAG_STRING = 8;
const TAG_LIST = 9, TAG_COMPOUND = 10, TAG_INT_ARRAY = 11, TAG_LONG_ARRAY = 12;

// INT_MASKS 用于位操作
const INT_MASKS = new Uint32Array(33);
for (let i = 0; i <= 32; i++) {
	INT_MASKS[i] = i === 32 ? 0xFFFFFFFF : (1 << i) - 1;
}

// NBT 解析
function parseNbt(buf) {
	let offset = 0;

	function readString() {
		const len = buf.readUInt16BE(offset);
		offset += 2;
		const str = buf.toString("utf8", offset, offset + len);
		offset += len;
		return str;
	}

	function readTag(type) {
		switch (type) {
			case TAG_BYTE:
				offset += 1;
				return buf.readInt8(offset - 1);
			case TAG_SHORT:
				offset += 2;
				return buf.readInt16BE(offset - 2);
			case TAG_INT:
				offset += 4;
				return buf.readInt32BE(offset - 4);
			case TAG_LONG: {
				const hi = buf.readInt32BE(offset);
				const lo = buf.readUInt32BE(offset + 4);
				offset += 8;
				return hi * 4294967296 + lo;
			}
			case TAG_FLOAT:
				offset += 4;
				return buf.readFloatBE(offset - 4);
			case TAG_DOUBLE:
				offset += 8;
				return buf.readDoubleBE(offset - 8);
			case TAG_BYTE_ARRAY: {
				const len = buf.readInt32BE(offset);
				offset += 4 + len;
				return [];
			}
			case TAG_STRING:
				return readString();
			case TAG_LIST: {
				const listType = buf.readInt8(offset++);
				const len = buf.readInt32BE(offset);
				offset += 4;
				const list = [];
				for (let i = 0; i < len; i++) list.push(readTag(listType));
				return list;
			}
			case TAG_COMPOUND: {
				const comp = {};
				while (offset < buf.length) {
					const type = buf.readInt8(offset++);
					if (type === TAG_END) break;
					comp[readString()] = readTag(type);
				}
				return comp;
			}
			case TAG_INT_ARRAY: {
				const len = buf.readInt32BE(offset);
				offset += 4 + len * 4;
				return [];
			}
			case TAG_LONG_ARRAY: {
				const len = buf.readInt32BE(offset);
				const dataStart = offset + 4;
				offset += 4 + len * 8;
				return { isZeroCopyLongArray: true, buffer: buf, offset: dataStart, length: len };
			}
			default:
				throw new Error(`未知的 NBT 标签类型: ${type}`);
		}
	}

	const rootType = buf.readInt8(offset++);
	if (rootType === TAG_END) return {};
	readString();
	return readTag(rootType);
}

function decompressAndParse(fileBuffer) {
	return new Promise((resolve, reject) => {
		zlib.gunzip(fileBuffer, (err, unzipped) => {
			if (err) reject(err);
			else resolve(parseNbt(unzipped));
		});
	});
}

// 从 BlockStates 提取方块索引
function extractBlockIndices(blockStates, totalBlocks, bitsPerIndex) {
	const indices = new Uint32Array(totalBlocks);
	const len = blockStates.length;
	const words = new Uint32Array(len * 2);
	let ptr = blockStates.offset;
	const buf = blockStates.buffer;
	for (let i = 0; i < len; i++) {
		const idx = i << 1;
		words[idx + 1] = buf.readUInt32BE(ptr);
		words[idx] = buf.readUInt32BE(ptr + 4);
		ptr += 8;
	}
	let bitPos = 0;
	for (let i = 0; i < totalBlocks; i++) {
		const wordIdx = bitPos >> 5;
		const bitOffset = bitPos & 31;
		const bitsFirst = Math.min(bitsPerIndex, 32 - bitOffset);
		let value = (words[wordIdx] >>> bitOffset) & INT_MASKS[bitsFirst];
		const remaining = bitsPerIndex - bitsFirst;
		if (remaining > 0) value |= ((words[wordIdx + 1] || 0) & INT_MASKS[remaining]) << bitsFirst;
		indices[i] = value;
		bitPos += bitsPerIndex;
	}
	return indices;
}

// 加载 Java -> Bedrock 映射
function loadMappings() {
	const dir = path.dirname(fileURLToPath(import.meta.url));
	const mappingFile = path.join(dir, "generator_blocks.json");

	let raw;
	try {
		raw = fs.readFileSync(mappingFile, "utf-8");
	} catch (err) {
		throw new Error(`读取映射表失败: ${err.message}`);
	}

	const data = JSON.parse(raw);
	if (!data.mappings || !Array.isArray(data.mappings)) {
		throw new Error("映射表格式不正确");
	}

	const map = new Map();
	const fallbackMap = new Map();

	for (const entry of data.mappings) {
		const java = entry.java_state;
		if (!java || !java.Name) continue;
		const sortedProps = java.Properties
			? Object.keys(java.Properties).sort().map(k => `${k}=${java.Properties[k]}`).join(",")
			: "";
		const key = `${java.Name}::${sortedProps}`;
		const bedrock = entry.bedrock_state;
		if (!bedrock) continue;

		const identifier = bedrock.bedrock_identifier || java.Name;
		const state = { ...(bedrock.state || {}) };

		map.set(key, { identifier, state });

		if (!fallbackMap.has(java.Name)) {
			fallbackMap.set(java.Name, { identifier, state: { ...state } });
		}
	}

	const HARDCODED = {
		"minecraft:chain": { identifier: "chain", state: {} },
		"minecraft:grass": { identifier: "grass_block", state: {} }
	};
	for (const [name, info] of Object.entries(HARDCODED)) {
		if (!fallbackMap.has(name)) {
			fallbackMap.set(name, info);
		}
	}

	map.fallbackMap = fallbackMap;
	return map;
}

// 格式化 Bedrock 方块属性
function formatBlockState(state) {
	if (!state || Object.keys(state).length === 0) return "";
	const pairs = Object.entries(state)
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([k, v]) => {
			let val;
			if (k.endsWith("_bit")) {
				val = v ? "true" : "false";
			} else if (typeof v === "string") {
				val = `"${v}"`;
			} else {
				val = v;
			}
			return `"${k}"=${val}`;
		});
	return `[${pairs.join(",")}]`;
}

// 解析 Litematic 文件
// 返回 { sx, sy, sz, totalCoords, blocks, minY, maxY, unmappedBlocks, unmappedSummary }
//   blocks: [{ x, y, z, identifier, state, cmd }] 其中 cmd 为可直接执行的基岩版命令片段
//   minY/maxY: 非空气方块的实际 Y 范围（用于裁剪底部空气层）
//   unmappedBlocks/Summary: 无法映射到基岩版的方块（$verify map / $fix 检查对象）
async function parseLitematic(filePath) {
	const fileBuffer = fs.readFileSync(filePath);
	const nbt = await decompressAndParse(fileBuffer);

	const regions = nbt.Regions;
	if (!regions) throw new Error("找不到 Regions 区域");

	const rName = Object.keys(regions)[0];
	const region = regions[rName];
	const size = region.Size;

	const sx = Math.abs(size.x);
	const sy = Math.abs(size.y);
	const sz = Math.abs(size.z);
	const totalBlocks = sx * sy * sz;

	const paletteRaw = region.BlockStatePalette;
	const palette = Array.isArray(paletteRaw) ? paletteRaw : paletteRaw.value || paletteRaw;
	const blockStates = region.BlockStates;

	if (!palette || !blockStates) {
		throw new Error("无效的 Litematic 文件");
	}

	const mapping = loadMappings();

	// 预处理 palette
	const AIR_NAMES = ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"];
	const processedPalette = palette.map(node => {
		const state = node.value !== undefined ? node.value : node;
		if (!state || !state.Name) return null;

		const bName = typeof state.Name === "string" ? state.Name : state.Name.value;
		if (AIR_NAMES.includes(bName)) return null;

		const props = {};
		if (state.Properties) {
			const p = state.Properties.value || state.Properties;
			for (const k in p) {
				if (p[k] && p[k].value !== undefined) props[k] = p[k].value;
				else if (typeof p[k] === "string") props[k] = p[k];
			}
		}

		const sortedProps = Object.keys(props).sort().map(k => `${k}=${props[k]}`).join(",");
		const javaKey = `${bName}::${sortedProps}`;

		let bedrockInfo = mapping.get(javaKey);
		if (!bedrockInfo && mapping.fallbackMap) {
			bedrockInfo = mapping.fallbackMap.get(bName);
		}

		if (!bedrockInfo) return { unmapped: true, name: bName };

		return {
			identifier: bedrockInfo.identifier,
			state: bedrockInfo.state
		};
	});

	const bitsPerIndex = Math.max(2, Math.ceil(Math.log2(palette.length)));
	const indices = extractBlockIndices(blockStates, totalBlocks, bitsPerIndex);

	const blocks = [];
	const unmappedBlocks = [];
	const unmappedSummary = new Map();
	const sliceSize = sx * sz;
	let idx = 0;
	let minY = Infinity, maxY = -Infinity;

	for (let y = 0; y < sy; y++) {
		const yOffset = y * sliceSize;
		for (let z = 0; z < sz; z++) {
			const zOffset = z * sx;
			for (let x = 0; x < sx; x++) {
				const pIdx = indices[idx++];
				const cached = pIdx < processedPalette.length ? processedPalette[pIdx] : undefined;

				if (cached && cached.unmapped) {
					unmappedBlocks.push({ x, y, z, name: cached.name });
					unmappedSummary.set(cached.name, (unmappedSummary.get(cached.name) || 0) + 1);
					continue;
				}

				if (cached) {
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
					const state = cached.state || {};
					const stateStr = formatBlockState(state);
					const identifier = cached.identifier;
					const blockId = identifier.replace(/^minecraft:/, "");
					blocks.push({
						x, y, z,
						identifier,
						state,
						cmd: `${blockId}${stateStr ? " " + stateStr : ""}`
					});
				}
				// pIdx === 0 或 cached === null 表示空气
			}
		}
	}

	return {
		sx, sy, sz,
		totalCoords: totalBlocks,
		blocks,
		minY: minY === Infinity ? 0 : minY,
		maxY: maxY === -Infinity ? sy - 1 : maxY,
		unmappedBlocks,
		unmappedSummary: Object.fromEntries(unmappedSummary)
	};
}

// 裁剪底部空气层：将建筑最低的非空气方块对齐到 Y=0（对应放置点地面）
// 效果: 建筑不再悬空，且不会在清除空气阶段挖掉放置点下方地形
function trimAir(data) {
	const off = data.minY;
	data.trimmedAir = off;
	if (off > 0) {
		for (const b of data.blocks) b.y -= off;
		for (const b of data.unmappedBlocks || []) b.y -= off;
		data.sy = data.maxY - off + 1;
		data.totalCoords = data.sx * data.sy * data.sz;
	}
	return data;
}

// ---- .mcstructure 生成 (Little-endian NBT, 未压缩) ----
// .mcstructure 是基岩版结构方块文件格式，可在游戏内用结构方块预览/放置
const T_BYTE = 1, T_INT = 3, T_STRING = 8, T_LIST = 9, T_COMPOUND = 10;
const nt = (t, v) => ({ t, v });
const nByte = v => nt(T_BYTE, v);
const nInt = v => nt(T_INT, v);
const nStr = v => nt(T_STRING, v);
const nList = (elemType, v) => nt(T_LIST, { elemType, v });
const nComp = v => nt(T_COMPOUND, v);

function leString(s) {
	const b = Buffer.from(s, "utf8");
	const h = Buffer.alloc(2);
	h.writeUInt16LE(b.length);
	return Buffer.concat([h, b]);
}

function nbtPayload(n) {
	switch (n.t) {
		case T_BYTE: return Buffer.from([n.v & 0xFF]);
		case T_INT: { const b = Buffer.alloc(4); b.writeInt32LE(n.v); return b; }
		case T_STRING: return leString(n.v);
		case T_LIST: {
			const parts = [];
			for (const item of n.v.v) parts.push(nbtPayload(item));
			const head = Buffer.alloc(5);
			head[0] = n.v.elemType;
			head.writeInt32LE(n.v.v.length, 1);
			return Buffer.concat([head, ...parts]);
		}
		case T_COMPOUND: {
			const parts = [];
			for (const k in n.v) {
				const child = n.v[k];
				parts.push(Buffer.from([child.t]));
				parts.push(leString(k));
				parts.push(nbtPayload(child));
			}
			parts.push(Buffer.from([0]));
			return Buffer.concat(parts);
		}
	}
	throw new Error(`不支持的 NBT 类型: ${n.t}`);
}

function nbtRoot(name, node) {
	return Buffer.concat([Buffer.from([node.t]), leString(name), nbtPayload(node)]);
}

// 构建 .mcstructure 文件内容（block_indices 按 ZYX 顺序，z 变化最快；-1 表示留空）
function buildMcStructure(data) {
	const { sx, sy, sz } = data;
	const palette = [];
	const indexMap = new Map();
	for (const b of data.blocks) {
		if (!indexMap.has(b.cmd)) { indexMap.set(b.cmd, palette.length); palette.push(b); }
	}
	const total = sx * sy * sz;
	const base = new Int32Array(total).fill(-1);
	const overlay = new Int32Array(total).fill(-1);
	for (const b of data.blocks) {
		base[(b.x * sy + b.y) * sz + b.z] = indexMap.get(b.cmd);
	}
	const toState = v => typeof v === "boolean" ? nByte(v ? 1 : 0) : typeof v === "number" ? nInt(v) : nStr(String(v));
	const blockPalette = palette.map(p => nComp({
		name: nStr(p.identifier),
		states: nComp(Object.fromEntries(Object.entries(p.state || {}).map(([k, v]) => [k, toState(v)]))),
		version: nInt(18168865)
	}));
	const root = nComp({
		format_version: nInt(1),
		size: nList(T_INT, [nInt(sx), nInt(sy), nInt(sz)]),
		structure: nComp({
			block_indices: nList(T_LIST, [
				nList(T_INT, Array.from(base, v => nInt(v))),
				nList(T_INT, Array.from(overlay, v => nInt(v)))
			]),
			entities: nList(T_COMPOUND, []),
			palette: nComp({
				default: nComp({
					block_palette: nList(T_COMPOUND, blockPalette),
					block_position_data: nComp({})
				})
			})
		}),
		structure_world_origin: nList(T_INT, [nInt(0), nInt(0), nInt(0)])
	});
	return nbtRoot("", root);
}

// 矩形合并优化
function mergeBlocksToRects(blocks, sx, sz) {
	const layers = {};
	for (const b of blocks) {
		if (!layers[b.y]) layers[b.y] = [];
		layers[b.y].push(b);
	}

	const cmds = [];

	for (const y in layers) {
		const grid = Array.from({ length: sz }, () => Array(sx).fill(null));
		for (const b of layers[y]) grid[b.z][b.x] = b.cmd;

		const used = Array.from({ length: sz }, () => Array(sx).fill(false));

		for (let z = 0; z < sz; z++) {
			for (let x = 0; x < sx; x++) {
				if (used[z][x] || !grid[z][x]) continue;
				const cmd = grid[z][x];

				let maxX = x;
				while (maxX + 1 < sx && grid[z][maxX + 1] === cmd && !used[z][maxX + 1]) maxX++;

				let maxZ = z;
				let canExtend = true;
				while (canExtend && maxZ + 1 < sz) {
					for (let tx = x; tx <= maxX; tx++) {
						if (grid[maxZ + 1][tx] !== cmd || used[maxZ + 1][tx]) { canExtend = false; break; }
					}
					if (canExtend) maxZ++;
				}

				for (let tz = z; tz <= maxZ; tz++) {
					for (let tx = x; tx <= maxX; tx++) used[tz][tx] = true;
				}

				const area = (maxX - x + 1) * (maxZ - z + 1);
				if (area === 1) {
					cmds.push({ type: "setblock", x, y: parseInt(y), z, cmd, count: 1 });
				} else {
					cmds.push({ type: "fill", x1: x, y: parseInt(y), z1: z, x2: maxX, z2: maxZ, cmd, count: area });
				}
			}
		}
	}

	return cmds;
}

// 主类
export default class Litematic {
	// 任务存档为静态共享：连接/实例共用同一份，$create 返回的任务 ID 全局有效（$verify / $fix 使用）
	static taskSeq = 0;
	static tasks = new Map();

	constructor(client) {
		this.client = client;
		this.pending = null;
		this.job = null;
		this.page = 1;
		this.previewTimer = null;
		this.previewData = null;
		this.verifyJob = null;
		this.fixJob = null;
	}

	onCommand() {
		const c = this.client;
		return {
			op: [
				// l:help [命令名] — 列出所有命令，或查看指定命令的用法
this.Command.create("l:help", "查看命令用法")
					.addOptionalString("命令名")
					.setFunc((sender, name) => {
						const all = this.onCommand().op;
						if (name) {
							const cm = all.find(x => x.name === name);
							if (!cm) {
								this.client.tell(`§cLitematic | §fError > §i没有找到命令: ${name}（输入 !l:help 查看全部命令）`, sender);
								return;
							}
							const params = cm.parameters.length
								? cm.parameters.map((p, i) => {
									const [type, desc, opt] = p;
									return ` §f参数${i + 1}: §7<${type}> §f(${opt ? "可选" : "必选"})${desc ? ` - ${desc}` : ""}`;
								}).join("\n")
								: " §7无参数";
							this.client.tell(
								`§eLitematic | §fHelp > §b${cm.name} §7用法:\n` +
								`§f说明: §7${cm.description}\n` +
								`§f参数:\n${params}`, sender
							);
						} else {
							const lines = all.map(cm => `§a$l:${cm.name.replace(/^l:/, "")} §7- §f${cm.description}`).join("\n");
							this.client.tell(
								`§eLitematic | §fHelp > §7可用命令\n${lines}\n` +
								`§7输入 §a!l:help <命令名> §7查看详细用法`, sender
							);
						}
					}),

				// l:create <文件> [X] [Y] [Z] [trim|raw] — 导入建筑投影
this.Command.create("l:create", "导入 Litematic 建筑投影")
					.addString("文件名", false)
					.addOptionalString("X")
					.addOptionalString("Y")
					.addOptionalString("Z")
					.addOptionalString("模式")
					.setFunc(async (sender, fileName, x, y, z, mode) => {
						if (this.job) {
							this.client.tell("§cLitematic | §fError > §i已有导入进程运行中，请等待完成或 !l:n 中断", sender);
							return;
						}
						await this.create(fileName, sender, x, y, z, mode);
					}),

				// l:preview <文件> [X] [Y] [Z] [trim|raw] — 粒子+实体边框预览
this.Command.create("l:preview", "粒子边框 + 实体标记预览建筑位置")
					.addString("文件名", false)
					.addOptionalString("X")
					.addOptionalString("Y")
					.addOptionalString("Z")
					.addOptionalString("模式")
					.setFunc(async (sender, fileName, x, y, z, mode) => {
						await this.preview(fileName, sender, x, y, z, mode);
					}),

				// l:unpreview — 清除预览
this.Command.create("l:unpreview", "清除建筑预览")
					.setFunc((sender) => {
						this.clearPreview(sender);
					}),

				// l:export <文件> [导出名] [trim|raw] — 导出 .mcstructure 结构文件
this.Command.create("l:export", "导出为 MCBE 结构方块文件 (.mcstructure)")
					.addString("文件名", false)
					.addOptionalString("导出名")
					.addOptionalString("模式")
					.setFunc(async (sender, fileName, exportName, mode) => {
						await this.exportStructure(fileName, sender, exportName, mode);
					}),

				// l:list [页码] — 浏览建筑文件
this.Command.create("l:list", "查看建筑文件列表")
					.addOptionalString("页码")
					.setFunc((sender, page) => {
						this.listFiles(page, sender);
					}),

				// l:id — 查看所有任务 ID（$create 返回，供 $verify / $fix 使用）
this.Command.create("l:id", "查看所有任务 ID")
					.setFunc((sender) => {
						this.listTasks(sender);
					}),

				// l:search <关键词> [页码] — 搜索建筑文件
this.Command.create("l:search", "搜索建筑文件")
					.addString("关键词", false)
					.addOptionalString("页码")
					.setFunc((sender, keyword, page) => {
						this.searchFiles(keyword, page, sender);
					}),

				// l:y — 确认待执行的导入
this.Command.create("l:y", "确认导入操作")
					.setFunc(async (sender) => {
						if (!this.pending) {
							this.client.tell("§cLitematic | §fError > §i没有待确认的导入任务", sender);
							return;
						}
						this.client.tell("§eLitematic | §fImport > §i已确认，开始导入…", sender);
						try {
							await this.run();
						} catch (e) {
							this.client.tell(`§cLitematic | §fError > §i导入出错: ${e.message}`, sender);
							this.job = null;
						}
					}),

				// l:n — 取消待确认任务或中断正在进行的导入/检查/修复
this.Command.create("l:n", "取消/中断操作")
					.setFunc((sender) => {
						if (this.job) {
							this.job.cancelled = true;
							this.client.tell("§cLitematic | §fCancel > §i正在中断导入…", sender);
						} else if (this.verifyJob) {
							this.verifyJob.cancelled = true;
							this.client.tell("§cLitematic | §fCancel > §i正在中断世界检查…", sender);
						} else if (this.fixJob) {
							this.fixJob.cancelled = true;
							this.client.tell("§cLitematic | §fCancel > §i正在中断修复…", sender);
						} else if (this.pending) {
							this.pending = null;
							this.client.tell("§cLitematic | §fCancel > §i已取消导入", sender);
						} else {
							this.client.tell("§cLitematic | §fError > §i没有进行中的操作", sender);
						}
					}),

				// l:author — 作者信息
this.Command.create("l:author", "查看作者信息")
					.setFunc((sender) => {
						this.client.tell("§eLitematic | §fAuthor > §iStarAwA117 & Hydrooxygen", sender);
					}),

				// l:status — 查看所有进行中任务进度（导入 / 世界检查 / 修复）
this.Command.create("l:status", "查看导入/检查/修复进度")
					.setFunc((sender) => {
						const lines = [];
						if (this.job) {
							const j = this.job;
							const elapsed = ((Date.now() - j.startTime) / 1000).toFixed(1);
							const cmdSpeed = j.phasePlaced > 0 ? Math.round(j.phasePlaced / parseFloat(elapsed)) : 0;
							const totalPct = j.total > 0 ? (j.phasePlaced / j.total * 100).toFixed(1) : "0.0";
							const phasePct = j.phaseTotal > 0 ? (j.phasePlaced / j.phaseTotal * 100).toFixed(1) : "0.0";
							lines.push(
								`§eLitematic | §fStatus > §i导入 §f${j.fileName}\n` +
								`§f总进度 ${totalPct}% | 预计 ${cmdSpeed > 0 ? ((j.total - j.phasePlaced) / cmdSpeed).toFixed(1) : "?"}s\n` +
								`§f阶段: ${j.phase} (${j.areaIndex}/${j.areaTotal} 区域)\n` +
								`§f进度: ${phasePct}% | ${j.phasePlaced} / ${j.phaseTotal} 命令 | 方块 ${j.phaseBlocksPlaced} / ${j.phaseBlockTotal}\n` +
								`§f速度: ${cmdSpeed} 命令/s | ${elapsed}s`
							);
						}
						if (this.verifyJob) {
							const v = this.verifyJob;
							const elapsed = ((Date.now() - v.startTime) / 1000).toFixed(1);
							lines.push(
								`§eLitematic | §fStatus > §i世界检查 §f(任务 #${v.taskId}: ${v.fileName})\n` +
								`§f进度: ${v.total > 0 ? (v.checked / v.total * 100).toFixed(1) : "0.0"}% | ${v.checked} / ${v.total} 方块 | 不匹配: ${v.mismatches} | ${elapsed}s`
							);
						}
						if (this.fixJob) {
							const f = this.fixJob;
							const elapsed = ((Date.now() - f.startTime) / 1000).toFixed(1);
							lines.push(
								`§eLitematic | §fStatus > §i修复 §f(任务 #${f.taskId}: ${f.fileName})\n` +
								`§f进度: ${f.done} / ${f.total} 方块 | ${elapsed}s`
							);
						}
						if (!lines.length) {
							this.client.tell("§cLitematic | §fError > §i当前没有进行中的任务", sender);
							return;
						}
						this.client.tellAll(lines.join("\n\n"));
					}),

				// l:verify <ID> [map|world] — 默认检查游戏世界一致性；map 检查方块映射错误
this.Command.create("l:verify", "检查投影与世界的差异 / 方块映射错误")
					.addString("ID", false)
					.addOptionalString("模式")
					.setFunc(async (sender, id, mode) => {
						const tid = Number(id);
						if (!Litematic.tasks.has(tid)) {
							this.client.tell("§cLitematic | §fError > §i没有找到任务 ID，请先 !l:create 获取任务 ID", sender);
							return;
						}
						if (mode === "map") return this.verify(tid, sender);
						if (mode !== undefined && mode !== "world") {
							this.client.tell("§cLitematic | §fError > §i模式参数无效：应为 map（检查方块映射）或留空（检查世界一致性）", sender);
							return;
						}
						this.verifyWorld(tid, sender);
					}),

				// l:fix <ID> [替代方块] — 修复错误方块
this.Command.create("l:fix", "修复被挖掉的方块 / 替换无法映射的方块")
					.addString("ID", false)
					.addOptionalString("替代方块")
					.setFunc((sender, id, fb) => {
						const tid = Number(id);
						if (!Litematic.tasks.has(tid)) {
							this.client.tell("§cLitematic | §fError > §i没有找到任务 ID，请先 !l:create 获取任务 ID", sender);
							return;
						}
						if (this.fixJob) {
							this.client.tell("§cLitematic | §fError > §i已有修复任务进行中，请等待完成或 !l:n 中断", sender);
							return;
						}
						this.fix(tid, sender, fb);
					})
			]
		};
	}

	// 分页显示文件列表（每页 5 个，附带文件大小）
	pageList(sender, files, header) {
		const dir = this.config.basePath;
		if (!fs.existsSync(dir)) {
			this.client.tell("§cLitematic | §fError > §i建筑目录不存在", sender);
			return;
		}
		if (!files.length) {
			this.client.tell("§cLitematic | §fError > §i没有找到 .litematic 文件", sender);
			return;
		}

		const pageSize = 5;
		const totalPages = Math.ceil(files.length / pageSize);
		const page = this.page || 1;
		const pn = Math.max(1, Math.min(page, totalPages));
		this.page = pn;

		const startIndex = (pn - 1) * pageSize;
		const pageFiles = files.slice(startIndex, startIndex + pageSize);

		const items = pageFiles.map((f, i) => {
			const name = f.replace(/\.litematic$/i, "");
			const num = String(startIndex + i + 1).padStart(2, " ");
			const filePath = path.join(dir, f);
			const stats = fs.statSync(filePath);
			const size = this.formatSize(stats.size);
			return `${num}. ${name} §f${size}`;
		}).join("\n");

		this.client.tell(`${header} §f(${pn}/${totalPages}页) §i共 ${files.length} 个\n${items}`, sender);
	}

	listFiles(page, sender) {
		this.page = page !== undefined ? parseInt(page) || 1 : 1;
		const dir = this.config.basePath;
		const files = fs.existsSync(dir)
			? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".litematic")).sort()
			: [];
		this.pageList(sender, files, "§eLitematic | §fList");
	}

	searchFiles(keyword, page, sender) {
		this.page = page !== undefined ? parseInt(page) || 1 : 1;
		const dir = this.config.basePath;
		const files = fs.existsSync(dir)
			? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".litematic") && f.toLowerCase().includes(keyword.toLowerCase())).sort()
			: [];
		this.pageList(sender, files, `§eLitematic | §fSearch > §i"${keyword}"`);
	}

	// l:id — 列出所有任务（项目）的 ID，新任务在前
	listTasks(sender) {
		const tasks = [...Litematic.tasks.entries()].sort((a, b) => b[0] - a[0]);
		if (!tasks.length) {
			this.client.tell("§cLitematic | §fError > §i当前没有任务，先 !l:create 创建", sender);
			return;
		}
		const now = Date.now();
		const lines = tasks.map(([id, t]) => {
			const blocks = t.data?.blocks?.length ?? 0;
			const age = now - t.time;
			const ago = age < 60000 ? "刚刚" : age < 3600000 ? `${Math.floor(age / 60000)}分钟前` : age < 86400000 ? `${Math.floor(age / 3600000)}小时前` : `${Math.floor(age / 86400000)}天前`;
			const tags = [];
			if ((t.mismatches || []).length) tags.push(`§c差异 §e${t.mismatches.length}§c 个`);
			if ((t.data?.unmappedBlocks || []).length) tags.push(`§e未映射 ${t.data.unmappedBlocks.length} 个`);
			return `§b${String(id).padStart(3, " ")}. §f${t.file} §7| §f${blocks}§7 方块 §7| §7${ago}${tags.length ? " §7| " + tags.join(" ") : ""}`;
		}).join("\n");
		this.client.tell(
			`§eLitematic | §fID > §i任务列表 (${tasks.length} 个)\n${lines}\n` +
			`§7使用 §a!l:verify <ID>§7 检查世界差异 / §a!l:fix <ID>§7 修复`, sender
		);
	}

	formatSize(bytes) {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}

	// 解析放置参数：支持 $cmd file raw / $cmd file x y z / $cmd file x y z raw
	parsePlacement(x, y, z, mode) {
		let raw = false;
		if (mode === "raw") raw = true;
		else if (mode === "trim") raw = false;
		else if (mode !== undefined) return { raw: null, coords: [] };
		if (mode === undefined && x === "raw") { raw = true; x = undefined; }
		const coords = [x, y, z].filter(v => v !== undefined && v !== null);
		return { raw, coords };
	}

	async create(fileName, sender, x, y, z, mode) {
		const { raw, coords } = this.parsePlacement(x, y, z, mode);
		if (raw === null) {
			this.client.tell("§cLitematic | §fError > §i模式参数无效：应为 raw（保留原始高度）或 trim（裁剪底部空气，默认）", sender);
			return;
		}
		if (coords.length > 0 && coords.length < 3) {
			this.client.tell("§cLitematic | §fError > §i坐标参数不完整，需要同时提供 X Y Z 或都不提供（使用自身坐标）", sender);
			return;
		}

		// 路径穿越防护：只允许单层合法文件名
		if (typeof fileName !== "string" || !fileName ||
			fileName !== path.basename(fileName) || /[\\/]/.test(fileName) || fileName.startsWith(".")) {
			this.client.tell(`§cLitematic | §fError > §i非法的文件名: ${fileName}`, sender);
			return;
		}

		const filePath = path.join(this.config.basePath, fileName.endsWith(".litematic") ? fileName : fileName + ".litematic");
		if (!fs.existsSync(filePath)) {
			this.client.tell(`§cLitematic | §fError > §i文件不存在: ${fileName}`, sender);
			return;
		}

		this.client.tell("§i正在解析 Litematic 文件…", sender);

		let data;
		try {
			data = await parseLitematic(filePath);
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i解析失败: ${e.message}`, sender);
			return;
		}
		if (!raw) trimAir(data);

		let origin;
		if (coords.length === 3) {
			origin = { x: Math.floor(Number(coords[0])), y: Math.floor(Number(coords[1])), z: Math.floor(Number(coords[2])) };
		} else {
			try {
				const pos = await this.client.getPosition("@s");
				if (!pos) {
					this.client.tell("§cLitematic | §fError > §i无法获取你的坐标", sender);
					return;
				}
				// 玩家脚底的 Y 是其脚下方块的上表面，减 1 使建筑底部对齐到脚下那层方块
				origin = { x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) };
			} catch {
				this.client.tell("§cLitematic | §fError > §i无法获取你的坐标", sender);
				return;
			}
		}

		if (origin.y < -64 || origin.y + data.sy - 1 > 320) {
			this.client.tell(`§cLitematic | §fError > §iY 轴超出限制: ${origin.y} ~ ${origin.y + data.sy - 1} (允许 -64 ~ 320)`, sender);
			return;
		}

		this.pending = { data, origin, file: fileName, raw };

		// 分配唯一任务 ID 并存档，供 $verify / $fix 使用
		const taskId = ++Litematic.taskSeq;
		Litematic.tasks.set(taskId, { data, file: fileName, origin, raw, time: Date.now() });
		this.pending.taskId = taskId;
		if (this.job && this.job.taskId === undefined) this.job.taskId = taskId;

		const minX = origin.x;
		const minY = origin.y;
		const minZ = origin.z;
		const maxX = minX + data.sx - 1;
		const maxY = minY + data.sy - 1;
		const maxZ = minZ + data.sz - 1;
		const blockCount = data.blocks.length;
		const cmdCount = mergeBlocksToRects(data.blocks, data.sx, data.sz).length;

		const startChunkX = Math.floor(minX / 16);
		const startChunkZ = Math.floor(minZ / 16);
		const endChunkX = Math.floor(maxX / 16);
		const endChunkZ = Math.floor(maxZ / 16);
		const totalChunksX = endChunkX - startChunkX + 1;
		const totalChunksZ = endChunkZ - startChunkZ + 1;
		const totalChunks = totalChunksX * totalChunksZ;

		const MAX_CHUNKS = 100;
		let areaCount;
		if (totalChunks <= MAX_CHUNKS) {
			areaCount = 1;
		} else if (totalChunksZ > MAX_CHUNKS) {
			areaCount = Math.ceil(totalChunksZ / MAX_CHUNKS) * totalChunksX;
		} else {
			areaCount = Math.ceil(totalChunksX / Math.floor(MAX_CHUNKS / totalChunksZ));
		}

		const unmappedCount = (data.unmappedBlocks || []).length;
		const estTime = ((areaCount + cmdCount) * 0.001 + 1).toFixed(1);

		this.client.tellAll(
			`§eLitematic | §fImport > §i${fileName}\n` +
			`§f任务ID: §b${taskId} §7(用于 !l:verify / !l:fix)\n` +
			`§f尺寸: ${data.sx} × ${data.sy} × ${data.sz} = ${data.totalCoords} 坐标\n` +
			`§f方块: ${blockCount} → ${cmdCount} 条指令\n` +
			`§f底部空气: ${data.trimmedAir} 层 §7(${raw ? "raw: 保留高度偏移" : "trim: 已裁剪对齐地面"})\n` +
			`§f区块: ${totalChunks} 个 (${totalChunksX}×${totalChunksZ}) → ${areaCount} 个区域\n` +
			`§f范围: (${minX}, ${minY}, ${minZ}) → (${maxX}, ${maxY}, ${maxZ})\n` +
			`§f预计耗时: ${estTime}s`
		);
		if (unmappedCount) {
			this.client.tellAll(`§cLitematic | §fWarn > §i无法映射方块: ${unmappedCount} 个 （可用 !l:verify ${taskId} map 检查，!l:fix ${taskId} 修复）`);
		}
		this.client.tellAll(`§f确认请发送 §e!l:y，取消请发送 §c!l:n`);
	}

	async run() {
		const task = this.pending;
		this.pending = null;

		const { data, origin, file, taskId } = task;
		const blocks = data.blocks;
		const total = blocks.length;
		const sx = data.sx, sy = data.sy, sz = data.sz;

		const rects = mergeBlocksToRects(blocks, sx, sz);
		const totalCmds = rects.length;

		this.job = {
			fileName: file,
			taskId,
			total: totalCmds,
			cancelled: false,
			startTime: Date.now(),
			blockTotal: total,
			phase: "准备",
			areaIndex: 0,
			areaTotal: 0,
			phasePlaced: 0,
			phaseTotal: 0,
			phaseBlocksPlaced: 0,
			phaseBlockTotal: 0
		};

		const MAX_CHUNKS = 100;
		const FILL_LIMIT = 32767;
		const delay = (ms) => new Promise(r => setTimeout(r, ms));

		const startChunkX = Math.floor(origin.x / 16);
		const startChunkZ = Math.floor(origin.z / 16);
		const endChunkX = Math.floor((origin.x + sx - 1) / 16);
		const endChunkZ = Math.floor((origin.z + sz - 1) / 16);

		const totalChunksX = endChunkX - startChunkX + 1;
		const totalChunksZ = endChunkZ - startChunkZ + 1;

		const areas = [];
		if (totalChunksX * totalChunksZ <= MAX_CHUNKS) {
			areas.push({
				cx1: startChunkX, cz1: startChunkZ,
				cx2: endChunkX, cz2: endChunkZ
			});
		} else if (totalChunksZ > MAX_CHUNKS) {
			const maxChunksZ = MAX_CHUNKS;
			for (let cz = startChunkZ; cz <= endChunkZ; cz += maxChunksZ) {
				const cz2 = Math.min(cz + maxChunksZ - 1, endChunkZ);
				areas.push({
					cx1: startChunkX, cz1: cz,
					cx2: endChunkX, cz2
				});
			}
		} else {
			const maxChunksX = Math.floor(MAX_CHUNKS / totalChunksZ);
			for (let cx = startChunkX; cx <= endChunkX; cx += maxChunksX) {
				const cx2 = Math.min(cx + maxChunksX - 1, endChunkX);
				areas.push({
					cx1: cx, cz1: startChunkZ,
					cx2, cz2: endChunkZ
				});
			}
		}

		for (let i = 0; i < areas.length; i++) {
			if (this.job.cancelled) break;

			const { cx1, cz1, cx2, cz2 } = areas[i];
			const absX1 = cx1 * 16;
			const absZ1 = cz1 * 16;
			const absX2 = (cx2 + 1) * 16 - 1;
			const absZ2 = (cz2 + 1) * 16 - 1;

			this.job.areaIndex = i + 1;
			this.job.areaTotal = areas.length;

			this.job.phase = "创建常加载区块";
			this.job.phasePlaced = 0;
			this.job.phaseTotal = 1;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = 0;
			try {
				await this.client.runCommand(`/tickingarea add ${absX1} ${origin.y} ${absZ1} ${absX2} ${origin.y + sy - 1} ${absZ2} litematic_${i}`);
			} catch (e) {
				this.client.tellAll(`§cLitematic | §fError > §i[tickingarea add] ${e.message}`);
			}
			const fillX1 = Math.max(absX1, origin.x);
			const fillZ1 = Math.max(absZ1, origin.z);
			const fillX2 = Math.min(absX2, origin.x + sx - 1);
			const fillZ2 = Math.min(absZ2, origin.z + sz - 1);

			const areaPerY = (fillX2 - fillX1 + 1) * (fillZ2 - fillZ1 + 1);
			const maxYLayersPerChunk = Math.floor(FILL_LIMIT / areaPerY);

			this.job.phase = "清除空气";
			const yLayers = maxYLayersPerChunk >= sy ? 1 : Math.ceil(sy / maxYLayersPerChunk);
			this.job.phaseTotal = yLayers;
			this.job.phasePlaced = 0;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = 0;

			if (maxYLayersPerChunk >= sy) {
				this.client.sendCommand(`/fill ${fillX1} ${origin.y} ${fillZ1} ${fillX2} ${origin.y + sy - 1} ${fillZ2} air`);
				this.job.phasePlaced = 1;
			} else {
				for (let yStart = 0; yStart < sy; yStart += maxYLayersPerChunk) {
					if (this.job.cancelled) break;
					const yEnd = Math.min(yStart + maxYLayersPerChunk - 1, sy - 1);
					const absY1 = origin.y + yStart;
					const absY2 = origin.y + yEnd;
					this.client.sendCommand(`/fill ${fillX1} ${absY1} ${fillZ1} ${fillX2} ${absY2} ${fillZ2} air`);
					this.job.phasePlaced++;
					await delay(1);
				}
			}
			await delay(1000);

			const chunkRects = [];
			for (const r of rects) {
				const rx1 = r.type === "setblock" ? r.x : r.x1;
				const rx2 = r.type === "setblock" ? r.x : r.x2;
				const rz1 = r.type === "setblock" ? r.z : r.z1;
				const rz2 = r.type === "setblock" ? r.z : r.z2;
				const absRx1 = origin.x + rx1;
				const absRx2 = origin.x + rx2;
				const absRz1 = origin.z + rz1;
				const absRz2 = origin.z + rz2;
				const absRy = origin.y + r.y;

				if (r.type === "setblock") {
					if (absRx1 >= fillX1 && absRx1 <= fillX2 && absRz1 >= fillZ1 && absRz1 <= fillZ2) {
						chunkRects.push({ r, cx1: absRx1, cy1: absRy, cz1: absRz1, cx2: absRx1, cy2: absRy, cz2: absRz1 });
					}
				} else {
					if (absRx2 >= fillX1 && absRx1 <= fillX2 && absRz2 >= fillZ1 && absRz1 <= fillZ2) {
						const cx1 = Math.max(absRx1, fillX1);
						const cz1 = Math.max(absRz1, fillZ1);
						const cx2 = Math.min(absRx2, fillX2);
						const cz2 = Math.min(absRz2, fillZ2);
						const clippedCount = (cx2 - cx1 + 1) * (cz2 - cz1 + 1);
						chunkRects.push({ r, cx1, cy1: absRy, cz1, cx2, cy2: absRy, cz2, clippedCount });
					}
				}
			}

			this.job.phase = "放置方块";
			this.job.phaseTotal = chunkRects.length;
			this.job.phasePlaced = 0;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = chunkRects.reduce((sum, cr) => sum + (cr.clippedCount || 1), 0);

			for (const cr of chunkRects) {
				if (this.job.cancelled) break;

				const { r, cx1, cy1, cz1, cx2, cy2, cz2 } = cr;

				if (r.type === "setblock") {
					this.client.sendCommand(`/setblock ${cx1} ${cy1} ${cz1} ${r.cmd}`);
				} else {
					this.client.sendCommand(`/fill ${cx1} ${cy1} ${cz1} ${cx2} ${cy2} ${cz2} ${r.cmd}`);
				}

				this.job.phasePlaced++;
				this.job.phaseBlocksPlaced += cr.clippedCount || 1;

				await delay(1);
			}

			await delay(1000);
			this.job.phase = "删除常加载区块";
			this.job.phasePlaced = 0;
			this.job.phaseTotal = 1;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = 0;
			try {
				await this.client.runCommand(`/tickingarea remove litematic_${i}`);
			} catch (e) {
				// ignore
			}
		}

		if (!this.job.cancelled) {
			const elapsed = ((Date.now() - this.job.startTime) / 1000).toFixed(1);
			const speed = Math.round(total / parseFloat(elapsed));
			this.client.tellAll(`§eLitematic | §fImport > §i${file} 导入完成 共 ${total} 方块 ${totalCmds} 指令 耗时 ${elapsed}s 速度 ${speed}方块/s`);
		} else {
			this.client.tellAll(`§cLitematic | §fCancel > §i导入已中断 (${file})`);
		}
		this.job = null;
	}

	// l:verify <ID> map: 检查任务投影中方块映射错误（无法映射到基岩版的方块，导入时会被跳过）
	verify(id, sender) {
		const task = Litematic.tasks.get(id);
		const data = task.data;
		const unmapped = data.unmappedBlocks || [];
		if (!unmapped.length) {
			this.client.tell(
				`§aLitematic | §fVerify > §i任务 #${id} (${task.file}) 方块映射检查通过，无 mod 方块错误\n` +
				`§f提示: 要检查游戏世界里方块是否被挖掉/替换，请用 !l:verify ${id}`, sender
			);
			return;
		}
		const lines = Object.entries(data.unmappedSummary || {})
			.map(([name, cnt]) => `§f${name} §7× §e${cnt}`).join("\n");
		this.client.tell(
			`§eLitematic | §fVerify > §i方块检查报告 (任务 #${id})\n` +
			`§f文件: ${task.file}\n` +
			`§c无法映射方块: ${unmapped.length} 个 （导入时会被跳过）\n` +
			`${lines}\n` +
			`§7发送 !l:fix ${id} §7将用 stone 替换（可指定替代方块）`, sender
		);
	}

	// l:verify <ID> world: 检查游戏世界里投影区域与投影数据的差异
	// 对投影的每个非空气方块执行 testforblock 逐块比对，不匹配（被挖掉/替换）即记录
	async verifyWorld(id, sender) {
		const c = this.client;
		const task = Litematic.tasks.get(id);
		const data = task.data;
		const { origin } = task;
		const blocks = data.blocks;
		if (!blocks.length) {
			this.client.tell(`§aLitematic | §fVerify > §i任务 #${id} 没有可检查的方块`, sender);
			return;
		}
		const t0 = Date.now();
		const est = Math.ceil(blocks.length / 8);
		this.client.tell(`§i开始世界检查… ${blocks.length} 个方块 （预计 ${est}s 左右，!l:n 可中断）`, sender);
		const CONC = 4;
		const mismatches = [];
		let checked = 0;
		const delay = ms => new Promise(r => setTimeout(r, ms));
		this.verifyJob = { cancelled: false, taskId: id, fileName: task.file, total: blocks.length, checked: 0, mismatches: 0, startTime: Date.now() };
		try {
			const checkOne = async b => {
				const ax = origin.x + b.x, ay = origin.y + b.y, az = origin.z + b.z;
				const cmd = `testforblock ${ax} ${ay} ${az} ${b.cmd || b.identifier}`;
				let matched = false;
				// testforblock 命令可能被服务器限流丢弃（无响应），超时重试最多 3 次，避免误报差异
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						const d = await c.runCommand(cmd, 3000);
						if (d?.body?.statusCode === 0) matched = true;
						break;
					} catch {
						if (attempt < 2) await delay(300);
					}
				}
				if (!matched) {
					mismatches.push({ x: ax, y: ay, z: az, expect: b.identifier, cmd: b.cmd || b.identifier });
					this.verifyJob.mismatches = mismatches.length;
				}
				checked++;
				this.verifyJob.checked = checked;
			};
			for (let i = 0; i < blocks.length && !this.verifyJob.cancelled; i += CONC) {
				await Promise.all(blocks.slice(i, i + CONC).map(checkOne));
				if (checked >= 500 && checked % 500 === 0) {
					this.client.tellAll(`§7Litematic | §fVerify >  §i世界检查进度: ${checked}/${blocks.length} | 不匹配: ${mismatches.length} 个`);
				}
				await delay(1);
			}
		} finally {
			this.verifyJob = null;
		}
		if (checked === 0) {
			this.client.tell("§cLitematic | §fVerify > §i世界检查已中断", sender);
			return;
		}
		const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
		// 差异列表存档到任务，供 $fix 修复（重新放置期望方块）
		task.mismatches = mismatches;
		if (!mismatches.length) {
			this.client.tell(`§aLitematic | §fVerify > §i世界检查完成 (任务 #${id}) 已逐块 testforblock 比对 ${checked} 个方块，全部与投影一致 耗时 ${elapsed}s`, sender);
			return;
		}
		const list = mismatches.slice(0, 20).map(m => {
			const sp = m.cmd && m.cmd.includes("[") ? m.cmd.slice(m.cmd.indexOf("[")) : "";
			return `§7(${m.x},${m.y},${m.z}) §f期望 §e${m.expect.replace(/^minecraft:/, "")}§f${sp}`;
		}).join("\n");
		this.client.tell(
			`§eLitematic | §fVerify > §i世界检查报告 (任务 #${id})\n` +
			`§f文件: ${task.file}\n` +
			`§f检查: ${checked} 个方块 | 不匹配: ${mismatches.length} 个 耗时 ${elapsed}s\n` +
			`${list}${mismatches.length > 20 ? `\n§7…共 ${mismatches.length} 处差异` : ""}\n` +
			`§7差异可能是方块被挖掉或替换（本检查不检测额外新增的方块）\n` +
			`§7发送 !l:fix ${id} §7可重新放置这些方块，恢复与投影一致`, sender
		);
	}

	// l:fix <ID> [替代方块]: ① 重新放置 verify 发现的被挖掉/替换的方块 ② 替换无法映射的方块
	async fix(id, sender, fb) {
		const c = this.client;
		const task = Litematic.tasks.get(id);
		const data = task.data;
		const delay = ms => new Promise(r => setTimeout(r, ms));
		let n1 = 0, n2 = 0;
		const fixed = [];
		const failed = [];
		// ① 修复世界检查发现的差异（重新放置期望方块）
		const mismatches = task.mismatches || [];
		if (mismatches.length) {
			n1 = mismatches.length;
			const CONC = 4;
			this.fixJob = { cancelled: false, taskId: id, fileName: task.file, total: mismatches.length, done: 0, startTime: Date.now() };
			try {
				const placeOne = async m => {
					const idn = m.expect.replace(/^minecraft:/, "");
					const cmd = `/setblock ${m.x} ${m.y} ${m.z} ${m.cmd || idn}`;
					for (let attempt = 0; attempt < 3; attempt++) {
						try {
							const d = await c.runCommand(cmd, 3000);
							if (d?.body?.statusCode === 0) {
								fixed.push(`§7(${m.x},${m.y},${m.z}) §f→ §e${idn}`);
								this.fixJob.done++;
								return;
							}
						} catch {}
						await delay(300);
					}
					failed.push(m);
					this.fixJob.done++;
				};
				for (let i = 0; i < mismatches.length && !this.fixJob.cancelled; i += CONC) {
					await Promise.all(mismatches.slice(i, i + CONC).map(placeOne));
				}
				// 中断时未处理的差异保留，供再次 $fix 继续
				for (let i = this.fixJob.done; i < mismatches.length; i++) failed.push(mismatches[i]);
			} finally {
				this.fixJob = null;
			}
			task.mismatches = failed;
		}
		// ② 修复无法映射的方块（更新任务数据，供 $y 导入）
		const unmapped = data.unmappedBlocks || [];
		if (unmapped.length) {
			n2 = unmapped.length;
			const bid = fb || "minecraft:stone";
			const idn = bid.replace(/^minecraft:/, "");
			for (const u of unmapped) {
				data.blocks.push({ x: u.x, y: u.y, z: u.z, identifier: bid, state: {}, cmd: idn });
			}
			data.unmappedBlocks = [];
			data.unmappedSummary = {};
		}
		if (!n1 && !n2) {
			this.client.tell(`§aLitematic | §fFix > §i任务 #${id} 没有需要修复的方块`, sender);
			return;
		}
		const lines = [];
		if (n1) {
			lines.push(`§a已重新放置 ${fixed.length} / ${n1} 个方块 （恢复与投影一致）`);
			if (failed.length) lines.push(`§c未成功 ${failed.length} 个 （命令被服务器限流，可再次 !l:verify ${id} 检查并 !l:fix ${id} 重试）`);
		}
		if (n2) lines.push(`§a已将 ${n2} 个无法映射方块替换为 ${fb || "minecraft:stone"}，任务存档已更新，直接发送 !l:y 即可用修复后的数据导入`);
		if (fixed.length) lines.push(fixed.slice(0, 20).join("\n"));
		this.client.tell(`§aLitematic | §fFix > §i已修复 (任务 #${id})\n${lines.join("\n")}`, sender);
	}

	// ---- 预览 ----
	async preview(fileName, sender, x, y, z, mode) {
		const { raw, coords } = this.parsePlacement(x, y, z, mode);
		if (raw === null) {
			this.client.tell("§cLitematic | §fError > §i模式参数无效：应为 raw（保留原始高度）或 trim（裁剪底部空气，默认）", sender);
			return;
		}
		if (coords.length > 0 && coords.length < 3) {
			this.client.tell("§cLitematic | §fError > §i坐标参数不完整，需要同时提供 X Y Z 或都不提供（使用自身坐标）", sender);
			return;
		}
		const filePath = path.join(this.config.basePath, fileName.endsWith(".litematic") ? fileName : fileName + ".litematic");
		if (!fs.existsSync(filePath)) {
			this.client.tell(`§cLitematic | §fError > §i文件不存在: ${fileName}`, sender);
			return;
		}
		this.client.tell("§i正在解析 Litematic 文件…", sender);
		let data;
		try {
			data = await parseLitematic(filePath);
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i解析失败: ${e.message}`, sender);
			return;
		}
		if (!raw) trimAir(data);
		let origin;
		if (coords.length === 3) {
			origin = { x: Math.floor(Number(coords[0])), y: Math.floor(Number(coords[1])), z: Math.floor(Number(coords[2])) };
		} else {
			try {
				const pos = await this.client.getPosition("@s");
				if (!pos) {
					this.client.tell("§cLitematic | §fError > §i无法获取你的坐标", sender);
					return;
				}
				origin = { x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) };
			} catch {
				this.client.tell("§cLitematic | §fError > §i无法获取你的坐标", sender);
				return;
			}
		}
		if (origin.y < -64 || origin.y + data.sy - 1 > 320) {
			this.client.tell(`§cLitematic | §fError > §iY 轴超出限制: ${origin.y} ~ ${origin.y + data.sy - 1} (允许 -64 ~ 320)`, sender);
			return;
		}
		this.clearPreview();
		this.previewData = { origin, data, file: fileName };
		this.spawnPreviewEntities();
		this.spawnPreviewParticles();
		this.previewTimer = setInterval(() => this.spawnPreviewParticles(), 1500);
		this.client.tell(
			`§eLitematic | §fPreview > §i已生成预览: ${fileName} 尺寸 ${data.sx}×${data.sy}×${data.sz}\n` +
			`§f范围: (${origin.x}, ${origin.y}, ${origin.z}) → (${origin.x + data.sx - 1}, ${origin.y + data.sy - 1}, ${origin.z + data.sz - 1})\n` +
			`§f底部空气: ${data.trimmedAir} 层 §7(${raw ? "保留原始高度" : "已裁剪，建筑底部对齐放置点"})\n` +
			`§f§o实体标记持续显示，输入 !l:unpreview 清除`, sender
		);
	}

	clearPreview(sender) {
		if (this.previewTimer) { clearInterval(this.previewTimer); this.previewTimer = null; }
		this.previewData = null;
		this.client.sendCommand(`/kill @e[name="§a[LIT]▪"]`);
		this.client.sendCommand(`/kill @e[name="§e[LIT]✦"]`);
		this.client.sendCommand(`/kill @e[name="§b[LIT]INFO"]`);
		if (sender) this.client.tell("§7Litematic | §fPreview > §i已清除建筑预览", sender);
	}

	// 12 条边框边（角点对）
	static previewEdges(x1, y1, z1, x2, y2, z2) {
		return [
			[[x1, y1, z1], [x2, y1, z1]], [[x1, y1, z2], [x2, y1, z2]],
			[[x1, y2, z1], [x2, y2, z1]], [[x1, y2, z2], [x2, y2, z2]],
			[[x1, y1, z1], [x1, y2, z1]], [[x2, y1, z1], [x2, y2, z1]],
			[[x1, y1, z2], [x1, y2, z2]], [[x2, y1, z2], [x2, y2, z2]],
			[[x1, y1, z1], [x1, y1, z2]], [[x2, y1, z1], [x2, y1, z2]],
			[[x1, y2, z1], [x1, y2, z2]], [[x2, y2, z1], [x2, y2, z2]]
		];
	}

	spawnPreviewEntities() {
		const { origin, data } = this.previewData;
		const x1 = origin.x, y1 = origin.y, z1 = origin.z;
		const x2 = x1 + data.sx - 1, y2 = y1 + data.sy - 1, z2 = z1 + data.sz - 1;
		const step = Math.max(3, Math.ceil(Math.max(data.sx, data.sy, data.sz) / 50));
		for (const [px, py, pz] of [[x1, y1, z1], [x2, y1, z1], [x1, y1, z2], [x2, y1, z2], [x1, y2, z1], [x2, y2, z1], [x1, y2, z2], [x2, y2, z2]]) {
			this.client.sendCommand(`/summon text_display ${px} ${py} ${pz} "§e[LIT]✦"`);
		}
		for (const [a, b] of Litematic.previewEdges(x1, y1, z1, x2, y2, z2)) {
			const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
			const len = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
			const n = Math.floor(len / step);
			for (let i = 1; i <= n; i++) {
				this.client.sendCommand(`/summon text_display ${Math.round(a[0] + dx * i / n)} ${Math.round(a[1] + dy * i / n)} ${Math.round(a[2] + dz * i / n)} "§a[LIT]▪"`);
			}
		}
		this.client.sendCommand(`/summon text_display ${Math.floor((x1 + x2) / 2)} ${y2 + 2} ${Math.floor((z1 + z2) / 2)} "§b[LIT]INFO"`);
	}

	spawnPreviewParticles() {
		if (!this.previewData) return;
		const { origin, data } = this.previewData;
		const x1 = origin.x, y1 = origin.y, z1 = origin.z;
		const x2 = x1 + data.sx - 1, y2 = y1 + data.sy - 1, z2 = z1 + data.sz - 1;
		const step = Math.max(3, Math.ceil(Math.max(data.sx, data.sy, data.sz) / 60));
		// 底边 4 条 + 立柱 4 条（顶部省略，避免粒子过多）
		const edges = Litematic.previewEdges(x1, y1, z1, x2, y2, z2).slice(0, 8);
		for (const [a, b] of edges) {
			const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
			const len = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
			const n = Math.floor(len / step);
			for (let i = 0; i <= n; i++) {
				this.client.sendCommand(`/particle minecraft:endrod ${a[0] + dx * i / n + 0.5} ${a[1] + dy * i / n + 0.5} ${a[2] + dz * i / n + 0.5}`);
			}
		}
	}

	// ---- 导出 .mcstructure ----
	async exportStructure(fileName, sender, exportName, mode) {
		let raw = false;
		if (mode === "raw") raw = true;
		else if (mode === "trim") raw = false;
		else if (mode !== undefined) {
			this.client.tell("§cLitematic | §fError > §i模式参数无效：应为 raw 或 trim", sender);
			return;
		}
		if (mode === undefined && exportName === "raw") { raw = true; exportName = undefined; }
		const filePath = path.join(this.config.basePath, fileName.endsWith(".litematic") ? fileName : fileName + ".litematic");
		if (!fs.existsSync(filePath)) {
			this.client.tell(`§cLitematic | §fError > §i文件不存在: ${fileName}`, sender);
			return;
		}
		this.client.tell("§i正在解析 Litematic 文件…", sender);
		let data;
		try {
			data = await parseLitematic(filePath);
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i解析失败: ${e.message}`, sender);
			return;
		}
		if (!raw) trimAir(data);
		const name = (exportName || fileName.replace(/\.litematic$/i, "")).replace(/[\\/:*?"<>|]/g, "_");
		const dir = resolvePath("./structures");
		fs.mkdirSync(dir, { recursive: true });
		const outPath = path.join(dir, name + ".mcstructure");
		try {
			fs.writeFileSync(outPath, buildMcStructure(data));
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i导出失败: ${e.message}`, sender);
			return;
		}
		this.client.tell(
			`§aLitematic | §fExport > §i已导出结构文件: ${outPath}\n` +
			`§f尺寸: ${data.sx} × ${data.sy} × ${data.sz} | 方块: ${data.blocks.length} | 底部空气: ${data.trimmedAir} 层\n` +
			`§7用法: 将文件放入行为包 structures 文件夹（如 BP/structures/mystructure/）或单机存档的 structures 文件夹，游戏内用结构方块预览放置，或执行 /structure load <名称>`, sender
		);
	}

	onDestroy() {
		if (this.job) this.job.cancelled = true;
		if (this.verifyJob) this.verifyJob.cancelled = true;
		if (this.fixJob) this.fixJob.cancelled = true;
		if (this.previewTimer) { clearInterval(this.previewTimer); this.previewTimer = null; }
		this.pending = null;
		this.job = null;
		this.verifyJob = null;
		this.fixJob = null;
		this.previewData = null;
		this.client = null;
	}
}