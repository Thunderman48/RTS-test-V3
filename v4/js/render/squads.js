// Squad rendering: minis in formation with attack animations, hit reactions,
// casualties toppling over, a hop while marching, team ring + selection ring.
import * as THREE from 'three';
import { FACTIONS, PAINT, squadRadius } from '../data/units.js';
import { makeMini, formation, poseMini, attackPose, POSES } from './minis.js';

// projectile flight time (AP) for shooters: the shot leaves this long before it lands
export const LEAD = { shoot: 4, bow: 7 };

export function ringMesh(r, w, color, opacity = 1) {
  const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, r - w / 2), r + w / 2, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 3;
  return m;
}

let seedN = 1;
const WHITE = new THREE.Color(0xffd6c8), BLACK = new THREE.Color(0x000000);

export class SquadView {
  constructor(sq, layer) {
    this.id = sq.id;
    const def = FACTIONS[sq.faction].units[sq.role];
    this.def = def;
    this.group = new THREE.Group();
    this.slots = formation(def.models, def.look);
    this.minis = this.slots.map((s, i) => {
      const g = makeMini(def.look, sq.faction, seedN++);
      g.position.set(s.x, 0, s.z);
      g.rotation.y = ((i * 37) % 11 - 5) * 0.025;
      this.group.add(g);
      return { g, rig: g.userData.rig, mat: g.userData.mat, alive: i < sq.models, fall: i < sq.models ? -1 : 2, side: i % 2 ? 1 : -1, stagger: ((i * 0.83) % 1.6) - 0.5 };
    });
    for (const m of this.minis) if (!m.alive) m.g.visible = false;
    this.teamRingY = 0.09;
    this.style = this.minis[0].rig.style;
    this.rimColor = PAINT[sq.faction].rim;
    const R = squadRadius(def, def.models);
    this.teamRing = ringMesh(R + 0.12, 0.07, this.rimColor, 0.5);
    this.teamRing.position.y = 0.09;
    this.selRing = ringMesh(R + 0.32, 0.12, 0xffffff, 0.95);
    this.selRing.position.y = 0.1; this.selRing.visible = false;
    this.actRing = ringMesh(R + 0.47, 0.1, 0xffc400, 1);
    this.actRing.position.y = 0.11; this.actRing.visible = false;
    this.group.add(this.teamRing, this.selRing, this.actRing);
    this.pos = new THREE.Vector3(sq.x, 0, sq.z);
    this.yaw = Math.atan2(sq.fx, sq.fz);
    this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
    layer.add(this.group);
    this.layer = layer;
    this.walk = 0;
  }

  // world positions of the living minis' weapon hands (for projectiles), given a pose
  muzzles(x, z, fx, fz, models) {
    const yaw = Math.atan2(fx, fz), c = Math.cos(yaw), s = Math.sin(yaw);
    const out = [];
    for (let i = 0; i < Math.min(models, this.slots.length); i++) {
      const sl = this.slots[i];
      const lx = sl.x + 0.1, lz = sl.z + 0.45;
      out.push({ x: x + lx * c + lz * s, y: 1.0, z: z - lx * s + lz * c });
    }
    return out;
  }

  // d: display squad {x,z,fx,fz,models,moving,atk:{T0,T1,now},struck,dying,selected,acting,ghost}
  update(d, dt, time, snap = false) {
    const target = new THREE.Vector3(d.x, 0, d.z);
    const moved = this.pos.distanceTo(target);
    if (snap) this.pos.copy(target); else this.pos.lerp(target, Math.min(1, dt * 14));
    const ty = Math.atan2(d.fx, d.fz);
    let dy = ty - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += snap ? dy : dy * Math.min(1, dt * 9);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.visible = d.visible !== false;
    const marching = (moved > 0.004 && !snap) || d.moving;
    this.walk = marching ? this.walk + dt * 9 : 0;

    const struckK = d.struck !== undefined && d.struck < 5 ? 1 - d.struck / 5 : 0;
    for (let i = 0; i < this.minis.length; i++) {
      const m = this.minis[i], g = m.g, sl = this.slots[i];
      const shouldLive = i < d.models;
      if (shouldLive && !m.alive) { m.alive = true; m.fall = -1; g.visible = true; g.userData.shadow.visible = true; g.rotation.set(0, g.rotation.y, 0); m.mat.opacity = 1; m.mat.transparent = false; }
      if (!shouldLive && m.alive) { m.alive = false; m.fall = snap ? 2 : 0; }
      if (!m.alive) {
        // topple sideways, bounce once, lie for a moment, then fade away
        m.fall = Math.min(2, m.fall + dt * 1.1);
        const f = Math.min(1, m.fall * 2.2);
        const ang = f < 1 ? f * f * 1.45 : 1.45 - Math.sin(Math.min(1, (m.fall * 2.2 - 1) * 2.5) * Math.PI) * 0.12;
        g.rotation.z = m.side * ang;
        g.position.set(sl.x + m.side * Math.sin(ang) * 0.25, Math.sin(ang) * 0.18, sl.z);
        const fade = Math.max(0, (m.fall - 1.3) / 0.7);
        if (fade > 0) { m.mat.transparent = true; m.mat.opacity = 1 - fade; }
        g.visible = m.fall < 2 || !!d.showFallen;
        g.userData.shadow.visible = m.fall < 0.3;
        continue;
      }
      // attack pose (staggered per model), else rest
      let q = POSES[this.style].rest;
      if (d.atk) q = attackPose(this.style, d.atk.T0, d.atk.T1, d.atk.now - m.stagger, LEAD[this.style] || 1.5);
      const hopPh = this.walk + i * 1.7;
      const hop = marching ? Math.abs(Math.sin(hopPh)) * 0.09 : 0;
      poseMini(g, q, hop, time);
      // hit reaction: jolt back and tilt, with a flash
      const jolt = struckK * struckK;
      g.position.set(sl.x, 0, sl.z - jolt * 0.16);
      g.rotation.x = -jolt * 0.22;
      g.rotation.z = marching ? Math.sin(hopPh) * 0.07 : 0;
      m.mat.emissive.copy(BLACK).lerp(WHITE, struckK > 0 ? 0.32 * struckK * (0.6 + 0.4 * Math.sin(time * 40)) : 0);
    }
    this.selRing.visible = !!d.selected;
    this.actRing.visible = !!d.acting;
    if (d.acting) this.actRing.scale.setScalar(1 + 0.06 * Math.sin(time * 8));
    const op = d.ghost ? 0.4 : 1;
    if (this.op !== op) {
      this.op = op;
      for (const m of this.minis) { m.mat.transparent = op < 1; m.mat.opacity = op; m.mat.depthWrite = op === 1; m.g.traverse(o => { if (o.isMesh) o.castShadow = op === 1; }); }
    }
    if (d.dying !== undefined) this.teamRing.material.opacity = 0.5 * (1 - Math.min(1, d.dying));
    else this.teamRing.material.opacity = 0.5;
  }

  // world position of the squad label anchor
  top() {
    let h = 0;
    for (const m of this.minis) h = Math.max(h, m.g.userData.height || 1.4);
    return { x: this.pos.x, y: h + 0.5, z: this.pos.z };
  }

  destroy() {
    this.layer.remove(this.group);
    // geometries are shared (cached per mini type); only materials belong to this squad
    this.group.traverse(o => { if (o.material) o.material.dispose(); });
  }
}
