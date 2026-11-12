// Ground shapes (paths, arcs, lines, rings) and the telegraph/impact effects.
import * as THREE from 'three';

export const COL = {
  swing: 0xff7a1a, volley: 0xff2d55, move: 0xffffff, moveEnemy: 0x222222, ghost: 0xffffff,
  hit: 0xff4a1c, defend: 0x3fa9ff, ok: 0x34c759, bad: 0xff3b30, tier: 0x9be15d,
};
const basic = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

// Flat ribbon along a polyline, lying on the mat
export function ribbon(points, width, color, opacity = 1, dash = 0, y = 0.06) {
  const pos = [], hw = width / 2;
  const quad = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * hw, nz = dx / l * hw;
    pos.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x + nx, y, b.z + nz, a.x - nx, y, a.z - nz, b.x - nx, y, b.z - nz);
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (!dash) { quad(a, b); continue; }
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d < L; d += dash * 2) { const t0 = d / L, t1 = Math.min(1, (d + dash) / L); quad({ x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 }, { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 }); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(geo, basic(color, opacity)); m.renderOrder = 5;
  return m;
}

// Chevrons along a path (direction of travel)
export function chevrons(points, color, opacity = 0.9, every = 1.2, y = 0.07) {
  const g = new THREE.Group();
  let carry = every / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-3) continue;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    for (let d = carry; d < L; d += every) {
      const x = a.x + ux * d, z = a.z + uz * d;
      const tri = new THREE.BufferGeometry();
      const s = 0.22, nx = -uz, nz = ux;
      tri.setAttribute('position', new THREE.Float32BufferAttribute([x + ux * s, y, z + uz * s, x - ux * s + nx * s, y, z - uz * s + nz * s, x - ux * s - nx * s, y, z - uz * s - nz * s], 3));
      const m = new THREE.Mesh(tri, basic(color, opacity)); m.renderOrder = 6; g.add(m);
    }
    carry = (carry - L) % every; if (carry < 0) carry += every;
  }
  return g;
}

export function ring(r, w, color, opacity = 1, y = 0.05, seg = 48) {
  const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, r - w / 2), r + w / 2, seg), basic(color, opacity));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 4;
  return m;
}
export function disc(r, color, opacity = 1, y = 0.04) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), basic(color, opacity));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 3;
  return m;
}

// Swing arc (sector) lying on the mat. dir = unit vector, R = radius, ch = cos(half angle)
export function arcShape(ox, oz, dx, dz, R, ch, color, opacity = 0.35, inner = 0) {
  const half = Math.acos(Math.max(-1, Math.min(1, ch)));
  const th = Math.atan2(-dz, dx);
  const m = new THREE.Mesh(new THREE.RingGeometry(inner, R, 28, 1, th - half, half * 2), basic(color, opacity));
  m.rotation.x = -Math.PI / 2; m.position.set(ox, 0.07, oz); m.renderOrder = 5;
  return m;
}
// Volley line (rectangle) from origin along dir
export function lineShape(ox, oz, dx, dz, len, w, color, opacity = 0.35) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), basic(color, opacity));
  m.rotation.x = -Math.PI / 2; m.position.z = len / 2; m.renderOrder = 5;
  g.add(m);
  g.position.set(ox, 0.07, oz); g.rotation.y = Math.atan2(dx, dz);
  return g;
}

// Telegraphs drawn during playback: outline of the area + a fill that grows during the wind-up,
// then a bright flash when it resolves.
export class Telegraphs {
  constructor(view) { this.view = view; this.map = new Map(); }
  update(teles, T) {
    const L = this.view.layers.fx;
    const seen = new Set();
    for (const t of teles) {
      const key = t.id + ':' + t.T0;
      seen.add(key);
      let e = this.map.get(key);
      const col = t.kind === 'volley' ? COL.volley : COL.swing;
      if (!e) {
        const g = new THREE.Group();
        const outline = t.shape === 'arc' ? arcShape(t.ox, t.oz, t.dx, t.dz, t.R, t.ch, col, 0.18) : lineShape(t.ox, t.oz, t.dx, t.dz, t.len, t.w, col, 0.18);
        const fill = t.shape === 'arc' ? arcShape(t.ox, t.oz, t.dx, t.dz, t.R, t.ch, col, 0.5) : lineShape(t.ox, t.oz, t.dx, t.dz, t.len, t.w, col, 0.5);
        g.add(outline, fill);
        L.add(g);
        e = { g, outline, fill };
        this.map.set(key, e);
      }
      const k = Math.max(0, Math.min(1, (T - t.T0) / Math.max(1, t.T1 - t.T0)));
      const after = T > t.T1 ? (T - t.T1) / 4 : 0;
      // the fill grows from the squad outward as the wind-up charges
      if (t.shape === 'arc') { e.fill.scale.setScalar(Math.max(0.01, k)); }
      else { e.fill.scale.set(1, 1, Math.max(0.01, k)); e.fill.position.copy(e.outline.position); }
      const flash = after > 0 ? Math.max(0, 1 - after) : 0;
      setOpacity(e.outline, after > 0 ? 0.6 * flash : 0.2);
      setOpacity(e.fill, after > 0 ? 0.85 * flash : 0.25 + 0.35 * k);
    }
    for (const [key, e] of this.map) if (!seen.has(key)) { L.remove(e.g); e.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); this.map.delete(key); }
  }
  clear() { this.update([], 0); }
}
function setOpacity(o, a) { o.traverse(c => { if (c.material) c.material.opacity = a; }); }

// Floating HTML text over the table
export class FloatTexts {
  constructor(layer, view) { this.layer = layer; this.view = view; this.items = []; }
  add(x, z, html, cls = '', y = 2.2, life = 1.4) {
    const el = document.createElement('div');
    el.className = 'ftext ' + cls; el.innerHTML = html;
    this.layer.appendChild(el);
    const n = this.items.filter(i => Math.abs(i.x - x) < 1 && Math.abs(i.z - z) < 1 && i.t < 0.4).length;
    this.items.push({ el, x, z, y: y + n * 0.6, t: 0, life });
  }
  update(dt) {
    for (const it of [...this.items]) {
      it.t += dt;
      if (it.t >= it.life) { it.el.remove(); this.items.splice(this.items.indexOf(it), 1); continue; }
      const p = this.view.project(it.x, it.y + it.t * 0.8, it.z);
      it.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      it.el.style.opacity = String(Math.min(1, 2.5 * (1 - it.t / it.life)));
    }
  }
  clear() { for (const it of this.items) it.el.remove(); this.items = []; }
}

// Bolts and arrows in flight, driven by timeline time so scrubbing works.
// list: [{ key, T0, T1, from: [{x,y,z}], to: {x,z}, arc }]
const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, flatShading: true, roughness: 0.8 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xc4cad3, flatShading: true, roughness: 0.5, metalness: 0.3 });
const fletchMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, flatShading: true, roughness: 0.9, side: THREE.DoubleSide });
function missile(scale = 1) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.5), shaftMat);
  const h = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4), headMat); h.rotation.x = Math.PI / 2; h.position.z = 0.3;
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.12), fletchMat); f.position.z = -0.2; f.rotation.y = Math.PI / 2;
  g.add(s, h, f); g.scale.setScalar(scale);
  return g;
}
const jit = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return (v - Math.floor(v)) - 0.5; };
export class Projectiles {
  constructor(view) { this.view = view; this.map = new Map(); }
  update(list, T) {
    const L = this.view.layers.fx;
    const seen = new Set();
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const v of list) {
      if (T < v.T0 || T > v.T1 + 5) continue;
      seen.add(v.key);
      let e = this.map.get(v.key);
      if (!e) { e = v.from.map(() => { const m = missile(1.4); L.add(m); return m; }); this.map.set(v.key, e); }
      const f = Math.min(1, (T - v.T0) / Math.max(1, v.T1 - v.T0));
      const pt = (i, t) => {
        const s = v.from[i], ex = v.to.x + jit(i, 1) * 0.9, ez = v.to.z + jit(i, 2) * 0.9;
        a.set(s.x + (ex - s.x) * t, s.y * (1 - t) + 0.25 * t + v.arc * 4 * t * (1 - t), s.z + (ez - s.z) * t);
        return a;
      };
      e.forEach((m, i) => {
        const fi = Math.max(0, Math.min(1, f + jit(i, 3) * 0.08));
        pt(i, fi); m.position.copy(a);
        pt(i, Math.min(1, fi + 0.02)); b.copy(a);
        if (fi < 0.999) m.lookAt(b);
        m.visible = T >= v.T0;
      });
    }
    for (const [key, e] of this.map) if (!seen.has(key)) { for (const m of e) { L.remove(m); m.traverse(o => o.geometry && o.geometry.dispose()); } this.map.delete(key); }
  }
  clear() { this.update([], -1e9); }
}
