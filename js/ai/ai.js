// V4 AI (M1): advances as a battle line, directly controls its hero and the 3 squads
// closest to the enemy, and aims a little ahead of enemies that moved last round.
import { RULES, isMelee, isShooter, skillOf, cdOf } from '../data/units.js';
import { losCut, engagedWith } from '../sim/resolve.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { nearestEnemy, meleePlan, trimPath } from '../sim/stances.js';
import { obstacles, navKey, placeError, bonusCp, armySize, armyValue, BUILDINGS, trainCost, footprint, nearestFreeSite, builderCount, trainsRole, edgeDist, bdef } from '../sim/base.js';
import { builderPlan } from '../sim/builders.js';
import { Nav } from '../sim/nav.js';
import { dist } from '../sim/geom.js';
import { visibleTo, knownEnemyHq, observers, canSee } from '../sim/vision.js';
import { HQ_X, mirrorOn } from '../data/maps.js';

// memory (per side, updated in place): seen = last-seen enemy squads, prev = positions seen last round
// opts.level: 'easy' (one less command point, no aiming ahead) | 'normal' | 'hard' (one more command point)
export function aiOrders(s, p, memory = aiMemory(), opts = {}) {
  const level = opts.level || 'normal';
  const o = emptyOrders();
  memory.seen = memory.seen || {}; memory.prev = memory.prev || {};
  const mine = s.squads.filter(q => q.owner === p && q.hp > 0 && q.role !== 'builder');
  // fog: the AI only knows what its side sees, plus where it last saw the others (up to 3 rounds)
  const vis = visibleTo(s, p);
  const alive = new Set(s.squads.map(q => q.id));
  for (const e of s.squads) if (vis.has(e.id)) memory.seen[e.id] = { ...e, round: s.round };
  for (const id of Object.keys(memory.seen)) if (!alive.has(id) || s.round - memory.seen[id].round > 3) delete memory.seen[id];
  let enemies = Object.values(memory.seen).map(e => vis.has(e.id) ? s.squads.find(q => q.id === e.id) : e);
  // the enemy HQ is only known once scouted (fog intel); until then scout its possible spots
  const hqE = knownEnemyHq(s, p);
  const hqTarget = hqE ? { id: hqE.id, owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: hqE.x, z: hqE.z, fx: 1, fz: 0, models: 4, hp: hqE.hp, cd: {}, isHq: true } : null;
  memory.cleared = memory.cleared || {};
  const mirror = mirrorOn(s.board.w, s.board.h);
  const spots = s.hqSpots.map(z => p === 0 ? mirror({ x: HQ_X, z }) : { x: HQ_X, z });
  const obsv = observers(s, p);
  for (const sp of spots) if (obsv.some(o => canSee(s.terrain, o.x, o.z, o.range, sp.x, sp.z))) memory.cleared[sp.x + ',' + sp.z] = true;
  const scoutSpot = q => spots.filter(sp => !memory.cleared[sp.x + ',' + sp.z]).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0] || null;
  if (!enemies.length) {
    if (hqTarget) enemies = [hqTarget];
    else {
      const sp = scoutSpot({ x: s.board.w / 2, z: s.board.h / 2 }) || spots[1];
      enemies = [{ id: '?', owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: sp.x, z: sp.z, fx: 1, fz: 0, models: 4, hp: 80, cd: {} }];
    }
  } else if (hqTarget) enemies.push(hqTarget);
  if (s.buildings) Object.assign(o, economy(s, p, enemies.filter(e => !e.isHq), o));
  for (const q of mine) if (q.stance !== 'advance') o.stances[q.id] = 'advance';
  // lead targets by their last movement (only for squads seen both rounds)
  const prev = memory.prev;
  memory.prev = {};
  for (const e of s.squads) if (vis.has(e.id)) memory.prev[e.id] = { x: e.x, z: e.z };
  const lead = e => {
    if (level === 'easy') return null;
    const m = prev[e.id];
    if (!m || !vis.has(e.id)) return null;
    const vx = (e.x - m.x) * 0.5, vz = (e.z - m.z) * 0.5;
    return { x: vx, z: vz };
  };
  const ranked = mine.slice().sort((a, b) => {
    const da = Math.min(...enemies.map(e => dist(a.x, a.z, e.x, e.z)));
    const db = Math.min(...enemies.map(e => dist(b.x, b.z, e.x, e.z)));
    return (a.role === 'hero' ? -1e9 : da) - (b.role === 'hero' ? -1e9 : db);
  });
  let cp = RULES.cp + bonusCp(s, p) + (level === 'easy' ? -1 : level === 'hard' ? 1 : 0);
  const myVal = mine.reduce((n, q) => n + q.hp, 0), theirVal = enemies.filter(e => !e.isHq).reduce((n, e) => n + (e.hp || 0), 0);
  const assault = s.round >= 6 && (myVal >= theirVal * 1.15 || s.round >= 12);
  for (const q of ranked) {
    if (q.role !== 'hero') { if (cp <= 0) break; cp--; }
    const def = defOf(q);
    const plan = emptyPlan();
    let left = apFor(q);
    // squads go for the HQ only when it is the closest thing (or nothing else is known)
    const squadsOnly = enemies.filter(e => !e.isHq);
    let t = nearestEnemy(s, q, enemies);
    if (t.isHq && squadsOnly.length && dist(q.x, q.z, t.x, t.z) > 9) t = nearestEnemy(s, q, squadsOnly);
    // assault: when clearly ahead (or the game drags on) ordered squads go for the HQ unless engaged
    if (assault && hqTarget && !engagedWith(q, squadsOnly).length) t = hqTarget;
    // rich and stalled (a long front, army at its cap): all in, past the fighting, for the HQ
    const allIn = s.round >= 15 && s.supply[p] >= 150;
    if (allIn && hqTarget && !engagedWith(q, squadsOnly).length) t = hqTarget;
    // the enemy HQ still unknown after a while: ordered squads go looking for it
    if (!hqTarget && s.round >= 8 && !engagedWith(q, squadsOnly).length && (allIn || !squadsOnly.some(e => dist(e.x, e.z, q.x, q.z) < 8))) {
      const sp = scoutSpot(q);
      if (sp) t = { id: '?', owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: sp.x, z: sp.z, fx: 1, fz: 0, models: 4, hp: 80, cd: {} };
    }
    // fast squads without a fight nearby scout for the enemy HQ, then raid enemy mines / wells
    const raid = () => {
      if (!hqTarget) return scoutSpot(q);
      const k = Object.values(s.intel?.[p]?.known || {}).filter(b => BUILDINGS[b.type].site).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0];
      return k && dist(q.x, q.z, k.x, k.z) > 3 ? k : null;
    };
    if (q.role === 'fast' && !engagedWith(q, squadsOnly).length && (!hqTarget || !squadsOnly.some(e => dist(e.x, e.z, q.x, q.z) < 8)) && raid()) {
      const sh = raid();
      if (sh && dist(q.x, q.z, sh.x, sh.z) > 1.5) {
        const nav = Nav.for(obstacles(s), radiusOf(q), navKey(s));
        const pts = nav.path(q.x, q.z, sh.x, sh.z);
        if (pts.length) { const plan = emptyPlan(); plan.actions.push({ kind: 'move', pts, ap: apFor(q) }); o.squads[q.id] = plan; continue; }
      }
    }
    const L = lead(t);
    const tx = t.x + (L ? L.x : 0), tz = t.z + (L ? L.z : 0);
    const gap = dist(q.x, q.z, t.x, t.z) - radiusOf(t) - radiusOf(q);
    const ready = kind => { const k = skillOf(def, kind); return k && cdOf(q, kind) === 0 ? k : null; };
    const engaged = engagedWith(q, enemies);
    // already locked in melee: prepare a parry
    if (def.parry && engaged.length) { plan.parry = true; left -= RULES.parryCost; }
    let sk;
    // shield wall when shooters or a melee squad face us
    if ((sk = ready('wall')) && (engaged.length || enemies.some(e => isShooter(defOf(e)) && dist(e.x, e.z, q.x, q.z) < defOf(e).attack.range + 2))) { plan.actions.push({ kind: 'wall', x: q.x, z: q.z }); left -= sk.ap; }
    // necromancer: step out of a losing melee
    if ((sk = ready('step')) && engaged.length && q.hp < defOf(q).hpPer * 0.5) {
      const home = p === 0 ? -1 : 1;
      plan.actions.push({ kind: 'step', x: q.x + home * sk.range, z: q.z }); left -= sk.ap;
    }
    // raise fallen skeletons nearby
    if ((sk = ready('raise')) && mine.filter(o => defOf(o).models > 1 && o.models < defOf(o).models && dist(o.x, o.z, q.x, q.z) <= sk.radius + radiusOf(o)).length >= 1) { plan.actions.push({ kind: 'raise', x: q.x, z: q.z }); left -= sk.ap; }
    // hero rally when friends are close
    if ((sk = ready('rally')) && mine.filter(o => o !== q && dist(o.x, o.z, q.x, q.z) <= sk.radius + radiusOf(o)).length >= 2) { plan.actions.push({ kind: 'rally', x: q.x, z: q.z }); left -= sk.ap; }
    // lord: leap into a target just out of reach, then sweep or swing
    if ((sk = ready('leap')) && !engaged.length && gap > 1 && gap < sk.range) {
      const d = Math.max(0.1, gap - 0.4), l = dist(q.x, q.z, t.x, t.z);
      plan.actions.push({ kind: 'leap', x: q.x + (t.x - q.x) / l * d, z: q.z + (t.z - q.z) / l * d }); left -= sk.ap;
    }
    if ((sk = ready('sweep')) && enemies.filter(e => dist(e.x, e.z, q.x, q.z) <= radiusOf(q) + sk.reach + radiusOf(e)).length >= 2) { plan.actions.push({ kind: 'sweep', x: q.x, z: q.z }); left -= sk.ap; }
    // archers: Arrow Storm when two squads fit under it, or the target hides behind a wall
    if ((sk = ready('storm')) && dist(q.x, q.z, tx, tz) <= sk.range + 1) {
      const packed = enemies.filter(e => dist(e.x, e.z, tx, tz) <= sk.radius + radiusOf(e) * 0.6).length;
      if (packed >= 2 || losCut(s.terrain, q.x, q.z, t.x, t.z) < 1) { plan.actions.push({ kind: 'storm', x: tx, z: tz }); left -= sk.ap; }
    }
    // crossbows: piercing bolt at the target in range with a clear line
    if ((sk = ready('pierce')) && dist(q.x, q.z, tx, tz) - radiusOf(t) <= sk.range && losCut(s.terrain, q.x, q.z, t.x, t.z) >= 1) { plan.actions.push({ kind: 'pierce', x: tx, z: tz }); left -= sk.ap; }
    // necromancer: blast the nearest enemy when it is in range
    if ((sk = ready('blast')) && dist(q.x, q.z, tx, tz) <= sk.range + 1) { plan.actions.push({ kind: 'blast', x: tx, z: tz }); left -= sk.ap; }
    // cavalry / wraiths: charge down a clear lane
    // charge targets: slower enemies (they still stand there when we act), in a clear lane
    sk = ready('charge');
    const ct = sk && !engaged.length ? enemies.filter(e => {
      const g = dist(q.x, q.z, e.x, e.z) - radiusOf(e) - radiusOf(q);
      return defOf(e).tier < def.tier && g > 0.5 && g < sk.len - 1 && losCut(s.terrain, q.x, q.z, e.x, e.z) >= 1;
    }).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0] : null;
    if (ct) {
      plan.actions.push({ kind: 'charge', x: ct.x, z: ct.z }); left -= sk.ap;
      while (left >= def.attack.ap) { plan.actions.push({ kind: 'swing', x: ct.x, z: ct.z }); left -= def.attack.ap; }
    } else if (def.attack.kind === 'volley' || def.attack.kind === 'lob') {
      const rgap = dist(q.x, q.z, t.x, t.z) - radiusOf(t);
      const blocked = def.attack.kind === 'volley' && losCut(s.terrain, q.x, q.z, t.x, t.z) < 1;
      if (rgap > def.attack.range * 0.9 || blocked) {
        const nav = Nav.for(obstacles(s), radiusOf(q), navKey(s));
        const pts = trimPath(q.x, q.z, nav.path(q.x, q.z, t.x, t.z), def.attack.range * (blocked ? 0.45 : 0.75));
        const ap = Math.min(left, 45);
        if (pts.length) { plan.actions.push({ kind: 'move', pts, ap }); left -= ap; }
        if (left >= RULES.overwatchCost) { plan.overwatch = { x: t.x, z: t.z }; left -= RULES.overwatchCost; }
      } else {
        while (left >= def.attack.ap) { plan.actions.push({ kind: def.attack.kind, x: tx, z: tz }); left -= def.attack.ap; }
      }
    } else {
      left = meleePlan(s, q, t, plan, left, L);
    }
    if (left >= RULES.defendCost) plan.defends = Math.min(RULES.maxDefends, Math.floor(left / RULES.defendCost));
    o.squads[q.id] = plan;
  }
  return o;
}

export function aiMemory() { return { seen: {}, prev: {} }; }

// ---- economy: builders put up a per-faction build order; keep training ----------------
function economy(s, p, known, orders) {
  const out = { builds: [], trains: [] };
  let supply = s.supply[p];
  const fac = s.players[p].faction, gold = fac === 'kingdom';
  const mine = s.buildings.filter(b => b.owner === p);
  const hq = mine.find(b => b.type === 'hq');
  if (!hq) return out;
  const fwd = p === 0 ? 1 : -1;
  const queued = [];
  const builders = s.squads.filter(q => q.owner === p && q.hp > 0 && q.role === 'builder');
  const count = t => mine.filter(b => b.type === t).length + queued.filter(b => b.type === t).length;
  const busy = new Set();
  // 1. unfinished sites / damaged buildings first: send the nearest free builder
  // (builders with no orders keep at their task, finish nearby sites, or gather on their own)
  const tasked = id => builders.some(q => q.task && q.task.bid === id && q.task.kind !== 'gather');
  for (const b of mine.filter(b => (b.build > 0 || b.hp < bdef(b).hp * 0.7) && !tasked(b.id)).sort((a, b) => a.build ? -1 : 1)) {
    const q = builders.filter(x => !busy.has(x.id)).sort((a, c) => dist(a.x, a.z, b.x, b.z) - dist(c.x, c.z, b.x, b.z))[0];
    if (!q) break;
    const bp = builderPlan(s, q, b, apFor(q));
    if (!bp.actions.length) continue;
    const plan = emptyPlan(); plan.actions = bp.actions; orders.squads[q.id] = plan; busy.add(q.id);
  }
  const place = (type, prefer) => {
    const free = builders.filter(x => !busy.has(x.id));
    // once there is a barracks, keep enough back to train a squad (except for its own site)
    const reserve = count('barracks') && mine.some(b => b.type === 'barracks' && !b.build) && type !== 'barracks' ? 24 : 0;
    if (!free.length || supply - reserve < BUILDINGS[type].cost) return false;
    const cand = [];
    if (BUILDINGS[type].site) {
      const sh = nearestFreeSite(s, hq.x, hq.z, queued);
      if (sh) cand.push({ x: sh.x, z: sh.z, score: 0 });
    } else for (const b of mine) for (let r = 4; r <= 8; r += 1.5) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      cand.push({ x, z, score: prefer(x, z) });
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand) for (const rot of [0, 1]) {
      if (placeError(s, p, type, c.x, c.z, rot, queued)) continue;
      const f = { type, x: c.x, z: c.z, rot, owner: p, ...footprint(type, c.x, c.z, rot) };
      const q = free.sort((a, b) => dist(a.x, a.z, c.x, c.z) - dist(b.x, b.z, c.x, c.z))[0];
      const bp = builderPlan(s, q, f, apFor(q));
      if (!bp.actions.length) continue;
      queued.push(f);
      out.builds.push({ type, x: c.x, z: c.z, rot });
      supply -= BUILDINGS[type].cost;
      const plan = emptyPlan(); plan.actions = bp.actions; orders.squads[q.id] = plan; busy.add(q.id);
      return true;
    }
    return false;
  };
  const forward = (x, z) => fwd * (x - hq.x) - Math.abs(z - hq.z) * 0.3;
  const side = (x, z) => -Math.abs(fwd * (x - hq.x) - 1) - Math.abs(Math.abs(z - hq.z) - 5) * 0.5;
  const threat = known.filter(e => dist(e.x, e.z, hq.x, hq.z) < 14);
  const site = gold ? 'mine' : 'well';
  // a short per-faction build order, one new building per free builder
  for (let i = 0; i < 3; i++) {
    const ok =
      (threat.length && count('wall') < 2 && place('wall', (x, z) => forward(x, z) - Math.min(...threat.map(e => dist(e.x, e.z, x, z))) * 0.5)) ||
      (gold && !count('farm') && place('farm', side)) ||
      (!gold && !count(site) && place(site)) ||
      (!count('barracks') && place('barracks', (x, z) => -Math.abs(z - hq.z - 3) - Math.abs(fwd * (x - hq.x) - 2))) ||
      (!count(site) && place(site)) ||
      (count('barracks') && !count('tower') && s.round >= 3 && place('tower', forward)) ||
      (count(site) < 2 && s.round >= 4 && place(site)) ||
      (gold && count('farm') < 3 && s.round >= 4 && place('farm', side)) ||
      (count('banner') < RULES.maxBannerCp && s.round >= 5 && supply >= BUILDINGS.banner.cost + 20 && place('banner', (x, z) => -dist(x, z, hq.x, hq.z))) ||
      (count('tower') < 2 && s.round >= 6 && supply >= BUILDINGS.tower.cost + 30 && place('tower', forward));
    if (!ok) break;
  }
  // idle builders stay home (hold), next to the HQ
  // training: a second builder early, then soldiers from the barracks
  let army = armySize(s, p), nb = builderCount(s, p);
  if (nb < 2 && s.round >= 2 && !hq.train && supply >= trainCost(fac, 'builder') + 10 && army < s.board.cap) {
    out.trains.push({ bid: hq.id, role: 'builder' }); supply -= trainCost(fac, 'builder'); army++;
  }
  const shooters = known.filter(e => isShooter(defOf(e))).length;
  for (const b of mine.filter(b => b.type === 'barracks' && !b.build && !b.train)) {
    if (army >= s.board.cap) break;
    const myRoles = s.squads.filter(q => q.owner === p).map(q => q.role);
    const n = r => myRoles.filter(x => x === r).length;
    const role = shooters >= 2 && n('fast') < 2 ? 'fast' : n('tank') < 1 ? 'tank' : n('ranged') < n('fighter') ? 'ranged' : 'fighter';
    if (supply < trainCost(fac, role)) continue;
    out.trains.push({ bid: b.id, role }); supply -= trainCost(fac, role); army++;
  }
  return out;
}
