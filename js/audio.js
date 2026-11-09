/**
 * audio.js — WebAudio 程序化音效（v3 新增）
 * 无任何音频素材，全部用振荡器 + 噪声实时合成。
 */

class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    /* v5：BGM 状态 */
    this.bgmOn = true;            // 玩家开关（M 键 / 按钮），默认开
    this._bgmMood = 'day';        // day | night | rain
    this._bgmTimer = null;        // lookahead 调度器
    this._bgmStep = 0;            // 当前 16 分音符步进
    try { this.bgmOn = localStorage.getItem('myflicker-v4-bgm') !== '0'; } catch {}
  }

  /* 必须在用户手势后调用；重复调用 = 尝试恢复被挂起的 ctx（iOS 常见） */
  init() {
    if (this.ctx) { this._resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this._startWind();
      this._startBgm();
      // iOS Safari：手势内创建的 ctx 仍可能是 suspended；切后台回来也会被挂起
      this._resume();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._resume();
      });
    } catch (e) { this.enabled = false; }
  }

  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  _now() { return this.ctx.currentTime; }

  /* 短促合成音 */
  _tone(freq, dur, type = 'square', vol = 0.2, slide = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /* 噪声爆破（破坏方块） */
  _noiseBurst(dur = 0.14, vol = 0.3, freq = 900) {
    if (!this.ctx || !this.enabled) return;
    const t = this._now();
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t);
  }

  /* 环境风声（循环低频噪声） */
  _startWind() {
    const dur = 4;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // 布朗噪声
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.998;
      d[i] = last * 3;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 320;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(filter); filter.connect(this.windGain); this.windGain.connect(this.master);
    src.start();
  }

  /* ===== 对外音效 ===== */
  place()   { this._tone(520, 0.08, 'square', 0.14, 180); }
  break_()  { this._noiseBurst(0.15, 0.32, 800); this._tone(180, 0.1, 'triangle', 0.15, -80); }
  jump()    { this._tone(300, 0.12, 'sine', 0.12, 160); }
  splash()  { this._noiseBurst(0.35, 0.22, 500); }
  flyOn()   { this._tone(420, 0.18, 'sine', 0.14, 380); }
  flyOff()  { this._tone(700, 0.18, 'sine', 0.14, -340); }
  achieve() {
    this._tone(660, 0.12, 'sine', 0.18);
    setTimeout(() => this._tone(880, 0.14, 'sine', 0.18), 110);
    setTimeout(() => this._tone(1320, 0.22, 'sine', 0.16), 230);
  }
  step() { this._noiseBurst(0.05, 0.05, 1300); }
  /* v4：动物叫声（双音） */
  animal([f1, f2]) {
    this._tone(f1, 0.12, 'square', 0.1, f2 - f1);
    setTimeout(() => this._tone(f2, 0.1, 'square', 0.08, -40), 130);
  }
  /* v4：村民咕哝 */
  talk() {
    this._tone(240, 0.09, 'sawtooth', 0.08, 60);
    setTimeout(() => this._tone(300, 0.1, 'sawtooth', 0.07, -80), 100);
    setTimeout(() => this._tone(260, 0.12, 'sawtooth', 0.06, 40), 210);
  }
  /* v4：星星收集（上行琶音） */
  star() {
    this._tone(780, 0.09, 'sine', 0.16);
    setTimeout(() => this._tone(1040, 0.09, 'sine', 0.15), 80);
    setTimeout(() => this._tone(1560, 0.16, 'sine', 0.14), 160);
  }
  /* v4：雨声环境（循环高频噪声，淡入淡出） */
  setRain(on) {
    if (!this.ctx || !this.enabled) return;
    if (on) {
      if (this._rainSrc) return;
      const dur = 3;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 1400; filter.Q.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this._now());
      g.gain.exponentialRampToValueAtTime(0.12, this._now() + 2);
      src.connect(filter); filter.connect(g); g.connect(this.master);
      src.start();
      this._rainSrc = src; this._rainGain = g;
    } else if (this._rainSrc) {
      const g = this._rainGain, src = this._rainSrc;
      try {
        g.gain.setValueAtTime(g.gain.value, this._now());
        g.gain.exponentialRampToValueAtTime(0.0001, this._now() + 1.5);
        src.stop(this._now() + 1.6);
      } catch {}
      this._rainSrc = null; this._rainGain = null;
    }
  }

  /* ===== v5：环境 BGM（程序化 chiptune，零素材） =====
   * 五声音阶（宫调式）随机漫步旋律 + 根音低音，按 lookahead 调度不掉拍。
   * 三种情绪：day 明快 / night 静谧 / rain 湿润（由 game.js 每帧驱动 setBgmMood）
   */
  _startBgm() {
    // 独立总线：淡入淡出 + 一键静音都拧这一个 gain
    this._bgmGain = this.ctx.createGain();
    this._bgmGain.gain.value = this.bgmOn ? 0.0001 : 0;
    this._bgmGain.connect(this.master);
    if (this.bgmOn) this._bgmGain.gain.exponentialRampToValueAtTime(1, this._now() + 3);

    // lookahead 调度：每 100ms 醒来，把未来 200ms 内的音符排进队列（后台掉帧也不乱拍）
    this._bgmNext = this._now() + 0.5;
    this._bgmTimer = setInterval(() => {
      if (!this.bgmOn || !this.enabled) return;
      // 切后台回来 _bgmNext 可能大幅落后 currentTime，直接跳到现在（防止积压音符一次性炸响）
      if (this._bgmNext < this._now() - 0.5) this._bgmNext = this._now() + 0.1;
      while (this._bgmNext < this._now() + 0.2) {
        this._bgmScheduleStep(this._bgmNext);
        this._bgmNext += this._bgmMood === 'night' ? 0.32 : 0.24;   // 夜晚更慢
      }
    }, 100);
  }

  /* 单个 16 分步进：旋律随机漫步 + 每小节根音 */
  _bgmScheduleStep(t) {
    // C 宫五声音阶两个八度（day 用高八度更亮，night/rain 用低八度）
    const PENTA = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3, 784.0, 880.0];
    const mood = this._bgmMood;
    const step = this._bgmStep++;

    // 旋律：随机漫步（相邻音级 ±2 内移动），概率性休止营造呼吸感
    const rest = mood === 'night' ? 0.55 : mood === 'rain' ? 0.45 : 0.3;
    if (Math.random() > rest) {
      this._bgmDeg = (this._bgmDeg ?? 4) + (Math.floor(Math.random() * 5) - 2);
      const lo = mood === 'day' ? 3 : 0;
      const hi = mood === 'day' ? 9 : 6;
      this._bgmDeg = Math.max(lo, Math.min(hi, this._bgmDeg));
      const type = mood === 'rain' ? 'sine' : 'triangle';
      const vol = mood === 'day' ? 0.055 : 0.042;
      this._bgmNote(PENTA[this._bgmDeg], mood === 'night' ? 0.5 : 0.3, type, vol, t);
    }
    // 低音：每小节（8 步）第 1 拍给根音或五度
    if (step % 8 === 0) {
      const bass = step % 16 === 0 ? 130.8 : 98.0;   // C3 / G2 交替
      this._bgmNote(bass, mood === 'night' ? 1.4 : 0.9, 'sine', 0.07, t);
    }
  }

  /* BGM 专用音符：定时到 t、走 bgm 总线（区别于 _tone 的立即发声+master） */
  _bgmNote(freq, dur, type, vol, t) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this._bgmGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  /* 由 game.js 每帧驱动：白天/夜晚/下雨切换情绪（内部只在变化时生效） */
  setBgmMood(mood) {
    if (mood !== this._bgmMood) this._bgmMood = mood;
  }

  /* M 键 / 按钮：BGM 开关（淡入淡出），返回新状态 */
  toggleBgm() {
    this.bgmOn = !this.bgmOn;
    try { localStorage.setItem('myflicker-v4-bgm', this.bgmOn ? '1' : '0'); } catch {}
    if (this.ctx && this._bgmGain) {
      const g = this._bgmGain.gain;
      g.setValueAtTime(Math.max(0.0001, g.value), this._now());
      g.exponentialRampToValueAtTime(this.bgmOn ? 1 : 0.0001, this._now() + 1);
    }
    return this.bgmOn;
  }

  /* v5：传送吟唱（上行滑音）与完成音 */
  teleportCast() { this._tone(220, 0.5, 'sine', 0.1, 220); }
  teleportDone() {
    this._tone(880, 0.12, 'sine', 0.16);
    setTimeout(() => this._tone(1174, 0.2, 'sine', 0.14), 100);
  }
  /* v5：彩虹星（更长的欢快琶音） */
  rainbowStar() {
    [660, 880, 1040, 1320, 1760].forEach((f, i) =>
      setTimeout(() => this._tone(f, 0.14, 'sine', 0.15), i * 90));
  }
}

window.gameAudio = new GameAudio();
