import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { PNG } from "pngjs";
// config 由 mods.js 注入 (this.config)
import Command from "../../lib/command.js";

const MAX_IMAGE_DIM = 256;
const MAX_CHUNKS = 100;
const FILL_LIMIT = 32767;

// Block Palette
function loadBlockPalette() {
	const blocksPath = path.join(path.dirname(new URL(import.meta.url).pathname), "blocks.json");
	if (!fs.existsSync(blocksPath)) {
		throw new Error(`方块调色板文件不存在: ${blocksPath}`);
	}
	const raw = fs.readFileSync(blocksPath, "utf-8");
	const data = JSON.parse(raw);
	if (!data.blocks || !Array.isArray(data.blocks)) {
		throw new Error("blocks.json 格式不正确，需要 { blocks: [...] }");
	}
	const palette = data.blocks.filter(b => b.id && Array.isArray(b.rgb) && b.rgb.length === 3);

	hsvPalette.length = 0;
	for (const block of palette) {
		hsvPalette.push({ ...block, hsv: rgbToHsv(block.rgb[0], block.rgb[1], block.rgb[2]) });
	}

	return palette;
}

function rgbToHsv(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const d = max - min;
	let h = 0, s = max === 0 ? 0 : d / max, v = max;
	if (d !== 0) {
		switch (max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}
	return [h, s, v];
}

const hsvPalette = [];

const colorCache = new Map();

function rgbToLab(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
	g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
	b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
	let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
	let y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) / 1.00000;
	let z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
	x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
	y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
	z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function findNearestBlock(r, g, b, palette) {
	const cacheKey = `${r},${g},${b}`;
	if (colorCache.has(cacheKey)) return colorCache.get(cacheKey);

	const [h, s, v] = rgbToHsv(r, g, b);
	let best;

	if (s < 0.12) {
		if (v > 0.9)      best = palette.find(b => b.id === "white_concrete");
		else if (v > 0.7) best = palette.find(b => b.id === "light_gray_concrete");
		else if (v > 0.4) best = palette.find(b => b.id === "gray_concrete");
		else              best = palette.find(b => b.id === "black_concrete");
		if (!best) best = palette[0];
	} else {
		best = _findBestBlock(r, g, b, palette);
	}

	colorCache.set(cacheKey, best);
	return best;
}

function _findBestBlock(r, g, b, palette) {
	const lab = rgbToLab(r, g, b);
	let minDist = Infinity;
	let best = palette[0];

	for (const block of palette) {
		const blockLab = rgbToLab(block.rgb[0], block.rgb[1], block.rgb[2]);
		const dist = Math.pow(lab[0] - blockLab[0], 2) + Math.pow(lab[1] - blockLab[1], 2) + Math.pow(lab[2] - blockLab[2], 2);
		if (dist < minDist) {
			minDist = dist;
			best = block;
		}
	}

	return best;
}

// Image Processing
function resizeImage(pixels, origWidth, origHeight, newWidth, newHeight) {
	const newPixels = new Uint8ClampedArray(newWidth * newHeight * 4);
	const xRatio = origWidth / newWidth;
	const yRatio = origHeight / newHeight;

	for (let y = 0; y < newHeight; y++) {
		for (let x = 0; x < newWidth; x++) {
			const srcX = x * xRatio;
			const srcY = y * yRatio;
			const x1 = Math.floor(srcX);
			const y1 = Math.floor(srcY);
			const x2 = Math.min(x1 + 1, origWidth - 1);
			const y2 = Math.min(y1 + 1, origHeight - 1);
			const xFrac = srcX - x1;
			const yFrac = srcY - y1;

			for (let c = 0; c < 4; c++) {
				const v1 = pixels[(y1 * origWidth + x1) * 4 + c];
				const v2 = pixels[(y1 * origWidth + x2) * 4 + c];
				const v3 = pixels[(y2 * origWidth + x1) * 4 + c];
				const v4 = pixels[(y2 * origWidth + x2) * 4 + c];

				const top = v1 + (v2 - v1) * xFrac;
				const bottom = v3 + (v4 - v3) * xFrac;
				const value = Math.round(top + (bottom - top) * yFrac);

				newPixels[(y * newWidth + x) * 4 + c] = value;
			}
		}
	}

	return { pixels: newPixels, width: newWidth, height: newHeight };
}

function processImage(filePath, maxDim = MAX_IMAGE_DIM) {
	const buffer = fs.readFileSync(filePath);

	// Detect file type by magic bytes
	let png;
	if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
		// PNG
		png = PNG.sync.read(buffer);
	} else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
		// JPEG - convert via ffmpeg
		const tmpPng = filePath + ".tmp_convert.png";
		try {
			execSync(`ffmpeg -y -i "${filePath}" "${tmpPng}" 2>/dev/null`, { timeout: 30000 });
			const converted = fs.readFileSync(tmpPng);
			png = PNG.sync.read(converted);
		} catch (e) {
			throw new Error(`JPEG 转换失败: ${e.message}`);
		} finally {
			try { fs.unlinkSync(tmpPng); } catch {}
		}
	} else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
		// WEBP - convert via ffmpeg
		const tmpPng = filePath + ".tmp_convert.png";
		try {
			execSync(`ffmpeg -y -i "${filePath}" "${tmpPng}" 2>/dev/null`, { timeout: 30000 });
			const converted = fs.readFileSync(tmpPng);
			png = PNG.sync.read(converted);
		} catch (e) {
			throw new Error(`WEBP 转换失败: ${e.message}`);
		} finally {
			try { fs.unlinkSync(tmpPng); } catch {}
		}
	} else {
		// Try PNG anyway, might have weird header
		try {
			png = PNG.sync.read(buffer);
		} catch (e) {
			throw new Error(`不支持的图片格式 (需要 PNG/JPEG/WEBP)`);
		}
	}

	let { width, height, data } = png;
	let pixels = new Uint8Array(data);

	if (maxDim && (width > maxDim || height > maxDim)) {
		const ratio = Math.min(maxDim / width, maxDim / height);
		const newWidth = Math.round(width * ratio);
		const newHeight = Math.round(height * ratio);
		const resized = resizeImage(pixels, width, height, newWidth, newHeight);
		width = newWidth;
		height = newHeight;
		pixels = resized.pixels;
	}

	const palette = loadBlockPalette();
	if (palette.length === 0) {
		throw new Error("方块调色板为空，请检查 blocks.json");
	}

	const grid = [];
	let nonTransparent = 0;
	for (let z = 0; z < height; z++) {
		const row = [];
		for (let x = 0; x < width; x++) {
			const idx = (z * width + x) * 4;
			const r = pixels[idx];
			const g = pixels[idx + 1];
			const b = pixels[idx + 2];
			const a = pixels[idx + 3];

			if (a === 0) {
				row.push(null);
			} else {
				const block = findNearestBlock(r, g, b, palette);
				row.push(block.id);
				nonTransparent++;
			}
		}
		grid.push(row);
	}

	const blocks = [];
	for (let z = 0; z < height; z++) {
		for (let x = 0; x < width; x++) {
			if (grid[z][x]) {
				blocks.push({ x, z, cmd: grid[z][x] });
			}
		}
	}

	return { width, height, grid, blocks, nonTransparent };
}

// 矩形合并优化
function mergeBlocksToRects(blocks, width, height) {
	const grid = Array.from({ length: height }, () => Array(width).fill(null));
	for (const b of blocks) grid[b.z][b.x] = b.cmd;

	const used = Array.from({ length: height }, () => Array(width).fill(false));
	const rects = [];

	for (let z = 0; z < height; z++) {
		for (let x = 0; x < width; x++) {
			if (used[z][x] || !grid[z][x]) continue;
			const cmd = grid[z][x];

			let maxX = x;
			while (maxX + 1 < width && grid[z][maxX + 1] === cmd && !used[z][maxX + 1]) maxX++;

			let maxZ = z;
			let canExtend = true;
			while (canExtend && maxZ + 1 < height) {
				for (let tx = x; tx <= maxX; tx++) {
					if (grid[maxZ + 1][tx] !== cmd || used[maxZ + 1][tx]) { canExtend = false; break; }
				}
				if (canExtend) maxZ++;
			}

			const area = (maxX - x + 1) * (maxZ - z + 1);
			if (area <= FILL_LIMIT) {
				for (let tz = z; tz <= maxZ; tz++) {
					for (let tx = x; tx <= maxX; tx++) used[tz][tx] = true;
				}
				if (area === 1) {
					rects.push({ type: "setblock", x, z, cmd, count: 1 });
				} else {
					rects.push({ type: "fill", x1: x, z1: z, x2: maxX, z2: maxZ, cmd, count: area });
				}
			} else {
				const h = maxZ - z + 1;
				const stripeW = Math.max(1, Math.floor(FILL_LIMIT / h));
				for (let sx = x; sx <= maxX; sx += stripeW) {
					const ex = Math.min(sx + stripeW - 1, maxX);
					const stripeArea = (ex - sx + 1) * h;
					for (let tz = z; tz <= maxZ; tz++) {
						for (let tx = sx; tx <= ex; tx++) used[tz][tx] = true;
					}
					if (stripeArea === 1) {
						rects.push({ type: "setblock", x: sx, z, cmd, count: 1 });
					} else {
						rects.push({ type: "fill", x1: sx, z1: z, x2: ex, z2: maxZ, cmd, count: stripeArea });
					}
				}
			}
		}
	}
	return rects;
}

// Area Chunking
function computeAreas(origin, width, height, dir) {
	let startChunkA, startChunkB, endChunkA, endChunkB;

	switch (dir) {
		case "y":
			startChunkA = Math.floor(origin.x / 16);
			startChunkB = Math.floor(origin.y / 16);
			endChunkA = Math.floor((origin.x + width - 1) / 16);
			endChunkB = Math.floor((origin.y + height - 1) / 16);
			break;
		case "z":
			startChunkA = Math.floor(origin.z / 16);
			startChunkB = Math.floor(origin.x / 16);
			endChunkA = Math.floor((origin.z + width - 1) / 16);
			endChunkB = Math.floor((origin.x + height - 1) / 16);
			break;
		case "x":
		default:
			startChunkA = Math.floor(origin.x / 16);
			startChunkB = Math.floor(origin.z / 16);
			endChunkA = Math.floor((origin.x + width - 1) / 16);
			endChunkB = Math.floor((origin.z + height - 1) / 16);
			break;
	}

	const totalChunksA = endChunkA - startChunkA + 1;
	const totalChunksB = endChunkB - startChunkB + 1;
	const totalChunks = totalChunksA * totalChunksB;

	const areas = [];
	if (totalChunks <= MAX_CHUNKS) {
		areas.push({ a1: startChunkA, b1: startChunkB, a2: endChunkA, b2: endChunkB });
	} else if (totalChunksB > MAX_CHUNKS) {
		const maxChunksB = MAX_CHUNKS;
		for (let b = startChunkB; b <= endChunkB; b += maxChunksB) {
			const b2 = Math.min(b + maxChunksB - 1, endChunkB);
			areas.push({ a1: startChunkA, b1: b, a2: endChunkA, b2 });
		}
	} else {
		const maxChunksA = Math.floor(MAX_CHUNKS / totalChunksB);
		for (let a = startChunkA; a <= endChunkA; a += maxChunksA) {
			const a2 = Math.min(a + maxChunksA - 1, endChunkA);
			areas.push({ a1: a, b1: startChunkB, a2, b2: endChunkB });
		}
	}

	return areas;
}

// Main Class
export default class ImageMod {
	constructor(client) {
		this.client = client;
		this.pending = null;
		this.job = null;
	}

	onCommand() {
		return {
			op: [
				Command.create("id:create", "将图片转换为像素画 (Debug)")
					.addString("图片文件名", false)
					.addEnum(["x", "y", "z"], "生成方向 (x=默认 y=直立 z=旋转)", true)
					.addOptionalFloat("X")
					.addOptionalFloat("Y")
					.addOptionalFloat("Z")
					.setFunc(async (sender, fileName, dir, x, y, z) => {
						if (this.job) {
							this.client.tell("§cImageDebug | §fError > §i已有转换进程运行中，请等待完成或 !id:n 中断", sender);
							return;
						}
						await this.create(fileName, sender, dir, x, y, z);
					}),

				Command.create("id:raw", "将图片转换为像素画（原始尺寸，Debug）")
					.addString("图片文件名", false)
					.addEnum(["x", "z"], "生成方向 (x=默认 z=旋转)", true)
					.addOptionalFloat("X")
					.addOptionalFloat("Y")
					.addOptionalFloat("Z")
					.setFunc(async (sender, fileName, dir, x, y, z) => {
						if (this.job) {
							this.client.tell("§cImageDebug | §fError > §i已有转换进程运行中，请等待完成或 !id:n 中断", sender);
							return;
						}
						await this.createRaw(fileName, sender, dir, x, y, z);
					}),

				Command.create("id:y", "确认转换操作 (Debug)")
					.setFunc(async (sender) => {
						if (!this.pending) {
							this.client.tell("§cImageDebug | §fError > §i没有待确认的转换任务", sender);
							return;
						}
						this.client.tell("§eImageDebug | §fConvert > §i已确认，开始转换…", sender);
						try {
							await this.run();
						} catch (e) {
							this.client.tell(`§cImageDebug | §fError > §i转换出错: ${e.message}`, sender);
							this.job = null;
						}
					}),

				Command.create("id:n", "取消/中断转换 (Debug)")
					.setFunc((sender) => {
						if (this.job) {
							this.job.cancelled = true;
							this.client.tell("§cImageDebug | §fCancel > §i正在中断转换…", sender);
						} else if (this.pending) {
							this.pending = null;
							this.client.tell("§cImageDebug | §fCancel > §i已取消转换", sender);
						} else {
							this.client.tell("§cImageDebug | §fError > §i没有进行中的操作", sender);
						}
					}),

			Command.create("id:status", "查看转换进度 (Debug)")
				.setFunc((sender) => {
					if (!this.job) {
						this.client.tell("§cImageDebug | §fError > §i没有进行中的转换任务", sender);
						return;
					}
					const { fileName, startTime, total, blockTotal, phase, areaIndex, areaTotal, phasePlaced, phaseTotal, phaseBlocksPlaced, phaseBlockTotal } = this.job;
					const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
					const totalPct = total > 0 ? ((phasePlaced / total) * 100).toFixed(1) : "0.0";
					const cmdSpeed = phasePlaced > 0 ? Math.round(phasePlaced / parseFloat(elapsed)) : 0;
					const totalEta = cmdSpeed > 0 ? ((total - phasePlaced) / cmdSpeed).toFixed(1) : "∞";
					const phasePct = phaseTotal > 0 ? (phasePlaced / phaseTotal * 100).toFixed(1) : "0.0";
					this.client.tellAll(
						`§eImageDebug | §fStatus > §i正在转换 ${fileName} | 总进度 ${totalPct}% (${phasePlaced}/${total} 命令)\n` +
						`§f阶段: ${phase} (${areaIndex}/${areaTotal} 区域)\n` +
						`§f当前区域: ${phasePct}% | ${phasePlaced} / ${phaseTotal} 命令 | 方块 ${phaseBlocksPlaced} / ${phaseBlockTotal}\n` +
						`§f速度: ${cmdSpeed} 命令/s | ${elapsed}s | 预计 ${totalEta}s`
					);
				})
			]
		};
	}

	async create(fileName, sender, dir, x, y, z) {
		await this._create("create", fileName, sender, dir, x, y, z, MAX_IMAGE_DIM, ["x", "y", "z"]);
	}

	async createRaw(fileName, sender, dir, x, y, z) {
		await this._create("raw", fileName, sender, dir, x, y, z, null, ["x", "z"]);
	}

	async _create(mode, fileName, sender, dir, x, y, z, maxDim, allowedDirs) {
		const dirValue = dir || "x";
		if (!allowedDirs.includes(dirValue)) {
			this.client.tell(`§cImageDebug | §fError > §i该模式不支持方向 ${dirValue}，支持: ${allowedDirs.join("/")}`, sender);
			return;
		}

		const coordCount = [x, y, z].filter(v => v !== undefined && v !== null).length;

		if (coordCount > 0 && coordCount < 3) {
			this.client.tell("§cImageDebug | §fError > §i坐标参数不完整，需要同时提供 X Y Z 或都不提供（使用自身坐标）", sender);
			return;
		}

		// 路径穿越防护：只允许单层合法文件名
		if (typeof fileName !== "string" || !fileName ||
			fileName !== path.basename(fileName) || /[\\/]/.test(fileName) || fileName.startsWith(".")) {
			this.client.tell(`§cImageDebug | §fError > §i非法的文件名: ${fileName}`, sender);
			return;
		}

		const filePath = path.join(this.config.basePath.image, fileName);
		if (!fs.existsSync(filePath)) {
			this.client.tell(`§cImageDebug | §fError > §i文件不存在: ${fileName}`, sender);
			return;
		}

		this.client.tell("§i正在处理图片…", sender);

		let data;
		try {
			data = processImage(filePath, maxDim);
		} catch (e) {
			this.client.tell(`§cImageDebug | §fError > §i图片处理失败: ${e.message}`, sender);
			return;
		}

		if (mode === "raw") {
			const maxSide = Math.max(data.width, data.height);
			if (maxSide > 2048) {
				this.client.tell(`§cImageDebug | §fError > §i图片太大: ${data.width}×${data.height} (raw 模式最大 2048px)`, sender);
				return;
			}
		}

		let origin;
		if (coordCount === 3) {
			origin = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
		} else {
			try {
				const pos = await this.client.getPosition("@s");
				if (!pos) {
					this.client.tell("§cImageDebug | §fError > §i无法获取你的坐标", sender);
					return;
				}
				origin = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
			} catch {
				this.client.tell("§cImageDebug | §fError > §i无法获取你的坐标", sender);
				return;
			}
		}

		if (origin.y < -64 || origin.y > 320) {
			this.client.tell(`§cImageDebug | §fError > §iY 轴超出限制: ${origin.y} (允许 -64 ~ 320)`, sender);
			return;
		}

		const width = data.width;
		const height = data.height;

		if (dirValue === "y") {
			const maxY = origin.y + height - 1;
			if (maxY > 320) {
				this.client.tell(`§cImageDebug | §fError > §iY 轴超出限制: ${origin.y} + ${height - 1} = ${maxY} (允许最大 320)`, sender);
				return;
			}
		}

		let minX, minY, minZ, maxX, maxY, maxZ;
		switch (dirValue) {
			case "y":
				minX = origin.x;
				minY = origin.y;
				minZ = origin.z;
				maxX = origin.x + width - 1;
				maxY = origin.y + height - 1;
				maxZ = origin.z;
				break;
			case "z":
				minX = origin.x;
				minY = origin.y;
				minZ = origin.z;
				maxX = origin.x + height - 1;
				maxY = origin.y;
				maxZ = origin.z + width - 1;
				break;
			case "x":
			default:
				minX = origin.x;
				minY = origin.y;
				minZ = origin.z;
				maxX = origin.x + width - 1;
				maxY = origin.y;
				maxZ = origin.z + height - 1;
				break;
		}

		const estTime = (data.nonTransparent * 0.001).toFixed(1);

		const previewRects = mergeBlocksToRects(data.blocks, width, height);
		const previewAreas = computeAreas(origin, width, height, dirValue);

		this.pending = { fileName, origin, data, dir: dirValue, mode };

		this.client.tellAll(
			`§eImageDebug | §fPreview > §i文件: ${fileName} | 尺寸: ${width}×${height} = ${width * height} 像素\n` +
			`§f非透明像素: ${data.nonTransparent} → ${previewRects.length} 条指令\n` +
			`§f方向: ${dirValue} | 区块: ${previewAreas.length} 个区域\n` +
			`§f范围: (${minX}, ${minY}, ${minZ}) → (${maxX}, ${maxY}, ${maxZ})\n` +
			`§f预计耗时: ${estTime}s\n` +
			`§f确认请发送 §e!id:y§f，取消请发送 §c!id:n`
		);
	}

	async run() {
		const task = this.pending;
		this.pending = null;

		const { data, origin, fileName, dir } = task;
		const blocks = data.blocks;
		const width = data.width;
		const height = data.height;

		const rects = mergeBlocksToRects(blocks, width, height);
		const totalCmds = rects.length;

		const areas = computeAreas(origin, width, height, dir);

		let errorCount = 0;
		let successCount = 0;

		console.log(`[DEBUG] 开始转换: ${fileName}, 方块: ${data.nonTransparent}, 指令: ${totalCmds}, 区域: ${areas.length}`);

		this.job = {
			fileName,
			total: totalCmds,
			cancelled: false,
			startTime: Date.now(),
			blockTotal: data.nonTransparent,
			phase: "准备",
			areaIndex: 0,
			areaTotal: areas.length,
			phasePlaced: 0,
			phaseTotal: 0,
			phaseBlocksPlaced: 0,
			phaseBlockTotal: 0
		};

		const delay = (ms) => new Promise(r => setTimeout(r, ms));

		for (let i = 0; i < areas.length; i++) {
			if (this.job.cancelled) break;

			const area = areas[i];
			this.job.areaIndex = i + 1;

			let absX1, absZ1, absX2, absZ2;
			switch (dir) {
				case "x":
					absX1 = area.a1 * 16;
					absZ1 = area.b1 * 16;
					absX2 = (area.a2 + 1) * 16 - 1;
					absZ2 = (area.b2 + 1) * 16 - 1;
					break;
				case "z":
					absX1 = area.b1 * 16;
					absZ1 = area.a1 * 16;
					absX2 = (area.b2 + 1) * 16 - 1;
					absZ2 = (area.a2 + 1) * 16 - 1;
					break;
				case "y":
				default:
					absX1 = area.a1 * 16;
					absZ1 = origin.z;
					absX2 = (area.a2 + 1) * 16 - 1;
					absZ2 = origin.z;
					break;
			}

			const absY1 = dir === "y" ? area.b1 * 16 : origin.y;
			const absY2 = dir === "y" ? (area.b2 + 1) * 16 - 1 : origin.y;

			const tickName = `img_${i}`;
			this.job.phase = "创建常加载区块";
			this.job.phasePlaced = 0;
			this.job.phaseTotal = 1;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = 0;

			try {
				const r1 = await this.client.runCommand(`/tickingarea add ${absX1} ${absY1} ${absZ1} ${absX2} ${absY2} ${absZ2} ${tickName}`);
				if (r1 && r1.body && r1.body.statusCode !== 0) {
					console.log(`[ImageDebug] [tickingarea add] ${r1.body.statusMessage}`);
					this.client.tell(`§cImageDebug | §fError > §i[tickingarea add] ${r1.body.statusMessage}`);
				}
			} catch (e) {
				console.log(`[ImageDebug] [tickingarea add] 异常: ${e.message}`);
				this.client.tell(`§cImageDebug | §fError > §i[tickingarea add] 异常: ${e.message}`);
			}

			const chunkRects = [];
			for (const r of rects) {
				let rx1, rx2, rz1, rz2, ry1, ry2;
				if (r.type === "setblock") {
					switch (dir) {
						case "x":
							rx1 = origin.x + r.x; rx2 = rx1;
							rz1 = origin.z + r.z; rz2 = rz1;
							ry1 = origin.y; ry2 = ry1;
							break;
						case "z":
							rx1 = origin.x + r.z; rx2 = rx1;
							rz1 = origin.z + r.x; rz2 = rz1;
							ry1 = origin.y; ry2 = ry1;
							break;
						case "y":
						default:
							rx1 = origin.x + r.x; rx2 = rx1;
							rz1 = origin.z; rz2 = rz1;
							ry1 = origin.y + (height - 1 - r.z); ry2 = ry1;
							break;
					}
					if (rx1 >= absX1 && rx1 <= absX2 && ry1 >= absY1 && ry1 <= absY2 && rz1 >= absZ1 && rz1 <= absZ2) {
						chunkRects.push({ r, cx1: rx1, cy1: ry1, cz1: rz1, cx2: rx1, cy2: ry1, cz2: rz1 });
					}
				} else {
					switch (dir) {
						case "x":
							rx1 = origin.x + r.x1; rx2 = origin.x + r.x2;
							rz1 = origin.z + r.z1; rz2 = origin.z + r.z2;
							ry1 = origin.y; ry2 = ry1;
							break;
						case "z":
							rx1 = origin.x + r.z1; rx2 = origin.x + r.z2;
							rz1 = origin.z + r.x1; rz2 = origin.z + r.x2;
							ry1 = origin.y; ry2 = ry1;
							break;
						case "y":
						default:
							rx1 = origin.x + r.x1; rx2 = origin.x + r.x2;
							rz1 = origin.z; rz2 = rz1;
							ry1 = origin.y + (height - 1 - r.z2); ry2 = origin.y + (height - 1 - r.z1);
							break;
					}
					if (rx2 >= absX1 && rx1 <= absX2 && ry2 >= absY1 && ry1 <= absY2 && rz2 >= absZ1 && rz1 <= absZ2) {
						const cx1 = Math.max(rx1, absX1);
						const cy1 = Math.max(ry1, absY1);
						const cz1 = Math.max(rz1, absZ1);
						const cx2 = Math.min(rx2, absX2);
						const cy2 = Math.min(ry2, absY2);
						const cz2 = Math.min(rz2, absZ2);
						const clippedCount = (cx2 - cx1 + 1) * (cy2 - cy1 + 1) * (cz2 - cz1 + 1);
						chunkRects.push({ r, cx1, cy1, cz1, cx2, cy2, cz2, clippedCount });
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

				try {
					let result;
					if (r.type === "setblock") {
						result = await this.client.runCommand(`/setblock ${cx1} ${cy1} ${cz1} ${r.cmd}`);
					} else {
						result = await this.client.runCommand(`/fill ${cx1} ${cy1} ${cz1} ${cx2} ${cy2} ${cz2} ${r.cmd}`);
					}
					if (result && result.body && result.body.statusCode !== 0) {
						console.log(`§c[${r.type}] (${cx1},${cy1},${cz1}) ${r.cmd} => ${result.body.statusMessage}`);
						errorCount++;
					} else {
						successCount++;
					}
				} catch (e) {
					console.log(`§c[${r.type}] (${cx1},${cy1},${cz1}) ${r.cmd} => 异常: ${e.message}`);
					errorCount++;
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
				const r2 = await this.client.runCommand(`/tickingarea remove ${tickName}`);
				if (r2 && r2.body && r2.body.statusCode !== 0) {
					console.log(`[ImageDebug] [tickingarea remove] ${r2.body.statusMessage}`);
					this.client.tell(`§cImageDebug | §fError > §i[tickingarea remove] ${r2.body.statusMessage}`);
				}
			} catch (e) {
				console.log(`[ImageDebug] [tickingarea remove] 异常: ${e.message}`);
				this.client.tell(`§cImageDebug | §fError > §i[tickingarea remove] 异常: ${e.message}`);
			}

			await delay(1000);
		}

		if (!this.job.cancelled) {
			const elapsed = ((Date.now() - this.job.startTime) / 1000).toFixed(1);
			const speed = Math.round(data.nonTransparent / parseFloat(elapsed));
			console.log(`[DEBUG] 完成: 成功 ${successCount}, 失败 ${errorCount}`);
			this.client.tellAll(
				`§eImageDebug | §fConvert > §i${fileName} 转换完成 共 ${data.nonTransparent} 方块 耗时 ${elapsed}s 速度 ${speed}方块/s` +
				(errorCount > 0 ? `\n§c失败 ${errorCount} 条指令` : "")
			);
		} else {
			this.client.tellAll(`§cImageDebug | §fCancel > §i图片转换已中断 (${fileName})`);
		}
		this.job = null;
	}

	onDestroy() {
		if (this.job) this.job.cancelled = true;
		this.pending = null;
		this.job = null;
		this.client = null;
	}
}
