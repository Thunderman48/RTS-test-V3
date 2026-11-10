// Low-poly, black & white geometric models built from Three.js primitives.
// Team 0 = white pieces, team 1 = black pieces (like chess).
import * as THREE from 'three';

export const PALETTE = {
  board: 0xa9a9a5,
  boardLine: 0x9a9a96,
  void: 0x0b0b0b,
  wall: 0xf2f2f0,
  wallEdge: 0x111111,
  team: [
    { body: 0xf6f6f4, edge: 0x111111, flat: '#f6f6f4', ink: '#111111' },
    { body: 0x1b1b1b, edge: 0xf0f0f0, flat: '#1b1b1b', ink: '#f6f6f4' },
  ],
  neutral: 0x8a8a8a,
  accent: 0xff4a1c,
  accentCss: '#ff4a1c',
};

const matCache = new Map();
export function bodyMat(team, opts = {}) {
  const key = team + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const color = team === -1 ? PALETTE.neutral : PALETTE.team[team].body;
  const m = new THREE.MeshStandardMaterial({
    color, roughness: team === 1 ? 0.55 : 0.75, metalness: 0.0, flatShading: true,
    transparent: !!opts.ghost, opacity: opts.ghost ? 0.4 : 1, depthWrite: !opts.ghost,
  });
  m.__cached = true;
  matCache.set(key, m);
  return m;
}
export function edgeMat(team, opts = {}) {
  const key = 'e' + team + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const color = team === -1 ? 0x222222 : PALETTE.team[team].edge;
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.ghost ? 0.5 : 0.9 });
  m.__cached = true;
  matCache.set(key, m);
  return m;
}

function solid(geo, team, opts) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, bodyMat(team, opts));
  mesh.castShadow = !opts?.ghost; mesh.receiveShadow = true;
  g.add(mesh);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat(team, opts));
  g.add(e);
  return g;
}

// ---- units -------------------------------------------------------------------
export function makeUnitMesh(type, team, opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  let part;
  switch (type) {
    case 'fighter': {
      part = solid(new THREE.BoxGeometry(0.68, 0.68, 0.68), team, opts); part.position.y = 0.36; body.add(part);
      const blade = solid(new THREE.BoxGeometry(0.12, 0.12, 0.5), team, opts); blade.position.set(0.25, 0.5, 0.42); body.add(blade);
      break;
    }
    case 'assassin': {
      part = solid(new THREE.ConeGeometry(0.44, 1.0, 3), team, opts); part.position.y = 0.5; part.rotation.y = Math.PI / 2; body.add(part);
      break;
    }
    case 'ranged': {
      part = solid(new THREE.CylinderGeometry(0.32, 0.36, 0.8, 10), team, opts); part.position.y = 0.4; body.add(part);
      const barrel = solid(new THREE.BoxGeometry(0.14, 0.14, 0.7), team, opts); barrel.position.set(0, 0.62, 0.42); body.add(barrel);
      break;
    }
    case 'tank': {
      part = solid(new THREE.CylinderGeometry(0.5, 0.56, 0.62, 8), team, opts); part.position.y = 0.31; body.add(part);
      const top = solid(new THREE.BoxGeometry(0.5, 0.25, 0.5), team, opts); top.position.y = 0.75; body.add(top);
      break;
    }
    case 'commander': {
      part = solid(new THREE.OctahedronGeometry(0.48, 0), team, opts); part.position.y = 0.85; body.add(part);
      const base = solid(new THREE.CylinderGeometry(0.22, 0.34, 0.4, 6), team, opts); base.position.y = 0.2; body.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 4, 24), bodyMat(team, opts));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.85; body.add(ring);
      root.userData.spin = part;
      break;
    }
  }
  root.userData.body = body;
  return root;
}

// ---- buildings -------------------------------------------------------------------
export function makeBuildingMesh(type, team, opts = {}) {
  const root = new THREE.Group();
  const add = (geo, x, y, z) => { const m = solid(geo, team, opts); m.position.set(x, y, z); root.add(m); return m; };
  switch (type) {
    case 'hq':
      add(new THREE.BoxGeometry(3.0, 0.6, 3.0), 0, 0.3, 0);
      add(new THREE.BoxGeometry(2.0, 0.9, 2.0), 0, 1.05, 0);
      add(new THREE.BoxGeometry(1.0, 0.8, 1.0), 0, 1.9, 0);
      root.userData.spin = add(new THREE.OctahedronGeometry(0.35, 0), 0, 2.75, 0);
      break;
    case 'barracks':
      add(new THREE.BoxGeometry(2.4, 0.9, 1.8), 0, 0.45, 0);
      add(new THREE.BoxGeometry(1.6, 0.5, 1.2), 0, 1.15, 0);
      break;
    case 'turret': {
      add(new THREE.CylinderGeometry(0.62, 0.7, 1.0, 8), 0, 0.5, 0);
      const head = add(new THREE.BoxGeometry(0.6, 0.4, 0.6), 0, 1.2, 0);
      const barrel = solid(new THREE.BoxGeometry(0.15, 0.15, 0.8), team, opts); barrel.position.set(0, 0, 0.5); head.add(barrel);
      root.userData.head = head;
      break;
    }
    case 'command':
      add(new THREE.BoxGeometry(1.4, 0.5, 1.4), 0, 0.25, 0);
      add(new THREE.BoxGeometry(0.4, 1.8, 0.4), 0, 1.4, 0);
      root.userData.spin = add(new THREE.TorusGeometry(0.45, 0.06, 4, 16), 0, 2.3, 0);
      break;
    case 'outpost':
      add(new THREE.CylinderGeometry(1.0, 1.0, 0.45, 6), 0, 0.22, 0);
      add(new THREE.BoxGeometry(0.1, 1.8, 0.1), 0.3, 1.1, 0);
      add(new THREE.BoxGeometry(0.6, 0.35, 0.05), 0.62, 1.8, 0);
      break;
    case 'barricade':
      add(new THREE.BoxGeometry(1.4, 0.55, 0.35), 0, 0.28, 0);
      break;
  }
  return root;
}

export function makeWallMesh(w) {
  const geo = new THREE.BoxGeometry(w.w, 1.3, w.d);
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9, flatShading: true }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: PALETTE.wallEdge })));
  g.position.set(w.x, 0.65, w.z);
  return g;
}

export function makeNodeMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.22, 6), new THREE.MeshStandardMaterial({ color: 0xbdbdbb, flatShading: true }));
  base.position.y = 0.11; base.receiveShadow = true; g.add(base);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(base.geometry), new THREE.LineBasicMaterial({ color: 0x222222 }));
  edges.position.copy(base.position); g.add(edges);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: PALETTE.neutral, flatShading: true }));
  crystal.position.y = 0.9; crystal.castShadow = true;
  g.add(crystal);
  g.userData.crystal = crystal;
  return g;
}

// Flat ribbon along a polyline on the ground (WebGL lines are 1px; ribbons stay readable on phones)
export function ribbon(points, width, color, opacity = 1, dash = 0, y = 0.04) {
  const pos = [];
  const hw = width / 2;
  const pushQuad = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * hw, nz = dx / l * hw;
    pos.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz);
    pos.push(b.x + nx, y, b.z + nz, a.x - nx, y, a.z - nz, b.x - nx, y, b.z - nz);
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (!dash) { pushQuad(a, b); continue; }
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d < L; d += dash * 2) {
      const t0 = d / L, t1 = Math.min(1, (d + dash) / L);
      pushQuad({ x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 }, { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 5;
  return m;
}

export function ring(r, width, color, opacity = 1, y = 0.05, segments = 48) {
  const geo = new THREE.RingGeometry(Math.max(0.01, r - width / 2), r + width / 2, segments);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 4;
  return m;
}

export function disc(r, color, opacity = 1, y = 0.03, segments = 40) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, segments), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 3;
  return m;
}

export function dashedRing(r, width, color, opacity = 1, y = 0.05, n = 28) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / n) * 0.55;
    const geo = new THREE.RingGeometry(r - width / 2, r + width / 2, 3, 1, a0, a1 - a0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 4;
    g.add(m);
  }
  return g;
}

// Name plate sprite: [tier] NAME / HP bar + defend pips.
// White team = white plate with black ink, black team = black plate with white ink.
export function makeLabel(kind = 'unit') {
  const c = document.createElement('canvas');
  c.width = 288; c.height = 80;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const w = kind === 'building' ? 2.9 : 2.25;
  sp.scale.set(w, w * 80 / 288, 1);
  sp.renderOrder = 20;
  sp.userData = { c, tex, key: '', w };
  return sp;
}

export function drawLabel(sp, { tier = null, name = '', hpFrac, team, defends = 0, low = false, dim = false, tag = '' }) {
  const key = `${tier}|${name}|${hpFrac.toFixed(3)}|${team}|${defends}|${dim}|${tag}`;
  if (sp.userData.key === key) return;
  sp.userData.key = key;
  const { c, tex } = sp.userData;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const ink = team === 0 ? '#0b0b0b' : '#f6f6f4';
  const paper = team === 0 ? '#f6f6f4' : '#0b0b0b';
  const W = c.width, H = c.height;
  let x0 = 4;
  // tier badge (inverted colours so it pops)
  if (tier !== null) {
    g.fillStyle = ink; g.fillRect(4, 4, 72, 72);
    g.fillStyle = paper; g.font = '900 46px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(tier), 40, 43);
    x0 = 80;
  }
  // plate
  g.fillStyle = paper; g.fillRect(x0, 4, W - x0 - 4, 72);
  g.strokeStyle = ink; g.lineWidth = 4; g.strokeRect(x0 + 2, 6, W - x0 - 8, 68);
  // name
  g.fillStyle = ink; g.font = '800 26px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText((name + (tag ? ' · ' + tag : '')).toUpperCase(), x0 + 12, 34, W - x0 - 24);
  // hp bar
  const bx = x0 + 12, bw = W - x0 - 28;
  g.fillStyle = team === 0 ? '#c9c9c6' : '#3a3a3a'; g.fillRect(bx, 44, bw, 14);
  g.fillStyle = low ? PALETTE.accentCss : ink; g.fillRect(bx, 44, Math.max(0, bw * hpFrac), 14);
  // defend pips
  for (let i = 0; i < Math.min(8, defends); i++) { g.fillStyle = ink; g.fillRect(bx + i * 16, 62, 11, 7); }
  tex.needsUpdate = true;
  sp.material.opacity = dim ? 0.45 : 1;
}

// Team-coloured base under every unit + highlight ring used while a unit is acting.
export function makeUnitBase(team) {
  const g = new THREE.Group();
  const d = disc(0.62, team === 0 ? 0xf6f6f4 : 0x0b0b0b, 0.95, 0.02, 32);
  const r = ring(0.62, 0.07, team === 0 ? 0x0b0b0b : 0xf6f6f4, 1, 0.025, 32);
  g.add(d, r);
  const act = ring(0.86, 0.11, PALETTE.accent, 1, 0.03, 40);
  act.visible = false;
  g.add(act);
  g.userData.act = act;
  return g;
}
