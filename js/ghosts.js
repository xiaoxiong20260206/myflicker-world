/**
 * ghosts.js — 幽灵玩家（v4.8 多人在线 Tier 2）
 * 登录玩家把自己的坐标以低频写入 presence 表，
 * 所有客户端通过 Appwrite Realtime 订阅该表，把其他在线玩家渲染成
 * 头顶昵称的像素小人（复用村民模型），平滑插值移动。
 *
 * 设计约束：
 *   - 隐私：只上传匿名昵称 + 坐标，绝不上传快手账号真名（与排行榜同规）
 *   - 频率：移动时 ~0.7Hz 上报 + 10s 心跳；静止不重复写（省配额）
 *   - TTL：25s 无更新视为离线，头像淡出移除（兜底 pagehide 时 keepalive 删行）
 *   - 未登录也能"看见"别人（presence read any），但不上报自己
 */

(function () {
  'use strict';

  const P_DB      = 'game_db';
  const P_TABLE   = 'presence';
  const CHANNEL   = `databases.${P_DB}.tables.${P_TABLE}.rows`;
  const TTL_MS    = 25000;   // 超时视为离线
  const HEART_MS  = 10000;   // 静止心跳间隔
  const MOVE_MS   = 1400;    // 移动上报最小间隔
  const MOVE_EPS  = 0.6;     // 位移超过 0.6 格才算"动了"
  const YAW_EPS   = 0.35;    // 视角转过 ~20° 也算动了
  const MAX_GHOSTS = 24;     // 同屏幽灵上限（防恶意/超载）

  /* 幽灵袍色：偏冷的蓝紫系，和暖色系村民一眼区分 */
  const GHOST_ROBES = [0x4A6A9A, 0x6A5A9A, 0x3A8A8A, 0x5A7ABA, 0x8A5A8A, 0x4A8A6A];

  class GhostPlayers {
    constructor() {
      this.ghosts = new Map();      // user_id -> { group, label, target:{x,y,z,yaw}, lastSeen, walk }
      this.count  = 0;              // 当前在线的其他玩家数（UI 展示用）
      this._unsub = null;
      this._lastSent = { x: NaN, y: NaN, z: NaN, yaw: NaN, at: 0 };
      this._met = false;            // 是否已解锁"遇见玩家"成就
      this._started = false;
    }

    /* ===== 启动：等 cloud/game 都就绪后由 cloud.init 尾声调用 ===== */
    start() {
      if (this._started) return;
      const cloud = window.gameCloud;
      const scene = window.gameWorld?.scene;
      if (!cloud || !scene || typeof Appwrite === 'undefined') return;
      this._started = true;
      this.cloud = cloud;
      this.scene = scene;

      this._loadRoster();      // 先拉一遍当前在线名单
      this._subscribe();       // 再订阅增量

      // 上报定时器：低频轮询自身位置（仅登录 + 游玩中 + 页面可见）
      setInterval(() => this._maybeReport(), 700);

      // 离开页面：尽力删掉自己的 presence 行，别人立即看到你消失
      window.addEventListener('pagehide', () => this._removeSelf());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this._removeSelf();
      });
    }

    /* ===== 初始名单：拉取 TTL 内活跃的行 ===== */
    async _loadRoster() {
      try {
        const { Query } = Appwrite;
        const res = await this.cloud.tables.listRows({
          databaseId: P_DB, tableId: P_TABLE,
          queries: [Query.limit(MAX_GHOSTS + 1)],
        });
        const now = Date.now();
        for (const r of (res.rows || [])) {
          if (now - new Date(r.$updatedAt).getTime() > TTL_MS) continue;
          this._upsertGhost(r);
        }
        this._refreshCount();
      } catch (e) {
        console.warn('[ghosts] roster load failed:', e?.message || e);
      }
    }

    /* ===== Realtime 订阅 ===== */
    _subscribe() {
      try {
        // SDK 的 endpointRealtime 默认为空串，直接 subscribe 会拼出相对 URL 的
        // WebSocket 地址（部分浏览器抛错）。显式指到同源 wss（走同一层代理）。
        try {
          const ws = location.origin.replace('https://', 'wss://').replace('http://', 'ws://') + '/v1';
          this.cloud.client.setEndpointRealtime(ws);
        } catch (_) {}
        this._unsub = this.cloud.client.subscribe(CHANNEL, msg => {
          const p = msg?.payload;
          if (!p || !p.user_id) return;
          const ev = (msg.events || []).join(' ');
          if (ev.includes('.delete')) this._removeGhost(p.user_id);
          else this._upsertGhost(p);   // create / update / upsert
          this._refreshCount();
        });
      } catch (e) {
        console.warn('[ghosts] realtime subscribe failed:', e?.message || e);
      }
    }

    /* ===== 上报自己 ===== */
    _maybeReport() {
      const cloud = this.cloud;
      if (!cloud?.user) return;                          // 未登录不上报
      if (!window.gameControls?.locked) return;          // 没在玩
      if (document.visibilityState === 'hidden') return; // 切后台
      const pos = window.gamePhysics?.position;
      const yaw = window.gameControls?.yaw ?? 0;
      if (!pos) return;

      const now = Date.now();
      const s = this._lastSent;
      const moved = Math.abs(pos.x - s.x) + Math.abs(pos.y - s.y) + Math.abs(pos.z - s.z) > MOVE_EPS
                 || Math.abs(yaw - s.yaw) > YAW_EPS;
      const due = moved ? (now - s.at > MOVE_MS) : (now - s.at > HEART_MS);
      if (!due) return;

      this._lastSent = { x: pos.x, y: pos.y, z: pos.z, yaw, at: now };
      const { Permission, Role } = Appwrite;
      cloud.tables.upsertRow({
        databaseId: P_DB, tableId: P_TABLE,
        rowId: cloud.user.$id,
        data: {
          user_id: cloud.user.$id,
          nickname: cloud._nick(),         // 匿名马甲/自定义昵称，不含真名
          x: Math.round(pos.x * 10) / 10,
          y: Math.round(pos.y * 10) / 10,
          z: Math.round(pos.z * 10) / 10,
          yaw: Math.round(yaw * 100) / 100,
        },
        permissions: [
          Permission.update(Role.user(cloud.user.$id)),
          Permission.delete(Role.user(cloud.user.$id)),
        ],
      }).catch(() => {});
    }

    /** 离开页面时删掉自己的行（keepalive，页面卸载也能发出） */
    _removeSelf() {
      const cloud = this.cloud;
      if (!cloud?.user) return;
      this._lastSent.at = 0;   // 回来后立即重新上报
      try {
        const headers = { 'x-appwrite-project': 'myflickerworldv4' };
        try {
          const fb = localStorage.getItem('cookieFallback');
          if (fb) headers['X-Fallback-Cookies'] = fb;
        } catch (_) {}
        fetch(`${location.origin}/v1/tablesdb/${P_DB}/tables/${P_TABLE}/rows/${cloud.user.$id}`, {
          method: 'DELETE', headers, credentials: 'include', keepalive: true,
        }).catch(() => {});
      } catch (_) {}
    }

    /* ===== 幽灵渲染 ===== */
    _upsertGhost(row) {
      const myId = this.cloud?.user?.$id;
      if (row.user_id === myId) return;                  // 自己不渲染
      const now = Date.now();

      let g = this.ghosts.get(row.user_id);
      if (!g) {
        if (this.ghosts.size >= MAX_GHOSTS) return;
        // 复用村民像素小人，冷色袍区分；按 user_id 哈希取稳定颜色
        let h = 0;
        for (let i = 0; i < row.user_id.length; i++) h = ((h << 5) - h + row.user_id.charCodeAt(i)) | 0;
        const robe = GHOST_ROBES[Math.abs(h) % GHOST_ROBES.length];
        const group = AnimalModels.villager(robe);
        group.position.set(row.x || 0, row.y || 0, row.z || 0);
        group.rotation.y = row.yaw || 0;
        group.scale.setScalar(0.01);   // v5：从极小淡入（update 里长大）

        const label = this._makeLabel(row.nickname || '???');
        label.position.set(0, 2.15, 0);
        group.add(label);

        this.scene.add(group);
        g = { group, label, target: { x: row.x, y: row.y, z: row.z, yaw: row.yaw || 0 }, lastSeen: now, walk: 0, fade: 0 };
        this.ghosts.set(row.user_id, g);

        window.gameUI?.toast(`👻 ${row.nickname || '有人'} 也在这个世界里！`, true);
        if (!this._met) {
          this._met = true;
          window.gameUI?.unlockAchievement('meet');
        }
      } else {
        g.target = { x: row.x, y: row.y, z: row.z, yaw: row.yaw || 0 };
        g.lastSeen = now;
        // 昵称变了就重画
        if (row.nickname && row.nickname !== g.label.userData.text) {
          g.group.remove(g.label);
          this._disposeLabel(g.label);
          g.label = this._makeLabel(row.nickname);
          g.label.position.set(0, 2.15, 0);
          g.group.add(g.label);
        }
      }
    }

    _removeGhost(userId) {
      const g = this.ghosts.get(userId);
      if (!g) return;
      this.scene.remove(g.group);
      this._disposeLabel(g.label);
      this.ghosts.delete(userId);
    }

    _refreshCount() {
      this.count = this.ghosts.size;
    }

    /** 头顶昵称牌（canvas → Sprite；label 材质独占，移除时须 dispose） */
    _makeLabel(text) {
      const show = `👻 ${text}`.slice(0, 12);
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = Math.min(248, ctx.measureText(show).width + 36);
      ctx.fillStyle = 'rgba(10,16,32,0.55)';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect((256 - w) / 2, 8, w, 44, 10);
        ctx.fill();
      } else {
        ctx.fillRect((256 - w) / 2, 8, w, 44);   // 老浏览器兜底：直角背景
      }
      ctx.fillStyle = '#BFE3FF';
      ctx.fillText(show, 128, 31);
      const tex = new THREE.CanvasTexture(cv);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.scale.set(2.4, 0.6, 1);
      sp.userData.text = text;
      return sp;
    }

    _disposeLabel(label) {
      try { label.material.map?.dispose(); label.material.dispose(); } catch (_) {}
    }

    /* ===== 每帧：插值移动 + 走路摆动 + TTL 清理 ===== */
    update(dt) {
      if (!this.ghosts.size) return;
      const now = Date.now();
      const k = 1 - Math.exp(-dt * 5);   // 平滑跟随系数

      for (const [id, g] of this.ghosts) {
        // v5：接近 TTL 先淡出（缩小），彻底超时或缩到极小才移除，避免"啪"地消失
        const age = now - g.lastSeen;
        if (age > TTL_MS) { this._removeGhost(id); continue; }
        const targetFade = age > TTL_MS - 4000 ? 0 : 1;   // 最后 4s 淡出
        g.fade += (targetFade - g.fade) * Math.min(1, dt * 3);
        if (targetFade === 0 && g.fade < 0.02) { this._removeGhost(id); continue; }
        // 当前缩放：淡入(0.01→1) 与淡出共用 fade
        g.group.scale.setScalar(Math.max(0.01, g.fade));

        const gp = g.group.position, t = g.target;
        const dx = t.x - gp.x, dy = t.y - gp.y, dz = t.z - gp.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 24) {
          gp.set(t.x, t.y, t.z);          // 传送级距离直接瞬移（换区/复活）
        } else {
          gp.x += dx * k; gp.y += dy * k; gp.z += dz * k;
        }

        // 朝向插值（处理 ±π 回绕）
        let dyaw = (t.yaw - g.group.rotation.y) % (Math.PI * 2);
        if (dyaw > Math.PI) dyaw -= Math.PI * 2;
        if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        g.group.rotation.y += dyaw * k;

        // 移动中摆臂迈腿（幅度随速度）
        const speed = dist > 24 ? 0 : dist * 5;
        const u = g.group.userData;
        if (speed > 0.4 && u.arms) {
          g.walk += dt * Math.min(10, 4 + speed);
          const sw = Math.sin(g.walk) * Math.min(0.6, speed * 0.12);
          u.arms[0].rotation.x =  sw; u.arms[1].rotation.x = -sw;
          u.legs[0].rotation.x = -sw; u.legs[1].rotation.x =  sw;
        } else if (u.arms) {
          u.arms[0].rotation.x *= 0.85; u.arms[1].rotation.x *= 0.85;
          u.legs[0].rotation.x *= 0.85; u.legs[1].rotation.x *= 0.85;
        }
      }
      this._refreshCount();
    }
  }

  window.gameGhosts = new GhostPlayers();
})();
