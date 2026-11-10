// Turns a resolution log into an animated timeline over a display state.
import { CONFIG } from '../config.js';

const SEC_PER_AP = 0.03;      // 100 AP ≈ 3 s at 1x
const BANNER = 1.0;           // pause before each tier

export function displayFromState(s) {
  const units = new Map(), buildings = new Map();
  for (const u of s.units) if (u.hp > 0) units.set(u.id, { ...u, tier: CONFIG.units[u.type].tier });
  for (const b of s.buildings) if (b.hp > 0) buildings.set(b.id, { ...b, progress: b.built ? 1 : b.progress / CONFIG.buildings[b.type].rounds });
  return { units, buildings, nodes: s.map.nodes.map(n => ({ ...n })) };
}

export class Playback {
  constructor(pre, log, post) {
    this.pre = pre; this.log = log; this.post = post;
    this.disp = displayFromState(pre);
    this.items = [];
    let t = 0;
    for (const seg of log.segments) {
      let pad = BANNER;
      if (seg.kind === 'start') pad = 0.2;
      if (seg.kind === 'buildings' && !seg.events.length) continue;
      const dur = Math.max(0.3, seg.len * SEC_PER_AP);
      this.items.push({ seg, start: t + pad, bannerStart: t, dur });
      t += pad + dur;
    }
    this.total = t + 0.4;
    this.time = 0;
    this.cursor = 0;           // current item
    this.evIdx = 0;
    this.trackCur = {};
    this.done = false;
    this.enemyTrails = new Map(); // id -> [{x,z}]
  }

  // Advance by dt seconds of playback time. Returns {events:[...], banner:{...}|null}
  advance(dt) {
    const fired = [];
    if (this.done) return { events: fired, banner: null };
    this.time += dt;
    for (const [, u] of this.disp.units) { if (u.flash) u.flash = Math.max(0, u.flash - dt * 2); if (u.dying !== undefined) u.dying += dt * 2; }
    for (const [, b] of this.disp.buildings) if (b.dying !== undefined) b.dying += dt * 1.5;
    for (const m of [this.disp.units, this.disp.buildings]) for (const [id, e] of m) if (e.dying >= 1) m.delete(id);
    let banner = null;
    while (this.cursor < this.items.length) {
      const it = this.items[this.cursor];
      this.curSeg = it.seg;
      if (this.time < it.start) { banner = { seg: it.seg, k: (this.time - it.bannerStart) / (it.start - it.bannerStart) }; break; }
      const tAP = Math.min(it.seg.len, (this.time - it.start) / SEC_PER_AP);
      this.applyTracks(it.seg, tAP);
      const evs = it.seg.events;
      while (this.evIdx < evs.length && evs[this.evIdx].t <= tAP + 1e-6) {
        const e = evs[this.evIdx++];
        this.applyEvent(e);
        Object.defineProperty(e, '__seg', { value: it.seg, configurable: true, enumerable: false });
        fired.push(e);
      }
      if (this.time >= it.start + it.dur) {
        // flush the rest of this segment
        this.applyTracks(it.seg, it.seg.len + 1);
        while (this.evIdx < evs.length) { const e = evs[this.evIdx++]; this.applyEvent(e); Object.defineProperty(e, '__seg', { value: it.seg, configurable: true, enumerable: false }); fired.push(e); }
        this.cursor++; this.evIdx = 0; this.trackCur = {};
        continue;
      }
      banner = { seg: it.seg, k: 1, active: true };
      break;
    }
    if (this.time >= this.total) { this.done = true; this.curSeg = null; }
    return { events: fired, banner };
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
        if (t) { t.hp = e.hp; t.flash = 1; }
        break;
      }
      case 'death': { const u = D.units.get(e.id); if (u) { u.dying = 0; u.hp = 0; } break; }
      case 'bdestroy': { const b = D.buildings.get(e.id); if (b) { b.dying = 0; b.hp = 0; } break; }
      case 'tier': { const u = D.units.get(e.id); if (u) u.tier = e.tier; break; }
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
      case 'shot': { const b = D.buildings.get(e.id); if (b) b.aim = { x: e.bx, z: e.bz }; const u = D.units.get(e.id); if (u) u.face = { x: e.bx, z: e.bz }; break; }
    }
  }

  skip() {
    const fired = [];
    while (!this.done) { const r = this.advance(0.5); fired.push(...r.events); }
    return fired;
  }

  bannerText(seg) {
    if (seg.kind === 'start') return 'Resolution';
    if (seg.kind === 'buildings') return 'Buildings act';
    const names = { 8: 'Tier 8', 7: 'Tier 7', 6: 'Tier 6 · Fast', 5: 'Tier 5 · Normal', 4: 'Tier 4 · Slow' };
    return names[seg.tier] || 'Tier ' + seg.tier;
  }
}
