/**
 * audio.js — WebAudio synthesized sound effects + ambient bed.
 *
 * Zero asset files. AudioContext is created lazily on the first play() call
 * (which is always inside a user gesture handler in this game, so the autoplay
 * policy is satisfied). If the context starts suspended we resume it on the
 * first play.
 *
 * Sound settings persist via state:
 *   - audioMuted (bool)     — hard off. Backward compatible with old saves.
 *   - audioVolume (0..1)    — soft volume tier (1 = normal, 0.4 = low).
 *   - ambientOff (bool)     — disables the background farm ambience only.
 *
 * Available sounds: 'plant', 'harvest', 'coin', 'levelUp', 'achievement',
 *   'error', 'tap', 'buy', 'horn'. Unknown names are silently ignored. play(name, opts)
 *   accepts opts.step (int) to raise the whole sound by N semitones — used for
 *   the Hay Day-style do-re-mi combo pitch stepping on rapid harvests.
 *
 * Each play adds a tiny (±3.5% pitch, ±10% timing) random variation so repeated
 * high-frequency actions (harvesting a whole row) don't sound like a machine.
 *
 * Master gain is ~0.18 for SFX; the ambient bed sits on its own quiet gain
 * (~0.06) so it can be toggled independently and never masks the SFX.
 */
(function() {
  const MASTER_VOLUME = 0.18;
  const AMBIENT_VOLUME = 0.06;   // background wind+birds bed — deliberately faint

  const audio = {
    ctx: null,
    masterGain: null,
    ambientGain: null,
    available: false,
    _gestureSeen: false,
    _pitchShift: 1,
    _lastTapAt: 0,
    _ambient: { on: false, nodes: null, birdTimer: null },

    _init() {
      if (this.ctx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = MASTER_VOLUME * this._volMul();
        this.masterGain.connect(this.ctx.destination);
        // Ambient bed rides its own gain straight to the destination so it can
        // be toggled/volumed independently of the SFX bus.
        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = AMBIENT_VOLUME * this._volMul();
        this.ambientGain.connect(this.ctx.destination);
        this.available = true;
      } catch (e) {
        console.warn('AudioContext unavailable', e);
      }
    },

    // Browsers refuse to start an AudioContext without a user gesture. Install
    // a one-time listener that resumes the context on the first interaction;
    // until that happens, play() is a no-op so we don't spew console warnings
    // on boot-time achievement unlocks.
    armGestureGate() {
      if (this._gestureSeen) return;
      const arm = () => {
        this._gestureSeen = true;
        if (!this.ctx) this._init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        // Apply saved volume + kick off the ambient bed now that we're unlocked.
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

    // Soft volume multiplier (0 when muted). Missing field → 1 (normal), so old
    // saves are unaffected.
    _volMul() {
      if (this.isMuted()) return 0;
      const v = window.Farm && Farm.state && Farm.state.data && Farm.state.data.audioVolume;
      return (v == null) ? 1 : Math.max(0, Math.min(1, v));
    },

    _ambientDisabled() {
      return !!(window.Farm && Farm.state && Farm.state.data && Farm.state.data.ambientOff);
    },

    // Push the current volume tier onto the live gain nodes AND reconcile the
    // ambient bed (start it if audible+enabled+visible, stop it otherwise).
    // Safe to call any time; no-ops before the context exists.
    applyVolume() {
      const m = this._volMul();
      if (this.masterGain) this.masterGain.gain.value = MASTER_VOLUME * m;
      if (this.ambientGain) this.ambientGain.gain.value = AMBIENT_VOLUME * m;
      if (m > 0 && !this._ambientDisabled()) this.startAmbient();
      else this.stopAmbient();
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

    // ===== Volume tier (settings): 'off' | 'low' | 'normal' =====
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

    // ===== Ambient background bed (wind pad + intermittent bird chirps) =====
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
      // Wind: 2s of brown-ish noise (integrated white → softer, less hissy),
      // looped through a lowpass, with a very slow LFO on its gain for gusts.
      const bufLen = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < bufLen; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;   // leaky integrator
        d[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 480;
      lp.Q.value = 0.5;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;          // ~14s gust period
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.28;
      lfo.connect(lfoGain);
      lfoGain.connect(windGain.gain);
      src.connect(lp);
      lp.connect(windGain);
      windGain.connect(this.ambientGain);
      try { src.start(); lfo.start(); } catch (e) {}
      this._ambient.nodes = { src: src, lfo: lfo, lp: lp, windGain: windGain, lfoGain: lfoGain };
      this._ambient.on = true;
      this._scheduleBird();
    },

    stopAmbient() {
      const n = this._ambient.nodes;
      if (n) {
        try { n.src.stop(); } catch (e) {}
        try { n.lfo.stop(); } catch (e) {}
        try {
          n.src.disconnect(); n.lp.disconnect(); n.windGain.disconnect();
          n.lfo.disconnect(); n.lfoGain.disconnect();
        } catch (e) {}
      }
      this._ambient.nodes = null;
      clearTimeout(this._ambient.birdTimer);
      this._ambient.birdTimer = null;
      this._ambient.on = false;
    },

    _scheduleBird() {
      clearTimeout(this._ambient.birdTimer);
      const delay = 8000 + Math.random() * 12000;   // 8–20s between chirps
      this._ambient.birdTimer = setTimeout(() => {
        if (this._ambient.on && !(document && document.hidden) && !this.isMuted()) {
          this._chirp();
          this._scheduleBird();
        }
      }, delay);
    },

    _chirp() {
      const ctx = this.ctx;
      if (!ctx || !this.ambientGain) return;
      const notes = 2 + Math.floor(Math.random() * 3);   // 2–4 quick notes
      let t = ctx.currentTime + 0.02;
      for (let i = 0; i < notes; i++) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        const base = 2600 + Math.random() * 1400;        // 2.6–4kHz
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.3), t + 0.05);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        osc.connect(g);
        g.connect(this.ambientGain);
        osc.start(t);
        osc.stop(t + 0.12);
        t += 0.06 + Math.random() * 0.05;
      }
    },

    // Schedule one short tone with attack-decay envelope. Applies the current
    // combo pitch shift (this._pitchShift) plus a small per-tone random wobble
    // so repeats never sound identical.
    _tone(freq, startTime, dur, opts) {
      opts = opts || {};
      const shift = this._pitchShift || 1;
      const wobble = 1 + (Math.random() - 0.5) * 0.07;   // ±3.5% pitch
      const f = freq * shift * wobble;
      const d = dur * (1 + (Math.random() - 0.5) * 0.2); // ±10% timing
      const t = startTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (opts.glide) {
        osc.frequency.exponentialRampToValueAtTime(opts.glide * shift * wobble, t + d);
      }
      const peak = (opts.gain != null) ? opts.gain : 0.5;
      const attack = (opts.attack != null) ? opts.attack : 0.005;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + d + 0.02);
    },

    play(name, opts) {
      opts = opts || {};
      if (this.isMuted()) return;
      // Skip until the user has actually interacted with the page. Boot-time
      // calls (e.g. retroactive achievement unlocks) would otherwise spam the
      // "AudioContext not allowed to start" warning.
      if (!this._gestureSeen) return;
      if (!this.ctx) this._init();
      if (!this.available) return;
      // Dedupe rapid tap blips — the global .btn delegation and any explicit
      // per-button play('tap') can both fire on one press; collapse to one.
      if (name === 'tap') {
        const now = performance.now();
        if (this._lastTapAt && now - this._lastTapAt < 60) return;
        this._lastTapAt = now;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      // Combo pitch step (do-re-mi): raise the whole sound by opts.step
      // semitones, capped at +7 (a fifth) so a long chain stays musical.
      const step = Math.max(0, Math.min(7, opts.step || 0));
      this._pitchShift = step ? Math.pow(2, step / 12) : 1;
      const t = this.ctx.currentTime;
      switch (name) {
        case 'plant':
          // Soft puff: triangle wave down-glide
          this._tone(280, t, 0.18, { type: 'triangle', glide: 180, gain: 0.45 });
          this._tone(560, t + 0.02, 0.1, { type: 'sine', gain: 0.18 });
          break;
        case 'harvest':
          // Two-note ascending chime (C5 → G5)
          this._tone(523, t, 0.14, { type: 'triangle', gain: 0.5 });
          this._tone(784, t + 0.08, 0.22, { type: 'triangle', gain: 0.5 });
          break;
        case 'coin':
          // Bright ka-ching
          this._tone(1318, t, 0.06, { type: 'triangle', gain: 0.4 });
          this._tone(1568, t + 0.04, 0.12, { type: 'triangle', gain: 0.4 });
          break;
        case 'buy':
          // Mid-pitch happy two-tone
          this._tone(660, t, 0.08, { type: 'triangle', gain: 0.4 });
          this._tone(880, t + 0.06, 0.12, { type: 'triangle', gain: 0.4 });
          break;
        case 'levelUp':
          // C-E-G-C ascending arpeggio
          [523, 659, 784, 1047].forEach((f, i) => {
            this._tone(f, t + i * 0.09, 0.22, { type: 'triangle', gain: 0.5 });
          });
          break;
        case 'achievement':
          // Sparkly bell: multiple sine harmonics overlapping
          this._tone(880, t, 0.45, { type: 'sine', gain: 0.5 });
          this._tone(1320, t, 0.35, { type: 'sine', gain: 0.3 });
          this._tone(1760, t + 0.04, 0.28, { type: 'sine', gain: 0.2 });
          this._tone(1100, t + 0.18, 0.4, { type: 'sine', gain: 0.3 });
          break;
        case 'error':
          // Low sad buzz
          this._tone(220, t, 0.2, { type: 'sawtooth', gain: 0.28, glide: 140 });
          break;
        case 'tap':
          // Subtle UI click
          this._tone(700, t, 0.04, { type: 'sine', gain: 0.18 });
          break;
        case 'horn':
          // 老式汽车喇叭：两个音叠成和弦（真车喇叭就是双音簧片），短促鸣两下。
          // 比别的音效轻，它一次响两声，跟收获音同响度会盖过一切。
          [0, 0.24].forEach((off) => {
            this._tone(440, t + off, 0.15, { type: 'sawtooth', gain: 0.30 });
            this._tone(554, t + off, 0.15, { type: 'sawtooth', gain: 0.22 });
          });
          break;
      }
      this._pitchShift = 1;
    },
  };

  // Pause the ambient bed when the tab/app is backgrounded; resume (if audible
  // and enabled) when it comes back. SFX are gesture-driven so they need no
  // handling here.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) audio.stopAmbient();
      else audio.applyVolume();
    });
  }

  window.Farm = window.Farm || {};
  window.Farm.audio = audio;
})();
