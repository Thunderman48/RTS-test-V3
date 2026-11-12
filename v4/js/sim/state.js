// V4 game state: squads of miniatures on a terrain board.
import { RULES, FACTIONS, squadRadius, unitDef } from '../data/units.js';
import { buildTerrain, DEPLOY, mirror } from '../data/map.js';
import { rng } from './rng.js';

export function createGame(seed = 1, factions = ['kingdom', 'undead']) {
  const s = {
    v: 4, seed, round: 1, winner: null, nextId: 1,
    terrain: buildTerrain(),
    players: factions.map((f, i) => ({ id: i, faction: f })),
    squads: [],
  };
  // each side deploys in the same spots with a small seeded shuffle, so games differ
  const R = rng(seed);
  for (const p of [0, 1]) {
    for (const d of DEPLOY) {
      const pos = p === 0 ? d : mirror(d);
      const jx = Math.round((R() - 0.5) * 16) / 10, jz = Math.round((R() - 0.5) * 16) / 10;
      addSquad(s, p, d.role, pos.x + jx, pos.z + jz);
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
    cd: 0,                             // skill cooldown (rounds)
  };
  s.squads.push(q);
  return q;
}

export const defOf = q => FACTIONS[q.faction].units[q.role];
export const radiusOf = q => squadRadius(defOf(q), q.models);
export const alive = q => q.hp > 0;
export const modelsFor = (q, hp) => Math.max(0, Math.ceil(hp / defOf(q).hpPer - 1e-9));
export const speedOf = q => defOf(q).tier * RULES.moveFactor;
export const apFor = () => RULES.ap;
export function emptyOrders() { return { squads: {}, stances: {} }; }
export function emptyPlan() { return { actions: [], upgrades: 0, defends: 0, parry: false, overwatch: null }; }
export const clone = o => JSON.parse(JSON.stringify(o));
export const findSquad = (s, id) => s.squads.find(q => q.id === id) || null;
