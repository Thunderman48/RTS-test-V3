// Game state creation and shared queries (used by sim, UI and AI).
import { CONFIG } from '../config.js';
import { buildMap, START, mirror } from './map.js';
import { dist } from './geom.js';

export function createGame(seed = 1) {
  const map = buildMap();
  const s = {
    seed, round: 1, winner: null, nextId: 1,
    map,
    players: [0, 1].map(id => ({ id, supply: CONFIG.economy.startSupply, revive: null })),
    units: [], buildings: [],
  };
  for (const p of [0, 1]) {
    const hq = p === 0 ? START.hq : mirror(START.hq);
    addBuilding(s, p, 'hq', hq.x, hq.z, true);
    for (const u of START.units) {
      const pos = p === 0 ? u : mirror(u);
      addUnit(s, p, u.type, pos.x, pos.z);
    }
  }
  return s;
}

export function addUnit(s, owner, type, x, z, stance = 'guard') {
  const def = CONFIG.units[type];
  const u = {
    id: 'u' + (s.nextId++), owner, type, x, z,
    hp: def.hp, maxHp: def.hp,
    stance, anchor: { x, z },
    cds: {},               // skill id -> cooldown in rounds
    revealed: {},          // skill id -> true once used (enemy can then see its cooldown)
    tierDebuff: 0,         // pending tier debuff applied at next turn
    lastCombat: -99,
    born: s.round,
  };
  s.units.push(u);
  return u;
}

export function addBuilding(s, owner, type, x, z, built = false) {
  const def = CONFIG.buildings[type];
  const b = {
    id: 'b' + (s.nextId++), owner, type, x, z,
    hp: built ? def.hp : Math.ceil(def.hp * 0.3), maxHp: def.hp,
    built, progress: 0,
    queue: [],            // [{unit, progress}]
    rally: 'guard',
  };
  s.buildings.push(b);
  return b;
}

export const unitDef = u => CONFIG.units[u.type];
export const bDef = b => CONFIG.buildings[b.type];

export function findEntity(s, id) {
  return s.units.find(u => u.id === id) || s.buildings.find(b => b.id === id) || null;
}

export function isUnit(e) { return e && e.id[0] === 'u'; }
export function entRadius(e) { return isUnit(e) ? CONFIG.unitRadius : CONFIG.buildings[e.type].r; }

// AP for the coming round, after wound penalties (based on HP at round start)
export function apFor(u) {
  let ap = CONFIG.baseAP;
  const f = u.hp / u.maxHp;
  for (const [th, loss] of CONFIG.woundSteps) if (f < th) ap = CONFIG.baseAP - loss;
  return ap;
}

export function moveSpeed(type) { return CONFIG.units[type].tier * CONFIG.moveFactor; }

export function aliveUnits(s, owner = null) {
  return s.units.filter(u => u.hp > 0 && (owner === null || u.owner === owner));
}

export function hqOf(s, p) { return s.buildings.find(b => b.owner === p && b.type === 'hq' && b.hp > 0); }

export function commanderOf(s, p) { return s.units.find(u => u.owner === p && u.type === 'commander' && u.hp > 0); }

// Total CP for player p
export function cpPools(s, p) {
  const posts = s.buildings.filter(b => b.owner === p && b.type === 'command' && b.built && b.hp > 0).length;
  return { base: CONFIG.cp.base + posts * CONFIG.cp.perCommandPost };
}

// ---- skills -------------------------------------------------------------------
export const skillsOf = u => CONFIG.units[u.type].skills;
export const skillDef = (type, id) => CONFIG.units[type].skills.find(k => k.id === id) || null;
export const cdOf = (u, id) => (u.cds && u.cds[id]) || 0;

// Vision sources for player p (list of {x,z,r})
export function visionSources(s, p) {
  const src = [];
  for (const u of s.units) if (u.owner === p && u.hp > 0) src.push({ x: u.x, z: u.z, r: CONFIG.units[u.type].vision });
  for (const b of s.buildings) if (b.owner === p && b.hp > 0) src.push({ x: b.x, z: b.z, r: b.built ? CONFIG.buildings[b.type].vision : 3 });
  return src;
}

export function seen(src, x, z, pad = 0) {
  for (const v of src) if ((v.x - x) * (v.x - x) + (v.z - z) * (v.z - z) <= (v.r + pad) * (v.r + pad)) return true;
  return false;
}

// Which enemy entities can player p see right now
export function visibleEnemies(s, p) {
  const src = visionSources(s, p);
  return {
    units: s.units.filter(u => u.owner !== p && u.hp > 0 && seen(src, u.x, u.z)),
    buildings: s.buildings.filter(b => b.owner !== p && b.hp > 0 && seen(src, b.x, b.z, CONFIG.buildings[b.type].r)),
  };
}

export function armyCount(s, p) {
  const alive = s.units.filter(u => u.owner === p && u.hp > 0 && u.type !== 'commander').length;
  const queued = s.buildings.filter(b => b.owner === p && b.hp > 0).reduce((n, b) => n + b.queue.length, 0);
  return alive + queued;
}

export function retreatPoint(s, u) {
  let best = null, bd = 1e9;
  for (const b of s.buildings) {
    if (b.owner !== u.owner || b.hp <= 0 || !b.built) continue;
    if (b.type !== 'outpost' && b.type !== 'hq') continue;
    const d = dist(b.x, b.z, u.x, u.z);
    const w = b.type === 'outpost' ? d : d + 0.001; // prefer outposts on ties
    if (w < bd) { bd = w; best = b; }
  }
  return best;
}

export function emptyOrders() {
  return { units: {}, stances: {}, builds: [], production: [], boosts: [], heals: [], rally: {} };
}

export function emptyPlan() {
  // buffs: ids of prepaid skills (Fortify, Rally) bought during planning
  return { actions: [], upgrades: 0, defends: 0, overwatch: 0, parry: false, buffs: [] };
}

export const clone = o => JSON.parse(JSON.stringify(o));
