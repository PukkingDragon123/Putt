// Procedural WebAudio: every sound is synthesized in-engine (no asset files).
// Crunchy, lo-fi and oppressive to match the STYLE FORMULA's mood. The context
// is created on the first user gesture (autoplay policy) via resume().
export class Audio {
  constructor() {
    this.ctx = null; this.master = null; this.noise = null;
    this.muted = false; this.ambient = null;
  }
  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    // shared white-noise buffer
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }
  resume() { this.ensure(); if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }

  _now() { return this.ctx.currentTime; }
  _noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; return s; }
  _env(g, t0, peak, atk, dec) {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dec);
  }
  _tone(type, f0, f1, t0, dur, peak, dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    this._env(g, t0, peak, 0.005, dur);
    o.connect(g).connect(dest || this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  _burst(t0, dur, peak, lp0, lp1) {
    const s = this._noiseSrc(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.setValueAtTime(lp0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, lp1), t0 + dur);
    this._env(g, t0, peak, 0.004, dur);
    s.connect(f).connect(g).connect(this.master); s.start(t0); s.stop(t0 + dur + 0.05);
  }

  putt(power) {
    if (!this.ctx || this.muted) return; const t = this._now();
    this._burst(t, 0.07, 0.5, 1800, 400);
    this._tone("sine", 150 + power * 120, 60, t, 0.12, 0.4);
  }
  wall() { if (!this.ctx || this.muted) return; const t = this._now(); this._burst(t, 0.04, 0.3, 5000, 1500); }
  sink() {
    if (!this.ctx || this.muted) return; const t = this._now();
    this._tone("triangle", 440, 440, t, 0.12, 0.4);
    this._tone("triangle", 660, 660, t + 0.1, 0.14, 0.4);
    this._tone("sine", 120, 70, t, 0.2, 0.3);
  }
  bang() {
    if (!this.ctx || this.muted) return; const t = this._now();
    this._burst(t, 0.35, 1.1, 4000, 120);
    this._tone("sine", 90, 35, t, 0.4, 0.9);
    this._tone("sawtooth", 70, 30, t, 0.25, 0.4);
  }
  blank() { if (!this.ctx || this.muted) return; const t = this._now(); this._burst(t, 0.03, 0.5, 6000, 3000); this._tone("square", 900, 700, t, 0.03, 0.15); }
  spike() { if (!this.ctx || this.muted) return; const t = this._now(); this._tone("sawtooth", 800, 120, t, 0.18, 0.5); this._burst(t, 0.12, 0.4, 3000, 300); }
  splash() { if (!this.ctx || this.muted) return; const t = this._now(); this._burst(t, 0.3, 0.5, 2600, 200); }
  heal() { if (!this.ctx || this.muted) return; const t = this._now(); this._tone("sine", 520, 780, t, 0.25, 0.35); this._tone("sine", 780, 1040, t + 0.12, 0.25, 0.25); }
  pill(good) {
    if (!this.ctx || this.muted) return; const t = this._now();
    if (good) { this._tone("triangle", 600, 1200, t, 0.3, 0.35); this._tone("triangle", 900, 1500, t + 0.08, 0.25, 0.25); }
    else { this._tone("sawtooth", 400, 120, t, 0.4, 0.4); this._tone("square", 220, 90, t, 0.4, 0.25); }
  }
  item() { if (!this.ctx || this.muted) return; const t = this._now(); this._tone("square", 700, 1100, t, 0.08, 0.25); }
  click() { if (!this.ctx || this.muted) return; const t = this._now(); this._tone("square", 1200, 1200, t, 0.02, 0.12); }
  cash() { if (!this.ctx || this.muted) return; const t = this._now(); this._tone("square", 880, 1320, t, 0.06, 0.22); this._tone("square", 1320, 1760, t + 0.07, 0.08, 0.18); }
  squeak() { if (!this.ctx || this.muted) return; const t = this._now(); this._tone("sawtooth", 1400, 2200, t, 0.05, 0.18); this._tone("sawtooth", 2000, 1500, t + 0.05, 0.05, 0.12); }
  clatter() { if (!this.ctx || this.muted) return; const t = this._now(); this._burst(t, 0.08, 0.4, 4000, 800); this._tone("square", 300, 180, t, 0.1, 0.2); }

  ambientStart() {
    if (!this.ctx || this.ambient) return;
    const out = this.ctx.createGain(); out.gain.value = 0.0;
    out.connect(this.master);
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320; lp.connect(out);
    const a = this.ctx.createOscillator(), b = this.ctx.createOscillator();
    a.type = "sawtooth"; a.frequency.value = 41.2;   // low E-ish drone
    b.type = "triangle"; b.frequency.value = 55;
    const ga = this.ctx.createGain(); ga.gain.value = 0.5; a.connect(ga).connect(lp);
    const gb = this.ctx.createGain(); gb.gain.value = 0.35; b.connect(gb).connect(lp);
    // slow breathing LFO on the master ambient gain
    const lfo = this.ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.04;
    lfo.connect(lfoG).connect(out.gain);
    out.gain.setValueAtTime(0.0001, this._now());
    out.gain.linearRampToValueAtTime(0.07, this._now() + 4);
    a.start(); b.start(); lfo.start();
    this.ambient = { out, a, b, lfo };
  }
}
