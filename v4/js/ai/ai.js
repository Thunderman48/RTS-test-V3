// V4 AI (M1): advances as a battle line, directly controls its hero and the 3 squads
// closest to the enemy, and aims a little ahead of enemies that moved last round.
import { RULES } from '../data/units.js';
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
    if (def.attack.kind === 'volley') {
      const gap = dist(q.x, q.z, t.x, t.z) - radiusOf(t);
      if (gap > def.attack.range * 0.9) {
        const nav = Nav.for(s.terrain, radiusOf(q), 'r');
        const pts = trimPath(q.x, q.z, nav.path(q.x, q.z, t.x, t.z), def.attack.range * 0.75);
        const ap = Math.min(left, 45);
        if (pts.length) { plan.actions.push({ kind: 'move', pts, ap }); left -= ap; }
      }
      const L = lead(t);
      while (left >= def.attack.ap) { plan.actions.push({ kind: 'volley', x: t.x + (L ? L.x : 0), z: t.z + (L ? L.z : 0) }); left -= def.attack.ap; }
    } else {
      left = meleePlan(s, q, t, plan, left, lead(t));
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
