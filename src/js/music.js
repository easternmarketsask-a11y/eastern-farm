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

  /* ── 风格表 ────────────────────────────────────────────────────
     加一款风格＝加一条数据。字段含义：
       scale/bass  拨弦音阶 / 低音根音（中式的「调式」靠根音体现：
                   C 宫＝平稳温暖，G 徵＝明亮，A 羽＝清冷）
       bassSeq     低音按顺序走（有和弦进行感）还是随机取
       padStack    垫音的叠置比例（1=根音，1.5=五度，2.25=九度…）
       gap/pluck   多疏 / 每簇几个音 —— 这两项决定「热闹」还是「安静」
       bell*       只有喜庆的风格才挂铃
     ⚠️ 音量字段一律保守：背景音乐盖过音效就是失败，宁可轻。 */
  const STYLES = {
    zh: {
      name: '中式田园', hint: '日常。五声宫调，拨弦点描 + 暖垫',
      scale: PENTA, bass: [130.81, 196.00], padStack: [1, 1.5], padEvery: 4,
      padDur: [9, 12], padGain: 0.10, center: 4, spread: 0.35,
      gap: [2.6, 4.2], pluck: [2, 4], pluckGain: [0.10, 0.17], step: [0.26, 0.46],
      restChance: 0.25, fluteChance: 0.14, fluteDur: [2.4, 3.6], fluteGain: 0.075,
    },
    cny: {
      name: '春节', hint: '喜庆。徵调更明亮，密一些，挂磬铃',
      scale: PENTA, bass: [196.00, 146.83], padStack: [1, 1.5, 2], padEvery: 3,
      padDur: [7, 10], padGain: 0.10, center: 5, spread: 0.4,
      gap: [1.9, 3.0], pluck: [3, 5], pluckGain: [0.12, 0.19], step: [0.20, 0.34],
      restChance: 0.10, fluteChance: 0.22, fluteDur: [1.8, 2.8], fluteGain: 0.08,
      bellChance: 0.34, bellFreq: 1046.50, bellGain: 0.07,
    },
    midautumn: {
      name: '中秋', hint: '月夜。羽调清冷，慢，笛为主',
      scale: PENTA, bass: [220.00, 164.81], padStack: [1, 1.5, 2.25], padEvery: 5,
      padDur: [12, 16], padGain: 0.11, center: 5, spread: 0.3,
      gap: [4.5, 7.0], pluck: [1, 2], pluckGain: [0.07, 0.12], step: [0.5, 0.9],
      restChance: 0.35, fluteChance: 0.45, fluteDur: [3.2, 4.8], fluteGain: 0.085,
      bellChance: 0.10, bellFreq: 1318.51, bellGain: 0.04,
    },
    harvest: {
      name: '丰收季', hint: '活动。明快密集，适合搞促销那几天',
      scale: PENTA, bass: [130.81, 196.00, 220.00], padStack: [1, 1.5], padEvery: 3,
      padDur: [6, 9], padGain: 0.09, center: 4, spread: 0.45,
      gap: [1.7, 2.6], pluck: [3, 6], pluckGain: [0.11, 0.18], step: [0.17, 0.28],
      restChance: 0.06, fluteChance: 0.20, fluteDur: [1.6, 2.4], fluteGain: 0.07,
    },
    rain: {
      name: '雨天', hint: '安静。低沉稀疏，冬天或阴雨天',
      scale: PENTA, bass: [130.81, 164.81], padStack: [1, 1.5, 2], padEvery: 4,
      padDur: [13, 18], padGain: 0.115, center: 3, spread: 0.25,
      gap: [5.5, 8.5], pluck: [1, 2], pluckGain: [0.06, 0.10], step: [0.6, 1.0],
      restChance: 0.45, fluteChance: 0.10, fluteDur: [3.0, 4.2], fluteGain: 0.06,
    },
    west: {
      name: '西式民谣', hint: 'C–G–Am–F 和弦进行，有曲子感',
      scale: MAJOR, bass: [130.81, 196.00, 220.00, 174.61], bassSeq: true,
      padStack: [1, 1.26, 1.5], padEvery: 1,
      padDur: [4.2, 5.2], padGain: 0.085, center: 3, spread: 0.3,
      gap: [3.6, 4.4], pluck: [3, 5], pluckGain: [0.09, 0.14], step: [0.30, 0.38],
      restChance: 0.05, fluteChance: 0.22, fluteDur: [1.8, 2.6], fluteGain: 0.07,
    },
    min: {
      name: '极简氛围', hint: '几乎无旋律，最耐听最不打扰',
      scale: PENTA, bass: [130.81, 174.61], bassSeq: true,
      padStack: [1, 1.5, 2.25, 2.5], padEvery: 1,
      padDur: [11, 15], padGain: 0.11, center: 6, spread: 0.4,
      gap: [8, 12], pluck: [0, 1], pluckGain: [0.05, 0.09], step: [0.8, 1.2],
      restChance: 0.55, fluteChance: 0.06, fluteDur: [3.0, 4.0], fluteGain: 0.05,
    },
  };

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

    /* ── 风格＝一组参数，不是一段代码 ──────────────────────────────
       Chris 2026-08-21：日常用中式田园，节日/活动另设。所以加一款风格
       必须只是加一条数据 —— 写死成分支的话，每逢节日都要改代码。 */
    _gen(t, S) {
      const bar = this._bar;
      // 低音垫：换根音的频率由 padEvery 控制
      if (bar % S.padEvery === 0) {
        const root = S.bassSeq
          ? S.bass[(bar / S.padEvery | 0) % S.bass.length]   // 按顺序走＝和弦进行
          : S.bass[(Math.random() * S.bass.length) | 0];
        const stack = S.padStack.map((m) => root * m);
        this._pad(t, stack, rnd(S.padDur[0], S.padDur[1]), S.padGain);
      }
      // 拨弦簇：随机游走，不跳大距离（跳来跳去像随机音符，不像旋律）
      const n = (Math.random() < S.restChance) ? 0
        : S.pluck[0] + ((Math.random() * (S.pluck[1] - S.pluck[0] + 1)) | 0);
      let idx = S.center + ((Math.random() * 5) | 0) - 2;
      for (let i = 0; i < n; i++) {
        idx = Math.max(0, Math.min(S.scale.length - 1, idx + ((Math.random() * 5) | 0) - 2));
        this._pluck(t + i * rnd(S.step[0], S.step[1]), S.scale[idx],
          rnd(S.pluckGain[0], S.pluckGain[1]), rnd(-S.spread, S.spread));
      }
      // 长音（笛）：点睛，不能常有
      if (Math.random() < S.fluteChance) {
        const hi = S.scale.slice(Math.max(0, S.scale.length - 5));
        this._flute(t + rnd(0.2, 0.8), pick(hi), rnd(S.fluteDur[0], S.fluteDur[1]),
          S.fluteGain, rnd(-0.25, 0.25));
      }
      // 铃：只有喜庆的风格才挂，用非谐分音（当当那种，不是叮）
      if (S.bellChance && Math.random() < S.bellChance) {
        this._bell(t + rnd(0, 0.4), S.bellFreq, S.bellGain, rnd(-0.2, 0.2));
      }
      return rnd(S.gap[0], S.gap[1]);
    },

    /* 铃/磬：非谐分音才像金属，叠正弦只会像电子琴 */
    _bell(t, f0, gain, pan) {
      const ctx = this._ctx(), bus = this._ensureBus();
      if (!ctx || !bus) return;
      const dest = this._pan(ctx, bus, pan);
      [[1, 1, 2.2], [2.01, 0.42, 1.6], [2.76, 0.26, 1.2], [5.4, 0.10, 0.7]].forEach(([m, a, d]) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = f0 * m;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain * a, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + d + 0.05);
      });
    },

    // ── 调度 ─────────────────────────────────────────────────────
    _tick() {
      const ctx = this._ctx();
      if (!ctx || !this.playing) return;
      const S = STYLES[this.style] || STYLES.zh;
      while (this._next < ctx.currentTime + SCHEDULE_AHEAD) {
        if (this._next < ctx.currentTime) this._next = ctx.currentTime + 0.05;
        this._next += this._gen(this._next, S);
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
      this.style = (style && STYLES[style]) ? style : 'zh';
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

  music.STYLES = STYLES;
  music.list = function () {
    return Object.keys(STYLES).map((k) => ({ id: k, name: STYLES[k].name, hint: STYLES[k].hint }));
  };

  window.Farm = window.Farm || {};
  Farm.music = music;
})();
