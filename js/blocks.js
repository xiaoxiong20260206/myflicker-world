/**
 * blocks.js — 方块类型 & 程序化纹理
 * v3：新增冰、仙人掌、花、火把石、青金石、真水方块；纹理全面翻新
 */

/* ===== 方块枚举 ===== */
const BLOCK = {
  AIR:       0,
  GRASS:     1,
  DIRT:      2,
  STONE:     3,
  SAND:      4,
  WOOD:      5,
  LEAVES:    6,
  COZE:      7,   // 金色 COZE 文字砖
  GRAVEL:    8,
  SNOW:      9,
  WATER:     10,  // v3：真·可游泳水体
  GLOWSTONE: 11,
  ICE:       12,  // 冰（雪原湖面）
  CACTUS:    13,  // 仙人掌（沙漠）
  FLOWER:    14,  // 花（草原点缀，十字面片近似：仍用方块但透明）
  LAPIS:     15,  // 青金石（装饰蓝砖）
  BRICK:     16,  // 红砖
};

const BLOCK_META = {
  [BLOCK.GRASS]:     { name: '草地',   transparent: false, solid: true  },
  [BLOCK.DIRT]:      { name: '泥土',   transparent: false, solid: true  },
  [BLOCK.STONE]:     { name: '石头',   transparent: false, solid: true  },
  [BLOCK.SAND]:      { name: '沙子',   transparent: false, solid: true  },
  [BLOCK.WOOD]:      { name: '木头',   transparent: false, solid: true  },
  [BLOCK.LEAVES]:    { name: '树叶',   transparent: true,  solid: true  },
  [BLOCK.COZE]:      { name: 'COZE砖', transparent: false, solid: true  },
  [BLOCK.GRAVEL]:    { name: '砾石',   transparent: false, solid: true  },
  [BLOCK.SNOW]:      { name: '雪',     transparent: false, solid: true  },
  [BLOCK.WATER]:     { name: '水',     transparent: true,  solid: false }, // 不碰撞 → 可游泳
  [BLOCK.GLOWSTONE]: { name: '荧光石', transparent: false, solid: true  },
  [BLOCK.ICE]:       { name: '冰',     transparent: true,  solid: true  },
  [BLOCK.CACTUS]:    { name: '仙人掌', transparent: true,  solid: true  },
  [BLOCK.FLOWER]:    { name: '花',     transparent: true,  solid: false },
  [BLOCK.LAPIS]:     { name: '青金石', transparent: false, solid: true  },
  [BLOCK.BRICK]:     { name: '红砖',   transparent: false, solid: true  },
};

/* 物品栏可放置列表（10 格） */
const PLACEABLE_BLOCKS = [
  BLOCK.GRASS, BLOCK.STONE, BLOCK.SAND, BLOCK.WOOD, BLOCK.LEAVES,
  BLOCK.COZE, BLOCK.GLOWSTONE, BLOCK.ICE, BLOCK.LAPIS, BLOCK.BRICK,
];

/* ===== 纹理生成工具 ===== */

function makePixelTexture(drawFn, size = 16) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function px(ctx, x, y, r, g, b, a = 1) {
  ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
  ctx.fillRect(x, y, 1, 1);
}

function noise2(x, y, s) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.9) * 43758.5453;
  return n - Math.floor(n);
}

function noisy(ctx, s, r, g, b, amp = 22, seed = 0) {
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = (noise2(x, y, seed) - 0.5) * amp * 2;
      px(ctx, x, y,
        Math.max(0, Math.min(255, r + d)),
        Math.max(0, Math.min(255, g + d)),
        Math.max(0, Math.min(255, b + d)),
      );
    }
  }
}

/* ===== 各方块纹理 ===== */
const TEXTURES = {};

function buildTextures() {
  const s = 16;

  /* —— GRASS top —— */
  TEXTURES.grassTop = makePixelTexture((ctx) => {
    noisy(ctx, s, 82, 158, 58, 26, 1);
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(noise2(i, 0, 11) * s);
      const y = Math.floor(noise2(i, 1, 22) * s);
      ctx.fillStyle = 'rgba(110,190,60,0.6)';
      ctx.fillRect(x, y, 2, 1);
    }
  });

  /* —— GRASS side —— */
  TEXTURES.grassSide = makePixelTexture((ctx) => {
    noisy(ctx, s, 130, 92, 56, 20, 2);
    for (let x = 0; x < s; x++) {
      const h = 2 + Math.floor(noise2(x, 0, 5) * 3);
      const d = (noise2(x, 1, 6) - 0.5) * 26;
      ctx.fillStyle = `rgba(${Math.round(82+d)},${Math.round(158+d)},${Math.round(58+d)},1)`;
      ctx.fillRect(x, 0, 1, h);
    }
  });

  /* —— DIRT —— */
  TEXTURES.dirt = makePixelTexture((ctx) => {
    noisy(ctx, s, 134, 92, 56, 24, 3);
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(noise2(i, 2, 8) * s);
      const y = Math.floor(noise2(i, 3, 9) * s);
      ctx.fillStyle = 'rgba(92,64,40,0.45)';
      ctx.fillRect(x, y, 2, 2);
    }
  });

  /* —— STONE —— */
  TEXTURES.stone = makePixelTexture((ctx) => {
    noisy(ctx, s, 118, 118, 124, 18, 4);
    ctx.strokeStyle = 'rgba(70,70,78,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(3, 0); ctx.lineTo(5, s);
    ctx.moveTo(0, 7); ctx.lineTo(s, 9);
    ctx.moveTo(10, 0); ctx.lineTo(11, s / 2);
    ctx.stroke();
  });

  /* —— SAND —— */
  TEXTURES.sand = makePixelTexture((ctx) => {
    noisy(ctx, s, 224, 202, 140, 18, 5);
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(noise2(i, 4, 13) * s);
      const y = Math.floor(noise2(i, 5, 14) * s);
      ctx.fillStyle = 'rgba(176,152,94,0.35)';
      ctx.fillRect(x, y, 1, 1);
    }
    // 波纹
    ctx.strokeStyle = 'rgba(190,165,105,0.3)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 3 + i * 5);
      ctx.quadraticCurveTo(s / 2, 1 + i * 5, s, 3 + i * 5);
      ctx.stroke();
    }
  });

  /* —— WOOD side —— */
  TEXTURES.woodSide = makePixelTexture((ctx) => {
    noisy(ctx, s, 98, 68, 40, 12, 6);
    for (let x = 1; x < s; x += 3) {
      ctx.fillStyle = `rgba(60,40,22,${0.14 + noise2(x, 0, 7) * 0.18})`;
      ctx.fillRect(x, 0, 1, s);
    }
  });

  /* —— WOOD top —— */
  TEXTURES.woodTop = makePixelTexture((ctx) => {
    noisy(ctx, s, 178, 132, 72, 16, 8);
    for (let r = 1; r <= 6; r++) {
      ctx.strokeStyle = `rgba(112,74,36,${0.12 + r * 0.04})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, r * 1.15, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  /* —— LEAVES —— */
  TEXTURES.leaves = makePixelTexture((ctx) => {
    ctx.clearRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (noise2(x, y, 9) > 0.14) {
          const d = (noise2(x + 0.1, y + 0.1, 10) - 0.5) * 36;
          ctx.fillStyle = `rgba(${Math.round(46 + d)},${Math.round(160 + d)},${Math.round(48 + d)},0.93)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  });

  /* —— COZE 金砖 —— */
  TEXTURES.coze = makePixelTexture((ctx) => {
    noisy(ctx, s, 216, 172, 46, 18, 11);
    ctx.fillStyle = 'rgba(122,86,14,0.55)';
    for (let y = 4; y < s; y += 4) ctx.fillRect(0, y, s, 1);
    for (let y = 0; y < s; y += 8)
      for (let x = 0; x < s; x += 8) ctx.fillRect(x, y, 1, 4);
    for (let y = 4; y < s; y += 8)
      for (let x = 4; x < s; x += 8) ctx.fillRect(x, y, 1, 4);
    ctx.fillStyle = 'rgba(255,232,128,0.4)';
    ctx.fillRect(1, 1, s - 2, 1);
    ctx.fillRect(1, 1, 1, 3);
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, 'rgba(255,244,150,0.18)');
    grad.addColorStop(1, 'rgba(180,120,10,0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });

  /* —— GRAVEL —— */
  TEXTURES.gravel = makePixelTexture((ctx) => {
    noisy(ctx, s, 150, 142, 132, 24, 12);
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(noise2(i, 6, 15) * s);
      const y = Math.floor(noise2(i, 7, 16) * s);
      const r = 1 + Math.floor(noise2(i, 8, 17) * 2);
      ctx.fillStyle = 'rgba(102,96,86,0.5)';
      ctx.fillRect(x, y, r, r);
    }
  });

  /* —— SNOW —— */
  TEXTURES.snow = makePixelTexture((ctx) => {
    noisy(ctx, s, 240, 244, 250, 10, 13);
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(noise2(i, 9, 18) * s);
      const y = Math.floor(noise2(i, 10, 19) * s);
      ctx.fillStyle = 'rgba(205,215,235,0.4)';
      ctx.fillRect(x, y, 2, 1);
    }
  });

  /* —— SNOW side —— */
  TEXTURES.snowSide = makePixelTexture((ctx) => {
    noisy(ctx, s, 132, 90, 54, 22, 14);
    for (let x = 0; x < s; x++) {
      const h = 2 + Math.floor(noise2(x, 0, 15) * 3);
      ctx.fillStyle = `rgba(238,242,250,${0.85 + noise2(x, 1, 16) * 0.15})`;
      ctx.fillRect(x, 0, 1, h);
    }
  });

  /* —— WATER —— */
  TEXTURES.water = makePixelTexture((ctx) => {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const w = noise2(x, y, 20);
        ctx.fillStyle = `rgba(${Math.round(24 + w * 18)},${Math.round(96 + w * 30)},${Math.round(198 + w * 34)},0.72)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.strokeStyle = 'rgba(170,225,255,0.4)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 5, s * 0.3 + i * 1.5);
      ctx.quadraticCurveTo(s * 0.5, s * 0.2, s, s * 0.35 + i * 1.5);
      ctx.stroke();
    }
  });

  /* —— GLOWSTONE —— */
  TEXTURES.glowstone = makePixelTexture((ctx) => {
    noisy(ctx, s, 252, 214, 104, 20, 21);
    const grad = ctx.createRadialGradient(s/2, s/2, 1, s/2, s/2, s * 0.7);
    grad.addColorStop(0, 'rgba(255,255,205,0.55)');
    grad.addColorStop(1, 'rgba(224,144,32,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(162,92,12,0.45)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, s/2); ctx.lineTo(s, s/2);
    ctx.moveTo(s/2, 0); ctx.lineTo(s/2, s);
    ctx.moveTo(0, 0); ctx.lineTo(s, s);
    ctx.stroke();
  });

  /* —— ICE —— */
  TEXTURES.ice = makePixelTexture((ctx) => {
    noisy(ctx, s, 165, 210, 245, 14, 30);
    // 裂纹
    ctx.strokeStyle = 'rgba(230,248,255,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(2, 1); ctx.lineTo(7, 6); ctx.lineTo(5, 12);
    ctx.moveTo(11, 2); ctx.lineTo(9, 8); ctx.lineTo(14, 13);
    ctx.stroke();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(1, 1, 5, 2);
  });

  /* —— CACTUS side —— */
  TEXTURES.cactusSide = makePixelTexture((ctx) => {
    noisy(ctx, s, 58, 132, 52, 16, 31);
    // 纵向棱线
    for (let x = 2; x < s; x += 4) {
      ctx.fillStyle = 'rgba(30,90,32,0.55)';
      ctx.fillRect(x, 0, 1, s);
      ctx.fillStyle = 'rgba(120,190,110,0.4)';
      ctx.fillRect(x + 1, 0, 1, s);
    }
    // 刺
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(noise2(i, 11, 32) * s);
      const y = Math.floor(noise2(i, 12, 33) * s);
      ctx.fillStyle = 'rgba(235,245,220,0.8)';
      ctx.fillRect(x, y, 1, 1);
    }
  });

  /* —— CACTUS top —— */
  TEXTURES.cactusTop = makePixelTexture((ctx) => {
    noisy(ctx, s, 70, 148, 62, 14, 34);
    ctx.strokeStyle = 'rgba(30,90,32,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 2, s - 4, s - 4);
  });

  /* —— FLOWER（透明面片风格） —— */
  TEXTURES.flower = makePixelTexture((ctx) => {
    ctx.clearRect(0, 0, s, s);
    // 茎
    ctx.fillStyle = 'rgba(50,140,50,0.95)';
    ctx.fillRect(7, 8, 2, 8);
    ctx.fillRect(5, 11, 2, 1);
    // 花瓣
    const petals = [[7,3],[5,5],[9,5],[7,7],[6,4],[8,4],[6,6],[8,6]];
    ctx.fillStyle = 'rgba(255,120,150,0.95)';
    petals.forEach(([x, y]) => ctx.fillRect(x, y, 2, 2));
    // 花心
    ctx.fillStyle = 'rgba(255,225,90,1)';
    ctx.fillRect(7, 5, 2, 2);
  });

  /* —— LAPIS —— */
  TEXTURES.lapis = makePixelTexture((ctx) => {
    noisy(ctx, s, 38, 78, 190, 24, 40);
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(noise2(i, 13, 41) * s);
      const y = Math.floor(noise2(i, 14, 42) * s);
      ctx.fillStyle = 'rgba(120,170,255,0.55)';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = 'rgba(20,40,110,0.5)';
    ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, s - 1, s, 1);
  });

  /* —— BRICK —— */
  TEXTURES.brick = makePixelTexture((ctx) => {
    noisy(ctx, s, 168, 74, 60, 14, 43);
    ctx.fillStyle = 'rgba(214,200,190,0.85)';
    for (let y = 0; y < s; y += 4) ctx.fillRect(0, y, s, 1);
    for (let y = 0; y < s; y += 8)
      for (let x = 0; x < s; x += 8) ctx.fillRect(x, y, 1, 4);
    for (let y = 4; y < s; y += 8)
      for (let x = 4; x < s; x += 8) ctx.fillRect(x, y, 1, 4);
  });
}

/* ===== 材质缓存 ===== */
const MATERIALS_CACHE = {};

function getBlockMaterials(blockType) {
  if (MATERIALS_CACHE[blockType]) return MATERIALS_CACHE[blockType];

  const make = (tex, opts = {}) => new THREE.MeshLambertMaterial({
    map: tex,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? (opts.transparent ? 0.4 : 0),
    side: opts.transparent ? THREE.DoubleSide : THREE.FrontSide,
  });

  let m;
  switch (blockType) {
    case BLOCK.GRASS:
      m = [
        make(TEXTURES.grassSide), make(TEXTURES.grassSide),
        make(TEXTURES.grassTop),  make(TEXTURES.dirt),
        make(TEXTURES.grassSide), make(TEXTURES.grassSide),
      ];
      break;
    case BLOCK.DIRT:   m = Array(6).fill(null).map(() => make(TEXTURES.dirt));   break;
    case BLOCK.STONE:  m = Array(6).fill(null).map(() => make(TEXTURES.stone));  break;
    case BLOCK.SAND:   m = Array(6).fill(null).map(() => make(TEXTURES.sand));   break;
    case BLOCK.WOOD:
      m = [
        make(TEXTURES.woodSide), make(TEXTURES.woodSide),
        make(TEXTURES.woodTop),  make(TEXTURES.woodTop),
        make(TEXTURES.woodSide), make(TEXTURES.woodSide),
      ];
      break;
    case BLOCK.LEAVES: m = Array(6).fill(null).map(() => make(TEXTURES.leaves, { transparent: true })); break;
    case BLOCK.COZE:
      m = Array(6).fill(null).map(() => {
        const mat = make(TEXTURES.coze);
        mat.emissive = new THREE.Color(0x664411);
        mat.emissiveIntensity = 0.35;
        return mat;
      });
      break;
    case BLOCK.GRAVEL: m = Array(6).fill(null).map(() => make(TEXTURES.gravel)); break;
    case BLOCK.SNOW:
      m = [
        make(TEXTURES.snowSide), make(TEXTURES.snowSide),
        make(TEXTURES.snow),     make(TEXTURES.dirt),
        make(TEXTURES.snowSide), make(TEXTURES.snowSide),
      ];
      break;
    case BLOCK.WATER:
      m = Array(6).fill(null).map(() => {
        const mat = make(TEXTURES.water, { transparent: true, opacity: 0.72, alphaTest: 0 });
        mat.depthWrite = false;
        return mat;
      });
      break;
    case BLOCK.GLOWSTONE:
      m = Array(6).fill(null).map(() => {
        const mat = make(TEXTURES.glowstone);
        mat.emissive = new THREE.Color(0xffcc44);
        mat.emissiveIntensity = 0.7;
        return mat;
      });
      break;
    case BLOCK.ICE:
      m = Array(6).fill(null).map(() => {
        const mat = make(TEXTURES.ice, { transparent: true, opacity: 0.85, alphaTest: 0 });
        return mat;
      });
      break;
    case BLOCK.CACTUS:
      m = [
        make(TEXTURES.cactusSide, { transparent: true }), make(TEXTURES.cactusSide, { transparent: true }),
        make(TEXTURES.cactusTop,  { transparent: true }), make(TEXTURES.cactusTop,  { transparent: true }),
        make(TEXTURES.cactusSide, { transparent: true }), make(TEXTURES.cactusSide, { transparent: true }),
      ];
      break;
    case BLOCK.FLOWER: m = Array(6).fill(null).map(() => make(TEXTURES.flower, { transparent: true })); break;
    case BLOCK.LAPIS:  m = Array(6).fill(null).map(() => make(TEXTURES.lapis));  break;
    case BLOCK.BRICK:  m = Array(6).fill(null).map(() => make(TEXTURES.brick));  break;
    default:
      m = Array(6).fill(null).map(() => new THREE.MeshLambertMaterial({ color: 0xff00ff }));
  }

  MATERIALS_CACHE[blockType] = m;
  return m;
}

function getBlockPreviewColor(blockType) {
  return {
    [BLOCK.GRASS]:     '#52A03C',
    [BLOCK.DIRT]:      '#8B5E3C',
    [BLOCK.STONE]:     '#84848C',
    [BLOCK.SAND]:      '#E0CC90',
    [BLOCK.WOOD]:      '#6E4A2A',
    [BLOCK.LEAVES]:    '#3EA842',
    [BLOCK.COZE]:      '#D4AC2C',
    [BLOCK.GRAVEL]:    '#9A9088',
    [BLOCK.SNOW]:      '#ECF1FA',
    [BLOCK.WATER]:     '#2068CC',
    [BLOCK.GLOWSTONE]: '#FCD456',
    [BLOCK.ICE]:       '#A8D4F4',
    [BLOCK.CACTUS]:    '#3C8834',
    [BLOCK.FLOWER]:    '#FF7896',
    [BLOCK.LAPIS]:     '#2C55C4',
    [BLOCK.BRICK]:     '#A84A3C',
  }[blockType] || '#888';
}
