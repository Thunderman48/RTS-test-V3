// Faceted low-poly builder shared by the miniatures and the terrain.
// Parts are primitives with a little deterministic vertex jitter (so they look hand-cut),
// merged into one vertex-coloured mesh. Each triangle gets a slight brightness
// variation, which gives the soft "faceted" shimmer of the reference style.
import * as THREE from 'three';
import { miniMaterial } from './minishader.js';

const R2 = Math.SQRT1_2;
// deterministic hash of a position -> [0,1)
function hash(x, y, z, s) {
  const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
  return v - Math.floor(v);
}

export class Kit {
  constructor(seed = 1, aoH = null) { this.parts = []; this.seed = seed; this.aoH = aoH; }
  // o: position x,y,z, rotation rx,ry,rz (YXZ), scale sx,sy,sz, j = jitter, sh = shade variation
  add(geo, color, o = {}) {
    const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, j = 0, sh = 0.05, cf = null, ao = 1 } = o;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    this.parts.push({ geo, color, m, j, sh, cf, ao });
    return this;
  }
  box(w, h, d, color, o) { return this.add(new THREE.BoxGeometry(w, h, d), color, o); }
  cyl(rt, rb, h, color, o, seg = 7) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, o); }
  cone(r, h, color, o, seg = 6) { return this.add(new THREE.ConeGeometry(r, h, seg), color, o); }
  // faceted ball (icosahedron), jittered by default
  ball(r, color, o = {}, detail = 0) { return this.add(new THREE.IcosahedronGeometry(r, detail), color, { j: r * 0.12, ...o }); }
  // tapered block: width at top/bottom, height, depth (4-sided prism, or more sides)
  chunk(wt, wb, h, d, color, o = {}, seg = 4) {
    const g = new THREE.CylinderGeometry(wt * R2, wb * R2, h, seg);
    if (seg === 4) g.rotateY(Math.PI / 4);
    const w = Math.max(wt, wb);
    g.scale(1, 1, d / w);
    return this.add(g, color, o);
  }
  // raw geometry already rotated/prepared
  geo(g, color, o) { return this.add(g, color, o); }

  build(offset = null) {
    const pos = [], nor = [], col = [], aos = [];
    const H = this.aoH;
    const c = new THREE.Color(), v = new THREE.Vector3();
    for (const p of this.parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.applyMatrix4(p.m);
      const P = g.attributes.position.array;
      if (p.j) {
        for (let i = 0; i < P.length; i += 3) {
          const qx = Math.round(P[i] * 500), qy = Math.round(P[i + 1] * 500), qz = Math.round(P[i + 2] * 500);
          P[i] += (hash(qx, qy, qz, this.seed) - 0.5) * 2 * p.j;
          P[i + 1] += (hash(qy, qz, qx, this.seed + 3) - 0.5) * 2 * p.j;
          P[i + 2] += (hash(qz, qx, qy, this.seed + 7) - 0.5) * 2 * p.j;
        }
      }
      g.computeVertexNormals();
      // baked "wash": darker low down (figure height range) and on faces pointing down
      const aoV = [];
      const Nn = g.attributes.normal.array;
      for (let i = 0; i < P.length; i += 3) {
        let a = p.ao;
        if (H) { const t = Math.min(1, Math.max(0, (P[i + 1] - H[0]) / (H[1] - H[0]))); a *= H[2] + (1 - H[2]) * t * t * (3 - 2 * t); }
        a *= 1 - 0.32 * Math.max(0, -Nn[i + 1]);
        aoV.push(a);
      }
      if (offset) for (let i = 0; i < P.length; i += 3) { P[i] -= offset.x; P[i + 1] -= offset.y; P[i + 2] -= offset.z; }
      const N = g.attributes.normal.array;
      c.setHex(p.color);
      for (let i = 0; i < P.length; i += 9) {
        // one brightness per triangle
        v.set(P[i] + P[i + 3] + P[i + 6], P[i + 1] + P[i + 4] + P[i + 7], P[i + 2] + P[i + 5] + P[i + 8]);
        const f = 1 + (hash(Math.round(v.x * 300), Math.round(v.y * 300), Math.round(v.z * 300), this.seed + 11) - 0.5) * 2 * p.sh;
        if (p.cf) c.setHex(p.cf(v.x / 3, v.y / 3, v.z / 3));
        for (let k = 0; k < 9; k += 3) {
          aos.push(aoV[(i + k) / 3]);
          pos.push(P[i + k], P[i + k + 1], P[i + k + 2]);
          nor.push(N[i + k], N[i + k + 1], N[i + k + 2]);
          col.push(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
        }
      }
      g.dispose(); p.geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('ao', new THREE.Float32BufferAttribute(aos, 1));
    return geo;
  }
  mesh(mat, offset = null) {
    const m = new THREE.Mesh(this.build(offset), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

export const paintMat = (preset = 'mini', extra) => miniMaterial(preset, extra);
