// The battlefields. Each map is point-symmetric (fair): `half` terrain, `rivers` and `sites`
// are listed for one side and mirrored through the centre; `lakes` in `center` are not mirrored.
// Terrain kinds:
//  forest : circle, slows movement (x0.6), hides squads inside it, gives cover
//  ruin   : wall rectangle (x, z, w, d): blocks movement, sight and shots
//  rock   : circle: blocks movement, sight and shots
//  lake   : circle of water: blocks movement only (you can see and shoot across it)
//  river  : a stream across the whole table at x (slows movement x0.5), crossed at fords
import { RULES } from './units.js';

export const MAPS = {
  crossing: {
    id: 'crossing', name: 'Crossing', w: 48, h: 32, blurb: 'A stream with two fords, woods and ruins. Small and quick.',
    half: [
      { kind: 'forest', x: 15, z: 7.5, r: 3.2 },
      { kind: 'forest', x: 20, z: 26, r: 2.6 },
      { kind: 'ruin', x: 22, z: 13.4, w: 4.2, d: 0.6 },
      { kind: 'ruin', x: 20.2, z: 15.6, w: 0.6, d: 3.2 },
      { kind: 'rock', x: 13.5, z: 25, r: 1.2 },
      { kind: 'rock', x: 27.5, z: 5.2, r: 1.0 },
    ],
    center: [],
    rivers: [{ x: 24, fords: [{ z: 7, d: 3 }, { z: 25, d: 3 }], self: true }],
    sites: [{ x: 16.5, z: 19.5 }, { x: 20.5, z: 6.5 }],
    hqSpots: [9, 16, 23],
    road: [[0, 16], [14, 12], [34, 20], [48, 16]],
    capBonus: 0,
  },
  twinrivers: {
    id: 'twinrivers', name: 'Twin Rivers', w: 64, h: 40, blurb: 'Two streams split the field in three. Hold the middle ground between them.',
    half: [
      { kind: 'forest', x: 12, z: 8, r: 3.0 },
      { kind: 'forest', x: 16, z: 32, r: 2.8 },
      { kind: 'forest', x: 28.5, z: 20, r: 3.0 },
      { kind: 'ruin', x: 27, z: 9, w: 4.2, d: 0.6 },
      { kind: 'ruin', x: 25.2, z: 11.2, w: 0.6, d: 3.2 },
      { kind: 'rock', x: 18.5, z: 25.5, r: 1.1 },
      { kind: 'rock', x: 30, z: 33, r: 1.0 },
    ],
    center: [],
    rivers: [{ x: 22, fords: [{ z: 9, d: 3 }, { z: 29, d: 3 }] }],
    sites: [{ x: 16.5, z: 16 }, { x: 27, z: 27.5 }, { x: 31, z: 4 }],
    hqSpots: [10, 20, 30],
    road: [[0, 20], [20, 14], [44, 26], [64, 20]],
    capBonus: 1,
  },
  highland: {
    id: 'highland', name: 'Highland Ruins', w: 64, h: 44, blurb: 'A maze of ruins around a mountain lake. Tight paths, good cover.',
    half: [
      { kind: 'forest', x: 14, z: 6, r: 3.4 },
      { kind: 'forest', x: 12, z: 37, r: 3.2 },
      { kind: 'forest', x: 24, z: 39, r: 2.6 },
      { kind: 'ruin', x: 26, z: 16, w: 0.6, d: 5 },
      { kind: 'ruin', x: 28.5, z: 13.5, w: 5, d: 0.6 },
      { kind: 'ruin', x: 24, z: 27, w: 4, d: 0.6 },
      { kind: 'ruin', x: 19, z: 20.5, w: 0.6, d: 4 },
      { kind: 'rock', x: 27, z: 31, r: 1.3 },
      { kind: 'rock', x: 22, z: 11, r: 1.2 },
    ],
    center: [{ kind: 'lake', x: 32, z: 22, r: 3.6 }],
    rivers: [],
    sites: [{ x: 17, z: 29.5 }, { x: 25, z: 6 }, { x: 30, z: 37.5 }],
    hqSpots: [11, 22, 33],
    road: [[0, 22], [18, 30], [46, 14], [64, 22]],
    capBonus: 1,
  },
  greatfield: {
    id: 'greatfield', name: 'Great Field', w: 80, h: 52, blurb: 'A huge open battlefield with ponds, woods and a long stream. For big armies.',
    half: [
      { kind: 'forest', x: 14, z: 9, r: 3.2 },
      { kind: 'forest', x: 24, z: 41, r: 3.6 },
      { kind: 'forest', x: 31, z: 17, r: 2.8 },
      { kind: 'forest', x: 11, z: 45, r: 2.6 },
      { kind: 'lake', x: 21, z: 27, r: 2.4 },
      { kind: 'ruin', x: 33, z: 32, w: 4, d: 0.6 },
      { kind: 'ruin', x: 30, z: 6, w: 0.6, d: 3.6 },
      { kind: 'rock', x: 18, z: 34, r: 1.2 },
      { kind: 'rock', x: 36, z: 12, r: 1.0 },
    ],
    center: [],
    rivers: [{ x: 40, fords: [{ z: 8, d: 3 }, { z: 26, d: 3.4 }, { z: 44, d: 3 }], self: true }],
    sites: [{ x: 20, z: 17 }, { x: 30, z: 45 }, { x: 34, z: 24 }, { x: 26, z: 4 }],
    hqSpots: [12, 26, 40],
    road: [[0, 26], [24, 16], [56, 36], [80, 26]],
    capBonus: 2,
  },
};
export const MAP_ORDER = ['crossing', 'twinrivers', 'highland', 'greatfield'];
export const mapDef = id => MAPS[id] || MAPS.crossing;

export const HQ_X = 3.5;
// Deployment for player 0 (left edge); player 1 is mirrored. The army stands in front of its HQ:
// positions are relative to the HQ's z (the HQ starts at one of the map's hqSpots, chosen per game).
export const DEPLOY = [
  { role: 'hero', x: 9.5, dz: 0 },
  { role: 'tank', x: 12.5, dz: -3 },
  { role: 'fighter', x: 12.5, dz: 3.5 },
  { role: 'ranged', x: 9, dz: -5.5 },
  { role: 'fast', x: 9, dz: 6 },
  { role: 'builder', x: 7, dz: 3.2 },
];

export const mirrorOn = (W, H) => p => ({ ...p, x: W - p.x, z: H - p.z });

// terrain list for a map (with a 'board' piece carrying the table size)
export function buildMapTerrain(def) {
  const m = mirrorOn(def.w, def.h), out = [];
  for (const t of def.half) { out.push({ ...t }); out.push(m(t)); }
  for (const t of def.center) out.push({ ...t });
  for (const r of def.rivers) {
    const band = rx => ({ kind: 'river', x: rx, z: def.h / 2, w: 1.6, d: def.h });
    out.push({ ...band(r.x), fords: r.fords.map(f => ({ ...f })) });
    if (!r.self) out.push({ ...band(def.w - r.x), fords: r.fords.map(f => ({ ...f, z: def.h - f.z })) });
  }
  out.push({ kind: 'board', x: def.w / 2, z: def.h / 2, w: def.w, h: def.h });
  return out;
}
export function mapSites(def) { const m = mirrorOn(def.w, def.h); return def.sites.flatMap(p => [{ ...p }, m(p)]); }
// board info stored on the game state
export function boardOf(def) { return { w: def.w, h: def.h, zone: Math.round(def.w / 3), cap: RULES.armyCap + (def.capBonus || 0) }; }
