// All sound is synthesised with the Web Audio API, so the game ships no audio files.
// Browsers keep audio locked until a user gesture: call unlock() from the first tap or key press.

let ctx = null;
let master, sfxBus, musicBus, noiseBuf;
const opts = { sfx: true, music: true };
let musicOn = false, musicTimer = 0, nextStepAt = 0, step = 0, intensity = 1, tempoMul = 0;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();   // keeps stacked effects from clipping
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = opts.sfx ? 0.9 : 0;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = opts.music ? 0.34 : 0;
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** Called when the tab is hidden or the game is paused, so nothing keeps playing in the background. */
export function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
export function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

export function configure(o) {
  Object.assign(opts, o);
  if (!ctx) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(opts.sfx ? 0.9 : 0, t, 0.02);
  musicBus.gain.setTargetAtTime(opts.music ? 0.34 : 0, t, 0.05);
}

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function tone({ f0, f1 = f0, dur = 0.15, type = 'sine', vol = 0.3, at = 0, bus, attack = 0.005, lp }) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
  node.connect(g).connect(bus || sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.15, vol = 0.25, at = 0, hp = 0, lp = 0, bus }) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + at;
  const s = c.createBufferSource(), g = c.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = s;
  if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  node.connect(g).connect(bus || sfxBus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

export const sfx = {
  click() { tone({ f0: 660, f1: 880, dur: 0.07, type: 'triangle', vol: 0.18 }); },
  lane() { noise({ dur: 0.09, vol: 0.12, hp: 1200, lp: 5000 }); },
  jump() { tone({ f0: 280, f1: 620, dur: 0.22, type: 'square', vol: 0.1, lp: 2400 }); noise({ dur: 0.12, vol: 0.08, hp: 800 }); },
  land() { tone({ f0: 120, f1: 60, dur: 0.12, type: 'sine', vol: 0.3 }); noise({ dur: 0.08, vol: 0.1, lp: 900 }); },
  coin(streak = 0) {   // the pitch climbs with the streak
    const base = 76 + Math.min(streak, 12) * 0.5;
    tone({ f0: hz(base), dur: 0.1, type: 'square', vol: 0.09, lp: 5000 });
    tone({ f0: hz(base + 7), dur: 0.18, type: 'square', vol: 0.09, at: 0.06, lp: 5000 });
  },
  hit() { tone({ f0: 180, f1: 40, dur: 0.35, type: 'sawtooth', vol: 0.35, lp: 1200 }); noise({ dur: 0.3, vol: 0.3, lp: 1800 }); },
  orb() { tone({ f0: 900, f1: 260, dur: 0.3, type: 'sawtooth', vol: 0.1, lp: 3000 }); },
  warn() { tone({ f0: 520, dur: 0.1, type: 'square', vol: 0.09, lp: 2500 }); tone({ f0: 520, dur: 0.1, type: 'square', vol: 0.09, at: 0.14, lp: 2500 }); },
  boss() { tone({ f0: 110, f1: 82, dur: 0.6, type: 'sawtooth', vol: 0.22, lp: 700 }); tone({ f0: 116, f1: 87, dur: 0.6, type: 'sawtooth', vol: 0.16, lp: 700 }); },
  budget() { [0, 4, 7, 12, 16].forEach((n, i) => tone({ f0: hz(72 + n), dur: 0.25, type: 'triangle', vol: 0.16, at: i * 0.07 })); },
  buy() { tone({ f0: hz(76), dur: 0.1, type: 'triangle', vol: 0.18 }); tone({ f0: hz(83), dur: 0.2, type: 'triangle', vol: 0.18, at: 0.08 }); },
  over() { [0, -3, -7, -12].forEach((n, i) => tone({ f0: hz(69 + n), dur: 0.35, type: 'triangle', vol: 0.22, at: i * 0.16 })); },
  best() { [0, 4, 7, 12, 7, 12].forEach((n, i) => tone({ f0: hz(72 + n), dur: 0.2, type: 'square', vol: 0.1, at: i * 0.09, lp: 4000 })); },
};

/* ---------- music: a four-chord loop in A minor, sped up as the run does ---------- */
const BASS = [45, 41, 36, 43];
const CHORD = [[69, 72, 76], [65, 69, 72], [60, 64, 67], [67, 71, 74]];
const ARP = [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0, 2, 1, 2];

function scheduleStep(at, i) {
  const bar = Math.floor(i / 16) % 4, s = i % 16, vol = intensity;
  const c = ensure();
  const dt = at - c.currentTime;
  if (s % 4 === 0) tone({ f0: 150, f1: 42, dur: 0.16, type: 'sine', vol: 0.5 * vol, at: dt, bus: musicBus });
  if (s % 4 === 2) noise({ dur: 0.04, vol: 0.12 * vol, hp: 7000, at: dt, bus: musicBus });
  if ([0, 3, 6, 8, 11, 14].includes(s)) tone({ f0: hz(BASS[bar]), dur: 0.2, type: 'sawtooth', vol: 0.22, at: dt, bus: musicBus, lp: 520 });
  if (s % 2 === 0 || intensity > 0.6) tone({ f0: hz(CHORD[bar][ARP[s]] + (s >= 8 ? 12 : 0)), dur: 0.11, type: 'square', vol: 0.05 + 0.03 * vol, at: dt, bus: musicBus, lp: 3200 });
}

function pump() {
  const c = ctx;
  if (!c || !musicOn) return;
  while (nextStepAt < c.currentTime + 0.18) {
    if (nextStepAt > c.currentTime - 0.05) scheduleStep(Math.max(nextStepAt, c.currentTime), step);
    step++;
    const bpm = 112 + tempoMul * 36;
    nextStepAt += 60 / bpm / 4;
  }
}

export const music = {
  start() {
    const c = ensure();
    if (!c || musicOn) return;
    musicOn = true;
    nextStepAt = c.currentTime + 0.05;
    step = 0;
    musicTimer = setInterval(pump, 40);
  },
  stop() {
    musicOn = false;
    clearInterval(musicTimer);
  },
  /** 0..1: how hard the run is going (tempo), and how full the arrangement is. */
  setTempo(t) { tempoMul = Math.max(0, Math.min(1, t)); },
  setIntensity(v) { intensity = v; },
};
