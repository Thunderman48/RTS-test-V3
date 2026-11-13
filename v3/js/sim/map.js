// Map definition: point-symmetric so both sides are fair.
import { CONFIG } from '../config.js';

const W = CONFIG.map.w, H = CONFIG.map.h;

// Walls are axis-aligned rectangles given by center + size. Each listed wall is mirrored.
const HALF_WALLS = [
  { x: 24, z: 9.5, w: 1.2, d: 5 },
  { x: 17.5, z: 16, w: 1.2, d: 4.5 },
  { x: 11, z: 9, w: 4.5, d: 1.2 },
  { x: 11, z: 23, w: 4.5, d: 1.2 },
  { x: 19, z: 3.6, w: 5, d: 1.2 },
  { x: 29, z: 3.6, w: 5, d: 1.2 },
  { x: 20.5, z: 26.5, w: 1.2, d: 3 },
];

const HALF_NODES = [
  { x: 14.5, z: 5.5 },
  { x: 14.5, z: 26.5 },
];

export function mirror(p) { return { ...p, x: W - p.x, z: H - p.z }; }

export function buildMap() {
  const walls = [];
  for (const w of HALF_WALLS) { walls.push({ ...w }); walls.push(mirror(w)); }
  const nodes = [{ id: 'n0', x: W / 2, z: H / 2, owner: -1 }];
  HALF_NODES.forEach((n, i) => {
    nodes.push({ id: 'n' + (i * 2 + 1), ...n, owner: -1 });
    nodes.push({ id: 'n' + (i * 2 + 2), ...mirror(n), owner: -1 });
  });
  return { w: W, h: H, walls, nodes };
}

// Starting layout for player 0; player 1 is mirrored.
export const START = {
  hq: { x: 5, z: 16 },
  units: [
    { type: 'commander', x: 8.5, z: 16 },
    { type: 'fighter', x: 9.5, z: 14 },
    { type: 'tank', x: 9.5, z: 18.2 },
    { type: 'ranged', x: 7.2, z: 13 },
    { type: 'assassin', x: 7.2, z: 19.2 },
  ],
};
