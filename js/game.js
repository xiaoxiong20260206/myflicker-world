/**
 * game.js — 主入口 v5 · MyFlicker Work · 众生世界
 * 组装：渲染器 / 场景 / 光照 / 效果 / 实体（动物·村民·星星）/ 成就巡检 / 主循环
 */

(function () {
  'use strict';

  /* ===== WebGL 渲染器 ===== */
  const canvas   = document.getElementById('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // 移动端像素比上限降到 1.5：中低端机上帧率提升明显，画质损失几乎不可感知
  const IS_TOUCH = 'ontouchstart' in window;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.outputEncoding    = THREE.sRGBEncoding || THREE.LinearEncoding;

  /* ===== 场景 ===== */
  const scene = new THREE.Scene();
  scene.fog   = new THREE.FogExp2(0x9dd8f5, 0.014);

  /* ===== 摄像机 ===== */
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500);

  /* ===== 光照 ===== */
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffe8b0, 1.15);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);   // 移动端减半，省填充率
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far  = 400;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -90;
  sun.shadow.camera.right = sun.shadow.camera.top   =  90;
  sun.shadow.bias = -0.001;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7a30, 0.4);
  scene.add(hemi);

  /* ===== MYFLICKER 神殿点光源 ===== */
  const cozeLights = [];
  for (let i = 0; i < 5; i++) {
    const pl = new THREE.PointLight(0xffd060, 1.4, 20);
    pl.position.set(-16 + i * 8, GROUND_Y + 7, -14);
    scene.add(pl);
    cozeLights.push(pl);
  }

  /* ===== 初始化模块 ===== */
  buildTextures();

  const world       = new World(scene);
  const physics     = new Physics(world);
  const controls    = new Controls(camera, canvas, physics);
  const interaction = new Interaction(camera, world, canvas);
  const ui          = new GameUI();
  const effects     = new Effects(scene, camera);
  const entities    = new EntityManager(scene, world);

  window.gameWorld       = world;
  window.gamePhysics     = physics;
  window.gameInteraction = interaction;
  window.gameUI          = ui;
  window.gameControls    = controls;
  window.gameCamera      = camera;
  window.gameEntities    = entities;
  window.gameEffects     = effects;

  scene.add(interaction.highlightMesh);
  scene.add(interaction.particles);

  world.init();
  entities.init();
  physics.position.set(0.5, GROUND_Y + 4, 10);

  /* ===== E 键交互：摸动物 / 和村民说话 ===== */
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyE' && controls.locked) {
      entities.interact(physics.position, camera);
    }
    // v5：M 键 BGM 开关
    if (e.code === 'KeyM' && controls.locked) {
      const on = window.gameAudio?.toggleBgm();
      ui.toast(on ? '🎵 音乐已开启' : '🔇 音乐已关闭', true);
      ui.syncBgmBtn?.(on);
    }
    // v5：Tab 键成就图鉴
    if (e.code === 'Tab' && controls.locked) {
      e.preventDefault();
      ui.toggleAchievementsPanel?.();
    }
    // v5.2：P 键在线玩家面板
    if (e.code === 'KeyP' && controls.locked) {
      e.preventDefault();
      ui.toggleOnlinePanel?.();
    }
    // v5：H 键回出生点（3 秒吟唱，移动取消）
    if (e.code === 'KeyH' && controls.locked && !e.repeat) startHomeCast();
  });

  /* ===== v5：出生点传送（3 秒吟唱，移动即取消，防滥用） ===== */
  const SPAWN = { x: 0.5, y: GROUND_Y + 4, z: 10 };
  let homeCast = -1;          // <0 空闲；>=0 已吟唱秒数
  let castFrom = null;        // 吟唱起点（用于检测移动）
  window.gameStartHomeCast = startHomeCast;   // 移动端按钮入口
  function startHomeCast() {
    if (homeCast >= 0) {      // 再按一次取消
      homeCast = -1;
      ui.castBar?.(false);
      ui.toast('⛔ 已取消回城', true);
      return;
    }
    const p = physics.position;
    if (Math.abs(p.x - SPAWN.x) + Math.abs(p.z - SPAWN.z) < 6) {
      ui.toast('🏠 你已经在出生点附近了', true);
      return;
    }
    homeCast = 0;
    castFrom = { x: p.x, y: p.y, z: p.z };
    window.gameAudio?.teleportCast();
    ui.toast('🌀 正在返回出生点…（移动会取消）', true);
  }
  function updateHomeCast(dt) {
    if (homeCast < 0) return;
    const p = physics.position;
    // 位移超过 1.2 格判定为主动移动，取消吟唱（轻微物理抖动不误伤）
    if (Math.abs(p.x - castFrom.x) + Math.abs(p.y - castFrom.y) + Math.abs(p.z - castFrom.z) > 1.2) {
      homeCast = -1;
      ui.castBar?.(false);
      ui.toast('⛔ 移动打断了回城', true);
      return;
    }
    homeCast += dt;
    ui.castBar?.(true, Math.min(1, homeCast / 3));
    if (homeCast >= 3) {
      homeCast = -1;
      ui.castBar?.(false);
      physics.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
      physics.velocity?.set?.(0, 0, 0);
      window.gameAudio?.teleportDone();
      ui.toast('🏠 已回到出生点', true);
      ui.unlockAchievement('home');
    }
  }

  /* ===== 成就巡检（低频） ===== */
  let achTimer = 0;
  let sawNight = false;
  function checkAchievements(dt, timeInfo) {
    achTimer += dt;
    if (achTimer < 1) return;
    achTimer = 0;

    const p = physics.position;
    const dist = Math.sqrt(p.x * p.x + p.z * p.z);

    if (physics.inWater) ui.unlockAchievement('swim');
    if (p.y > GROUND_Y + 24 && physics.onGround) ui.unlockAchievement('peak');
    if (dist > 200) ui.unlockAchievement('explorer');

    // 数量型成就兜底：本地存档带着老进度进 v5（或云恢复）时补触发
    const sc = entities.starCollected;
    if (sc >= 1)   ui.unlockAchievement('star1');
    if (sc >= 10)  ui.unlockAchievement('star10');
    if (sc >= 25)  ui.unlockAchievement('star25');
    if (sc >= 50)  ui.unlockAchievement('star50');
    if (sc >= 100) ui.unlockAchievement('star100');

    // 神殿 14 格内
    const mx = p.x - 0, mz = p.z - (-16);
    if (Math.sqrt(mx * mx + mz * mz) < 14) ui.unlockAchievement('coze');

    // 村庄 18 格内 → 发现村庄
    for (const v of VILLAGES) {
      const vx = p.x - v.x, vz = p.z - v.z;
      if (Math.sqrt(vx * vx + vz * vz) < 18) {
        if (!v._found) {
          v._found = true;
          ui.toast(`🏘️ 你发现了「${v.name}」！`);
        }
        ui.unlockAchievement('village');
      }
    }

    // 野外结构 12 格内 → 发现遗迹（v4.9）
    if (typeof WILDS !== 'undefined') {
      for (const w of WILDS) {
        const wx = p.x - w.x, wz = p.z - w.z;
        if (Math.sqrt(wx * wx + wz * wz) < 12) {
          if (!w._found) {
            w._found = true;
            ui.toast(`🗿 你发现了「${w.name}」！`);
          }
          ui.unlockAchievement('relic');
        }
      }
    }

    // 深夜时段
    const t = timeInfo?.dayTime ?? 0.3;
    if (t < 0.1 || t > 0.9) sawNight = true;
    if (sawNight && t > 0.25 && t < 0.5) ui.unlockAchievement('night');

    // 夜里看到萤火虫
    if (effects.fireflies?.visible && effects.ffMat?.opacity > 0.2) ui.unlockAchievement('firefly');
  }

  /* ===== FPS / 节流计时 ===== */
  let fps = 0, frameCount = 0, fpsTimer = 0;
  let chunkTimer = 0;
  let _dbgTimer = 0;
  let lastTime = performance.now();

  /* ===== 响应式画布 ===== */
  // 注意：domElement.width 是物理像素（CSS 宽 × pixelRatio），不能直接和 clientWidth 比，
  // 否则 pixelRatio>1 时每帧都误判尺寸变化、每帧 setSize（重建 drawingbuffer，移动端掉帧）
  let _cssW = 0, _cssH = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== _cssW || h !== _cssH) {
      _cssW = w; _cssH = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  window.addEventListener('resize', resize);
  resize();

  /* ===== 主循环 ===== */
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    resize();

    let timeInfo = null;
    if (controls.locked) {
      controls.update(dt);
      interaction.update(dt);
      timeInfo = effects.update(dt, physics.position, physics.headInWater, sun, ambient, hemi, scene.fog);
      // v5：BGM 情绪跟随昼夜/天气
      if (window.gameAudio) {
        const t = timeInfo?.dayTime ?? 0.3;
        const mood = effects.weather === 'rain' ? 'rain' : ((t < 0.24 || t > 0.78) ? 'night' : 'day');
        gameAudio.setBgmMood(mood);
      }
      entities.update(dt, physics.position, timeInfo);
      window.gameGhosts?.update(dt);   // 幽灵玩家插值（v4.8）
      ui.updateOnline(window.gameGhosts?.count ?? 0);   // v5：在线人数徽标
      updateHomeCast(dt);              // v5：回城吟唱进度
      checkAchievements(dt, timeInfo);
      ui.updateMinimap(world, physics, controls.yaw, dt);
    }

    // 区块动态加载（节流 0.3s）
    chunkTimer += dt;
    if (chunkTimer >= 0.3) {
      chunkTimer = 0;
      world.updateChunks(physics.position.x, physics.position.z);
    }

    // MYFLICKER 灯脉动
    const pulsate = 1 + Math.sin(now * 0.003) * 0.3;
    cozeLights.forEach(l => { l.intensity = 1.1 * pulsate; });

    // FPS
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 1) { fps = frameCount; frameCount = 0; fpsTimer = 0; }

    if (controls.locked) {
      // 调试面板 4Hz 足够（每帧拼字符串 + textContent 触发重排，白白吃 CPU）
      _dbgTimer += dt;
      if (_dbgTimer >= 0.25) {
        _dbgTimer = 0;
        ui.updateDebug(physics, fps, controls, world, effects.timeLabel);
      }
    }

    renderer.render(scene, camera);
  }

  /* ===== 开始按钮 ===== */
  document.getElementById('start-btn').addEventListener('click', () => {
    window.gameAudio?.init();
    if ('ontouchstart' in window) {
      document.getElementById('overlay').classList.add('hidden');
      controls.locked = true;
    } else {
      canvas.requestPointerLock();
    }
  });

  /* ===== WebGL 上下文丢失防护 ===== */
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    location.reload();
  });

  requestAnimationFrame(loop);
})();
