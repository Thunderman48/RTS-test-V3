// V4 game controller.
import * as THREE from 'three';
import { RULES, FACTIONS, ROLE_ORDER } from './data/units.js';
import { createGame, defOf, radiusOf, apFor } from './sim/state.js';
import { planCost, actionCost } from './sim/orders.js';
import { resolveRound, arcHits } from './sim/resolve.js';
import { segCircle } from './sim/geom.js';
import { aiOrders, aiMemory } from './ai/ai.js';
import { View } from './render/view.js';
import { buildTable } from './render/table.js';
import { SquadView, LEAD } from './render/squads.js';
import { makeMini, poseMini, attackPose, POSES } from './render/minis.js';
import { Timeline, SEC_PER_AP } from './render/timeline.js';
import { ribbon, chevrons, ring, disc, arcShape, lineShape, Telegraphs, FloatTexts, Projectiles, COL } from './render/fx.js';
import { Input } from './ui/input.js';
import { Planner } from './ui/planner.js';
import { icon } from './ui/iconset.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEAM = ['#3a78d8', '#9b59d0'];

class Game {
  constructor() {
    this.canvas = $('c');
    this.view = new View(this.canvas);
    this.texts = new FloatTexts($('fx-layer'), this.view);
    this.tele = new Telegraphs(this.view);
    this.shots = new Projectiles(this.view);
    this.planner = new Planner(this);
    this.views = new Map();
    this.labels = new Map();
    this.phase = 'menu';
    this.selected = null;
    this.mode = 'move';
    this.speed = 1;
    this.input = new Input(this.canvas, this.view, {
      tap: (x, y) => this.onTap(x, y),
      dragStart: (x, y) => this.dragStart(x, y),
      dragMove: (x, y) => this.dragMove(x, y),
      dragEnd: (x, y, moved) => this.dragEnd(x, y, moved),
      key: e => this.onKey(e),
    });
    this.bindDOM();
    try { new ResizeObserver(() => document.documentElement.style.setProperty('--pb-h', $('playbar').offsetHeight + 'px')).observe($('playbar')); } catch {}
    if (/gallery/.test(location.search)) { this.gallery(); return; }
    // menu backdrop: the board with both armies
    this.state = createGame(1);
    buildTable(this.view, this.state.terrain);
    this.syncViews(this.state.squads.map(q => ({ ...q })), true);
    this.view.cam = { x: 24, z: 16, dist: 44, yaw: 0.25, pitch: 0.82 };
    this.last = performance.now();
    this.loop();
  }

  // debug view: every miniature lined up (?gallery), animating attacks (?gallery=anim)
  gallery() {
    $('menu').classList.add('hidden');
    if (this.view.lens) this.view.lens.enabled = /lens/.test(location.search);
    this.state = createGame(1);
    buildTable(this.view, this.state.terrain);
    const looks = [['kingdom', 'lord'], ['kingdom', 'shield'], ['kingdom', 'sword'], ['kingdom', 'crossbow'], ['kingdom', 'rider'], ['undead', 'necro'], ['undead', 'graveguard'], ['undead', 'skeleton'], ['undead', 'archer'], ['undead', 'wraith']];
    const minis = looks.map(([f, l], i) => { const m = makeMini(l, f, i + 1); m.position.set(5 + (i % 5) * 1.6, 0, 28 + Math.floor(i / 5) * 2.2); this.view.layers.units.add(m); return m; });
    const anim = /anim/.test(location.search);
    this.view.cam = { x: 8.2, z: 29.6, dist: 9, yaw: 0, pitch: 0.42 };
    const tick = () => {
      requestAnimationFrame(tick);
      const t = this.view.time || 0;
      for (const m of minis) {
        const st = m.userData.rig.style;
        const now = window.galleryT ?? (t * 20) % 45;
        poseMini(m, anim || window.galleryT !== undefined ? attackPose(st, 5, 30, now, LEAD[st] || 1.5) : POSES[st].rest, 0, t);
      }
      this.view.render(1 / 60);
    };
    window.galleryMinis = minis;
    tick();
  }

  bindDOM() {
    $('m-kingdom').onclick = () => this.start('kingdom');
    $('m-undead').onclick = () => this.start('undead');
    $('b-ready').onclick = () => this.ready();
    $('b-help').onclick = () => { $('help-body').innerHTML = helpHTML(); $('help').classList.remove('hidden'); };
    $('help-close').onclick = () => $('help').classList.add('hidden');
    $('b-menu').onclick = () => $('opts').classList.remove('hidden');
    $('o-close').onclick = () => $('opts').classList.add('hidden');
    $('o-quit').onclick = () => location.reload();
    $('o-lens').onclick = $('m-lens').onclick = () => this.setLens(!this.lensOn);
    let saved = null; try { saved = localStorage.getItem('tiers-v4-lens'); } catch {}
    this.setLens(saved !== '0', false);
    $('pb-play').onclick = () => { this.playing = !this.playing; if (this.playing && this.T >= this.tl.total) this.T = 0; };
    $('pb-speed').onclick = () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : this.speed === 4 ? 0.5 : 1; $('pb-speed').textContent = this.speed + '×'; };
    $('pb-next').onclick = () => this.finishPlayback();
    const scrub = $('scrub');
    const seek = e => { const r = scrub.getBoundingClientRect(); this.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.tl.total); };
    scrub.addEventListener('pointerdown', e => { scrub.setPointerCapture(e.pointerId); this.scrubbing = true; this.playing = false; seek(e); });
    scrub.addEventListener('pointermove', e => { if (this.scrubbing) seek(e); });
    scrub.addEventListener('pointerup', () => { this.scrubbing = false; });
  }

  setLens(on, save = true) {
    this.lensOn = on;
    if (this.view.lens) this.view.lens.enabled = on;
    for (const id of ['o-lens', 'm-lens']) $(id)?.classList.toggle('on', on);
    if (save) try { localStorage.setItem('tiers-v4-lens', on ? '1' : '0'); } catch {}
  }

  toast(msg, warn = false) {
    const box = $('toast');
    if (this.lastToast === msg && performance.now() - this.lastToastT < 1500) return;
    this.lastToast = msg; this.lastToastT = performance.now();
    const el = document.createElement('div'); el.className = 'toast-item' + (warn ? ' warn' : ''); el.textContent = msg;
    box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 2800);
  }

  // ======================================================================== match flow
  start(faction) {
    this.me = faction === 'kingdom' ? 0 : 1;
    this.ai = 1 - this.me;
    document.documentElement.style.setProperty('--me', TEAM[this.me]);
    $('crest').style.background = TEAM[this.me];
    this.state = createGame((Math.random() * 1e9) | 0, ['kingdom', 'undead']);
    this.memory = aiMemory(this.state);
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.syncViews(this.state.squads.map(q => ({ ...q })), true);
    const portrait = innerHeight > innerWidth;
    const homeX = this.me === 0 ? 14 : 34;
    this.view.cam = { x: homeX, z: 16, dist: portrait ? 40 : 36, yaw: portrait ? (this.me === 0 ? Math.PI / 2 : -Math.PI / 2) : (this.me === 0 ? 0 : Math.PI), pitch: 0.92 };
    this.beginPlanning();
    if (!localStorage.getItem('tiers-v4-help')) { try { localStorage.setItem('tiers-v4-help', '1'); } catch {} $('help-body').innerHTML = helpHTML(); $('help').classList.remove('hidden'); }
  }

  beginPlanning() {
    this.phase = 'planning';
    this.planner.reset();
    this.tele.clear(); this.texts.clear(); this.shots.clear();
    if (this.selected && !this.state.squads.some(q => q.id === this.selected)) this.selected = null;
    $('playbar').classList.add('hidden'); $('log').classList.add('hidden');
    $('bottom').classList.remove('hidden');
    this.changed();
  }

  ready() {
    if (this.phase !== 'planning') return;
    const mine = this.planner.final();
    const theirs = aiOrders(this.state, this.ai, this.memory);
    this.memory = aiMemory(this.state);
    const orders = []; orders[this.me] = mine; orders[this.ai] = theirs;
    const pre = this.state;
    const { state: post, log } = resolveRound(pre, orders);
    this.play(pre, log, post);
  }

  play(pre, log, post) {
    this.phase = 'playback';
    this.pre = pre; this.post = post; this.log = log;
    this.tl = new Timeline(pre, log);
    this.T = 0; this.playing = true; this.lastT = 0;
    this.shotList = [];
    for (const e of this.tl.events) if (e.type === 'release' && e.kind === 'volley') {
      const v = this.views.get(e.id); if (!v) continue;
      const lead = LEAD[v.style] || 4, T0 = e.T - lead;
      const p = this.tl.pose(e.id, T0), h = this.tl.health(e.id, T0);
      this.shotList.push({ key: e.id + ':' + e.T, T0, T1: e.T, from: v.muzzles(p.x, p.z, p.fx, p.fz, h.models), to: { x: e.ex, z: e.ez }, arc: v.style === 'bow' ? 2.6 : 0.5 });
    }
    this.selected = null;
    this.view.clear('plan'); this.view.clear('ghost');
    $('dock').classList.add('hidden'); $('info').classList.add('hidden');
    $('bottom').classList.add('hidden');
    $('playbar').classList.remove('hidden'); $('log').classList.remove('hidden');
    this.buildScrub(); this.buildLog();
    this.updateTop();
    // frame everything that acts this round
    const pts = [], near = [];
    for (const q of pre.squads) {
      const a = post.squads.find(x => x.id === q.id);
      const ps = [{ x: q.x, z: q.z }]; if (a) ps.push({ x: a.x, z: a.z });
      pts.push(...ps);
      if (pre.squads.some(e => e.owner !== q.owner && Math.hypot(e.x - q.x, e.z - q.z) < 16)) near.push(...ps);
    }
    this.view.frame(near.length >= 2 ? near : pts, 0.7, 22);
  }

  seek(T) { this.T = Math.max(0, Math.min(this.tl.total, T)); this.lastT = this.T; this.texts.clear(); }

  finishPlayback() {
    this.state = this.post;
    for (const [id, v] of this.views) if (!this.state.squads.some(q => q.id === id)) { v.destroy(); this.views.delete(id); this.labels.get(id)?.remove(); this.labels.delete(id); }
    if (this.state.winner !== null) {
      const w = this.state.winner;
      $('over-title').textContent = w === this.me ? 'Victory' : w === -1 ? 'Draw' : 'Defeat';
      $('over-msg').textContent = w === this.me ? 'The enemy army has been destroyed.' : w === -1 ? 'Both armies fell.' : 'Your army has been destroyed.';
      $('over').classList.remove('hidden');
    }
    this.beginPlanning();
  }

  // ======================================================================== views
  syncViews(list, snap = false, dt = 0) {
    const time = this.view.time || 0;
    for (const d of list) {
      let v = this.views.get(d.id);
      if (!v) { v = new SquadView(d, this.view.layers.units); this.views.set(d.id, v); }
      v.update(d, dt, time, snap);
    }
  }

  planningDisplay() {
    return this.state.squads.map(q => ({ ...q, selected: q.id === this.selected }));
  }

  changed() { this.dirty = true; }

  // ======================================================================== planning overlay
  drawPlan() {
    const V = this.view; V.clear('plan');
    const L = V.layers.plan;
    for (const q of this.state.squads) {
      if (q.owner !== this.me) continue;
      const plan = this.planner.plan(q.id);
      if (!plan) continue;
      const sel = q.id === this.selected;
      const pr = this.planner.predict(q);
      for (const leg of pr.legs) {
        if (leg.kind === 'move') {
          L.add(ribbon(leg.line, sel ? 0.16 : 0.1, 0xffffff, sel ? 0.9 : 0.55));
          L.add(chevrons(leg.line, 0x111111, sel ? 0.8 : 0.4));
        } else if (leg.kind === 'swing') L.add(arcShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.R, leg.ch, COL.swing, sel ? 0.45 : 0.25));
        else if (leg.kind === 'volley') L.add(lineShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.len, leg.w, COL.volley, sel ? 0.45 : 0.25));
      }
      if (pr.legs.some(l => l.kind === 'move')) {
        const end = ring(radiusOf(q), 0.08, 0xffffff, sel ? 0.9 : 0.5, 0.06);
        end.position.x = pr.x; end.position.z = pr.z; L.add(end);
      }
    }
    // selected squad: reach ring for the AP left
    const q = this.selectedSquad();
    if (q && q.owner === this.me) {
      const pr = this.planner.predict(q);
      const left = this.planner.plan(q.id) ? this.planner.apLeft(q) : apFor(q);
      const reach = left * defOf(q).tier * RULES.moveFactor;
      if (this.mode === 'move' && reach > 0.3) { const r = ring(reach + radiusOf(q), 0.06, 0xffffff, 0.45, 0.05, 72); r.position.x = pr.x; r.position.z = pr.z; L.add(r); }
    } else if (q) {
      // enemy selected: show its strike reach
      const def = defOf(q);
      const r = def.attack.kind === 'swing' ? radiusOf(q) + def.attack.reach + def.tier * RULES.moveFactor * (RULES.ap - def.attack.ap) : def.attack.range;
      const m = ring(r, 0.07, COL.volley, 0.5, 0.05, 72); m.position.x = q.x; m.position.z = q.z; L.add(m);
    }
  }

  selectedSquad() { return this.selected ? this.state.squads.find(q => q.id === this.selected) : null; }

  // ======================================================================== input
  pickSquad(cx, cy) {
    const p = this.view.pick(cx, cy, 0.5); if (!p) return { p: null, q: null };
    const tolPx = 26 / Math.max(1, this.view.pxPerInch(p.x, p.z));
    let best = null, bd = 1e9;
    for (const q of this.state.squads) {
      const d = Math.hypot(q.x - p.x, q.z - p.z) - radiusOf(q);
      if (d < tolPx && d < bd) { bd = d; best = q; }
    }
    return { p: this.view.pick(cx, cy, 0), q: best };
  }

  select(id, focus = false) {
    this.selected = id;
    const q = this.selectedSquad();
    this.mode = 'move';
    if (q && focus) this.view.frame([{ x: q.x, z: q.z }], 0.45, 20);
    this.changed();
  }

  onTap(cx, cy) {
    if (this.phase !== 'planning') return;
    const { p, q } = this.pickSquad(cx, cy);
    if (!p) return;
    const sel = this.selectedSquad();
    if (q && (!sel || sel.owner !== this.me || this.mode !== 'attack' || q.owner === this.me)) { this.select(q.id); return; }
    if (sel && sel.owner === this.me) {
      if (this.mode === 'attack') { const t = q || p; this.planner.addAttack(sel.id, t.x, t.z); return; }
      this.planner.addMove(sel.id, p.x, p.z); return;
    }
    this.select(null);
  }

  dragStart(cx, cy) {
    if (this.phase !== 'planning') return false;
    const q = this.selectedSquad();
    if (!q || q.owner !== this.me) return false;
    const p = this.view.pick(cx, cy); if (!p) return false;
    const pr = this.planner.predict(q);
    const near = Math.hypot(p.x - pr.x, p.z - pr.z) < radiusOf(q) + Math.max(1, 40 / Math.max(1, this.view.pxPerInch(p.x, p.z)));
    const nearSquad = Math.hypot(p.x - q.x, p.z - q.z) < radiusOf(q) + 0.6;
    if (!near && !nearSquad) return false;
    this.drag = { kind: this.mode, id: q.id };
    return true;
  }

  dragMove(cx, cy) {
    const d = this.drag; if (!d) return;
    const p = this.view.pick(cx, cy); if (!p) return;
    const q = this.selectedSquad();
    const V = this.view; V.clear('ghost');
    const L = V.layers.ghost;
    const tape = $('tape');
    if (d.kind === 'move') {
      const pv = this.planner.previewMove(q, p.x, p.z);
      d.pt = p;
      L.add(ribbon(pv.line, 0.18, pv.short ? COL.bad : 0xffffff, 0.95));
      L.add(chevrons(pv.line, 0x111111, 0.8));
      const end = ring(radiusOf(q), 0.1, pv.short ? COL.bad : 0xffffff, 0.95, 0.07); end.position.x = pv.end.x; end.position.z = pv.end.z; L.add(end);
      if (pv.short) { const fz = ring(0.3, 0.06, COL.bad, 0.8); fz.position.x = p.x; fz.position.z = p.z; L.add(fz); }
      tape.innerHTML = `${pv.inches.toFixed(1)}″<small>${pv.ap} AP${pv.short ? ' · out of reach' : ''}</small>`;
      tape.classList.toggle('short', pv.short);
    } else {
      const pr = this.planner.predict(q);
      const def = defOf(q);
      const dx = p.x - pr.x, dz = p.z - pr.z, l = Math.hypot(dx, dz) || 1;
      const ux = dx / l, uz = dz / l;
      d.pt = p;
      let hitN = 0;
      if (def.attack.kind === 'swing') {
        const R = radiusOf(q) + def.attack.reach;
        L.add(arcShape(pr.x, pr.z, ux, uz, R, def.attack.cosHalf, COL.swing, 0.55));
        for (const e of this.state.squads) if (e.owner !== this.me && arcHits(pr.x, pr.z, ux, uz, R, def.attack.cosHalf, e.x, e.z, radiusOf(e))) { hitN++; const m = ring(radiusOf(e) + 0.2, 0.12, COL.bad, 1, 0.08); m.position.x = e.x; m.position.z = e.z; L.add(m); }
      } else {
        L.add(lineShape(pr.x, pr.z, ux, uz, def.attack.range, def.attack.width, COL.volley, 0.55));
        let best = null, bt = 2;
        for (const e of this.state.squads) if (e.owner !== this.me) { const t = segCircle(pr.x, pr.z, pr.x + ux * def.attack.range, pr.z + uz * def.attack.range, e.x, e.z, radiusOf(e) + def.attack.width / 2); if (t >= 0 && t < bt) { bt = t; best = e; } }
        if (best) { hitN = 1; const m = ring(radiusOf(best) + 0.2, 0.12, COL.bad, 1, 0.08); m.position.x = best.x; m.position.z = best.z; L.add(m); }
      }
      const dmg = def.attack.dmg * q.models;
      tape.innerHTML = `${def.attack.kind === 'swing' ? 'Swing' : 'Volley'} ${dmg}<small>${hitN ? `hits ${hitN} if they stay` : 'nobody there now'}</small>`;
      tape.classList.remove('short');
    }
    tape.classList.remove('hidden');
    tape.style.transform = `translate(${cx + 16}px, ${cy - 46}px)`;
  }

  dragEnd(cx, cy, moved) {
    const d = this.drag; this.drag = null;
    this.view.clear('ghost'); $('tape').classList.add('hidden');
    if (!d) return;
    if (!moved) { this.onTap(cx, cy); return; }
    if (!d.pt) return;
    if (d.kind === 'move') this.planner.addMove(d.id, d.pt.x, d.pt.z);
    else this.planner.addAttack(d.id, d.pt.x, d.pt.z);
  }

  onKey(e) {
    if (e.key === ' ' && this.phase === 'planning') { e.preventDefault(); this.ready(); }
    if (e.key === ' ' && this.phase === 'playback') { e.preventDefault(); this.playing = !this.playing; }
    if (e.key === 'Escape') this.select(null);
    if (e.key === 'Backspace' && this.selected) { e.preventDefault(); this.planner.undo(this.selected); }
  }

  // ======================================================================== HUD
  updateTop() {
    $('t-round').textContent = this.state.round;
    const ph = $('t-phase');
    ph.textContent = this.phase === 'playback' ? 'Battle' : 'Planning';
    ph.classList.toggle('play', this.phase === 'playback');
    const c = this.planner.cp();
    $('t-cp').innerHTML = `${icon('cp', 16)}<span>${c.left}/${c.total}</span>` + Array.from({ length: c.total }, (_, i) => `<i class="${i < c.left ? 'on' : ''}"></i>`).join('');
  }

  renderSquadBar() {
    const bar = $('squadbar');
    const mine = this.state.squads.filter(q => q.owner === this.me).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    bar.innerHTML = mine.map(q => {
      const def = defOf(q), plan = this.planner.plan(q.id);
      const used = plan ? planCost(q, plan) : 0;
      const tier = def.tier + (plan?.upgrades || 0);
      const pips = Array.from({ length: def.models }, (_, i) => `<i class="${i < q.models ? '' : 'off'}"></i>`).join('');
      const st = plan ? 'Your orders' : 'Stance: ' + this.planner.stanceOf(q);
      return `<button class="sq${q.id === this.selected ? ' sel' : ''}" data-id="${q.id}">
        <span class="n"><span class="tr">${tier}</span>${esc(def.name)}${icon(def.role, 14, 'role')}</span>
        <span class="m"><span class="pips">${pips}</span><span>${q.hp} HP</span></span>
        <span class="ap">${apBlocks(q, plan, true)}</span>
        <span class="st${plan ? ' ord' : ''}">${esc(st)}${plan ? ` · ${apFor(q) - used} AP left` : ''}</span></button>`;
    }).join('');
    bar.querySelectorAll('.sq').forEach(b => b.onclick = () => this.select(b.dataset.id, true));
  }

  renderDock() {
    const dock = $('dock'), info = $('info');
    const q = this.selectedSquad();
    if (this.phase !== 'planning' || !q) { dock.classList.add('hidden'); info.classList.add('hidden'); return; }
    const def = defOf(q);
    if (q.owner !== this.me) {
      dock.classList.add('hidden');
      info.classList.remove('hidden');
      const at = def.attack;
      info.innerHTML = `<b>Enemy ${esc(def.name)}</b> · tier ${def.tier} · ${q.models}/${def.models} models · ${q.hp} HP<br>
        <span style="color:var(--muted)">${at.kind === 'swing' ? `Swings for ${at.dmg * q.models} (${at.dmg} per model), reach ${at.reach}″` : `Volleys for ${at.dmg * q.models}, range ${at.range}″`} · moves ${(def.tier * RULES.moveFactor * 100).toFixed(1)}″ per round. The red ring shows how far it can strike this round.</span>`;
      return;
    }
    info.classList.add('hidden');
    dock.classList.remove('hidden');
    const plan = this.planner.plan(q.id);
    const left = plan ? this.planner.apLeft(q) : apFor(q);
    const st = this.planner.stanceOf(q);
    const atkName = def.attack.kind === 'swing' ? 'Swing' : 'Volley';
    const ctl = plan ? 'Your orders' : (q.role === 'hero' ? 'Hero: free to command' : 'Giving an order uses 1 command point');
    const b = (act, ic, label, sub, on = false, dis = false) => `<button class="act${on ? ' on' : ''}" data-act="${act}" ${dis ? 'disabled' : ''}>${icon(ic, 20)}${label}<small>${sub}</small></button>`;
    dock.innerHTML = `<div class="dk-head"><div><div class="nm">${esc(def.name)}</div><div class="sub">Tier ${def.tier + (plan?.upgrades || 0)} · ${q.models}/${def.models} models · ${q.hp} HP · ${ctl}</div></div>
        <button class="ib x" data-act="close">✕</button></div>
      <div class="dk-ap">${apBlocks(q, plan, false)}</div>
      <div class="dk-btns">
        ${b('mode:move', 'move', 'Move', `${(left * def.tier * RULES.moveFactor).toFixed(1)}″ left`, this.mode === 'move', left < 1)}
        ${b('mode:attack', def.attack.kind === 'swing' ? 'attack' : 'shoot', atkName, `${def.attack.ap} AP`, this.mode === 'attack', left < def.attack.ap)}
        ${b('defend', 'defend', 'Defend', `${RULES.defendCost} AP · ${plan?.defends || 0}`, false, left < RULES.defendCost)}
        ${b('tier', 'tierup', 'Act earlier', plan?.upgrades >= RULES.maxUpgrades ? 'max' : `${RULES.tierCost[plan?.upgrades || 0]} AP`, false, (plan?.upgrades || 0) >= RULES.maxUpgrades || left < RULES.tierCost[plan?.upgrades || 0])}
        ${b('undo', 'undo', 'Undo', '', false, !plan)}
        ${b('clear', 'release', 'Clear', 'back to stance', false, !plan)}
      </div>
      <div class="dk-stance">Stance (free): ${['guard', 'hold', 'advance'].map(s => `<button class="chip${st === s ? ' on' : ''}" data-act="stance:${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <div class="hint">${this.mode === 'move' ? '<b>Drag from the squad</b> to draw its path (or tap the table). Each move costs AP; the ring shows how far it can still go.' : `<b>Drag from the squad</b> to aim the ${atkName.toLowerCase()} (or tap a spot). It hits whatever is in the shape when it lands, so aim where enemies <b>will be</b>.`}</div>`;
    dock.querySelectorAll('[data-act]').forEach(el => el.onclick = () => this.dockAction(el.dataset.act, q));
  }

  dockAction(act, q) {
    const [k, arg] = act.split(':');
    if (k === 'close') this.select(null);
    else if (k === 'mode') this.mode = arg;
    else if (k === 'defend') this.planner.prepaid(q.id, 'defends');
    else if (k === 'tier') this.planner.prepaid(q.id, 'upgrades');
    else if (k === 'undo') this.planner.undo(q.id);
    else if (k === 'clear') this.planner.clear(q.id);
    else if (k === 'stance') this.planner.setStance(q.id, arg);
    this.changed();
  }

  updateLabels(list) {
    const layer = $('labels');
    const seen = new Set();
    const placed = [];
    const zoomedOut = this.view.cam.dist > (innerWidth < 700 || innerHeight < 520 ? 30 : 52);
    const items = [];
    for (const d of list) {
      const v = this.views.get(d.id); if (!v) continue;
      seen.add(d.id);
      let el = this.labels.get(d.id);
      if (!el) { el = document.createElement('div'); el.className = 'sl'; layer.appendChild(el); this.labels.set(d.id, el); }
      const def = defOf(d);
      const plan = this.phase === 'planning' ? this.planner.plan(d.id) : null;
      const planning = this.phase === 'planning';
      const tier = planning ? def.tier + (plan?.upgrades || 0) : (d.tierShown || def.tier);
      const defs = planning ? def.defends + (plan?.defends || 0) : (d.defLeft ?? def.defends);
      const ups = planning ? (plan?.upgrades || 0) : (d.upgrades || 0);
      const stance = planning ? (plan ? null : this.planner.stanceOf(d)) : d.stanceShown;
      const sel = d.id === this.selected;
      const key = `${tier}|${d.models}|${d.hp}|${sel}|${!!plan}|${d.dying !== undefined}|${defs}|${ups}|${stance}|${zoomedOut}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.style.setProperty('--team', TEAM[d.owner]);
        const maxHp = def.models * def.hpPer;
        const st = [];
        if (def.models > 1) st.push(`<span class="st">${icon('army', 12)}×${d.models}</span>`);
        if (defs > 0) st.push(`<span class="st" title="Defends: each halves one hit">${icon('defend', 12)}${defs}</span>`);
        if (ups > 0) st.push(`<span class="st">${icon('tierup', 12)}${ups > 1 ? ups : ''}</span>`);
        if (plan) st.push(`<span class="st">${icon('control', 12)}</span>`);
        else if (stance) st.push(`<span class="st">${icon(stance, 12)}</span>`);
        el.innerHTML = `<div class="sl-h"><span class="tr">${tier}</span><span class="nm">${esc(def.name)}</span>${icon(def.role, 14)}</div>
          <div class="sl-hp"><b style="width:${(100 * d.hp / maxHp).toFixed(0)}%"></b><span>${d.hp}</span></div>
          <div class="sl-s">${st.join('')}</div>`;
        el.className = 'sl' + (sel ? ' sel' : '') + (plan && d.owner === this.me ? ' ord' : '') + (d.dying !== undefined ? ' dim' : '') + (zoomedOut && !sel ? ' compact' : '');
        el._w = el.offsetWidth; el._h = el.offsetHeight;
      }
      const t = v.top();
      const p = this.view.project(t.x, t.y, t.z);
      const hide = p.behind || (d.dying !== undefined && d.dying > 0.6);
      el.style.display = hide ? 'none' : '';
      if (!hide) items.push({ el, x: p.x, y: p.y, sel });
    }
    // simple de-overlap: place from the bottom of the screen up, nudging labels upward
    items.sort((a, b) => b.y - a.y);
    for (const it of items) {
      const w = it.el._w || 90, h = it.el._h || 40;
      let y = it.y;
      for (let pass = 0; pass < 4; pass++) {
        const hit = placed.find(r => Math.abs(r.x - it.x) < (r.w + w) / 2 + 2 && y > r.y - r.h - 2 && y - h < r.y + 2);
        if (!hit) break;
        y = hit.y - hit.h - 3;
      }
      placed.push({ x: it.x, y, w, h });
      it.el.style.transform = `translate(${it.x}px, ${y}px) translate(-50%, -100%)`;
      it.el.style.zIndex = it.sel ? 2 : 1;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }

  // ======================================================================== playback UI
  buildScrub() {
    const tl = this.tl;
    const pct = t => (100 * t / tl.total).toFixed(2) + '%';
    $('scrub-sections').innerHTML = tl.sections.map(s => `<div style="left:${pct(s.t0 - 14)};width:${pct(s.t1 - s.t0 + 14)}">TIER ${s.tier}</div>`).join('');
    const rows = new Map();
    let n = 0;
    $('scrub-blocks').innerHTML = tl.blocks.filter(b => b.kind !== 'wait').map(b => {
      if (!rows.has(b.id)) rows.set(b.id, n++);
      const q = tl.pre.squads.find(x => x.id === b.id);
      const col = b.kind === 'move' ? (q.owner === this.me ? '#e8e4da' : '#7c766c') : b.kind === 'swing' ? 'var(--swing)' : 'var(--volley)';
      return `<i style="left:${pct(b.T0)};width:${pct(b.T1 - b.T0)};top:${18 + (rows.get(b.id) % 6) * 6}px;background:${col}"></i>`;
    }).join('');
  }

  buildLog() {
    const tl = this.tl;
    const name = id => { const q = tl.pre.squads.find(x => x.id === id); return q ? `<b class="t${q.owner}">${q.owner === this.me ? 'Your' : 'Enemy'} ${esc(defOf(q).name)}</b>` : '?'; };
    const lines = [];
    for (const e of tl.events) {
      if (e.type === 'hit') lines.push({ T: e.T, html: `${name(e.src)} ${e.kind === 'swing' ? 'cuts into' : 'shoots'} ${name(e.dst)} <span class="dmg">−${e.dmg}</span>${e.defended ? ' (defended)' : ''}${e.lost ? ` · ${e.lost} model${e.lost > 1 ? 's' : ''} fall` : ''}` });
      else if (e.type === 'down') lines.push({ T: e.T, html: `${name(e.id)} is destroyed` });
      else if (e.type === 'release' && !e.hit.length) lines.push({ T: e.T, html: `${name(e.id)}: ${e.kind} ${e.blocked ? 'blocked by cover' : 'misses (nobody in the area)'}` });
    }
    this.logLines = lines;
    $('log').innerHTML = `<button class="lg-head" id="lg-toggle">Battle log · ${lines.length}<span>▾</span></button><div class="lg-list">` + (lines.length ? lines.map((l, i) => `<div class="lg" data-i="${i}">${l.html}</div>`).join('') : '<div class="lg">No blows landed this round.</div>') + '</div>';
    $('lg-toggle').onclick = () => $('log').classList.toggle('collapsed');
    $('log').querySelectorAll('.lg[data-i]').forEach(el => el.onclick = () => { this.playing = false; this.seek(this.logLines[+el.dataset.i].T - 4); });
  }

  tickPlayback(dt) {
    const tl = this.tl;
    if (this.playing && !this.scrubbing) this.T = Math.min(tl.total, this.T + dt / SEC_PER_AP * this.speed);
    if (this.T >= tl.total) this.playing = false;
    const T = this.T;
    // floating texts for events passed while playing forward
    if (T > this.lastT) {
      for (const e of tl.eventsBetween(this.lastT, T)) {
        if (e.type === 'hit') {
          const q = this.sampleCache?.find(x => x.id === e.dst);
          if (q) { this.texts.add(q.x, q.z, `−${e.dmg}`, 'dmg'); if (e.defended) this.texts.add(q.x, q.z, 'Defended', 'def', 1.6); if (e.lost) this.texts.add(q.x, q.z, `−${e.lost} model${e.lost > 1 ? 's' : ''}`, 'loss', 1.2); }
        } else if (e.type === 'down') {
          const q = this.sampleCache?.find(x => x.id === e.id);
          if (q) this.texts.add(q.x, q.z, 'Destroyed', 'down', 2.6, 2);
        }
      }
    }
    this.lastT = T;
    const list = tl.sample(T);
    this.sampleCache = list;
    this.syncViews(list, false, dt);
    this.updateLabels(list);
    this.tele.update(tl.activeTeles(T), T);
    this.shots.update(this.shotList, T);
    // timeline UI
    $('scrub-head').style.left = (100 * T / tl.total) + '%';
    $('pb-play').textContent = this.playing ? '❚❚' : '▶';
    const sec = tl.sectionAt(T);
    let cap;
    if (!sec) cap = T >= tl.total ? 'Round over. Drag the timeline to watch again, or press <b>Next round</b>.' : 'Starting…';
    else {
      const names = sec.squads.map(id => { const q = tl.pre.squads.find(x => x.id === id); return q ? `${q.owner === this.me ? '' : 'enemy '}${defOf(q).name}` : ''; });
      cap = `<b>Tier ${sec.tier}</b>${sec.tier >= 6 ? ' · fast' : sec.tier <= 4 ? ' · slow' : ''}: ${esc(names.join(', '))} act at the same time.`;
    }
    $('pb-caption').innerHTML = cap;
    $('pb-next').style.boxShadow = T >= tl.total ? '0 0 0 3px #ffc400' : '';
    const past = this.logLines || [];
    $('log').querySelectorAll('.lg[data-i]').forEach(el => el.classList.toggle('past', past[+el.dataset.i].T > T));
  }

  tierOf(id) {
    for (const e of this.tl.events) if (e.type === 'prep' && e.id === id) return e.tier;
    return null;
  }

  // ======================================================================== frame loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.input.tick?.(dt);
    if (this.view.lens) this.view.lens.target = this.drag ? 0 : 1;
    // if the device struggles, switch the lens off once (the player can turn it back on)
    if (this.phase === 'planning' && this.lensOn && !this.perfChecked) {
      this.perf = this.perf || { t: 0, n: 0 };
      this.perf.t += dt; this.perf.n++;
      if (this.perf.t > 4) {
        this.perfChecked = true;
        if (this.perf.t / this.perf.n > 0.05) { this.setLens(false, false); this.toast('Miniature lens switched off to keep things smooth. You can turn it on in the menu.'); }
      }
    }
    if (this.phase === 'menu') this.view.cam.yaw += dt * 0.04;
    if (this.phase === 'playback') this.tickPlayback(dt);
    else {
      const list = this.planningDisplay();
      this.syncViews(list, false, dt);
      if (this.phase === 'planning') {
        if (this.dirty) { this.dirty = false; this.drawPlan(); this.renderSquadBar(); this.renderDock(); this.updateTop(); }
        this.updateLabels(list);
      }
    }
    this.texts.update(dt);
    this.view.render(dt);
  }
}

// AP bar blocks for a squad's plan
function apBlocks(q, plan, mini) {
  if (!plan) return mini ? '' : `<div class="free" style="width:100%">No orders: follows its stance</div>`;
  const total = RULES.ap;
  const parts = [];
  const pre = (plan.upgrades ? RULES.tierCost.slice(0, plan.upgrades).reduce((a, b) => a + b, 0) : 0) + plan.defends * RULES.defendCost;
  if (pre) parts.push(`<${mini ? 'b' : 'div'} class="pre" style="width:${100 * pre / total}%;${mini ? 'background:#3fa9ff' : ''}">${mini ? '' : icon('defend', 12)}</${mini ? 'b' : 'div'}>`);
  for (const a of plan.actions) {
    const c = actionCost(q, a);
    const col = a.kind === 'move' ? '#e8e4da' : a.kind === 'swing' ? 'var(--swing)' : a.kind === 'volley' ? 'var(--volley)' : '#8a857c';
    parts.push(mini ? `<b style="width:${100 * c / total}%;background:${col}"></b>` : `<div class="${a.kind}" style="width:${100 * c / total}%">${c >= 12 ? a.kind.toUpperCase() : ''}</div>`);
  }
  const used = planCost(q, plan);
  if (!mini && used < total) parts.push(`<div class="free" style="width:${100 * (total - used) / total}%">${total - used} AP free</div>`);
  return parts.join('');
}

function helpHTML() {
  return `
<p><b>V4 preview (milestone 1).</b> Two armies of miniatures on a tabletop. Destroy every enemy squad to win.</p>
<h3>A round</h3>
<p>Both sides give orders at the same time, then press <b>Ready</b>. Squads then act in <b>speed tiers</b>: fast squads (tier 6) first, then normal (5), then slow (4). Squads in the same tier act <b>at the same time</b>. Every squad has <b>100 AP</b> per round, and an action's AP cost is also how long it takes.</p>
<h3>Giving orders</h3>
<ul>
<li>Tap a squad (or its card at the bottom) to select it.</li>
<li><b>Move:</b> drag from the squad to draw its path, or tap the table. The label shows inches and AP. The white ring shows how far it can still go.</li>
<li><b>Swing / Volley:</b> drag from the squad to aim. Every attack is a <b>skillshot</b>: it hits whatever is inside the shape when it lands. The shape charges up during its wind-up, so enemies can walk out of it, and yours can dodge.</li>
<li><b>Defend:</b> each defend halves one hit. <b>Act earlier:</b> moves the squad up a tier this round.</li>
<li>You can command <b>${RULES.cp} squads</b> per round (the hero is free). The others follow their stance: <b>Guard</b> strikes enemies that come close, <b>Hold</b> stays and defends, <b>Advance</b> marches on the nearest enemy.</li>
</ul>
<h3>Squads</h3>
<p>Each squad is several miniatures. Damage removes models, and a squad hits for <b>damage per model × models left</b>, so wounded squads hit weaker.</p>
<h3>Terrain</h3>
<p>Forests and the stream slow movement (cross at the fords). Ruins and rocks block movement and volleys.</p>
<h3>Watching the battle</h3>
<p>The round plays slowly. Drag the timeline to scrub back and forth, change the speed, or tap a line in the log to jump to it. Press <b>Next round</b> when you're done.</p>
<h3>Camera</h3>
<p>Drag the table to pan, pinch or scroll to zoom, two-finger twist or right-drag to rotate.</p>`;
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.game = new Game(); }
  catch (e) { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div class="overlay"><div class="card"><h2>Could not start</h2><p>${esc(e.message || e)}</p></div></div>`); }
});
