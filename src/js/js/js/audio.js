/**
 * audio.js — WebAudio synthesized sound effects + ambient bed.
 *
 * Zero asset files. AudioContext is created lazily on the first play() call
 * (always inside a user gesture). If the context starts suspended we resume
 * it on the first play.
 *
 * Sound settings persist via state:
 *   - audioMuted (bool)     — hard off. Backward compatible with old saves.
 *   - audioVolume (0..1)    — soft volume tier (1 = normal, 0.4 = low).
 *   - ambientOff (bool)     — disables the background farm ambience only.
 *
 * Available sounds: 'plant', 'harvest', 'water', 'coin', 'levelUp',
 *   'achievement', 'error', 'tap', 'buy', 'horn', 'build', 'buildStart',
 *   'buildSaw', 'buildDone'. Unknown names are
 *   silently ignored. play(name, opts) accepts opts.step (int) to raise
 *   the whole sound by N semitones — Hay Day-style combo on rapid harvests.
 *
 * Each play adds a tiny (±3.5% pitch, ±10% timing) random variation so
 * harvesting a whole row doesn't sound like a machine.
 *
 * Master gain is ~0.18 for SFX; the ambient bed sits on its own quiet gain
 * (~0.055) so it can be toggled independently and never masks the SFX.
 *
 * 2026-08-20：每种音效都是噪声质感 + 乐音收尾叠出来的，不再是单振荡器蜂鸣。
 */
(function() {
  const MASTER_VOLUME = 0.18;
  const AMBIENT_VOLUME = 0.055;
  /* 混响送出量。少即是多 —— 送多了整锅糊成卡拉 OK，
     送这么一点点只是让声音「落在院子里」而不是贴在耳朵上。 */
  const REVERB_SEND = 0.16;

  const audio = {
    ctx: null,
    masterGain: null,
    ambientGain: null,
    available: false,
    _gestureSeen: false,
    _pitchShift: 1,
    _lastTapAt: 0,
    _noiseBuf: null,
    dryGain: null,      // 不进混响的那条路：UI 音带混响会显得迟钝、廉价
    _glue: null,
    _ambient: { on: false, nodes: null, birdTimer: null, rustleTimer: null },

    _init() {
      if (this.ctx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();

        /* ── 混音总线 ─────────────────────────────────────────────
           合成音听起来「廉价」，多半不是波形不对，而是缺这一层：
           没有空间（干得贴耳）、没有峰值控制（叠几个就削波炸掉）、
           高频全是毛刺、而且所有声音都挤在正中间。
           三级：削毛刺 → 一点点院子混响 → 胶合压缩 → 输出。 */
        const glue = this.ctx.createDynamicsCompressor();
        glue.threshold.value = -18;   // 只抓峰值，不压音乐性
        glue.knee.value = 24;         // 软膝：过渡听不出「被压住了」
        glue.ratio.value = 3;
        glue.attack.value = 0.006;    // 留住瞬态的「点」，又抓得住峰
        glue.release.value = 0.18;
        glue.connect(this.ctx.destination);
        this._glue = glue;

        // 温和削高频：合成波形和噪声层的 8k 以上是刺耳的来源，不是「明亮」
        const shape = this.ctx.createBiquadFilter();
        shape.type = 'highshelf';
        shape.frequency.value = 8000;
        shape.gain.value = -3.5;
        shape.connect(glue);

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = MASTER_VOLUME * this._volMul();
        this.masterGain.connect(shape);

        // 干声专用总线（UI 音走这条，不进混响）
        this.dryGain = this.ctx.createGain();
        this.dryGain.gain.value = MASTER_VOLUME * this._volMul();
        this.dryGain.connect(shape);

        // 程序化 IR：短、暗、带预延迟的院子空间。零资源文件。
        try {
          const rev = this.ctx.createConvolver();
          rev.buffer = this._makeIR(0.55, 2.6, 0.35);
          const send = this.ctx.createGain();
          send.gain.value = REVERB_SEND;
          const revTone = this.ctx.createBiquadFilter();
          revTone.type = 'lowpass';       // 尾巴要比直达声暗，否则像浴室
          revTone.frequency.value = 6500;
          revTone.Q.value = 0.5;
          this.masterGain.connect(send);
          send.connect(rev);
          rev.connect(revTone);
          revTone.connect(glue);
          this._reverb = rev;
          this._revSend = send;   // 试听页 audio-lab.html 用它实时开关空间感
        } catch (e) {
          // ConvolverNode 不可用就只走干声，不影响出声
        }

        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = AMBIENT_VOLUME * this._volMul();
        this.ambientGain.connect(glue);
        this.available = true;
      } catch (e) {
        console.warn('AudioContext unavailable', e);
      }
    },

    armGestureGate() {
      if (this._gestureSeen) return;
      const arm = () => {
        this._gestureSeen = true;
        if (!this.ctx) this._init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        this.applyVolume();
        document.removeEventListener('pointerdown', arm, true);
        document.removeEventListener('keydown', arm, true);
        document.removeEventListener('touchstart', arm, true);
      };
      document.addEventListener('pointerdown', arm, true);
      document.addEventListener('keydown', arm, true);
      document.addEventListener('touchstart', arm, true);
    },

    isMuted() {
      return !!(window.Farm && Farm.state && Farm.state.data && Farm.state.data.audioMuted);
    },

    _volMul() {
      if (this.isMuted()) return 0;
      const v = window.Farm && Farm.state && Farm.state.data && Farm.state.data.audioVolume;
      return (v == null) ? 1 : Math.max(0, Math.min(1, v));
    },

    _ambientDisabled() {
      return !!(window.Farm && Farm.state && Farm.state.data && Farm.state.data.ambientOff);
    },

    applyVolume() {
      const m = this._volMul();
      if (this.masterGain) this.masterGain.gain.value = MASTER_VOLUME * m;
      if (this.dryGain) this.dryGain.gain.value = MASTER_VOLUME * m;
      if (this.ambientGain) this.ambientGain.gain.value = AMBIENT_VOLUME * m;
      if (m > 0 && !this._ambientDisabled()) this.startAmbient();
      else this.stopAmbient();
      if (m <= 0) this.stopEngine();
    },

    setMuted(m) {
      if (Farm.state && Farm.state.data) {
        Farm.state.data.audioMuted = !!m;
        Farm.state.save();
      }
      this.applyVolume();
    },

    toggleMute() {
      this.setMuted(!this.isMuted());
      return this.isMuted();
    },

    setVolumeTier(tier) {
      if (!(Farm.state && Farm.state.data)) return;
      if (tier === 'off') {
        Farm.state.data.audioMuted = true;
      } else {
        Farm.state.data.audioMuted = false;
        Farm.state.data.audioVolume = (tier === 'low') ? 0.4 : 1;
      }
      Farm.state.save();
      this.applyVolume();
    },
    currentTier() {
      if (this.isMuted()) return 'off';
      const v = Farm.state && Farm.state.data && Farm.state.data.audioVolume;
      return (v != null && v < 0.7) ? 'low' : 'normal';
    },

    setAmbientEnabled(on) {
      if (Farm.state && Farm.state.data) {
        Farm.state.data.ambientOff = !on;
        Farm.state.save();
      }
      this.applyVolume();
    },
    ambientEnabled() {
      return !this._ambientDisabled();
    },

    startAmbient() {
      if (!this.available || !this.ctx) return;
      if (!this._gestureSeen) return;
      if (this.isMuted() || this._ambientDisabled()) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this._ambient.on) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const ctx = this.ctx;
      const bufLen = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < bufLen; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.Q.value = 0.45;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.42;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.22;
      lfo.connect(lfoGain);
      lfoGain.connect(windGain.gain);
      src.connect(lp);
      lp.connect(windGain);
      windGain.connect(this.ambientGain);

      // Quiet air layer — a little treble so the pad isn't just a rumble.
      const airSrc = ctx.createBufferSource();
      airSrc.buffer = buf;
      airSrc.loop = true;
      const airHp = ctx.createBiquadFilter();
      airHp.type = 'highpass';
      airHp.frequency.value = 700;
      const airLp = ctx.createBiquadFilter();
      airLp.type = 'lowpass';
      airLp.frequency.value = 2200;
      const airGain = ctx.createGain();
      airGain.gain.value = 0.12;
      airSrc.connect(airHp);
      airHp.connect(airLp);
      airLp.connect(airGain);
      airGain.connect(this.ambientGain);

      try { src.start(); airSrc.start(); lfo.start(); } catch (e) {}
      this._ambient.nodes = {
        src: src, lfo: lfo, lp: lp, windGain: windGain, lfoGain: lfoGain,
        airSrc: airSrc, airHp: airHp, airLp: airLp, airGain: airGain,
      };
      this._ambient.on = true;
      this._scheduleBird();
      this._scheduleRustle();
    },

    /* 一个工作循环的点火脉冲 buffer。
       内燃机的声音本质是**一串规律的爆发**，不是连续波形 —— 之前那版
       三角波 + 滤波噪声只是「嗡嗡声」，听着像冰箱不像车。
       四缸四冲程每两圈点火 4 次，所以一个循环里放 4 个脉冲；
       每个脉冲 = 爆音（噪声瞬态）+ 管腔阻尼共鸣。
       缸间幅度/时刻各差几个百分点 —— 完全均匀会立刻听出是电子合成的。 */
    _makeEngineCycle(cylinders) {
      const ctx = this.ctx, sr = ctx.sampleRate;
      const n = cylinders || 4;
      const cycle = 0.10;                       // 一个工作循环的基准时长
      const len = Math.floor(sr * cycle);
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const resFreq = 88;                       // 排气管腔共鸣
      for (let k = 0; k < n; k++) {
        const jitter = 1 + (Math.random() - 0.5) * 0.06;      // 点火时刻不齐
        const amp = 0.82 + Math.random() * 0.30;              // 缸间强弱不一
        const at = Math.floor(len * ((k + 0.02 * (Math.random() - 0.5)) / n) * jitter) % len;
        const burst = Math.floor(sr * 0.006);                 // 爆音 6ms
        for (let i = 0; i < burst; i++) {
          const e = Math.pow(1 - i / burst, 2.2);
          d[(at + i) % len] += (Math.random() * 2 - 1) * e * 0.55 * amp;
        }
        const ring = Math.floor(sr * 0.055);                  // 管腔余振
        for (let i = 0; i < ring; i++) {
          const e = Math.exp(-i / (sr * 0.012));
          d[(at + i) % len] += Math.sin(2 * Math.PI * resFreq * i / sr) * e * 0.42 * amp;
        }
      }
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
      if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;   // 归一，音量只由 gain 管
      return buf;
    },

    /* load 0..1 = 这辆车跑多快（皮卡 0 → 豪华车 1）。
       转速直接是 playbackRate —— 脉冲密度跟着变，这才是真车加速的听感。 */
    startEngine(load) {
      this._init();
      if (!this.available || !this.ctx || !this.masterGain) return;
      if (!this._gestureSeen) return;
      if (this.isMuted()) return;
      // play() 里有这一句，startEngine 之前漏了 —— 如果玩家第一个动作就是开车，
      // AudioContext 还是 suspended，发动机静默地什么都不响。
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this._engine) { this.setEngineLoad(load); return; }
      const ld = Math.max(0, Math.min(1, load == null ? 0.4 : load));
      const ctx = this.ctx;

      const src = ctx.createBufferSource();
      src.buffer = this._makeEngineCycle(4);
      src.loop = true;
      const rate = 0.88 + 0.62 * ld;            // 怠速 → 高转
      src.playbackRate.value = rate;

      // 排气低频：120Hz 抬起来才有「厚度」，没有它像小摩托
      const body = ctx.createBiquadFilter();
      body.type = 'peaking'; body.frequency.value = 120; body.Q.value = 1.1; body.gain.value = 7;
      // 车外听到的声音本来就没什么高频，削掉机械毛刺
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1250; lp.Q.value = 0.7;
      // 极轻的机械层：只有脉冲会显得太干净
      const hiss = ctx.createBufferSource();
      hiss.buffer = this._ensureNoise(); hiss.loop = true;
      const hissBp = ctx.createBiquadFilter();
      hissBp.type = 'bandpass'; hissBp.frequency.value = 1800; hissBp.Q.value = 0.8;
      const hissGain = ctx.createGain(); hissGain.gain.value = 0.055;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(body); body.connect(lp); lp.connect(gain);
      hiss.connect(hissBp); hissBp.connect(hissGain); hissGain.connect(gain);
      gain.connect(this.masterGain);
      const t = ctx.currentTime;
      /* 🔒 0.62 不是拍脑袋：点火脉冲的波峰因数约 11.7dB（峰值 1 / RMS 0.26），
         而耳朵听的是 RMS。按 0.17 算出来的有效 RMS 只有 0.0079，比喇叭轻 12 倍，
         实测就是「听不到」。0.62 让它落在喇叭响度的三成左右 —— 持续音该有的位置。
         别按「峰值看起来够大」来调这个数。 */
      gain.gain.linearRampToValueAtTime(0.62, t + 0.14);
      try { src.start(); hiss.start(); } catch (e) {}
      this._engine = { src: src, hiss: hiss, body: body, lp: lp, hissBp: hissBp,
                       hissGain: hissGain, gain: gain, load: ld, rate: rate };
    },

    // 换车/加速时平滑改转速，别硬跳（硬跳听起来像换了一辆车）
    setEngineLoad(load) {
      const e = this._engine;
      if (!e || !this.ctx) return;
      const ld = Math.max(0, Math.min(1, load == null ? 0.4 : load));
      if (Math.abs(ld - (e.load || 0)) < 0.02) return;
      e.load = ld;
      const rate = 0.88 + 0.62 * ld, t = this.ctx.currentTime;
      e.rate = rate;
      try { e.src.playbackRate.linearRampToValueAtTime(rate, t + 0.25); } catch (err) {}
    },

    stopEngine() {
      const e = this._engine;
      if (!e || !this.ctx) { this._engine = null; return; }
      this._engine = null;
      const t = this.ctx.currentTime;
      try {
        e.gain.gain.cancelScheduledValues(t);
        e.gain.gain.setValueAtTime(e.gain.gain.value, t);
        e.gain.gain.linearRampToValueAtTime(0, t + 0.16);
      } catch (err) {}
      setTimeout(() => {
        ['src', 'hiss'].forEach((k) => { try { e[k] && e[k].stop(); } catch (err) {} });
        Object.keys(e).forEach((k) => { try { e[k].disconnect(); } catch (err) {} });
      }, 200);
    },

    stopAmbient() {
      const n = this._ambient.nodes;
      if (n) {
        ['src', 'lfo', 'airSrc'].forEach((k) => { try { n[k].stop(); } catch (e) {} });
        Object.keys(n).forEach((k) => { try { n[k].disconnect(); } catch (e) {} });
      }
      this._ambient.nodes = null;
      clearTimeout(this._ambient.birdTimer);
      clearTimeout(this._ambient.rustleTimer);
      this._ambient.birdTimer = null;
      this._ambient.rustleTimer = null;
      this._ambient.on = false;
    },

    _scheduleBird() {
      clearTimeout(this._ambient.birdTimer);
      const delay = 9000 + Math.random() * 14000;
      this._ambient.birdTimer = setTimeout(() => {
        if (this._ambient.on && !(document && document.hidden) && !this.isMuted()) {
          this._chirp();
          this._scheduleBird();
        }
      }, delay);
    },

    _scheduleRustle() {
      clearTimeout(this._ambient.rustleTimer);
      const delay = 14000 + Math.random() * 18000;
      this._ambient.rustleTimer = setTimeout(() => {
        if (this._ambient.on && !(document && document.hidden) && !this.isMuted()) {
          this._leafRustle();
          this._scheduleRustle();
        }
      }, delay);
    },

    _chirp() {
      const ctx = this.ctx;
      if (!ctx || !this.ambientGain) return;
      const notes = 2 + Math.floor(Math.random() * 3);
      let t = ctx.currentTime + 0.02;
      const species = 1700 + Math.random() * 1100;
      for (let i = 0; i < notes; i++) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        const base = species * (1 + (Math.random() - 0.5) * 0.08);
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.exponentialRampToValueAtTime(base * (1.08 + Math.random() * 0.18), t + 0.045);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.28, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        osc.connect(g);
        g.connect(this.ambientGain);
        osc.start(t);
        osc.stop(t + 0.09);
        t += 0.055 + Math.random() * 0.04;
      }
    },

    _leafRustle() {
      if (!this.ctx || !this.ambientGain) return;
      const t = this.ctx.currentTime;
      this._noise(t, 0.22, {
        bp: 1800, q: 0.8, gain: 0.22, attack: 0.03, dest: this.ambientGain,
      });
    },

    _ensureNoise() {
      if (this._noiseBuf) return this._noiseBuf;
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
      return buf;
    },

    /* 程序化脉冲响应：指数衰减的噪声 + 一阶低通把尾巴调暗 + 8ms 预延迟。
       两个声道各自随机 → 天然的立体声宽度。0.55s / 偏暗 = 户外院子，
       不是教堂也不是浴室。 */
    _makeIR(seconds, decay, bright) {
      const sr = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sr * seconds));
      const buf = this.ctx.createBuffer(2, len, sr);
      const pre = Math.floor(sr * 0.008);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const x = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
          lp += (x - lp) * bright;
          d[i] = i < pre ? 0 : lp;
        }
      }
      return buf;
    },

    // 轻微声像。全部居中是「电子玩具」感的一大来源；偏一点点就自然了。
    _panned(node, pan) {
      if (pan == null || !this.ctx.createStereoPanner) return node;
      try {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        node.connect(p);
        return p;
      } catch (e) { return node; }
    },

    _noise(t, dur, opts) {
      opts = opts || {};
      const src = this.ctx.createBufferSource();
      src.buffer = this._ensureNoise();
      src.loop = true;
      const g = this.ctx.createGain();
      const peak = (opts.gain != null) ? opts.gain : 0.2;
      const attack = (opts.attack != null) ? opts.attack : 0.004;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = src;
      if (opts.hp) {
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = opts.hp;
        hp.Q.value = 0.7;
        node.connect(hp);
        node = hp;
      }
      if (opts.lp) {
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = opts.lp;
        lp.Q.value = opts.q || 0.7;
        node.connect(lp);
        node = lp;
      }
      if (opts.bp) {
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = opts.bp;
        bp.Q.value = opts.q || 1.1;
        node.connect(bp);
        node = bp;
      }
      node.connect(g);
      this._panned(g, opts.pan).connect(opts.dest || this.masterGain);
      src.start(t);
      src.stop(t + dur + 0.03);
    },

    _tone(freq, startTime, dur, opts) {
      opts = opts || {};
      const shift = this._pitchShift || 1;
      const wobble = 1 + (Math.random() - 0.5) * 0.07;
      const f = freq * shift * wobble;
      const d = dur * (1 + (Math.random() - 0.5) * 0.2);
      const t = startTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (opts.glide) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glide * shift * wobble), t + d);
      }
      const peak = (opts.gain != null) ? opts.gain : 0.5;
      const attack = (opts.attack != null) ? opts.attack : 0.005;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
      let node = osc;
      if (opts.lp) {
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = opts.lp;
        lp.Q.value = 0.8;
        node.connect(lp);
        node = lp;
      }
      node.connect(gain);
      this._panned(gain, opts.pan).connect(opts.dest || this.masterGain);
      osc.start(t);
      osc.stop(t + d + 0.02);
    },

    play(name, opts) {
      opts = opts || {};
      if (this.isMuted()) return;
      if (!this._gestureSeen) return;
      if (!this.ctx) this._init();
      if (!this.available) return;
      if (name === 'tap') {
        const now = performance.now();
        if (this._lastTapAt && now - this._lastTapAt < 60) return;
        this._lastTapAt = now;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const step = Math.max(0, Math.min(7, opts.step || 0));
      this._pitchShift = step ? Math.pow(2, step / 12) : 1;
      const t = this.ctx.currentTime;
      /* 一个声音事件的所有层必须共用同一个声像值 —— 分开随机会让一次收获
         听起来像从两个方向同时传来，整个声音会散架。只有水花气泡是例外，
         它本来就是四散的水滴。 */
      const pan = (Math.random() - 0.5) * 0.5;
      const dry = this.dryGain || this.masterGain;
      switch (name) {
        case 'plant':
          // 土扑 + 细沙 + 轻轻一按
          this._noise(t, 0.09, { lp: 360, gain: 0.30, attack: 0.006, pan: pan });
          this._noise(t + 0.03, 0.05, { bp: 2400, q: 1.3, gain: 0.11, pan: pan });
          this._tone(240, t + 0.02, 0.13, { type: 'triangle', glide: 165, gain: 0.20, lp: 1200, pan: pan });
          break;
        case 'harvest':
          // 叶片窸窣 + 茎一折 + 清亮两音（连击升调加在乐音上）
          this._noise(t, 0.10, { bp: 2700, q: 0.85, gain: 0.17, attack: 0.008, pan: pan });
          this._tone(300, t + 0.018, 0.055, { type: 'sine', gain: 0.20, lp: 1400, pan: pan });
          this._tone(523, t + 0.05, 0.16, { type: 'triangle', gain: 0.30, lp: 4200, pan: pan });
          this._tone(784, t + 0.12, 0.26, { type: 'sine', gain: 0.26, pan: pan });
          this._tone(1175, t + 0.14, 0.12, { type: 'sine', gain: 0.08, pan: pan });
          break;
        case 'water':
          // 细水流 + 几颗气泡 + 收尾一滴
          this._noise(t, 0.32, { bp: 1300, q: 0.55, gain: 0.20, attack: 0.025, pan: pan });
          this._noise(t, 0.28, { hp: 700, lp: 2600, gain: 0.10, attack: 0.02, pan: pan });
          for (let i = 0; i < 5; i++) {
            this._noise(t + 0.04 + i * 0.048, 0.028, {
              bp: 1600 + Math.random() * 1200, q: 1.6, gain: 0.07, attack: 0.002,
              pan: pan + (Math.random() - 0.5) * 0.5,   // 水滴四散，唯一的例外
            });
          }
          this._tone(560, t + 0.27, 0.09, { type: 'sine', gain: 0.09, glide: 380, pan: pan });
          break;
        case 'coin':
          this._tone(987, t, 0.07, { type: 'triangle', gain: 0.24, lp: 5000 });
          this._tone(1318, t + 0.045, 0.16, { type: 'sine', gain: 0.30 });
          this._tone(1975, t + 0.05, 0.09, { type: 'sine', gain: 0.09 });
          break;
        case 'buy':
          this._tone(392, t, 0.09, { type: 'triangle', glide: 320, gain: 0.20, lp: 1800 });
          this._tone(659, t + 0.05, 0.14, { type: 'sine', gain: 0.26 });
          this._tone(830, t + 0.09, 0.18, { type: 'triangle', gain: 0.14 });
          break;
        case 'levelUp':
          this._tone(261, t, 0.72, { type: 'sine', gain: 0.10, lp: 800 });
          [523, 659, 784, 1046].forEach((f, i) => {
            const dur = i === 3 ? 0.42 : 0.20;
            this._tone(f, t + i * 0.10, dur, { type: 'triangle', gain: 0.32, lp: 5000 });
            this._tone(f * 2, t + i * 0.10, dur * 0.7, { type: 'sine', gain: 0.10 });
          });
          this._noise(t + 0.32, 0.14, { hp: 4500, lp: 9000, gain: 0.06 });
          break;
        case 'achievement': {
          // 钟：非谐分音，比叠正弦更像铃
          const f0 = 784;
          this._tone(f0, t, 0.55, { type: 'sine', gain: 0.36 });
          this._tone(f0 * 2.01, t, 0.42, { type: 'sine', gain: 0.16 });
          this._tone(f0 * 2.76, t + 0.03, 0.38, { type: 'sine', gain: 0.12 });
          this._tone(f0 * 5.4, t + 0.05, 0.22, { type: 'sine', gain: 0.07 });
          this._tone(f0 * 1.5, t + 0.16, 0.40, { type: 'sine', gain: 0.14 });
          this._noise(t, 0.12, { hp: 5000, gain: 0.05, attack: 0.004 });
          break;
        }
        case 'error':
          this._noise(t, 0.09, { lp: 260, gain: 0.16, attack: 0.004, dest: dry });
          this._tone(185, t, 0.22, { type: 'triangle', glide: 125, gain: 0.20, lp: 700, dest: dry });
          break;
        case 'tap':
          // UI 音走干声：点击带混响会显得迟钝、廉价，而且它一天要响几百次
          this._noise(t, 0.022, { bp: 2100, q: 2.2, gain: 0.14, attack: 0.001, dest: dry });
          this._tone(920, t, 0.028, { type: 'sine', gain: 0.09, attack: 0.001, lp: 2800, dest: dry });
          break;
        case 'buildStart':
          // 木料落地 + 两下钉桩，开工那一下要听得见
          this._noise(t, 0.16, { lp: 340, gain: 0.42, attack: 0.004, pan: pan });
          this._noise(t + 0.04, 0.09, { bp: 1100, q: 0.8, gain: 0.18, pan: pan });
          this._tone(170, t + 0.02, 0.14, { type: 'triangle', glide: 105, gain: 0.24, lp: 750, pan: pan });
          this._noise(t + 0.20, 0.08, { lp: 480, gain: 0.36, attack: 0.002, pan: pan });
          this._tone(230, t + 0.21, 0.11, { type: 'triangle', gain: 0.20, lp: 900, pan: pan });
          this._noise(t + 0.36, 0.06, { bp: 2100, q: 1.3, gain: 0.14, pan: pan });
          this._tone(310, t + 0.37, 0.09, { type: 'sine', gain: 0.12, lp: 1400, pan: pan });
          break;
        case 'build':
          // 槌木：撞击噪声 + 木头腔 + 钉尖，工地循环敲
          this._noise(t, 0.08, { lp: 480, gain: 0.42, attack: 0.001, pan: pan });
          this._noise(t + 0.008, 0.055, { bp: 2100, q: 1.35, gain: 0.20, pan: pan });
          this._tone(155, t, 0.09, { type: 'triangle', gain: 0.24, lp: 700, pan: pan });
          this._tone(390, t + 0.016, 0.07, { type: 'sine', gain: 0.12, lp: 1700, pan: pan });
          break;
        case 'buildSaw':
          // 锯木：带通噪声刮一下，夹在槌声之间
          this._noise(t, 0.22, { bp: 1700, q: 0.55, gain: 0.24, attack: 0.02, pan: pan });
          this._noise(t + 0.04, 0.16, { hp: 2400, lp: 5200, gain: 0.10, attack: 0.01, pan: pan });
          this._tone(280, t + 0.05, 0.12, { type: 'triangle', glide: 210, gain: 0.10, lp: 1200, pan: pan });
          break;
        case 'buildDone':
          // 木架收起 + 清亮收尾
          this._noise(t, 0.12, { lp: 500, gain: 0.28, attack: 0.006, pan: pan });
          this._noise(t + 0.04, 0.08, { bp: 2400, q: 0.9, gain: 0.12, pan: pan });
          this._tone(392, t + 0.05, 0.16, { type: 'triangle', gain: 0.24, lp: 1800, pan: pan });
          this._tone(523, t + 0.12, 0.22, { type: 'sine', gain: 0.28, pan: pan });
          this._tone(784, t + 0.18, 0.28, { type: 'triangle', gain: 0.20, pan: pan });
          break;
        case 'horn':
          /* 老式双簧片喇叭：两个音差小三度，谐波一直到 3–4k，起振几乎瞬间。
             之前 lowpass 900 把谐波全削光了 —— 喇叭的穿透力恰恰在 1–2k，
             削掉就剩一个闷闷的玩具喇叭。响度也翻了一倍：车喇叭本来就该盖过一切。 */
          [0, 0.26].forEach((off) => {
            const st = t + off;
            this._tone(370, st, 0.20, { type: 'sawtooth', gain: 0.26, lp: 3600, attack: 0.002, pan: pan });
            this._tone(466, st, 0.20, { type: 'sawtooth', gain: 0.20, lp: 3600, attack: 0.002, pan: pan });
            this._tone(740, st, 0.17, { type: 'square', gain: 0.07, lp: 3000, attack: 0.002, pan: pan });
            this._noise(st, 0.05, { bp: 1500, q: 1.2, gain: 0.05, attack: 0.001, pan: pan });
          });
          break;
      }
      this._pitchShift = 1;
    },
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { audio.stopAmbient(); audio.stopEngine(); }
      else audio.applyVolume();
    });
  }

  window.Farm = window.Farm || {};
  window.Farm.audio = audio;
})();
