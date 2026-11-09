/**
 * wilds.js — 野外散布结构（v4.9 新增）
 * 瞭望塔 / 无名废墟 / 旅人营地 / 独居小屋 / 沙漠方尖碑
 * 初始化时按确定性哈希在 64×64 网格撒点（同一世界永远长在同一位置），
 * 经由 world._setBlockDirect + _recordStructs 记入 structs，区块重载自动重放。
 */

/* 发现列表：game.js 巡检用（靠近 12 格触发发现 toast + relic 成就） */
const WILDS = [];

function placeWilds(world) {
  const n = world.noise;
  const CELL = 64;

  for (let gx = -4; gx <= 4; gx++) {
    for (let gz = -4; gz <= 4; gz++) {
      if (gx === 0 && gz === 0) continue;                    // 出生地/神殿保留区

      // 确定性哈希：是否生成 + 位置抖动 + 类型
      const h1 = Math.abs(n.h(gx * 131 + 7,  gz * 173 + 11));
      const h2 = Math.abs(n.h(gx * 311 + 29, gz * 419 + 3));
      const h3 = Math.abs(n.h(gx * 613 + 17, gz * 907 + 41));
      if (h1 < 0.34) continue;                               // 约 2/3 的格子有结构

      const x = gx * CELL + Math.floor(h2 * 40) - 20;
      const z = gz * CELL + Math.floor(h3 * 40) - 20;

      if (Math.sqrt(x * x + z * z) < 55) continue;           // 离出生地太近
      if (VILLAGES.some(v => Math.hypot(x - v.x, z - v.z) < 45)) continue;

      const biome = world.biomeAt(x, z);
      if (biome === BIOME.OCEAN) continue;

      // 地形检查：取中心+四角高度，起伏过大或贴海面则放弃
      const hs = [[0, 0], [4, 4], [-4, 4], [4, -4], [-4, -4]]
        .map(([dx, dz]) => world._terrainHeight(x + dx, z + dz));
      const hmin = Math.min(...hs), hmax = Math.max(...hs);
      if (hmin < SEA_LEVEL + 1 || hmax > GROUND_Y + 10 || hmax - hmin > 4) continue;

      const base = Math.max(SEA_LEVEL + 2, hs[0]);
      const kind = _pickKind(biome, h2);
      _WILD_BUILDERS[kind].build(world, x, z, base, h3);
      WILDS.push({ x, z, name: _WILD_BUILDERS[kind].name, kind });
    }
  }
}

/* 按群系选类型（沙漠有方尖碑、雪山多瞭望塔，其余混搭） */
function _pickKind(biome, h) {
  const pools = {
    [BIOME.DESERT]: ['obelisk', 'ruin', 'camp'],
    [BIOME.SNOWY]:  ['tower', 'camp', 'ruin'],
    [BIOME.FOREST]: ['hut', 'camp', 'ruin', 'tower'],
    [BIOME.PLAINS]: ['tower', 'hut', 'ruin', 'camp'],
  };
  const pool = pools[biome] || pools[BIOME.PLAINS];
  return pool[Math.floor(h * 997) % pool.length];
}

/* 小地块平整：结构脚下垫实 + 头顶清空 */
function _wildFlatten(world, cx, cz, r, base, surface) {
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r) continue;
      const wx = cx + dx, wz = cz + dz;
      for (let y = Math.max(1, base - 4); y < base - 1; y++)
        world._setBlockDirect(wx, y, wz, BLOCK.DIRT);
      world._setBlockDirect(wx, base - 1, wz, surface);
      for (let y = base; y < base + 10; y++) {
        if (world.getBlock(wx, y, wz) !== BLOCK.AIR)
          world._setBlockDirect(wx, y, wz, BLOCK.AIR);
      }
    }
  }
}

const _WILD_BUILDERS = {

  /* ---- 瞭望塔：3×3 砖塔 + 顶层平台 + 荧光石灯 ---- */
  tower: {
    name: '古老的瞭望塔',
    build(world, x, z, base) {
      _wildFlatten(world, x, z, 4, base, BLOCK.GRAVEL);
      const H = 7;
      for (let y = base; y < base + H; y++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
            if (edge) world._setBlockDirect(x + dx, y, z + dz, BLOCK.BRICK);
          }
        }
      }
      // 门洞（南面 2 高）
      world._setBlockDirect(x, base, z + 1, BLOCK.AIR);
      world._setBlockDirect(x, base + 1, z + 1, BLOCK.AIR);
      // 内部逐层石台阶（能爬上去看风景）
      const steps = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      steps.forEach(([dx, dz], i) => {
        world._setBlockDirect(x + dx, base + i, z + dz, BLOCK.STONE);
      });
      // 顶层平台 + 四角垛口 + 中心灯
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++)
          world._setBlockDirect(x + dx, base + H, z + dz, BLOCK.BRICK);
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]])
        world._setBlockDirect(x + dx, base + H + 1, z + dz, BLOCK.BRICK);
      world._setBlockDirect(x, base + H + 1, z, BLOCK.GLOWSTONE);
    },
  },

  /* ---- 无名废墟：残垣断壁 + 散落碎石 ---- */
  ruin: {
    name: '无名废墟',
    build(world, x, z, base, h) {
      _wildFlatten(world, x, z, 5, base, BLOCK.GRAVEL);
      const W = 7, D = 6;
      const x0 = x - Math.floor(W / 2), z0 = z - Math.floor(D / 2);
      let seed = Math.floor(h * 9973);
      const rnd = () => { seed = (seed * 16807 + 7) % 2147483647; return seed / 2147483647; };
      // 外墙：高度 0~3 随机残缺
      for (let dx = 0; dx < W; dx++) {
        for (let dz = 0; dz < D; dz++) {
          const isEdge = dx === 0 || dx === W - 1 || dz === 0 || dz === D - 1;
          if (!isEdge) continue;
          const hh = Math.floor(rnd() * 4);              // 0=塌完 3=残高
          const mat = rnd() > 0.5 ? BLOCK.STONE : BLOCK.BRICK;
          for (let y = 0; y < hh; y++)
            world._setBlockDirect(x0 + dx, base + y, z0 + dz, mat);
        }
      }
      // 屋内碎石 + 一朵顽强的花
      for (let i = 0; i < 5; i++) {
        const dx = 1 + Math.floor(rnd() * (W - 2)), dz = 1 + Math.floor(rnd() * (D - 2));
        world._setBlockDirect(x0 + dx, base - 1, z0 + dz, BLOCK.STONE);
      }
      world._setBlockDirect(x, base, z, BLOCK.FLOWER);
    },
  },

  /* ---- 旅人营地：篝火 + 原木凳 + 小帐篷 ---- */
  camp: {
    name: '旅人营地',
    build(world, x, z, base) {
      _wildFlatten(world, x, z, 4, base, BLOCK.GRASS);
      // 篝火：荧光石为芯，砾石围圈（夜里是路标）
      world._setBlockDirect(x, base, z, BLOCK.GLOWSTONE);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        world._setBlockDirect(x + dx, base - 1, z + dz, BLOCK.GRAVEL);
      // 原木凳两条
      world._setBlockDirect(x - 2, base, z + 2, BLOCK.WOOD);
      world._setBlockDirect(x - 1, base, z + 2, BLOCK.WOOD);
      world._setBlockDirect(x + 2, base, z - 2, BLOCK.WOOD);
      world._setBlockDirect(x + 2, base, z - 1, BLOCK.WOOD);
      // 小帐篷：两面斜靠的树叶棚（3 宽）
      const tx = x + 3, tz = z + 2;
      for (let d = -1; d <= 1; d++) {
        world._setBlockDirect(tx - 1, base, tz + d, BLOCK.LEAVES);
        world._setBlockDirect(tx + 1, base, tz + d, BLOCK.LEAVES);
        world._setBlockDirect(tx, base + 1, tz + d, BLOCK.LEAVES);
      }
    },
  },

  /* ---- 独居小屋：复用村庄木屋 + 门口灯柱 ---- */
  hut: {
    name: '独居小屋',
    build(world, x, z, base) {
      _wildFlatten(world, x, z, 5, base, BLOCK.GRASS);
      _buildHouse(world, x - 2, base, z - 2, 5, 5, 'S');
      // 门口小灯
      world._setBlockDirect(x, base, z + 4, BLOCK.WOOD);
      world._setBlockDirect(x, base + 1, z + 4, BLOCK.GLOWSTONE);
    },
  },

  /* ---- 沙漠方尖碑：砖砌尖柱 + 青金石镶嵌 ---- */
  obelisk: {
    name: '沙漠方尖碑',
    build(world, x, z, base) {
      _wildFlatten(world, x, z, 4, base, BLOCK.SAND);
      // 3×3 台基两层
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          world._setBlockDirect(x + dx, base, z + dz, BLOCK.BRICK);
          if (dx === 0 || dz === 0)
            world._setBlockDirect(x + dx, base + 1, z + dz, BLOCK.BRICK);
        }
      // 柱身：砖与青金石相间，顶上荧光石
      for (let y = 0; y < 6; y++)
        world._setBlockDirect(x, base + 2 + y, z, y % 2 ? BLOCK.LAPIS : BLOCK.BRICK);
      world._setBlockDirect(x, base + 8, z, BLOCK.GLOWSTONE);
    },
  },
};
