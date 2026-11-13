// V4 game state: squads of miniatures on a terrain board.
import { RULES, FACTIONS, squadRadius, unitDef } from '../data/units.js';
import { buildTerrain, DEPLOY, mirror, HQ_X, HQ_SPOTS, SHRINES } from '../data/map.js';
import { addBuilding, obstacles } from './base.js';
import { pointBlocked } from './nav.js';
import { rng } from './rng.js';

export function createGame(seed = 1, factions = ['kingdom', 'undead']) {
  const R = rng(seed);
  const s = {
    v: 4, seed, round: 1, winner: null, nextId: 1,
    terrain: buildTerrain(),
    players: factions.map((f, i) => ({ id: i, faction: f })),
    squads: [],
    buildings: [],
    supply: factions.map(f => FACTIONS[f].eco.start),
    shrines: SHRINES.map(p => ({ x: p.x, z: p.z, owner: -1 })),
    // what each side knows about enemy buildings: id -> last seen snapshot
    intel: [{ known: {} }, { known: {} }],
  };
  // each HQ starts at one of three spots along its back edge (so it has to be scouted)
  const hqz = [0, 1].map(() => HQ_SPOTS[Math.floor(R() * HQ_SPOTS.length) % HQ_SPOTS.length]);
  for (const p of [0, 1]) { const h = p === 0 ? { x: HQ_X, z: hqz[0] } : mirror({ x: HQ_X, z: hqz[1] }); addBuilding(s, p, 'hq', h.x, h.z, 0, true); }
  // the army deploys in front of its HQ with a small seeded shuffle, so games differ
  for (const p of [0, 1]) {
    for (const d of DEPLOY) {
      const z0 = Math.max(2.5, Math.min(RULES.board.h - 2.5, hqz[p] + d.dz));
      const pos = p === 0 ? { x: d.x, z: z0 } : mirror({ x: d.x, z: z0 });
      const jit = d.role === 'builder' ? 0 : 16;
      const jx = Math.round((R() - 0.5) * jit) / 10, jz = Math.round((R() - 0.5) * jit) / 10;
      const q = addSquad(s, p, d.role, pos.x + jx, pos.z + jz);
      freeSpot(s, q);
    }
  }
  return s;
}

export function addSquad(s, owner, role, x, z) {
  const faction = s.players[owner].faction;
  const def = unitDef(faction, role);
  const q = {
    id: 'q' + (s.nextId++), owner, faction, role, x, z,
    fx: owner === 0 ? 1 : -1, fz: 0,   // facing (unit vector)
    models: def.models, hp: def.models * def.hpPer,
    stance: 'guard',
    cd: {},                            // skill cooldowns: kind -> rounds left
  };
  s.squads.push(q);
  return q;
}

// nudge a squad to the nearest spot clear of terrain, buildings and other squads
export function freeSpot(s, q) {
  const O = obstacles(s), r = radiusOf(q);
  const ok = (x, z) => !pointBlocked(O, x, z, r + 0.1) && !s.squads.some(o => o !== q && Math.hypot(o.x - x, o.z - z) < r + radiusOf(o) + 0.1);
  if (ok(q.x, q.z)) return;
  for (let ring = 1; ring <= 16; ring++) for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, x = q.x + Math.cos(a) * ring * 0.4, z = q.z + Math.sin(a) * ring * 0.4;
    if (ok(x, z)) { q.x = Math.round(x * 100) / 100; q.z = Math.round(z * 100) / 100; return; }
  }
}

export const defOf = q => FACTIONS[q.faction].units[q.role];
export const radiusOf = q => squadRadius(defOf(q), q.models);
export const alive = q => q.hp > 0;
export const modelsFor = (q, hp) => Math.max(0, Math.ceil(hp / defOf(q).hpPer - 1e-9));
export const speedOf = q => defOf(q).tier * RULES.moveFactor;
export const apFor = () => RULES.ap;
export function emptyOrders() { return { squads: {}, stances: {}, builds: [], trains: [] }; }
export function emptyPlan() { return { actions: [], upgrades: 0, defends: 0, parry: false, overwatch: null }; }
export const clone = o => JSON.parse(JSON.stringify(o));
export const findSquad = (s, id) => s.squads.find(q => q.id === id) || null;
