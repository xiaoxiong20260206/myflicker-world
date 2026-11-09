/**
 * ui.js — HUD、物品栏、小地图、成就 Toast v4
 */

const ACHIEVEMENTS = {
  firstPlace: { icon: '🧱', name: '初来乍到 · 放下第一块方块' },
  firstBreak: { icon: '⛏️', name: '第一铲 · 破坏第一块方块' },
  builder:    { icon: '🏗️', name: '建筑大师 · 放置 100 块方块' },
  digger:     { icon: '⚒️', name: '挖掘狂人 · 破坏 50 块方块' },
  fly:        { icon: '🕊️', name: '御风而行 · 首次开启飞行' },
  swim:       { icon: '🏊', name: '浪里白条 · 潜入水中' },
  peak:       { icon: '🏔️', name: '登峰造极 · 到达高山之巅' },
  night:      { icon: '🌙', name: '守夜人 · 经历第一个夜晚' },
  explorer:   { icon: '🧭', name: '远行者 · 离开出生点 200 格' },
  coze:       { icon: '✨', name: '朝圣者 · 抵达 MYFLICKER 神殿' },
  breakCoze:  { icon: '😈', name: '亵渎者 · 拆了 MYFLICKER 神殿的砖' },
  pet:        { icon: '💕', name: '心怀柔软 · 第一次摸动物' },
  zoologist:  { icon: '🐾', name: '动物之友 · 摸过 10 次动物' },
  villager:   { icon: '💬', name: '社交达人 · 和村民聊天' },
  village:    { icon: '🏘️', name: '入乡随俗 · 发现一座村庄' },
  relic:      { icon: '🗿', name: '寻迹者 · 发现一处野外遗迹' },
  star1:      { icon: '⭐', name: '拾星者 · 捡到第一颗星星' },
  star10:     { icon: '🌟', name: '摘星揽月 · 收集 10 颗星星' },
  rain:       { icon: '🌧️', name: '听雨人 · 邂逅第一场雨' },
  snow:       { icon: '❄️', name: '初雪 · 在雪原邂逅一场雪' },
  firefly:    { icon: '🪰', name: '流萤微光 · 夜里遇见萤火虫' },
  share:      { icon: '📣', name: '广而告之 · 把世界分享给朋友' },
  meet:       { icon: '👻', name: '相遇 · 在世界里遇见另一位玩家' },
  /* v5 新增 */
  home:       { icon: '🏠', name: '落叶归根 · 用回城传送返回出生点' },
  star25:     { icon: '✨', name: '星辰收藏家 · 收集 25 颗星星' },
  star50:     { icon: '💫', name: '银河旅人 · 收集 50 颗星星' },
  star100:    { icon: '🌌', name: '星海主宰 · 收集 100 颗星星' },
  rainbow:    { icon: '🌈', name: '虹光垂青 · 捡到一颗罕见的彩虹星' },
};
const ACH_KEY = 'myflicker-world-v4-achievements';

class GameUI {
  constructor() {
    this.activeSlot = 0;
    this.slots      = PLACEABLE_BLOCKS;
    this.hotbarEl   = document.getElementById('hotbar');
    this.debugEl    = document.getElementById('debug');
    this.toastsEl   = document.getElementById('toasts');

    this.minimap    = document.getElementById('minimap');
    this.mmCtx      = this.minimap?.getContext('2d');
    this._mmTimer   = 0;

    this.unlocked = this._loadAchievements();
    this._build();
    this._initV5Hud();
  }

  /* ===== v5：HUD 按钮 / 成就面板 / 吟唱条 / 在线徽标 ===== */
  _initV5Hud() {
    this._onlineBadge = document.getElementById('online-badge');
    this._castBarEl   = document.getElementById('cast-bar');
    this._castFillEl  = document.getElementById('cast-fill');
    this._achPanel    = document.getElementById('ach-panel');
    this._bgmBtn      = document.getElementById('hud-bgm');

    // HUD 按钮统一绑定：click（桌面）+ touchstart（移动端，阻断 canvas 视角）
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', fn);
      el.addEventListener('touchstart', e => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('pressed');
        fn();
      }, { passive: false });
      el.addEventListener('touchend', () => el.classList.remove('pressed'));
    };
    bind('hud-ach',  () => this.toggleAchievementsPanel());
    bind('hud-bgm',  () => {
      const on = window.gameAudio?.toggleBgm();
      this.toast(on ? '🎵 音乐已开启' : '🔇 音乐已关闭', true);
      this.syncBgmBtn(on);
    });
    bind('hud-home', () => window.gameStartHomeCast?.());
    bind('hud-online', () => this.toggleOnlinePanel());
    bind('ach-close', () => this.toggleAchievementsPanel(false));
    document.getElementById('online-close')?.addEventListener('click', () => this.toggleOnlinePanel(false));
    this._achPanel?.addEventListener('click', e => {
      if (e.target === this._achPanel) this.toggleAchievementsPanel(false);
    });
    document.getElementById('online-panel')?.addEventListener('click', e => {
      if (e.target === document.getElementById('online-panel')) this.toggleOnlinePanel(false);
    });
    // 恢复上次的 BGM 开关状态到图标
    this.syncBgmBtn(window.gameAudio?.bgmOn !== false);
  }

  /* 🎵/🔇 图标同步 */
  syncBgmBtn(on) {
    if (this._bgmBtn) this._bgmBtn.firstChild.textContent = on ? '🎵' : '🔇';
  }

  /* 回城吟唱进度条 */
  castBar(show, progress = 0) {
    if (!this._castBarEl) return;
    this._castBarEl.classList.toggle('show', !!show);
    if (show) this._castFillEl.style.width = (progress * 100).toFixed(1) + '%';
  }

  /* 「👻 N 位冒险者在线」徽标（N=0 隐藏） */
  updateOnline(n) {
    if (!this._onlineBadge || n === this._onlineN) return;
    this._onlineN = n;
    this._onlineBadge.classList.toggle('show', n > 0);
    if (n > 0) this._onlineBadge.textContent = `👻 ${n} 位冒险者也在这个世界`;
  }

  /* 成就图鉴面板：解锁亮色 / 未解锁灰剪影 */
  toggleAchievementsPanel(force) {
    const panel = this._achPanel;
    if (!panel) return;
    const show = force !== undefined ? force : !panel.classList.contains('show');
    panel.classList.toggle('show', show);
    if (!show) return;
    const total = Object.keys(ACHIEVEMENTS).length;
    document.getElementById('ach-title').textContent =
      `🏅 成就图鉴 ${this.unlocked.size}/${total}`;
    const list = document.getElementById('ach-list');
    list.innerHTML = '';
    // 已解锁排前面
    const ids = Object.keys(ACHIEVEMENTS)
      .sort((a, b) => (this.unlocked.has(b) ? 1 : 0) - (this.unlocked.has(a) ? 1 : 0));
    for (const id of ids) {
      const a = ACHIEVEMENTS[id];
      const got = this.unlocked.has(id);
      const [title, desc] = a.name.split(' · ');
      const row = document.createElement('div');
      row.className = 'ach-row ' + (got ? 'got' : 'lock');
      row.innerHTML =
        `<span class="ach-ico">${got ? a.icon : '🔒'}</span>` +
        `<span class="ach-t"><div class="ach-name">${got ? title : '？？？'}</div>` +
        `<div class="ach-desc">${desc || ''}</div></span>`;
      list.appendChild(row);
    }
  }

  get selectedBlock() { return this.slots[this.activeSlot]; }

  /* ===== 物品栏 ===== */
  _build() {
    this.hotbarEl.innerHTML = '';
    this.slots.forEach((type, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot' + (i === this.activeSlot ? ' active' : '');

      const cv = document.createElement('canvas');
      cv.className = 'slot-icon';
      cv.width = cv.height = 32;
      this._drawIcon(cv.getContext('2d'), type);
      slot.appendChild(cv);

      const num = document.createElement('span');
      num.className = 'slot-num';
      num.textContent = i < 9 ? i + 1 : 0;
      slot.appendChild(num);

      const name = document.createElement('span');
      name.className = 'slot-name';
      name.textContent = BLOCK_META[type]?.name || '';
      slot.appendChild(name);

      slot.addEventListener('click', () => this.selectSlot(i));
      // 移动端：区分点选与横向滑动（不能 preventDefault，否则物品栏滑不动）
      slot.addEventListener('touchstart', e => {
        const t = e.changedTouches[0];
        slot._tx = t.clientX; slot._ty = t.clientY;
      }, { passive: true });
      slot.addEventListener('touchend', e => {
        const t = e.changedTouches[0];
        if (Math.abs(t.clientX - slot._tx) < 10 && Math.abs(t.clientY - slot._ty) < 10) {
          e.preventDefault();   // 防止再触发一次 click
          this.selectSlot(i);
        }
      });
      this.hotbarEl.appendChild(slot);
    });
  }

  _drawIcon(ctx, type) {
    const s = 32;
    ctx.fillStyle = getBlockPreviewColor(type);
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, 0, s, 4); ctx.fillRect(0, 0, 4, s);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, s-4, s, 4); ctx.fillRect(s-4, 0, 4, s);
  }

  selectSlot(idx) {
    this.activeSlot = ((idx % this.slots.length) + this.slots.length) % this.slots.length;
    this.hotbarEl.querySelectorAll('.hotbar-slot')
      .forEach((el, i) => el.classList.toggle('active', i === this.activeSlot));
  }

  scrollHotbar(d) { this.selectSlot(this.activeSlot + d); }

  /* ===== Toast ===== */
  toast(text, plain = false) {
    if (!this.toastsEl) return;
    // 上限 4 条，超出移除最旧，避免密集事件刷屏
    while (this.toastsEl.children.length >= 4) this.toastsEl.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  /* ===== 成就 ===== */
  _loadAchievements() {
    try { return new Set(JSON.parse(localStorage.getItem(ACH_KEY) || '[]')); }
    catch { return new Set(); }
  }

  unlockAchievement(id) {
    if (this.unlocked.has(id) || !ACHIEVEMENTS[id]) return;
    this.unlocked.add(id);
    try { localStorage.setItem(ACH_KEY, JSON.stringify([...this.unlocked])); } catch {}
    const a = ACHIEVEMENTS[id];
    this.toast(`${a.icon} 成就解锁：${a.name}`);
    window.gameAudio?.achieve();
  }

  /* ===== 小地图（俯视地表颜色） ===== */
  updateMinimap(world, physics, yaw, dt) {
    this._mmTimer += dt;
    if (this._mmTimer < 0.5 || !this.mmCtx) return;   // 0.5s 节流
    this._mmTimer = 0;

    const ctx = this.mmCtx;
    const S = this.minimap.width;        // 148
    const RANGE = 37;                    // 半径 37 格 → 每格 2px
    const px = Math.floor(physics.position.x);
    const pz = Math.floor(physics.position.z);
    const cell = S / (RANGE * 2);

    // 行交错扫描：每 tick 只刷奇/偶行，单次扫描量减半（每行 1s 完整刷新一次）
    this._mmParity = 1 - (this._mmParity || 0);
    const moved = px !== this._mmLastPx || pz !== this._mmLastPz;
    this._mmLastPx = px; this._mmLastPz = pz;
    const full = moved || !this._mmSnapshot;   // 移动时全刷（避免错位残影）

    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, S, S);
    if (!full && this._mmSnapshot) ctx.putImageData(this._mmSnapshot, 0, 0);

    for (let dz = -RANGE; dz < RANGE; dz++) {
      if (!full && ((dz + RANGE) & 1) !== this._mmParity) continue;
      for (let dx = -RANGE; dx < RANGE; dx++) {
        const wx = px + dx, wz = pz + dz;
        // 找地表：从 64 起扫（覆盖最高山 51 + 树高 6 + 玩家高空建筑余量）
        let color = null;
        for (let y = 64; y >= 0; y--) {
          const t = world.getBlock(wx, y, wz);
          if (t !== BLOCK.AIR) {
            color = getBlockPreviewColor(t);
            // 高度明暗
            const shade = Math.max(-30, Math.min(30, (y - GROUND_Y) * 3));
            ctx.fillStyle = color;
            ctx.globalAlpha = 1;
            ctx.fillRect((dx + RANGE) * cell, (dz + RANGE) * cell, Math.ceil(cell), Math.ceil(cell));
            if (shade !== 0) {
              ctx.fillStyle = shade > 0 ? `rgba(255,255,255,${shade/160})` : `rgba(0,0,0,${-shade/120})`;
              ctx.fillRect((dx + RANGE) * cell, (dz + RANGE) * cell, Math.ceil(cell), Math.ceil(cell));
            }
            break;
          }
        }
      }
    }

    // 地形快照（不含箭头/标记），供下次交错刷新做底图
    try { this._mmSnapshot = ctx.getImageData(0, 0, S, S); } catch (_) { this._mmSnapshot = null; }

    // 玩家箭头
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#FFD24A';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // MYFLICKER 神殿方向标记
    const mx = 0 - px, mz = -16 - pz;
    const md = Math.sqrt(mx*mx + mz*mz);
    if (md > RANGE) {
      const nx = mx / md * (S/2 - 8), nz = mz / md * (S/2 - 8);
      ctx.fillStyle = '#FFD24A';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('✦', S/2 + nx, S/2 + nz + 3);
    }

    // 村庄标记（🏠 图标，超出范围贴边）
    if (typeof VILLAGES !== 'undefined') {
      for (const v of VILLAGES) {
        let vx = v.x - px, vz = v.z - pz;
        const vd = Math.sqrt(vx*vx + vz*vz);
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        if (vd <= RANGE) {
          ctx.fillStyle = '#FF9D5C';
          ctx.fillText('⌂', S/2 + vx * cell, S/2 + vz * cell + 3);
        } else {
          const nx = vx / vd * (S/2 - 8), nz = vz / vd * (S/2 - 8);
          ctx.fillStyle = 'rgba(255,157,92,0.75)';
          ctx.fillText('⌂', S/2 + nx, S/2 + nz + 3);
        }
      }
    }

    // 已发现的野外遗迹标记（v4.9：只标记发现过的，保留探索惊喜）
    if (typeof WILDS !== 'undefined') {
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#BFA3FF';
      for (const w of WILDS) {
        if (!w._found) continue;
        const wx = w.x - px, wz = w.z - pz;
        if (Math.sqrt(wx*wx + wz*wz) <= RANGE)
          ctx.fillText('▲', S/2 + wx * cell, S/2 + wz * cell + 3);
      }
    }

    // v5 探索指引：最近的一处「未发现」村庄/遗迹各给一个贴边「?」
    // 位置只指方向不透名字，保住探索惊喜；走近自动发现后 ? 消失
    const guide = (list, color) => {
      if (typeof list === 'undefined') return;
      let best = null, bd = Infinity;
      for (const it of list) {
        if (it._found) continue;
        const dx = it.x - px, dz = it.z - pz;
        const d = Math.sqrt(dx*dx + dz*dz);
        if (d < bd) { bd = d; best = { dx, dz, d }; }
      }
      if (!best || best.d <= RANGE) return;   // 图内的自然能看见地形，不用指
      const nx = best.dx / best.d * (S/2 - 8), nz = best.dz / best.d * (S/2 - 8);
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText('?', S/2 + nx, S/2 + nz + 3);
    };
    guide(typeof VILLAGES !== 'undefined' ? VILLAGES : undefined, 'rgba(125,249,170,0.9)');
    guide(typeof WILDS !== 'undefined' ? WILDS : undefined, 'rgba(191,163,255,0.9)');

    // v5 幽灵玩家：小地图冷蓝圆点（多人在线可视化）
    const ghosts = window.gameGhosts?.ghosts;
    if (ghosts?.size) {
      ctx.fillStyle = '#7FB8FF';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      for (const g of ghosts.values()) {
        const gx = g.group.position.x - px, gz = g.group.position.z - pz;
        const gd = Math.sqrt(gx*gx + gz*gz);
        let sx, sz;
        if (gd <= RANGE) { sx = S/2 + gx * cell; sz = S/2 + gz * cell; }
        else { sx = S/2 + gx / gd * (S/2 - 6); sz = S/2 + gz / gd * (S/2 - 6); }
        ctx.beginPath();
        ctx.arc(sx, sz, 2.5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
    }
  }

  /* ===== v5.2：在线玩家面板（P 键 / 👥 按钮） ===== */
  toggleOnlinePanel(force) {
    const panel = document.getElementById('online-panel');
    if (!panel) return;
    const show = force !== undefined ? force : !panel.classList.contains('show');
    panel.classList.toggle('show', show);
    if (show) this._renderOnlinePanel();
  }

  _renderOnlinePanel() {
    const panel  = document.getElementById('online-panel');
    const list   = document.getElementById('online-list');
    const title  = document.getElementById('online-title');
    if (!list) return;

    const ghosts  = window.gameGhosts?.ghosts;        // Map: userId → ghost
    const myPos   = window.gamePhysics?.position;
    const myCloud = window.gameCloud;
    const myNick  = myCloud?._nick?.() ?? '我';
    const myId    = myCloud?.user?.$id ?? null;

    // 计算到玩家最近地标的文字（神殿/村庄/遗迹）
    const nearestLandmark = (x, z) => {
      let best = null, bd = Infinity;
      // 神殿
      const td = Math.sqrt(x*x + (z+16)*(z+16));
      if (td < bd) { bd = td; best = `MYFLICKER 神殿 (${td.toFixed(0)} 格)`; }
      // 村庄
      if (typeof VILLAGES !== 'undefined') {
        for (const v of VILLAGES) {
          const d = Math.sqrt((x-v.x)**2 + (z-v.z)**2);
          if (d < bd) { bd = d; best = `${v.name} (${d.toFixed(0)} 格)`; }
        }
      }
      // 遗迹
      if (typeof WILDS !== 'undefined') {
        for (const w of WILDS) {
          const d = Math.sqrt((x-w.x)**2 + (z-w.z)**2);
          if (d < bd) { bd = d; best = `${w.name} (${d.toFixed(0)} 格)`; }
        }
      }
      return best || '旷野';
    };

    // 群系名
    const biomeLabel = (x, z) => {
      const world = window.gameWorld;
      if (!world) return '';
      const b = world.biomeAt(Math.floor(x), Math.floor(z));
      return BIOME_NAME?.[b] ?? '';
    };

    list.innerHTML = '';

    // 计算总人数（自己 + 幽灵）
    const ghostCount = ghosts?.size ?? 0;
    const total = ghostCount + (myId ? 1 : 0);
    title.textContent = `👥 在线玩家 (${total})`;

    // 自己一行（若已登录）
    if (myPos && myId) {
      const lm  = nearestLandmark(myPos.x, myPos.z);
      const bio = biomeLabel(myPos.x, myPos.z);
      const row = document.createElement('div');
      row.className = 'op-row me';
      row.innerHTML =
        `<span class="op-avatar">🟡</span>` +
        `<span class="op-info">` +
          `<div class="op-name">${this._esc(myNick)}（我）</div>` +
          `<div class="op-loc">📍 ${bio ? bio + ' · ' : ''}${lm} &nbsp;|&nbsp; XYZ ${myPos.x.toFixed(0)}, ${myPos.y.toFixed(0)}, ${myPos.z.toFixed(0)}</div>` +
        `</span>` +
        `<span class="op-dist">—</span>`;
      list.appendChild(row);
    }

    // 其他玩家行
    if (!ghostCount) {
      if (total === 0 || (total === 1 && myId)) {
        list.insertAdjacentHTML('beforeend',
          `<div id="online-empty">暂时没有其他冒险者在线 👻<br><span style="font-size:11px;opacity:.6">等待更多人进入这个世界…</span></div>`);
      }
    } else {
      const sorted = [...ghosts.values()].sort((a, b) => {
        if (!myPos) return 0;
        const da = (a.group.position.x - myPos.x)**2 + (a.group.position.z - myPos.z)**2;
        const db = (b.group.position.x - myPos.x)**2 + (b.group.position.z - myPos.z)**2;
        return da - db;   // 由近到远
      });

      for (const g of sorted) {
        const gp  = g.group.position;
        const lm  = nearestLandmark(gp.x, gp.z);
        const bio = biomeLabel(gp.x, gp.z);
        const nick = g.label?.userData?.text ?? '???';
        let distStr = '';
        if (myPos) {
          const d = Math.sqrt((gp.x-myPos.x)**2 + (gp.y-myPos.y)**2 + (gp.z-myPos.z)**2);
          distStr = d < 1000 ? `${d.toFixed(0)} 格` : `${(d/1000).toFixed(1)} km`;
        }
        const row = document.createElement('div');
        row.className = 'op-row';
        row.innerHTML =
          `<span class="op-avatar">👻</span>` +
          `<span class="op-info">` +
            `<div class="op-name">${this._esc(nick)}</div>` +
            `<div class="op-loc">📍 ${bio ? bio + ' · ' : ''}${lm} &nbsp;|&nbsp; XYZ ${gp.x.toFixed(0)}, ${gp.y.toFixed(0)}, ${gp.z.toFixed(0)}</div>` +
          `</span>` +
          `<span class="op-dist">${distStr}</span>`;
        list.appendChild(row);
      }
    }

    // 2s 自动刷新（面板开着时）
    clearTimeout(this._onlineRefreshTimer);
    this._onlineRefreshTimer = setTimeout(() => {
      if (document.getElementById('online-panel')?.classList.contains('show')) {
        this._renderOnlinePanel();
      }
    }, 2000);
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g,
      c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ===== 调试面板 ===== */
  updateDebug(physics, fps, controls, world, timeLabel) {
    const p = physics.position;
    const meta = BLOCK_META[this.selectedBlock] || {};
    const biome = world ? BIOME_NAME[world.biomeAt(Math.floor(p.x), Math.floor(p.z))] : '—';
    let mode = '🚶 步行';
    if (physics.flying) mode = '🕊️ 飞行';
    else if (physics.inWater) mode = '🏊 游泳';
    const sprint = controls?.keys['ShiftLeft'] || controls?.keys['ShiftRight'];
    if (mode === '🚶 步行' && sprint) mode = '🏃 冲刺';

    const stars = window.gameEntities?.starCollected ?? 0;
    this.debugEl.textContent =
      `FPS ${fps} · ${timeLabel || ''}\n` +
      `XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
      `群系 ${biome} · ${mode}\n` +
      `手持 ${meta.name || '—'} · ⭐${stars} · 成就 ${this.unlocked.size}/${Object.keys(ACHIEVEMENTS).length}`;
  }
}
