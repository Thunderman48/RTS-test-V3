// V4 AI (M1): advances as a battle line, directly controls its hero and the 3 squads
// closest to the enemy, and aims a little ahead of enemies that moved last round.
import { RULES, isMelee, isShooter, skillOf, cdOf } from '../data/units.js';
import { losCut, engagedWith } from '../sim/resolve.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { nearestEnemy, meleePlan, trimPath } from '../sim/stances.js';
import { obstacles, navKey, placeError, bonusCp, armySize, armyValue, BUILDINGS, TRAIN_COST } from '../sim/base.js';
import { Nav } from '../sim/nav.js';
import { dist } from '../sim/geom.js';
import { visibleTo } from '../sim/vision.js';
import { DEPLOY } from '../data/map.js';

// memory (per side, updated in place): seen = last-seen enemy squads, prev = positions seen last round
export function aiOrders(s, p, memory = aiMemory()) {
  const o = emptyOrders();
  memory.seen = memory.seen || {}; memory.prev = memory.prev || {};
  const mine = s.squads.filter(q => q.owner === p && q.hp > 0);
  // fog: the AI only knows what its side sees, plus where it last saw the others (up to 3 rounds)
  const vis = visibleTo(s, p);
  const alive = new Set(s.squads.map(q => q.id));
  for (const e of s.squads) if (vis.has(e.id)) memory.seen[e.id] = { ...e, round: s.round };
  for (const id of Object.keys(memory.seen)) if (!alive.has(id) || s.round - memory.seen[id].round > 3) delete memory.seen[id];
  let enemies = Object.values(memory.seen).map(e => vis.has(e.id) ? s.squads.find(q => q.id === e.id) : e);
  // the enemy HQ is always known: march on it when no enemy squad is known, or when close to it
  const hqE = (s.buildings || []).find(b => b.owner !== p && b.type === 'hq');
  const hqTarget = hqE ? { id: hqE.id, owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: hqE.x, z: hqE.z, fx: 1, fz: 0, models: 4, hp: hqE.hp, cd: {}, isHq: true } : null;
  if (!enemies.length) {
    if (hqTarget) enemies = [hqTarget];
    else {
      const c = DEPLOY.reduce((a, d) => ({ x: a.x + d.x / DEPLOY.length, z: a.z + d.z / DEPLOY.length }), { x: 0, z: 0 });
      const home = p === 0 ? { x: RULES.board.w - c.x, z: RULES.board.h - c.z } : c;
      enemies = [{ id: '?', owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: home.x, z: home.z, fx: 1, fz: 0, models: 4, hp: 80, cd: {} }];
    }
  } else if (hqTarget) enemies.push(hqTarget);
  if (s.buildings) Object.assign(o, economy(s, p, enemies.filter(e => !e.isHq)));
  for (const q of mine) if (q.stance !== 'advance') o.stances[q.id] = 'advance';
  // lead targets by their last movement (only for squads seen both rounds)
  const prev = memory.prev;
  memory.prev = {};
  for (const e of s.squads) if (vis.has(e.id)) memory.prev[e.id] = { x: e.x, z: e.z };
  const lead = e => {
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
  let cp = RULES.cp + bonusCp(s, p);
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
    // fast squads without a fight nearby go and take shrines
    if (q.role === 'fast' && s.shrines && !squadsOnly.some(e => dist(e.x, e.z, q.x, q.z) < 8)) {
      const sh = s.shrines.filter(x => x.owner !== p).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0];
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

// ---- economy: a simple build order, keep training, wall up when threatened ------------
function economy(s, p, known) {
  const out = { builds: [], trains: [] };
  let supply = s.supply[p];
  const mine = s.buildings.filter(b => b.owner === p);
  const hq = mine.find(b => b.type === 'hq');
  if (!hq) return out;
  const fwd = p === 0 ? 1 : -1;
  const queued = [];
  const count = t => mine.filter(b => b.type === t).length + queued.filter(b => b.type === t).length;
  const place = (type, prefer) => {
    // try spots around the HQ and our other buildings, preferring `prefer` (forward/side) offsets
    const cand = [];
    for (const b of mine) for (let r = 4; r <= 8; r += 1.5) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      cand.push({ x, z, score: prefer(x, z) });
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand) for (const rot of [0, 1]) {
      if (!placeError(s, p, type, c.x, c.z, rot, queued)) {
        queued.push({ type, x: c.x, z: c.z, rot, owner: p, ...(BUILDINGS[type].shape === 'circle' ? { r: BUILDINGS[type].r } : rot ? { w: BUILDINGS[type].d, d: BUILDINGS[type].w } : { w: BUILDINGS[type].w, d: BUILDINGS[type].d }) });
        out.builds.push({ type, x: c.x, z: c.z, rot });
        supply -= BUILDINGS[type].cost;
        return true;
      }
    }
    return false;
  };
  const forward = (x, z) => fwd * (x - hq.x) - Math.abs(z - hq.z) * 0.3;
  const threat = known.filter(e => dist(e.x, e.z, hq.x, hq.z) < 14);
  if (!count('barracks') && supply >= BUILDINGS.barracks.cost) place('barracks', (x, z) => -Math.abs(z - hq.z - 3) - Math.abs(fwd * (x - hq.x) - 2));
  else if (count('barracks') && !count('tower') && supply >= BUILDINGS.tower.cost && s.round >= 2) place('tower', forward);
  else if (threat.length && supply >= BUILDINGS.wall.cost && count('wall') < 3) place('wall', (x, z) => forward(x, z) - Math.min(...threat.map(e => dist(e.x, e.z, x, z))) * 0.5);
  else if (count('barracks') && count('banner') < RULES.maxBannerCp && supply >= BUILDINGS.banner.cost + 20) place('banner', (x, z) => -dist(x, z, hq.x, hq.z));
  else if (count('tower') < 2 && supply >= BUILDINGS.tower.cost + 30 && s.round >= 5) place('tower', forward);
  // keep the barracks busy
  const shooters = known.filter(e => isShooter(defOf(e))).length;
  let army = armySize(s, p);
  for (const b of mine.filter(b => b.type === 'barracks' && !b.build && !b.train)) {
    if (army >= RULES.armyCap) break;
    const myRoles = s.squads.filter(q => q.owner === p).map(q => q.role);
    const n = r => myRoles.filter(x => x === r).length;
    const role = shooters >= 2 && n('fast') < 2 ? 'fast' : n('tank') < 1 ? 'tank' : n('ranged') < n('fighter') ? 'ranged' : 'fighter';
    if (supply < TRAIN_COST[role]) continue;
    out.trains.push({ bid: b.id, role }); supply -= TRAIN_COST[role]; army++;
  }
  return out;
}
