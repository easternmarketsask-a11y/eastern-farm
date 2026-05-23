/**
 * audio.js — WebAudio synthesized sound effects.
 *
 * Zero asset files. AudioContext is created lazily on the first play() call
 * (which is always inside a user gesture handler in this game, so the autoplay
 * policy is satisfied). If the context starts suspended we resume it on the
 * first play.
 *
 * Mute preference persists via state.audioMuted. Settings panel toggles it.
 *
 * Available sounds: 'plant', 'harvest', 'coin', 'levelUp', 'achievement',
 *   'error', 'tap', 'buy'. Unknown names are silently ignored.
 *
 * Master gain is ~0.18 — quiet enough that a kid playing on a phone in the
 * back seat won't startle the driver. Increase MASTER_VOLUME if it's too soft.
 */
(function() {
  const MASTER_VOLUME = 0.18;

  const audio = {
    ctx: null,
    masterGain: null,
    available: false,
    _gestureSeen: false,

    _init() {
      if (this.ctx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = MASTER_VOLUME;
        this.masterGain.connect(this.ctx.destination);
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

    setMuted(m) {
      if (Farm.state && Farm.state.data) {
        Farm.state.data.audioMuted = !!m;
        Farm.state.save();
      }
    },

    toggleMute() {
      this.setMuted(!this.isMuted());
      return this.isMuted();
    },

    // Schedule one short tone with attack-decay envelope.
    _tone(freq, startTime, dur, opts) {
      opts = opts || {};
      const t = startTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.glide) {
        osc.frequency.exponentialRampToValueAtTime(opts.glide, t + dur);
      }
      const peak = (opts.gain != null) ? opts.gain : 0.5;
      const attack = (opts.attack != null) ? opts.attack : 0.005;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    play(name) {
      if (this.isMuted()) return;
      // Skip until the user has actually interacted with the page. Boot-time
      // calls (e.g. retroactive achievement unlocks) would otherwise spam the
      // "AudioContext not allowed to start" warning.
      if (!this._gestureSeen) return;
      if (!this.ctx) this._init();
      if (!this.available) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
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
      }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.audio = audio;
})();
