/**
 * cloud.js — 快手账号登录 + 云存档 + 排行榜（v4.3 新增）
 * 依赖 vendor/appwrite-sdk.js（@codeflicker/appwrite IIFE 构建，全局 Appwrite）
 * 后端：frontend-cloud Appwrite 实例，项目 myflickerworldv4，表 game_db/leaderboard
 *
 * 存档策略：
 *   - 本地 localStorage 始终是第一存储（离线可玩）
 *   - 登录后：云端 save_data 与本地合并（星星取最大、成就取并集、方块编辑本地覆盖云端）
 *   - 游玩中每 30s + 页面隐藏时自动上传，换设备/清浏览器后按账号 ID 恢复
 */

(function () {
  'use strict';

  const DB_ID    = 'game_db';
  const TABLE_ID = 'leaderboard';
  const NICK_KEY = 'myflicker-v4-nickname';   // 自定义昵称（本地）
  const SAVE_LIMIT      = 490000;  // save_data 列上限 500KB，留余量
  const KEEPALIVE_LIMIT = 60000;   // fetch keepalive 请求体配额 64KB，留余量

  /* 匿名昵称词库：默认不暴露快手账号名 */
  const NICK_ADJ = ['快乐', '神秘', '勇敢', '悠闲', '闪光', '迅捷', '安静', '梦游', '元气', '摸鱼'];
  const NICK_ANI = ['小羊', '狐狸', '小鸡', '兔子', '飞鸟', '蝴蝶', '游鱼', '小猪', '村民', '拾星人'];

  class CloudSync {
    constructor() {
      const { Client, Account, TablesDB } = Appwrite;
      this.client  = new Client()
        .setEndpoint(location.origin + '/v1')   // 同源代理，禁止写死域名
        .setProject('myflickerworldv4');
      this.account = new Account(this.client);
      this.tables  = new TablesDB(this.client);

      this.user        = null;
      this.playSeconds = 0;       // 累计游玩时长（含云端历史）
      this._syncing    = false;
      this._dirty      = false;
      this._failCount  = 0;       // 连续同步失败次数（≥3 提示用户）
      this._note       = '';      // 登录栏附加状态（恢复结果 / 异常提示）

      this.authBar   = document.getElementById('auth-bar');
      this.lbPanel   = document.getElementById('leaderboard-panel');
      this.lbList    = document.getElementById('lb-list');

      this._bindUI();
    }

    /* ===== 昵称（v4.4）：默认匿名马甲，不暴露快手账号 =====
       优先级：自定义昵称 > 按账号 ID 生成的固定匿名昵称 */
    _nick() {
      if (!this.user) return '旅行者';
      try {
        const custom = localStorage.getItem(NICK_KEY);
        if (custom) return custom;
      } catch (_) {}
      return this._anonNick();
    }

    /** 由账号 ID 哈希出稳定的匿名昵称，如「梦游的狐狸#3F2A」 */
    _anonNick() {
      const id = this.user?.$id || 'guest';
      let h = 0;
      for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
      h = Math.abs(h);
      const adj = NICK_ADJ[h % NICK_ADJ.length];
      const ani = NICK_ANI[Math.floor(h / 10) % NICK_ANI.length];
      const tag = (h % 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
      return `${adj}的${ani}#${tag}`;
    }

    /** 账号真实名称（仅本人界面展示用，不上传排行榜） */
    _realName() {
      if (!this.user) return '';
      const email = this.user.email || '';
      return this.user.name || (email.includes('@') ? email.split('@')[0] : this.user.$id.slice(0, 8));
    }

    /** 弹窗修改昵称，改完立即同步到排行榜 */
    editNickname() {
      let cur = '';
      try { cur = localStorage.getItem(NICK_KEY) || ''; } catch (_) {}
      const input = prompt(
        '设置排行榜昵称（1~16 字，留空恢复匿名马甲）：\n匿名马甲不会暴露你的快手账号',
        cur || this._anonNick()
      );
      if (input === null) return;   // 取消
      const nick = input.trim().slice(0, 16);
      try {
        if (nick && nick !== this._anonNick()) localStorage.setItem(NICK_KEY, nick);
        else localStorage.removeItem(NICK_KEY);
      } catch (_) {}
      this._renderAuthBar();
      if (this.user) { this._dirty = true; this.sync(); }
      window.gameUI?.toast(`✏️ 昵称已更新：${this._nick()}`, true);
    }

    /* ===== 启动：处理 SSO 回调 → 恢复云存档 ===== */
    async init() {
      // SSO 回调带 ?userId=&secret= 时必须先 await 兑换 session（SDK 内部不等待，已知 Bug）
      try { await Appwrite.handleOAuth2Token(this.client); } catch (_) {}
      if (/[?&](secret|userId|oauthFallback)=/.test(location.search)) {
        history.replaceState(null, '', location.pathname);   // 清掉回调参数
      }

      try { this.user = await this.account.get(); } catch (_) { this.user = null; }
      this._renderAuthBar();
      this._renderWorldStats();   // 「已有 N 位冒险者」（异步，静默失败）

      if (this.user) {
        await this._restore();
        this._startAutoSync();
      }

      // 幽灵玩家（v4.8）：登录与否都能看到别人；登录后才上报自己
      try { window.gameGhosts?.start(); } catch (_) {}
    }

    /* ===== 登录 / 登出 ===== */
    login() {
      this.account.createOAuth2Session({
        provider: Appwrite.OAuthProvider.Kuaishou,
        success: location.origin + location.pathname,
        failure: location.origin + location.pathname,
      });
    }

    async logout() {
      try { await this.sync(); } catch (_) {}
      try { await this.account.deleteSession({ sessionId: 'current' }); } catch (_) {}
      location.reload();
    }

    /* ===== 云端 → 本地：恢复进度 ===== */
    async _restore() {
      let row = null;
      try {
        row = await this.tables.getRow({ databaseId: DB_ID, tableId: TABLE_ID, rowId: this.user.$id });
      } catch (_) { /* 404 = 新玩家 */ }

      this.playSeconds = row?.play_seconds || 0;

      // 昵称跨设备恢复：云端存过自定义昵称且本地没有时回填
      // （旧版曾上传真实账号名，视为需要隐藏的存量数据，不回填 → 下次 sync 自动换成匿名马甲）
      if (row?.nickname) {
        try {
          if (!localStorage.getItem(NICK_KEY) &&
              row.nickname !== this._anonNick() &&
              row.nickname !== this._realName()) {
            localStorage.setItem(NICK_KEY, row.nickname);
            this._renderAuthBar();
          }
          if (row.nickname === this._realName()) this._dirty = true;   // 触发覆盖
        } catch (_) {}
      }

      if (!row?.save_data) { this._dirty = true; return; }

      let save = null;
      try { save = JSON.parse(row.save_data); } catch (_) { return; }

      const W = window.gameWorld, E = window.gameEntities, U = window.gameUI, P = window.gamePhysics;

      // 星星：取本地/云端最大值
      const cloudStars = save.stars || 0;
      if (cloudStars > E.starCollected) {
        E.starCollected = cloudStars;
        try { localStorage.setItem('myflicker-v4-stars', String(cloudStars)); } catch (_) {}
      }
      // 数量型成就按恢复后的总数补触发（拾取瞬间的判定覆盖不到云端恢复）
      if (E.starCollected >= 1)   U.unlockAchievement('star1');
      if (E.starCollected >= 10)  U.unlockAchievement('star10');
      if (E.starCollected >= 25)  U.unlockAchievement('star25');   // v5 里程碑同样要补
      if (E.starCollected >= 50)  U.unlockAchievement('star50');
      if (E.starCollected >= 100) U.unlockAchievement('star100');

      // 成就：并集
      if (Array.isArray(save.ach) && save.ach.length) {
        const before = U.unlocked.size;
        save.ach.forEach(id => { if (ACHIEVEMENTS[id]) U.unlocked.add(id); });
        if (U.unlocked.size > before) {
          try { localStorage.setItem('myflicker-world-v4-achievements', JSON.stringify([...U.unlocked])); } catch (_) {}
        }
      }

      // 方块编辑：云端打底，本地覆盖（本地是最近一次操作）
      const cloudEdits = save.edits || {};
      const keys = Object.keys(cloudEdits);
      if (keys.length) {
        const merged = new Map(keys.map(k => [k, Number(cloudEdits[k])]));
        for (const [k, v] of W.edits) merged.set(k, v);
        W.edits = merged;
        W._scheduleSave();
        // 只重建受影响的已加载区块
        const affected = new Set();
        for (const k of merged.keys()) {
          const [x, , z] = k.split(',').map(Number);
          affected.add(W.key(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
        }
        let rebuilt = 0;
        for (const key of affected) {
          const ch = W.chunks.get(key);
          if (ch) { W._applyMap(ch, merged); W.rebuildChunk(ch); rebuilt++; }
        }
        this._note = `☁️ 已恢复 ${merged.size} 处建造`;
        if (rebuilt) window.gameUI?.toast(`☁️ 云存档已恢复（${merged.size} 处建造）`);
      } else {
        this._note = '☁️ 存档已同步';
      }

      // 位置：恢复到上次离开的地方（restore 发生在页面加载时、进入世界之前）
      if (Array.isArray(save.pos) && save.pos.length === 3 && P) {
        const [x, y, z] = save.pos;
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          P.position.set(x, Math.max(y, 2), z);
        }
      }

      this._renderAuthBar();
    }

    /* ===== 本地 → 云端：上传进度 ===== */

    /** 构建上传数据；save_data 超过列上限时降级（丢弃编辑详情，保留统计与位置） */
    _buildData() {
      const W = window.gameWorld, E = window.gameEntities, U = window.gameUI, P = window.gamePhysics;
      const base = {
        v: 1,
        stars: E.starCollected,
        ach: [...U.unlocked],
        pos: [+P.position.x.toFixed(1), +P.position.y.toFixed(1), +P.position.z.toFixed(1)],
        t: Date.now(),
      };
      let saveData = JSON.stringify({ ...base, edits: Object.fromEntries(W.edits) });
      if (saveData.length > SAVE_LIMIT) {
        saveData = JSON.stringify(base);   // 建造量超限：本地仍完整保留，云端只存统计
        this._note = '⚠️ 建造量过大，云端仅保存统计';
        this._renderAuthBar();
      }
      return {
        user_id: this.user.$id,
        nickname: this._nick(),
        stars: E.starCollected,
        achievements: U.unlocked.size,
        play_seconds: Math.floor(this.playSeconds),
        save_data: saveData,
      };
    }

    async sync() {
      if (!this.user || this._syncing) return;
      this._syncing = true;
      const { Permission, Role } = Appwrite;
      try {
        await this.tables.upsertRow({
          databaseId: DB_ID,
          tableId: TABLE_ID,
          rowId: this.user.$id,
          data: this._buildData(),
          permissions: [
            Permission.update(Role.user(this.user.$id)),
            Permission.delete(Role.user(this.user.$id)),
          ],
        });
        this._dirty = false;
        this._lastSyncAt = Date.now();
        if (this._failCount >= 3) { this._note = ''; this._renderAuthBar(); }
        this._failCount = 0;
      } catch (e) {
        console.warn('[cloud] sync failed:', e?.message || e);
        this._failCount++;
        if (this._failCount === 3) {   // 连续失败才提示，避免误报
          this._note = '⚠️ 云同步异常，进度暂存本地';
          this._renderAuthBar();
        }
      }
      this._syncing = false;
    }

    /**
     * 页面关闭/切后台的应急上传：普通 SDK 请求会随页面卸载被杀，
     * 用 fetch keepalive 保证请求发出（配额 64KB，超限则退回普通 sync 尽力而为）。
     */
    _emergencySync() {
      if (!this.user || !this._dirty) return;
      const { Permission, Role } = Appwrite;
      try {
        const body = JSON.stringify({
          data: this._buildData(),
          permissions: [
            Permission.update(Role.user(this.user.$id)),
            Permission.delete(Role.user(this.user.$id)),
          ],
        });
        if (body.length > KEEPALIVE_LIMIT) { this.sync(); return; }
        const headers = {
          'content-type': 'application/json',
          'x-appwrite-project': 'myflickerworldv4',
        };
        try {
          const fb = localStorage.getItem('cookieFallback');
          if (fb) headers['X-Fallback-Cookies'] = fb;   // 与 SDK 一致的会话兜底
        } catch (_) {}
        fetch(`${location.origin}/v1/tablesdb/${DB_ID}/tables/${TABLE_ID}/rows/${this.user.$id}`, {
          method: 'PUT', headers, body, credentials: 'include', keepalive: true,
        }).catch(() => {});
        this._dirty = false;
      } catch (_) { /* 应急通道失败不影响正常流程 */ }
    }

    _startAutoSync() {
      // 游玩计时 + 周期上传
      setInterval(() => {
        if (window.gameControls?.locked) { this.playSeconds += 5; this._dirty = true; }
      }, 5000);
      setInterval(() => { if (this._dirty) this.sync(); }, 30000);
      // 切后台 / 关页前抢救一次（keepalive，防止请求随页面卸载被杀）
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this._emergencySync();
      });
      window.addEventListener('pagehide', () => this._emergencySync());
      // 首次登录立即建档
      this.sync();
    }

    /* ===== 分享名片（v4.5）：一键分享游玩战绩，拉朋友进来玩 ===== */
    async share() {
      const E = window.gameEntities, U = window.gameUI;
      const stars = E?.starCollected ?? 0;
      const ach   = U?.unlocked.size ?? 0;
      const total = (typeof ACHIEVEMENTS !== 'undefined') ? Object.keys(ACHIEVEMENTS).length : 21;
      const url   = location.origin + location.pathname;
      const text  =
        `🌍 我在《MyFlicker World》里当${this._nick()}，` +
        `已经收集了 ⭐${stars} 颗星星、解锁 ${ach}/${total} 项成就！\n` +
        `这是一个有动物、村庄、星空和排行榜的 3D 像素世界，来和我一起玩：\n${url}`;

      let ok = false;
      // 移动端优先走系统分享面板
      if (navigator.share) {
        try { await navigator.share({ title: 'MyFlicker World', text, url }); ok = true; }
        catch (_) { /* 用户取消或不支持，落到剪贴板 */ }
      }
      if (!ok) {
        try { await navigator.clipboard.writeText(text); ok = true; }
        catch (_) {
          // 剪贴板 API 被拒时的兜底
          try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            ok = document.execCommand('copy');
            ta.remove();
          } catch (_) {}
        }
        if (ok) window.gameUI?.toast('📋 分享文案已复制，发给朋友吧！', true);
      }
      if (ok) window.gameUI?.unlockAchievement('share');
      else window.gameUI?.toast('⚠️ 分享失败，请手动复制网址', true);
    }

    /* ===== 世界人数：排行榜行数即「来过的玩家数」 ===== */
    async playerCount() {
      if (this._playerCount != null) return this._playerCount;
      try {
        const { Query } = Appwrite;
        const res = await this.tables.listRows({
          databaseId: DB_ID, tableId: TABLE_ID, queries: [Query.limit(1)],
        });
        this._playerCount = res.total ?? null;
      } catch (_) { this._playerCount = null; }
      return this._playerCount;
    }

    /** 开始页顶部的世界统计（有数据才显示，静默失败） */
    async _renderWorldStats() {
      const el = document.getElementById('world-stats');
      if (!el) return;
      const n = await this.playerCount();
      if (n) el.textContent = `🌍 已有 ${n} 位冒险者踏入这个世界`;
    }

    /* ===== 重置进度（本地 + 云端） ===== */
    async resetProgress() {
      if (!confirm('确定重置全部进度？建造、星星、成就、云存档都会清空，不可恢复！')) return;
      try { window.gameWorld?.clearSave(); } catch (_) {}
      try {
        localStorage.removeItem('myflicker-v4-stars');
        localStorage.removeItem('myflicker-world-v4-achievements');
        localStorage.removeItem(NICK_KEY);
      } catch (_) {}
      if (this.user) {
        try {
          await this.tables.deleteRow({ databaseId: DB_ID, tableId: TABLE_ID, rowId: this.user.$id });
        } catch (_) {}
      }
      location.reload();
    }

    /* ===== 排行榜 ===== */
    async showLeaderboard() {
      this.lbPanel.classList.add('show');
      this.lbList.innerHTML = '<div class="lb-loading">☁️ 加载中…</div>';
      const { Query } = Appwrite;
      let rows = [];
      try {
        const res = await this.tables.listRows({
          databaseId: DB_ID,
          tableId: TABLE_ID,
          queries: [Query.orderDesc('stars'), Query.orderDesc('achievements'), Query.limit(50)],
        });
        rows = res.rows || [];
      } catch (e) {
        this.lbList.innerHTML = `<div class="lb-loading">加载失败：${(e?.message || e)}</div>`;
        return;
      }
      if (!rows.length) {
        this.lbList.innerHTML = '<div class="lb-loading">还没有玩家上榜，快登录抢占第一！</div>';
        return;
      }
      const fmtTime = s => s >= 3600 ? `${(s/3600).toFixed(1)}h` : `${Math.max(1, Math.round(s/60))}m`;
      const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const inTop = this.user && rows.some(r => r.user_id === this.user.$id);
      this.lbList.innerHTML = rows.map((r, i) => {
        const me = this.user && r.user_id === this.user.$id;
        return `<div class="lb-row${me ? ' me' : ''}">
          <span class="lb-rank">${medal(i)}</span>
          <span class="lb-name">${this._esc(r.nickname || '???')}${me ? '（我）' : ''}</span>
          <span class="lb-stat">⭐${r.stars || 0}</span>
          <span class="lb-stat">🏅${r.achievements || 0}</span>
          <span class="lb-stat lb-time">⏱${fmtTime(r.play_seconds || 0)}</span>
        </div>`;
      }).join('');

      // 登录了但没进前 50：底部补一行「我的排名」，给追赶目标
      if (this.user && !inTop) this._appendMyRank(fmtTime);
    }

    /** 榜外玩家：估算名次（星星数高于我的行数 +1），钉在榜单底部 */
    async _appendMyRank(fmtTime) {
      const { Query } = Appwrite;
      try {
        const mine = await this.tables.getRow({ databaseId: DB_ID, tableId: TABLE_ID, rowId: this.user.$id });
        if (!mine) return;
        const above = await this.tables.listRows({
          databaseId: DB_ID, tableId: TABLE_ID,
          queries: [Query.greaterThan('stars', mine.stars || 0), Query.limit(1)],
        });
        const rank = (above?.total ?? 0) + 1;
        this.lbList.insertAdjacentHTML('beforeend',
          `<div class="lb-row me">
            <span class="lb-rank">${rank}</span>
            <span class="lb-name">${this._esc(mine.nickname || this._nick())}（我）</span>
            <span class="lb-stat">⭐${mine.stars || 0}</span>
            <span class="lb-stat">🏅${mine.achievements || 0}</span>
            <span class="lb-stat lb-time">⏱${fmtTime(mine.play_seconds || 0)}</span>
          </div>`);
      } catch (_) { /* 无档案（尚未同步过）则不显示 */ }
    }

    _esc(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    }

    /* ===== UI ===== */
    _bindUI() {
      document.getElementById('lb-close')?.addEventListener('click', () => this.lbPanel.classList.remove('show'));
      this.lbPanel?.addEventListener('click', e => { if (e.target === this.lbPanel) this.lbPanel.classList.remove('show'); });
    }

    _renderAuthBar() {
      if (!this.authBar) return;
      if (this.user) {
        const state = this._note || '☁️ 云存档已开启';
        this.authBar.innerHTML =
          `<span class="auth-user">👤 ${this._esc(this._nick())}</span>` +
          `<button class="auth-btn" id="btn-nick" title="排行榜显示此昵称，不暴露快手账号">✏️ 昵称</button>` +
          `<span class="auth-state${state.startsWith('⚠️') ? ' warn' : ''}">${this._esc(state)}</span>` +
          `<button class="auth-btn" id="btn-lb">🏆 排行榜</button>` +
          `<button class="auth-btn" id="btn-share">📣 邀请好友</button>` +
          `<button class="auth-btn ghost" id="btn-reset">🗑 重置</button>` +
          `<button class="auth-btn ghost" id="btn-logout">退出</button>`;
        document.getElementById('btn-logout').addEventListener('click', () => this.logout());
        document.getElementById('btn-reset').addEventListener('click', () => this.resetProgress());
        document.getElementById('btn-nick').addEventListener('click', () => this.editNickname());
      } else {
        this.authBar.innerHTML =
          `<button class="auth-btn primary" id="btn-login">📱 快手账号登录 · 云存档</button>` +
          `<button class="auth-btn" id="btn-lb">🏆 排行榜</button>` +
          `<button class="auth-btn" id="btn-share">📣 邀请好友</button>`;
        document.getElementById('btn-login').addEventListener('click', () => this.login());
      }
      document.getElementById('btn-lb').addEventListener('click', () => this.showLeaderboard());
      document.getElementById('btn-share')?.addEventListener('click', () => this.share());
    }
  }

  /* 外网/本地预览没有内网 Appwrite 后端：关闭云功能，只走本地存档，避免无效请求与登录入口 */
  if (!/(^|\.)frontend-cloud\.corp\.kuaishou\.com$/.test(location.hostname)) {
    const bar = document.getElementById('auth-bar');
    if (bar) bar.innerHTML = '<span class="auth-state">🌐 外网体验版 · 云存档与排行榜仅限内网</span>';
    console.warn('[cloud] 非内网站点，云功能关闭');
    return;
  }

  /* SDK 加载失败（如纯本地打开）不影响游戏本体 */
  if (typeof Appwrite === 'undefined') {
    console.warn('[cloud] Appwrite SDK 未加载，云功能关闭');
    return;
  }
  const cloud = new CloudSync();
  window.gameCloud = cloud;
  cloud.init();
})();
