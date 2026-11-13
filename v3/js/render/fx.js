// Visual effects for resolution events + floating HTML text.
// Every kind of effect has its own colour (see FX below and Help → Colours & icons).
import * as THREE from 'three';
import { ribbon, ring, disc, arrow, PALETTE } from './models.js';
import { CONFIG } from '../config.js';

export const FX = {
  damage: 0xff4a1c,   // orange
  defend: 0x3fa9ff,   // blue
  cover: 0x2ec4b6,    // teal
  parry: 0xffc400,    // gold
  overwatch: 0xff2d55,// red
  zone: 0xa86bff,     // purple
  tier: 0x9be15d,     // lime
  dash: 0x3ee6ff,     // cyan
  frag: 0xff6a00,     // orange-red
  sweep: 0xff4fd8,    // magenta
  disrupt: 0xd9b8ff,  // violet-white
  fortify: 0x7aa7c7,  // steel blue
  shove: 0xffb020,    // amber
  heal: 0x34c759,     // green
  build: 0xffb020,    // amber
  grey: 0x9a9a9a,
};

export class FloatTexts {
  constructor(layer, view) { this.layer = layer; this.view = view; this.items = []; this.stack = new Map(); }
  add(x, z, text, cls = '', y = 1.6) {
    // stack texts that appear on the same spot at the same moment so they don't overlap
    const key = Math.round(x * 2) + ',' + Math.round(z * 2);
    const now = performance.now();
    const st = this.stack.get(key);
    const n = st && now - st.t < 450 ? st.n + 1 : 0;
    this.stack.set(key, { t: now, n });
    const el = document.createElement('div');
    el.className = 'ftext ' + cls;
    if (text.includes('<svg')) el.innerHTML = text; else el.textContent = text;
    this.layer.appendChild(el);
    this.items.push({ el, x, z, y: y + n * 0.55, t: 0, life: cls.includes('long') ? 1.9 : 1.3 });
  }
  update(dt) {
    for (const it of [...this.items]) {
      it.t += dt;
      if (it.t >= it.life) { it.el.remove(); this.items.splice(this.items.indexOf(it), 1); continue; }
      const p = this.view.project(it.x, it.y + it.t * 0.7, it.z);
      it.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      it.el.style.opacity = String(Math.min(1, 2.5 * (1 - it.t / it.life)));
    }
  }
  clear() { for (const it of this.items) it.el.remove(); this.items = []; }
}

const WHITE = 0xffffff, BLACK = 0x0a0a0a;
const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

function pulse(view, x, z, r, color, life = 0.7, width = 0.14, grow = 1.2) {
  const m = ring(r, width, color, 1, 0.08); m.position.set(x, 0.08, z);
  view.addFx(m, life, (o, k) => { o.scale.setScalar(1 + k * grow); o.material.opacity = 1 - k; });
}
function burst(view, x, z, color, n = 8, len = 0.9, y = 0.9) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), basic(color));
    m.position.set(Math.cos(a) * len * 0.6, 0, Math.sin(a) * len * 0.6); m.rotation.y = -a;
    g.add(m);
  }
  g.position.set(x, y, z);
  view.addFx(g, 0.45, (o, k) => { o.scale.setScalar(0.5 + k * 1.2); o.children.forEach(c => { c.material.opacity = 1 - k; }); });
}
function dome(view, x, z, color) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), basic(color, 0.45));
  m.position.set(x, 0.05, z);
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.86, 1)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  e.position.set(x, 0.05, z); e.scale.y = 0.95;
  view.addFx(m, 0.7, (o, k) => { o.scale.setScalar(0.7 + Math.min(1, k * 4) * 0.45); o.material.opacity = 0.45 * (1 - k); });
  view.addFx(e, 0.7, (o, k) => { o.scale.setScalar(0.7 + Math.min(1, k * 4) * 0.45); o.material.opacity = 0.9 * (1 - k); });
}
function slash(view, x, z, color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24, 1, 0, Math.PI * 0.9), basic(color));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.7, z);
  view.addFx(m, 0.5, (o, k) => { o.rotation.z = k * 4; o.material.opacity = 1 - k; });
}
function lightning(view, a, b, color) {
  const pts = [{ x: a.x, z: a.z }];
  const n = 7;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push({ x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 0.7, z: a.z + (b.z - a.z) * t + (Math.random() - 0.5) * 0.7 });
  }
  pts.push({ x: b.x, z: b.z });
  const m = ribbon(pts, 0.12, color, 1, 0, 0.9);
  view.addFx(m, 0.7, (o, k) => { o.material.opacity = k < 0.5 ? (Math.random() > 0.3 ? 1 : 0.3) : 1 - k; });
}

export function eventFx(view, texts, e, ctx) {
  const { disp, vis } = ctx;
  const ent = id => disp.units.get(id) || disp.buildings.get(id);
  const seen = t => t && (t.owner === ctx.me || vis(t.x, t.z));
  const teamInk = owner => (owner === 0 ? BLACK : WHITE);
  switch (e.type) {
    case 'shot': {
      if (!vis(e.ax, e.az) && !vis(e.bx, e.bz)) return;
      const src = ent(e.id);
      const col = e.ow ? FX.overwatch : e.turret ? FX.build : src ? teamInk(src.owner) : BLACK;
      const m = ribbon([{ x: e.ax, z: e.az }, { x: e.bx, z: e.bz }], e.ow ? 0.16 : 0.11, col, 1, 0, 0.7);
      view.addFx(m, e.ow ? 0.7 : 0.45, (o, k) => { o.material.opacity = 1 - k; });
      const hit = disc(0.25, e.ow ? FX.overwatch : FX.damage, 1, 0.72); hit.position.x = e.bx; hit.position.z = e.bz;
      view.addFx(hit, 0.3, (o, k) => { o.scale.setScalar(1 + k * 2); o.material.opacity = 1 - k; });
      if (e.ow) {
        const flash = disc(0.45, FX.overwatch, 1, 0.75); flash.position.set(e.ax, 0.75, e.az);
        view.addFx(flash, 0.35, (o, k) => { o.scale.setScalar(1 + k); o.material.opacity = 1 - k; });
        texts.add(e.ax, e.az, '◉ OVERWATCH', 'tag c-ow', 2.3);
      }
      break;
    }
    case 'frag': {
      if (!vis(e.x, e.z) && !vis(e.ax, e.az)) return;
      const ball = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: FX.frag }));
      view.addFx(ball, 0.35, (o, k) => { o.position.set(e.ax + (e.x - e.ax) * k, 0.8 + Math.sin(k * Math.PI) * 3, e.az + (e.z - e.az) * k); });
      setTimeout(() => {
        pulse(view, e.x, e.z, e.r * 0.5, FX.frag, 0.6, 0.3, 1.6);
        const d = disc(e.r, FX.frag, 0.4, 0.06); d.position.x = e.x; d.position.z = e.z;
        view.addFx(d, 0.8, (o, k) => { o.material.opacity = 0.4 * (1 - k); });
      }, 330);
      break;
    }
    case 'hit': {
      const t = ent(e.dst); if (!t || !seen(t)) return;
      const mine = t.owner === ctx.me;
      texts.add(t.x, t.z, '−' + e.dmg, 'dmg' + (mine ? ' mine' : ''));
      if (e.cover) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.2), basic(FX.cover, 0.8));
        w.position.set(t.x, 0.6, t.z);
        view.addFx(w, 0.6, (o, k) => { o.material.opacity = 0.8 * (1 - k); o.scale.setScalar(0.8 + k * 0.4); });
        texts.add(t.x, t.z, `▣ COVER ${e.blocked ? '−' + e.blocked + ' blocked' : ''}`, 'tag c-cover', 2.5);
      } else if (e.defended) {
        dome(view, t.x, t.z, FX.defend);
        texts.add(t.x, t.z, `⛨ BLOCKED ${e.blocked || ''}`, 'tag c-def', 2.5);
      }
      if (e.kind === 'counter') { slash(view, t.x, t.z, FX.parry); texts.add(t.x, t.z, '⚔ COUNTER', 'tag c-parry', 2.9); }
      if (e.kind === 'shove') {
        const s = ent(e.src);
        if (s) { const dx = t.x - s.x, dz = t.z - s.z, l = Math.hypot(dx, dz) || 1; view.addFx(arrow(t, { x: t.x + dx / l * 2.2, z: t.z + dz / l * 2.2 }, 0.16, FX.shove, 0, 0.1), 0.8, (o, k) => { o.traverse(c => { if (c.material) c.material.opacity = 1 - k; }); }); }
        texts.add(t.x, t.z, '➜ SHOVED', 'tag c-shove', 2.9);
      }
      const fl = disc(0.55, FX.damage, 0.6, 0.06); fl.position.set(t.x, 0.06, t.z);
      view.addFx(fl, 0.25, (o, k) => { o.material.opacity = 0.6 * (1 - k); });
      break;
    }
    case 'parry': {
      const t = ent(e.id); if (!seen(t)) return;
      burst(view, t.x, t.z, FX.parry, 10, 0.9);
      pulse(view, t.x, t.z, 0.8, FX.parry, 0.5, 0.14, 0.8);
      texts.add(t.x, t.z, '✦ PARRY', 'tag big c-parry', 2.3);
      break;
    }
    case 'death': {
      const t = ent(e.id); if (!seen(t)) return;
      pulse(view, t.x, t.z, 0.6, FX.damage, 0.7, 0.18, 2);
      texts.add(t.x, t.z, '✕ KILLED', 'tag big', 2.2);
      break;
    }
    case 'bdestroy': {
      const t = ent(e.id); if (!t) return;
      pulse(view, t.x, t.z, 1.5, FX.damage, 1.0, 0.3, 2);
      texts.add(t.x, t.z, 'DESTROYED', 'tag big long', 3);
      break;
    }
    case 'skill': {
      const t = ent(e.id); if (!seen(t)) return;
      const col = { dash: 'c-dash', shove: 'c-shove', frag: 'c-frag', fortify: 'c-fort', disrupt: 'c-disrupt', sweep: 'c-sweep', rally: 'c-tier' }[e.skill] || '';
      const hex = { dash: FX.dash, shove: FX.shove, frag: FX.frag, fortify: FX.fortify, disrupt: FX.disrupt, sweep: FX.sweep, rally: FX.tier }[e.skill] || WHITE;
      pulse(view, t.x, t.z, 0.75, hex, 0.6, 0.1, 0.4); // cast circle
      if (e.skill === 'fortify') { pulse(view, t.x, t.z, 0.9, FX.fortify, 0.9, 0.18, 0.2); dome(view, t.x, t.z, FX.fortify); texts.add(t.x, t.z, '⛨ FORTIFY +2 DEF', 'tag c-fort long', 2.9); break; }
      texts.add(t.x, t.z, '★ ' + (e.name || e.skill).toUpperCase(), 'tag big ' + col, 2.9);
      break;
    }
    case 'act': {
      const t = ent(e.id); if (!seen(t)) return;
      if (e.kind === 'dash' && e.x !== undefined) {
        const dx = e.x - t.x, dz = e.z - t.z, l = Math.hypot(dx, dz) || 1, L = CONFIG.units.assassin.skills[0].length;
        const m = ribbon([{ x: t.x, z: t.z }, { x: t.x + dx / l * L, z: t.z + dz / l * L }], 0.5, FX.dash, 0.55, 0, 0.1);
        view.addFx(m, 0.9, (o, k) => { o.material.opacity = 0.55 * (1 - k); });
        return;
      }
      const labels = { move: 'Move', attack: 'Attack', shoot: 'Shoot' };
      const lab = labels[e.kind];
      if (!lab) return;
      let txt = lab;
      if (e.target && (e.kind === 'attack' || e.kind === 'move')) {
        const tg = ent(e.target);
        if (tg && seen(tg)) txt += ' → ' + (tg.id[0] === 'u' ? CONFIG.units[tg.type].name : CONFIG.buildings[tg.type].name);
      }
      texts.add(t.x, t.z, txt, 'tag act', 3.1);
      break;
    }
    case 'sweep': {
      if (!vis(e.x, e.z)) return;
      const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.1, e.r - 0.35), e.r, 32, 1, 0, Math.PI * 1.4), basic(FX.sweep, 0.9));
      m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.12, e.z);
      view.addFx(m, 0.6, (o, k) => { o.rotation.z = k * 9; o.material.opacity = 0.9 * (1 - k); });
      pulse(view, e.x, e.z, e.r, FX.sweep, 0.6, 0.1, 0.2);
      break;
    }
    case 'rally': {
      if (!vis(e.x, e.z)) return;
      pulse(view, e.x, e.z, 0.6, FX.tier, 1.1, 0.2, (e.r / 0.6) - 1);
      for (const id of e.ids || []) { const u = ent(id); if (u && id !== e.id) texts.add(u.x, u.z, '⏫ RALLIED +1 TIER', 'tag small c-tier', 2.3); }
      break;
    }
    case 'tier': {
      if (!e.upgrades) return;
      const t = ent(e.id); if (!seen(t)) return;
      for (let i = 0; i < 3; i++) {
        const m = ribbon([{ x: t.x - 0.5 + i * 0.5, z: t.z + 0.9 }, { x: t.x - 0.5 + i * 0.5, z: t.z - 0.9 }], 0.06, FX.tier, 0.9, 0, 0.12 + i * 0.01);
        view.addFx(m, 0.7, (o, k) => { o.position.z = -k * 1.5; o.material.opacity = 0.9 * (1 - k); });
      }
      texts.add(t.x, t.z, `⏫ +${e.upgrades} TIER → ${e.tier}`, 'tag c-tier', 2.6);
      break;
    }
    case 'slowed': {
      const t = ent(e.id); if (!seen(t)) return;
      pulse(view, t.x, t.z, 0.7, FX.zone, 0.8, 0.12, 0.3);
      texts.add(t.x, t.z, '◌ SLOWED (zone)', 'tag small c-zone', 2.5);
      break;
    }
    case 'zoneoff': {
      const t = ent(e.id); if (!seen(t)) return;
      const z = CONFIG.units[t.type]?.zone || 2;
      pulse(view, t.x, t.z, z, FX.zone, 0.7, 0.08, 0.35);
      break;
    }
    case 'cancel': {
      const t = ent(e.id); if (!t || !seen(t)) return;
      texts.add(t.x, t.z, '⊘ ' + e.reason, 'tag small long c-grey', 2.2);
      break;
    }
    case 'miss': {
      const t = ent(e.id); if (!seen(t)) return;
      texts.add(t.x, t.z, 'MISS', 'tag c-grey', 2.4);
      break;
    }
    case 'apreturn': {
      const t = ent(e.id); if (!t || t.owner !== ctx.me || !e.ap) return;
      texts.add(t.x, t.z, `+${e.ap} AP back${e.to ? ' → ' + e.to : ''}`, 'tag small c-tier', 2.0);
      break;
    }
    case 'disrupt': {
      if (!vis(e.ax, e.az) && !vis(e.bx, e.bz)) return;
      lightning(view, { x: e.ax, z: e.az }, { x: e.bx, z: e.bz }, FX.disrupt);
      texts.add(e.bx, e.bz, `ϟ −${e.drained} AP · tier −1${e.tierNow ? '' : ' next round'}`, 'tag long c-disrupt', 2.4);
      break;
    }
    case 'spawn': {
      if (!vis(e.x, e.z) && e.owner !== ctx.me) return;
      pulse(view, e.x, e.z, 0.7, WHITE, 0.8, 0.1, 1);
      if (e.revive) texts.add(e.x, e.z, 'Commander revived', 'tag long');
      break;
    }
    case 'build': {
      if (e.owner !== ctx.me && !vis(e.x, e.z)) return;
      pulse(view, e.x, e.z, 1.2, FX.build, 0.9, 0.12, 0.5);
      break;
    }
    case 'capture': {
      const n = ctx.nodes.find(x => x.id === e.node); if (!n) return;
      pulse(view, n.x, n.z, CONFIG.economy.nodeRadius, teamInk(e.owner), 0.9, 0.2, 0);
      texts.add(n.x, n.z, e.owner === ctx.me ? 'Node captured' : 'Node lost', 'tag long', 2);
      break;
    }
    case 'heal': {
      const t = ent(e.id); if (!t || t.owner !== ctx.me) return;
      pulse(view, t.x, t.z, 0.6, FX.heal, 0.7, 0.1, 0.5);
      texts.add(t.x, t.z, '+' + e.amount, 'heal');
      break;
    }
    case 'built': {
      const t = ent(e.id); if (!t || t.owner !== ctx.me) return;
      pulse(view, t.x, t.z, 1.4, FX.build, 1, 0.16, 0.4);
      texts.add(t.x, t.z, 'Built', 'tag c-build', 2);
      break;
    }
  }
}
