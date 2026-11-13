// V4 game controller.
import * as THREE from 'three';
import { RULES, FACTIONS, ROLE_ORDER, isMelee, isShooter, skillOf, skillsOf, cdOf, SELF_SKILLS } from './data/units.js';
import { createGame, defOf, radiusOf, apFor } from './sim/state.js';
import { planCost, actionCost } from './sim/orders.js';
import { resolveRound, arcHits, losCut, inCover, clampAim, engagedWith } from './sim/resolve.js';
import { segCircle } from './sim/geom.js';
import { aiOrders, aiMemory } from './ai/ai.js';
import { visibleTo, canSee } from './sim/vision.js';
import { View } from './render/view.js';
import { buildTable } from './render/table.js';
import { SquadView, LEAD } from './render/squads.js';
import { makeMini, poseMini, attackPose, POSES, setMiniMode, MINI_MODE } from './render/minis.js';
import { Timeline, SEC_PER_AP } from './render/timeline.js';
import { ribbon, chevrons, ring, disc, arcShape, lineShape, Telegraphs, FloatTexts, Projectiles, COL } from './render/fx.js';
import { Input } from './ui/input.js';
import { Planner } from './ui/planner.js';
import { icon } from './ui/iconset.js';
import { BaseUI } from './ui/baseui.js';
import { BUILDINGS } from './data/units.js';
import { hitRadius } from './sim/base.js';
import { BuildingView } from './render/buildings.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEAM = ['#3a78d8', '#9b59d0'];
const TEAM_HEX = [0x3a78d8, 0x9b59d0];

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
    this.makeShrines(); this.syncBuildings(this.state.buildings.map(b => ({ ...b })));
    this.view.cam = { x: 24, z: 16, dist: 62, yaw: 0.6, pitch: 0.62 };
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
    if (/build/.test(location.search)) {
      // ?gallery&build: every building of both factions
      ['kingdom', 'undead'].forEach((f, fi) => ['hq', 'barracks', 'tower', 'banner', 'wall'].forEach((t, i) => {
        const d = BUILDINGS[t];
        const v = new BuildingView({ id: f + t, type: t, rot: 0, x: 4 + i * 5.5, z: 6 + fi * 7, w: d.w, d: d.d, r: d.r }, f, this.view.layers.units);
        v.update({ build: /site/.test(location.search) && t !== 'hq' ? 1 : 0 });
      }));
      this.view.cam = { x: 15, z: 9.5, dist: 26, yaw: 0, pitch: 0.55 };
    }
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
    $('b-rehearse').onclick = () => this.rehearse();
    $('b-build').onclick = () => this.openBuild();
    $('b-build').innerHTML = icon('build', 20) + '<span>Build</span>';
    try { this.hintsDone = localStorage.getItem('tiers-v4-hints') === '1'; } catch {}
    $('b-help').onclick = () => { $('help-body').innerHTML = helpHTML(); $('help').classList.remove('hidden'); };
    $('help-close').onclick = () => $('help').classList.add('hidden');
    $('b-menu').onclick = () => $('opts').classList.remove('hidden');
    $('o-close').onclick = () => $('opts').classList.add('hidden');
    $('o-quit').onclick = () => location.reload();
    $('o-lens').onclick = $('m-lens').onclick = () => this.setLens(!this.lensOn);
    $('o-anim').onclick = $('m-anim').onclick = () => this.setAnim(MINI_MODE === 'statue' ? 'posable' : 'statue');
    let am = null; try { am = localStorage.getItem('tiers-v4-anim'); } catch {}
    if (/statue/.test(location.search)) am = 'statue';
    this.setAnim(am || 'posable', false);
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

  setAnim(mode, save = true) {
    setMiniMode(mode);
    document.querySelectorAll('.anim-v').forEach(e => { e.textContent = MINI_MODE === 'statue' ? 'Solid statues' : 'Posable arms'; });
    if (save) try { localStorage.setItem('tiers-v4-anim', MINI_MODE); } catch {}
    // rebuild every squad with the new minis
    if (this.views && this.views.size) {
      for (const v of this.views.values()) v.destroy();
      this.views.clear();
      const list = this.phase === 'playback' && this.tl ? this.tl.sample(this.T) : (this.state ? this.state.squads.map(q => ({ ...q })) : []);
      this.syncViews(list, true);
    }
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
    this.memory = aiMemory();
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.syncViews(this.state.squads.map(q => ({ ...q })), true);
    this.knownB = new Map(); this.selB = null; this.buildOpen = false; this.buildMode = null;
    this.makeShrines(); this.syncBuildings([]);
    const portrait = innerHeight > innerWidth;
    const homeX = this.me === 0 ? 14 : 34;
    this.view.cam = { x: homeX, z: 16, dist: portrait ? 40 : 36, yaw: portrait ? (this.me === 0 ? Math.PI / 2 : -Math.PI / 2) : (this.me === 0 ? 0 : Math.PI), pitch: 0.92 };
    this.beginPlanning();
    if (!localStorage.getItem('tiers-v4-help')) { try { localStorage.setItem('tiers-v4-help', '1'); } catch {} $('help-body').innerHTML = helpHTML(); $('help').classList.remove('hidden'); }
  }

  // what my side sees now; remember where hidden enemies were last seen
  updateFog() {
    this.vis = visibleTo(this.state, this.me);
    this.seen = this.seen || {};
    const alive = new Set(this.state.squads.map(q => q.id));
    for (const q of this.state.squads) if (this.vis.has(q.id)) this.seen[q.id] = { ...q, round: this.state.round };
    for (const id of Object.keys(this.seen)) if (!alive.has(id)) delete this.seen[id];
    this.updateBuildingFog();
  }
  canSeeEnemy(id) { return !this.vis || this.vis.has(id); }

  beginPlanning() {
    this.phase = 'planning';
    this.updateFog();
    this.planner.reset();
    this.tele.clear(); this.texts.clear(); this.shots.clear();
    if (this.selected && !this.state.squads.some(q => q.id === this.selected)) this.selected = null;
    if (this.selB && !this.state.buildings.some(b => b.id === this.selB)) this.selB = null;
    this.buildMode = null;
    $('playbar').classList.add('hidden'); $('log').classList.add('hidden');
    $('bottom').classList.remove('hidden');
    this.clearWatches?.();
    this.changed();
    this.hint();
  }

  // play my draft against enemies that stand still, without changing the game
  rehearse() {
    if (this.phase !== 'planning') return;
    const mine = this.planner.final();
    const hold = { squads: {}, stances: {} };
    for (const q of this.state.squads) if (q.owner === this.ai) hold.stances[q.id] = 'hold';
    const orders = []; orders[this.me] = mine; orders[this.ai] = hold;
    const { state: post, log } = resolveRound(this.state, orders);
    this.play(this.state, log, post, true);
  }

  ready() {
    if (this.phase !== 'planning') return;
    const mine = this.planner.final();
    const theirs = aiOrders(this.state, this.ai, this.memory);
    const orders = []; orders[this.me] = mine; orders[this.ai] = theirs;
    const pre = this.state;
    const { state: post, log } = resolveRound(pre, orders);
    this.play(pre, log, post);
  }

  play(pre, log, post, rehearsal = false) {
    this.phase = 'playback';
    this.rehearsal = rehearsal;
    $('pb-next').textContent = rehearsal ? '◂ Back to planning' : 'Next round ▸';
    $('hintbar').classList.add('hidden');
    this.pre = pre; this.post = post; this.log = log;
    this.tl = new Timeline(pre, log, { me: this.me, terrain: pre.terrain });
    this.T = 0; this.playing = true; this.lastT = 0;
    this.shotList = [];
    for (const e of this.tl.events) if (e.type === 'release' && (e.kind === 'volley' || e.kind === 'lob' || e.kind === 'storm' || e.kind === 'pierce')) {
      if (e.building) {
        // towers and keeps: a few bolts from the top
        const b = pre.buildings.find(x => x.id === e.id); if (!b) continue;
        if (b.owner !== this.me && !this.knownB.has(b.id) && !e.hit.some(id => pre.squads.find(q => q.id === id)?.owner === this.me)) continue;
        const h = b.type === 'hq' ? 4.2 : 4.4, rr = hitRadius(b) * 0.6;
        this.shotList.push({ key: e.id + ':' + e.T, T0: e.T - 3, T1: e.T, from: [0, 1, 2, 3].map(i => ({ x: b.x + Math.cos(i * 1.6) * rr, y: h, z: b.z + Math.sin(i * 1.6) * rr })), to: { x: e.ex, z: e.ez }, arc: 0.6 });
        continue;
      }
      const v = this.views.get(e.id); if (!v) continue;
      if (!this.tl.visibleAt(e.id, e.T) && !this.tl.visibleAt(e.id, e.T - 4)) continue;
      const lead = e.overwatch ? 2.5 : e.kind === 'storm' ? 7 : (LEAD[v.style] || 4), T0 = e.T - lead;
      const p = this.tl.pose(e.id, T0), h = this.tl.health(e.id, T0);
      this.shotList.push({ key: e.id + ':' + e.T, T0, T1: e.T, from: v.muzzles(p.x, p.z, p.fx, p.fz, h.models), to: { x: e.ex, z: e.ez }, arc: e.kind === 'volley' || e.kind === 'pierce' ? 0.4 : 3.2 });
    }
    this.selected = null; this.selB = null; this.buildMode = null; this.buildOpen = false;
    $('buildbar').classList.add('hidden'); this.updatePlaceMark();
    if (this.knobs) for (const el of Object.values(this.knobs)) el.style.display = 'none';
    this.ghostView?.destroy(); this.ghostView = null;
    this.knobPos = null;
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
    if (this.rehearsal) {
      // back to the same planning state, keeping the draft
      this.rehearsal = false;
      this.phase = 'planning';
      this.tele.clear(); this.texts.clear(); this.shots.clear(); this.clearWatches();
      $('playbar').classList.add('hidden'); $('log').classList.add('hidden'); $('bottom').classList.remove('hidden');
      this.syncViews(this.state.squads.map(q => ({ ...q })), true);
      this.changed(); this.hint();
      return;
    }
    this.state = this.post;
    for (const [id, v] of this.views) if (!this.state.squads.some(q => q.id === id)) { v.destroy(); this.views.delete(id); this.labels.get(id)?.remove(); this.labels.delete(id); }
    if (this.state.winner !== null) {
      const w = this.state.winner;
      $('over-title').textContent = w === this.me ? 'Victory' : w === -1 ? 'Draw' : 'Defeat';
      const hqGone = p => !this.state.buildings.some(b => b.owner === p && b.type === 'hq');
      const loser = w === -1 ? -1 : 1 - w;
      const enemyHq = BUILDINGS.hq.name[this.faction(this.ai)], myHq = BUILDINGS.hq.name[this.faction(this.me)];
      $('over-msg').textContent = w === -1 ? 'Both sides are spent: the battle ends in a draw.'
        : loser >= 0 && hqGone(loser) ? (w === this.me ? `The enemy ${enemyHq} has fallen.` : `Your ${myHq} has fallen.`)
        : this.pre.round >= RULES.roundLimit ? `Round ${RULES.roundLimit} reached: ${w === this.me ? 'your' : 'the enemy'} army and base are stronger.`
        : w === this.me ? 'The enemy army and its barracks are gone.' : 'Your army and your barracks are gone.';
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
      // jump (don't glide) when a squad switches between seen / hidden / last-seen
      const mode = d.visible === false ? 'h' : d.lastSeen !== undefined ? 'g' : 'v';
      const jump = snap || (v.fogMode && v.fogMode !== mode);
      v.fogMode = mode;
      v.update(d, dt, time, jump);
    }
  }

  planningDisplay() {
    return this.state.squads.map(q => {
      if (q.owner === this.me || this.canSeeEnemy(q.id)) return { ...q, selected: q.id === this.selected };
      const m = this.seen?.[q.id];
      // fog: a hidden enemy shows as a faded marker where it was last seen
      return m ? { ...m, ghost: true, lastSeen: this.state.round - m.round, selected: false } : { ...q, visible: false };
    });
  }

  changed() { this.dirty = true; }

  // ======================================================================== planning overlay
  drawLeg(L, q, leg, sel) {
    const a = sel ? 0.45 : 0.25;
    if (leg.kind === 'move') {
      L.add(ribbon(leg.line, sel ? 0.16 : 0.1, leg.disengage ? 0xffb020 : 0xffffff, sel ? 0.9 : 0.55));
      L.add(chevrons(leg.line, 0x111111, sel ? 0.8 : 0.4));
    } else if (leg.kind === 'swing') L.add(arcShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.R, leg.ch, COL.swing, a));
    else if (leg.kind === 'volley') {
      const cut = losCut(this.state.terrain, leg.ox, leg.oz, leg.ox + leg.dx * leg.len, leg.oz + leg.dz * leg.len);
      L.add(lineShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.len * cut, leg.w, COL.volley, a));
      if (cut < 1) L.add(lineShape(leg.ox + leg.dx * leg.len * cut, leg.oz + leg.dz * leg.len * cut, leg.dx, leg.dz, leg.len * (1 - cut), leg.w, 0x555555, a * 0.6));
    } else if (leg.kind === 'sweep' || leg.kind === 'wall') L.add(arcShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.R, leg.ch, COL[leg.kind], a));
    else if (leg.kind === 'pierce') L.add(lineShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.len, leg.w, COL.pierce, a));
    else if (leg.kind === 'leap' || leg.kind === 'step') {
      L.add(ribbon([{ x: leg.ox, z: leg.oz }, { x: leg.cx, z: leg.cz }], sel ? 0.12 : 0.08, COL[leg.kind], sel ? 0.8 : 0.5, 0.35));
      const r = ring(radiusOf(q) + 0.3, 0.1, COL[leg.kind], sel ? 0.9 : 0.5); r.position.x = leg.cx; r.position.z = leg.cz; L.add(r);
    } else if (leg.kind === 'lob' || leg.kind === 'blast' || leg.kind === 'storm' || leg.kind === 'rally' || leg.kind === 'raise') {
      const col = COL[leg.kind];
      const d = disc(leg.R, col, a * 0.8); d.position.x = leg.cx; d.position.z = leg.cz; L.add(d);
      const r = ring(leg.R, 0.08, col, sel ? 0.9 : 0.5); r.position.x = leg.cx; r.position.z = leg.cz; L.add(r);
    } else if (leg.kind === 'charge') {
      L.add(lineShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.len, leg.w, COL.charge, a * 0.7));
      if (leg.hit) { const m = ring(radiusOf(leg.hit) + 0.2, 0.12, COL.bad, sel ? 1 : 0.6, 0.08); m.position.x = leg.hit.x; m.position.z = leg.hit.z; L.add(m); }
    } else if (leg.kind === 'overwatch') L.add(arcShape(leg.ox, leg.oz, leg.dx, leg.dz, leg.R, leg.ch, COL.watch, sel ? 0.22 : 0.12));
  }

  drawPlan() {
    const V = this.view; V.clear('plan');
    const L = V.layers.plan;
    this.drawBuildZone(L);
    for (const q of this.state.squads) {
      if (q.owner !== this.me) continue;
      const plan = this.planner.plan(q.id);
      if (!plan) continue;
      const sel = q.id === this.selected;
      const pr = this.planner.predict(q);
      for (const leg of pr.legs) this.drawLeg(L, q, leg, sel);
      if (pr.legs.some(l => l.kind === 'move' || l.kind === 'charge' || l.kind === 'leap' || l.kind === 'step')) {
        const end = ring(radiusOf(q), 0.08, 0xffffff, sel ? 0.9 : 0.5, 0.06);
        end.position.x = pr.x; end.position.z = pr.z; L.add(end);
      }
    }
    // engaged squads get a red contact ring
    for (const q of this.state.squads) if (engagedWith(q, this.state.squads).length) { const r = ring(radiusOf(q) + 0.18, 0.07, COL.bad, 0.55, 0.04); r.position.x = q.x; r.position.z = q.z; L.add(r); }
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

  // ======================================================================== drag knobs
  // Big round handles next to the selected squad: where you start the drag picks the order.
  knobSpots(q) {
    const pr = this.planner.predict(q), r = radiusOf(q) + 0.95;
    const fx = pr.fx, fz = pr.fz;
    return {
      move: { x: pr.x - fx * r * 0.2, z: pr.z - fz * r * 0.2 },
      attack: { x: pr.x + fx * r, z: pr.z + fz * r },
      skill: { x: pr.x + fz * r * 0.95, z: pr.z - fx * r * 0.95 },
    };
  }
  updateKnobs() {
    if (!this.knobs) {
      this.knobs = {};
      for (const k of ['move', 'attack', 'skill0', 'skill1', 'skill2']) { const el = document.createElement('div'); el.className = 'knob ' + (k.startsWith('skill') ? 'skill' : k); $('labels').appendChild(el); this.knobs[k] = el; }
    }
    const q = this.selectedSquad();
    const show = this.phase === 'planning' && q && q.owner === this.me;
    if (!show) { for (const el of Object.values(this.knobs)) el.style.display = 'none'; this.knobPos = null; return; }
    const def = defOf(q), sks = skillsOf(def);
    const atkIc = def.attack.kind === 'swing' ? 'attack' : 'shoot';
    const content = { move: icon('move', 20), attack: icon(this.mode === 'overwatch' ? 'overwatch' : atkIc, 20) };
    sks.forEach((sk, i) => { const cd = cdOf(q, sk.kind); content['skill' + i] = this.planner.skillReady(q, sk.kind) ? icon(SKILL_IC[sk.kind], 20) : `<b>${cd > 0 ? cd : '✓'}</b>`; });
    // place knobs in screen space around the squad's planned end point: always ~64px apart
    const pr = this.planner.predict(q);
    const c = this.view.project(pr.x, 0.4, pr.z), f = this.view.project(pr.x + pr.fx, 0.4, pr.z + pr.fz);
    let ux = f.x - c.x, uy = f.y - c.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    let px = uy, py = -ux; if (py < 0) { px = -px; py = -py; }       // skill knobs fan out below the squad (its nameplate is above)
    const gap = innerWidth < 720 ? 58 : 64;
    const pos = { move: { x: c.x, y: c.y }, attack: { x: c.x + ux * gap, y: c.y + uy * gap } };
    const fan = sks.length === 1 ? [0] : sks.length === 2 ? [-0.42, 0.42] : [-0.8, 0, 0.8];
    sks.forEach((sk, i) => {
      const a = fan[i], ca = Math.cos(a), sa = Math.sin(a);
      const dx = px * ca - py * sa, dy = px * sa + py * ca;
      pos['skill' + i] = { x: c.x + dx * gap * (sks.length > 1 ? 1.05 : 1), y: c.y + dy * gap * (sks.length > 1 ? 1.05 : 1) };
    });
    this.knobPos = {};
    for (const [k, el] of Object.entries(this.knobs)) {
      const si = k.startsWith('skill') ? +k.slice(5) : -1, sk = si >= 0 ? sks[si] : null;
      if ((si >= 0 && !sk) || c.behind) { el.style.display = 'none'; continue; }
      const p = pos[k];
      this.knobPos[k] = p;
      const active = this.drag ? (this.drag.knobKey === k || (k === 'attack' && this.drag.kind === 'overwatch') || (!this.drag.knobKey && this.drag.kind === k)) : true;
      el.style.display = active ? '' : 'none';
      if (el._c !== content[k]) { el.innerHTML = content[k]; el._c = content[k]; }
      if (sk) { el.classList.toggle('off', !this.planner.skillReady(q, sk.kind)); el.dataset.cat = sk.cat; el.title = sk.name; }
      el.classList.toggle('on', sk ? (this.mode === 'skill' && this.modeSkill === sk.kind) : (this.mode === k || (k === 'attack' && this.mode === 'overwatch')));
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
  }
  // translucent copy of the selected squad where its orders leave it (live while dragging)
  updateGhost(dt) {
    const q = this.phase === 'planning' ? this.selectedSquad() : null;
    const own = q && q.owner === this.me;
    if (!own || (this.ghostView && this.ghostView.id !== q.id + '~' + MINI_MODE)) { this.ghostView?.destroy(); this.ghostView = null; }
    if (!own) return;
    let end = this.previewEnd;
    if (!end) { const pr = this.planner.predict(q); end = { x: pr.x, z: pr.z, fx: pr.fx, fz: pr.fz }; }
    const moved = Math.hypot(end.x - q.x, end.z - q.z) > 0.05;
    if (!this.ghostView) {
      this.ghostView = new SquadView({ ...q, ...end }, this.view.layers.units);
      this.ghostView.id = q.id + '~' + MINI_MODE;
      for (const r of [this.ghostView.teamRing, this.ghostView.selRing, this.ghostView.actRing]) r.visible = false;
    }
    this.ghostView.group.visible = moved;
    if (moved) this.ghostView.update({ ...q, ...end, ghost: true }, dt, this.view.time || 0, false);
    this.ghostView.teamRing.visible = false;
  }

  knobAt(cx, cy) {
    if (!this.knobPos) return null;
    let best = null, bd = 30;
    for (const [k, p] of Object.entries(this.knobPos)) { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = k; } }
    return best;
  }

  // ======================================================================== input
  pickSquad(cx, cy) {
    const p = this.view.pick(cx, cy, 0.5); if (!p) return { p: null, q: null };
    const tolPx = 26 / Math.max(1, this.view.pxPerInch(p.x, p.z));
    let best = null, bd = 1e9;
    for (const q of this.state.squads) {
      if (q.owner !== this.me && !this.canSeeEnemy(q.id)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z) - radiusOf(q);
      if (d < tolPx && d < bd) { bd = d; best = q; }
    }
    return { p: this.view.pick(cx, cy, 0), q: best };
  }

  select(id, focus = false) {
    this.selected = id;
    if (id) { this.selB = null; this.buildMode = null; this.buildOpen = false; }
    const q = this.selectedSquad();
    this.mode = 'move';
    if (q && focus) this.focusOn(q);
    if (q && q.owner === this.me) this.hint(1);
    this.changed();
  }

  // frame a squad so it sits in the open part of the screen (clear of the dock and squad bar)
  focusOn(q) {
    const yaw = this.view.cam.yaw, dist = Math.max(20, Math.min(this.view.cam.dist, 30));
    const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
    const phone = innerWidth < 720, land = innerHeight < 520;
    const side = phone && !land ? 0 : 0.16 * dist;          // dock on the right: push the squad left
    const up = phone && !land ? 0.2 * dist : 0.07 * dist;   // squad bar / dock at the bottom: push it up
    this.view.frame([{ x: q.x + rx * side - fx * up, z: q.z + rz * side - fz * up }], 0.45, dist);
  }

  // place an order of the current mode at a table point
  orderAt(kind, q, x, z, skKind = null) {
    if (kind === 'move') return this.planner.addMove(q.id, x, z);
    if (kind === 'attack') return this.planner.addAttack(q.id, x, z);
    if (kind === 'skill') return this.planner.addSkill(q.id, skKind || this.modeSkill, x, z);
    if (kind === 'overwatch') { const ok = this.planner.setOverwatch(q.id, x, z); this.mode = 'move'; return ok; }
    return false;
  }

  onTap(cx, cy) {
    if (this.phase !== 'planning') return;
    if (this.buildMode) { const p = this.view.pick(cx, cy, 0); if (p) { this.movePlace(p.x, p.z); this.changed(); } return; }
    const { p, q } = this.pickSquad(cx, cy);
    if (!p) return;
    const sel = this.selectedSquad();
    const aiming = this.mode !== 'move';
    if (q && (!sel || sel.owner !== this.me || !aiming || q.owner === this.me)) { this.select(q.id); return; }
    if (!q && (!sel || sel.owner !== this.me || !aiming)) { const b = this.pickBuilding(cx, cy); if (b) { this.selectBuilding(b.id); return; } }
    if (sel && sel.owner === this.me) { const t = aiming && q ? q : p; if (this.orderAt(this.mode, sel, t.x, t.z)) this.hint(2); return; }
    this.select(null); this.selB = null; this.changed();
  }

  dragStart(cx, cy) {
    if (this.phase !== 'planning') return false;
    if (this.buildMode) { const p = this.view.pick(cx, cy, 0); if (!this.nearPlace(p)) return false; this.drag = { kind: 'place', sx: cx, sy: cy }; return true; }
    const q = this.selectedSquad();
    if (!q || q.owner !== this.me) return false;
    const knob = this.knobAt(cx, cy);
    if (knob) {
      if (knob.startsWith('skill')) { this.drag = { kind: 'skill', sk: skillsOf(defOf(q))[+knob.slice(5)].kind, id: q.id, knob: true, knobKey: knob }; return true; }
      const kind = knob === 'attack' && this.mode === 'overwatch' ? 'overwatch' : knob;
      this.drag = { kind, id: q.id, knob: true, knobKey: knob };
      return true;
    }
    const p = this.view.pick(cx, cy); if (!p) return false;
    const pr = this.planner.predict(q);
    const near = Math.hypot(p.x - pr.x, p.z - pr.z) < radiusOf(q) + Math.max(1, 40 / Math.max(1, this.view.pxPerInch(p.x, p.z)));
    const nearSquad = Math.hypot(p.x - q.x, p.z - q.z) < radiusOf(q) + 0.6;
    if (!near && !nearSquad) return false;
    this.drag = { kind: this.mode, sk: this.modeSkill, id: q.id };
    return true;
  }

  // live preview while dragging; returns tape label html
  preview(kind, q, p, skKind = null) {
    const V = this.view; V.clear('ghost');
    this.previewEnd = null;
    const L = V.layers.ghost;
    const def = defOf(q), pr = this.planner.predict(q);
    const dx = p.x - pr.x, dz = p.z - pr.z, l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l;
    const mark = e => { const m = ring(radiusOf(e) + 0.2, 0.12, COL.bad, 1, 0.08); m.position.x = e.x; m.position.z = e.z; L.add(m); };
    const enemies = this.state.squads.filter(e => e.owner !== this.me && this.canSeeEnemy(e.id));
    if (kind === 'move') {
      const pv = this.planner.previewMove(q, p.x, p.z);
      const a = pv.line[pv.line.length - 2] || pv.from, bpt = pv.line[pv.line.length - 1] || pv.end, fl = Math.hypot(bpt.x - a.x, bpt.z - a.z);
      this.previewEnd = { x: pv.end.x, z: pv.end.z, fx: fl > 1e-3 ? (bpt.x - a.x) / fl : pr.fx, fz: fl > 1e-3 ? (bpt.z - a.z) / fl : pr.fz };
      L.add(ribbon(pv.line, 0.18, pv.short ? COL.bad : pv.disengage ? 0xffb020 : 0xffffff, 0.95));
      L.add(chevrons(pv.line, 0x111111, 0.8));
      const end = ring(radiusOf(q), 0.1, pv.short ? COL.bad : 0xffffff, 0.95, 0.07); end.position.x = pv.end.x; end.position.z = pv.end.z; L.add(end);
      if (pv.short) { const fz = ring(0.3, 0.06, COL.bad, 0.8); fz.position.x = p.x; fz.position.z = p.z; L.add(fz); }
      return { html: `${pv.inches.toFixed(1)}″<small>${pv.ap} AP${pv.disengage ? ' · +30 disengage, parting blow' : ''}${pv.short ? ' · out of reach' : ''}</small>`, bad: pv.short, warn: pv.disengage };
    }
    if (kind === 'overwatch') {
      L.add(arcShape(pr.x, pr.z, ux, uz, def.attack.range, RULES.overwatchCos, COL.watch, 0.35));
      return { html: `Overwatch<small>fires once at the first enemy that moves in the cone · ${RULES.overwatchCost} AP</small>` };
    }
    if (kind === 'skill') {
      const sk = skillOf(def, skKind || this.modeSkill);
      if (!sk) return { html: '' };
      if (sk.kind === 'leap' || sk.kind === 'step') {
        const c = clampAim(pr.x, pr.z, p.x, p.z, sk.range), col = COL[sk.kind];
        const rr = ring(sk.range, 0.05, col, 0.4, 0.05, 72); rr.position.x = pr.x; rr.position.z = pr.z; L.add(rr);
        L.add(ribbon([{ x: pr.x, z: pr.z }, c], 0.1, col, 0.7, 0.35));
        const d = ring(radiusOf(q) + 0.3, 0.12, col, 0.95); d.position.x = c.x; d.position.z = c.z; L.add(d);
        this.previewEnd = { x: c.x, z: c.z, fx: ux, fz: uz };
        return { html: `${sk.name}<small>${sk.kind === 'leap' ? 'jumps over walls and squads; shoves enemies at the landing' : 'reappears there; no parting blows'}</small>` };
      }
      if (sk.kind === 'pierce') {
        const bx = pr.x + ux * sk.range, bz = pr.z + uz * sk.range, cut = losCut(this.state.terrain, pr.x, pr.z, bx, bz);
        L.add(lineShape(pr.x, pr.z, ux, uz, sk.range * cut, sk.width, COL.pierce, 0.55));
        if (cut < 1) L.add(lineShape(pr.x + ux * sk.range * cut, pr.z + uz * sk.range * cut, ux, uz, sk.range * (1 - cut), sk.width, 0x444444, 0.45));
        let n = 0; for (const e of enemies) { const t = segCircle(pr.x, pr.z, bx, bz, e.x, e.z, radiusOf(e) + sk.width / 2); if (t >= 0 && t < cut) { n++; mark(e); } }
        return { html: `Piercing Bolt ${sk.dmg * q.models}<small>${n ? `hits ${n} on the line if they stay` : cut < 1 ? 'blocked by a wall' : 'nobody on the line now'}</small>`, bad: !n && cut < 1 };
      }
      if (SELF_SKILLS.includes(sk.kind)) return { html: `${sk.name}<small>tap the knob to use it</small>` };
      if (sk.kind === 'charge') {
        const ln = this.planner.chargeLane(q, pr.x, pr.z, p.x, p.z);
        this.previewEnd = { x: ln.x, z: ln.z, fx: ln.dx, fz: ln.dz };
        const cut = losCut(this.state.terrain, pr.x, pr.z, pr.x + ln.dx * sk.len, pr.z + ln.dz * sk.len);
        L.add(lineShape(pr.x, pr.z, ln.dx, ln.dz, sk.len, ln.w, COL.charge, 0.5));
        if (ln.hit) mark(ln.hit);
        return { html: `Charge ${sk.dmg * q.models}<small>${ln.hit ? 'hits the first squad in the lane' : 'nobody in the lane now'}${cut < 1 ? ' · a wall stops it' : ''}</small>`, bad: cut < 1 && !ln.hit };
      }
      if (sk.kind === 'blast' || sk.kind === 'storm') {
        const c = clampAim(pr.x, pr.z, p.x, p.z, sk.range), col = COL[sk.kind];
        const rr = ring(sk.range, 0.05, col, 0.4, 0.05, 72); rr.position.x = pr.x; rr.position.z = pr.z; L.add(rr);
        const d = disc(sk.radius, col, 0.45); d.position.x = c.x; d.position.z = c.z; L.add(d);
        let n = 0; for (const e of enemies) if (Math.hypot(e.x - c.x, e.z - c.z) <= sk.radius + radiusOf(e) * 0.6) { n++; mark(e); }
        return { html: `${sk.name} ${sk.dmg * q.models}<small>${sk.kind === 'storm' ? 'arcs over walls · ' : ''}${n ? `hits ${n} if they stay` : 'nobody there now'}</small>` };
      }
      if (sk.kind === 'rally') {
        const d = disc(sk.radius, COL.rally, 0.3); d.position.x = pr.x; d.position.z = pr.z; L.add(d);
        return { html: `Rally<small>allies in the circle: +1 defend, hit 25% harder</small>` };
      }
    }
    // basic attack
    const at = def.attack, dmg = at.dmg * q.models;
    if (at.kind === 'swing') {
      const R = radiusOf(q) + at.reach; let n = 0;
      L.add(arcShape(pr.x, pr.z, ux, uz, R, at.cosHalf, COL.swing, 0.55));
      for (const e of enemies) if (arcHits(pr.x, pr.z, ux, uz, R, at.cosHalf, e.x, e.z, radiusOf(e))) { n++; mark(e); }
      return { html: `Swing ${dmg}<small>${n ? `hits ${n} if they stay` : 'nobody there now'}</small>` };
    }
    if (at.kind === 'lob') {
      const c = clampAim(pr.x, pr.z, p.x, p.z, at.range);
      const rr = ring(at.range, 0.05, COL.volley, 0.35, 0.05, 72); rr.position.x = pr.x; rr.position.z = pr.z; L.add(rr);
      const d = disc(at.radius, COL.volley, 0.45); d.position.x = c.x; d.position.z = c.z; L.add(d);
      let n = 0; for (const e of enemies) if (Math.hypot(e.x - c.x, e.z - c.z) <= at.radius + radiusOf(e) * 0.6) { n++; mark(e); }
      return { html: `Lob ${dmg}<small>arcs over walls · ${n ? `hits ${n} if they stay` : 'nobody there now'}</small>` };
    }
    // volley: line of sight and cover
    const bx = pr.x + ux * at.range, bz = pr.z + uz * at.range;
    const cut = losCut(this.state.terrain, pr.x, pr.z, bx, bz);
    L.add(lineShape(pr.x, pr.z, ux, uz, at.range * cut, at.width, COL.volley, 0.55));
    if (cut < 1) L.add(lineShape(pr.x + ux * at.range * cut, pr.z + uz * at.range * cut, ux, uz, at.range * (1 - cut), at.width, 0x444444, 0.45));
    let best = null, bt = cut;
    for (const e of enemies) { const t = segCircle(pr.x, pr.z, bx, bz, e.x, e.z, radiusOf(e) + at.width / 2); if (t >= 0 && t < bt) { bt = t; best = e; } }
    if (best) mark(best);
    const cover = best && inCover(this.state.terrain, pr.x, pr.z, best.x, best.z);
    return { html: `Volley ${cover ? Math.round(dmg * RULES.coverMult) : dmg}<small>${best ? (cover ? 'target in cover: half damage' : 'clear shot if it stays') : cut < 1 ? 'blocked by a wall' : 'nobody there now'}</small>`, bad: !best && cut < 1, warn: cover };
  }

  dragMove(cx, cy) {
    const d = this.drag; if (!d) return;
    const p = this.view.pick(cx, cy); if (!p) return;
    if (d.kind === 'place') { d.pt = p; d.far = d.far || Math.hypot(cx - d.sx, cy - d.sy) > 9; this.movePlace(p.x, p.z); return; }
    const q = this.selectedSquad();
    if (d.knob) { const kp = this.knobPos?.[d.knobKey]; if (kp && Math.hypot(kp.x - cx, kp.y - cy) < 14 && !d.pt) return; }
    d.pt = p;
    const r = this.preview(d.kind, q, p, d.sk);
    const tape = $('tape');
    tape.innerHTML = r.html;
    tape.classList.toggle('short', !!r.bad);
    tape.classList.toggle('warn', !!r.warn && !r.bad);
    tape.classList.remove('hidden');
    tape.style.transform = `translate(${cx + 16}px, ${cy - 46}px)`;
  }

  dragEnd(cx, cy, moved) {
    const d = this.drag; this.drag = null;
    this.previewEnd = null;
    this.view.clear('ghost'); $('tape').classList.add('hidden');
    if (!d) return;
    if (d.kind === 'place') { if (d.far && this.buildMode && !this.buildMode.err) this.confirmPlace(); else this.changed(); return; }
    const q = this.selectedSquad();
    if (!moved || !d.pt) {
      if (d.knob && q) {
        // tapping a knob: pick that order type (self skills like Rally cast at once)
        const sk = d.kind === 'skill' ? skillOf(defOf(q), d.sk) : null;
        if (sk && SELF_SKILLS.includes(sk.kind)) { if (this.planner.addSkill(q.id, sk.kind, q.x, q.z)) this.hint(2); }
        else { this.mode = d.kind; this.modeSkill = d.sk; this.changed(); this.toast(d.kind === 'move' ? 'Move: drag the green knob, or tap the table' : sk ? `${sk.name}: drag its knob to aim, or tap a spot` : 'Attack: drag the red knob to aim, or tap a spot'); }
        return;
      }
      this.onTap(cx, cy); return;
    }
    if (this.orderAt(d.kind, q, d.pt.x, d.pt.z, d.sk)) this.hint(2);
  }

  onKey(e) {
    if (e.key === ' ' && this.phase === 'planning') { e.preventDefault(); this.ready(); }
    if (e.key === ' ' && this.phase === 'playback') { e.preventDefault(); this.playing = !this.playing; }
    if ((e.key === 'r' || e.key === 'R') && this.buildMode) this.rotatePlace();
    if (e.key === 'Enter' && this.buildMode) this.confirmPlace();
    if (e.key === 'Escape') { if (this.buildMode) { this.buildMode = null; this.changed(); } else if (this.buildOpen) this.openBuild(false); else { this.select(null); this.selB = null; this.changed(); } }
    if (e.key === 'b' && this.phase === 'planning') this.openBuild();
    if (e.key === 'Backspace' && this.selected) { e.preventDefault(); this.planner.undo(this.selected); }
  }

  // ======================================================================== HUD
  updateTop() {
    $('t-round').textContent = this.state.round;
    const ph = $('t-phase');
    ph.textContent = this.phase === 'playback' ? 'Battle' : 'Planning';
    ph.classList.toggle('play', this.phase === 'playback');
    const c = this.planner.cp();
    $('t-sup').innerHTML = this.supplyHTML();
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
    const sb = this.phase === 'planning' && !q ? this.selectedBuilding() : null;
    if (sb) { this.renderBuildingDock(sb); return; }
    if (this.phase !== 'planning' || !q) { dock.classList.add('hidden'); info.classList.add('hidden'); return; }
    const def = defOf(q), at = def.attack, sks = skillsOf(def);
    const atkName = { swing: 'Swing', volley: 'Volley', lob: 'Lob' }[at.kind];
    if (q.owner !== this.me) {
      dock.classList.add('hidden');
      info.classList.remove('hidden');
      const atkTxt = at.kind === 'swing' ? `Swings for ${at.dmg * q.models} (${at.dmg} per model), reach ${at.reach}″` : at.kind === 'lob' ? `Lobs arrows over walls for ${at.dmg * q.models}, range ${at.range}″` : `Volleys for ${at.dmg * q.models}, range ${at.range}″ (needs a clear line)`;
      const skTxt = sks.map(k => ` · ${k.name}${cdOf(q, k.kind) > 0 ? ` recharging (${cdOf(q, k.kind)})` : ' ready'}`).join('');
      info.innerHTML = `<b>Enemy ${esc(def.name)}</b> · tier ${def.tier} · ${q.models}/${def.models} models · ${q.hp} HP<br>
        <span style="color:var(--muted)">${atkTxt}${skTxt} · moves ${(def.tier * RULES.moveFactor * 100).toFixed(1)}″ per round.${def.ghost ? ' Ignores engagement.' : ''} The red ring shows how far it can strike this round.</span>`;
      return;
    }
    info.classList.add('hidden');
    dock.classList.remove('hidden');
    const plan = this.planner.plan(q.id);
    const left = plan ? this.planner.apLeft(q) : apFor(q);
    const st = this.planner.stanceOf(q);
    const engaged = engagedWith(q, this.state.squads).length > 0;
    const ctl = plan ? 'Your orders' : (q.role === 'hero' ? 'Hero: free to command' : 'Giving an order uses 1 command point');
    // every button is coloured by category: green = move/speed, red = attack, blue = defence/buffs
    const b = (act, ic, label, sub, on = false, dis = false, cat = 'move') => `<button class="act cat-${cat}${on ? ' on' : ''}" data-act="${act}" ${dis ? 'disabled' : ''}>${icon(ic, 20)}${label}<small>${sub}</small></button>`;
    const skBtn = sks.map(sk => { const cd = cdOf(q, sk.kind); return b('skill:' + sk.kind, SKILL_IC[sk.kind], sk.name, cd > 0 ? `recharging ${cd}` : this.planner.skillUsed(q.id, sk.kind) ? 'used' : `${sk.ap} AP`, this.mode === 'skill' && this.modeSkill === sk.kind, !this.planner.skillReady(q, sk.kind) || left < sk.ap, sk.cat); }).join('');
    const msk = this.mode === 'skill' ? skillOf(def, this.modeSkill) : null;
    const melee = at.kind === 'swing';
    const prepBtn = melee
      ? (def.parry ? b('parry', 'parry', 'Parry', plan?.parry ? 'ready' : `${RULES.parryCost} AP`, !!plan?.parry, !plan?.parry && left < RULES.parryCost, 'defense') : '')
      : b('mode:overwatch', 'overwatch', 'Overwatch', plan?.overwatch ? 'set · aim again' : `${RULES.overwatchCost} AP`, this.mode === 'overwatch' || !!plan?.overwatch, !plan?.overwatch && left < RULES.overwatchCost, 'defense');
    const hints = {
      move: '<b>Drag the green knob</b> to draw a path (or tap the table). The ring shows how far it can still go.' + (engaged ? ' <b>Engaged:</b> stepping away costs 30 AP and gives the enemy a free hit.' : ''),
      attack: `<b>Drag the red knob</b> to aim the ${atkName.toLowerCase()}. It hits whatever is in the shape when it lands, so aim where enemies <b>will be</b>.` + (at.kind === 'volley' ? ' Walls block volleys; forests give cover.' : at.kind === 'lob' ? ' Lobs arc over walls.' : ''),
      skill: msk ? `<b>${esc(msk.name)}:</b> ${SKILL_HELP[msk.kind]} Then it recharges for ${msk.cd} round${msk.cd > 1 ? 's' : ''}.` : '',
      overwatch: '<b>Drag the red knob</b> to point the overwatch cone. The squad fires once at the first enemy that moves inside it, at any speed tier.',
    };
    dock.innerHTML = `<div class="dk-head"><div><div class="nm">${esc(def.name)}${engaged ? ' <span class="eng">Engaged</span>' : ''}</div><div class="sub">Tier ${def.tier + (plan?.upgrades || 0)} · ${q.models}/${def.models} models · ${q.hp} HP · ${ctl}</div></div>
        <button class="ib x" data-act="close">✕</button></div>
      <div class="dk-ap">${apBlocks(q, plan, false)}</div>
      <div class="dk-btns">
        ${b('mode:move', 'move', 'Move', `${(left * def.tier * RULES.moveFactor).toFixed(1)}″ left`, this.mode === 'move', left < 1, 'move')}
        ${b('mode:attack', melee ? 'attack' : 'shoot', atkName, `${at.ap} AP`, this.mode === 'attack', left < at.ap, 'attack')}
        ${skBtn}
        ${prepBtn}
        ${b('defend', 'defend', 'Defend', `${RULES.defendCost} AP · ${plan?.defends || 0}`, false, left < RULES.defendCost, 'defense')}
        ${b('tier', 'tierup', 'Act earlier', plan?.upgrades >= RULES.maxUpgrades ? 'max' : `${RULES.tierCost[plan?.upgrades || 0]} AP`, false, (plan?.upgrades || 0) >= RULES.maxUpgrades || left < RULES.tierCost[plan?.upgrades || 0])}
        ${b('undo', 'undo', 'Undo', '', false, !plan, 'none')}
        ${b('clear', 'release', 'Clear', 'back to stance', false, !plan, 'none')}
      </div>
      <div class="dk-stance">Stance (free): ${['guard', 'hold', 'advance'].map(s => `<button class="chip${st === s ? ' on' : ''}" data-act="stance:${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <div class="hint">${hints[this.mode] || hints.move}</div>`;
    dock.querySelectorAll('[data-act]').forEach(el => el.onclick = () => this.dockAction(el.dataset.act, q));
  }

  dockAction(act, q) {
    const [k, arg] = act.split(':');
    if (k === 'close') this.select(null);
    else if (k === 'mode') this.mode = this.mode === arg && arg !== 'move' ? 'move' : arg;
    else if (k === 'skill') {
      if (SELF_SKILLS.includes(arg)) { if (this.planner.addSkill(q.id, arg, q.x, q.z)) this.hint(2); }
      else if (this.mode === 'skill' && this.modeSkill === arg) this.mode = 'move';
      else { this.mode = 'skill'; this.modeSkill = arg; }
    }
    else if (k === 'parry') { const p = this.planner.plan(q.id); if (p?.parry) { p.parry = false; p.hist.splice(p.hist.lastIndexOf('parry'), 1); if (!p.hist.length) this.planner.clear(q.id); } else this.planner.prepaid(q.id, 'parry'); }
    else if (k === 'defend') this.planner.prepaid(q.id, 'defends');
    else if (k === 'tier') this.planner.prepaid(q.id, 'upgrades');
    else if (k === 'undo') this.planner.undo(q.id);
    else if (k === 'clear') this.planner.clear(q.id);
    else if (k === 'stance') this.planner.setStance(q.id, arg);
    this.changed();
  }

  // short confirmation text over a squad when an order is added
  confirm(q, text) { this.texts.add(q.x, q.z, text, 'ok', 2.4, 1.3); }

  // first-rounds hint strip: 0 select a squad, 1 give an order, 2 press Ready
  hint(step) {
    if (this.hintsDone) return;
    if (step !== undefined) this.hintStep = Math.max(this.hintStep || 0, step);
    const el = $('hintbar');
    if (this.phase !== 'planning' || this.state.round > 3) { el.classList.add('hidden'); return; }
    const msgs = [
      '<b>1.</b> Tap one of your squads (blue rings) or its card below.',
      '<b>2.</b> Drag the <span class="k mv">green</span> knob to move, the <span class="k at">red</span> knob to attack, and the skill knob (coloured by type: <span class="k mv">move</span> <span class="k at">attack</span> <span class="k df">defence</span>).',
      '<b>3.</b> Order more squads (3 per round + your hero), then press <b>Ready</b>, or <b>Rehearse</b> to preview your plan.',
    ];
    el.innerHTML = `<span>${msgs[this.hintStep || 0]}</span><button class="ib sm" id="hint-x" title="Hide tips">✕</button>`;
    el.classList.remove('hidden');
    $('hint-x').onclick = () => { this.hintsDone = true; el.classList.add('hidden'); try { localStorage.setItem('tiers-v4-hints', '1'); } catch {} };
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
      if (d.visible === false) { const el = this.labels.get(d.id); if (el) el.style.display = 'none'; continue; }
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
      const parry = planning ? !!plan?.parry : !!d.parryShown;
      const watch = planning ? !!plan?.overwatch : !!d.watchShown;
      const engaged = planning && engagedWith(d, this.state.squads).length > 0;
      const cds = planning ? skillsOf(def).filter(k => cdOf(d, k.kind) > 0).map(k => [k, cdOf(d, k.kind)]) : [];
      const cd = cds.map(([k, n]) => k.kind + n).join();
      const key = `${tier}|${d.models}|${d.hp}|${sel}|${!!plan}|${d.dying !== undefined}|${defs}|${ups}|${stance}|${zoomedOut}|${parry}|${watch}|${engaged}|${cd}|${d.lastSeen}`;
      if (el.dataset.key !== key && d.lastSeen !== undefined) {
        el.dataset.key = key;
        el.style.setProperty('--team', TEAM[d.owner]);
        el.innerHTML = `<div class="sl-h"><span class="tr">?</span><span class="nm">${esc(def.name)}</span>${icon(def.role, 14)}</div><div class="sl-s">last seen ${d.lastSeen ? d.lastSeen + ' round' + (d.lastSeen > 1 ? 's' : '') + ' ago' : 'now'}</div>`;
        el.className = 'sl lastseen';
        el._w = el.offsetWidth; el._h = el.offsetHeight;
      } else if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.style.setProperty('--team', TEAM[d.owner]);
        const maxHp = def.models * def.hpPer;
        const st = [];
        if (def.models > 1) st.push(`<span class="st">${icon('army', 12)}×${d.models}</span>`);
        if (defs > 0) st.push(`<span class="st" title="Defends: each halves one hit">${icon('defend', 12)}${defs}</span>`);
        if (ups > 0) st.push(`<span class="st">${icon('tierup', 12)}${ups > 1 ? ups : ''}</span>`);
        if (parry) st.push(`<span class="st" title="Parry ready">${icon('parry', 12)}</span>`);
        if (watch) st.push(`<span class="st" title="Overwatch">${icon('overwatch', 12)}</span>`);
        if (engaged) st.push(`<span class="st" title="Engaged in melee">${icon('engaged', 12)}</span>`);
        for (const [k, n] of cds) st.push(`<span class="st cdc" style="--c:${CAT_HEX[k.cat]}" title="${esc(k.name)} recharging">${icon(SKILL_IC[k.kind], 11)}${n}</span>`);
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
    this.buildingLabelItems(items, seen, zoomedOut);
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
    $('scrub-sections').innerHTML = tl.sections.map(s => `<div style="left:${pct(s.t0 - 14)};width:${pct(s.t1 - s.t0 + 14)}">${s.tier === 0 ? 'BUILDINGS' : 'TIER ' + s.tier}</div>`).join('');
    const rows = new Map();
    let n = 0;
    $('scrub-blocks').innerHTML = tl.blocks.filter(b => b.kind !== 'wait' && tl.everSeen(b.id)).map(b => {
      if (!rows.has(b.id)) rows.set(b.id, n++);
      const q = tl.pre.squads.find(x => x.id === b.id);
      const col = b.kind === 'move' ? (q.owner === this.me ? '#e8e4da' : '#7c766c') : ACT_COL[b.kind] || 'var(--volley)';
      return `<i style="left:${pct(b.T0)};width:${pct(b.T1 - b.T0)};top:${18 + (rows.get(b.id) % 6) * 6}px;background:${col}"></i>`;
    }).join('');
  }

  buildLog() {
    const tl = this.tl;
    const bld = id => tl.blds.find(b => b.id === id);
    const name = id => { const q = tl.pre.squads.find(x => x.id === id); if (!q) { const b = bld(id); return b ? `<b class="t${b.owner}">${b.owner === this.me ? 'Your' : 'Enemy'} ${esc(this.bname(b))}</b>` : '?'; } if (q.owner !== this.me && !tl.everSeen(id)) return `<b class="t${q.owner}">An unseen enemy</b>`; return `<b class="t${q.owner}">${q.owner === this.me ? 'Your' : 'Enemy'} ${esc(defOf(q).name)}</b>`; };
    const lines = [];
    for (const e of tl.events) {
      const verb = { swing: 'cuts into', volley: 'shoots', lob: 'rains arrows on', storm: 'brings an Arrow Storm down on', sweep: 'sweeps through', pierce: 'drives a piercing bolt through', charge: 'charges into', blast: 'blasts', parting: 'lands a parting blow on', riposte: 'ripostes' };
      if (e.type === 'construct' && (e.owner === this.me || this.knownB.has(e.id))) lines.push({ T: e.T, html: `${name(e.id)} ${e.done ? 'goes up' : 'construction begins'}` });
      else if (e.type === 'built' && (e.owner === this.me || this.knownB.has(e.id))) lines.push({ T: e.T, html: `${name(e.id)} is finished` });
      else if (e.type === 'train' && e.owner === this.me) lines.push({ T: e.T, html: `${name(e.id)} starts training ${esc(FACTIONS[this.faction(e.owner)].units[e.role].name)}` });
      else if (e.type === 'spawn' && e.owner === this.me) lines.push({ T: e.T, html: `<b class="t${e.owner}">New ${esc(FACTIONS[this.faction(e.owner)].units[e.role].name)}</b> join your army` });
      else if (e.type === 'bdown') lines.push({ T: e.T, html: `${name(e.id)} is destroyed` });
      else if (e.type === 'shrine') lines.push({ T: e.T, html: e.owner === this.me ? 'You take a shrine' : e.owner < 0 ? 'A shrine is freed' : 'The enemy takes a shrine' });
      else if (e.type === 'income' && e.owner === this.me) lines.push({ T: e.T, html: `Income <span class="gain">+${e.amount}</span> supply (now ${e.supply})` });
      else if (e.type === 'hit') lines.push({ T: e.T, html: `${name(e.src)} ${verb[e.kind] || 'hits'} ${name(e.dst)} <span class="dmg">−${e.dmg}</span>${e.walled ? ' (shield wall)' : ''}${e.cover ? ' (cover)' : ''}${e.defended ? ' (defended)' : ''}${e.lost ? ` · ${e.lost} model${e.lost > 1 ? 's' : ''} fall` : ''}` });
      else if (e.type === 'down') lines.push({ T: e.T, html: `${name(e.id)} is destroyed` });
      else if (e.type === 'parry') lines.push({ T: e.T, html: `${name(e.id)} parries ${name(e.src)}` });
      else if (e.type === 'disengage') lines.push({ T: e.T, html: `${name(e.id)} disengages from the fight` });
      else if (e.type === 'watchEnd') lines.push({ T: e.T, html: `${name(e.id)}: overwatch fires!` });
      else if (e.type === 'buff') lines.push({ T: e.T, html: `${name(e.id)} rallies ${e.ids.length} squad${e.ids.length > 1 ? 's' : ''}` });
      else if (e.type === 'raise') lines.push({ T: e.T, html: `${name(e.id)} raises the dead${e.ids.length ? `: ${e.ids.map(name).join(', ')}` : ' (nobody to raise)'}` });
      else if (e.type === 'land') lines.push({ T: e.T, html: `${name(e.id)} ${e.kind === 'leap' ? 'leaps' : 'steps through the shadows'}${e.pushed.length ? `, shoving ${e.pushed.map(name).join(', ')}` : ''}` });
      else if (e.type === 'wallOn') lines.push({ T: e.T, html: `${name(e.id)} braces a shield wall` });
      else if (e.type === 'release' && !e.hit.length) lines.push({ T: e.T, html: `${name(e.id)}: ${e.kind} ${e.blocked ? 'blocked' : 'misses (nobody in the area)'}` });
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
        const at = id => { const d = this.sampleCache?.find(x => x.id === id); return d && d.visible !== false ? d : null; };
        const atB = id => (this.blist || []).find(b => b.id === id);
        if (e.type === 'hit' && e.building) { const b = atB(e.dst); if (b) this.texts.add(b.x, b.z, `−${e.dmg}`, 'dmg', 4); }
        else if (e.type === 'bdown') { const b = atB(e.id); if (b) { this.texts.add(b.x, b.z, 'Destroyed', 'down', 4.6, 2); this.pulse(b.x, b.z, hitRadius(b) + 0.8, 0xff3b30); } }
        else if (e.type === 'construct') { const b = atB(e.id); if (b) this.texts.add(b.x, b.z, e.done ? 'Built' : 'Building…', 'ok', 3.2); }
        else if (e.type === 'built') { const b = atB(e.id); if (b) { this.texts.add(b.x, b.z, 'Finished!', 'ok', 4.2, 1.8); this.pulse(b.x, b.z, hitRadius(b) + 0.6, 0x34c759); } }
        else if (e.type === 'train' && e.owner === this.me) { const b = atB(e.id); if (b) this.texts.add(b.x, b.z, `Training ${FACTIONS[this.faction(e.owner)].units[e.role].name}`, 'ok', 3.6, 1.8); }
        else if (e.type === 'spawn' && (e.owner === this.me || this.tl.pointSeen(e.x, e.z, e.T))) { this.texts.add(e.x, e.z, `+ ${FACTIONS[this.faction(e.owner)].units[e.role].name}`, 'ok', 2.4, 2); this.pulse(e.x, e.z, 1.2, TEAM_HEX[e.owner]); }
        else if (e.type === 'shrine') { const was = this.tl.shrinesAt(e.T - 0.01).find(sh => sh.x === e.x && sh.z === e.z)?.owner; this.texts.add(e.x, e.z, e.owner === this.me ? 'Shrine taken' : was === this.me ? 'Shrine lost' : e.owner < 0 ? 'Shrine freed' : 'Enemy shrine', e.owner === this.me ? 'ok' : 'def', 2.6, 2); this.pulse(e.x, e.z, RULES.shrineRadius, e.owner < 0 ? 0xd8d2c0 : TEAM_HEX[e.owner]); }
        else if (e.type === 'income' && e.owner === this.me) { const hq = (this.blist || []).find(b => b.owner === this.me && b.type === 'hq'); if (hq) this.texts.add(hq.x, hq.z, `+${e.amount} supply`, 'ok', 5.4, 2.2); }
        else if (e.type === 'hit') {
          const q = at(e.dst);
          if (q) {
            this.texts.add(q.x, q.z, `−${e.dmg}`, 'dmg');
            const tag = { charge: 'Charge!', parting: 'Parting blow', riposte: 'Riposte', blast: 'Bone Blast', storm: 'Arrow Storm', sweep: 'Sweep', pierce: 'Piercing Bolt' }[e.kind];
            if (e.walled) this.texts.add(q.x, q.z, 'Shields!', 'def', 2.1);
            if (tag) this.texts.add(q.x, q.z, tag, 'tag', 2.9);
            if (e.cover) this.texts.add(q.x, q.z, 'Cover', 'def', 1.9);
            if (e.defended) this.texts.add(q.x, q.z, 'Defended', 'def', 1.6);
            if (e.lost) this.texts.add(q.x, q.z, `−${e.lost} model${e.lost > 1 ? 's' : ''}`, 'loss', 1.2);
          }
        } else if (e.type === 'down') { const q = at(e.id); if (q) this.texts.add(q.x, q.z, 'Destroyed', 'down', 2.6, 2); }
        else if (e.type === 'parry') { const q = at(e.id); if (q) this.texts.add(q.x, q.z, 'Parried!', 'tag', 2.9, 1.6); }
        else if (e.type === 'disengage') { const q = at(e.id); if (q) this.texts.add(q.x, q.z, 'Disengage', 'def', 2.4); }
        else if (e.type === 'watchEnd') { const q = at(e.id); if (q) this.texts.add(q.x, q.z, 'Overwatch!', 'tag', 2.6); }
        else if (e.type === 'buff') { for (const id of e.ids) { const q = at(id); if (q) { this.texts.add(q.x, q.z, 'Rallied', 'ok', 2.4); this.pulse(q.x, q.z, radiusOf(q) + 0.4, COL.rally); } } }
        else if (e.type === 'release' && (e.kind === 'blast' || e.kind === 'storm')) this.pulse(e.ex, e.ez, skillOf(defOf(this.tl.pre.squads.find(x => x.id === e.id)), e.kind).radius, COL[e.kind], true);
        else if (e.type === 'release' && e.kind === 'sweep') { const q = at(e.id); if (q) this.pulse(q.x, q.z, radiusOf(q) + 1.6, COL.sweep); }
        else if (e.type === 'land') { const q = at(e.id); if (q) { this.pulse(e.ex, e.ez, radiusOf(q) + 0.6, COL[e.kind]); this.texts.add(e.ex, e.ez, e.kind === 'leap' ? 'Heroic Leap!' : 'Shadow Step', 'tag', 2.6); } for (const id of e.pushed) { const o = at(id); if (o) this.texts.add(o.x, o.z, 'Shoved', 'def', 2.2); } }
        else if (e.type === 'raise') { for (const id of e.ids) { const q = at(id); if (q) { this.texts.add(q.x, q.z, '+1 model', 'ok', 2.4); this.pulse(q.x, q.z, radiusOf(q) + 0.4, COL.raise); } } }
        else if (e.type === 'wallOn') { const q = at(e.id); if (q) this.texts.add(q.x, q.z, defOf(q).skills[0].name, 'ok', 2.4); }
        else if (e.type === 'release' && e.blocked) { const q = at(e.id); if (q) this.texts.add(e.ex, e.ez, 'Blocked', 'def', 1.2); }
      }
    }
    this.lastT = T;
    const list = tl.sample(T);
    this.sampleCache = list;
    if (this.rehearsal) for (const d of list) if (d.owner === this.me) d.ghost = true;
    this.updateWatches(list, T);
    this.syncViews(list, false, dt);
    this.syncBuildings(this.playbackBuildings(T));
    this.syncShrines(tl.shrinesAt(T));
    this.updateLabels(list);
    this.tele.update(tl.activeTeles(T), T);
    this.shots.update(this.shotList, T);
    // timeline UI
    $('scrub-head').style.left = (100 * T / tl.total) + '%';
    $('pb-play').textContent = this.playing ? '❚❚' : '▶';
    const sec = tl.sectionAt(T);
    let cap;
    if (!sec) cap = T >= tl.total ? (this.rehearsal ? 'Rehearsal over. Drag the timeline to watch again, or go <b>back to planning</b>.' : 'Round over. Drag the timeline to watch again, or press <b>Next round</b>.') : 'Starting…';
    else {
      const names = sec.squads.map(id => { const q = tl.pre.squads.find(x => x.id === id); return q && (q.owner === this.me || tl.everSeen(id)) ? `${q.owner === this.me ? '' : 'enemy '}${defOf(q).name}` : ''; }).filter(Boolean);
      if (sec.squads.some(id => { const q = tl.pre.squads.find(x => x.id === id); return q && q.owner !== this.me && !tl.everSeen(id); })) names.push('unseen enemies');
      if (sec.tier === 0) cap = '<b>Buildings</b>: towers and keeps fire at the nearest enemy they can see.';
      else cap = `<b>Tier ${sec.tier}</b>${sec.tier >= 6 ? ' · fast' : sec.tier <= 4 ? ' · slow' : ''}: ${esc(names.join(', '))} act at the same time.`;
    }
    $('pb-caption').innerHTML = (this.rehearsal ? '<span class="rh">Rehearsal: enemies stand still</span> ' : '') + cap;
    $('pb-next').style.boxShadow = T >= tl.total ? '0 0 0 3px #ffc400' : '';
    const past = this.logLines || [];
    $('log').querySelectorAll('.lg[data-i]').forEach(el => el.classList.toggle('past', past[+el.dataset.i].T > T));
  }

  // overwatch cones that follow the watcher until it fires
  updateWatches(list, T) {
    this.watchMeshes = this.watchMeshes || new Map();
    const active = this.tl.activeWatches(T).map(w => ({ ...w, col: COL.watch, op: 0.13, key: 'w' + w.id }))
      .concat(this.tl.activeWalls(T).map(w => ({ ...w, col: COL.wall, op: 0.45, key: 's' + w.id })));
    const L = this.view.layers.fx;
    for (const [k, m] of this.watchMeshes) if (!active.some(w => w.key === k)) { L.remove(m); m.geometry?.dispose(); m.material?.dispose(); this.watchMeshes.delete(k); }
    for (const w of active) {
      const d = list.find(x => x.id === w.id); if (!d || d.dying !== undefined || d.visible === false) { const old = this.watchMeshes.get(w.key); if (old) { this.view.layers.fx.remove(old); old.geometry.dispose(); old.material.dispose(); this.watchMeshes.delete(w.key); } continue; }
      const key = `${d.x.toFixed(2)},${d.z.toFixed(2)},${d.fx.toFixed(2)},${d.fz.toFixed(2)}`;
      const old = this.watchMeshes.get(w.key);
      if (old && old.userData.key === key) continue;
      if (old) { L.remove(old); old.geometry.dispose(); old.material.dispose(); }
      const m = arcShape(d.x, d.z, d.fx, d.fz, w.R, w.ch, w.col, w.op, w.inner || 0); m.userData.key = key;
      L.add(m); this.watchMeshes.set(w.key, m);
    }
  }
  clearWatches() { if (!this.watchMeshes) return; for (const m of this.watchMeshes.values()) { this.view.layers.fx.remove(m); m.geometry.dispose(); m.material.dispose(); } this.watchMeshes.clear(); }
  // expanding ring / flash on the table
  pulse(x, z, r, color, fill = false) {
    const m = fill ? disc(r, color, 0.6) : ring(r, 0.16, color, 0.9);
    m.position.x = x; m.position.z = z;
    this.view.addFx(m, 0.9, (o, k) => { o.scale.setScalar(1 + k * 0.35); o.material.opacity = (fill ? 0.6 : 0.9) * (1 - k); });
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
      if (this.state.buildings) { this.syncBuildings(this.planningBuildings()); this.syncShrines(this.state.shrines || []); }
      this.updatePlaceMark();
      if (this.phase === 'planning') {
        if (this.dirty) { this.dirty = false; this.drawPlan(); this.renderSquadBar(); this.renderDock(); this.renderBuildBar(); this.updateTop(); }
        this.updateLabels(list);
      }
      if (this.phase === 'planning' || this.knobPos) {
        this.updateKnobs();
      }
      this.updateGhost(dt);
    }
    this.texts.update(dt);
    this.view.render(dt);
  }
}

Object.assign(Game.prototype, BaseUI);

const CAT_HEX = { move: '#34c759', attack: '#ff3b30', defense: '#3fa9ff' };
const ACT_COL = { swing: 'var(--swing)', volley: 'var(--volley)', lob: 'var(--volley)', charge: CAT_HEX.move, leap: CAT_HEX.move, step: CAT_HEX.move, blast: CAT_HEX.attack, storm: CAT_HEX.attack, sweep: CAT_HEX.attack, pierce: CAT_HEX.attack, rally: CAT_HEX.defense, raise: CAT_HEX.defense, wall: CAT_HEX.defense, wait: '#8a857c' };
const SKILL_IC = { charge: 'dash', leap: 'shove', step: 'disrupt', blast: 'frag', storm: 'shoot', sweep: 'sweep', pierce: 'range', rally: 'rally', raise: 'heal', wall: 'fortify' };
const SKILL_HELP = {
  charge: 'drag its knob to aim the lane: the squad rushes down it and slams into the first enemy squad.',
  leap: 'drag its knob to a spot up to 7″ away: the hero jumps over walls and squads and shoves enemies at the landing.',
  step: 'drag its knob to a spot up to 7″ away: the hero vanishes and reappears there, with no parting blows.',
  blast: 'drag its knob to place the circle (within 9″).',
  storm: 'drag its knob to place the circle (within 15″): arrows arc over walls.',
  sweep: 'tap its knob: the hero swings all the way round, hitting every enemy close by.',
  pierce: 'drag its knob to aim the bolt: it hits every squad on the line until a wall.',
  rally: 'tap its knob: allies in the circle get +1 defend and hit 25% harder this round.',
  raise: 'tap its knob: wounded squads in the circle each get one fallen model back.',
  wall: 'tap its knob: from the start of the round, hits from the front deal only 30%.',
};
// AP bar blocks for a squad's plan
function apBlocks(q, plan, mini) {
  if (!plan) return mini ? '' : `<div class="free" style="width:100%">No orders: follows its stance</div>`;
  const total = RULES.ap;
  const parts = [];
  const pre = (plan.upgrades ? RULES.tierCost.slice(0, plan.upgrades).reduce((a, b) => a + b, 0) : 0) + plan.defends * RULES.defendCost + (plan.parry ? RULES.parryCost : 0) + (plan.overwatch ? RULES.overwatchCost : 0);
  if (pre) parts.push(`<${mini ? 'b' : 'div'} class="pre" style="width:${100 * pre / total}%;${mini ? 'background:#3fa9ff' : ''}">${mini ? '' : icon('defend', 12)}</${mini ? 'b' : 'div'}>`);
  for (const a of plan.actions) {
    const c = actionCost(q, a);
    const col = a.kind === 'move' ? '#e8e4da' : ACT_COL[a.kind] || '#8a857c';
    parts.push(mini ? `<b style="width:${100 * c / total}%;background:${col}"></b>` : `<div class="${a.kind}" style="width:${100 * c / total}%">${c >= 12 ? a.kind.toUpperCase() : ''}</div>`);
  }
  const used = planCost(q, plan);
  if (!mini && used < total) parts.push(`<div class="free" style="width:${100 * (total - used) / total}%">${total - used} AP free</div>`);
  return parts.join('');
}

function helpHTML() {
  return `
<p><b>V4 preview (milestone 3).</b> Two armies of miniatures on a tabletop. <b>Destroy the enemy ${'Keep / Crypt'}</b> to win (or wipe out its army and barracks). After round ${RULES.roundLimit} the stronger side wins.</p>
<h3>A round</h3>
<p>Both sides give orders at the same time, then press <b>Ready</b>. Squads act in <b>speed tiers</b>: fast squads (tier 6) first, then normal (5), then slow (4). Squads in the same tier act <b>at the same time</b>. Every squad has <b>100 AP</b> per round, and an action's AP cost is also how long it takes. <b>Rehearse</b> plays your plan first with the enemy standing still, so you can check it.</p>
<h3>Giving orders</h3>
<ul>
<li>Tap a squad (or its card) to select it. Knobs appear: <b style="color:#34c759">green</b> = move, <b style="color:#ff3b30">red</b> = attack, and its skill knob in the skill's colour. A see-through copy of the squad shows where it will end up. Drag a knob to aim, or tap it and then tap the table.</li>
<li>Every attack is a <b>skillshot</b>: it hits whatever is inside the shape when it lands. The shape charges up during its wind-up, so enemies can walk out of it, and yours can dodge.</li>
<li><b>Swing</b> (melee arc) and <b>Volley</b> (a line that walls stop; forests give <b>cover</b> = half damage).</li>
<li><b>Skills</b> are coloured by type (<b style="color:#34c759">green</b> = movement, <b style="color:#ff3b30">red</b> = attack, <b style="color:#3fa9ff">blue</b> = defence and buffs) and recharge for a round or two: <b>Charge</b> (Outriders, Wraiths), <b>Arrow Storm</b> (Bone Archers: arrows arc over walls onto a circle), <b>Bone Blast</b> (Necromancer), <b>Rally</b> (Lord: allies nearby get +1 defend and hit 25% harder).</li>
<li><b>Defend</b>: each defend halves one hit. <b>Parry</b> (fighters only): blocks the next melee hit and strikes back. <b>Overwatch</b> (shooters): fires once at the first enemy that moves inside the cone, even in another tier. <b>Act earlier</b>: moves the squad up a tier.</li>
<li>You can command <b>${RULES.cp} squads</b> per round (the hero is free). The others follow their stance: <b>Guard</b> fights what comes close (shooters set overwatch), <b>Hold</b> stays and defends, <b>Advance</b> marches on the nearest enemy.</li>
</ul>
<h3>Your base</h3>
<ul>
<li><b>Supply</b> (top bar) pays for buildings and new squads. Your HQ earns <b>${RULES.hqIncome}</b> a round; each <b>shrine</b> you hold adds <b>${RULES.shrineIncome}</b>. Hold a shrine by having a squad within its ring and no enemy squad there at the end of a round.</li>
<li>Press <b>Build</b>, pick a building and drag it into place (green = it fits, red = it doesn't; the status line says why). Build in your third of the table, within ${RULES.buildRange}″ of one of your buildings. <b>R</b> or ⟳ rotates walls. Buildings go up when the round starts and most take a round to finish.</li>
<li><b>Barracks</b> train a new squad each round (tap the barracks). <b>Watchtowers</b> see far and shoot the nearest enemy after every round, like your HQ. <b>Banners</b> give +1 command point. <b>Palisades</b> block paths and volleys. Army cap: ${RULES.armyCap} squads.</li>
<li>Buildings can be attacked by any swing, volley or skill, and take extra damage from it.</li>
</ul>
<h3>Fog of war</h3>
<p>You only see enemies your squads and buildings can see: within their vision range, not behind walls or rocks, and not deep in a forest (a squad inside a forest is only seen from close by). Hidden enemies show as faded <b>last seen</b> markers. The battle replay only shows what your squads saw.</p>
<h3>Engagement</h3>
<p>Squads touching an enemy melee squad are <b>engaged</b> (red ring). Stepping away costs <b>30 AP</b> and gives that enemy a free <b>parting blow</b>. Wraiths ignore engagement.</p>
<h3>Squads</h3>
<p>Each squad is several miniatures. Damage removes models, and a squad hits for <b>damage per model × models left</b>, so wounded squads hit weaker.</p>
<h3>Terrain</h3>
<p>Forests and the stream slow movement (cross at the fords) and forests give cover. Ruins and rocks block movement and volleys.</p>
<h3>Watching the battle</h3>
<p>The round plays slowly. Drag the timeline to scrub, change the speed, or tap a line in the log to jump to it. Press <b>Next round</b> when you're done.</p>
<h3>Camera</h3>
<p>Drag the table to pan, pinch or scroll to zoom, two-finger twist or right-drag to rotate.</p>`;
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.game = new Game(); }
  catch (e) { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div class="overlay"><div class="card"><h2>Could not start</h2><p>${esc(e.message || e)}</p></div></div>`); }
});
