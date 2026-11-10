// Visual effects for resolution events + floating HTML text.
import * as THREE from 'three';
import { ribbon, ring, disc, PALETTE } from './models.js';
import { CONFIG } from '../config.js';

export class FloatTexts {
  constructor(layer, view) { this.layer = layer; this.view = view; this.items = []; }
  add(x, z, text, cls = '', y = 1.6) {
    const el = document.createElement('div');
    el.className = 'ftext ' + cls;
    el.textContent = text;
    this.layer.appendChild(el);
    this.items.push({ el, x, z, y, t: 0, life: cls.includes('long') ? 1.8 : 1.1 });
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

const WHITE = 0xffffff, BLACK = 0x0a0a0a;

export function eventFx(view, texts, e, ctx) {
  const { disp, vis } = ctx;
  const ent = id => disp.units.get(id) || disp.buildings.get(id);
  const teamInk = owner => (owner === 0 ? BLACK : WHITE);
  switch (e.type) {
    case 'shot': {
      if (!vis(e.ax, e.az) && !vis(e.bx, e.bz)) return;
      const src = ent(e.id);
      const col = src ? (src.owner === 0 ? BLACK : WHITE) : BLACK;
      const m = ribbon([{ x: e.ax, z: e.az }, { x: e.bx, z: e.bz }], e.ow ? 0.08 : 0.12, col, 1, 0, 0.7);
      view.addFx(m, 0.45, (o, k) => { o.material.opacity = 1 - k; });
      const hit = disc(0.25, PALETTE.accent, 1, 0.72); hit.position.x = e.bx; hit.position.z = e.bz;
      view.addFx(hit, 0.3, (o, k) => { o.scale.setScalar(1 + k * 2); o.material.opacity = 1 - k; });
      if (e.ow && src) texts.add(e.ax, e.az, 'Overwatch', 'tag');
      break;
    }
    case 'frag': {
      if (!vis(e.x, e.z) && !vis(e.ax, e.az)) return;
      // projectile arc
      const ball = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: BLACK }));
      view.addFx(ball, 0.35, (o, k) => { o.position.set(e.ax + (e.x - e.ax) * k, 0.8 + Math.sin(k * Math.PI) * 3, e.az + (e.z - e.az) * k); });
      setTimeout(() => {
        const r1 = ring(e.r, 0.25, PALETTE.accent, 1, 0.08); r1.position.x = e.x; r1.position.z = e.z;
        view.addFx(r1, 0.6, (o, k) => { o.scale.setScalar(0.3 + k * 0.8); o.material.opacity = 1 - k; });
        const d = disc(e.r, BLACK, 0.35, 0.06); d.position.x = e.x; d.position.z = e.z;
        view.addFx(d, 0.8, (o, k) => { o.material.opacity = 0.35 * (1 - k); });
      }, 330);
      break;
    }
    case 'hit': {
      const t = ent(e.dst); if (!t) return;
      if (!vis(t.x, t.z) && t.owner !== ctx.me) return;
      const cls = 'dmg' + (e.defended ? ' def' : '') + (t.owner === ctx.me ? ' mine' : '');
      texts.add(t.x, t.z, '-' + e.dmg + (e.cover ? ' ▣' : e.defended ? ' ◇' : ''), cls);
      break;
    }
    case 'parry': {
      const t = ent(e.id); if (!t || !vis(t.x, t.z)) return;
      const r1 = ring(0.8, 0.12, teamInk(t.owner), 1, 0.4); r1.position.x = t.x; r1.position.z = t.z;
      view.addFx(r1, 0.5, (o, k) => { o.scale.setScalar(1 + k); o.material.opacity = 1 - k; });
      texts.add(t.x, t.z, 'PARRY', 'tag big');
      break;
    }
    case 'death': {
      const t = ent(e.id); if (!t || (!vis(t.x, t.z) && t.owner !== ctx.me)) return;
      const r1 = ring(0.6, 0.18, PALETTE.accent, 1, 0.1); r1.position.x = t.x; r1.position.z = t.z;
      view.addFx(r1, 0.7, (o, k) => { o.scale.setScalar(1 + k * 2); o.material.opacity = 1 - k; });
      texts.add(t.x, t.z, '✕', 'tag big', 2);
      break;
    }
    case 'bdestroy': {
      const t = ent(e.id); if (!t) return;
      const r1 = ring(1.5, 0.3, PALETTE.accent, 1, 0.1); r1.position.x = t.x; r1.position.z = t.z;
      view.addFx(r1, 1.0, (o, k) => { o.scale.setScalar(1 + k * 2); o.material.opacity = 1 - k; });
      texts.add(t.x, t.z, 'DESTROYED', 'tag big long', 3);
      break;
    }
    case 'skill': {
      const t = ent(e.id); if (!t || !vis(t.x, t.z)) return;
      const names = { dash: 'Dash', shove: 'Shove', frag: 'Frag', fortify: 'Fortify', disrupt: 'Disrupt' };
      texts.add(t.x, t.z, names[e.skill] || e.skill, 'tag', 2.2);
      break;
    }
    case 'cancel': {
      const t = ent(e.id); if (!t || (t.owner !== ctx.me && !vis(t.x, t.z))) return;
      texts.add(t.x, t.z, '⊘ ' + e.reason, 'tag small long', 2.2);
      break;
    }
    case 'disrupt': {
      if (!vis(e.ax, e.az) && !vis(e.bx, e.bz)) return;
      const m = ribbon([{ x: e.ax, z: e.az }, { x: e.bx, z: e.bz }], 0.1, PALETTE.accent, 1, 0.25, 0.9);
      view.addFx(m, 0.8, (o, k) => { o.material.opacity = 1 - k; });
      texts.add(e.bx, e.bz, `-${e.drained} AP${e.tierNow ? ' · tier −1' : ' · tier −1 next'}`, 'tag long', 2.2);
      break;
    }
    case 'zoneoff': break;
    case 'spawn': {
      if (!vis(e.x, e.z) && e.owner !== ctx.me) return;
      const r1 = ring(0.7, 0.1, teamInk(e.owner), 1, 0.06); r1.position.x = e.x; r1.position.z = e.z;
      view.addFx(r1, 0.8, (o, k) => { o.scale.setScalar(0.5 + k); o.material.opacity = 1 - k; });
      if (e.revive) texts.add(e.x, e.z, 'Commander revived', 'tag long');
      break;
    }
    case 'capture': {
      const n = ctx.nodes.find(x => x.id === e.node); if (!n) return;
      const r1 = ring(CONFIG.economy.nodeRadius, 0.2, teamInk(e.owner), 1, 0.06); r1.position.x = n.x; r1.position.z = n.z;
      view.addFx(r1, 0.9, (o, k) => { o.material.opacity = 1 - k; });
      texts.add(n.x, n.z, e.owner === ctx.me ? 'Node captured' : 'Node lost', 'tag long', 2);
      break;
    }
    case 'heal': {
      const t = ent(e.id); if (!t || t.owner !== ctx.me || e.regen) return;
      texts.add(t.x, t.z, '+' + e.amount, 'heal');
      break;
    }
    case 'built': {
      const t = ent(e.id); if (!t || t.owner !== ctx.me) return;
      texts.add(t.x, t.z, 'Built', 'tag', 2);
      break;
    }
  }
}
