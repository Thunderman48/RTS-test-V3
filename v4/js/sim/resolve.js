// V4 round resolution.
//  Both sides' orders are resolved together. Speed tiers act fastest -> slowest; inside a tier
//  every squad acts at once on a shared timeline where an action's AP cost is its duration.
//  Every attack is a non-targeted skillshot: a Swing arc or a Volley line. Its area is
//  telegraphed for the whole wind-up and anything inside it when it resolves is hit.
// Produces the new state and a log used for scrubbable playback.
import { RULES } from '../data/units.js';
import { dist, norm, segRect, segCircle } from './geom.js';
import { clone, defOf, radiusOf, modelsFor, speedOf, apFor } from './state.js';
import { validateOrders, actionCost } from './orders.js';
import { buildStancePlan } from './stances.js';
import { terrainFactor, pointBlocked, blocks } from './nav.js';

const r3 = v => Math.round(v * 1000) / 1000;

export function damageAfter(dmg, armor, defended) {
  const v = dmg * RULES.armorK / (RULES.armorK + armor) * (defended ? RULES.defendMult : 1);
  return Math.max(1, Math.round(v));
}

// Does a swing arc from origin o (facing d, radius R, cos half-angle ch) touch circle (c, rc)?
export function arcHits(ox, oz, dx, dz, R, ch, cx, cz, rc) {
  const vx = cx - ox, vz = cz - oz;
  const l = Math.sqrt(vx * vx + vz * vz);
  if (l - rc > R) return false;
  if (l <= rc) return true;
  const cosA = (vx * dx + vz * dz) / l;
  return cosA >= ch - rc / l;
}

export function resolveRound(state0, ordersIn) {
  const s = clone(state0);
  const round = s.round;
  const orders = [0, 1].map(p => validateOrders(s, p, ordersIn[p]));
  const log = { round, segments: [] };

  for (const p of [0, 1]) for (const [id, st] of Object.entries(orders[p].stances)) {
    const q = s.squads.find(x => x.id === id); if (q) q.stance = st;
  }
  // planning-time knowledge (all visible in M1)
  const snapshot = s.squads.filter(q => q.hp > 0).map(q => ({ ...q }));

  const rts = [];
  for (const q of s.squads) {
    if (q.hp <= 0) continue;
    const def = defOf(q);
    const direct = orders[q.owner].squads[q.id];
    const plan = direct || buildStancePlan(s, q, snapshot.filter(e => e.owner !== q.owner));
    rts.push({
      q, def, plan, direct: !!direct,
      actions: plan.actions.map(a => ({ ...a, cost: actionCost(q, a) })),
      tier: Math.max(RULES.minTier, def.tier + (plan.upgrades || 0)),
      idx: 0, el: 0, st: null,
      defends: def.defends + (plan.defends || 0),
      acted: false,
    });
  }
  rts.sort((a, b) => (a.q.id < b.q.id ? -1 : 1));
  const rtById = new Map(rts.map(r => [r.q.id, r]));

  let seg = null, T = 0;
  const ev = e => seg.events.push({ t: r3(T), ...e });
  const rec = (q, t) => {
    const tr = seg.tracks[q.id] || (seg.tracks[q.id] = []);
    const row = [r3(t), r3(q.x), r3(q.z), r3(q.fx), r3(q.fz)];
    const last = tr[tr.length - 1];
    if (last && last[0] === row[0]) tr[tr.length - 1] = row; else tr.push(row);
  };
  const living = () => s.squads.filter(q => q.hp > 0);

  // ---- start: reveal tiers and what each squad prepared --------------------------
  seg = { kind: 'start', len: 0, tracks: {}, events: [] };
  for (const r of rts) ev({ type: 'prep', id: r.q.id, tier: r.tier, upgrades: r.plan.upgrades || 0, defends: r.defends, stance: r.direct ? null : r.q.stance });
  log.segments.push(seg);

  // ---- hits ---------------------------------------------------------------------
  let hits = [];
  function applyHits(batch) {
    const byDst = new Map();
    for (const h of batch) { if (!byDst.has(h.dst.id)) byDst.set(h.dst.id, []); byDst.get(h.dst.id).push(h); }
    for (const [, list] of byDst) {
      list.sort((a, b) => b.dmg - a.dmg); // strongest hit uses the defend first
      for (const h of list) {
        const q = h.dst, r = rtById.get(q.id);
        let defended = false;
        if (r && r.defends > 0) { r.defends--; defended = true; }
        const dmg = damageAfter(h.dmg, defOf(q).armor, defended);
        const before = q.models;
        q.hp = Math.max(0, q.hp - dmg);
        q.models = modelsFor(q, q.hp);
        ev({ type: 'hit', src: h.src, dst: q.id, dmg, raw: h.dmg, defended, kind: h.kind, hp: q.hp, models: q.models, lost: before - q.models, defLeft: r ? r.defends : 0 });
      }
    }
  }
  function checkDeaths() {
    for (const q of s.squads) if (q.hp <= 0 && !q.dead) {
      q.dead = true;
      ev({ type: 'down', id: q.id });
      const r = rtById.get(q.id); if (r) r.idx = r.actions.length;
    }
  }

  // ---- one AP of an action ---------------------------------------------------------
  function step(r, moves) {
    const q = r.q, a = r.actions[r.idx];
    if (r.el === 0) {
      r.st = { phase: 'go' };
      if (a.kind === 'move') { r.st.pts = a.pts.map(p => ({ ...p })); }
      if (a.kind === 'swing' || a.kind === 'volley') {
        const d = norm(a.x - q.x, a.z - q.z);
        if (d.l > 0.01) { q.fx = d.x; q.fz = d.z; }
        r.st.dx = q.fx; r.st.dz = q.fz; r.st.ox = q.x; r.st.oz = q.z;
        const at = r.def.attack;
        const shape = a.kind === 'swing'
          ? { shape: 'arc', R: r3(radiusOf(q) + at.reach), ch: at.cosHalf }
          : { shape: 'line', len: at.range, w: at.width };
        rec(q, T);
        ev({ type: 'tele', id: q.id, kind: a.kind, ox: r3(q.x), oz: r3(q.z), dx: r3(q.fx), dz: r3(q.fz), t1: r3(T + a.cost), ...shape });
      }
      ev({ type: 'act', id: q.id, kind: a.kind, cost: a.cost });
    }
    r.el += 1;
    const st = r.st;
    if (a.kind === 'move' && st.phase === 'go') {
      const f = terrainFactor(s.terrain, q.x, q.z);
      moves.push({ r, st, d: speedOf(q) * f });
    } else if ((a.kind === 'swing' || a.kind === 'volley') && r.el >= a.cost && st.phase === 'go') {
      st.phase = 'done';
      const at = r.def.attack;
      const dmg = at.dmg * q.models; // damage scales with models still standing
      if (a.kind === 'swing') {
        const R = radiusOf(q) + at.reach;
        const struck = [];
        for (const e of living()) {
          if (e.owner === q.owner) continue;
          if (arcHits(st.ox, st.oz, st.dx, st.dz, R, at.cosHalf, e.x, e.z, radiusOf(e))) { hits.push({ src: q.id, dst: e, dmg, kind: 'swing' }); struck.push(e.id); }
        }
        ev({ type: 'release', id: q.id, kind: 'swing', hit: struck });
      } else {
        const bx = st.ox + st.dx * at.range, bz = st.oz + st.dz * at.range;
        let tCut = 1;
        for (const t of s.terrain) {
          if (!blocks(t)) continue;
          const tt = t.r !== undefined ? segCircle(st.ox, st.oz, bx, bz, t.x, t.z, t.r) : segRect(st.ox, st.oz, bx, bz, t, 0);
          if (tt >= 0 && tt < tCut) tCut = tt;
        }
        let best = null, bt = tCut;
        for (const e of living()) {
          if (e.owner === q.owner) continue;
          const tt = segCircle(st.ox, st.oz, bx, bz, e.x, e.z, radiusOf(e) + at.width / 2);
          if (tt >= 0 && tt < bt) { bt = tt; best = e; }
        }
        if (best) hits.push({ src: q.id, dst: best, dmg, kind: 'volley' });
        ev({ type: 'release', id: q.id, kind: 'volley', hit: best ? [best.id] : [], ex: r3(st.ox + (bx - st.ox) * bt), ez: r3(st.oz + (bz - st.oz) * bt), blocked: !best && tCut < 1 });
      }
    }
    if (r.el >= a.cost) { r.idx++; r.el = 0; r.st = null; }
  }

  function resolveMoves(moves) {
    const all = living();
    for (const m of moves) {
      const q = m.r.q, st = m.st;
      if (!st.pts.length) { st.phase = 'arrived'; continue; }
      let left = m.d, cx = q.x, cz = q.z;
      while (left > 1e-6 && st.pts.length) {
        const wp = st.pts[0], dd = dist(cx, cz, wp.x, wp.z);
        if (dd <= left) { cx = wp.x; cz = wp.z; left -= dd; st.pts.shift(); }
        else { cx += (wp.x - cx) / dd * left; cz += (wp.z - cz) / dd * left; left = 0; }
      }
      const rq = radiusOf(q);
      const clear = (x, z) => {
        if (pointBlocked(s.terrain, x, z, rq * 0.85)) return false;
        for (const o of all) if (o !== q && dist(x, z, o.x, o.z) < rq + radiusOf(o) - 0.02 && dist(x, z, o.x, o.z) < dist(q.x, q.z, o.x, o.z)) return false;
        return true;
      };
      let nx = cx, nz = cz;
      if (!clear(nx, nz)) {
        // slide sideways around whatever is in the way
        const vx = cx - q.x, vz = cz - q.z, vl = Math.sqrt(vx * vx + vz * vz) || 1;
        const opts = [[0.819152, 0.573576], [0.819152, -0.573576], [0.34202, 0.939693], [0.34202, -0.939693]];
        let ok = false;
        for (const [c, sn] of opts) {
          const tx = q.x + (vx * c - vz * sn), tz = q.z + (vx * sn + vz * c);
          if (clear(tx, tz)) { nx = tx; nz = tz; ok = true; break; }
        }
        if (!ok) { if (st.pts.length <= 1 && st.pts[0] && dist(q.x, q.z, st.pts[0].x, st.pts[0].z) < rq * 3) st.phase = 'arrived'; continue; }
        void vl;
      }
      rec(q, T);
      const d = norm(nx - q.x, nz - q.z);
      if (d.l > 1e-4) { q.fx = d.x; q.fz = d.z; }
      q.x = nx; q.z = nz;
      rec(q, T + 1);
      if (!st.pts.length) st.phase = 'arrived';
    }
  }

  // ---- tiers fastest -> slowest -------------------------------------------------------
  const maxTier = 6 + RULES.maxUpgrades;
  for (let tier = maxTier; tier >= RULES.minTier; tier--) {
    const group = rts.filter(r => !r.acted && r.q.hp > 0 && r.tier === tier);
    if (!group.length) continue;
    for (const r of group) r.acted = true;
    seg = { kind: 'tier', tier, len: 0, tracks: {}, events: [], squads: group.map(r => r.q.id) };
    T = 0;
    let guard = 0;
    while (guard++ < 400) {
      const act = group.filter(r => r.q.hp > 0 && r.idx < r.actions.length);
      if (!act.length) break;
      hits = [];
      const moves = [];
      for (const r of act) step(r, moves);
      resolveMoves(moves);
      const batch = hits; hits = [];
      applyHits(batch);
      checkDeaths();
      T += 1;
    }
    seg.len = T;
    log.segments.push(seg);
  }

  // ---- end of round ----------------------------------------------------------------
  seg = { kind: 'end', len: 0, tracks: {}, events: [] };
  s.squads = s.squads.filter(q => q.hp > 0);
  for (const q of s.squads) delete q.dead;
  const aliveBy = [0, 1].map(p => s.squads.some(q => q.owner === p));
  if (!aliveBy[0] && !aliveBy[1]) s.winner = -1;
  else if (!aliveBy[0]) s.winner = 1;
  else if (!aliveBy[1]) s.winner = 0;
  else if (round >= RULES.roundLimit) {
    const hp = [0, 1].map(p => s.squads.filter(q => q.owner === p).reduce((n, q) => n + q.hp, 0));
    s.winner = hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1;
  }
  log.segments.push(seg);
  s.round++;
  return { state: s, log };
}
