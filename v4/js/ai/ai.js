// V4 AI (M1): advances as a battle line, directly controls its hero and the 3 squads
// closest to the enemy, and aims a little ahead of enemies that moved last round.
import { RULES, isMelee, isShooter, skillOf, cdOf } from '../data/units.js';
import { losCut, engagedWith } from '../sim/resolve.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { nearestEnemy, meleePlan, trimPath } from '../sim/stances.js';
import { obstacles, navKey } from '../sim/base.js';
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
  if (!enemies.length) {
    // nothing known: scout toward where the enemy deployed
    const c = DEPLOY.reduce((a, d) => ({ x: a.x + d.x / DEPLOY.length, z: a.z + d.z / DEPLOY.length }), { x: 0, z: 0 });
    const home = p === 0 ? { x: RULES.board.w - c.x, z: RULES.board.h - c.z } : c;
    enemies = [{ id: '?', owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: home.x, z: home.z, fx: 1, fz: 0, models: 4, hp: 80, cd: {} }];
  }
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
  let cp = RULES.cp;
  for (const q of ranked) {
    if (q.role !== 'hero') { if (cp <= 0) break; cp--; }
    const def = defOf(q);
    const plan = emptyPlan();
    let left = apFor(q);
    const t = nearestEnemy(s, q, enemies);
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
