/**
 * world.js — 地形生成 v4
 * 生物群系（草原/森林/沙漠/雪山/海洋）+ 海平面真水体 + MYFLICKER 黄金神殿
 * + 村庄结构 + 玩家修改自动存档（localStorage 差分）
 */

const CHUNK_SIZE   = 16;
const CHUNK_HEIGHT = 96;
const RENDER_DIST  = 5;          // 渲染半径（区块数）
const SEA_LEVEL    = 12;         // 海平面
const GROUND_Y     = 14;         // 出生地平台高度
const SPAWN_RADIUS = 24;         // 中心出生草坪半径
const SAVE_KEY     = 'myflicker-world-v4-edits';

/* ===== 生物群系枚举 ===== */
const BIOME = { OCEAN: 0, PLAINS: 1, FOREST: 2, DESERT: 3, SNOWY: 4 };
const BIOME_NAME = { 0: '海洋', 1: '草原', 2: '森林', 3: '沙漠', 4: '雪山' };

/* ===== 噪声工具 ===== */
class Noise {
  constructor(seed = 1337) { this.s = seed; }

  h(x, z) {
    let v = this.s ^ (x * 374761393) ^ (z * 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return (v ^ (v >>> 16)) / 2147483647;
  }

  lerp(a, b, t) { const u = t * t * (3 - 2 * t); return a * (1 - u) + b * u; }

  get(x, z, sc = 1) {
    const sx = x / sc, sz = z / sc;
    const ix = Math.floor(sx), iz = Math.floor(sz);
    const fx = sx - ix, fz = sz - iz;
    return this.lerp(
      this.lerp(this.h(ix, iz), this.h(ix + 1, iz), fx),
      this.lerp(this.h(ix, iz + 1), this.h(ix + 1, iz + 1), fx),
      fz
    );
  }

  fbm(x, z, oct = 4, sc = 20) {
    let v = 0, a = 1, f = 1, m = 0;
    for (let i = 0; i < oct; i++) {
      v += a * this.get(x * f, z * f, sc);
      m += a; a *= 0.5; f *= 2;
    }
    return v / m;
  }
}

/* ===== MYFLICKER 像素字体 7 行（宽度可变） ===== */
const PIXEL_FONT = {
  M: [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  Y: [[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  F: [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
  L: [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  I: [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
  C: [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
  K: [[1,0,0,0,1],[1,0,0,1,0],[1,0,1,0,0],[1,1,0,0,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  E: [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  R: [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
};

/* ===== 区块 ===== */
class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.meshes = [];
    this.dirty  = true;
  }
  idx(x, y, z) { return x * CHUNK_HEIGHT * CHUNK_SIZE + y * CHUNK_SIZE + z; }
  get(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE)
      return BLOCK.AIR;
    return this.data[this.idx(x, y, z)];
  }
  set(x, y, z, t) {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= CHUNK_SIZE) return;
    this.data[this.idx(x, y, z)] = t;
    this.dirty = true;
  }
}

/* ===== 世界管理器 ===== */
class World {
  constructor(scene) {
    this.scene  = scene;
    this.chunks = new Map();
    this.noise   = new Noise(90210);   // 基础起伏
    this.noiseB  = new Noise(31415);   // 山脉
    this.noiseT  = new Noise(60606);   // 温度（生物群系）
    this.noiseM  = new Noise(77777);   // 湿度（生物群系）
    this.blockGeo = new THREE.BoxGeometry(1, 1, 1);

    /* 玩家修改差分（自动存档） */
    this.edits = this._loadEdits();
    this._saveTimer = null;

    /* 结构方块（神殿/村庄/野外建筑），区块重载时重放。
     * v4.9：按区块索引 Map<chunkKey, Map<posKey,type>>，重放只查本区块，
     * 避免结构变多后每次生成区块都全量遍历几万条目 */
    this.structs = new Map();
    this._recordStructs = false;
  }

  key(cx, cz) { return `${cx},${cz}`; }
  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

  w2c(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return { cx, cz, lx, lz };
  }

  getBlock(wx, wy, wz) {
    const { cx, cz, lx, lz } = this.w2c(wx, wz);
    const ch = this.getChunk(cx, cz);
    return ch ? ch.get(lx, wy, lz) : BLOCK.AIR;
  }

  setBlock(wx, wy, wz, type, recordEdit = true) {
    const { cx, cz, lx, lz } = this.w2c(wx, wz);
    const ch = this.getChunk(cx, cz);
    if (!ch) return;
    ch.set(lx, wy, lz, type);
    if (recordEdit) {
      this.edits.set(`${wx},${wy},${wz}`, type);
      this._scheduleSave();
    }
    this.rebuildChunk(ch);
    if (lx === 0)              { const n = this.getChunk(cx-1,cz); if (n) this.rebuildChunk(n); }
    if (lx === CHUNK_SIZE - 1) { const n = this.getChunk(cx+1,cz); if (n) this.rebuildChunk(n); }
    if (lz === 0)              { const n = this.getChunk(cx,cz-1); if (n) this.rebuildChunk(n); }
    if (lz === CHUNK_SIZE - 1) { const n = this.getChunk(cx,cz+1); if (n) this.rebuildChunk(n); }
  }

  /* ===== 存档 ===== */
  _loadEdits() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return new Map();
      return new Map(Object.entries(JSON.parse(raw)).map(([k, v]) => [k, Number(v)]));
    } catch { return new Map(); }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(Object.fromEntries(this.edits)));
      } catch { /* 存储满则忽略 */ }
    }, 800);
  }

  clearSave() {
    this.edits.clear();
    localStorage.removeItem(SAVE_KEY);
  }

  /* ===== 生物群系判定 ===== */
  biomeAt(wx, wz) {
    const dist = Math.sqrt(wx * wx + wz * wz);
    if (dist < SPAWN_RADIUS + 8) return BIOME.PLAINS;   // 出生地固定草原

    const h = this._rawHeight(wx, wz);
    if (h < SEA_LEVEL - 1) return BIOME.OCEAN;

    const temp  = this.noiseT.fbm(wx, wz, 3, 160);   // 大尺度温度（约 -0.8 ~ 0.5）
    const moist = this.noiseM.fbm(wx, wz, 3, 130);   // 湿度（约 -0.8 ~ 0.6）

    if (temp < -0.26) return BIOME.SNOWY;
    if (temp > 0.12 && moist < 0.02) return BIOME.DESERT;
    if (moist > 0.16) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  /* 原始高度（未平滑出生地） */
  _rawHeight(wx, wz) {
    // 大陆形状：低频噪声决定海陆（范围约 -0.6 ~ 0.6，中位 -0.1）
    const continent = this.noiseT.fbm(wx + 3000, wz + 3000, 3, 220);
    const base = this.noise.fbm(wx, wz, 4, 30) * 9;
    const mountains = Math.pow(Math.max(0, this.noiseB.fbm(wx, wz, 5, 46)), 1.6) * 26;
    // continent < -0.27 的区域下沉为海洋（约占 20%）
    const oceanDip = continent < -0.27 ? (-0.27 - continent) * 60 : 0;
    return GROUND_Y + 2 + base + mountains - oceanDip;
  }

  _terrainHeight(wx, wz) {
    const dist = Math.sqrt(wx * wx + wz * wz);
    if (dist < SPAWN_RADIUS) return GROUND_Y;
    const blend = Math.min(1, (dist - SPAWN_RADIUS) / 22);
    const h = this._rawHeight(wx, wz);
    return Math.round(GROUND_Y + (h - GROUND_Y) * blend);
  }

  /* ===== 区块生成 ===== */
  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const n = this.noise;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = cx * CHUNK_SIZE + lx;
        const wz = cz * CHUNK_SIZE + lz;
        const dist = Math.sqrt(wx * wx + wz * wz);
        const h = Math.max(3, this._terrainHeight(wx, wz));
        const biome = this.biomeAt(wx, wz);

        // 基岩~石头
        for (let y = 0; y < h - 4; y++) chunk.set(lx, y, lz, BLOCK.STONE);
        for (let y = Math.max(0, h - 4); y < h - 1; y++)
          chunk.set(lx, y, lz, biome === BIOME.DESERT ? BLOCK.SAND : BLOCK.DIRT);

        // 表层按生物群系
        let surface = BLOCK.GRASS;
        switch (biome) {
          case BIOME.DESERT: surface = BLOCK.SAND; break;
          case BIOME.SNOWY:  surface = h > GROUND_Y + 16 ? BLOCK.SNOW : (h > GROUND_Y + 8 ? BLOCK.STONE : BLOCK.SNOW); break;
          case BIOME.OCEAN:  surface = h >= SEA_LEVEL - 1 ? BLOCK.SAND : BLOCK.GRAVEL; break;
          default:
            if (h > GROUND_Y + 18) surface = BLOCK.SNOW;         // 高山雪线
            else if (h > GROUND_Y + 11) surface = BLOCK.STONE;   // 山腰裸石
            else if (h <= SEA_LEVEL + 1 && dist > SPAWN_RADIUS) surface = BLOCK.SAND;  // 海滩
        }
        chunk.set(lx, h - 1, lz, surface);

        // 海平面填水（雪山群系湖面结冰）
        if (h - 1 < SEA_LEVEL) {
          for (let y = h; y <= SEA_LEVEL; y++) {
            const isTop = y === SEA_LEVEL;
            chunk.set(lx, y, lz, (isTop && biome === BIOME.SNOWY) ? BLOCK.ICE : BLOCK.WATER);
          }
        }

        // ===== 植被 =====
        const veg = n.get(wx + 1000, wz + 1000, 1);
        const onLand = h - 1 >= SEA_LEVEL && chunk.get(lx, h - 1, lz) !== BLOCK.WATER;

        if (onLand && dist > SPAWN_RADIUS + 4) {
          if (biome === BIOME.FOREST && veg > 0.76 && surface === BLOCK.GRASS) {
            this._placeTree(chunk, lx, h, lz, veg);
          } else if (biome === BIOME.PLAINS && veg > 0.90 && surface === BLOCK.GRASS) {
            this._placeTree(chunk, lx, h, lz, veg);
          } else if (biome === BIOME.DESERT && veg > 0.945 && surface === BLOCK.SAND) {
            const ch2 = 2 + Math.floor(n.get(wx, wz, 3) * 3);
            for (let y = h; y < h + ch2; y++) chunk.set(lx, y, lz, BLOCK.CACTUS);
          } else if (biome === BIOME.PLAINS && veg > 0.875 && surface === BLOCK.GRASS) {
            chunk.set(lx, h, lz, BLOCK.LEAVES);   // 灌木丛（v4.9 草原点缀）
          } else if (biome === BIOME.PLAINS && veg > 0.80 && surface === BLOCK.GRASS) {
            chunk.set(lx, h, lz, BLOCK.FLOWER);
          } else if (biome === BIOME.FOREST && veg > 0.70 && surface === BLOCK.GRASS) {
            chunk.set(lx, h, lz, BLOCK.FLOWER);   // 林间花（v4.9：原花带全被树吃掉）
          }
          // 荧光石：夜路点缀
          if (n.get(wx + 2000, wz + 2000, 1) > 0.982) {
            chunk.set(lx, h, lz, BLOCK.GLOWSTONE);
          }
        }
      }
    }

    this.chunks.set(this.key(cx, cz), chunk);
    const st = this.structs.get(this.key(cx, cz));
    if (st) this._applyMap(chunk, st);
    this._applyMap(chunk, this.edits);
    return chunk;
  }

  /* 把差分 Map（结构/存档）套用到新生成区块 */
  _applyMap(chunk, map) {
    if (!map || map.size === 0) return;
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;
    for (const [k, type] of map) {
      const [wx, wy, wz] = k.split(',').map(Number);
      if (wx >= x0 && wx < x0 + CHUNK_SIZE && wz >= z0 && wz < z0 + CHUNK_SIZE) {
        chunk.set(wx - x0, wy, wz - z0, type);
      }
    }
  }

  _placeTree(chunk, lx, baseY, lz, seed) {
    const trunkH = 4 + Math.floor(seed * 10) % 3;
    for (let y = baseY; y < baseY + trunkH; y++) chunk.set(lx, y, lz, BLOCK.WOOD);
    const ty = baseY + trunkH;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) <= 3) {
            const nx = lx + dx, nz = lz + dz, ny = ty + dy;
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE)
              if (chunk.get(nx, ny, nz) === BLOCK.AIR)
                chunk.set(nx, ny, nz, BLOCK.LEAVES);
          }
        }
      }
    }
    chunk.set(lx, ty + 2, lz, BLOCK.LEAVES);
  }

  /* ===== MYFLICKER 黄金神殿（v4：9 字母字墙 + 立柱 + 青金石台基） ===== */
  placeCozeMonument() {
    const letters  = ['M', 'Y', 'F', 'L', 'I', 'C', 'K', 'E', 'R'];
    const wallZ    = -16;
    const baseY    = GROUND_Y;
    const GAP = 1;
    const widths = letters.map(l => PIXEL_FONT[l][0].length);
    const totalW = widths.reduce((a, b) => a + b, 0) + (letters.length - 1) * GAP;
    const startX = -Math.floor(totalW / 2);

    // 青金石+金砖棋盘台基（顺带找平：台基下方填土到地形）
    for (let wx = startX - 4; wx <= startX + totalW + 3; wx++) {
      for (let wz = wallZ - 2; wz <= wallZ + 5; wz++) {
        const checker = ((wx + wz) % 2 + 2) % 2 === 0;
        this._setBlockDirect(wx, baseY - 1, wz, checker ? BLOCK.LAPIS : BLOCK.COZE);
        for (let y = baseY - 4; y < baseY - 1; y++) {
          if (this.getBlock(wx, y, wz) === BLOCK.AIR || this.getBlock(wx, y, wz) === BLOCK.WATER)
            this._setBlockDirect(wx, y, wz, BLOCK.DIRT);
        }
        // 台基以上清空，避免地形穿模
        for (let y = baseY; y < baseY + 13; y++) {
          const t = this.getBlock(wx, y, wz);
          if (t !== BLOCK.AIR) this._setBlockDirect(wx, y, wz, BLOCK.AIR);
        }
      }
    }

    // 字墙（双层厚度）
    let cursor = startX;
    letters.forEach((letter, li) => {
      const bitmap = PIXEL_FONT[letter];
      const ox = cursor;
      cursor += widths[li] + GAP;
      bitmap.forEach((row, ry) => {
        row.forEach((pix, rx) => {
          if (!pix) return;
          const wx = ox + rx;
          const wy = baseY + 2 + (bitmap.length - 1 - ry);
          this._setBlockDirect(wx, wy, wallZ, BLOCK.COZE);
          this._setBlockDirect(wx, wy, wallZ + 1, BLOCK.COZE);
        });
      });
    });

    // 两侧立柱 + 荧光石顶灯
    for (const px of [startX - 4, startX + totalW + 3]) {
      for (let y = baseY; y < baseY + 11; y++) this._setBlockDirect(px, y, wallZ, BLOCK.BRICK);
      this._setBlockDirect(px, baseY + 11, wallZ, BLOCK.GLOWSTONE);
    }

    // 底梁
    for (let wx = startX - 1; wx < startX + totalW + 1; wx++) {
      this._setBlockDirect(wx, baseY, wallZ, BLOCK.COZE);
      this._setBlockDirect(wx, baseY, wallZ + 1, BLOCK.COZE);
      this._setBlockDirect(wx, baseY + 1, wallZ, BLOCK.COZE);
      this._setBlockDirect(wx, baseY + 1, wallZ + 1, BLOCK.COZE);
    }
  }

  _setBlockDirect(wx, wy, wz, type) {
    const { cx, cz, lx, lz } = this.w2c(wx, wz);
    let ch = this.getChunk(cx, cz);
    if (!ch) ch = this.generateChunk(cx, cz);
    ch.set(lx, wy, lz, type);
    if (this._recordStructs) {
      const key = this.key(cx, cz);
      let m = this.structs.get(key);
      if (!m) { m = new Map(); this.structs.set(key, m); }
      m.set(`${wx},${wy},${wz}`, type);
    }
  }

  /* ===== Mesh 构建（面剔除 + InstancedMesh） ===== */
  rebuildChunk(chunk) {
    for (const m of chunk.meshes) {
      this.scene.remove(m);
      // 释放 instanceMatrix 等 GPU 缓冲（geometry/material 是共享缓存，不能 dispose）
      m.dispose();
    }
    chunk.meshes = [];

    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const groups = {};

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const type = chunk.get(lx, y, lz);
          if (type === BLOCK.AIR) continue;
          if (!this._exposed(chunk, lx, y, lz, ox + lx, oz + lz)) continue;
          (groups[type] = groups[type] || []).push({ lx, y, lz });
        }
      }
    }

    const dummy = new THREE.Object3D();
    for (const [ts, poses] of Object.entries(groups)) {
      const type = Number(ts);
      const mats = getBlockMaterials(type);
      const im = new THREE.InstancedMesh(this.blockGeo, mats, poses.length);
      const isWater = type === BLOCK.WATER;
      im.castShadow = im.receiveShadow = !isWater && type !== BLOCK.FLOWER;
      if (isWater) im.renderOrder = 2;
      poses.forEach((p, i) => {
        // BoxGeometry(1,1,1) 中心在原点；方块逻辑坐标 (wx,wy,wz) 代表方块的"角"，
        // 即占据 [wx, wx+1) × [wy, wy+1) × [wz, wz+1) 的空间，
        // 故渲染中心必须 +0.5，与高亮框、射线碰撞的坐标系保持一致
        dummy.position.set(ox + p.lx + 0.5, p.y + 0.5, oz + p.lz + 0.5);
        // 花缩小一点更自然
        if (type === BLOCK.FLOWER) dummy.scale.set(0.6, 0.85, 0.6);
        else if (type === BLOCK.CACTUS) dummy.scale.set(0.82, 1, 0.82);
        else dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.userData.blockType = type;
      this.scene.add(im);
      chunk.meshes.push(im);
    }
    chunk.dirty = false;
  }

  _exposed(chunk, lx, y, lz, wx, wz) {
    const self = chunk.get(lx, y, lz);
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const nx = lx + dx, ny = y + dy, nz = lz + dz;
      let nb;
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE)
        nb = this.getBlock(wx + dx, ny, wz + dz);
      else
        nb = chunk.get(nx, ny, nz);
      if (nb === BLOCK.AIR) return true;
      // 水面之下的水不需要画；水与非水交界要画
      if (BLOCK_META[nb]?.transparent && nb !== self) return true;
    }
    return false;
  }

  /* ===== 区块动态加载/卸载 ===== */
  updateChunks(px, pz) {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);

    // 每帧最多补 N 个区块，避免卡顿；飞行时提速跟上移动（否则地面破洞）
    let budget = window.gamePhysics?.flying ? 4 : 2;
    for (let r = 0; r <= RENDER_DIST && budget > 0; r++) {
      for (let dx = -r; dx <= r && budget > 0; dx++) {
        for (let dz = -r; dz <= r && budget > 0; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = pcx + dx, cz = pcz + dz;
          if (!this.getChunk(cx, cz)) {
            const ch = this.generateChunk(cx, cz);
            this.rebuildChunk(ch);
            budget--;
          }
        }
      }
    }

    for (const [key, ch] of this.chunks) {
      const ddx = ch.cx - pcx, ddz = ch.cz - pcz;
      if (Math.abs(ddx) > RENDER_DIST + 1 || Math.abs(ddz) > RENDER_DIST + 1) {
        for (const m of ch.meshes) {
          this.scene.remove(m);
          m.dispose();   // 释放 instanceMatrix GPU 缓冲，长时间游玩不泄漏显存
        }
        this.chunks.delete(key);
      }
    }
  }

  /* ===== 初始化 ===== */
  init() {
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        this.generateChunk(cx, cz);
      }
    }
    this._recordStructs = true;
    this.placeCozeMonument();
    placeVillages(this);
    if (typeof placeWilds === 'function') placeWilds(this);   // v4.9 野外散布结构
    this._recordStructs = false;

    // 只给出生地 7×7 建 Mesh；远处结构自动生成的区块直接丢弃
    // （方块已录入 structs，玩家走近时 generateChunk 重放，省掉初始化建几百个临时 Mesh）
    for (const [key, ch] of this.chunks) {
      if (Math.abs(ch.cx) <= 3 && Math.abs(ch.cz) <= 3) this.rebuildChunk(ch);
      else this.chunks.delete(key);   // 尚未建 Mesh，直接移除即可
    }
  }
}
