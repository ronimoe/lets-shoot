// All sounds are synthesized with WebAudio — no asset files.

type V3 = { x: number; y: number; z: number };

const SHOT_PROFILE: Record<string, { f: number; q: number; dur: number; thump: number; gain: number }> = {
  warden: { f: 2600, q: 0.8, dur: 0.16, thump: 160, gain: 0.55 },
  hammer: { f: 1500, q: 0.7, dur: 0.32, thump: 90, gain: 0.85 },
  wasp: { f: 3200, q: 1.0, dur: 0.12, thump: 180, gain: 0.45 },
  thresher: { f: 1100, q: 0.6, dur: 0.4, thump: 70, gain: 0.9 },
  ranger: { f: 1900, q: 0.8, dur: 0.24, thump: 110, gain: 0.7 },
  falcon: { f: 2300, q: 0.9, dur: 0.2, thump: 130, gain: 0.62 },
  longbow: { f: 900, q: 0.5, dur: 0.6, thump: 55, gain: 1.0 },
};

export class GameAudio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  noise!: AudioBuffer;
  volume = 0.7;
  private comp!: DynamicsCompressorNode;

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch { return; }
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp).connect(ctx.destination);
    const len = ctx.sampleRate * 1.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  setListener(pos: V3, fx: number, fy: number, fz: number) {
    const ctx = this.ctx; if (!ctx) return;
    const L = ctx.listener;
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      (L as any).setPosition(pos.x, pos.y, pos.z);
      (L as any).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  private out(pos?: V3, ref = 4): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return this.master;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.1;
    p.maxDistance = 120;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, f: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = f; filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shot(weapon: string, pos?: V3) {
    const ctx = this.ctx; if (!ctx) return;
    const p = SHOT_PROFILE[weapon] ?? SHOT_PROFILE.warden;
    const t = ctx.currentTime;
    const dest = this.out(pos, 6);
    this.noiseBurst(dest, t, p.dur, p.f, p.q, p.gain);
    this.noiseBurst(dest, t, p.dur * 0.4, 6000, 0.5, p.gain * 0.35, 'highpass');
    this.tone(dest, t, p.thump * 2, p.dur * 0.8, p.gain * 0.7, 'triangle', p.thump * 0.5);
    // tail/echo
    this.noiseBurst(dest, t + 0.05, p.dur * 2.2, p.f * 0.4, 0.4, p.gain * 0.12);
  }

  slash(pos?: V3) {
    const ctx = this.ctx; if (!ctx) return;
    this.noiseBurst(this.out(pos), ctx.currentTime, 0.12, 3500, 2, 0.25, 'bandpass');
  }

  step(pos: V3 | undefined, loud = 1) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const dest = this.out(pos, 2.5);
    this.noiseBurst(dest, t, 0.07, 420 + Math.random() * 200, 1.5, 0.45 * loud, 'bandpass');
    this.tone(dest, t, 90, 0.06, 0.25 * loud, 'sine', 50);
  }

  land(pos?: V3) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const dest = this.out(pos, 3);
    this.noiseBurst(dest, t, 0.14, 300, 1, 0.6, 'lowpass');
  }

  reload(pos?: V3) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const dest = this.out(pos, 2);
    this.noiseBurst(dest, t, 0.05, 2500, 4, 0.3);
    this.noiseBurst(dest, t + 0.45, 0.06, 1800, 4, 0.35);
    this.noiseBurst(dest, t + 0.9, 0.05, 3000, 5, 0.3);
  }

  empty() {
    const ctx = this.ctx; if (!ctx) return;
    this.noiseBurst(this.master, ctx.currentTime, 0.03, 4000, 6, 0.25);
  }

  swap() {
    const ctx = this.ctx; if (!ctx) return;
    this.noiseBurst(this.master, ctx.currentTime, 0.06, 2200, 3, 0.18);
  }

  hit(head: boolean) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    if (head) { this.tone(this.master, t, 1800, 0.25, 0.25, 'sine', 1400); this.tone(this.master, t, 2700, 0.18, 0.12, 'sine'); }
    else this.noiseBurst(this.master, t, 0.08, 900, 2, 0.35);
  }

  hurt() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.master, t, 0.15, 500, 1, 0.5, 'lowpass');
    this.tone(this.master, t, 180, 0.15, 0.2, 'sawtooth', 90);
  }

  impact(pos: V3) {
    const ctx = this.ctx; if (!ctx) return;
    this.noiseBurst(this.out(pos, 1.5), ctx.currentTime, 0.05, 3000 + Math.random() * 2000, 3, 0.2);
  }

  beep(pos: V3, urgent: boolean) {
    const ctx = this.ctx; if (!ctx) return;
    this.tone(this.out(pos, 8), ctx.currentTime, urgent ? 2200 : 1800, 0.09, 0.35, 'square');
  }

  bounce(pos: V3) {
    const ctx = this.ctx; if (!ctx) return;
    this.tone(this.out(pos, 2), ctx.currentTime, 700 + Math.random() * 300, 0.06, 0.25, 'triangle');
  }

  explosion(pos: V3) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const dest = this.out(pos, 12);
    this.noiseBurst(dest, t, 1.6, 400, 0.5, 1.4, 'lowpass');
    this.noiseBurst(dest, t, 0.4, 2000, 0.5, 0.6, 'bandpass');
    this.tone(dest, t, 80, 1.2, 1.0, 'sine', 30);
  }

  smokePop(pos: V3) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const dest = this.out(pos, 4);
    this.noiseBurst(dest, t, 2.5, 1200, 0.3, 0.45, 'lowpass');
  }

  plantTick() {
    const ctx = this.ctx; if (!ctx) return;
    this.tone(this.master, ctx.currentTime, 1200, 0.05, 0.15, 'square');
  }

  ui() {
    const ctx = this.ctx; if (!ctx) return;
    this.tone(this.master, ctx.currentTime, 880, 0.06, 0.12, 'triangle');
  }

  buy() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(this.master, t, 660, 0.08, 0.15, 'triangle');
    this.tone(this.master, t + 0.06, 990, 0.1, 0.15, 'triangle');
  }

  sting(win: boolean) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const notes = win ? [523, 659, 784, 1047] : [440, 415, 349, 262];
    notes.forEach((n, i) => this.tone(this.master, t + i * 0.14, n, 0.5, 0.18, 'triangle'));
  }
}

export const audio = new GameAudio();
