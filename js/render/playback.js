// Turns a resolution log into an animated, tier-by-tier playback over a display state.
// Step mode: each tier plays, then holds on a result card until next() is called.
import { CONFIG } from '../config.js';

export const SEC_PER_AP = 0.04;  // 100 AP ≈ 4 s at 1x
const BANNER = 0.9;              // title card before each tier

export function displayFromState(s) {
  const units = new Map(), buildings = new Map();
  for (const u of s.units) if (u.hp > 0) units.set(u.id, { ...u, tier: CONFIG.units[u.type].tier });
  for (const b of s.buildings) if (b.hp > 0) buildings.set(b.id, { ...b, progress: b.built ? 1 : b.progress / CONFIG.buildings[b.type].rounds });
  return { units, buildings, nodes: s.map.nodes.map(n => ({ ...n })) };
}

function cloneDisp(d) {
  return {
    units: new Map([...d.units].map(([k, v]) => [k, { ...v }])),
    buildings: new Map([...d.buildings].map(([k, v]) => [k, { ...v }])),
    nodes: d.nodes.map(n => ({ ...n })),
  };
}

const BORING = new Set(['tier', 'zoneoff', 'act', 'prep', 'slowed', 'apreturn']);
export const segInteresting = seg => seg.events.some(e => !BORING.has(e.type));

export class Playback {
  constructor(pre, log, post, { step = true } = {}) {
    this.pre = pre; this.log = log; this.post = post;
    this.step = step;
    this.disp = displayFromState(pre);
    this.items = [];
    for (const seg of log.segments) {
      const interesting = segInteresting(seg);
      if (seg.kind !== 'tier' && !interesting) {
        // still apply silently (tier reveals etc.)
        this.items.push({ seg, pad: 0, dur: 0, silent: true });
        continue;
      }
      const dur = seg.kind === 'tier' ? Math.max(0.6, seg.len * SEC_PER_AP) : 1.2;
      this.items.push({ seg, pad: BANNER, dur, hold: true });
    }
    this.cursor = 0; this.local = 0; this.evIdx = 0; this.trackCur = {};
    this.holding = false; this.done = false;
    this.snap = cloneDisp(this.disp);
    if (!this.items.length) this.done = true;
  }

  get item() { return this.items[this.cursor] || null; }
  get curSeg() { return this.item ? this.item.seg : null; }
  // time inside the current segment, in AP
  get tAP() { const it = this.item; if (!it) return 0; return Math.max(0, Math.min(it.seg.len, (this.local - it.pad) / SEC_PER_AP)); }
  get phase() {
    if (this.done) return 'done';
    if (this.holding) return 'hold';
    const it = this.item;
    return it && this.local < it.pad ? 'banner' : 'play';
  }

  tickDecay(dt) {
    for (const [, u] of this.disp.units) { if (u.flash) u.flash = Math.max(0, u.flash - dt * 2); if (u.dying !== undefined && u.dying < 1) u.dying = Math.min(1, u.dying + dt * 1.5); }
    for (const [, b] of this.disp.buildings) if (b.dying !== undefined && b.dying < 1) b.dying = Math.min(1, b.dying + dt * 1.2);
  }

  // Advance by dt seconds. Returns fired events.
  advance(dt) {
    const fired = [];
    this.tickDecay(dt);
    if (this.done || this.holding) return fired;
    this.local += dt;
    while (!this.done && !this.holding) {
      const it = this.item;
      if (it.silent) { this.flushItem(it, fired); this.finishItem(); continue; }
      if (this.local < it.pad) break;
      const tAP = Math.min(it.seg.len, (this.local - it.pad) / SEC_PER_AP);
      this.applyTracks(it.seg, tAP);
      const evs = it.seg.events;
      while (this.evIdx < evs.length && evs[this.evIdx].t <= tAP + 1e-6) fired.push(this.fire(evs[this.evIdx++], it.seg));
      if (this.local < it.pad + it.dur) break;
      this.flushItem(it, fired);
      if (this.step && it.hold) { this.holding = true; break; }
      this.finishItem();
      // carry over remaining time into the next item
    }
    return fired;
  }

  fire(e, seg) {
    this.applyEvent(e);
    Object.defineProperty(e, '__seg', { value: seg, configurable: true, enumerable: false });
    return e;
  }

  flushItem(it, fired) {
    this.applyTracks(it.seg, it.seg.len + 1);
    const evs = it.seg.events;
    while (this.evIdx < evs.length) fired.push(this.fire(evs[this.evIdx++], it.seg));
  }

  finishItem() {
    this.holding = false;
    this.cursor++; this.local = 0; this.evIdx = 0; this.trackCur = {};
    for (const m of [this.disp.units, this.disp.buildings]) for (const [id, e] of m) if (e.dying >= 1) m.delete(id);
    this.snap = cloneDisp(this.disp);
    if (this.cursor >= this.items.length) this.done = true;
  }

  // Continue after a held tier.
  next() { if (this.holding) this.finishItem(); }

  // Play the current tier again from its start.
  replaySegment() {
    if (this.done) return;
    this.disp = cloneDisp(this.snap);
    this.local = this.item.pad * 0.4; this.evIdx = 0; this.trackCur = {}; this.holding = false;
  }

  applyTracks(seg, t) {
    for (const [id, tr] of Object.entries(seg.tracks)) {
      const u = this.disp.units.get(id);
      if (!u || !tr.length) continue;
      if (t < tr[0][0]) continue;
      let k = this.trackCur[id] || 0;
      while (k < tr.length - 1 && tr[k + 1][0] <= t) k++;
      this.trackCur[id] = k;
      if (k >= tr.length - 1) { u.x = tr[k][1]; u.z = tr[k][2]; continue; }
      const a = tr[k], b = tr[k + 1];
      const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      u.x = a[1] + (b[1] - a[1]) * f; u.z = a[2] + (b[2] - a[2]) * f;
    }
  }

  applyEvent(e) {
    const D = this.disp;
    switch (e.type) {
      case 'hit': {
        const t = D.units.get(e.dst) || D.buildings.get(e.dst);
        if (t) { t.hp = e.hp; t.flash = 1; if (t.st && e.defended && !e.cover && e.defLeft !== undefined) t.st = { ...t.st, defends: e.defLeft }; }
        break;
      }
      case 'death': { const u = D.units.get(e.id); if (u) { u.dying = 0; u.hp = 0; } break; }
      case 'bdestroy': { const b = D.buildings.get(e.id); if (b) { b.dying = 0; b.hp = 0; } break; }
      case 'tier': { const u = D.units.get(e.id); if (u) u.tier = e.tier; break; }
      // status icons: what each unit has ready, ticked off as it is used
      case 'prep': { const u = D.units.get(e.id); if (u) u.st = { defends: e.defends, parry: e.parry, ow: e.ow, buffs: e.buffs || [], upgrades: e.upgrades, rallied: e.rallied, slow: false }; break; }
      case 'parry': { const u = D.units.get(e.id); if (u && u.st) u.st = { ...u.st, parry: false }; break; }
      case 'slowed': { const u = D.units.get(e.id); if (u && u.st) u.st = { ...u.st, slow: true }; break; }
      case 'act': { const u = D.units.get(e.id); if (u && u.st && u.st.slow) u.st = { ...u.st, slow: false }; break; }
      case 'push': { const u = D.units.get(e.id); if (u) { u.x = e.x; u.z = e.z; } break; }
      case 'heal': { const u = D.units.get(e.id); if (u) u.hp = e.hp; break; }
      case 'spawn': {
        const pu = this.post.units.find(x => x.id === e.id);
        if (pu) D.units.set(e.id, { ...pu, tier: CONFIG.units[pu.type].tier, spawnFx: 1 });
        break;
      }
      case 'build': {
        const pb = this.post.buildings.find(x => x.id === e.id);
        if (pb) D.buildings.set(e.id, { ...pb, built: false, progress: 0 });
        break;
      }
      case 'built': { const b = D.buildings.get(e.id); if (b) { b.built = true; b.progress = 1; } break; }
      case 'capture': { const n = D.nodes.find(x => x.id === e.node); if (n) n.owner = e.owner; break; }
      case 'shot': { const b = D.buildings.get(e.id); if (b) b.aim = { x: e.bx, z: e.bz }; const u = D.units.get(e.id); if (u) { u.face = { x: e.bx, z: e.bz }; if (e.ow && u.st) u.st = { ...u.st, ow: Math.max(0, u.st.ow - 1) }; } break; }
    }
  }

  // Play everything that is left without stopping. Returns the events fired.
  skip() {
    const fired = [];
    this.step = false;
    let guard = 0;
    while (!this.done && guard++ < 10000) {
      if (this.holding) this.finishItem();
      fired.push(...this.advance(1));
    }
    return fired;
  }

  bannerText(seg) {
    if (seg.kind === 'start') return 'Before anyone moves';
    if (seg.kind === 'buildings') return 'Buildings act';
    const names = { 6: 'Tier 6 · Fast', 5: 'Tier 5 · Normal', 4: 'Tier 4 · Slow' };
    return names[seg.tier] || 'Tier ' + seg.tier;
  }
}

// Turn a status object into the icon list drawn above a unit
export function statusIcons(st) {
  if (!st) return [];
  const out = [];
  if (st.defends > 0) out.push({ k: 'def', n: st.defends });
  if (st.parry) out.push({ k: 'parry' });
  if (st.ow > 0) out.push({ k: 'ow', n: st.ow });
  if ((st.buffs || []).includes('fortify')) out.push({ k: 'fort' });
  if (st.rallied || (st.buffs || []).includes('rally')) out.push({ k: 'rally' });
  if (st.upgrades > 0) out.push({ k: 'tier', n: st.upgrades });
  if (st.slow) out.push({ k: 'slow' });
  return out;
}
