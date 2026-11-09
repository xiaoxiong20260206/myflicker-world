/**
 * village.js — 程序化村庄（v4 新增）
 * 平整地基 + 木屋 + 水井 + 农田 + 路灯 + 砾石小路
 * 村民实体由 entities.js 负责生成
 */

const VILLAGES = [
  { x: 52,   z: 18,   name: '禾风村', r: 16 },
  { x: -64,  z: -38,  name: '晨露村', r: 15 },
  { x: 23,   z: -87,  name: '雪岭村', r: 15 },   // 雪山群系（v4.9 新增，坐标经噪声复算选平地）
  { x: 104,  z: -60,  name: '枫溪村', r: 15 },   // 森林群系
  { x: -47,  z: 174,  name: '落霞村', r: 14 },   // 森林群系
  { x: -148, z: 148,  name: '远岚村', r: 14 },   // 远方草原
];

function placeVillages(world) {
  for (const v of VILLAGES) {
    // 村庄地基高度：取中心地形高度，且必须高于海面
    let base = Math.max(SEA_LEVEL + 2, world._terrainHeight(v.x, v.z));
    base = Math.min(base, GROUND_Y + 8);   // 不要建在高山上
    v.y = base;
    _flattenPlot(world, v.x, v.z, v.r, base, _surfaceFor(world, v.x, v.z));
    _buildVillage(world, v, base);
  }
}

/* 地块表层按群系：雪山铺雪、沙漠铺沙、其余草地 */
function _surfaceFor(world, x, z) {
  const b = world.biomeAt(x, z);
  if (b === BIOME.SNOWY)  return BLOCK.SNOW;
  if (b === BIOME.DESERT) return BLOCK.SAND;
  return BLOCK.GRASS;
}

/* 平整圆形地块：下填土、上清空、表层按群系 */
function _flattenPlot(world, cx, cz, r, base, surface = BLOCK.GRASS) {
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r) continue;
      const wx = cx + dx, wz = cz + dz;
      for (let y = Math.max(1, base - 6); y < base - 1; y++)
        world._setBlockDirect(wx, y, wz, BLOCK.DIRT);
      world._setBlockDirect(wx, base - 1, wz, surface);
      for (let y = base; y < base + 14; y++) {
        if (world.getBlock(wx, y, wz) !== BLOCK.AIR)
          world._setBlockDirect(wx, y, wz, BLOCK.AIR);
      }
    }
  }
}

function _buildVillage(world, v, base) {
  const { x: cx, z: cz } = v;

  /* ---- 中央水井 ---- */
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const wx = cx + dx, wz = cz + dz;
      if (dx === 0 && dz === 0) {
        world._setBlockDirect(wx, base - 1, wz, BLOCK.WATER);
        world._setBlockDirect(wx, base - 2, wz, BLOCK.WATER);
      } else {
        world._setBlockDirect(wx, base, wz, BLOCK.BRICK);
      }
    }
  }
  // 井架
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    world._setBlockDirect(cx + dx, base + 1, cz + dz, BLOCK.WOOD);
    world._setBlockDirect(cx + dx, base + 2, cz + dz, BLOCK.WOOD);
  }
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      world._setBlockDirect(cx + dx, base + 3, cz + dz, BLOCK.BRICK);

  /* ---- 四间木屋 ---- */
  const houses = [
    { ox: -11, oz: -9, w: 6, d: 5, face: 'E' },
    { ox: 6,   oz: -10, w: 5, d: 6, face: 'W' },
    { ox: -10, oz: 6,  w: 5, d: 5, face: 'N' },
    { ox: 6,   oz: 6,  w: 6, d: 5, face: 'W' },
  ];
  for (const h of houses) _buildHouse(world, cx + h.ox, base, cz + h.oz, h.w, h.d, h.face);

  /* ---- 农田（东南角） ---- */
  const fx = cx - 2, fz = cz + 9;
  for (let dx = 0; dx < 7; dx++) {
    for (let dz = 0; dz < 4; dz++) {
      const wx = fx + dx, wz = fz + dz;
      if (dx === 3) {
        world._setBlockDirect(wx, base - 1, wz, BLOCK.WATER);   // 灌溉水渠
      } else {
        world._setBlockDirect(wx, base - 1, wz, BLOCK.DIRT);
        if ((dx + dz) % 2 === 0) world._setBlockDirect(wx, base, wz, BLOCK.FLOWER);
      }
    }
  }

  /* ---- 十字砾石路 ---- */
  for (let d = -13; d <= 13; d++) {
    if (Math.abs(d) > 2) {
      world._setBlockDirect(cx + d, base - 1, cz, BLOCK.GRAVEL);
      world._setBlockDirect(cx, base - 1, cz + d, BLOCK.GRAVEL);
    }
  }

  /* ---- 四角路灯 ---- */
  for (const [dx, dz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
    const wx = cx + dx, wz = cz + dz;
    for (let y = base; y < base + 3; y++) world._setBlockDirect(wx, y, wz, BLOCK.WOOD);
    world._setBlockDirect(wx, base + 3, wz, BLOCK.GLOWSTONE);
  }
}

/* 单间木屋：木墙 + 砖顶 + 门洞 + 窗 + 室内灯 */
function _buildHouse(world, x0, base, z0, w, d, face) {
  const wallH = 3;

  // 木地板
  for (let dx = 0; dx < w; dx++)
    for (let dz = 0; dz < d; dz++)
      world._setBlockDirect(x0 + dx, base - 1, z0 + dz, BLOCK.WOOD);

  // 四面墙
  for (let y = base; y < base + wallH; y++) {
    for (let dx = 0; dx < w; dx++) {
      world._setBlockDirect(x0 + dx, y, z0, BLOCK.WOOD);
      world._setBlockDirect(x0 + dx, y, z0 + d - 1, BLOCK.WOOD);
    }
    for (let dz = 0; dz < d; dz++) {
      world._setBlockDirect(x0, y, z0 + dz, BLOCK.WOOD);
      world._setBlockDirect(x0 + w - 1, y, z0 + dz, BLOCK.WOOD);
    }
  }

  // 门洞（2 高）
  const mx = x0 + Math.floor(w / 2), mz = z0 + Math.floor(d / 2);
  const door = { E: [x0 + w - 1, mz], W: [x0, mz], N: [mx, z0], S: [mx, z0 + d - 1] }[face];
  world._setBlockDirect(door[0], base, door[1], BLOCK.AIR);
  world._setBlockDirect(door[0], base + 1, door[1], BLOCK.AIR);

  // 窗（冰块当玻璃）
  if (face === 'E' || face === 'W') {
    world._setBlockDirect(mx, base + 1, z0, BLOCK.ICE);
    world._setBlockDirect(mx, base + 1, z0 + d - 1, BLOCK.ICE);
  } else {
    world._setBlockDirect(x0, base + 1, mz, BLOCK.ICE);
    world._setBlockDirect(x0 + w - 1, base + 1, mz, BLOCK.ICE);
  }

  // 金字塔砖顶
  let layer = 0;
  while (true) {
    const rx0 = x0 - 1 + layer, rz0 = z0 - 1 + layer;
    const rx1 = x0 + w + 1 - 1 - layer, rz1 = z0 + d + 1 - 1 - layer;
    if (rx0 > rx1 || rz0 > rz1) break;
    for (let dx = rx0; dx <= rx1; dx++)
      for (let dz = rz0; dz <= rz1; dz++) {
        // 只铺环边 + 最内层封顶
        const isEdge = dx === rx0 || dx === rx1 || dz === rz0 || dz === rz1;
        const isLast = rx1 - rx0 <= 1 || rz1 - rz0 <= 1;
        if (isEdge || isLast) world._setBlockDirect(dx, base + wallH + layer, dz, BLOCK.BRICK);
      }
    layer++;
    if (layer > 4) break;
  }

  // 室内吊灯
  world._setBlockDirect(mx, base + wallH - 1, mz, BLOCK.GLOWSTONE);
}
