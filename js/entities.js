/**
 * entities.js — 生命系统（v4 新增）
 * 方块像素动物（羊/猪/鸡/兔/狐狸/鸟/蝴蝶/鱼）+ 村民 NPC + 收集星星
 * 全部用 BoxGeometry 拼装，随机游走 AI + 简易重力贴地
 */

/* ===== 共享资源：单位立方体 + 按颜色缓存材质 ===== */
/* 精致化后单只动物 12~18 个部件，几何/材质全部共享，draw 数涨但显存不涨 */
const _unitBox = new THREE.BoxGeometry(1, 1, 1);
_unitBox.userData.shared = true;
const _matCache = new Map();

function _mat(color, emissive) {
  const key = `${color}|${emissive || 0}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0.7; }
    m.userData.shared = true;
    _matCache.set(key, m);
  }
  return m;
}

/* 颜色加深/提亮（同色系配件：腰带、蹄子、阴影面） */
function _shade(c, f) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/* 方块部件（共享几何，按 scale 变形；眼睛等微小件不投影，省阴影 pass） */
function _part(w, h, d, color, x, y, z, emissive) {
  const m = new THREE.Mesh(_unitBox, _mat(color, emissive));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = w * h * d > 0.004;
  return m;
}

/* 可摆动的腿：Group 定在髋关节，网格向下伸（走路时 rotation.x 摆动） */
function _leg(w, h, d, color, x, hipY, z, hoof) {
  const g = new THREE.Group();
  g.position.set(x, hipY, z);
  g.add(_part(w, h, d, color, 0, -h / 2, 0));
  if (hoof) g.add(_part(w * 1.12, h * 0.28, d * 1.12, hoof, 0, -h * 0.86, 0));   // 深色蹄
  return g;
}

/* 一对眼睛（脸朝 -z 的贴面黑亮方块） */
function _eyes(g, dx, y, z, s = 0.09) {
  for (const x of [-dx, dx]) g.add(_part(s, s, 0.04, 0x14100E, x, y, z));
}

/* ===== 动物模型工厂（返回 THREE.Group，脚底为 y=0，脸朝 -z） =====
 * userData 挂动画部件引用：legs[] 迈步 / head 点头 / tail 摇尾 / arms[] 摆臂 / wings[] 扑扇 */
const AnimalModels = {
  sheep() {
    const g = new THREE.Group();
    // 蓬松羊毛：主体 + 三层错落绒块
    g.add(_part(0.95, 0.72, 1.3, 0xF2F0EA, 0, 0.78, 0));
    g.add(_part(0.8, 0.58, 0.5, 0xE9E6DE, 0, 0.92, 0.45));
    g.add(_part(0.85, 0.55, 0.5, 0xEDEAE2, 0, 0.95, -0.35));
    g.add(_part(0.72, 0.5, 0.9, 0xF7F5F0, 0, 1.1, 0.05));
    const head = new THREE.Group(); head.position.set(0, 1.08, -0.8);
    head.add(_part(0.46, 0.44, 0.42, 0xC9A886, 0, 0, -0.06));      // 脸
    head.add(_part(0.54, 0.3, 0.36, 0xF2F0EA, 0, 0.24, 0.06));     // 头顶绒毛
    _eyes(head, 0.15, 0.06, -0.28);
    head.add(_part(0.1, 0.08, 0.06, 0x8A6B4C, 0, -0.12, -0.28));   // 鼻
    for (const x of [-0.28, 0.28]) head.add(_part(0.14, 0.1, 0.2, 0xB8987A, x, 0.02, 0.02));   // 耳
    g.add(head);
    g.add(_part(0.2, 0.2, 0.18, 0xF7F5F0, 0, 0.85, 0.7));          // 尾巴绒球
    const legs = [];
    for (const [x, z] of [[-0.28, -0.42], [0.28, -0.42], [-0.28, 0.42], [0.28, 0.42]])
      legs.push(_leg(0.2, 0.48, 0.2, 0xC9A886, x, 0.48, z, 0x8A6B4C));
    legs.forEach(l => g.add(l));
    g.userData = { legs, head };
    return g;
  },
  pig() {
    const g = new THREE.Group();
    g.add(_part(0.95, 0.68, 1.3, 0xF2A5A5, 0, 0.62, 0));
    g.add(_part(0.97, 0.28, 0.9, 0xE99A9A, 0, 0.44, 0.1));         // 腹部色差
    const head = new THREE.Group(); head.position.set(0, 0.78, -0.85);
    head.add(_part(0.56, 0.5, 0.45, 0xF2A5A5, 0, 0, 0));
    head.add(_part(0.3, 0.2, 0.12, 0xE87E8E, 0, -0.06, -0.28));    // 猪鼻
    for (const x of [-0.07, 0.07]) head.add(_part(0.05, 0.08, 0.03, 0xB44A5A, x, -0.06, -0.345)); // 鼻孔
    _eyes(head, 0.17, 0.12, -0.24);
    for (const x of [-0.2, 0.2]) head.add(_part(0.16, 0.16, 0.08, 0xE29191, x, 0.3, -0.06));   // 耳
    g.add(head);
    const tail = new THREE.Group(); tail.position.set(0, 0.74, 0.64);
    tail.add(_part(0.08, 0.08, 0.14, 0xE87E8E, 0, 0, 0.04));       // 卷尾巴
    tail.add(_part(0.08, 0.14, 0.08, 0xE87E8E, 0, 0.1, 0.1));
    g.add(tail);
    const legs = [];
    for (const [x, z] of [[-0.3, -0.42], [0.3, -0.42], [-0.3, 0.42], [0.3, 0.42]])
      legs.push(_leg(0.22, 0.36, 0.22, 0xE29191, x, 0.36, z, 0xC97878));
    legs.forEach(l => g.add(l));
    g.userData = { legs, head, tail };
    return g;
  },
  cow() {
    const g = new THREE.Group();
    g.add(_part(1.0, 0.78, 1.55, 0x4A3A2E, 0, 0.92, 0));
    g.add(_part(1.02, 0.42, 0.55, 0xF2EFE8, 0.05, 1.0, 0.3));      // 白斑（横穿身体两侧）
    g.add(_part(1.02, 0.34, 0.4, 0xF2EFE8, -0.06, 0.76, -0.4));    // 白斑2
    g.add(_part(0.5, 0.2, 0.4, 0xEFB8C4, 0, 0.48, 0.4));           // 乳房
    const head = new THREE.Group(); head.position.set(0, 1.22, -1.0);
    head.add(_part(0.56, 0.52, 0.5, 0x4A3A2E, 0, 0, 0));
    head.add(_part(0.5, 0.16, 0.3, 0xD8CCBB, 0, 0.3, -0.06));      // 额顶绒毛
    head.add(_part(0.44, 0.26, 0.16, 0xE8C8B0, 0, -0.18, -0.28));  // 粉吻
    for (const x of [-0.1, 0.1]) head.add(_part(0.06, 0.08, 0.03, 0x9A7460, x, -0.18, -0.37)); // 鼻孔
    _eyes(head, 0.18, 0.1, -0.27);
    for (const x of [-0.34, 0.34]) {
      head.add(_part(0.15, 0.13, 0.13, 0xD8D2C8, x, 0.26, -0.02)); // 牛角
      head.add(_part(0.2, 0.12, 0.08, 0x3A2E24, x, 0.04, 0.1));    // 耳
    }
    g.add(head);
    const tail = new THREE.Group(); tail.position.set(0, 1.16, 0.78);
    tail.add(_part(0.08, 0.5, 0.08, 0x3A2E24, 0, -0.25, 0.02));
    tail.add(_part(0.12, 0.16, 0.12, 0x241A12, 0, -0.56, 0.02));   // 尾须
    g.add(tail);
    const legs = [];
    for (const [x, z] of [[-0.32, -0.52], [0.32, -0.52], [-0.32, 0.52], [0.32, 0.52]])
      legs.push(_leg(0.24, 0.55, 0.24, 0x3A2E24, x, 0.55, z, 0x1E1610));
    legs.forEach(l => g.add(l));
    g.userData = { legs, head, tail };
    return g;
  },
  chicken() {
    const g = new THREE.Group();
    g.add(_part(0.52, 0.5, 0.72, 0xFAF7EE, 0, 0.58, 0));
    g.add(_part(0.4, 0.32, 0.24, 0xEFEAE0, 0, 0.78, 0.42));        // 翘尾羽
    g.add(_part(0.28, 0.2, 0.16, 0xE6E0D4, 0, 0.94, 0.5));
    const head = new THREE.Group(); head.position.set(0, 1.0, -0.4);
    head.add(_part(0.34, 0.38, 0.34, 0xFAF7EE, 0, 0, 0));
    head.add(_part(0.14, 0.1, 0.16, 0xF2B02C, 0, -0.02, -0.24));   // 喙
    head.add(_part(0.1, 0.16, 0.1, 0xE0342C, 0, -0.18, -0.16));    // 肉髯
    head.add(_part(0.1, 0.13, 0.28, 0xE0342C, 0, 0.25, 0.01));     // 鸡冠
    _eyes(head, 0.13, 0.08, -0.16, 0.07);
    g.add(head);
    for (const x of [-0.3, 0.3]) g.add(_part(0.08, 0.3, 0.5, 0xEFEAE0, x, 0.6, 0.05));   // 收拢的翅膀
    const legs = [];
    for (const x of [-0.12, 0.12]) {
      const l = _leg(0.07, 0.33, 0.07, 0xF2B02C, x, 0.33, 0.02);
      l.add(_part(0.16, 0.05, 0.2, 0xE8A424, 0, -0.31, -0.05));    // 脚掌
      legs.push(l);
    }
    legs.forEach(l => g.add(l));
    g.userData = { legs, head };
    return g;
  },
  rabbit() {
    const g = new THREE.Group();
    g.add(_part(0.5, 0.44, 0.7, 0xD8CFC4, 0, 0.4, 0.02));
    g.add(_part(0.54, 0.36, 0.4, 0xCEC4B8, 0, 0.5, 0.26));         // 拱起的后臀
    const head = new THREE.Group(); head.position.set(0, 0.66, -0.42);
    head.add(_part(0.38, 0.36, 0.36, 0xD8CFC4, 0, 0, 0));
    head.add(_part(0.16, 0.12, 0.1, 0xF2F0EC, 0, -0.1, -0.19));    // 白嘴
    head.add(_part(0.07, 0.05, 0.04, 0xE8A0A8, 0, -0.02, -0.22));  // 粉鼻
    _eyes(head, 0.14, 0.07, -0.16);
    for (const x of [-0.11, 0.11]) {
      head.add(_part(0.11, 0.42, 0.08, 0xCCC0B4, x, 0.38, 0.03));  // 长耳
      head.add(_part(0.05, 0.28, 0.03, 0xE8A0A8, x, 0.4, -0.02));  // 耳内粉
    }
    g.add(head);
    g.add(_part(0.17, 0.17, 0.17, 0xF7F5F0, 0, 0.46, 0.46));       // 绒球尾
    const legs = [];
    for (const [x, z] of [[-0.16, -0.24], [0.16, -0.24]])
      legs.push(_leg(0.12, 0.2, 0.12, 0xCCC0B4, x, 0.2, z));       // 前爪
    for (const [x, z] of [[-0.18, 0.24], [0.18, 0.24]])
      legs.push(_leg(0.16, 0.24, 0.3, 0xCCC0B4, x, 0.24, z));      // 大后腿
    legs.forEach(l => g.add(l));
    g.userData = { legs, head };
    return g;
  },
  fox() {
    const g = new THREE.Group();
    g.add(_part(0.55, 0.5, 1.05, 0xE07B2C, 0, 0.55, 0.05));
    g.add(_part(0.57, 0.26, 0.5, 0xF7F3EA, 0, 0.42, -0.26));       // 白胸腹
    const head = new THREE.Group(); head.position.set(0, 0.78, -0.66);
    head.add(_part(0.44, 0.4, 0.42, 0xE07B2C, 0, 0, 0));
    head.add(_part(0.22, 0.18, 0.26, 0xF7F3EA, 0, -0.1, -0.28));   // 白吻
    head.add(_part(0.09, 0.07, 0.06, 0x2A2018, 0, -0.07, -0.43));  // 黑鼻尖
    _eyes(head, 0.15, 0.09, -0.2);
    for (const x of [-0.14, 0.14]) {
      head.add(_part(0.13, 0.24, 0.09, 0xC96518, x, 0.3, 0.04));   // 尖耳
      head.add(_part(0.06, 0.13, 0.04, 0x3A2A1E, x, 0.31, -0.02)); // 耳内
    }
    g.add(head);
    const tail = new THREE.Group(); tail.position.set(0, 0.62, 0.55);
    tail.add(_part(0.22, 0.22, 0.5, 0xE07B2C, 0, 0.03, 0.26));     // 大尾巴
    tail.add(_part(0.18, 0.18, 0.2, 0xF7F3EA, 0, 0.05, 0.58));     // 白尾尖
    g.add(tail);
    const legs = [];
    for (const [x, z] of [[-0.18, -0.32], [0.18, -0.32], [-0.18, 0.34], [0.18, 0.34]])
      legs.push(_leg(0.14, 0.32, 0.14, 0x3A2A1E, x, 0.32, z));     // 黑袜腿
    legs.forEach(l => g.add(l));
    g.userData = { legs, head, tail };
    return g;
  },
  bird() {
    const g = new THREE.Group();
    g.add(_part(0.3, 0.28, 0.52, 0x4A9FE8, 0, 0.22, 0));
    g.add(_part(0.26, 0.14, 0.32, 0xC8E4FA, 0, 0.1, -0.08));       // 浅色腹部
    g.add(_part(0.16, 0.05, 0.3, 0x3780C4, 0, 0.26, 0.36));        // 尾羽
    const head = new THREE.Group(); head.position.set(0, 0.44, -0.32);
    head.add(_part(0.24, 0.24, 0.24, 0x4A9FE8, 0, 0, 0));
    head.add(_part(0.08, 0.07, 0.16, 0xF2B02C, 0, -0.03, -0.18));  // 喙
    _eyes(head, 0.09, 0.04, -0.11, 0.06);
    g.add(head);
    const wl = _part(0.5, 0.05, 0.32, 0x3780C4, -0.38, 0.32, 0);
    const wr = _part(0.5, 0.05, 0.32, 0x3780C4, 0.38, 0.32, 0);
    wl.name = 'wingL'; wr.name = 'wingR';
    g.add(wl); g.add(wr);
    g.userData = { head, wings: [wl, wr] };
    return g;
  },
  butterfly() {
    const g = new THREE.Group();
    g.add(_part(0.07, 0.09, 0.32, 0x2E2A33, 0, 0.12, 0));          // 身体
    g.add(_part(0.09, 0.09, 0.09, 0x2E2A33, 0, 0.14, -0.19));      // 头
    for (const x of [-0.05, 0.05]) g.add(_part(0.02, 0.14, 0.02, 0x2E2A33, x, 0.26, -0.2));   // 触角
    const mkWing = side => {
      const w = new THREE.Group();                                  // 翅根在身体轴，扑扇绕根转
      w.add(_part(0.36, 0.02, 0.3, 0xFF7BD5, side * 0.2, 0, -0.05));
      w.add(_part(0.26, 0.021, 0.2, 0xFFB3E8, side * 0.24, 0.004, 0.14));   // 后翅浅粉
      w.add(_part(0.1, 0.024, 0.08, 0xFFF3FA, side * 0.25, 0.01, -0.1));    // 翅斑
      return w;
    };
    const wl = mkWing(-1), wr = mkWing(1);
    wl.position.set(0, 0.13, 0); wr.position.set(0, 0.13, 0);
    wl.name = 'wingL'; wr.name = 'wingR';
    g.add(wl); g.add(wr);
    g.userData = { wings: [wl, wr] };
    return g;
  },
  fish() {
    const g = new THREE.Group();
    g.add(_part(0.24, 0.36, 0.68, 0xE8A23C, 0, 0.22, 0));
    g.add(_part(0.25, 0.37, 0.1, 0xC4761E, 0, 0.22, -0.06));       // 身体条纹
    g.add(_part(0.25, 0.37, 0.1, 0xC4761E, 0, 0.22, 0.16));
    const tail = new THREE.Group(); tail.position.set(0, 0.22, 0.34);
    tail.add(_part(0.05, 0.3, 0.26, 0xD4842A, 0, 0, 0.13));        // 尾鳍（独立摆动）
    g.add(tail);
    g.add(_part(0.05, 0.16, 0.26, 0xD4842A, 0, 0.47, 0));          // 背鳍
    for (const x of [-0.14, 0.14]) g.add(_part(0.04, 0.12, 0.16, 0xF2C468, x, 0.16, -0.1));   // 胸鳍
    for (const x of [-0.13, 0.13]) g.add(_part(0.04, 0.07, 0.07, 0x14100E, x, 0.3, -0.24));   // 侧眼
    g.userData = { tail };
    return g;
  },
  villager(robe) {
    const g = new THREE.Group();
    const trim = _shade(robe, 0.68);
    g.add(_part(0.55, 0.9, 0.42, robe, 0, 0.88, 0));               // 袍身
    g.add(_part(0.57, 0.12, 0.44, trim, 0, 0.64, 0));              // 腰带
    g.add(_part(0.12, 0.88, 0.44, trim, 0, 0.9, 0));               // 前襟
    const head = new THREE.Group(); head.position.set(0, 1.52, 0);
    head.add(_part(0.42, 0.42, 0.4, 0xE8B88A, 0, 0, 0));           // 头
    head.add(_part(0.44, 0.16, 0.42, 0x5A4632, 0, 0.28, 0));       // 头发
    head.add(_part(0.44, 0.28, 0.1, 0x5A4632, 0, 0.08, 0.17));     // 后脑发
    _eyes(head, 0.12, 0.05, -0.19, 0.07);
    head.add(_part(0.32, 0.05, 0.04, 0x6A5238, 0, 0.15, -0.2));    // 眉
    head.add(_part(0.1, 0.26, 0.1, 0xD8A87A, 0, -0.1, -0.24));     // 大鼻子
    g.add(head);
    const arms = [], legs = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(s * 0.36, 1.28, 0);   // 肩关节
      arm.add(_part(0.16, 0.55, 0.2, robe, 0, -0.27, 0));
      arm.add(_part(0.14, 0.12, 0.18, 0xE8B88A, 0, -0.58, 0));     // 手
      arms.push(arm); g.add(arm);
      const leg = new THREE.Group(); leg.position.set(s * 0.14, 0.5, 0);    // 髋关节
      leg.add(_part(0.18, 0.42, 0.2, 0x4A3828, 0, -0.21, 0));
      leg.add(_part(0.18, 0.1, 0.26, 0x2E2218, 0, -0.45, -0.03));  // 鞋
      legs.push(leg); g.add(leg);
    }
    g.userData = { head, arms, legs };
    return g;
  },
};

/* ===== 各群系动物表 ===== */
const BIOME_ANIMALS = {
  [BIOME.PLAINS]: ['sheep', 'pig', 'chicken', 'rabbit', 'butterfly', 'bird', 'cow'],
  [BIOME.FOREST]: ['fox', 'rabbit', 'bird', 'butterfly', 'chicken'],
  [BIOME.DESERT]: ['rabbit', 'bird'],
  [BIOME.SNOWY]:  ['fox', 'rabbit', 'bird'],
  [BIOME.OCEAN]:  ['fish', 'bird'],
};

const ANIMAL_INFO = {
  sheep:     { name: '绵羊',   flying: false, water: false, speed: 1.2, sound: [520, 380] },
  pig:       { name: '小猪',   flying: false, water: false, speed: 1.4, sound: [220, 160] },
  cow:       { name: '奶牛',   flying: false, water: false, speed: 1.0, sound: [180, 120] },
  chicken:   { name: '母鸡',   flying: false, water: false, speed: 1.6, sound: [880, 990] },
  rabbit:    { name: '兔子',   flying: false, water: false, speed: 2.6, sound: [700, 900] },
  fox:       { name: '狐狸',   flying: false, water: false, speed: 2.2, sound: [600, 450] },
  bird:      { name: '小鸟',   flying: true,  water: false, speed: 3.0, sound: [1300, 1600] },
  butterfly: { name: '蝴蝶',   flying: true,  water: false, speed: 1.2, sound: null },
  fish:      { name: '小鱼',   flying: false, water: true,  speed: 1.8, sound: null },
};

const VILLAGER_NAMES = ['老木', '阿禾', '小满', '石头', '春杏', '云生', '豆豆', '铁蛋',
                        '雪见', '枫叶', '霞姑', '岚哥', '麦穗', '露珠', '谷雨', '青苗',
                        '拾贝', '望舒', '晚风', '一粟', '灯芯', '阿远', '茶婆', '柴叔',
                        '冬青', '杏雨', '芦花', '半夏', '苔米', '知秋'];
const VILLAGER_ROBES = [0x8A5A32, 0x5A7A4A, 0x7A5A8A, 0x4A6A8A, 0x9A6A3A, 0x6A8A5A];
const VILLAGER_LINES = [
  '欢迎来到我们村！',
  '听说 MYFLICKER 神殿会在夜里发光…',
  '今年的收成不错，田里的花都开了。',
  '山那边有雪狐出没，见到别惊扰它。',
  '想盖房子？多囤点木头准没错。',
  // 飞行提示按设备给（移动端没有空格键，别教玩家按不存在的键）
  ('ontouchstart' in window)
    ? '点右边的🕊️按钮能飞上天，飞起来后按住下降键还能加速！别告诉别人是我说的！'
    : '双击空格可以飞起来，飞行时按Shift还能加速！别告诉别人是我说的！',
  '收集金色星星会有好运气哦。',
  '海里有鱼群，退潮的时候最好看。',
  '排行榜第一名的位置，说不定就是留给你的。',
  '把这里的故事讲给朋友听吧，人多才热闹！',
  '北边雪岭村的邻居说，山口有座古老的瞭望塔。',
  '野外有旅人留下的营地，篝火到夜里还亮着呢。',
  '沙漠深处立着一根发光的碑，没人知道是谁修的。',
  '一共有六座村子，你都走到过吗？',
];

const MAX_ANIMALS   = 56;   // 场上动物上限（v4.9: 40→56，世界更热闹）
const ANIMAL_RANGE  = 70;   // 超过此距离回收
const STAR_COUNT_ON = 14;   // 场上星星目标数量

class EntityManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.animals   = [];
    this.villagers = [];
    this.stars     = [];
    this.petCount     = 0;
    this.starCollected = Number(localStorage.getItem('myflicker-v4-stars') || 0);
    this._spawnTimer = 0;
  }

  /* ========== 初始化：村民 + 出生地动物 ========== */
  init() {
    // 村民驻村（v4.9: 每村 3→5 人，两圈布点更有人气）
    for (const v of VILLAGES) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + (v.x + v.z);   // 各村相位错开
        const r = i % 2 === 0 ? 5 : 9;
        this._spawnVillager(
          v.x + Math.cos(ang) * r,
          v.z + Math.sin(ang) * r,
          v
        );
      }
    }
    // 出生地周围先撒一批动物（v4.9: 14→20）
    for (let i = 0; i < 20; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * 30;
      this._trySpawnAnimal(Math.cos(ang) * r, 10 + Math.sin(ang) * r);
    }
    // v5：每村 2 只"常驻动物"——不参与远距回收，村里永远有生灵气
    for (const v of VILLAGES) {
      for (let i = 0; i < 2; i++) {
        const ang = Math.random() * Math.PI * 2 + i * Math.PI;
        const r = 6 + Math.random() * 4;
        const a = this._trySpawnAnimal(v.x + Math.cos(ang) * r, v.z + Math.sin(ang) * r);
        if (a) { a.resident = true; a.village = v; }
      }
    }
    // 初始星星
    for (let i = 0; i < STAR_COUNT_ON; i++) this._spawnStar(0, 0);
  }

  _groundY(wx, wz) {
    // 地形+树顶最高约 y≈60，从 72 起扫即可（每帧 40 只动物都要调，省 1/4 无谓空气层）
    for (let y = 72; y > 0; y--) {
      const t = this.world.getBlock(Math.floor(wx), y, Math.floor(wz));
      if (t !== BLOCK.AIR && t !== BLOCK.FLOWER) return { y: y + 1, block: t };
    }
    return null;
  }

  /* 彻底释放实体 mesh（geometry/material），防 GPU 内存泄漏
   * 注意：动物模型的几何/材质是全局共享缓存（userData.shared），跳过不释放 */
  _disposeMesh(mesh) {
    this.scene.remove(mesh);
    mesh.traverse(o => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material])
        .forEach(m => { if (!m.userData?.shared) m.dispose(); });
    });
  }

  /* ========== 动物生成 ========== */
  _trySpawnAnimal(wx, wz) {
    if (this.animals.length >= MAX_ANIMALS) return null;
    const g = this._groundY(wx, wz);
    if (!g) return null;
    const biome = this.world.biomeAt(Math.floor(wx), Math.floor(wz));
    const pool = BIOME_ANIMALS[biome];
    if (!pool || !pool.length) return null;
    const kind = pool[Math.floor(Math.random() * pool.length)];
    const info = ANIMAL_INFO[kind];

    // 水生动物必须在水里，陆生不能在水里
    const inWater = g.block === BLOCK.WATER || g.block === BLOCK.ICE;
    if (info.water && g.block !== BLOCK.WATER) return null;
    if (!info.water && !info.flying && inWater) return null;

    const mesh = AnimalModels[kind]();
    let y = g.y;
    let hover = 0;                                   // 飞行动物的离地巡航高度
    if (info.flying) { hover = 3 + Math.random() * 5; y += hover; }
    if (info.water) {
      // 找海床：从海面往下扫到第一块实体，鱼的深度夹在 [海床+0.6, 海面-1] 之间（防埋沙）
      let bed = SEA_LEVEL - 8;
      for (let sy = SEA_LEVEL; sy > 0; sy--) {
        const t = this.world.getBlock(Math.floor(wx), sy, Math.floor(wz));
        if (t !== BLOCK.WATER && t !== BLOCK.AIR && t !== BLOCK.ICE) { bed = sy + 1; break; }
      }
      if (bed > SEA_LEVEL - 1.6) return null;        // 水太浅，不生成鱼
      y = Math.max(bed + 0.6, SEA_LEVEL - 1.2 - Math.random() * 2);
    }
    mesh.position.set(wx, y, wz);
    this.scene.add(mesh);

    const animal = {
      kind, info, mesh,
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      state: 'idle',
      timer: Math.random() * 3,
      baseY: y,
      groundLevel: g.y,          // 陆地动物的贴地基准（与跳跃偏移分离，防累加升天）
      hover,                     // 飞行动物离地高度（随地形平滑跟随）
      phase: Math.random() * Math.PI * 2,
      petCooldown: 0,
    };
    this.animals.push(animal);
    return animal;
  }

  /* ========== 村民生成 ========== */
  _spawnVillager(wx, wz, village) {
    const g = this._groundY(wx, wz);
    const y = g ? g.y : (village.y || GROUND_Y);
    const robe = VILLAGER_ROBES[this.villagers.length % VILLAGER_ROBES.length];
    const mesh = AnimalModels.villager(robe);
    mesh.position.set(wx, y, wz);
    this.scene.add(mesh);
    // v5：作息锚点——每人认领一扇"家门口"（对应 village.js 四间木屋的门前），
    // 夜里回家门口待着；农田在东南角，白天偶尔去田边转悠
    const DOORSTEPS = [
      { ox: -4.8, oz: -7 }, { ox: 4.8, oz: -7 },
      { ox: -8, oz: 4.8 },  { ox: 4.8, oz: 8 },
    ];
    const ds = DOORSTEPS[this.villagers.length % DOORSTEPS.length];
    this.villagers.push({
      name: VILLAGER_NAMES[this.villagers.length % VILLAGER_NAMES.length],
      mesh, village,
      home: { x: village.x + ds.ox, z: village.z + ds.oz },
      farm: { x: village.x + 1, z: village.z + 10.5 },
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      state: 'idle',
      timer: Math.random() * 4,
      talkCooldown: 0,
    });
  }

  /* ========== 星星（收集品） ========== */
  _spawnStar(cx, cz) {
    const ang = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 55;
    const wx = cx + Math.cos(ang) * r;
    const wz = cz + Math.sin(ang) * r;
    const g = this._groundY(wx, wz);
    if (!g) return;

    // v5：约 1% 概率生成罕见彩虹星（更大、计 5 颗、彩色脉动光）
    const rainbow = Math.random() < 0.01;
    const geo = new THREE.OctahedronGeometry(rainbow ? 0.52 : 0.34);
    const mat = new THREE.MeshLambertMaterial({ color: rainbow ? 0xFF5FA2 : 0xFFD24A });
    mat.emissive = new THREE.Color(rainbow ? 0xFF3080 : 0xFFB020);
    mat.emissiveIntensity = rainbow ? 1.1 : 0.9;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(wx, g.y + 0.8, wz);
    this.scene.add(mesh);

    const light = new THREE.PointLight(rainbow ? 0xFF60C0 : 0xFFC840, rainbow ? 1.2 : 0.8, rainbow ? 9 : 6);
    light.position.copy(mesh.position);
    this.scene.add(light);

    this.stars.push({ mesh, light, baseY: g.y + 0.8, phase: Math.random() * 6, rainbow });
  }

  /* ========== 交互：摸动物 / 和村民说话（E 键） ========== */
  interact(playerPos, camera) {
    // 水平2D距离：消除坡面/台阶引起的垂直偏差，站在坡上也能顺畅触发
    const _dist2D = (mesh) => {
      const dx = mesh.position.x - playerPos.x;
      const dz = mesh.position.z - playerPos.z;
      return Math.sqrt(dx * dx + dz * dz);
    };

    // 最近的村民（3 格内，水平距离）
    let best = null, bestD = 3;
    for (const v of this.villagers) {
      const d = _dist2D(v.mesh);
      if (d < bestD) { best = v; bestD = d; }
    }
    if (best && best.talkCooldown <= 0) {
      const line = VILLAGER_LINES[Math.floor(Math.random() * VILLAGER_LINES.length)];
      window.gameUI?.toast(`💬 ${best.name}：${line}`);
      window.gameAudio?.talk();
      best.talkCooldown = 2;
      // 面向玩家（模型脸在 -z，手动算 yaw 而非 lookAt——lookAt 是 +z 朝目标会背对）
      best.mesh.rotation.y = Math.atan2(playerPos.x - best.mesh.position.x, playerPos.z - best.mesh.position.z) + Math.PI;
      window.gameUI?.unlockAchievement('villager');
      return true;
    }

    // 最近的动物（2.5 格内，水平距离）
    let bestA = null, bestAD = 2.5;
    for (const a of this.animals) {
      const d = _dist2D(a.mesh);
      if (d < bestAD) { bestA = a; bestAD = d; }
    }
    if (bestA && bestA.petCooldown <= 0) {
      window.gameUI?.toast(`💕 你摸了摸${bestA.info.name}`);
      if (bestA.info.sound) window.gameAudio?.animal(bestA.info.sound);
      bestA.petCooldown = 1.5;
      bestA.state = 'flee';           // 害羞跑开
      bestA.timer = 1.2;
      bestA.yaw = Math.atan2(bestA.mesh.position.x - playerPos.x, bestA.mesh.position.z - playerPos.z);
      this.petCount++;
      window.gameUI?.unlockAchievement('pet');
      if (this.petCount >= 10) window.gameUI?.unlockAchievement('zoologist');
      return true;
    }
    return false;
  }

  /* ========== 每帧更新 ========== */
  update(dt, playerPos, timeInfo) {
    if (timeInfo) this._dayTime = timeInfo.dayTime;   // v5：村民作息用
    this._updateAnimals(dt, playerPos);
    this._updateVillagers(dt, playerPos);
    this._updateStars(dt, playerPos);

    // 周期性在玩家附近补充动物 / 回收远处动物
    this._spawnTimer += dt;
    if (this._spawnTimer > 2.5) {
      this._spawnTimer = 0;
      // 回收（动物 + 远处星星），dispose 防显存泄漏；v5：村庄常驻动物不回收
      for (let i = this.animals.length - 1; i >= 0; i--) {
        const a = this.animals[i];
        if (!a.resident && a.mesh.position.distanceTo(playerPos) > ANIMAL_RANGE) {
          this._disposeMesh(a.mesh);
          this.animals.splice(i, 1);
        }
      }
      for (let i = this.stars.length - 1; i >= 0; i--) {
        const st = this.stars[i];
        if (st.mesh.position.distanceTo(playerPos) > 90) {
          this._disposeMesh(st.mesh);
          this.scene.remove(st.light);
          this.stars.splice(i, 1);
        }
      }
      // 补充（在玩家 25~45 格外圈生成；v4.9: 每轮尝试 2 只，回填更快）
      if (this.animals.length < MAX_ANIMALS) {
        for (let i = 0; i < 2 && this.animals.length < MAX_ANIMALS; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = 25 + Math.random() * 20;
          this._trySpawnAnimal(playerPos.x + Math.cos(ang) * r, playerPos.z + Math.sin(ang) * r);
        }
      }
    }
  }

  _updateAnimals(dt, playerPos) {
    for (const a of this.animals) {
      if (a.petCooldown > 0) a.petCooldown -= dt;
      a.timer -= dt;

      // v5.1 远距降级：>62 格（雾里几乎不可见）只走计时器，跳过移动/动画/贴地扫描。
      // 常驻动物在远处村庄也冻结——玩家走近前完全不可见，省下大量 _groundY 逐层扫描
      {
        const ddx = a.mesh.position.x - playerPos.x;
        const ddz = a.mesh.position.z - playerPos.z;
        if (ddx * ddx + ddz * ddz > 62 * 62) continue;
      }
      a.phase += dt * 6;

      // 状态机：idle ↔ walk（flee 是被摸后的短促逃跑）
      if (a.timer <= 0) {
        if (a.state === 'idle') {
          a.state = 'walk';
          a.timer = 1.5 + Math.random() * 3;
          a.yaw = Math.random() * Math.PI * 2;
          // v5：常驻动物走出村界时掉头回村（拴绳效果）
          if (a.resident && a.village) {
            const dx = a.mesh.position.x - a.village.x;
            const dz = a.mesh.position.z - a.village.z;
            if (Math.sqrt(dx * dx + dz * dz) > a.village.r - 2) {
              a.yaw = Math.atan2(a.village.x - a.mesh.position.x, a.village.z - a.mesh.position.z);
            }
          }
        } else {
          a.state = 'idle';
          a.timer = 1 + Math.random() * 3;
        }
      }

      const moving = a.state === 'walk' || a.state === 'flee';
      const speed = a.info.speed * (a.state === 'flee' ? 2.2 : 1);

      // v5.3：玩家靠得太近（1.8 格内）时，陆地/非鱼动物本能逃开——增加活泼感
      if (!a.info.flying && !a.info.water && a.state !== 'flee' && a.petCooldown <= 0) {
        const _adx = a.mesh.position.x - playerPos.x, _adz = a.mesh.position.z - playerPos.z;
        if (_adx * _adx + _adz * _adz < 1.8 * 1.8) {
          a.state = 'flee';
          a.timer = 1.0 + Math.random() * 0.8;
          a.yaw = Math.atan2(_adx, _adz);   // 背向玩家跑
        }
      }

      if (a.info.flying) {
        // 飞行：正弦起伏 + 缓慢巡航；baseY 随地形平滑跟随（不穿山、不悬崖失高）
        if (moving) {
          a.mesh.position.x += Math.sin(a.yaw) * speed * dt;
          a.mesh.position.z += Math.cos(a.yaw) * speed * dt;
        }
        const g = this._groundY(a.mesh.position.x, a.mesh.position.z);
        if (g) {
          const targetY = g.y + a.hover;
          a.baseY += (targetY - a.baseY) * Math.min(1, dt * 1.5);   // 平滑升降
        }
        a.mesh.position.y = a.baseY + Math.sin(a.phase * 0.5) * 0.8;
        // 翅膀扑扇（蝴蝶轻快、鸟沉稳）
        const wings = a.mesh.userData.wings;
        if (wings) {
          const rate = a.kind === 'butterfly' ? 3.4 : 2.5;
          const amp  = a.kind === 'butterfly' ? 0.95 : 0.7;
          wings[0].rotation.z =  Math.sin(a.phase * rate) * amp;
          wings[1].rotation.z = -Math.sin(a.phase * rate) * amp;
        }
        // 飞行姿态：机身沿升降微俯仰
        a.mesh.rotation.x = Math.cos(a.phase * 0.5) * 0.1;
        a.mesh.rotation.y = a.yaw + Math.PI;   // 模型头在 -z，移动方向是 +z 局部 → 转半圈让头朝前
        continue;
      }

      if (a.info.water) {
        // 鱼：水中巡游
        if (moving) {
          const nx = a.mesh.position.x + Math.sin(a.yaw) * speed * dt;
          const nz = a.mesh.position.z + Math.cos(a.yaw) * speed * dt;
          const b = this.world.getBlock(Math.floor(nx), Math.floor(a.mesh.position.y), Math.floor(nz));
          if (b === BLOCK.WATER) { a.mesh.position.x = nx; a.mesh.position.z = nz; }
          else a.yaw += Math.PI * 0.7;   // 撞岸掉头
        }
        a.mesh.position.y = a.baseY + Math.sin(a.phase * 0.7) * 0.3;
        a.mesh.rotation.y = a.yaw + Math.PI;   // 头朝移动方向
        a.mesh.rotation.z = Math.sin(a.phase * 1.5) * 0.12;
        // 尾鳍左右摆（游动时更快）
        const ft = a.mesh.userData.tail;
        if (ft) ft.rotation.y = Math.sin(a.phase * (moving ? 2.6 : 1.2)) * 0.55;
        continue;
      }

      // 陆地动物：走 + 贴地 + 遇障碍转向
      // 【关键】y = groundLevel（平滑贴地基准）+ 跳跃偏移，每帧重算而非累加，杜绝"越跳越高飞上天"
      if (moving) {
        const nx = a.mesh.position.x + Math.sin(a.yaw) * speed * dt;
        const nz = a.mesh.position.z + Math.cos(a.yaw) * speed * dt;
        const g = this._groundY(nx, nz);
        if (g && g.block !== BLOCK.WATER && Math.abs(g.y - a.groundLevel) < 1.5) {
          a.mesh.position.x = nx;
          a.mesh.position.z = nz;
          a.groundLevel += (g.y - a.groundLevel) * Math.min(1, dt * 10);
        } else {
          a.yaw += Math.PI * (0.5 + Math.random() * 0.5);
        }
      } else {
        // idle 时也要维护贴地基准——脚下被挖空则落到真实地面，遵守物理法则
        // 快检：先看脚下那格是否是实体，不是才做完整 _groundY 扫描（省性能）
        const underBlock = this.world.getBlock(
          Math.floor(a.mesh.position.x),
          Math.floor(a.groundLevel - 0.1),
          Math.floor(a.mesh.position.z)
        );
        if (!BLOCK_META[underBlock]?.solid) {
          const g = this._groundY(a.mesh.position.x, a.mesh.position.z);
          if (g && g.block !== BLOCK.WATER) {
            a.groundLevel += (g.y - a.groundLevel) * Math.min(1, dt * 8);
          }
        }
      }
      // 走路弹跳（兔子跳更高），静止时稳稳贴地
      const hop = a.kind === 'rabbit' ? 0.22 : 0.06;
      a.mesh.position.y = a.groundLevel + (moving ? Math.abs(Math.sin(a.phase)) * hop : 0);
      a.mesh.rotation.y = a.yaw + Math.PI;   // 头朝移动方向（模型头在 -z）

      /* ===== 关节动画 ===== */
      const ud = a.mesh.userData;
      // 四肢迈步：对角步态（0/3 同相、1/2 反相），停下时腿收回
      if (ud.legs) {
        const swing = moving ? Math.sin(a.phase * 1.6) * (a.state === 'flee' ? 0.85 : 0.55) : 0;
        ud.legs.forEach((leg, i) => {
          const target = (i === 0 || i === 3) ? swing : -swing;
          leg.rotation.x += (target - leg.rotation.x) * Math.min(1, dt * 12);
        });
      }
      // 头部：走路轻点头，idle 时偶尔左右张望（低频噪声）
      if (ud.head) {
        const nod  = moving ? Math.sin(a.phase * 1.6) * 0.07 : 0;
        const look = moving ? 0 : Math.sin(a.phase * 0.23 + a.mesh.position.x) * 0.4;
        ud.head.rotation.x += (nod  - ud.head.rotation.x) * Math.min(1, dt * 8);
        ud.head.rotation.y += (look - ud.head.rotation.y) * Math.min(1, dt * 3);
      }
      // 尾巴：持续轻摆，被摸/逃跑时猛摇
      if (ud.tail) {
        const wagRate = a.state === 'flee' ? 9 : 2.2;
        const wagAmp  = a.state === 'flee' ? 0.5 : 0.18;
        ud.tail.rotation.y = Math.sin(a.phase * wagRate) * wagAmp;
      }
    }
  }

  _updateVillagers(dt, playerPos) {
    for (const v of this.villagers) {
      if (v.talkCooldown > 0) v.talkCooldown -= dt;
      v.timer -= dt;

      // v5.1 远距降级：>62 格的村民冻结行为/动画（30 个村民分布在 6 村，同时可见至多 1~2 村）
      {
        const ddx = v.mesh.position.x - playerPos.x;
        const ddz = v.mesh.position.z - playerPos.z;
        if (ddx * ddx + ddz * ddz > 62 * 62) continue;
      }
      v.phase = (v.phase || 0) + dt * 6;
      const ud = v.mesh.userData;

      // 玩家靠近：面向玩家打招呼（水平2D距离，消除坡面偏差）
      const _vdx = v.mesh.position.x - playerPos.x, _vdz = v.mesh.position.z - playerPos.z;
      const distP = Math.sqrt(_vdx * _vdx + _vdz * _vdz);
      if (distP < 4) {
        // 脸朝玩家（模型脸在 -z）
        v.mesh.rotation.y = Math.atan2(playerPos.x - v.mesh.position.x, playerPos.z - v.mesh.position.z) + Math.PI;
        if (!v._greeted && v.talkCooldown <= 0) {
          v._greeted = true;
          v._waveT = 1.6;                     // 挥手 1.6s
          // 提示按设备给：移动端没有 E 键，指向 💕互动 按钮
          const hint = ('ontouchstart' in window) ? '点 💕互动 交谈' : '按 E 交谈';
          window.gameUI?.toast(`👋 ${v.name}向你招手（${hint}）`);
          v.talkCooldown = 3;
        }
        // 挥手动画：右臂举起摆动，其余肢体归位
        if (v._waveT > 0) {
          v._waveT -= dt;
          if (ud.arms) {
            ud.arms[1].rotation.x = -Math.PI * 0.9;
            ud.arms[1].rotation.z = Math.sin(v.phase * 2.5) * 0.4;
            ud.arms[0].rotation.x *= 0.85;
          }
        } else if (ud.arms) {
          ud.arms.forEach(arm => { arm.rotation.x *= 0.85; arm.rotation.z *= 0.85; });
        }
        if (ud.legs) ud.legs.forEach(leg => leg.rotation.x *= 0.85);
        if (ud.head) { ud.head.rotation.x *= 0.85; ud.head.rotation.y *= 0.85; }
        continue;
      }
      v._greeted = false;

      // v5：昼夜作息——夜里回家门口待着，白天偶尔去农田边转悠
      const t = this._dayTime ?? 0.3;
      const isNight = t < 0.22 || t > 0.80;
      if (isNight && v.home) {
        const hx = v.home.x - v.mesh.position.x;
        const hz = v.home.z - v.mesh.position.z;
        const hd = Math.sqrt(hx * hx + hz * hz);
        if (hd > 2) {
          // 还没到家：朝家门口走。方向每 1.2s 校准一次（而非每帧），
          // 给撞墙转向逻辑留出绕行时间，防止顶着墙原地抖
          if (v.timer <= 0 || v.state !== 'walk') {
            v.state = 'walk';
            v.yaw = Math.atan2(hx, hz);
            v.timer = 1.2;
          }
        } else if (v.state === 'walk') {
          // 到家了：站定休息（idle 时的张望动画照常）
          v.state = 'idle';
          v.timer = 3 + Math.random() * 4;
        }
      } else if (v.timer <= 0) {
        v.state = v.state === 'idle' ? 'walk' : 'idle';
        v.timer = v.state === 'walk' ? 2 + Math.random() * 3 : 1.5 + Math.random() * 4;
        // 白天 25% 概率朝农田方向走，其余绕村中心游走
        const dx = v.mesh.position.x - v.village.x;
        const dz = v.mesh.position.z - v.village.z;
        if (v.state === 'walk' && v.farm && Math.random() < 0.25) {
          v.yaw = Math.atan2(v.farm.x - v.mesh.position.x, v.farm.z - v.mesh.position.z);
        } else if (Math.sqrt(dx * dx + dz * dz) > v.village.r - 3) {
          v.yaw = Math.atan2(v.village.x - v.mesh.position.x, v.village.z - v.mesh.position.z);
        } else {
          v.yaw = Math.random() * Math.PI * 2;
        }
      }

      const walking = v.state === 'walk';
      if (walking) {
        const speed = 1.1;
        const nx = v.mesh.position.x + Math.sin(v.yaw) * speed * dt;
        const nz = v.mesh.position.z + Math.cos(v.yaw) * speed * dt;
        const g = this._groundY(nx, nz);
        if (g && g.block !== BLOCK.WATER && Math.abs(g.y - v.mesh.position.y) < 1.5) {
          v.mesh.position.x = nx;
          v.mesh.position.z = nz;
          v.mesh.position.y += (g.y - v.mesh.position.y) * Math.min(1, dt * 10);
          v.mesh.rotation.y = v.yaw + Math.PI;   // 脸朝行走方向
        } else {
          v.yaw += Math.PI * 0.6;
        }
      } else {
        // idle 时维护贴地——脚下被挖空则下落到真实地面，遵守物理法则
        const underBlock = this.world.getBlock(
          Math.floor(v.mesh.position.x),
          Math.floor(v.mesh.position.y - 0.1),
          Math.floor(v.mesh.position.z)
        );
        if (!BLOCK_META[underBlock]?.solid) {
          const g = this._groundY(v.mesh.position.x, v.mesh.position.z);
          if (g && g.block !== BLOCK.WATER) {
            v.mesh.position.y += (g.y - v.mesh.position.y) * Math.min(1, dt * 8);
          }
        }
      }

      // 肢体动画：走路摆臂迈腿（反相），idle 时缓慢归位 + 偶尔张望
      const swing = walking ? Math.sin(v.phase * 1.4) * 0.5 : 0;
      if (ud.legs) {
        ud.legs[0].rotation.x += ( swing - ud.legs[0].rotation.x) * Math.min(1, dt * 10);
        ud.legs[1].rotation.x += (-swing - ud.legs[1].rotation.x) * Math.min(1, dt * 10);
      }
      if (ud.arms) {
        ud.arms[0].rotation.x += (-swing * 0.8 - ud.arms[0].rotation.x) * Math.min(1, dt * 10);
        ud.arms[1].rotation.x += ( swing * 0.8 - ud.arms[1].rotation.x) * Math.min(1, dt * 10);
        ud.arms[0].rotation.z *= 0.9; ud.arms[1].rotation.z *= 0.9;
      }
      if (ud.head) {
        const look = walking ? 0 : Math.sin(v.phase * 0.2 + v.mesh.position.z) * 0.45;
        ud.head.rotation.y += (look - ud.head.rotation.y) * Math.min(1, dt * 3);
      }
    }
  }

  _updateStars(dt, playerPos) {
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const st = this.stars[i];
      st.phase += dt * 2;
      st.mesh.rotation.y += dt * 2.2;
      st.mesh.position.y = st.baseY + Math.sin(st.phase) * 0.18;
      st.light.intensity = 0.6 + Math.sin(st.phase * 1.7) * 0.3;
      // v5：彩虹星色相流转（发光色 + 点光颜色同步循环）
      if (st.rainbow) {
        const hue = (st.phase * 0.12) % 1;
        st.mesh.material.emissive.setHSL(hue, 0.9, 0.55);
        st.light.color.setHSL(hue, 0.9, 0.6);
      }

      // 拾取判定：用玩家中心高度（脚底 +0.875）而非脚底，星星浮在 g.y+0.8 对应胸腔位置，
      // 避免"星星在头顶高台上，脚底距离>1.6 捡不到"或"星星恰好在凹坑要蹲进去才触发"
      const px = playerPos.x, py = playerPos.y + 0.875, pz = playerPos.z;
      const sdx = st.mesh.position.x - px, sdy = st.mesh.position.y - py, sdz = st.mesh.position.z - pz;
      if (sdx * sdx + sdy * sdy + sdz * sdz < 1.6 * 1.6) {
        const wasRainbow = st.rainbow;
        this._disposeMesh(st.mesh);
        this.scene.remove(st.light);
        this.stars.splice(i, 1);
        this.starCollected += wasRainbow ? 5 : 1;   // v5：彩虹星计 5 颗
        try { localStorage.setItem('myflicker-v4-stars', String(this.starCollected)); } catch {}
        if (wasRainbow) {
          window.gameUI?.toast(`🌈 彩虹星！+5 → ⭐×${this.starCollected}`);
          window.gameAudio?.rainbowStar();
          window.gameUI?.unlockAchievement('rainbow');
        } else {
          window.gameUI?.toast(`⭐ 收集星星 ×${this.starCollected}`);
          window.gameAudio?.star();
        }
        window.gameUI?.unlockAchievement('star1');
        if (this.starCollected >= 10)  window.gameUI?.unlockAchievement('star10');
        // v5：里程碑成就
        if (this.starCollected >= 25)  window.gameUI?.unlockAchievement('star25');
        if (this.starCollected >= 50)  window.gameUI?.unlockAchievement('star50');
        if (this.starCollected >= 100) window.gameUI?.unlockAchievement('star100');
        // 在玩家附近补一颗新星
        this._spawnStar(playerPos.x, playerPos.z);
      }
    }
    // 星星不足则补充
    if (this.stars.length < STAR_COUNT_ON && Math.random() < dt * 0.5) {
      this._spawnStar(playerPos.x, playerPos.z);
    }
  }
}
