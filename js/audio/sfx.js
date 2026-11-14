// Generated sound effects (WebAudio, no files): clashes, volleys, hits, hammers, coins and UI.
// Everything goes through a master gain and a gentle low-pass, for a soft "tabletop" sound.
let ctx = null, master = null, noiseBuf = null, on = true;
const last = new Map();
try { on = localStorage.getItem('tiers-v4-sound') !== '0'; } catch {}

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
  master = ctx.createGain(); master.gain.value = 0.7 * masterVol;
  master.connect(lp); lp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
// the browser only lets audio start after a user gesture
export function unlockAudio() { if (!on) return; const c = init(); if (c && c.state === 'suspended') c.resume(); }
export function soundOn() { return on; }
export function setSound(v) { on = v; try { localStorage.setItem('tiers-v4-sound', v ? '1' : '0'); } catch {} if (v) unlockAudio(); }
let volume = 1, masterVol = 0.8;
export function setVolume(v) { volume = v; }
// the Settings volume slider (0..1)
export function setMaster(v) { masterVol = v; if (master) master.gain.value = 0.7 * v; }

const R = (a, b) => a + Math.random() * (b - a);
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function noise(t, dur, { type = 'bandpass', f = 1200, q = 1, f2 = null, peak = 0.5, a = 0.005 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak * volume, dur);
  src.connect(fl); fl.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + a + dur + 0.05);
}
function tone(t, dur, { f = 440, f2 = null, type = 'sine', peak = 0.3, a = 0.005 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak * volume, dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + a + dur + 0.05);
}

const SFX = {
  swing: t => noise(t, 0.18, { f: R(900, 1400), f2: R(2400, 3200), q: 0.8, peak: 0.35, a: 0.03 }),
  hit: t => { noise(t, 0.09, { type: 'lowpass', f: 900, peak: 0.6 }); tone(t, 0.12, { f: R(110, 140), f2: 60, type: 'triangle', peak: 0.35 }); noise(t, 0.03, { f: 3500, q: 2, peak: 0.25 }); },
  clang: t => { tone(t, 0.25, { f: R(900, 1200), type: 'square', peak: 0.06 }); tone(t, 0.3, { f: R(1500, 1900), type: 'triangle', peak: 0.08 }); noise(t, 0.05, { f: 4000, q: 3, peak: 0.2 }); },
  volley: t => { tone(t, 0.16, { f: R(380, 460), f2: 170, type: 'triangle', peak: 0.22 }); noise(t + 0.02, 0.25, { f: 2600, f2: 1200, q: 3, peak: 0.12 }); },
  charge: t => { for (let i = 0; i < 5; i++) noise(t + i * 0.07, 0.06, { type: 'lowpass', f: 300, peak: 0.45 }); },
  blast: t => { tone(t, 0.6, { f: 90, f2: 35, type: 'sine', peak: 0.55 }); noise(t, 0.5, { type: 'lowpass', f: 1600, f2: 200, peak: 0.5, a: 0.01 }); },
  storm: t => { for (let i = 0; i < 6; i++) noise(t + i * 0.05 + R(0, 0.03), 0.12, { f: R(2000, 3000), f2: 900, q: 2, peak: 0.12 }); },
  rally: t => { tone(t, 0.35, { f: 392, type: 'sawtooth', peak: 0.08, a: 0.03 }); tone(t + 0.18, 0.5, { f: 523, type: 'sawtooth', peak: 0.08, a: 0.03 }); },
  raise: t => { [660, 880, 1320].forEach((f, i) => tone(t + i * 0.09, 0.4, { f, type: 'sine', peak: 0.12 })); },
  down: t => { noise(t, 0.35, { type: 'lowpass', f: 600, f2: 120, peak: 0.45 }); tone(t, 0.3, { f: 80, f2: 40, type: 'triangle', peak: 0.3 }); },
  hammer: t => { tone(t, 0.06, { f: R(700, 900), type: 'square', peak: 0.07 }); noise(t, 0.04, { f: 2500, q: 4, peak: 0.25 }); tone(t + 0.22, 0.06, { f: R(700, 900), type: 'square', peak: 0.06 }); noise(t + 0.22, 0.04, { f: 2500, q: 4, peak: 0.2 }); },
  built: t => { [523, 659, 784].forEach((f, i) => tone(t + i * 0.08, 0.35, { f, type: 'triangle', peak: 0.12 })); },
  coins: t => { for (let i = 0; i < 4; i++) tone(t + i * 0.05 + R(0, 0.02), 0.12, { f: R(2400, 3400), type: 'sine', peak: 0.08 }); },
  souls: t => { noise(t, 0.6, { f: 700, f2: 1800, q: 6, peak: 0.12, a: 0.15 }); tone(t, 0.6, { f: 220, f2: 330, type: 'sine', peak: 0.06, a: 0.2 }); },
  click: t => tone(t, 0.04, { f: 1200, type: 'triangle', peak: 0.08 }),
  confirm: t => { tone(t, 0.08, { f: 660, type: 'triangle', peak: 0.12 }); tone(t + 0.07, 0.12, { f: 990, type: 'triangle', peak: 0.12 }); },
  error: t => tone(t, 0.16, { f: 220, f2: 160, type: 'square', peak: 0.06 }),
  drum: t => { tone(t, 0.25, { f: 120, f2: 55, type: 'sine', peak: 0.5 }); noise(t, 0.08, { type: 'lowpass', f: 400, peak: 0.3 }); tone(t + 0.25, 0.3, { f: 110, f2: 50, type: 'sine', peak: 0.45 }); },
  victory: t => { [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.14, 0.5, { f, type: 'sawtooth', peak: 0.07, a: 0.02 })); },
  defeat: t => { [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.18, 0.55, { f, type: 'triangle', peak: 0.12, a: 0.02 })); },
};

// play a sound (rate-limited per name so a big volley doesn't turn into noise)
export function sfx(name, gap = 0.06) {
  if (!on || !SFX[name]) return;
  const c = init(); if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  if (now - (last.get(name) ?? -1) < gap) return;
  last.set(name, now);
  try { SFX[name](now + 0.01); } catch {}
}
