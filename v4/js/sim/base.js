// Base & economy: buildings (footprints, obstacles, placement), shrine nodes, supply,
// training. Deterministic, shared by the resolver, the planner UI and the AI.
import { RULES, BUILDINGS, TRAIN_COST, FACTIONS, squadRadius } from '../data/units.js';
import { dist, inRect } from './geom.js';
import { pointBlocked } from './nav.js';

export const bdef = b => BUILDINGS[b.type];
export const bname = (b, faction) => BUILDINGS[b.type].name[faction];

// footprint of a building at (x,z) with rot (0 or 1 = rotated 90 degrees)
export function footprint(type, x, z, rot = 0) {
  const d = BUILDINGS[type];
  if (d.shape === 'circle') return { x, z, r: d.r };
  return rot ? { x, z, w: d.d, d: d.w } : { x, z, w: d.w, d: d.d };
}
// a round "hit" radius for attacks and sight
export function hitRadius(b) { const d = bdef(b); return d.shape === 'circle' ? d.r : Math.sqrt(b.w * b.d) / 2 + 0.15; }

export function addBuilding(s, owner, type, x, z, rot = 0, built = true) {
  const d = BUILDINGS[type];
  const b = { id: 'b' + (s.nextBid = (s.nextBid || 0) + 1), owner, type, rot, ...footprint(type, x, z, rot),
    hp: built ? d.hp : Math.max(1, Math.round(d.hp * RULES.siteHp)), build: built ? 0 : d.build, train: null, vision: built ? d.vision : 3 };
  s.buildings.push(b);
  return b;
}

// terrain + standing buildings as one obstacle list (buildings use kind 'building' so nav blocks them)
const obsCache = new Map();
export function buildingSig(s) { return (s.buildings || []).filter(b => b.hp > 0).map(b => b.id + '@' + b.x + ',' + b.z + ',' + b.rot).join('|'); }
export function obstacles(s) {
  const sig = buildingSig(s);
  if (!sig) return s.terrain;
  let o = obsCache.get(sig);
  if (!o) {
    o = s.terrain.concat(s.buildings.filter(b => b.hp > 0).map(b => b.r !== undefined ? { kind: 'building', x: b.x, z: b.z, r: b.r } : { kind: 'building', x: b.x, z: b.z, w: b.w, d: b.d }));
    if (obsCache.size > 60) obsCache.clear();
    obsCache.set(sig, o);
  }
  return o;
}
export const navKey = s => 'r' + buildingSig(s);

// ---- placement ------------------------------------------------------------------------
function overlaps(a, b, pad = 0) {
  // circle / rect vs circle / rect (rects are axis aligned)
  const ra = a.r !== undefined, rb = b.r !== undefined;
  if (ra && rb) return dist(a.x, a.z, b.x, b.z) < a.r + b.r + pad;
  if (ra && !rb) return inRect(a.x, a.z, b, a.r + pad);
  if (!ra && rb) return inRect(b.x, b.z, a, b.r + pad);
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad;
}
// can side p place `type` at (x,z,rot)? `extra` = buildings already queued this round. Returns '' or a reason.
export function placeError(s, p, type, x, z, rot = 0, extra = []) {
  const W = RULES.board.w, H = RULES.board.h;
  const f = footprint(type, x, z, rot), half = f.r !== undefined ? f.r : Math.max(f.w, f.d) / 2;
  if (x - half < 0.3 || z - half < 0.3 || x + half > W - 0.3 || z + half > H - 0.3) return 'Off the board';
  if (p === 0 ? x > RULES.buildZone : x < W - RULES.buildZone) return 'Only in your third of the board';
  const mine = (s.buildings || []).filter(b => b.owner === p && b.hp > 0).concat(extra);
  if (!mine.some(b => dist(b.x, b.z, x, z) <= RULES.buildRange)) return `Must be within ${RULES.buildRange}″ of one of your buildings`;
  for (const t of s.terrain) {
    if (t.kind === 'river') { if (Math.abs(x - t.x) < t.w / 2 + half) return 'Not in the stream'; continue; }
    const tf = t.r !== undefined ? { x: t.x, z: t.z, r: t.r } : { x: t.x, z: t.z, w: t.w, d: t.d };
    if (overlaps(f, tf, 0.2)) return 'Blocked by terrain';
  }
  for (const b of (s.buildings || []).filter(b => b.hp > 0).concat(extra)) if (overlaps(f, b, 0.3)) return 'Too close to another building';
  for (const q of s.squads) if (q.hp > 0 && overlaps(f, { x: q.x, z: q.z, r: squadRadius(FACTIONS[q.faction].units[q.role], q.models) }, 0.1)) return 'A squad is standing there';
  for (const sh of s.shrines || []) if (overlaps(f, { x: sh.x, z: sh.z, r: RULES.shrineRadius * 0.6 }, 0)) return 'Too close to a shrine';
  if (type === 'banner' && bannerCount(s, p) + extra.filter(b => b.type === 'banner').length >= RULES.maxBannerCp) return `At most ${RULES.maxBannerCp} banners`;
  return '';
}
export function bannerCount(s, p) { return (s.buildings || []).filter(b => b.owner === p && b.type === 'banner' && b.hp > 0).length; }
export function bonusCp(s, p) { return Math.min(RULES.maxBannerCp, (s.buildings || []).filter(b => b.owner === p && b.type === 'banner' && b.hp > 0 && !b.build).length); }
export function armySize(s, p) { return s.squads.filter(q => q.owner === p && q.hp > 0).length + (s.buildings || []).filter(b => b.owner === p && b.train).length; }

// validate this round's builds and trains for side p (in order, against the supply)
export function validateBase(s, p, builds0 = [], trains0 = []) {
  let supply = (s.supply || [0, 0])[p];
  const builds = [], trains = [], queued = [];
  for (const b0 of builds0.slice(0, 6)) {
    const d = BUILDINGS[b0?.type];
    if (!d || b0.type === 'hq') continue;
    const x = +b0.x || 0, z = +b0.z || 0, rot = b0.rot ? 1 : 0;
    if (d.cost > supply) continue;
    if (placeError(s, p, b0.type, x, z, rot, queued)) continue;
    supply -= d.cost;
    const f = { type: b0.type, x, z, rot, ...footprint(b0.type, x, z, rot), owner: p };
    builds.push({ type: b0.type, x, z, rot }); queued.push(f);
  }
  let army = armySize(s, p);
  const usedB = new Set();
  for (const t0 of trains0.slice(0, 4)) {
    const b = (s.buildings || []).find(x => x.id === t0?.bid);
    const cost = TRAIN_COST[t0?.role];
    if (!b || b.owner !== p || b.type !== 'barracks' || b.hp <= 0 || b.build || b.train || usedB.has(b.id) || !cost) continue;
    if (cost > supply || army >= RULES.armyCap) continue;
    supply -= cost; army++; usedB.add(b.id);
    trains.push({ bid: b.id, role: t0.role });
  }
  return { builds, trains };
}

// a free spot next to a building for a newly trained squad (toward the enemy first)
export function spawnSpot(s, b, radius) {
  const dir = b.owner === 0 ? 1 : -1;
  const base = hitRadius(b) + radius + 0.4;
  const obs = obstacles(s);
  for (let ring = 0; ring < 3; ring++) for (let k = 0; k < 12; k++) {
    const a = (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * Math.PI / 6;
    const r = base + ring * 1.2;
    const x = b.x + Math.cos(a) * r * dir, z = b.z + Math.sin(a) * r;
    if (pointBlocked(obs, x, z, radius)) continue;
    if (s.squads.some(q => q.hp > 0 && dist(q.x, q.z, x, z) < radius + squadRadius(FACTIONS[q.faction].units[q.role], q.models) + 0.1)) continue;
    return { x, z };
  }
  return null;
}

// army value used for the round-limit tiebreak
export function armyValue(s, p) {
  let v = 0;
  for (const q of s.squads) if (q.owner === p && q.hp > 0) v += q.hp;
  for (const b of s.buildings || []) if (b.owner === p && b.hp > 0) v += b.type === 'hq' ? b.hp * 2 : b.hp * 0.5;
  return v;
}
export { TRAIN_COST, BUILDINGS };
