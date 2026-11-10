// AI opponent. Uses exactly the same order API, CP rules and stances as a human player,
// and only sees what its own units can see (plus the enemy HQ position, which is on the map).
import { CONFIG } from '../config.js';
import { dist, norm } from '../sim/geom.js';
import {
  emptyOrders, emptyPlan, visibleEnemies, hqOf, apFor, moveSpeed, armyCount, commanderOf,
  cpPools, inCommanderRange, entRadius,
} from '../sim/state.js';
import { canPlace, cpUsage, nearBase } from '../sim/orders.js';
import { approachAP } from '../sim/stances.js';
import { Nav } from '../sim/nav.js';
import { rng } from '../sim/rng.js';
import { START, mirror } from '../sim/map.js';

const RING = [[1, 0], [0.92, 0.38], [0.92, -0.38], [0.7, 0.7], [0.7, -0.7], [0.38, 0.92], [0.38, -0.92], [0, 1], [0, -1], [-0.38, 0.92], [-0.38, -0.92], [-0.7, 0.7], [-0.7, -0.7], [-1, 0]];

export function aiOrders(s, p) {
  const R = rng((s.seed * 7919 + s.round * 104729 + p * 13) >>> 0);
  const o = emptyOrders();
  const nav = new Nav(s);
  const me = s.players[p];
  const myUnits = s.units.filter(u => u.owner === p && u.hp > 0);
  const view = visibleEnemies(s, p);
  const myHQ = hqOf(s, p);
  if (!myHQ) return o;
  const enemyHQpos = p === 0 ? mirror(START.hq) : START.hq;
  const fwd = Math.sign(enemyHQpos.x - myHQ.x) || 1;
  let supply = me.supply;
  const mine = t => s.buildings.filter(b => b.owner === p && b.type === t && b.hp > 0);

  // ---------------- economy ----------------
  const wantBuild = [];
  if (!mine('barracks').length && s.round >= 1) wantBuild.push('barracks');
  if (s.round >= 3 && mine('turret').length < 1) wantBuild.push('turret');
  if (s.round >= 5 && !mine('command').length) wantBuild.push('command');
  if (s.round >= 7 && mine('outpost').length < 1) wantBuild.push('outpost');
  if (s.round >= 9 && mine('turret').length < 2) wantBuild.push('turret');
  if (s.round >= 11 && mine('barricade').length < 2) wantBuild.push('barricade');
  for (const t of wantBuild) {
    const def = CONFIG.buildings[t];
    if (def.cost > supply) break;
    const spot = findSpot(s, p, t, myHQ, fwd, o.builds, t === 'outpost' ? 7 : t === 'turret' ? 4.5 : 3.6);
    if (spot) { o.builds.push({ type: t, x: spot.x, z: spot.z }); supply -= def.cost; }
    break; // one building per round keeps money for units
  }
  let army = armyCount(s, p);
  const comp = { fighter: 0, ranged: 0, tank: 0, assassin: 0 };
  for (const u of myUnits) if (comp[u.type] !== undefined) comp[u.type]++;
  for (const b of s.buildings) if (b.owner === p) for (const q of b.queue) comp[q.unit]++;
  const want = { fighter: 0.3, ranged: 0.3, tank: 0.2, assassin: 0.2 };
  for (const b of s.buildings.filter(b => b.owner === p && b.built && b.hp > 0 && CONFIG.buildings[b.type].produces)) {
    if (b.queue.length) continue;
    const opts = CONFIG.buildings[b.type].produces;
    const total = Object.values(comp).reduce((a, c) => a + c, 0) + 1;
    let best = null, bs = -1e9;
    for (const t of opts) { const sc = want[t] - comp[t] / total + R() * 0.05; if (sc > bs) { bs = sc; best = t; } }
    const cost = CONFIG.units[best].cost;
    if (cost <= supply && army < CONFIG.economy.armyCap) {
      o.production.push({ building: b.id, unit: best }); supply -= cost; army++; comp[best]++;
    }
  }
  for (const u of myUnits) {
    if (u.hp < u.maxHp * 0.5 && supply >= CONFIG.economy.healCost + 20 && nearBase(s, u)) { o.heals.push(u.id); supply -= CONFIG.economy.healCost; }
  }

  // ---------------- army objective ----------------
  const strength = list => list.reduce((a, u) => a + u.hp * (u.type === 'tank' ? 1.2 : 1), 0);
  const myStr = strength(myUnits);
  const enStr = strength(view.units);
  const threatsAtHome = view.units.filter(e => dist(e.x, e.z, myHQ.x, myHQ.z) < 10);
  let objective;
  if (threatsAtHome.length) objective = { x: threatsAtHome[0].x, z: threatsAtHome[0].z, kind: 'defend' };
  else if ((myUnits.length >= 6 && myStr > enStr * 1.15 && s.round >= 6) || s.round >= 25) objective = { x: enemyHQpos.x, z: enemyHQpos.z, kind: 'attack' };
  else {
    // closest node not owned by me
    const nodes = s.map.nodes.filter(n => n.owner !== p).sort((a, b) => dist(a.x, a.z, myHQ.x, myHQ.z) - dist(b.x, b.z, myHQ.x, myHQ.z));
    objective = nodes.length ? { x: nodes[0].x, z: nodes[0].z, kind: 'node' } : { x: (myHQ.x + enemyHQpos.x) / 2, z: myHQ.z, kind: 'hold' };
  }

  // ---------------- direct control with CP ----------------
  const pools = cpPools(s, p);
  let cpBase = pools.base, cpCmd = pools.cmd;
  const takeCP = u => {
    if (u.type === 'commander') return true;
    if (cpCmd > 0 && inCommanderRange(s, u)) { cpCmd--; return true; }
    if (cpBase > 1) { cpBase--; return true; } // keep 1 CP for stance changes
    return false;
  };
  const scored = [];
  for (const u of myUnits) {
    const def = CONFIG.units[u.type];
    const near = view.units.filter(e => dist(e.x, e.z, u.x, u.z) < (def.melee ? 7 : def.shot.range + 1));
    let score = near.length ? 2 : 0;
    if (u.type === 'commander') score = 100;
    if (u.type === 'assassin' && near.some(e => e.type === 'ranged' || e.hp < 40)) score += 3;
    if (!def.melee && near.length) score += 2;
    scored.push({ u, score, near });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const { u, score, near } of scored) {
    if (score <= 0) continue;
    if (!takeCP(u)) continue;
    const plan = directPlan(s, u, near, view, objective, nav, R);
    if (plan) o.units[u.id] = plan;
  }

  // ---------------- stances for everyone else ----------------
  const changes = [];
  for (const u of myUnits) {
    if (o.units[u.id]) continue;
    let st = 'advance', anchor = jitter(objective, u, R);
    if (u.hp < u.maxHp * 0.3 && u.type !== 'commander') { st = 'retreat'; anchor = null; }
    else if (objective.kind === 'hold' || (objective.kind === 'node' && dist(u.x, u.z, objective.x, objective.z) < 3)) { st = 'guard'; anchor = null; }
    const anchorMoved = st === 'advance' && (!u.anchor || dist(u.anchor.x, u.anchor.z, anchor.x, anchor.z) > 3);
    if (u.stance !== st || anchorMoved) changes.push({ u, st, anchor });
  }
  const maxChanges = cpBase * CONFIG.cp.stanceUnitsPerCP;
  changes.sort((a, b) => (a.st === 'retreat' ? -1 : 0) - (b.st === 'retreat' ? -1 : 0));
  for (const c of changes.slice(0, maxChanges)) o.stances[c.u.id] = { stance: c.st, anchor: c.anchor };
  const used = cpUsage(s, p, o);
  if (used.leftBase > 0) {
    const prod = s.buildings.find(b => b.owner === p && b.queue.length && b.built);
    if (prod) o.boosts.push(prod.id);
  }
  return o;
}

function jitter(obj, u, R) {
  const k = (parseInt(u.id.slice(1), 10) % 5) - 2;
  return { x: obj.x + (R() - 0.5) * 2, z: obj.z + k * 0.9 };
}

function findSpot(s, p, type, hq, fwd, pending, radius) {
  for (const rr of [radius, radius + 1.5, radius - 1, radius + 3]) {
    for (const [dx, dz] of RING) {
      const x = hq.x + dx * fwd * rr, z = hq.z + dz * rr;
      if (!canPlace(s, p, type, x, z, pending)) return { x, z };
    }
  }
  return null;
}

function directPlan(s, u, near, view, objective, nav, R) {
  const def = CONFIG.units[u.type];
  const plan = emptyPlan();
  let left = apFor(u);
  const sp = moveSpeed(u.type);
  if (!def.melee) {
    // ranged: shoot at predicted position (lead towards the shooter's side a bit)
    const targets = near.filter(e => dist(e.x, e.z, u.x, u.z) <= def.shot.range).sort((a, b) => a.hp - b.hp);
    if (!targets.length) return null;
    const t = targets[0];
    if (u.cd <= 0 && left >= def.skill.ap && targets.length >= 1) {
      const cluster = targets.filter(e => dist(e.x, e.z, t.x, t.z) < def.skill.radius + 0.5).length;
      if (cluster >= 2 || t.type === 'tank' || R() < 0.4) {
        plan.actions.push({ kind: 'frag', x: t.x, z: t.z }); left -= def.skill.ap;
      }
    }
    const tierAdv = t.type !== 'assassin' && R() < 0.3 && left >= 15 + def.shot.ap * 2;
    if (tierAdv) { plan.upgrades = 1; left -= 15; }
    while (left >= def.shot.ap) {
      const lead = 0.6 * (plan.actions.length % 2 ? 1 : -1);
      const d = norm(t.x - u.x, t.z - u.z);
      plan.actions.push({ kind: 'shoot', x: t.x - d.z * lead * 0.5, z: t.z + d.x * lead * 0.5 });
      left -= def.shot.ap;
    }
    if (left >= CONFIG.extraDefendCost) plan.defends = Math.floor(left / CONFIG.extraDefendCost);
    return plan;
  }
  // commander: disrupt the most dangerous unit in range
  if (u.type === 'commander' && u.cd <= 0) {
    const tgt = near.filter(e => dist(e.x, e.z, u.x, u.z) <= def.skill.range).sort((a, b) => CONFIG.units[b.type].tier - CONFIG.units[a.type].tier)[0];
    if (tgt) { plan.actions.push({ kind: 'disrupt', target: tgt.id }); left -= def.skill.ap; }
  }
  // melee: attack best target in reach
  const targets = near.slice().sort((a, b) => {
    const pa = (a.type === 'ranged' ? -30 : 0) + a.hp + dist(a.x, a.z, u.x, u.z) * 5;
    const pb = (b.type === 'ranged' ? -30 : 0) + b.hp + dist(b.x, b.z, u.x, u.z) * 5;
    return pa - pb;
  });
  const t = targets[0];
  if (!t) {
    if (u.type !== 'commander') return null;
    const a = objective;
    const need = approachAP(nav, u, a.x, a.z, 2.5);
    if (need > 0) { const ap = Math.min(need, left); plan.actions.push({ kind: 'move', ap, x: a.x - 1.5, z: a.z }); left -= ap; }
    plan.defends = Math.min(CONFIG.maxExtraDefends, Math.floor(left / CONFIG.extraDefendCost));
    return plan;
  }
  if (u.type === 'assassin' && u.cd <= 0 && dist(u.x, u.z, t.x, t.z) > 4 && left >= def.skill.ap + def.strike.ap + 10) {
    plan.actions.push({ kind: 'dash', x: t.x, z: t.z }); left -= def.skill.ap;
  }
  if (u.type === 'tank' && u.cd <= 0 && left >= def.skill.ap + def.strike.ap) { plan.fortify = true; left -= def.skill.ap; }
  if (u.type === 'fighter' && left >= CONFIG.parryCost + def.strike.ap + 20) { plan.parry = true; left -= CONFIG.parryCost; }
  const reach = CONFIG.unitRadius + entRadius(t) + CONFIG.meleeReach;
  const need = approachAP(nav, u, t.x, t.z, reach - 0.1) + 6;
  if (u.type === 'fighter' && u.cd <= 0 && left >= def.skill.ap + need && t.type === 'tank') {
    plan.actions.push({ kind: 'shove', target: t.id, moveAp: Math.min(need, left - def.skill.ap) });
    left -= Math.min(need, left - def.skill.ap) + def.skill.ap;
  }
  if (left >= def.strike.ap) {
    const moveAp = Math.min(need, left - def.strike.ap);
    plan.actions.push({ kind: 'attack', target: t.id, moveAp });
    left -= moveAp + def.strike.ap;
    while (left >= def.strike.ap + 6) { plan.actions.push({ kind: 'attack', target: t.id, moveAp: 6 }); left -= def.strike.ap + 6; }
  }
  if (left >= CONFIG.extraDefendCost) plan.defends = Math.min(CONFIG.maxExtraDefends, Math.floor(left / CONFIG.extraDefendCost));
  void sp; void commanderOf;
  return plan;
}
