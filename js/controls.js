/**
 * controls.js — 第一人称控制 v3
 * 新增：双击空格切换飞行、飞行升降（空格/Shift）、视角平滑、行走摆动
 */

const MOVE_SPEED  = 6;
const FLY_SPEED   = 11;
const MOUSE_SENS  = 0.0022;
const TOUCH_SENS  = 0.0075;   // v5.3：0.0065 → 0.0075，移动端视角更跟手
const SPRINT_MULT = 1.8;

class Controls {
  constructor(camera, canvas, physics) {
    this.camera  = camera;
    this.canvas  = canvas;
    this.physics = physics;
    this.yaw     = 0;         // 出生面向 -Z（COZE 神殿方向）
    this.pitch   = 0;
    this.keys    = {};
    this.locked  = false;

    this._lastSpaceTime = 0;   // 双击空格检测
    this.bobPhase = 0;         // 行走摆动
    this._baseFov = camera.fov;   // FOV 动态拉伸（冲刺/飞行提速感）
    this._stepTimer = 0;          // 脚步声节拍

    this.joystick  = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
    this.lookTouch = { active: false, id: null, lx: 0, ly: 0 };
    // 触屏视角平滑：触摸采样是离散跳变（60~120Hz 不均匀），直接加到 yaw 会一顿一顿；
    // 把增量先积到 pending，再按帧以强跟随系数消化，既顺滑又几乎无延迟
    this._pendYaw = 0;
    this._pendPitch = 0;

    // 每帧复用的临时向量/欧拉角（update 60fps 高频调用，避免反复 new 触发 GC 卡顿）
    this._fwd = new THREE.Vector3();
    this._rgt = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this._initPointerLock();
    this._initKeyboard();
    this._initMobile();
  }

  /* ===== 指针锁定 ===== */
  _initPointerLock() {
    this.canvas.addEventListener('click', () => {
      if (!this.locked && !('ontouchstart' in window)) this.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      document.getElementById('overlay').classList.toggle('hidden', this.locked);
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.yaw   -= e.movementX * MOUSE_SENS;
      this.pitch -= e.movementY * MOUSE_SENS;
      this.pitch  = Math.max(-Math.PI/2 + 0.02, Math.min(Math.PI/2 - 0.02, this.pitch));
    });
  }

  /* ===== 键盘 ===== */
  _initKeyboard() {
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;

      if (e.code === 'Space' && this.locked) {
        e.preventDefault();
        // 按住不放触发的系统连发（e.repeat）不能进双击检测——
        // 否则在水里按住空格上浮时，两次 repeat 间隔 <280ms 会被误判成双击、莫名开启飞行
        if (e.repeat) {
          if (!this.physics.flying) this.physics.jump();   // 按住＝持续游泳上浮/落地连跳
          return;
        }
        const now = performance.now();
        if (now - this._lastSpaceTime < 280) {
          // 双击空格 → 切换飞行
          const flying = this.physics.toggleFly();
          window.gameUI?.toast(flying ? '🕊️ 飞行模式开启' : '🚶 飞行模式关闭', true);
          if (flying) window.gameUI?.unlockAchievement('fly');
          this._lastSpaceTime = 0;
        } else {
          this._lastSpaceTime = now;
          if (this.physics.flying) this.physics.flyUp = true;
          else this.physics.jump();
        }
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (this.physics.flying) this.physics.flyDown = true;
      }
      if (e.code === 'Escape') {
        document.exitPointerLock();
        document.getElementById('overlay').classList.remove('hidden');
      }
    });
    document.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Space') this.physics.flyUp = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.physics.flyDown = false;
    });

    document.addEventListener('wheel', e => {
      if (!this.locked) return;
      window.gameUI?.scrollHotbar(e.deltaY > 0 ? 1 : -1);
    });

    document.addEventListener('keydown', e => {
      if (!this.locked) return;
      const m = e.code.match(/^Digit(\d)$/);
      if (m) {
        const n = Number(m[1]);
        window.gameUI?.selectSlot(n === 0 ? 9 : n - 1);
      }
    });
  }

  /* ===== 移动端 ===== */
  _initMobile() {
    const jz   = document.getElementById('joystick-zone');
    const knob = document.getElementById('joystick-knob');
    const jump = document.getElementById('jump-btn');
    const bpl  = document.getElementById('btn-place');
    const bbr  = document.getElementById('btn-break');
    const bfly = document.getElementById('btn-fly');
    const bint = document.getElementById('btn-interact');
    const bdes = document.getElementById('btn-desc');
    const menu = document.getElementById('menu-btn');
    if (!jz) return;
    this._btnDesc = bdes;

    const MAX_R = 46;
    const JZ_HALF = 65;   // 摇杆盘半径（130/2）

    /* --- 动态摇杆 + 视角：canvas 统一接管触摸 ---
       左 45% 屏幕：摇杆吸附到指尖出现；其余区域：滑动转视角 */
    this.canvas.addEventListener('touchstart', e => {
      document.getElementById('overlay').classList.add('hidden');
      this.locked = true;
      window.gameAudio?.init();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && !this.joystick.active) {
          // 摇杆出现在指尖处
          jz.classList.add('active');
          jz.style.left   = (t.clientX - JZ_HALF) + 'px';
          jz.style.top    = (t.clientY - JZ_HALF) + 'px';
          jz.style.bottom = 'auto';
          knob.style.transform = 'translate(-50%, -50%)';
          this.joystick = { active: true, id: t.identifier, cx: t.clientX, cy: t.clientY, dx: 0, dy: 0 };
        } else if (!this.lookTouch.active) {
          this.lookTouch = { active: true, id: t.identifier, lx: t.clientX, ly: t.clientY };
        }
      }
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (this.joystick.active && t.identifier === this.joystick.id) {
          let dx = t.clientX - this.joystick.cx;
          let dy = t.clientY - this.joystick.cy;
          const len = Math.sqrt(dx*dx + dy*dy);
          if (len > MAX_R) {
            // 摇杆跟随重锚：手指超出行程时把杆心拖着走。
            // 反向变向不用先划回原点，拇指小幅回拉立即反映——手感提升关键
            const k = (len - MAX_R) / len;
            this.joystick.cx += dx * k;
            this.joystick.cy += dy * k;
            jz.style.left = (this.joystick.cx - JZ_HALF) + 'px';
            jz.style.top  = (this.joystick.cy - JZ_HALF) + 'px';
            dx = dx/len*MAX_R; dy = dy/len*MAX_R;
          }
          this.joystick.dx = dx / MAX_R;
          this.joystick.dy = dy / MAX_R;
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }
        if (this.lookTouch.active && t.identifier === this.lookTouch.id) {
          this._pendYaw   -= (t.clientX - this.lookTouch.lx) * TOUCH_SENS;
          this._pendPitch -= (t.clientY - this.lookTouch.ly) * TOUCH_SENS;
          this.lookTouch.lx = t.clientX;
          this.lookTouch.ly = t.clientY;
        }
      }
    }, { passive: true });

    const releaseTouch = e => {
      for (const t of e.changedTouches) {
        if (this.joystick.active && t.identifier === this.joystick.id) {
          this.joystick.active = false;
          this.joystick.dx = this.joystick.dy = 0;
          knob.style.transform = 'translate(-50%, -50%)';
          jz.classList.remove('active');
          jz.style.left = jz.style.top = jz.style.bottom = '';   // 归位停靠点
        }
        if (this.lookTouch.active && t.identifier === this.lookTouch.id)
          this.lookTouch.active = false;
      }
    };
    document.addEventListener('touchend', releaseTouch);
    document.addEventListener('touchcancel', releaseTouch);   // 来电/系统手势打断兜底

    /* --- 按钮通用绑定：按压视觉反馈 + 轻震动 + touchcancel 兜底 --- */
    const press = (el, onDown, onUp) => {
      if (!el) return;
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();               // 别让触摸漏到 canvas 误转视角
        el.classList.add('pressed');
        try { navigator.vibrate?.(8); } catch {}   // 触觉反馈（Android；iOS 忽略）
        onDown && onDown();
      }, { passive: false });
      const end = () => { el.classList.remove('pressed'); onUp && onUp(); };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    };

    /* --- 长按连续触发（挖矿/搭建不用狂点） --- */
    const holdRepeat = (el, fn, interval) => {
      let timer = null;
      press(el,
        () => { fn(); timer = setInterval(fn, interval); },
        () => { if (timer) { clearInterval(timer); timer = null; } });
    };

    // 跳跃：飞行时按住上升；水中/地面按住连跳（由 update 每帧喂入跳跃缓冲）
    press(jump,
      () => {
        if (this.physics.flying) { this.physics.flyUp = true; return; }
        this._jumpHeld = true;
        this.physics.jump();
      },
      () => {
        this.physics.flyUp = false;
        this._jumpHeld = false;
      });

    // 下降键（飞行时显示，按住下降）
    press(bdes,
      () => { this.physics.flyDown = true; },
      () => { this.physics.flyDown = false; });

    // 飞行开关
    press(bfly, () => {
      const flying = this.physics.toggleFly();
      window.gameUI?.toast(flying ? '🕊️ 飞行模式开启' : '🚶 飞行模式关闭', true);
      if (flying) window.gameUI?.unlockAchievement('fly');
    });

    // 放置/破坏：长按连续（v5.3：破坏190ms、放置220ms——原240/280ms节奏偏慢）
    holdRepeat(bpl, () => window.gameInteraction?.placeBlock(), 220);
    holdRepeat(bbr, () => window.gameInteraction?.breakBlock(), 190);

    // 互动（摸动物/聊天）
    press(bint, () => window.gameEntities?.interact(this.physics.position, this.camera));

    // 菜单键：暂停回到开始页（登录/排行榜/昵称入口）
    press(menu, () => {
      this.locked = false;
      document.getElementById('overlay').classList.remove('hidden');
    });
  }

  /* ===== 每帧更新 ===== */
  update(dt) {
    // 触屏视角：按帧消化积累的增量（约 70%/帧 @60fps），滑动更跟手不跳帧
    if (this._pendYaw || this._pendPitch) {
      const k = Math.min(1, dt * 42);
      this.yaw   += this._pendYaw * k;
      this.pitch += this._pendPitch * k;
      this._pendYaw   *= (1 - k);
      this._pendPitch *= (1 - k);
      if (Math.abs(this._pendYaw) < 1e-5)   this._pendYaw = 0;
      if (Math.abs(this._pendPitch) < 1e-5) this._pendPitch = 0;
      this.pitch = Math.max(-Math.PI/2 + 0.02, Math.min(Math.PI/2 - 0.02, this.pitch));
    }

    const fwd = this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rgt = this._rgt.set( Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dir = this._dir.set(0, 0, 0);
    const sprintKey = this.keys['ShiftLeft'] || this.keys['ShiftRight'];

    if (this.keys['KeyW'] || this.keys['ArrowUp'])    dir.addScaledVector(fwd,  1);
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  dir.addScaledVector(fwd, -1);
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  dir.addScaledVector(rgt, -1);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dir.addScaledVector(rgt,  1);

    // 摇杆推满（>92%）自动冲刺
    let joyMag = 0;
    if (this.joystick.active) {
      dir.addScaledVector(fwd, -this.joystick.dy);
      dir.addScaledVector(rgt,  this.joystick.dx);
      joyMag = Math.min(1, Math.hypot(this.joystick.dx, this.joystick.dy));
    }
    // 飞行时 Shift 用于下降；但同时按 Shift + 方向键 → 飞行加速（水平 2.2x）
    // 移动端：摇杆推满 >92% 在飞行状态下也触发加速（与 Shift 等效）
    // 地面 Shift = 冲刺；摇杆推满 >92% 也触发冲刺
    const flyBoost = this.physics.flying && (sprintKey || joyMag > 0.92);
    const sprint = (!this.physics.flying && (sprintKey || joyMag > 0.92)) ? SPRINT_MULT : 1;

    if (dir.lengthSq() > 0) dir.normalize();
    // 摇杆模拟量：推得越远走得越快（键盘恒为 1）
    const analog = this.joystick.active && joyMag > 0 ? Math.max(0.25, joyMag) : 1;
    const speed = this.physics.flying
      ? FLY_SPEED * analog * (flyBoost ? 2.2 : 1)   // 飞行加速：Shift 水平 2.2x
      : MOVE_SPEED * sprint * analog;
    dir.multiplyScalar(speed);

    // 按住空格＝持续起跳/游泳上浮（每帧喂入跳跃缓冲，落地立刻再跳——
    // 不再依赖系统按键 repeat 的迟滞节奏，边跑边跳如丝般连贯）
    if ((this.keys['Space'] || this._jumpHeld) && !this.physics.flying) this.physics.jump();

    this.physics.update(dt, dir);

    // 飞行下降键：仅飞行时显示
    if (this._btnDesc && this._btnDesc.classList.contains('show') !== this.physics.flying) {
      this._btnDesc.classList.toggle('show', this.physics.flying);
    }

    // 行走视角摆动（仅贴地）；跑跳腾空瞬间摆动暂停但相位保留，落地无缝续拍
    const inputActive = dir.lengthSq() > 0.1 && !this.physics.flying;
    const moving = inputActive && this.physics.onGround;
    if (moving) {
      this.bobPhase += dt * (sprint > 1 ? 13 : 9);
      // 脚步声（与摆动节拍同步）
      this._stepTimer -= dt;
      if (this._stepTimer <= 0) {
        window.gameAudio?.step();
        this._stepTimer = sprint > 1 ? 0.27 : 0.38;
      }
    } else {
      this.bobPhase *= 0.9;
      this._stepTimer = 0.1;
    }
    const bobY = moving ? Math.abs(Math.sin(this.bobPhase)) * 0.05 : 0;

    // FOV 动态拉伸：冲刺 +8°、飞行 +12°、飞行加速 +18°，平滑过渡（速度感）
    // 冲刺跳跃腾空时不回缩（用 inputActive 而非 moving），修复边跑边跳 FOV 一抽一抽
    const targetFov = this._baseFov + (
      this.physics.flying ? (flyBoost && inputActive ? 18 : 12) :
      (sprint > 1 && inputActive ? 8 : 0)
    );
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }

    const eye = this.physics.eyePosition;
    this.camera.position.set(eye.x, eye.y + bobY, eye.z);
    this.camera.quaternion.setFromEuler(this._euler.set(this.pitch, this.yaw, 0));
  }
}
