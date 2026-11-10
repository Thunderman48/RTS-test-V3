// Economy tick: runs once per round after buildings act. Income, construction and production
// all advance on the same round clock as combat.
import { CONFIG } from '../config.js';
import { dist } from './geom.js';
import { addBuilding, addUnit, commanderOf } from './state.js';
import { canPlace, nearBase } from './orders.js';
import { Nav } from './nav.js';

const DIRS = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

export function freeSpotNear(s, x, z, minR, nav) {
  nav = nav || new Nav(s);
  const R = CONFIG.unitRadius;
  const occupied = (px, pz) => s.units.some(u => u.hp > 0 && dist(u.x, u.z, px, pz) < 2 * R + 0.05);
  for (let ring = 0; ring < 8; ring++) {
    const rr = minR + ring * 0.9;
    for (const [dx, dz] of DIRS) {
      const px = x + dx * rr, pz = z + dz * rr;
      if (nav.free(px, pz) && !occupied(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

export function economyTick(s, orders, ev) {
  const E = CONFIG.economy;
  const out = { income: [0, 0] };
  // 1. new construction sites
  for (const p of [0, 1]) {
    for (const bo of orders[p].builds) {
      const def = CONFIG.buildings[bo.type];
      if (s.players[p].supply < def.cost || canPlace(s, p, bo.type, bo.x, bo.z)) { ev({ type: 'buildfail', owner: p, btype: bo.type }); continue; }
      s.players[p].supply -= def.cost;
      const b = addBuilding(s, p, bo.type, bo.x, bo.z, false);
      ev({ type: 'build', id: b.id, owner: p, btype: bo.type, x: bo.x, z: bo.z });
      // push units off the new site
      const nav = new Nav(s);
      for (const u of s.units) {
        if (u.hp > 0 && dist(u.x, u.z, b.x, b.z) < def.r + CONFIG.unitRadius) {
          const spot = freeSpotNear(s, b.x, b.z, def.r + CONFIG.unitRadius + 0.2, nav);
          u.x = spot.x; u.z = spot.z;
          ev({ type: 'push', id: u.id, x: u.x, z: u.z });
        }
      }
    }
    // 2. production orders
    for (const q of orders[p].production) {
      const b = s.buildings.find(x => x.id === q.building);
      const def = CONFIG.units[q.unit];
      if (!b || b.hp <= 0 || s.players[p].supply < def.cost) continue;
      s.players[p].supply -= def.cost;
      b.queue.push({ unit: q.unit, progress: 0 });
    }
  }
  // 3. construction
  for (const b of s.buildings) {
    if (b.hp <= 0 || b.built) continue;
    const def = CONFIG.buildings[b.type];
    b.progress++;
    b.hp = Math.min(b.maxHp, b.hp + Math.ceil(def.hp * 0.7 / def.rounds));
    if (b.progress >= def.rounds) { b.built = true; ev({ type: 'built', id: b.id }); }
  }
  // 4. production (boost: +1 progress for 1 CP)
  let nav = new Nav(s);
  for (const b of s.buildings) {
    if (b.hp <= 0 || !b.built || !b.queue.length) continue;
    const head = b.queue[0];
    const boosted = orders[b.owner].boosts.includes(b.id);
    head.progress += 1 + (boosted ? 1 : 0);
    if (head.progress >= CONFIG.units[head.unit].buildRounds) {
      const spot = freeSpotNear(s, b.x, b.z, CONFIG.buildings[b.type].r + CONFIG.unitRadius + 0.3, nav);
      const u = addUnit(s, b.owner, head.unit, spot.x, spot.z, b.rally || 'guard');
      u.lastCombat = s.round;
      b.queue.shift();
      ev({ type: 'spawn', id: u.id, owner: u.owner, utype: u.type, x: u.x, z: u.z, by: b.id });
    }
  }
  // 5. node capture: units of exactly one side nearby
  for (const n of s.map.nodes) {
    const sides = new Set(s.units.filter(u => u.hp > 0 && dist(u.x, u.z, n.x, n.z) <= E.nodeRadius).map(u => u.owner));
    if (sides.size === 1) {
      const o = [...sides][0];
      if (n.owner !== o) { n.owner = o; ev({ type: 'capture', node: n.id, owner: o }); }
    }
  }
  // 6. income
  for (const p of [0, 1]) {
    let inc = 0;
    if (s.buildings.some(b => b.owner === p && b.type === 'hq' && b.hp > 0)) inc += E.hqIncome;
    inc += s.map.nodes.filter(n => n.owner === p).length * E.nodeIncome;
    s.players[p].supply += inc;
    out.income[p] = inc;
  }
  // 7. healing
  for (const p of [0, 1]) for (const id of orders[p].heals) {
    const u = s.units.find(x => x.id === id);
    if (!u || u.hp <= 0 || !nearBase(s, u) || s.players[p].supply < E.healCost) continue;
    s.players[p].supply -= E.healCost;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * E.healFrac));
    ev({ type: 'heal', id: u.id, amount: u.hp - before, hp: u.hp });
  }
  for (const u of s.units) {
    if (u.hp <= 0 || u.hp >= u.maxHp) continue;
    if (s.round - u.lastCombat < E.outOfCombatRounds) continue;
    let f = E.regenFrac;
    if (nearBase(s, u)) f += E.baseRegenFrac;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + Math.max(1, Math.round(u.maxHp * f)));
    if (u.hp > before) ev({ type: 'heal', id: u.id, amount: u.hp - before, hp: u.hp, regen: true });
  }
  // 8. commander revive: hold the spot where it died
  for (const p of [0, 1]) {
    const rv = s.players[p].revive;
    if (!rv) continue;
    if (commanderOf(s, p)) { s.players[p].revive = null; continue; }
    const holding = s.units.some(u => u.hp > 0 && u.owner === p && dist(u.x, u.z, rv.x, rv.z) <= CONFIG.revive.radius);
    if (holding) {
      rv.progress++;
      ev({ type: 'reviveprog', owner: p, progress: rv.progress });
      if (rv.progress >= CONFIG.revive.rounds) {
        nav = new Nav(s);
        const spot = freeSpotNear(s, rv.x, rv.z, 0, nav);
        const c = addUnit(s, p, 'commander', spot.x, spot.z, 'guard');
        c.hp = Math.round(c.maxHp * CONFIG.revive.hpFrac);
        c.lastCombat = s.round;
        s.players[p].revive = null;
        ev({ type: 'spawn', id: c.id, owner: p, utype: 'commander', x: c.x, z: c.z, revive: true });
      }
    }
  }
  // 9. cooldowns
  for (const u of s.units) for (const id of Object.keys(u.cds || {})) { if (u.cds[id] > 0) u.cds[id]--; if (!u.cds[id]) delete u.cds[id]; }
  // 10. win check
  const hqAlive = [0, 1].map(p => s.buildings.some(b => b.owner === p && b.type === 'hq' && b.hp > 0));
  if (!hqAlive[0] && !hqAlive[1]) s.winner = -1;
  else if (!hqAlive[0]) s.winner = 1;
  else if (!hqAlive[1]) s.winner = 0;
  else if (s.round >= CONFIG.roundLimit) {
    const hp = [0, 1].map(p => s.buildings.filter(b => b.owner === p && b.hp > 0).reduce((a, b) => a + b.hp, 0));
    s.winner = hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1;
    out.limit = true;
  }
  s.round++;
  return out;
}
