/**
 * interaction.js — 射线拾取 + 放置/破坏 v3
 * 新增：音效联动、准星反馈、放置/破坏计数（成就）
 */

const REACH = 7;

class Interaction {
  constructor(camera, world, canvas) {
    this.camera = camera;
    this.world  = world;
    this.canvas = canvas;

    this.targeted  = null;
    this.placeFace = null;

    this.placedCount = 0;
    this.brokenCount = 0;

    this.highlightMesh = this._makeHighlight();
    this.highlightMesh.visible = false;

    this.particles = this._makeParticleSystem();

    this._crosshair = document.getElementById('crosshair');
    this._initEvents();
  }

  _makeHighlight() {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    return new THREE.LineSegments(geo, mat);
  }

  _makeParticleSystem() {
    const count = 60;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.13, color: 0xddbb88,
      transparent: true, opacity: 1, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.userData = { vel, life: 0, maxLife: 0.6, count };
    return pts;
  }

  _spawnParticles(wx, wy, wz, color) {
    const p = this.particles;
    const posArr = p.geometry.attributes.position.array;
    const velArr = p.userData.vel;
    const cnt = p.userData.count;
    for (let i = 0; i < cnt; i++) {
      posArr[i*3]   = wx + 0.5 + (Math.random() - 0.5) * 0.6;
      posArr[i*3+1] = wy + 0.5 + (Math.random() - 0.5) * 0.6;
      posArr[i*3+2] = wz + 0.5 + (Math.random() - 0.5) * 0.6;
      velArr[i*3]   = (Math.random() - 0.5) * 4;
      velArr[i*3+1] = Math.random() * 3 + 1;
      velArr[i*3+2] = (Math.random() - 0.5) * 4;
    }
    p.geometry.attributes.position.needsUpdate = true;
    p.material.color.set(color || 0xddbb88);
    p.material.opacity = 1;
    p.visible = true;
    p.userData.life = 0;
  }

  updateParticles(dt) {
    const p = this.particles;
    if (!p.visible) return;
    p.userData.life += dt;
    const t = p.userData.life / p.userData.maxLife;
    if (t >= 1) { p.visible = false; return; }

    const posArr = p.geometry.attributes.position.array;
    const velArr = p.userData.vel;
    const cnt = p.userData.count;
    p.material.opacity = 1 - t;

    for (let i = 0; i < cnt; i++) {
      posArr[i*3]   += velArr[i*3]   * dt;
      posArr[i*3+1] += velArr[i*3+1] * dt;
      posArr[i*3+2] += velArr[i*3+2] * dt;
      velArr[i*3+1] -= 10 * dt;
    }
    p.geometry.attributes.position.needsUpdate = true;
  }

  _initEvents() {
    this.canvas.addEventListener('mousedown', e => {
      if (document.pointerLockElement !== this.canvas) return;
      // 左键破坏，右键放置（Minecraft 惯例）
      if (e.button === 0) this.breakBlock();
      if (e.button === 2) this.placeBlock();
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _pulseCrosshair() {
    if (!this._crosshair) return;
    this._crosshair.classList.add('hit');
    clearTimeout(this._chTimer);
    this._chTimer = setTimeout(() => this._crosshair.classList.remove('hit'), 90);
  }

  /* ===== 射线步进 ===== */
  raycast() {
    this.targeted  = null;
    this.placeFace = null;
    this.highlightMesh.visible = false;

    // 复用向量增量步进（旧版每帧 clone ~175 个 Vector3，GC 压力大）
    this._rayDir = this._rayDir || new THREE.Vector3();
    this._rayPos = this._rayPos || new THREE.Vector3();
    const dir = this._rayDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const p   = this._rayPos.copy(this.camera.position);
    const step = 0.04;
    dir.multiplyScalar(step);            // 每步位移
    let prevX = 0, prevY = 0, prevZ = 0, hasPrev = false;
    let lastBx = 1e9, lastBy = 1e9, lastBz = 1e9;

    const steps = Math.ceil(REACH / step);
    for (let i = 1; i <= steps; i++) {
      p.add(dir);
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      // 同一方块内的微步跳过 getBlock（步长 0.04，一格要走 25 步）
      if (bx === lastBx && by === lastBy && bz === lastBz) continue;
      lastBx = bx; lastBy = by; lastBz = bz;
      const type = this.world.getBlock(bx, by, bz);

      // 可选中：非空气、非水（花可以被破坏，所以可选中）
      if (type !== BLOCK.AIR && type !== BLOCK.WATER) {
        this.targeted  = { wx: bx, wy: by, wz: bz, type };
        this.placeFace = hasPrev ? { wx: prevX, wy: prevY, wz: prevZ } : null;
        this.highlightMesh.position.set(bx + 0.5, by + 0.5, bz + 0.5);
        this.highlightMesh.visible = true;
        return;
      }
      prevX = bx; prevY = by; prevZ = bz; hasPrev = true;
    }
  }

  breakBlock() {
    if (!this.targeted) return;
    const { wx, wy, wz, type } = this.targeted;
    this._spawnParticles(wx, wy, wz, getBlockPreviewColor(type));
    this.world.setBlock(wx, wy, wz, BLOCK.AIR);
    this.targeted = null;
    this.highlightMesh.visible = false;
    this._pulseCrosshair();
    window.gameAudio?.break_();

    this.brokenCount++;
    if (type === BLOCK.COZE) window.gameUI?.unlockAchievement('breakCoze');
    if (this.brokenCount === 1)  window.gameUI?.unlockAchievement('firstBreak');
    if (this.brokenCount === 50) window.gameUI?.unlockAchievement('digger');
  }

  placeBlock() {
    if (!this.placeFace) return;
    const { wx, wy, wz } = this.placeFace;
    const ph = window.gamePhysics;
    if (ph) {
      // AABB 相交检测：玩家半径 0.3 会跨方块边界，只查中心列会把方块放进自己身体里卡死
      const p = ph.position, r = 0.3, h = 1.75;
      if (p.x - r < wx + 1 && p.x + r > wx &&
          p.y     < wy + 1 && p.y + h > wy &&
          p.z - r < wz + 1 && p.z + r > wz) return;
    }
    const type = window.gameUI?.selectedBlock ?? BLOCK.GRASS;
    this.world.setBlock(wx, wy, wz, type);
    this._pulseCrosshair();
    window.gameAudio?.place();

    this.placedCount++;
    if (this.placedCount === 1)   window.gameUI?.unlockAchievement('firstPlace');
    if (this.placedCount === 100) window.gameUI?.unlockAchievement('builder');
  }

  update(dt) {
    this.raycast();
    this.updateParticles(dt);
  }
}
