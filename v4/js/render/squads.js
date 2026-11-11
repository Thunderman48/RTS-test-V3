// Squad rendering: minis in formation, models falling as the squad takes losses,
// lunge on attacks, bob while marching, team ring + selection ring.
import * as THREE from 'three';
import { FACTIONS, PAINT, squadRadius } from '../data/units.js';
import { makeMini, formation } from './minis.js';

export function ringMesh(r, w, color, opacity = 1) {
  const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, r - w / 2), r + w / 2, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 3;
  return m;
}

export class SquadView {
  constructor(sq, layer) {
    this.id = sq.id;
    const def = FACTIONS[sq.faction].units[sq.role];
    this.def = def;
    this.group = new THREE.Group();
    this.slots = formation(def.models, def.look);
    this.minis = this.slots.map((s, i) => {
      const m = makeMini(def.look, sq.faction);
      m.position.set(s.x, 0, s.z);
      m.rotation.y = ((i * 37) % 11 - 5) * 0.02;
      this.group.add(m);
      return { mesh: m, alive: i < sq.models, fall: i < sq.models ? -1 : 1 };
    });
    this.rimColor = PAINT[sq.faction].rim;
    this.teamRing = ringMesh(squadRadius(def, def.models) + 0.1, 0.07, this.rimColor, 0.55);
    this.teamRing.position.y = 0.03;
    this.selRing = ringMesh(squadRadius(def, def.models) + 0.3, 0.12, 0xffffff, 0.95);
    this.selRing.position.y = 0.04; this.selRing.visible = false;
    this.actRing = ringMesh(squadRadius(def, def.models) + 0.45, 0.1, 0xffc400, 1);
    this.actRing.position.y = 0.05; this.actRing.visible = false;
    this.group.add(this.teamRing, this.selRing, this.actRing);
    this.pos = new THREE.Vector3(sq.x, 0, sq.z);
    this.yaw = Math.atan2(sq.fx, sq.fz);
    this.group.position.copy(this.pos); this.group.rotation.y = this.yaw;
    this.models = sq.models;
    layer.add(this.group);
    this.layer = layer;
  }

  // d: display squad {x,z,fx,fz,models,moving,lunge,flash,dying,selected,acting,visible,ghost}
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
    // casualties: models beyond the alive count fall over (back ranks first)
    for (let i = 0; i < this.minis.length; i++) {
      const m = this.minis[i];
      const shouldLive = i < d.models;
      if (shouldLive && !m.alive) { m.alive = true; m.fall = -1; m.mesh.visible = true; m.mesh.rotation.x = 0; m.mesh.position.y = 0; }
      if (!shouldLive && m.alive) { m.alive = false; m.fall = snap ? 1 : 0; }
      if (!m.alive) {
        if (m.fall < 1) m.fall = Math.min(1, m.fall + dt * 1.6);
        m.mesh.rotation.x = -Math.min(1.5, m.fall * 1.8);
        m.mesh.position.y = -Math.max(0, m.fall - 0.6) * 0.6;
        m.mesh.visible = m.fall < 1 || !!d.showFallen;
      }
    }
    // march bob / lunge / hit shake
    const marching = moved > 0.002 || d.moving;
    const lunge = d.lunge || 0;
    for (let i = 0; i < this.minis.length; i++) {
      const m = this.minis[i];
      if (!m.alive) continue;
      const s = this.slots[i];
      const bob = marching ? Math.abs(Math.sin(time * 9 + i * 1.3)) * 0.08 : 0;
      const shake = d.flash ? Math.sin(time * 60 + i) * 0.05 * d.flash : 0;
      m.mesh.position.set(s.x + shake, bob, s.z + lunge * 0.45);
      m.mesh.rotation.x = -lunge * 0.25;
    }
    this.selRing.visible = !!d.selected;
    this.actRing.visible = !!d.acting;
    if (d.acting) this.actRing.scale.setScalar(1 + 0.06 * Math.sin(time * 8));
    const op = d.ghost ? 0.4 : 1;
    if (this.op !== op) {
      this.op = op;
      for (const m of this.minis) { m.mesh.material.transparent = op < 1; m.mesh.material.opacity = op; m.mesh.material.depthWrite = op === 1; m.mesh.castShadow = op === 1; }
    }
    if (d.dying !== undefined) {
      const k = Math.min(1, d.dying);
      this.teamRing.material.opacity = 0.55 * (1 - k);
    }
  }

  // world position of the squad label anchor
  top() { return { x: this.pos.x, y: (this.def.models === 1 ? 2.4 : 1.9), z: this.pos.z }; }

  destroy() {
    this.layer.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
