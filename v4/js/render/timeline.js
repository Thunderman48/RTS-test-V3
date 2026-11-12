// Scrubbable round timeline: turns a resolution log into keyframes you can sample at any time.
// Time is in AP units (global). Each tier is preceded by a short gap so tiers read as chapters.
const GAP = 14;

export class Timeline {
  constructor(pre, log) {
    this.pre = pre; this.log = log;
    this.sections = [];  // {kind, tier, t0, t1, squads}
    this.events = [];    // events with global T
    this.keys = new Map();   // id -> [[T,x,z,fx,fz]]
    this.hp = new Map();     // id -> [[T,hp,models]]
    this.down = new Map();   // id -> T
    this.teles = [];         // {id, T0, T1, ...shape}
    this.blocks = [];        // {id, T0, T1, kind}
    for (const q of pre.squads) {
      this.keys.set(q.id, [[0, q.x, q.z, q.fx, q.fz]]);
      this.hp.set(q.id, [[0, q.hp, q.models]]);
    }
    let T = 0;
    for (const seg of log.segments) {
      if (seg.kind === 'tier') T += GAP;
      const t0 = T;
      const sec = { kind: seg.kind, tier: seg.tier, t0, t1: t0 + seg.len, squads: seg.squads || [] };
      if (seg.kind === 'tier') this.sections.push(sec);
      for (const [id, tr] of Object.entries(seg.tracks)) {
        const k = this.keys.get(id);
        for (const row of tr) {
          const g = t0 + row[0];
          // hold previous pose until the track starts
          if (k.length && k[k.length - 1][0] < g - 1e-6) k.push([g - 1e-6, k[k.length - 1][1], k[k.length - 1][2], k[k.length - 1][3], k[k.length - 1][4]]);
          k.push([g, row[1], row[2], row[3], row[4]]);
        }
      }
      for (const e of seg.events) {
        const ge = { ...e, T: t0 + e.t, tier: seg.tier };
        this.events.push(ge);
        if (e.type === 'hit') this.hp.get(e.dst)?.push([ge.T, e.hp, e.models]);
        if (e.type === 'down') this.down.set(e.id, ge.T);
        if (e.type === 'tele') this.teles.push({ ...e, T0: ge.T, T1: t0 + e.t1 });
        if (e.type === 'act') this.blocks.push({ id: e.id, kind: e.kind, T0: ge.T, T1: ge.T + e.cost });
      }
      T = t0 + seg.len;
    }
    this.total = T + 6;
    for (const k of this.keys.values()) k.sort((a, b) => a[0] - b[0]);
    this.events.sort((a, b) => a.T - b.T);
  }

  sectionAt(T) { return this.sections.find(s => T >= s.t0 - GAP && T <= s.t1 + 0.5) || null; }

  pose(id, T) {
    const k = this.keys.get(id);
    if (!k || !k.length) return null;
    if (T <= k[0][0]) return { x: k[0][1], z: k[0][2], fx: k[0][3], fz: k[0][4], moving: false };
    let lo = 0, hi = k.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (k[m][0] <= T) lo = m; else hi = m - 1; }
    const a = k[lo], b = k[lo + 1];
    if (!b) return { x: a[1], z: a[2], fx: a[3], fz: a[4], moving: false };
    const f = (T - a[0]) / Math.max(1e-6, b[0] - a[0]);
    const moving = Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) > 1e-4;
    return { x: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, fx: a[3] + (b[3] - a[3]) * f, fz: a[4] + (b[4] - a[4]) * f, moving };
  }

  health(id, T) {
    const h = this.hp.get(id);
    let cur = h[0];
    for (const row of h) { if (row[0] <= T) cur = row; else break; }
    return { hp: cur[1], models: cur[2] };
  }

  // Display state of every squad at time T
  sample(T) {
    const out = [];
    const sec = this.sectionAt(T);
    const acting = sec && T >= sec.t0 ? new Set(sec.squads) : null;
    for (const q of this.pre.squads) {
      const p = this.pose(q.id, T);
      const h = this.health(q.id, T);
      const dT = this.down.get(q.id);
      const dying = dT !== undefined && T >= dT ? (T - dT) / 20 : undefined;
      // the attack being animated: the latest wind-up that has started (kept a while after release)
      let atk = null;
      for (const tl of this.teles) if (tl.id === q.id && T >= tl.T0 - 0.5 && T <= tl.T1 + 9) atk = { T0: tl.T0, T1: tl.T1, now: T, kind: tl.kind };
      let struck;
      for (const e of this.events) { if (e.T > T) break; if (e.type === 'hit' && e.dst === q.id) struck = T - e.T; }
      const info = this.info(q.id, T);
      out.push({ ...q, ...p, hp: h.hp, models: h.models, dying, atk, struck, flash: struck !== undefined && struck < 5 ? 1 - struck / 5 : 0,
        defLeft: info.defLeft, tierShown: info.tier, upgrades: info.upgrades, stanceShown: info.stance,
        acting: !!acting && acting.has(q.id) && h.hp > 0 && (dying === undefined) });
    }
    return out;
  }

  // tier, prepared defends left, upgrades and stance of a squad at time T
  info(id, T) {
    let tier = null, defLeft = 0, upgrades = 0, stance = null;
    for (const e of this.events) {
      if (e.T > T && e.type !== 'prep') break;
      if (e.type === 'prep' && e.id === id) { tier = e.tier; defLeft = e.defends; upgrades = e.upgrades; stance = e.stance; }
      else if (e.type === 'hit' && e.dst === id) defLeft = e.defLeft;
    }
    return { tier, defLeft, upgrades, stance };
  }

  activeTeles(T) { return this.teles.filter(t => T >= t.T0 && T <= t.T1 + 4); }
  eventsBetween(a, b) { return this.events.filter(e => e.T > a && e.T <= b); }
}

export const SEC_PER_AP = 0.05; // 100 AP = 5 seconds at 1x
