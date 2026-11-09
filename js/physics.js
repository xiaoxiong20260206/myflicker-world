/**
 * physics.js — 重力 & AABB 碰撞 v3
 * 新增：游泳（水中浮力/减速）、飞行模式、head-in-water 检测
 */

const GRAVITY        = -30;
const JUMP_VEL       = 10;
const PLAYER_H       = 1.75;
const PLAYER_R       = 0.3;
const PLAYER_EYE_OFF = 1.62;

const WATER_GRAVITY  = -6;     // 水中缓沉
const SWIM_UP_VEL    = 5.5;    // 按空格上浮
const WATER_DRAG     = 0.55;   // 水平减速
const FLY_SPEED_Y    = 9;      // 飞行升降速度

class Physics {
  constructor(world) {
    this.world    = world;
    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3(0.5, GROUND_Y + 3, 10);
    this.onGround = false;
    this.inWater  = false;   // 身体在水中
    this.headInWater = false;
    this.flying   = false;
    this.flyUp    = false;   // 飞行升降输入
    this.flyDown  = false;
    this._jumpBuf = 0;       // v5.1 跳跃缓冲：提前按跳也算数
    this._coyote  = 0;       // v5.1 土狼时间：刚离地仍可起跳
    this._eye     = new THREE.Vector3();   // eyePosition 复用，免每帧分配
  }

  jump() {
    if (this.flying) return;
    if (this.inWater) {
      this.velocity.y = SWIM_UP_VEL;
      return;
    }
    // 不再要求"此刻正好 onGround"——记入 0.15s 缓冲，由 update 在贴地/土狼窗口内兑现。
    // 修复：跑动中 onGround 存在单帧闪烁，直接判 onGround 会吞掉约一半跳跃输入
    this._jumpBuf = 0.15;
  }

  toggleFly() {
    this.flying = !this.flying;
    this.velocity.y = 0;
    this._jumpBuf = 0;   // 双击空格的第一下会进缓冲，切飞行时作废（防关飞行瞬间凭空弹跳）
    this._coyote  = 0;
    if (this.flying) {
      window.gameAudio?.flyOn();
    } else {
      // 关闭飞行时：若玩家穿进了实体方块内（穿山后关飞），自动向上弹出，防卡墙
      let safety = 0;
      while (this._collides() && safety < 8) {
        this.position.y += 0.25;
        safety++;
      }
      window.gameAudio?.flyOff();
    }
    return this.flying;
  }

  _blockAt(x, y, z) {
    return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  _updateWaterState() {
    const wasIn = this.inWater;
    const bodyBlock = this._blockAt(this.position.x, this.position.y + 0.6, this.position.z);
    const headBlock = this._blockAt(this.position.x, this.position.y + PLAYER_EYE_OFF, this.position.z);
    this.inWater     = bodyBlock === BLOCK.WATER;
    this.headInWater = headBlock === BLOCK.WATER;
    // 入水溅水音效：阈值从 -4 降到 -1.5，跳进浅水也能触发
    if (!wasIn && this.inWater && this.velocity.y < -1.5) window.gameAudio?.splash();
  }

  update(dt, move) {
    // 【守卫】所在区块尚未生成时冻结物理（云存档恢复远处位置 / 飞行超出生成速度），
    // 否则 getBlock 全返回 AIR → 无碰撞自由落体 → 掉虚空被弹回出生点
    const ch = this.world.getChunk(
      Math.floor(this.position.x / CHUNK_SIZE),
      Math.floor(this.position.z / CHUNK_SIZE)
    );
    if (!ch) { this.velocity.set(0, 0, 0); return; }

    this._updateWaterState();

    /* ===== 飞行模式 ===== */
    if (this.flying) {
      this.velocity.x = move.x;
      this.velocity.z = move.z;
      this.velocity.y = (this.flyUp ? FLY_SPEED_Y : 0) + (this.flyDown ? -FLY_SPEED_Y : 0);
      this._integrate(dt, true);
      return;
    }

    /* ===== 水中 ===== */
    if (this.inWater) {
      this._jumpBuf = 0;   // 入水后残留的跳跃缓冲作废（水里由 jump() 直接上浮）
      this.velocity.x = move.x * WATER_DRAG;
      this.velocity.z = move.z * WATER_DRAG;
      this.velocity.y += WATER_GRAVITY * dt;
      this.velocity.y = Math.max(this.velocity.y, -3.2);  // 终端沉速
      this._integrate(dt, false);
      return;
    }

    /* ===== 常规 ===== */
    this.velocity.x = move.x;
    this.velocity.z = move.z;

    // v5.1 土狼时间：贴地刷新，离地后 0.1s 内仍视为"可跳"
    // （onGround 在平地行走时会因 dy=0 每帧闪烁 true/false，土狼窗口把闪烁抹平）
    if (this.onGround) this._coyote = 0.1;
    else this._coyote = Math.max(0, this._coyote - dt);

    // 兑现跳跃缓冲：按键时刻不必正好贴地，窗口内落地即起跳
    if (this._jumpBuf > 0) {
      this._jumpBuf -= dt;
      if (this._coyote > 0 && this.velocity.y <= 0.01) {
        this.velocity.y = JUMP_VEL;
        this.onGround = false;
        this._coyote = 0;
        this._jumpBuf = 0;
        window.gameAudio?.jump();
      }
    }

    // 重力恒定作用（贴地时每帧被碰撞清零）。
    // 旧实现"onGround 时 velocity.y=0 → dy=0 → Y 轴判定悬空"导致 onGround 隔帧闪烁：
    // 跑动中跳跃约一半输入被吞、视角摆动/冲刺 FOV 抖动，全是它引起的
    this.velocity.y += GRAVITY * dt;
    this._integrate(dt, false);
  }

  _integrate(dt, noGroundReset) {
    const dx = this.velocity.x * dt;
    const dy = this.velocity.y * dt;
    const dz = this.velocity.z * dt;

    // 飞行模式：直接平移，跳过所有碰撞（穿山/穿水自由飞行，与 Minecraft 创造模式一致）
    if (noGroundReset) {
      this.position.x += dx;
      this.position.y += dy;
      this.position.z += dz;
      if (this.position.y < -10) {
        this.position.set(0.5, GROUND_Y + 4, 10);
        this.velocity.set(0, 0, 0);
        this.flying = false;
        window.gameUI?.toast('🪂 你掉出了世界，已送回出生点', true);
      }
      return;
    }

    this.position.x += dx;
    if (this._collides()) { this.position.x -= dx; this.velocity.x = 0; }

    this.position.y += dy;
    if (this._collides()) {
      this.position.y -= dy;
      this.onGround = dy < 0;
      this.velocity.y = 0;
    } else {
      this.onGround = false;
    }

    this.position.z += dz;
    if (this._collides()) { this.position.z -= dz; this.velocity.z = 0; }

    // 坠落重置
    if (this.position.y < -10) {
      this.position.set(0.5, GROUND_Y + 4, 10);
      this.velocity.set(0, 0, 0);
      this.flying = false;
      window.gameUI?.toast('🪂 你掉出了世界，已送回出生点', true);
    }
  }

  _collides() {
    const { x, y, z } = this.position;
    const r = PLAYER_R, h = PLAYER_H;
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) {
      for (let by = Math.floor(y); by <= Math.floor(y + h); by++) {
        for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++) {
          const t = this.world.getBlock(bx, by, bz);
          const meta = BLOCK_META[t];
          if (t !== BLOCK.AIR && meta?.solid) {
            if (x - r < bx + 1 && x + r > bx &&
                y     < by + 1 && y + h > by &&
                z - r < bz + 1 && z + r > bz) return true;
          }
        }
      }
    }
    return false;
  }

  get eyePosition() {
    // 复用向量（每帧都调，避免 GC 抖动）
    return this._eye.set(
      this.position.x,
      this.position.y + PLAYER_EYE_OFF,
      this.position.z
    );
  }
}
