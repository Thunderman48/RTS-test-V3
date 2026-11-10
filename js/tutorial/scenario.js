// Fixed tutorial scenario: a small skirmish with a scripted (predictable) enemy.
import { createGame, addUnit, addBuilding, emptyOrders, emptyPlan } from '../sim/state.js';
import { dist } from '../sim/geom.js';

export function createTutorialState() {
  const s = createGame(424242);
  s.tutorial = true;
  // remove the normal starting armies; keep both HQs far away
  s.units = [];
  s.players[0].supply = 0; s.players[1].supply = 0;
  const c = addUnit(s, 0, 'commander', 12.6, 12.7);
  const f = addUnit(s, 0, 'fighter', 15.8, 11.8);
  const r = addUnit(s, 0, 'ranged', 12.2, 11.0);
  // enemy: two weak ranged units guarding an outpost
  // weak, non-healing enemies so the lesson moves quickly
  const e1 = addUnit(s, 1, 'ranged', 19.4, 11.9); e1.hp = e1.maxHp = 20;
  const e2 = addUnit(s, 1, 'ranged', 21.6, 13.2); e2.hp = e2.maxHp = 18;
  const op = addBuilding(s, 1, 'outpost', 27, 13.6, true); op.hp = op.maxHp = 50;
  for (const u of [e1, e2]) { u.stance = 'hold'; u.lastCombat = 999; }
  s.tutorialIds = { commander: c.id, fighter: f.id, ranged: r.id, e1: e1.id, e2: e2.id, outpost: op.id };
  return s;
}

// The enemy shoots at the closest of your units (where it stands now) and never moves.
export function tutorialEnemyOrders(s) {
  const o = emptyOrders();
  const mine = s.units.filter(u => u.owner === 0 && u.hp > 0);
  for (const e of s.units.filter(u => u.owner === 1 && u.hp > 0)) {
    const t = mine.slice().sort((a, b) => dist(a.x, a.z, e.x, e.z) - dist(b.x, b.z, e.x, e.z))[0];
    const p = emptyPlan();
    if (t && dist(t.x, t.z, e.x, e.z) <= 10) p.actions.push({ kind: 'shoot', x: t.x, z: t.z });
    o.units[e.id] = p;
  }
  return o;
}
