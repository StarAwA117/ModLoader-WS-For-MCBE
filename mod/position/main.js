
const FILL_LIMIT = 32767;
const CHUNK = 16;
const CHUNK_SIZE = 64;
const MAX_TICKING_CHUNKS = 100;
// 单个 tickingarea 上限为 100 个区块（16×16），最多同时 10 个。
// 64×64 区域横向最多占 5×5 区块，每 48 格高度最多占 4 区块：5×5×4=100，任意对齐均安全。
const MAX_SEG_HEIGHT = 48;
const Y_MIN = -64;
const Y_MAX = 320;

let copyBatchId = 0;
const copyRegistry = new Map();

function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}

function validateY(y, sender) {
	if (y < Y_MIN || y > Y_MAX) {
		throw new Error(`Y 坐标超出范围: §f${y} §c(允许 ${Y_MIN} ~ ${Y_MAX})`);
	}
}

function computeXZAreas(minX, minZ, maxX, maxZ) {
	const startChunkX = Math.floor(minX / CHUNK_SIZE);
	const startChunkZ = Math.floor(minZ / CHUNK_SIZE);
	const endChunkX = Math.floor(maxX / CHUNK_SIZE);
	const endChunkZ = Math.floor(maxZ / CHUNK_SIZE);

	const totalChunksX = endChunkX - startChunkX + 1;
	const totalChunksZ = endChunkZ - startChunkZ + 1;
	const totalChunks = totalChunksX * totalChunksZ;

	const areas = [];
	if (totalChunks <= MAX_TICKING_CHUNKS) {
		for (let cz = startChunkZ; cz <= endChunkZ; cz++) {
			for (let cx = startChunkX; cx <= endChunkX; cx++) {
				areas.push({ cx1: cx, cz1: cz, cx2: cx, cz2: cz });
			}
		}
	} else if (totalChunksZ > MAX_TICKING_CHUNKS) {
		const maxCz = MAX_TICKING_CHUNKS;
		for (let cz = startChunkZ; cz <= endChunkZ; cz += maxCz) {
			const czEnd = Math.min(cz + maxCz - 1, endChunkZ);
			for (let czz = cz; czz <= czEnd; czz++) {
				for (let cx = startChunkX; cx <= endChunkX; cx++) {
					areas.push({ cx1: cx, cz1: czz, cx2: cx, cz2: czz });
				}
			}
		}
	} else {
		const maxCx = Math.floor(MAX_TICKING_CHUNKS / totalChunksZ);
		for (let cx = startChunkX; cx <= endChunkX; cx += maxCx) {
			const cxEnd = Math.min(cx + maxCx - 1, endChunkX);
			for (let cxx = cx; cxx <= cxEnd; cxx++) {
				for (let cz = startChunkZ; cz <= endChunkZ; cz++) {
					areas.push({ cx1: cxx, cz1: cz, cx2: cxx, cz2: cz });
				}
			}
		}
	}
	return areas;
}

export default class Position {
	constructor(client) {
		this.client = client;
		this.job = null;
		this.posA = null;
		this.posB = null;
		this.lastCopyEntry = null;
	}

	onCommand() {
		return {
			op: [
this.Command.create("p:a", "设置 A 点坐标（可选 X Y Z，缺省则取自身坐标）")
					.addOptionalInteger("X")
					.addOptionalInteger("Y")
					.addOptionalInteger("Z")
					.setFunc(async (sender, x, y, z) => {
						if (this.job) {
							this.client.tell("§cPosition | §fError > §i已有操作进行中，请等待完成或 $p:cancel 中断", sender);
							return;
						}
						let pos;
						if (x !== undefined && y !== undefined && z !== undefined) {
							pos = { x, y, z };
						} else {
							try {
								pos = await this.client.getPosition("@s");
							} catch {
								this.client.tell("§cPosition | §fError > §i无法获取你的坐标", sender);
								return;
							}
						}
						if (!pos) {
							this.client.tell("§cPosition | §fError > §i无法获取坐标", sender);
							return;
						}
						validateY(Math.floor(pos.y), sender);
						this.posA = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
						this.client.tellAll(`§ePosition | §fPosA > §i已记录坐标 ${this.posA.x} ${this.posA.y} ${this.posA.z}`);
					}),

this.Command.create("p:b", "设置 B 点坐标（可选 X Y Z，缺省则取自身坐标）")
					.addOptionalInteger("X")
					.addOptionalInteger("Y")
					.addOptionalInteger("Z")
					.setFunc(async (sender, x, y, z) => {
						if (this.job) {
							this.client.tell("§cPosition | §fError > §i已有操作进行中，请等待完成或 $p:cancel 中断", sender);
							return;
						}
						let pos;
						if (x !== undefined && y !== undefined && z !== undefined) {
							pos = { x, y, z };
						} else {
							try {
								pos = await this.client.getPosition("@s");
							} catch {
								this.client.tell("§cPosition | §fError > §i无法获取你的坐标", sender);
								return;
							}
						}
						if (!pos) {
							this.client.tell("§cPosition | §fError > §i无法获取坐标", sender);
							return;
						}
						validateY(Math.floor(pos.y), sender);
						this.posB = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
						this.client.tellAll(`§ePosition | §fPosB > §i已记录坐标 ${this.posB.x} ${this.posB.y} ${this.posB.z}`);
					}),

this.Command.create("p:distance", "计算 A B 两点间的距离（保留 3 位小数）")
					.setFunc((sender) => {
						if (!this.posA || !this.posB) {
							this.client.tell("§cPosition | §fError > §i请先设置 A 点和 B 点", sender);
							return;
						}
						const dx = this.posB.x - this.posA.x;
						const dy = this.posB.y - this.posA.y;
						const dz = this.posB.z - this.posA.z;
						const dist = Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(3);
						this.client.tellAll(`§ePosition | §fDistance > §i${dist}`);
					}),

this.Command.create("p:offset", "计算 B 点相对于 A 点的偏移量")
					.setFunc((sender) => {
						if (!this.posA || !this.posB) {
							this.client.tell("§cPosition | §fError > §i请先设置 A 点和 B 点", sender);
							return;
						}
						const ox = this.posB.x - this.posA.x;
						const oy = this.posB.y - this.posA.y;
						const oz = this.posB.z - this.posA.z;
						this.client.tellAll(`§ePosition | §fOffset > §iX ${ox}  Y ${oy}  Z ${oz}`);
					}),

this.Command.create("p:fill", "填充 A B 两点间区域（必填方块 ID，选填 replace 目标方块 ID）")
					.addString("填充方块 ID", false)
					.addOptionalString("替换目标方块 ID")
					.setFunc(async (sender, fillBlock, replaceBlock) => {
						if (!this.posA || !this.posB) {
							this.client.tell("§cPosition | §fError > §i请先设置 A 点和 B 点", sender);
							return;
						}
						await this._withJob(sender, "fill", () => this._execFill(sender, fillBlock, replaceBlock));
					}),

this.Command.create("p:copy", "复制 A B 两点间区域")
					.setFunc(async (sender) => {
						if (!this.posA || !this.posB) {
							this.client.tell("§cPosition | §fError > §i请先设置 A 点和 B 点", sender);
							return;
						}
						await this._withJob(sender, "copy", () => this._execCopy(sender));
					}),

this.Command.create("p:paste", "粘贴复制的结构（可选 X Y Z，缺省取自身坐标）")
					.addOptionalInteger("X")
					.addOptionalInteger("Y")
					.addOptionalInteger("Z")
					.setFunc(async (sender, x, y, z) => {
						let origin;
						if (x !== undefined || y !== undefined || z !== undefined) {
							if (x === undefined || y === undefined || z === undefined) {
								this.client.tell("§cPosition | §fError > §i请提供完整的 X Y Z 坐标或不提供坐标", sender);
								return;
							}
							origin = { x, y, z };
						} else {
							try {
								const pos = await this.client.getPosition("@s");
								if (!pos) {
									this.client.tell("§cPosition | §fError > §i无法获取你的坐标", sender);
									return;
								}
								origin = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
							} catch {
								this.client.tell("§cPosition | §fError > §i无法获取你的坐标", sender);
								return;
							}
						}
						await this._withJob(sender, "paste", () => this._execPaste(sender, origin));
					}),

this.Command.create("p:cut", "剪切 A B 两点间区域（复制后填充空气）")
					.setFunc(async (sender) => {
						if (!this.posA || !this.posB) {
							this.client.tell("§cPosition | §fError > §i请先设置 A 点和 B 点", sender);
							return;
						}
						await this._withJob(sender, "cut", async () => {
							await this._execCopy(sender);
							if (this.job && !this.job.cancelled) {
								await this._execFill(sender, "air", null);
							}
						});
					}),

this.Command.create("p:cancel", "中断当前操作")
					.setFunc((sender) => {
						if (this.job) {
							this.job.cancelled = true;
							this.client.tell("§cPosition | §fCancel > §i正在中断操作…", sender);
						} else {
							this.client.tell("§cPosition | §fError > §i没有进行中的操作", sender);
						}
					}),

this.Command.create("p:status", "查看当前任务进度")
					.setFunc((sender) => {
						if (!this.job) {
							this.client.tell("§cPosition | §fError > §i没有进行中的操作", sender);
							return;
						}

						const job = this.job;
						const elapsed = (Date.now() - job.startTime) / 1000;
						const placed = job.placed || 0;
						const total = job.total || 0;
						const pct = total > 0 ? ((placed / total) * 100).toFixed(1) : "0.0";
						const cmdPlaced = job.cmdPlaced || 0;
						const cmdSpeed = elapsed > 0 ? (cmdPlaced / elapsed) : 0;
						const eta = cmdSpeed > 0 ? ((total - placed) / cmdSpeed).toFixed(1) : "∞";

						const typeMap = { fill: "填充", copy: "复制", paste: "粘贴", cut: "剪切" };
						const type = typeMap[job.type] || "未知";

						let msg = `§ePosition | §fStatus > §i${type}\n` +
							`§f阶段: ${job.phase || "未知"}\n` +
							`§f进度: ${pct}% (${placed}/${total} 步骤)`;

						if (job.blockTotal) {
							const blockPct = job.blockTotal > 0 ? ((job.blockPlaced || 0) / job.blockTotal * 100).toFixed(1) : "0.0";
							msg += `\n§f方块: ${blockPct}% (${job.blockPlaced || 0}/${job.blockTotal})`;
						}

						msg += `\n§f耗时: ${elapsed.toFixed(1)}s | §f速度: ${cmdSpeed.toFixed(1)} 命令/s\n` +
							`§f预计剩余: ${eta}s`;

						this.client.tellAll(msg);
					}),

this.Command.create("p:show", "显示当前 A B 点坐标")
					.setFunc((sender) => {
						const a = this.posA;
						const b = this.posB;
						const aStr = a ? `${a.x} ${a.y} ${a.z}` : "无";
						const bStr = b ? `${b.x} ${b.y} ${b.z}` : "无";
						this.client.tellAll(`§ePosition | §f[A] > §i${aStr}\n§ePosition | §f[B] > §i${bStr}`);
					}),
			]
		};
	}

	async _withJob(sender, type, fn) {
		if (this.job) {
			this.client.tell("§cPosition | §fError > §i已有操作进行中，请等待完成或 $p:cancel 中断", sender);
			return;
		}
		this.job = { cancelled: false, startTime: Date.now(), type };
		try {
			await fn();
		} catch (e) {
			this.client.tellAll(`§cPosition | §fError > §i${e.message}`);
		} finally {
			this.job = null;
		}
	}

	async _execFill(sender, fillBlock, replaceBlock) {
		const minX = Math.min(this.posA.x, this.posB.x);
		const minY = Math.min(this.posA.y, this.posB.y);
		const minZ = Math.min(this.posA.z, this.posB.z);
		const maxX = Math.max(this.posA.x, this.posB.x);
		const maxY = Math.max(this.posA.y, this.posB.y);
		const maxZ = Math.max(this.posA.z, this.posB.z);

		validateY(minY, sender);
		validateY(maxY, sender);

		const testTickName = "posfill_test";
		try {
			await this.client.runCommand(`/tickingarea add ${this.posA.x} ${this.posA.y} ${this.posA.z} ${this.posA.x} ${this.posA.y} ${this.posA.z} ${testTickName}`);

			const testSet = await this.client.runCommand(`/setblock ${this.posA.x} ${this.posA.y} ${this.posA.z} ${fillBlock}`);
			if (!testSet || testSet.body?.statusCode !== 0) {
				const testFor = await this.client.runCommand(`/testforblock ${this.posA.x} ${this.posA.y} ${this.posA.z} ${fillBlock}`);
				if (!testFor || testFor.body?.statusCode !== 0) {
					const msg = testFor?.body?.statusMessage || "未知错误";
					this.client.tellAll(`§cPosition | §fError > §i方块 ID 非法: ${fillBlock} -> ${msg}`);
					return;
				}
			}

			if (replaceBlock) {
				const testReplace = await this.client.runCommand(`/setblock ${this.posA.x} ${this.posA.y} ${this.posA.z} ${replaceBlock}`);
				if (!testReplace || testReplace.body?.statusCode !== 0) {
					const testForR = await this.client.runCommand(`/testforblock ${this.posA.x} ${this.posA.y} ${this.posA.z} ${replaceBlock}`);
					if (!testForR || testForR.body?.statusCode !== 0) {
						const msg = testForR?.body?.statusMessage || "未知错误";
						this.client.tellAll(`§cPosition | §fError > §i替换方块 ID 非法: ${replaceBlock} -> ${msg}`);
						return;
					}
				}
			}
		} catch (e) {
			this.client.tellAll(`§cPosition | §fError > §i方块 ID 测试异常: ${e.message}`);
			return;
		} finally {
			try {
				await this.client.runCommand(`/tickingarea remove ${testTickName}`);
			} catch {}
		}

		const totalX = maxX - minX + 1;
		const totalY = maxY - minY + 1;
		const totalZ = maxZ - minZ + 1;
		const totalBlocks = totalX * totalY * totalZ;

		const xzAreas = computeXZAreas(minX, minZ, maxX, maxZ);

		let totalCmds = 0;
		const areaLayers = [];
		for (const area of xzAreas) {
			const xSize = (Math.min(maxX, (area.cx2 + 1) * CHUNK_SIZE - 1) - Math.max(minX, area.cx1 * CHUNK_SIZE) + 1);
			const zSize = (Math.min(maxZ, (area.cz2 + 1) * CHUNK_SIZE - 1) - Math.max(minZ, area.cz1 * CHUNK_SIZE) + 1);
			const areaPerY = xSize * zSize;
			const maxYLayers = Math.max(1, Math.floor((FILL_LIMIT - 1) / areaPerY));
			const yLayers = Math.ceil(totalY / maxYLayers);
			totalCmds += yLayers;
			areaLayers.push({ area, yLayers, maxYLayers });
		}

		this.job.type = this.job.type || "fill";
		this.job.phase = "填充";
		this.job.placed = 0;
		this.job.cmdPlaced = 0;
		this.job.total = totalCmds;
		this.job.blockTotal = totalBlocks;
		this.job.blockPlaced = 0;

		for (const { area, yLayers, maxYLayers } of areaLayers) {
			if (this.job.cancelled) break;

			const absX1 = area.cx1 * CHUNK_SIZE;
			const absZ1 = area.cz1 * CHUNK_SIZE;
			const absX2 = (area.cx2 + 1) * CHUNK_SIZE - 1;
			const absZ2 = (area.cz2 + 1) * CHUNK_SIZE - 1;

			const fx1 = Math.max(minX, absX1);
			const fz1 = Math.max(minZ, absZ1);
			const fx2 = Math.min(maxX, absX2);
			const fz2 = Math.min(maxZ, absZ2);

			for (let j = 0; j < yLayers; j++) {
				if (this.job.cancelled) break;

				const yStart = j * maxYLayers;
				const yEnd = Math.min(yStart + maxYLayers - 1, totalY - 1);
				const absY1 = minY + yStart;
				const absY2 = minY + yEnd;

				const tickName = `posfill_${Date.now()}_${area.cx1}_${area.cz1}_${j}`;
				try {
					await this.client.runCommand(`/tickingarea add ${fx1} ${absY1} ${fz1} ${fx2} ${absY2} ${fz2} ${tickName}`);
				} catch (e) {
					this.client.tellAll(`§cPosition | §fError > §i[tickingarea add] ${e.message}`);
				}

				this.client.sendCommand(`/fill ${fx1} ${absY1} ${fz1} ${fx2} ${absY2} ${fz2} ${fillBlock}${replaceBlock ? ` replace ${replaceBlock}` : ""}`);
				await sleep(10);

				try {
					await this.client.runCommand(`/tickingarea remove ${tickName}`);
				} catch (e) {
					// ignore
				}

				this.job.placed++;
				this.job.cmdPlaced++;
				this.job.blockPlaced = totalBlocks > 0 ? Math.round(totalBlocks * this.job.placed / totalCmds) : 0;
			}
		}

		if (!this.job.cancelled) {
			this.client.tellAll(`§ePosition | §fFill > §i填充完成 ${fillBlock}${replaceBlock ? ` replace ${replaceBlock}` : ""} 共 ${totalBlocks} 方块 ${totalCmds} 条指令`);
		} else {
			this.client.tellAll(`§cPosition | §fCancel > §i填充已中断`);
		}
	}

	async _execCopy(sender) {
		const minX = Math.min(this.posA.x, this.posB.x);
		const minY = Math.min(this.posA.y, this.posB.y);
		const minZ = Math.min(this.posA.z, this.posB.z);
		const maxX = Math.max(this.posA.x, this.posB.x);
		const maxY = Math.max(this.posA.y, this.posB.y);
		const maxZ = Math.max(this.posA.z, this.posB.z);

		validateY(minY, sender);
		validateY(maxY, sender);

		const totalX = maxX - minX + 1;
		const totalY = maxY - minY + 1;
		const totalZ = maxZ - minZ + 1;
		const totalBlocks = totalX * totalY * totalZ;

		// copy/cut 用于大型结构，区域大小本不应受限制
		// （单次 /structure save 的上限 64×384×64 由下方按区块 + 按 Y 分段保证）

		const xzAreas = computeXZAreas(minX, minZ, maxX, maxZ);
		const structures = [];

		this.job.type = this.job.type || "copy";
		this.job.phase = "复制结构";
		this.job.placed = 0;
		this.job.cmdPlaced = 0;
		this.job.total = xzAreas.length;
		this.job.blockTotal = totalBlocks;

		for (let i = 0; i < xzAreas.length; i++) {
			if (this.job.cancelled) break;

			const area = xzAreas[i];
			const absX1 = area.cx1 * CHUNK_SIZE;
			const absZ1 = area.cz1 * CHUNK_SIZE;
			const absX2 = (area.cx2 + 1) * CHUNK_SIZE - 1;
			const absZ2 = (area.cz2 + 1) * CHUNK_SIZE - 1;

			const fx1 = Math.max(minX, absX1);
			const fz1 = Math.max(minZ, absZ1);
			const fx2 = Math.min(maxX, absX2);
			const fz2 = Math.min(maxZ, absZ2);

			// 每个 Y 分段独立 add/remove tickingarea：
			// 单列 16×16 区块 × 48 格高度(3 区块)，远小于 100 区块上限，任意高度均安全。
			const height = maxY - minY + 1;
			const ySegments = Math.ceil(height / MAX_SEG_HEIGHT);
			for (let seg = 0; seg < ySegments; seg++) {
				if (this.job.cancelled) break;

				const ys = minY + seg * MAX_SEG_HEIGHT;
				const ye = Math.min(ys + MAX_SEG_HEIGHT - 1, maxY);
				const tickName = `copy_${i}_${seg}`;
				try {
					await this.client.runCommand(`/tickingarea add ${fx1} ${ys} ${fz1} ${fx2} ${ye} ${fz2} ${tickName}`);
				} catch (e) {
					this.client.tellAll(`§cPosition | §fError > §i[tickingarea add] ${e.message}`);
				}

				const structName = `Copy_${i}_${seg}`;
				let saveOk = false;
				try {
					const result = await this.client.runCommand(`/structure save ${structName} ${fx1} ${ys} ${fz1} ${fx2} ${ye} ${fz2} true disk`);
					if (result && result.body && result.body.statusCode !== 0) {
						this.client.tellAll(`§cPosition | §fError > §i[structure save] ${structName}: ${result.body.statusMessage}`);
					} else {
						saveOk = true;
					}
				} catch (e) {
					this.client.tellAll(`§cPosition | §fError > §i[structure save] ${structName}: ${e.message}`);
				}

				try {
					await this.client.runCommand(`/tickingarea remove ${tickName}`);
				} catch (e) {
					// ignore
				}

				if (!this.job.cancelled && saveOk) {
					structures.push({
						name: structName,
						saveX: fx1,
						saveY: ys,
						saveZ: fz1,
						sizeX: fx2 - fx1 + 1,
						sizeY: ye - ys + 1,
						sizeZ: fz2 - fz1 + 1,
						offsetX: fx1 - this.posA.x,
						offsetY: ys - this.posA.y,
						offsetZ: fz1 - this.posA.z,
					});
					this.job.cmdPlaced++;
				}
			}

			this.job.placed++;
		}

		if (!this.job.cancelled) {
			this.lastCopyEntry = {
				regionMinX: minX,
				regionMinY: minY,
				regionMaxY: maxY,
				regionMinZ: minZ,
				regionMaxX: maxX,
				regionMaxZ: maxZ,
				structures,
			};
			this.client.tellAll(`§ePosition | §fCopy > §i复制完成 共 ${structures.length} 个结构`);
		} else {
			for (const s of structures) {
				try {
					await this.client.runCommand(`/structure delete ${s.name}`);
				} catch {}
			}
			this.client.tellAll(`§cPosition | §fCancel > §i复制已中断`);
		}
	}

	async _execPaste(sender, origin) {
		if (!this.lastCopyEntry) {
			this.client.tell("§cPosition | §fError > §i没有可粘贴的复制结构，请先使用 $p:copy", sender);
			return;
		}

		const entry = this.lastCopyEntry;

		const totalYPaste = entry.regionMaxY - entry.regionMinY + 1;
		const pasteMinY = origin.y + (entry.structures[0]?.offsetY || 0);
		const pasteMaxY = pasteMinY + totalYPaste - 1;
		if (pasteMinY < Y_MIN || pasteMaxY > Y_MAX) {
			this.client.tell(`§cPosition | §fError > §i粘贴位置 Y 超出范围: ${pasteMinY} ~ ${pasteMaxY} (允许 ${Y_MIN} ~ ${Y_MAX})`, sender);
			return;
		}

		let errorCount = 0;
		const total = entry.structures.length;

		this.job.type = this.job.type || "paste";
		this.job.phase = "粘贴结构";
		this.job.total = total;
		this.job.placed = 0;
		this.job.cmdPlaced = 0;

		for (let i = 0; i < entry.structures.length; i++) {
			if (this.job.cancelled) break;

			const s = entry.structures[i];
			const loadX = origin.x + s.offsetX;
			const loadY = origin.y + s.offsetY;
			const loadZ = origin.z + s.offsetZ;

			const tickX1 = loadX;
			const tickZ1 = loadZ;
			const tickX2 = loadX + (s.sizeX ?? (entry.regionMaxX - entry.regionMinX + 1)) - 1;
			const tickZ2 = loadZ + (s.sizeZ ?? (entry.regionMaxZ - entry.regionMinZ + 1)) - 1;
			const tickY1 = Math.max(loadY, Y_MIN);
			const tickY2 = Math.min(loadY + (s.sizeY ?? (entry.regionMaxY - entry.regionMinY)) - 1, Y_MAX);

			const tickName = `paste_${i}`;
			if (tickY1 <= tickY2) {
				try {
					await this.client.runCommand(`/tickingarea add ${tickX1} ${tickY1} ${tickZ1} ${tickX2} ${tickY2} ${tickZ2} ${tickName}`);
				} catch (e) {
					this.client.tellAll(`§cPosition | §fError > §i[tickingarea add] ${e.message}`);
				}
			}

			try {
				const result = await this.client.runCommand(`/structure load ${s.name} ${loadX} ${loadY} ${loadZ}`);
				if (result && result.body && result.body.statusCode !== 0) {
					this.client.tellAll(`§cPosition | §fError > §i[structure load] ${s.name}: ${result.body.statusMessage}`);
					errorCount++;
				}
			} catch (e) {
				this.client.tellAll(`§cPosition | §fError > §i[structure load] ${s.name}: ${e.message}`);
				errorCount++;
			}

			try {
				await this.client.runCommand(`/tickingarea remove ${tickName}`);
			} catch (e) {
				// ignore
			}

			this.job.placed++;
			this.job.cmdPlaced++;
			await sleep(10);
		}

		if (!this.job.cancelled && errorCount === 0) {
			for (const s of entry.structures) {
				try {
					await this.client.runCommand(`/structure delete ${s.name}`);
				} catch {}
			}
			this.lastCopyEntry = null;
			this.client.tellAll(`§ePosition | §fPaste > §i粘贴完成 共 ${total} 个结构`);
		} else if (!this.job.cancelled) {
			this.client.tellAll(`§cPosition | §fError > §i粘贴完成 失败 ${errorCount} 个结构，请重试`);
		} else {
			this.client.tellAll(`§cPosition | §fCancel > §i粘贴已中断`);
		}
	}

	onDestroy() {
		if (this.job) this.job.cancelled = true;
		this.job = null;
		this.posA = null;
		this.posB = null;
		this.lastCopyEntry = null;
		this.client = null;
	}
}
