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
 *   'achievement', 'error', 'tap', 'buy', 'horn'. Unknown names are
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

  const audio = {
    ctx: null,
    masterGain: null,
    ambientGain: null,
    available: false,
    _gestureSeen: false,
    _pitchShift: 1,
    _lastTapAt: 0,
    _noiseBuf: null,
    _ambient: { on: false, nodes: null, birdTimer: null, rustleTimer: null },

    _init() {
      if (this.ctx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = MASTER_VOLUME * this._volMul();
        this.masterGain.connect(this.ctx.destination);
        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = AMBIENT_VOLUME * this._volMul();
        this.ambientGain.connect(this.ctx.destination);
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

    startEngine() {
      this._init();
      if (!this.available || !this.ctx || !this.masterGain) return;
      if (!this._gestureSeen) return;
      if (this.isMuted()) return;
      if (this._engine) return;
      const ctx = this.ctx;
      const bufLen = Math.floor(ctx.sampleRate * 1.2);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < bufLen; i++) {
        last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.035;
        d[i] = last * 4.2;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 280;
      lp.Q.value = 0.7;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 72;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.22;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(lp);
      lp.connect(gain);
      osc.connect(oscGain);
      oscGain.connect(gain);
      gain.connect(this.masterGain);
      const t = ctx.currentTime;
      gain.gain.linearRampToValueAtTime(0.085, t + 0.14);
      try { src.start(); osc.start(); } catch (e) {}
      this._engine = { src: src, osc: osc, lp: lp, oscGain: oscGain, gain: gain };
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
        ['src', 'osc'].forEach((k) => { try { e[k].stop(); } catch (err) {} });
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
      g.connect(opts.dest || this.masterGain);
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
      gain.connect(this.masterGain);
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
      switch (name) {
        case 'plant':
          // 土扑 + 细沙 + 轻轻一按
          this._noise(t, 0.09, { lp: 360, gain: 0.30, attack: 0.006 });
          this._noise(t + 0.03, 0.05, { bp: 2400, q: 1.3, gain: 0.11 });
          this._tone(240, t + 0.02, 0.13, { type: 'triangle', glide: 165, gain: 0.20, lp: 1200 });
          break;
        case 'harvest':
          // 叶片窸窣 + 茎一折 + 清亮两音（连击升调加在乐音上）
          this._noise(t, 0.10, { bp: 2700, q: 0.85, gain: 0.17, attack: 0.008 });
          this._tone(300, t + 0.018, 0.055, { type: 'sine', gain: 0.20, lp: 1400 });
          this._tone(523, t + 0.05, 0.16, { type: 'triangle', gain: 0.30, lp: 4200 });
          this._tone(784, t + 0.12, 0.26, { type: 'sine', gain: 0.26 });
          this._tone(1175, t + 0.14, 0.12, { type: 'sine', gain: 0.08 });
          break;
        case 'water':
          // 细水流 + 几颗气泡 + 收尾一滴
          this._noise(t, 0.32, { bp: 1300, q: 0.55, gain: 0.20, attack: 0.025 });
          this._noise(t, 0.28, { hp: 700, lp: 2600, gain: 0.10, attack: 0.02 });
          for (let i = 0; i < 5; i++) {
            this._noise(t + 0.04 + i * 0.048, 0.028, {
              bp: 1600 + Math.random() * 1200, q: 1.6, gain: 0.07, attack: 0.002,
            });
          }
          this._tone(560, t + 0.27, 0.09, { type: 'sine', gain: 0.09, glide: 380 });
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
          this._noise(t, 0.09, { lp: 260, gain: 0.16, attack: 0.004 });
          this._tone(185, t, 0.22, { type: 'triangle', glide: 125, gain: 0.20, lp: 700 });
          break;
        case 'tap':
          this._noise(t, 0.022, { bp: 2100, q: 2.2, gain: 0.14, attack: 0.001 });
          this._tone(920, t, 0.028, { type: 'sine', gain: 0.09, attack: 0.001, lp: 2800 });
          break;
        case 'horn':
          [0, 0.24].forEach((off) => {
            this._tone(370, t + off, 0.16, { type: 'square', gain: 0.14, lp: 900 });
            this._tone(466, t + off, 0.16, { type: 'square', gain: 0.11, lp: 1100 });
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
