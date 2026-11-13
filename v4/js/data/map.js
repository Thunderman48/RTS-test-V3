// V4 battlefield: a 48" x 32" mat with terrain pieces. Point-symmetric so it's fair.
import { RULES } from './units.js';

const W = RULES.board.w, H = RULES.board.h;
export const mirror = p => ({ ...p, x: W - p.x, z: H - p.z });

// kinds:
//  forest : circle, slows movement (x0.6); blocks sight (M2)
//  ruin   : wall rectangle (x, z, w, d, rot 0/90) — blocks movement, sight and shots
//  rock   : circle — blocks movement and shots
//  river  : rectangle band — slows movement (x0.5)
const HALF = [
  { kind: 'forest', x: 15, z: 7.5, r: 3.2 },
  { kind: 'forest', x: 20, z: 26, r: 2.6 },
  { kind: 'ruin', x: 22, z: 13.4, w: 4.2, d: 0.6 },
  { kind: 'ruin', x: 20.2, z: 15.6, w: 0.6, d: 3.2 },
  { kind: 'rock', x: 13.5, z: 25, r: 1.2 },
  { kind: 'rock', x: 27.5, z: 5.2, r: 1.0 },
];

export function buildTerrain() {
  const out = [];
  for (const t of HALF) { out.push({ ...t }); out.push(mirror(t)); }
  // a stream across the middle with two fords
  out.push({ kind: 'river', x: 24, z: 16, w: 1.6, d: 32, fords: [{ z: 7, d: 3 }, { z: 25, d: 3 }] });
  return out;
}

// Deployment for player 0 (left edge); player 1 is mirrored. The HQ sits behind the army.
export const DEPLOY = [
  { role: 'hero', x: 9.5, z: 16 },
  { role: 'tank', x: 12.5, z: 13 },
  { role: 'fighter', x: 12.5, z: 19.5 },
  { role: 'ranged', x: 9, z: 10.5 },
  { role: 'fast', x: 9, z: 22 },
];
export const HQ_POS = { x: 3.5, z: 16 };
// shrine nodes: hold one (your squads within 3", no enemy squads) for extra supply each round
export const SHRINES = [{ x: 16.5, z: 19.5 }, { x: 31.5, z: 12.5 }, { x: 24, z: 25 }, { x: 24, z: 7 }];
