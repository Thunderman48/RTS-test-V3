// Small geometry helpers. Only + - * / and sqrt are used so results are
// identical across browsers (keeps host and guest simulations in sync).

export const dist = (ax, az, bx, bz) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function norm(x, z) {
  const l = Math.sqrt(x * x + z * z);
  return l > 1e-9 ? { x: x / l, z: z / l, l } : { x: 0, z: 0, l: 0 };
}

// point inside axis-aligned rect (center x,z size w,d) inflated by r
export function inRect(px, pz, rc, r = 0) {
  return Math.abs(px - rc.x) <= rc.w / 2 + r && Math.abs(pz - rc.z) <= rc.d / 2 + r;
}

// Segment (ax,az)->(bx,bz) vs rect (slab method). Returns entry fraction t in [0,1] or -1.
export function segRect(ax, az, bx, bz, rc, r = 0) {
  const minx = rc.x - rc.w / 2 - r, maxx = rc.x + rc.w / 2 + r;
  const minz = rc.z - rc.d / 2 - r, maxz = rc.z + rc.d / 2 + r;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (clip(-dx, ax - minx) && clip(dx, maxx - ax) && clip(-dz, az - minz) && clip(dz, maxz - az)) return t0;
  return -1;
}

// Segment vs circle: returns smallest t in [0,1] where segment enters circle, or -1.
export function segCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return fx * fx + fz * fz <= r * r ? 0 : -1;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0; // starts inside
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = (-b - s) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// Distance from point to segment
export function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return dist(px, pz, ax + dx * t, az + dz * t);
}

// rotate a vector by a precomputed (cos, sin) pair
export function rot(x, z, c, s) { return { x: x * c - z * s, z: x * s + z * c }; }

// Precomputed cos/sin for small angle table (degrees) — literals avoid trig differences across engines.
export const ANG = {
  0: [1, 0],
  7: [0.992546151641322, 0.121869343405147],
  '-7': [0.992546151641322, -0.121869343405147],
  14: [0.970295726275996, 0.241921895599668],
  '-14': [0.970295726275996, -0.241921895599668],
  35: [0.819152044288992, 0.573576436351046],
  '-35': [0.819152044288992, -0.573576436351046],
  70: [0.342020143325669, 0.939692620785908],
  '-70': [0.342020143325669, -0.939692620785908],
};
