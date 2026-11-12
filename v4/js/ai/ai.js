// V4 AI (M1): advances as a battle line, directly controls its hero and the 3 squads
// closest to the enemy, and aims a little ahead of enemies that moved last round.
import { RULES, isMelee } from '../data/units.js';
import { losCut, engagedWith } from '../sim/resolve.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { nearestEnemy, meleePlan, trimPath } from '../sim/stances.js';
import { Nav } from '../sim/nav.js';
import { dist } from '../sim/geom.js';

export function aiOrders(s, p, memory = {}) {
  const o = emptyOrders();
  const mine = s.squads.filter(q => q.owner === p && q.hp > 0);
  const enemies = s.squads.filter(q => q.owner !== p && q.hp > 0);
  if (!enemies.length) return o;
  for (const q of mine) if (q.stance !== 'advance') o.stances[q.id] = 'advance';
  // lead targets by their last movement (memory: id -> {x,z} from last round)
  const lead = e => {
    const m = memory[e.id];
    if (!m) return null;
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
    const sk = def.skill, ready = sk && (q.cd | 0) === 0;
    // already locked in melee: prepare a parry
    if (isMelee(def) && engagedWith(q, enemies).length) { plan.parry = true; left -= RULES.parryCost; }
    // hero rally when friends are close
    if (ready && sk.kind === 'rally' && mine.filter(o => o !== q && dist(o.x, o.z, q.x, q.z) <= sk.radius + radiusOf(o)).length >= 2) { plan.actions.push({ kind: 'rally', x: q.x, z: q.z }); left -= sk.ap; }
    // necromancer: blast the nearest enemy when it is in range
    if (ready && sk.kind === 'blast' && dist(q.x, q.z, tx, tz) <= sk.range + 1) { plan.actions.push({ kind: 'blast', x: tx, z: tz }); left -= sk.ap; }
    // cavalry / wraiths: charge down a clear lane
    // charge targets: slower enemies (they still stand there when we act), in a clear lane
    const ct = ready && sk.kind === 'charge' && !engagedWith(q, enemies).length ? enemies.filter(e => {
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
        const nav = Nav.for(s.terrain, radiusOf(q), 'r');
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

export function aiMemory(s) {
  const m = {};
  for (const q of s.squads) m[q.id] = { x: q.x, z: q.z };
  return m;
}
