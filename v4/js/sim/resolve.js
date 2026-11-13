// V4 round resolution.
//  Both sides' orders are resolved together. Speed tiers act fastest -> slowest; inside a tier
//  every squad acts at once on a shared timeline where an action's AP cost is its duration.
//  Every attack is a non-targeted skillshot (Swing arc, Volley line, Lob circle, Charge lane,
//  Bone Blast circle). Its area is telegraphed for the whole wind-up and anything inside it
//  when it resolves is hit.
//  Tactics (M2): engagement (stepping away from an enemy melee squad costs AP and gives it a
//  parting blow), parry (negates the next melee hit and ripostes), overwatch (fires once at the
//  first enemy that moves in the front cone, in any tier), cover (forests halve volleys),
//  line of sight (walls and rocks stop volleys; lobs arc over), skill cooldowns.
// Produces the new state and a log used for scrubbable playback.
import { RULES, isMelee, isShooter, skillOf, cdOf } from '../data/units.js';
import { dist, norm, segRect, segCircle } from './geom.js';
import { clone, defOf, radiusOf, modelsFor, speedOf } from './state.js';
import { validateOrders, actionCost } from './orders.js';
import { buildStancePlan } from './stances.js';
import { terrainFactor, pointBlocked, blocks } from './nav.js';

const r3 = v => Math.round(v * 1000) / 1000;
const MELEE_HITS = ['swing', 'charge', 'parting'];

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

// Fraction (0..1) along a->b where blocking terrain (walls, rocks) first cuts the line, or 1.
export function losCut(terrain, ax, az, bx, bz) {
  let tCut = 1;
  for (const t of terrain) {
    if (!blocks(t)) continue;
    const tt = t.r !== undefined ? segCircle(ax, az, bx, bz, t.x, t.z, t.r) : segRect(ax, az, bx, bz, t, 0);
    if (tt >= 0 && tt < tCut) tCut = tt;
  }
  return tCut;
}
// Is the target in cover from a shot along a->b (the line crosses a forest, or it stands in one)?
export function inCover(terrain, ax, az, bx, bz) {
  for (const t of terrain) {
    if (t.kind !== 'forest') continue;
    if (dist(bx, bz, t.x, t.z) < t.r) return true;
    const tt = segCircle(ax, az, bx, bz, t.x, t.z, t.r);
    if (tt >= 0 && tt < 1) return true;
  }
  return false;
}
// Aim point clamped to a maximum range from (ox,oz)
export function clampAim(ox, oz, x, z, range) {
  const d = norm(x - ox, z - oz);
  if (d.l <= range) return { x, z };
  return { x: ox + d.x * range, z: oz + d.z * range };
}
// Enemy melee squads this squad is engaged with
export function engagedWith(q, squads) {
  if (defOf(q).ghost) return [];
  const out = [];
  for (const e of squads) {
    if (e.owner === q.owner || e.hp <= 0 || !isMelee(defOf(e))) continue;
    if (dist(q.x, q.z, e.x, e.z) <= radiusOf(q) + radiusOf(e) + RULES.engageGap) out.push(e);
  }
  return out;
}

export function resolveRound(state0, ordersIn) {
  const s = clone(state0);
  const round = s.round;
  const orders = [0, 1].map(p => validateOrders(s, p, ordersIn[p]));
  const log = { round, segments: [] };

  for (const p of [0, 1]) for (const [id, st] of Object.entries(orders[p].stances)) {
    const q = s.squads.find(x => x.id === id); if (q) q.stance = st;
  }
  // planning-time knowledge (everything visible until fog arrives in M3)
  const snapshot = s.squads.filter(q => q.hp > 0).map(q => ({ ...q }));

  const rts = [];
  for (const q of s.squads) {
    if (q.hp <= 0) continue;
    const def = defOf(q);
    const direct = orders[q.owner].squads[q.id];
    const plan = direct || buildStancePlan(s, q, snapshot.filter(e => e.owner !== q.owner), snapshot);
    rts.push({
      q, def, plan, direct: !!direct,
      actions: plan.actions.map(a => ({ ...a, cost: actionCost(q, a) })),
      tier: Math.max(RULES.minTier, def.tier + (plan.upgrades || 0)),
      idx: 0, el: 0, st: null,
      defends: def.defends + (plan.defends || 0),
      parry: !!plan.parry,
      watch: plan.overwatch ? { active: true } : null,
      mult: 1,
      parted: new Set(),           // enemies that already got a parting blow on this squad
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
  const atkDmg = (r, base) => base * r.q.models * r.mult;

  // ---- start: reveal tiers and what each squad prepared --------------------------
  seg = { kind: 'start', len: 0, tracks: {}, events: [] };
  for (const r of rts) {
    if (r.plan.overwatch) {
      const d = norm(r.plan.overwatch.x - r.q.x, r.plan.overwatch.z - r.q.z);
      if (d.l > 0.01) { r.q.fx = d.x; r.q.fz = d.z; rec(r.q, 0); }
    }
    ev({ type: 'prep', id: r.q.id, tier: r.tier, upgrades: r.plan.upgrades || 0, defends: r.defends, parry: r.parry, watch: !!r.watch, stance: r.direct ? null : r.q.stance });
    if (r.watch) ev({ type: 'watch', id: r.q.id, R: r.def.attack.range, ch: RULES.overwatchCos });
    // shield walls are braced from the start of the round (the AP is spent holding it)
    const wl = r.actions.find(x => x.kind === 'wall');
    if (wl) { r.wall = skillOf(r.def, 'wall'); ev({ type: 'wallOn', id: r.q.id, mult: r.wall.mult, ch: r.wall.cosHalf, R: r3(radiusOf(r.q) + 0.5) }); }
  }
  log.segments.push(seg);

  // ---- hits ---------------------------------------------------------------------
  let hits = [];
  function hitOne(h) {
    const q = h.dst, r = rtById.get(q.id);
    if (q.hp <= 0) return;
    if (r && r.parry && MELEE_HITS.includes(h.kind)) {
      r.parry = false;
      ev({ type: 'parry', id: q.id, src: h.src });
      const src = rtById.get(h.src);
      if (src && src.q.hp > 0) hitOne({ src: q.id, dst: src.q, dmg: atkDmg(r, r.def.attack.dmg) * RULES.riposteMult, kind: 'riposte' });
      return;
    }
    // locked shields: hits from the front arc are blunted
    let walled = false;
    if (r && r.wall) {
      const src = rtById.get(h.src)?.q;
      if (src) { const d = norm(src.x - q.x, src.z - q.z); if (d.l > 1e-4 && d.x * q.fx + d.z * q.fz >= r.wall.cosHalf) walled = true; }
    }
    let defended = false;
    if (r && r.defends > 0) { r.defends--; defended = true; }
    const dmg = damageAfter(h.dmg * (h.cover ? RULES.coverMult : 1) * (walled ? r.wall.mult : 1), defOf(q).armor, defended);
    const before = q.models;
    q.hp = Math.max(0, q.hp - dmg);
    q.models = modelsFor(q, q.hp);
    ev({ type: 'hit', src: h.src, dst: q.id, dmg, raw: Math.round(h.dmg), defended, cover: !!h.cover, walled, kind: h.kind, hp: q.hp, models: q.models, lost: before - q.models, defLeft: r ? r.defends : 0 });
  }
  function applyHits(batch) {
    const byDst = new Map();
    for (const h of batch) { if (!byDst.has(h.dst.id)) byDst.set(h.dst.id, []); byDst.get(h.dst.id).push(h); }
    for (const [, list] of byDst) {
      list.sort((a, b) => b.dmg - a.dmg); // strongest hit uses the defend / parry first
      for (const h of list) hitOne(h);
    }
  }
  function checkDeaths() {
    for (const q of s.squads) if (q.hp <= 0 && !q.dead) {
      q.dead = true;
      ev({ type: 'down', id: q.id });
      const r = rtById.get(q.id); if (r) { r.idx = r.actions.length; r.watch = null; }
    }
  }

  // ---- shooting helpers ---------------------------------------------------------
  // a volley line from (ox,oz) along d: first enemy on the line before a wall
  function volley(r, ox, oz, dx, dz, overwatch = false) {
    const q = r.q, at = r.def.attack;
    const bx = ox + dx * at.range, bz = oz + dz * at.range;
    const tCut = losCut(s.terrain, ox, oz, bx, bz);
    let best = null, bt = tCut;
    for (const e of living()) {
      if (e.owner === q.owner) continue;
      const tt = segCircle(ox, oz, bx, bz, e.x, e.z, radiusOf(e) + at.width / 2);
      if (tt >= 0 && tt < bt) { bt = tt; best = e; }
    }
    const ex = ox + (bx - ox) * bt, ez = oz + (bz - oz) * bt;
    const cover = best ? inCover(s.terrain, ox, oz, best.x, best.z) : false;
    if (best) hits.push({ src: q.id, dst: best, dmg: atkDmg(r, at.dmg), kind: 'volley', cover });
    ev({ type: 'release', id: q.id, kind: 'volley', hit: best ? [best.id] : [], ex: r3(ex), ez: r3(ez), blocked: !best && tCut < 1, cover, overwatch });
  }
  // a lobbed circle (or bone blast) at (cx,cz): everyone inside, walls don't matter
  function circleHit(r, kind, cx, cz, R, dmg, overwatch = false) {
    const q = r.q, struck = [];
    for (const e of living()) {
      if (e.owner === q.owner) continue;
      if (dist(cx, cz, e.x, e.z) <= R + radiusOf(e) * 0.6) { hits.push({ src: q.id, dst: e, dmg, kind }); struck.push(e.id); }
    }
    ev({ type: 'release', id: q.id, kind, hit: struck, ex: r3(cx), ez: r3(cz), overwatch });
  }

  // put a jumping/teleporting squad down on the nearest free spot back along its line
  function land(q, ox, oz) {
    const rq = radiusOf(q);
    const free = (x, z) => !pointBlocked(s.terrain, x, z, rq * 0.85) && !living().some(o => o !== q && dist(x, z, o.x, o.z) < rq + radiusOf(o) - 0.05);
    if (free(q.x, q.z)) return;
    const d = norm(ox - q.x, oz - q.z);
    for (let k = 1; k <= 40; k++) {
      const t = k * 0.25;
      if (t > d.l) break;
      const x = q.x + d.x * t, z = q.z + d.z * t;
      if (free(x, z)) { q.x = x; q.z = z; return; }
    }
    q.x = ox; q.z = oz;
  }
  // a piercing bolt: every enemy on the line before a wall
  function pierce(r, ox, oz, dx, dz, sk) {
    const q = r.q;
    const bx = ox + dx * sk.range, bz = oz + dz * sk.range;
    const tCut = losCut(s.terrain, ox, oz, bx, bz), struck = [];
    for (const e of living()) {
      if (e.owner === q.owner) continue;
      const tt = segCircle(ox, oz, bx, bz, e.x, e.z, radiusOf(e) + sk.width / 2);
      if (tt >= 0 && tt < tCut) { hits.push({ src: q.id, dst: e, dmg: atkDmg(r, sk.dmg), kind: 'pierce', cover: inCover(s.terrain, ox, oz, e.x, e.z) }); struck.push(e.id); }
    }
    ev({ type: 'release', id: q.id, kind: 'pierce', hit: struck, ex: r3(ox + (bx - ox) * tCut), ez: r3(oz + (bz - oz) * tCut), blocked: !struck.length && tCut < 1 });
  }

  // ---- one AP of an action ---------------------------------------------------------
  function step(r, moves, moved) {
    const q = r.q, a = r.actions[r.idx];
    const def = r.def;
    if (r.el === 0) {
      r.st = { phase: 'go' };
      if (a.kind === 'move') r.st.pts = a.pts.map(p => ({ ...p }));
      const sk = skillOf(def, a.kind);
      if (sk) q.cd = { ...(q.cd || {}), [a.kind]: sk.cd + 1 };
      r.st.sk = sk;
      const tele = (kind, extra) => ev({ type: 'tele', id: q.id, kind, ox: r3(q.x), oz: r3(q.z), dx: r3(q.fx), dz: r3(q.fz), t1: r3(T + a.cost), ...extra });
      const face = (x, z) => { const d = norm(x - q.x, z - q.z); if (d.l > 0.01) { q.fx = d.x; q.fz = d.z; } };
      if (a.kind === 'swing' || a.kind === 'volley' || a.kind === 'charge' || a.kind === 'pierce') {
        face(a.x, a.z);
        r.st.dx = q.fx; r.st.dz = q.fz; r.st.ox = q.x; r.st.oz = q.z;
        rec(q, T);
        const at = def.attack;
        if (a.kind === 'swing') tele('swing', { shape: 'arc', R: r3(radiusOf(q) + at.reach), ch: at.cosHalf });
        else if (a.kind === 'volley') tele('volley', { shape: 'line', len: at.range, w: at.width });
        else if (a.kind === 'pierce') tele('pierce', { shape: 'line', len: sk.range, w: sk.width });
        else {
          r.st.phase = 'wind'; r.st.travel = 0;
          tele('charge', { t1: r3(T + sk.wind), shape: 'line', len: sk.len, w: r3(radiusOf(q) * 2) });
        }
      }
      if (a.kind === 'lob' || a.kind === 'blast' || a.kind === 'storm' || a.kind === 'leap' || a.kind === 'step') {
        const range = a.kind === 'lob' ? def.attack.range : sk.range;
        const R = a.kind === 'lob' ? def.attack.radius : sk.radius || radiusOf(q) + 0.4;
        const c = clampAim(q.x, q.z, a.x, a.z, range);
        face(c.x, c.z); rec(q, T);
        r.st.cx = c.x; r.st.cz = c.z; r.st.ox = q.x; r.st.oz = q.z;
        const t1 = a.kind === 'leap' ? T + sk.flight : T + a.cost;
        ev({ type: 'tele', id: q.id, kind: a.kind, ox: r3(c.x), oz: r3(c.z), dx: r3(q.fx), dz: r3(q.fz), t1: r3(t1), shape: 'circle', R: r3(R) });
      }
      if (a.kind === 'rally' || a.kind === 'raise') tele(a.kind, { shape: 'circle', R: sk.radius });
      if (a.kind === 'sweep') tele('sweep', { shape: 'arc', R: r3(radiusOf(q) + sk.reach), ch: -1 });
      ev({ type: 'act', id: q.id, kind: a.kind, cost: a.cost });
    }
    r.el += 1;
    const st = r.st;
    if (a.kind === 'move' && st.phase === 'go') {
      // stepping away from an engaged enemy: stand and disengage first, taking parting blows
      if (!st.checked) {
        st.checked = true;
        const wp = st.pts[0];
        if (wp) {
          const dir = norm(wp.x - q.x, wp.z - q.z);
          const away = engagedWith(q, living()).filter(e => (e.x - q.x) * dir.x + (e.z - q.z) * dir.z < 0);
          if (away.length) {
            st.hold = RULES.disengageAP;
            ev({ type: 'disengage', id: q.id });
            for (const e of away) {
              if (r.parted.has(e.id)) continue;
              r.parted.add(e.id);
              const er = rtById.get(e.id);
              hits.push({ src: e.id, dst: q, dmg: defOf(e).attack.dmg * e.models * (er ? er.mult : 1) * RULES.partingMult, kind: 'parting' });
            }
          }
        }
      }
      if (st.hold > 0) st.hold--;
      else moves.push({ r, st, d: speedOf(q) * terrainFactor(s.terrain, q.x, q.z) });
    } else if (a.kind === 'charge') {
      if (st.phase === 'wind' && r.el >= st.sk.wind) st.phase = 'rush';
      else if (st.phase === 'rush') {
        const sk = st.sk, rq = radiusOf(q);
        const step = Math.min(speedOf(q) * 4.6 * terrainFactor(s.terrain, q.x, q.z), sk.len - st.travel);
        const nx = q.x + st.dx * step, nz = q.z + st.dz * step;
        // first enemy squad in the way takes the impact
        let hit = null, ht = 2;
        for (const e of living()) {
          if (e.owner === q.owner) continue;
          const tt = segCircle(q.x, q.z, nx, nz, e.x, e.z, rq + radiusOf(e));
          if (tt >= 0 && tt < ht) { ht = tt; hit = e; }
        }
        // riders and wraiths weave through their own lines; only walls, rocks and the edge stop them
        const bump = (x, z) => pointBlocked(s.terrain, x, z, rq * 0.85);
        // when the charge ends on top of a friend, step aside to the nearest free spot
        const settle = () => {
          for (const o of living()) {
            if (o === q || o.owner !== q.owner) continue;
            const need = rq + radiusOf(o), d = dist(q.x, q.z, o.x, o.z);
            if (d >= need - 0.02) continue;
            const v = d > 1e-4 ? norm(q.x - o.x, q.z - o.z) : { x: -st.dz, z: st.dx };
            const tx = o.x + v.x * need, tz = o.z + v.z * need;
            if (!pointBlocked(s.terrain, tx, tz, rq * 0.85)) { q.x = tx; q.z = tz; }
          }
        };
        rec(q, T);
        if (hit) {
          const t = Math.max(0, ht - 0.01);
          q.x += (nx - q.x) * t; q.z += (nz - q.z) * t;
          hits.push({ src: q.id, dst: hit, dmg: atkDmg(r, sk.dmg), kind: 'charge' });
          settle();
          ev({ type: 'release', id: q.id, kind: 'charge', hit: [hit.id], ex: r3(q.x), ez: r3(q.z) });
          st.phase = 'done';
        } else if (bump(nx, nz)) {
          ev({ type: 'release', id: q.id, kind: 'charge', hit: [], ex: r3(q.x), ez: r3(q.z), blocked: true });
          st.phase = 'done';
        } else {
          q.x = nx; q.z = nz; st.travel += step;
          if (st.travel >= sk.len - 1e-6) { settle(); ev({ type: 'release', id: q.id, kind: 'charge', hit: [], ex: r3(q.x), ez: r3(q.z) }); st.phase = 'done'; }
        }
        moved.add(q.id);
        rec(q, T + 1);
        if (st.phase === 'rush' && r.el >= a.cost) { settle(); ev({ type: 'release', id: q.id, kind: 'charge', hit: [], ex: r3(q.x), ez: r3(q.z) }); st.phase = 'done'; }
      }
    } else if (a.kind === 'leap') {
      // a jump over everything: fly for `flight` AP, land, shove adjacent enemies back
      const sk = st.sk;
      if (st.phase === 'go') {
        const t = Math.min(1, r.el / sk.flight);
        rec(q, T);
        q.x = st.ox + (st.cx - st.ox) * t; q.z = st.oz + (st.cz - st.oz) * t;
        rec(q, T + 1); moved.add(q.id);
        if (t >= 1) {
          land(q, st.ox, st.oz);
          const pushed = [];
          for (const e of living()) {
            if (e.owner === q.owner) continue;
            const d = dist(q.x, q.z, e.x, e.z), need = radiusOf(q) + radiusOf(e) + 0.3;
            if (d >= need) continue;
            const v = d > 1e-4 ? norm(e.x - q.x, e.z - q.z) : { x: q.fx, z: q.fz };
            const tx = e.x + v.x * sk.shove, tz = e.z + v.z * sk.shove;
            if (!pointBlocked(s.terrain, tx, tz, radiusOf(e) * 0.85)) { rec(e, T); e.x = tx; e.z = tz; rec(e, T + 1); pushed.push(e.id); moved.add(e.id); }
          }
          ev({ type: 'land', id: q.id, kind: 'leap', ex: r3(q.x), ez: r3(q.z), pushed });
          st.phase = 'done';
        }
      }
    } else if (r.el >= a.cost && st.phase === 'go') {
      st.phase = 'done';
      const at = def.attack, sk = st.sk;
      if (a.kind === 'swing') {
        const R = radiusOf(q) + at.reach;
        const struck = [];
        for (const e of living()) {
          if (e.owner === q.owner) continue;
          if (arcHits(st.ox, st.oz, st.dx, st.dz, R, at.cosHalf, e.x, e.z, radiusOf(e))) { hits.push({ src: q.id, dst: e, dmg: atkDmg(r, at.dmg), kind: 'swing' }); struck.push(e.id); }
        }
        ev({ type: 'release', id: q.id, kind: 'swing', hit: struck });
      } else if (a.kind === 'volley') volley(r, st.ox, st.oz, st.dx, st.dz);
      else if (a.kind === 'lob') circleHit(r, 'lob', st.cx, st.cz, at.radius, atkDmg(r, at.dmg));
      else if (a.kind === 'blast' || a.kind === 'storm') circleHit(r, a.kind, st.cx, st.cz, sk.radius, atkDmg(r, sk.dmg));
      else if (a.kind === 'pierce') pierce(r, st.ox, st.oz, st.dx, st.dz, sk);
      else if (a.kind === 'sweep') {
        const R = radiusOf(q) + sk.reach, struck = [];
        for (const e of living()) {
          if (e.owner === q.owner) continue;
          if (dist(q.x, q.z, e.x, e.z) <= R + radiusOf(e)) { hits.push({ src: q.id, dst: e, dmg: atkDmg(r, sk.dmg), kind: 'sweep' }); struck.push(e.id); }
        }
        ev({ type: 'release', id: q.id, kind: 'sweep', hit: struck });
      } else if (a.kind === 'step') {
        // vanish and reappear: no parting blows
        rec(q, T);
        q.x = st.cx; q.z = st.cz; land(q, st.ox, st.oz);
        rec(q, T + 0.001); moved.add(q.id);
        ev({ type: 'land', id: q.id, kind: 'step', ex: r3(q.x), ez: r3(q.z), pushed: [] });
      } else if (a.kind === 'raise') {
        const ids = [];
        for (const o of living()) {
          if (o.owner !== q.owner) continue;
          const od = defOf(o);
          if (od.models <= 1 || o.models >= od.models) continue;
          if (dist(q.x, q.z, o.x, o.z) > sk.radius + radiusOf(o)) continue;
          o.hp = Math.min(od.models * od.hpPer, o.models * od.hpPer + od.hpPer);
          o.models = modelsFor(o, o.hp);
          ids.push(o.id);
        }
        ev({ type: 'raise', id: q.id, ids, hp: ids.map(id => living().find(o => o.id === id).hp), models: ids.map(id => living().find(o => o.id === id).models) });
      }
      else if (a.kind === 'rally') {
        const ids = [];
        for (const o of rts) {
          if (o.q.owner !== q.owner || o.q.hp <= 0) continue;
          if (dist(q.x, q.z, o.q.x, o.q.z) <= sk.radius + radiusOf(o.q)) { o.defends += sk.defends; o.mult = Math.max(o.mult, sk.dmgMult); ids.push(o.q.id); }
        }
        ev({ type: 'buff', id: q.id, kind: 'rally', ids });
      }
    }
    if (r.el >= a.cost) { r.idx++; r.el = 0; r.st = null; }
  }

  function resolveMoves(moves, moved) {
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
      const ethereal = !!defOf(q).ghost;
      const clear = (x, z) => {
        if (pointBlocked(s.terrain, x, z, rq * 0.85)) return false;
        if (ethereal) return true;          // wraiths drift through squads
        for (const o of all) if (o !== q && dist(x, z, o.x, o.z) < rq + radiusOf(o) - 0.02 && dist(x, z, o.x, o.z) < dist(q.x, q.z, o.x, o.z)) return false;
        return true;
      };
      let nx = cx, nz = cz;
      if (!clear(nx, nz)) {
        // slide sideways around whatever is in the way
        const vx = cx - q.x, vz = cz - q.z;
        const opts = [[0.819152, 0.573576], [0.819152, -0.573576], [0.34202, 0.939693], [0.34202, -0.939693]];
        let ok = false;
        for (const [c, sn] of opts) {
          const tx = q.x + (vx * c - vz * sn), tz = q.z + (vx * sn + vz * c);
          if (clear(tx, tz)) { nx = tx; nz = tz; ok = true; break; }
        }
        if (!ok) { if (st.pts.length <= 1 && st.pts[0] && dist(q.x, q.z, st.pts[0].x, st.pts[0].z) < rq * 3) st.phase = 'arrived'; continue; }
      }
      rec(q, T);
      const d = norm(nx - q.x, nz - q.z);
      if (d.l > 1e-4) { q.fx = d.x; q.fz = d.z; moved.add(q.id); }
      q.x = nx; q.z = nz;
      rec(q, T + 1);
      if (!st.pts.length) st.phase = 'arrived';
    }
  }

  // overwatch: any watcher fires once at the first enemy that moved inside its front cone
  function overwatch(moved) {
    if (!moved.size) return;
    for (const r of rts) {
      if (!r.watch || !r.watch.active || r.q.hp <= 0) continue;
      const q = r.q, at = r.def.attack;
      let best = null, bd = 1e9;
      for (const id of moved) {
        const e = rtById.get(id)?.q;
        if (!e || e.owner === q.owner || e.hp <= 0) continue;
        const d = dist(q.x, q.z, e.x, e.z);
        if (d - radiusOf(e) > at.range || d < 1e-6) continue;
        if (((e.x - q.x) * q.fx + (e.z - q.z) * q.fz) / d < RULES.overwatchCos) continue;
        if (at.kind === 'volley' && losCut(s.terrain, q.x, q.z, e.x, e.z) < 1) continue;
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) continue;
      r.watch.active = false;
      ev({ type: 'watchEnd', id: q.id });
      if (at.kind === 'volley') { const d = norm(best.x - q.x, best.z - q.z); volley(r, q.x, q.z, d.x, d.z, true); }
      else circleHit(r, 'lob', best.x, best.z, at.radius, atkDmg(r, at.dmg), true);
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
      const moves = [], moved = new Set();
      for (const r of act) step(r, moves, moved);
      resolveMoves(moves, moved);
      overwatch(moved);
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
  for (const q of s.squads) {
    delete q.dead;
    const cd = {};
    for (const [k, v] of Object.entries(q.cd || {})) if (v > 1) cd[k] = v - 1;
    q.cd = cd;
  }
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
export { isShooter };
