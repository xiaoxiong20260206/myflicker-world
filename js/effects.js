/**
 * effects.js — 环境效果 v3（新增模块）
 * 星空、太阳/月亮盘、云层漂移、昼夜天空色、水下雾切换
 */

class Effects {
  constructor(scene, camera) {
    this.scene  = scene;
    this.camera = camera;
    this.dayTime = 0.32;          // 0=午夜 0.25=日出 0.5=正午 0.75=日落
    this.DAY_SPEED = 0.0035;

    this._buildSkyDome();
    this._buildStars();
    this._buildSunMoon();
    this._buildClouds();
    this._buildWeather();
    this._buildFireflies();

    this.waterOverlay = document.getElementById('water-overlay');
    this._underwater = false;
  }

  /* ===== 巨型天空球（顶点色渐变，避免每帧重建 Canvas 贴图） ===== */
  _buildSkyDome() {
    const geo = new THREE.SphereGeometry(240, 24, 16);
    // 自定义 shader：上下渐变
    this.skyUniforms = {
      topColor: { value: new THREE.Color(0x2064c8) },
      midColor: { value: new THREE.Color(0x87ceeb) },
      botColor: { value: new THREE.Color(0xd8eef8) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 botColor;
        varying float vY;
        void main() {
          vec3 c;
          if (vY > 0.15) c = mix(midColor, topColor, smoothstep(0.15, 0.85, vY));
          else           c = mix(botColor, midColor, smoothstep(-0.2, 0.15, vY));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(geo, mat);
    this.skyDome.renderOrder = -10;
    this.scene.add(this.skyDome);
  }

  /* ===== 星空（Points，夜晚淡入） ===== */
  _buildStars() {
    const count = 500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // 半球均匀分布
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.08);  // 靠上
      const r = 225;
      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.cos(phi);
      pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 1.6, color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: false,
    });
    // sizeAttenuation false 需要 size 以像素计
    this.starMat.size = 2;
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);
  }

  /* ===== 太阳 / 月亮盘 ===== */
  _makeDiscTexture(inner, outer) {
    const sz = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = sz;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(sz/2, sz/2, 6, sz/2, sz/2, sz/2);
    g.addColorStop(0, inner);
    g.addColorStop(0.45, inner);
    g.addColorStop(0.55, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sz, sz);
    return new THREE.CanvasTexture(cv);
  }

  _buildSunMoon() {
    const sunTex  = this._makeDiscTexture('rgba(255,235,160,1)', 'rgba(255,180,60,0.5)');
    const moonTex = this._makeDiscTexture('rgba(230,238,255,1)', 'rgba(150,180,230,0.4)');

    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, transparent: true, depthWrite: false, fog: false,
    }));
    this.sunSprite.scale.set(34, 34, 1);
    this.scene.add(this.sunSprite);

    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTex, transparent: true, depthWrite: false, fog: false,
    }));
    this.moonSprite.scale.set(22, 22, 1);
    this.scene.add(this.moonSprite);
  }

  /* ===== 云层（Sprite 群，缓慢漂移） ===== */
  _buildClouds() {
    const sz = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = sz;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(sz/2, sz/2, 4, sz/2, sz/2, sz/2);
    g.addColorStop(0,   'rgba(255,255,255,0.85)');
    g.addColorStop(0.5, 'rgba(240,248,255,0.45)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sz, sz);
    const cloudTex = new THREE.CanvasTexture(cv);

    this.clouds = [];
    for (let i = 0; i < 30; i++) {
      const mat = new THREE.SpriteMaterial({ map: cloudTex, depthWrite: false, transparent: true, opacity: 0.7 });
      const sp = new THREE.Sprite(mat);
      sp.position.set(
        (Math.random() - 0.5) * 300,
        GROUND_Y + 36 + Math.random() * 10,
        (Math.random() - 0.5) * 300
      );
      const sc = 20 + Math.random() * 26;
      sp.scale.set(sc * 1.9, sc, 1);
      sp.userData.speed = 0.6 + Math.random() * 0.8;
      this.scene.add(sp);
      this.clouds.push(sp);
    }
  }

  /* ===== 天气系统（v4）：晴 → 雨/雪 随机切换，粒子随玩家 ===== */
  _buildWeather() {
    this.weather = 'clear';        // clear | rain | snow
    this.weatherTimer = 40 + Math.random() * 50;   // 首场天气来得稍晚
    this.weatherStrength = 0;      // 0~1 淡入淡出

    const COUNT = 900;
    this._precipCount = COUNT;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 60;
      pos[i*3+1] = Math.random() * 40;
      pos[i*3+2] = (Math.random() - 0.5) * 60;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.precipMat = new THREE.PointsMaterial({
      size: 2.2, color: 0x9DB8D8, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: false,
    });
    this.precip = new THREE.Points(geo, this.precipMat);
    this.precip.visible = false;
    this.precip.renderOrder = 5;
    this.scene.add(this.precip);
  }

  /* 天气切换（外部可读 this.weather 显示到 HUD） */
  _pickNextWeather(playerPos) {
    // 依据玩家所在群系挑天气：雪原下雪，沙漠几乎不下，其他下雨
    const biome = window.gameWorld?.biomeAt(Math.floor(playerPos.x), Math.floor(playerPos.z));
    if (this.weather === 'clear') {
      if (biome === BIOME.DESERT && Math.random() < 0.7) { this.weatherTimer = 30 + Math.random() * 40; return; }
      this.weather = (biome === BIOME.SNOWY) ? 'snow' : 'rain';
      this.weatherTimer = 20 + Math.random() * 25;      // 一场雨/雪持续 20~45s
      this.precipMat.color.set(this.weather === 'snow' ? 0xFFFFFF : 0x9DB8D8);
      this.precipMat.size = this.weather === 'snow' ? 3 : 2.2;
      window.gameUI?.toast(this.weather === 'snow' ? '🌨️ 下雪了…' : '🌧️ 下雨了…');
      window.gameAudio?.setRain(this.weather === 'rain');   // 雪天静谧，只有雨才有雨声
      if (this.weather === 'rain') window.gameUI?.unlockAchievement('rain');
      if (this.weather === 'snow') window.gameUI?.unlockAchievement('snow');
    } else {
      this.weather = 'clear';
      this.weatherTimer = 50 + Math.random() * 70;      // 晴天持续 50~120s
      window.gameUI?.toast('🌤️ 天放晴了');
      window.gameAudio?.setRain(false);
    }
  }

  _updateWeather(dt, playerPos) {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) this._pickNextWeather(playerPos);

    // 强度淡入淡出
    const target = this.weather === 'clear' ? 0 : 1;
    this.weatherStrength += (target - this.weatherStrength) * Math.min(1, dt * 0.8);

    const on = this.weatherStrength > 0.02;
    this.precip.visible = on;
    if (!on) return;

    this.precipMat.opacity = this.weatherStrength * (this.weather === 'snow' ? 0.9 : 0.65);
    this.precip.position.set(playerPos.x, playerPos.y, playerPos.z);

    // 粒子下落
    const arr = this.precip.geometry.attributes.position.array;
    const fall = (this.weather === 'snow' ? 5 : 26) * dt;
    const drift = this.weather === 'snow' ? Math.sin(performance.now() * 0.001) * dt * 2 : 0;
    for (let i = 0; i < this._precipCount; i++) {
      arr[i*3+1] -= fall;
      arr[i*3]   += drift;
      if (arr[i*3+1] < -6) {           // 回收到头顶
        arr[i*3]   = (Math.random() - 0.5) * 60;
        arr[i*3+1] = 30 + Math.random() * 10;
        arr[i*3+2] = (Math.random() - 0.5) * 60;
      }
    }
    this.precip.geometry.attributes.position.needsUpdate = true;
  }

  /* ===== 萤火虫（v4）：夜晚在玩家周围浮游发光 ===== */
  _buildFireflies() {
    const COUNT = 40;
    this._ffCount = COUNT;
    const pos = new Float32Array(COUNT * 3);
    this._ffSeed = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      this._ffSeed[i*3]   = Math.random() * Math.PI * 2;
      this._ffSeed[i*3+1] = Math.random() * Math.PI * 2;
      this._ffSeed[i*3+2] = 6 + Math.random() * 22;     // 距离
      pos[i*3] = pos[i*3+1] = pos[i*3+2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ffMat = new THREE.PointsMaterial({
      size: 3.2, color: 0xC8FF6A, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: false,
    });
    this.fireflies = new THREE.Points(geo, this.ffMat);
    this.fireflies.visible = false;
    this.scene.add(this.fireflies);
    this._ffAnchor = new THREE.Vector3();   // 萤火虫群锚点（缓慢跟随玩家）
  }

  _updateFireflies(dt, playerPos, sunStr) {
    // 只在夜晚出现（sunStr 低），雨天也不出
    const nightAmt = Math.max(0, 1 - sunStr * 3) * (1 - this.weatherStrength);
    const on = nightAmt > 0.05;
    this.fireflies.visible = on;
    if (!on) return;

    this._ffAnchor.lerp(playerPos, Math.min(1, dt * 0.5));
    const t = performance.now() * 0.001;
    const arr = this.fireflies.geometry.attributes.position.array;
    for (let i = 0; i < this._ffCount; i++) {
      const s1 = this._ffSeed[i*3], s2 = this._ffSeed[i*3+1], r = this._ffSeed[i*3+2];
      arr[i*3]   = this._ffAnchor.x + Math.cos(t * 0.25 + s1) * r;
      arr[i*3+1] = this._ffAnchor.y + 0.5 + Math.sin(t * 0.7 + s2) * 2.2;
      arr[i*3+2] = this._ffAnchor.z + Math.sin(t * 0.3 + s2) * r;
    }
    this.fireflies.geometry.attributes.position.needsUpdate = true;
    // 群体闪烁
    this.ffMat.opacity = nightAmt * (0.55 + Math.sin(t * 2.2) * 0.3);
  }

  /* ===== 每帧更新 ===== */
  update(dt, playerPos, headInWater, sun, ambient, hemi, fog) {
    this.dayTime = (this.dayTime + this.DAY_SPEED * dt) % 1;
    const t = this.dayTime;

    // 天空球/星星跟随玩家
    this.skyDome.position.copy(playerPos);
    this.stars.position.copy(playerPos);

    // 太阳月亮轨道
    const angle = (t - 0.25) * Math.PI * 2;
    const sx = Math.cos(angle) * 180, sy = Math.sin(angle) * 180;
    this.sunSprite.position.set(playerPos.x + sx, playerPos.y + sy, playerPos.z - 40);
    this.moonSprite.position.set(playerPos.x - sx, playerPos.y - sy, playerPos.z + 40);

    // 平行光同步太阳方向（复用向量，勿每帧 new）
    sun.position.set(playerPos.x + sx, Math.max(sy, -20), playerPos.z - 40);
    sun.target.position.copy(playerPos);
    sun.target.updateMatrixWorld();

    const sunStr = Math.max(0, Math.sin(t * Math.PI * 2));
    const dim = 1 - this.weatherStrength * 0.45;        // 阴雨天压暗
    sun.intensity = sunStr * 1.15 * dim;
    ambient.intensity = (0.16 + sunStr * 0.38) * dim;
    hemi.intensity = (0.15 + sunStr * 0.3) * dim;

    // 星星夜间淡入
    this.starMat.opacity = Math.max(0, 1 - sunStr * 2.6) * 0.95;

    // 天空颜色四段插值
    const L = (a, b, u) => a + (b - a) * u;
    let top, mid, fogC;
    if (t < 0.25) {           // 夜 → 黎明
      const u = t / 0.25;
      top  = [L(6, 40, u),   L(8, 70, u),   L(26, 150, u)];
      mid  = [L(10, 150, u), L(12, 175, u), L(36, 215, u)];
      fogC = [L(8, 145, u),  L(10, 172, u), L(30, 212, u)];
    } else if (t < 0.5) {     // 黎明 → 正午
      const u = (t - 0.25) / 0.25;
      top  = [L(40, 24, u),  L(70, 110, u),  L(150, 215, u)];
      mid  = [L(150, 135, u), L(175, 206, u), L(215, 240, u)];
      fogC = [L(145, 150, u), L(172, 210, u), L(212, 238, u)];
    } else if (t < 0.75) {    // 正午 → 黄昏
      const u = (t - 0.5) / 0.25;
      top  = [L(24, 70, u),  L(110, 45, u),  L(215, 95, u)];
      mid  = [L(135, 235, u), L(206, 140, u), L(240, 90, u)];
      fogC = [L(150, 225, u), L(210, 135, u), L(238, 92, u)];
    } else {                  // 黄昏 → 夜
      const u = (t - 0.75) / 0.25;
      top  = [L(70, 6, u),   L(45, 8, u),   L(95, 26, u)];
      mid  = [L(235, 10, u), L(140, 12, u), L(90, 36, u)];
      fogC = [L(225, 8, u),  L(135, 10, u), L(92, 30, u)];
    }

    this.skyUniforms.topColor.value.setRGB(top[0]/255, top[1]/255, top[2]/255);
    this.skyUniforms.midColor.value.setRGB(mid[0]/255, mid[1]/255, mid[2]/255);
    this.skyUniforms.botColor.value.setRGB(
      Math.min(1, mid[0]/255 + 0.12), Math.min(1, mid[1]/255 + 0.1), Math.min(1, mid[2]/255 + 0.08));

    // 雾：水下切换 + 阴雨天变浓变灰
    if (headInWater) {
      fog.color.setRGB(0.05, 0.2, 0.45);
      fog.density = 0.09;
    } else {
      const w = this.weatherStrength;
      const grey = (fogC[0] + fogC[1] + fogC[2]) / 3;
      fog.color.setRGB(
        (fogC[0] * (1 - w) + grey * w * 0.85) / 255,
        (fogC[1] * (1 - w) + grey * w * 0.85) / 255,
        (fogC[2] * (1 - w) + grey * w * 0.85) / 255);
      fog.density = 0.014 + w * 0.012;
    }

    // 水下 UI 滤镜
    if (headInWater !== this._underwater) {
      this._underwater = headInWater;
      this.waterOverlay?.classList.toggle('on', headInWater);
    }

    // 云漂移（阴雨天更暗更密）；X/Z 双轴都要相对玩家回绕，否则沿 Z 走远云会全部掉队
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x - playerPos.x > 170) c.position.x -= 340;
      if (c.position.x - playerPos.x < -170) c.position.x += 340;
      if (c.position.z - playerPos.z > 170) c.position.z -= 340;
      if (c.position.z - playerPos.z < -170) c.position.z += 340;
      // 云在夜晚变暗
      c.material.opacity = (0.25 + sunStr * 0.5) * (1 + this.weatherStrength * 0.4);
    }

    // v4：天气 + 萤火虫
    this._updateWeather(dt, playerPos);
    this._updateFireflies(dt, playerPos, sunStr);

    return { sunStr, dayTime: t };
  }

  /* 当前时段文字（含天气） */
  get timeLabel() {
    const t = this.dayTime;
    let s;
    if (t < 0.2 || t >= 0.8) s = '🌙 深夜';
    else if (t < 0.3) s = '🌅 清晨';
    else if (t < 0.45) s = '☀️ 上午';
    else if (t < 0.55) s = '☀️ 正午';
    else if (t < 0.7) s = '🌇 午后';
    else s = '🌆 黄昏';
    if (this.weather === 'rain') s += ' 🌧️';
    if (this.weather === 'snow') s += ' 🌨️';
    return s;
  }
}
