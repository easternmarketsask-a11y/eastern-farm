/**
 * music.js — 程序化背景音乐（零音频文件）。
 *
 * 为什么不放一段 mp3 loop：一首两分钟的 loop 即便 128kbps 也要 2MB，而这个
 * 项目首访已经要下 ~600KB，弱网新客人本来就慢。程序化生成体积是零，而且
 * 永不重复、能跟游戏状态联动。
 *
 * 怎么避免听起来像廉价 MIDI：
 *   1. 音色是叠出来的，不是单个振荡器 —— 拨弦有非整数倍泛音和触弦噪声，
 *      垫音是几个失谐振荡器叠出的合唱感，笛音有气声和颤音。
 *   2. 五声音阶（中式）没有半音冲突，随机组合也不会难听。
 *   3. 慢，留白多。农场是放松的地方，音符密度低才耐听。
 *   4. 时值/力度/声像都带随机，不做机械的等分节拍。
 *
 * 调度用 lookahead：setTimeout 只负责「该往前排了」，音符时刻一律用
 * ctx.currentTime 精确排期 —— 直接用 setTimeout 触发音符会抖得很明显。
 */
(function () {
  const LOOKAHEAD_MS = 90;      // 多久检查一次
  const SCHEDULE_AHEAD = 0.35;  // 往前排多远（秒）

  // 五声音阶·宫调式（C D E G A）。中式风格全部音符从这里取。
  const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00,
                 523.25, 587.33, 659.25, 783.99, 880.00];
  const PENTA_LOW = [130.81, 146.83, 164.81, 196.00, 220.00];

  // C 大调音阶 + 常用和弦（西式民谣用）
  const MAJOR = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];
  const CHORDS_WEST = [
    [130.81, 164.81, 196.00],   // C
    [196.00, 246.94, 293.66],   // G
    [220.00, 261.63, 329.63],   // Am
    [174.61, 220.00, 261.63],   // F
  ];
  // 极简氛围：两个宽松的和声色块来回换
  const CHORDS_MIN = [
    [130.81, 196.00, 293.66, 329.63],   // Cadd9 的骨架
    [174.61, 261.63, 329.63, 392.00],   // Fmaj7 的骨架
  ];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  const music = {
    playing: false,
    style: 'zh',
    _timer: null,
    _next: 0,
    _bar: 0,
    _bus: null,
    _vol: 0.6,

    _ctx() {
      const A = window.Farm && Farm.audio;
      if (!A) return null;
      A._init();
      return A.available ? A.ctx : null;
    },

    /* 音乐自己的总线，接在音效总线上 —— 这样它也走那层院子混响和胶合压缩，
       和音效在同一个空间里，而不是贴在耳朵上另说一套。 */
    _ensureBus() {
      const ctx = this._ctx();
      if (!ctx) return null;
      if (this._bus) return this._bus;
      const g = ctx.createGain();
      g.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;      // 音乐坐在音效后面，别抢高频
      lp.Q.value = 0.6;
      g.connect(lp);
      lp.connect(Farm.audio.masterGain);
      this._bus = g;
      return g;
    },

    // ── 音色 ─────────────────────────────────────────────────────
    /* 拨弦：古筝/竖琴那个质感。泛音非整数倍（真实弦有微小的不谐性），
       高次泛音衰减更快，再加一点触弦的噪声瞬态。 */
    _pluck(t, freq, gain, pan) {
      const ctx = this._ctx(), bus = this._ensureBus();
      if (!ctx || !bus) return;
      const dest = this._pan(ctx, bus, pan);
      const parts = [[1, 1, 1], [2.001, 0.42, 0.62], [3.004, 0.20, 0.42], [4.98, 0.09, 0.28]];
      parts.forEach(([mult, amp, decayMul]) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        const dur = rnd(1.6, 2.4) * decayMul;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain * amp, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + dur + 0.05);
      });
      const nb = Farm.audio._ensureNoise && Farm.audio._ensureNoise();
      if (nb) {
        const src = ctx.createBufferSource();
        src.buffer = nb; src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = freq * 4; bp.Q.value = 1.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain * 0.16, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        src.connect(bp); bp.connect(g); g.connect(dest);
        src.start(t); src.stop(t + 0.06);
      }
    },

    /* 垫音：几个失谐的振荡器叠出合唱感，起音两秒以上，低通缓慢打开再合上
       （呼吸感）。单个振荡器拉长音就是廉价合成器的味道。 */
    _pad(t, freqs, dur, gain) {
      const ctx = this._ctx(), bus = this._ensureBus();
      if (!ctx || !bus) return;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, t);
      lp.frequency.linearRampToValueAtTime(rnd(900, 1300), t + dur * 0.45);
      lp.frequency.linearRampToValueAtTime(480, t + dur);
      lp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + Math.min(2.4, dur * 0.35));
      g.gain.setValueAtTime(gain, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      lp.connect(g); g.connect(bus);
      freqs.forEach((f, i) => {
        [-6, 6].forEach((cents, k) => {
          const osc = ctx.createOscillator();
          osc.type = i === 0 ? 'triangle' : 'sine';
          osc.frequency.value = f * Math.pow(2, cents / 1200);
          const og = ctx.createGain();
          og.gain.value = (i === 0 ? 0.5 : 0.34) / (k + 1);
          osc.connect(og); og.connect(lp);
          osc.start(t); osc.stop(t + dur + 0.1);
        });
      });
    },

    /* 笛音：正弦 + 少量三次谐波 + 慢起音 + 轻微颤音 + 一层气声。
       颤音深度要小 —— 大了立刻变成廉价电子琴。 */
    _flute(t, freq, dur, gain, pan) {
      const ctx = this._ctx(), bus = this._ensureBus();
      if (!ctx || !bus) return;
      const dest = this._pan(ctx, bus, pan);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + rnd(0.18, 0.30));
      g.gain.setValueAtTime(gain, t + dur * 0.72);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(dest);
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const vib = ctx.createOscillator();
      vib.type = 'sine'; vib.frequency.value = rnd(4.6, 5.8);
      const vibGain = ctx.createGain();
      vibGain.gain.value = freq * 0.004;      // 很浅
      vib.connect(vibGain); vibGain.connect(osc.frequency);
      const h3 = ctx.createOscillator();
      h3.type = 'sine'; h3.frequency.value = freq * 3;
      const h3g = ctx.createGain(); h3g.gain.value = 0.07;
      osc.connect(g); h3.connect(h3g); h3g.connect(g);
      const nb = Farm.audio._ensureNoise && Farm.audio._ensureNoise();
      if (nb) {
        const air = ctx.createBufferSource();
        air.buffer = nb; air.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass'; hp.frequency.value = freq * 2.2; hp.Q.value = 0.9;
        const ag = ctx.createGain(); ag.gain.value = 0.05;
        air.connect(hp); hp.connect(ag); ag.connect(g);
        air.start(t); air.stop(t + dur + 0.1);
      }
      [osc, vib, h3].forEach((n) => { n.start(t); n.stop(t + dur + 0.1); });
    },

    _pan(ctx, dest, pan) {
      if (pan == null || !ctx.createStereoPanner) return dest;
      try {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        p.connect(dest);
        return p;
      } catch (e) { return dest; }
    },

    // ── 三种风格：决定「什么时候放什么」 ──────────────────────────
    _zh(t) {
      // 中式田园：一簇拨弦 + 缓慢的低音垫，偶尔一声长笛
      const bar = this._bar;
      if (bar % 4 === 0) {
        const root = pick([0, 3]);            // 宫 或 徵
        this._pad(t, [PENTA_LOW[root], PENTA_LOW[root] * 1.5], rnd(9, 12), 0.10);
      }
      const n = (Math.random() < 0.25) ? 0 : (2 + (Math.random() * 3 | 0));
      let idx = 2 + (Math.random() * 5 | 0);
      for (let i = 0; i < n; i++) {
        idx = Math.max(0, Math.min(PENTA.length - 1, idx + (Math.random() * 5 | 0) - 2));
        this._pluck(t + i * rnd(0.26, 0.46), PENTA[idx], rnd(0.10, 0.17), rnd(-0.35, 0.35));
      }
      if (bar % 8 === 5) {
        this._flute(t + rnd(0.2, 0.6), pick(PENTA.slice(4, 8)), rnd(2.4, 3.6), 0.075, rnd(-0.2, 0.2));
      }
      return rnd(2.6, 4.2);                   // 下一簇多久之后
    },

    _west(t) {
      // 西式民谣：和弦进行 + 分解和弦式的琶音，有明确的「曲子」感
      const chord = CHORDS_WEST[this._bar % CHORDS_WEST.length];
      this._pad(t, chord, rnd(4.2, 5.2), 0.085);
      const steps = 3 + (Math.random() * 3 | 0);
      for (let i = 0; i < steps; i++) {
        const f = (i % 2 === 0) ? chord[i % chord.length] * 2 : pick(MAJOR);
        this._pluck(t + i * 0.34, f, rnd(0.09, 0.14), rnd(-0.3, 0.3));
      }
      if (this._bar % 4 === 3) {
        this._flute(t + 1.0, pick(MAJOR.slice(3)), rnd(1.8, 2.6), 0.07, rnd(-0.2, 0.2));
      }
      return rnd(3.6, 4.4);
    },

    _min(t) {
      // 极简：只有缓慢换色的和声垫，偶尔一颗很轻的拨弦当点缀
      const chord = CHORDS_MIN[this._bar % CHORDS_MIN.length];
      this._pad(t, chord, rnd(11, 15), 0.11);
      if (Math.random() < 0.45) {
        this._pluck(t + rnd(1.5, 5), pick(PENTA.slice(4)), rnd(0.05, 0.09), rnd(-0.4, 0.4));
      }
      return rnd(8, 12);
    },

    // ── 调度 ─────────────────────────────────────────────────────
    _tick() {
      const ctx = this._ctx();
      if (!ctx || !this.playing) return;
      while (this._next < ctx.currentTime + SCHEDULE_AHEAD) {
        if (this._next < ctx.currentTime) this._next = ctx.currentTime + 0.05;
        let gap;
        if (this.style === 'west') gap = this._west(this._next);
        else if (this.style === 'min') gap = this._min(this._next);
        else gap = this._zh(this._next);
        this._next += gap;
        this._bar++;
      }
      this._timer = setTimeout(() => this._tick(), LOOKAHEAD_MS);
    },

    play(style) {
      const ctx = this._ctx();
      if (!ctx) return false;
      if (ctx.state === 'suspended') ctx.resume();
      if (this.playing && style === this.style) return true;
      if (this.playing) this.stop(true);
      this.style = style || 'zh';
      const bus = this._ensureBus();
      if (!bus) return false;
      this.playing = true;
      this._bar = 0;
      this._next = ctx.currentTime + 0.15;
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(this._vol, t + 1.6);   // 慢慢淡入，不要突然响
      this._tick();
      return true;
    },

    stop(immediate) {
      this.playing = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      const ctx = this._ctx();
      if (!ctx || !this._bus) return;
      const t = ctx.currentTime;
      this._bus.gain.cancelScheduledValues(t);
      this._bus.gain.setValueAtTime(this._bus.gain.value, t);
      this._bus.gain.linearRampToValueAtTime(0, t + (immediate ? 0.12 : 1.2));
    },

    setVolume(v) {
      this._vol = Math.max(0, Math.min(1, v));
      const ctx = this._ctx();
      if (!ctx || !this._bus || !this.playing) return;
      const t = ctx.currentTime;
      this._bus.gain.cancelScheduledValues(t);
      this._bus.gain.setValueAtTime(this._bus.gain.value, t);
      this._bus.gain.linearRampToValueAtTime(this._vol, t + 0.4);
    },
  };

  window.Farm = window.Farm || {};
  Farm.music = music;
})();
