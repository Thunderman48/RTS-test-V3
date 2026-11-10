// Game controller: menu, modes (AI / host / guest), planning UI, resolution playback.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createGame, visibleEnemies, findEntity, unitDef, moveSpeed, emptyOrders, armyCount, hqOf, commanderOf, skillDef } from './sim/state.js';
import { dist } from './sim/geom.js';
import { Nav } from './sim/nav.js';
import { resolveRound } from './sim/resolve.js';
import { buildStancePlan } from './sim/stances.js';
import { aiOrders } from './ai/ai.js';
import { View3D, disposeDeep } from './render/scene.js';
import { Playback, displayFromState } from './render/playback.js';
import { FloatTexts, eventFx } from './render/fx.js';
import { ribbon, ring, dashedRing, disc, makeUnitMesh, makeBuildingMesh, PALETTE, arrow } from './render/models.js';
import { glyph } from './ui/icons.js';
import { Input } from './ui/input.js';
import { Planner } from './ui/planner.js';
import { renderTopbar, renderStrip, renderPanel, toast } from './ui/hud.js';
import { helpHTML } from './ui/help.js';
import { describe, involvesVisible, nameMap, Feed, reportHTML, segLabel, buildDigest, digestHTML } from './ui/log.js';
import { Net, randomCode } from './net/net.js';

const $ = id => document.getElementById(id);
const BLACK = 0x0a0a0a, WHITE = 0xffffff, GREY = 0x5a5a5a;

class Game {
  constructor() {
    this.canvas = $('c');
    this.view = new View3D(this.canvas);
    this.texts = new FloatTexts($('fx-layer'), this.view);
    this.planner = new Planner(this);
    this.input = new Input(this.canvas, this.view, {
      tap: (x, y) => this.onTap(x, y, false),
      longpress: (x, y) => this.onTap(x, y, true),
      hover: (x, y) => this.onHover(x, y),
      key: e => this.onKey(e),
    });
    this.selection = []; this.uiMode = null; this.panelTab = 'orders';
    this.phase = 'menu'; this.mode = null; this.me = 0;
    this.visibleIds = new Set(); this.lastSeen = new Map(); this.trails = new Map(); this.stancePreview = new Map();
    this.speed = 1; this.paused = false; this.multi = false;
    this.guestOrders = {}; this.net = null;
    this.frame = 0;
    this.feed = new Feed($('feed'));
    this.listeners = {};
    this.intentMap = new Map();
    let st = null, fc = null;
    try { st = localStorage.getItem('tiers-step'); fc = localStorage.getItem('tiers-follow'); } catch {}
    this.stepMode = st !== '0';
    this.followCam = fc !== '0';
    this.bindDOM();
    // menu backdrop
    this.state = createGame(1);
    this.nav = new Nav(this.state);
    this.view.initMap(this.state.map);
    this.view.cam = { x: 24, z: 16, dist: 34, yaw: 0.3, pitch: 0.9 };
    this.view.updateFog([{ x: 24, z: 16, r: 100 }]);
    this.syncPlanningDisplay(true);
    $('help-body').innerHTML = helpHTML();
    this.loop();
  }

  // ======================================================================== DOM
  bindDOM() {
    $('m-ai').onclick = () => this.startAI();
    $('m-host').onclick = () => this.startHost();
    $('m-join').onclick = () => this.startJoin($('m-code').value.trim().toUpperCase());
    $('m-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('m-join').click(); });
    $('m-help').onclick = () => $('help').classList.remove('hidden');
    $('help-close').onclick = () => $('help').classList.add('hidden');
    $('lobby-cancel').onclick = () => { this.net?.close(); this.net = null; $('lobby').classList.add('hidden'); $('menu').classList.remove('hidden'); };
    $('btn-ready').onclick = () => this.ready();
    $('btn-build').onclick = () => { this.panelTab = this.panelTab === 'build' ? 'orders' : 'build'; this.uiMode = null; this.changed(); };
    $('btn-multi').onclick = () => { this.multi = !this.multi; $('btn-multi').classList.toggle('on', this.multi); toast(this.multi ? 'Multi-select on: tap units to add or remove' : 'Multi-select off'); };
    $('btn-replay').onclick = () => this.replay();
    $('btn-log').onclick = () => (this.digest ? this.openDigest() : this.openReport());
    $('report-close').onclick = () => $('report').classList.add('hidden');
    $('btn-pause').onclick = () => this.openPause();
    $('btn-menu').onclick = () => this.openPause();
    $('p-resume').onclick = () => { $('pausemenu').classList.add('hidden'); this.paused = false; };
    $('p-help').onclick = () => $('help').classList.remove('hidden');
    $('p-quit').onclick = () => location.reload();
    $('go-menu').onclick = () => location.reload();
    document.querySelectorAll('#playctl [data-speed]').forEach(b => b.onclick = () => {
      this.speed = +b.dataset.speed;
      document.querySelectorAll('#playctl [data-speed]').forEach(x => x.classList.toggle('on', x === b));
    });
    $('btn-skip').onclick = () => this.skipPlayback();
    $('btn-auto').onclick = () => this.setAuto(this.stepMode);
    $('btn-follow').onclick = () => {
      this.followCam = !this.followCam;
      try { localStorage.setItem('tiers-follow', this.followCam ? '1' : '0'); } catch {}
      if (!this.followCam) this.view.stopAnim();
      this.syncStepButtons();
    };
  }

  openPause() {
    if (this.phase === 'menu') return;
    if (this.mode === 'ai') { this.paused = true; $('pause-title').textContent = 'Paused'; }
    else $('pause-title').textContent = 'Menu (online games keep running)';
    $('pausemenu').classList.remove('hidden');
  }

  toast(m, w) { toast(m, w); }

  // tiny event emitter (used by the tutorial)
  on(name, fn) { (this.listeners[name] ||= []).push(fn); return () => { this.listeners[name] = this.listeners[name].filter(f => f !== fn); }; }
  emit(name, data) { for (const fn of this.listeners[name] || []) { try { fn(data); } catch (e) { console.error(e); } } }

  // ======================================================================== modes
  startAI() {
    this.mode = 'ai'; this.me = 0;
    this.state = createGame((Math.random() * 1e9) | 0);
    this.beginMatch();
  }

  async startHost() {
    const net = this.net = new Net();
    const code = randomCode();
    $('menu').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    $('lobby-title').textContent = 'Hosting';
    $('lobby-code').textContent = '·····';
    $('lobby-msg').textContent = 'Connecting to matchmaking…';
    try {
      await net.host(code);
    } catch (e) {
      $('lobby-msg').textContent = 'Could not host: ' + (e.message || e.type || e);
      return;
    }
    $('lobby-code').textContent = code;
    $('lobby-msg').textContent = 'Share this code. Waiting for your opponent to join…';
    net.on('connected', () => {
      if (this.mode) return;
      this.mode = 'host'; this.me = 0;
      this.state = createGame((Math.random() * 1e9) | 0);
      net.send({ t: 'start', state: this.state });
      this.setupNetHandlers();
      this.beginMatch();
    });
  }

  async startJoin(code) {
    if (code.length !== 5) { toast('Enter the 5-letter code from the host', true); return; }
    const net = this.net = new Net();
    $('menu').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    $('lobby-title').textContent = 'Joining';
    $('lobby-code').textContent = code;
    $('lobby-msg').textContent = 'Connecting…';
    net.on('msg', m => {
      if (m.t === 'start' && !this.mode) {
        this.mode = 'guest'; this.me = 1;
        this.state = m.state;
        this.setupNetHandlers();
        this.beginMatch();
      }
    });
    try { await net.join(code); $('lobby-msg').textContent = 'Connected. Waiting for the host to start…'; }
    catch (e) { $('lobby-msg').textContent = 'Could not join: ' + (e.message || e.type || e); }
  }

  setupNetHandlers() {
    const net = this.net;
    net.on('closed', () => this.gameOver('Opponent disconnected', 'The connection was closed.'));
    net.on('error', e => { if (this.mode) toast('Network: ' + (e.type || e.message || 'error'), true); });
    net.on('msg', m => { this.lastMsg = performance.now(); if (m.t !== 'ping') this.onNet(m); });
    this.lastMsg = performance.now();
    clearInterval(this.pinger);
    this.pinger = setInterval(() => {
      if (this.phase === 'over') { clearInterval(this.pinger); return; }
      net.send({ t: 'ping' });
      const quiet = (performance.now() - this.lastMsg) / 1000;
      if (quiet > 60) this.gameOver('Connection lost', 'No response from your opponent for a minute.');
      else if (quiet > 12 && !this.warnedQuiet) { this.warnedQuiet = true; toast('Connection unstable…', true); }
      else if (quiet < 5) this.warnedQuiet = false;
    }, 3000);
  }

  onNet(m) {
    const s = this.state;
    if (this.mode === 'host') {
      if (m.t === 'orders' && m.round === s.round) {
        this.guestOrders[m.round] = m.orders;
        if (this.phase === 'waiting') this.hostResolve();
        else toast('Opponent is ready');
      } else if (m.t === 'planning' && m.round === s.round) {
        this.guestPlanning = m.round;
        this.maybeStartTimer();
      }
    } else if (this.mode === 'guest') {
      if (m.t === 'result') {
        if (m.round !== s.round) { this.state = m.post; this.beginPlanning(); return; }
        const pre = this.state;
        let log;
        try { log = resolveRound(pre, m.orders).log; } catch (e) { console.error(e); log = { segments: [] }; }
        this.play(pre, log, m.post);
      } else if (m.t === 'timer' && m.round === s.round) {
        this.deadline = performance.now() + m.ms;
      } else if (m.t === 'timeup' && m.round === s.round) {
        if (this.phase === 'planning') { toast('Time is up — orders sent', true); this.ready(); }
      }
    }
  }

  maybeStartTimer() {
    if (this.mode !== 'host') return;
    if (this.phase !== 'planning' && this.phase !== 'waiting') return;
    if (this.guestPlanning !== this.state.round || this.timerRound === this.state.round) return;
    this.timerRound = this.state.round;
    const ms = CONFIG.planningTimerSec * 1000;
    this.deadline = performance.now() + ms;
    this.net.send({ t: 'timer', round: this.state.round, ms });
  }

  beginMatch() {
    $('menu').classList.add('hidden'); $('lobby').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('tb-timer-wrap').classList.toggle('hidden', this.mode === 'ai');
    this.view.initMap(this.state.map);
    this.homeCamera();
    this.lastSeen.clear(); this.trails.clear();
    this.beginPlanning();
    if (this.mode === 'ai' && !localStorage.getItem('tiers-help-seen')) {
      try { localStorage.setItem('tiers-help-seen', '1'); } catch {}
      $('help').classList.remove('hidden');
    }
  }

  // Own base on the left (landscape) or at the bottom (portrait)
  homeCamera() {
    const hq = hqOf(this.state, this.me) || { x: this.me === 0 ? 5 : 43, z: 16 };
    const portrait = window.innerHeight > window.innerWidth;
    const dir = this.me === 0 ? 1 : -1;
    const yaw = portrait ? (this.me === 0 ? Math.PI / 2 : -Math.PI / 2) : (this.me === 0 ? 0 : Math.PI);
    this.view.cam = { x: hq.x + dir * (portrait ? 2 : 10), z: hq.z, dist: portrait ? 30 : 34, yaw, pitch: 1.08 };
  }

  // ======================================================================== planning
  beginPlanning() {
    this.phase = 'planning';
    this.planner.reset();
    this.uiMode = null; this.panelTab = 'orders';
    this.selection = this.selection.filter(id => this.entity(id));
    this.nav = new Nav(this.state);
    this.playback = null;
    $('playctl').classList.add('hidden');
    $('btn-ready').classList.remove('hidden', 'waiting');
    $('btn-ready').textContent = 'READY';
    $('btn-build').classList.remove('hidden'); $('btn-multi').classList.remove('hidden');
    $('banner').classList.add('hidden');
    this.computeVisibility();
    this.updateFogFromState();
    this.rebuildGhosts();
    this.changed();
    if (this.mode === 'guest') this.net.send({ t: 'planning', round: this.state.round });
    if (this.mode === 'host') { this.deadline = null; this.maybeStartTimer(); }
    if (this.mode === 'guest') this.deadline = null;
  }

  computeVisibility() {
    const v = visibleEnemies(this.state, this.me);
    this.visibleIds = new Set([...v.units.map(u => u.id), ...v.buildings.map(b => b.id)]);
    this.knownView = v;
    for (const u of v.units) this.lastSeen.set(u.id, { x: u.x, z: u.z, type: u.type, owner: u.owner });
    for (const b of v.buildings) (this.seenBuildings ||= new Set()).add(b.id);
  }

  updateFogFromState() {
    const src = [];
    for (const u of this.state.units) if (u.owner === this.me && u.hp > 0) src.push({ x: u.x, z: u.z, r: CONFIG.units[u.type].vision });
    for (const b of this.state.buildings) if (b.owner === this.me && b.hp > 0) src.push({ x: b.x, z: b.z, r: b.built ? CONFIG.buildings[b.type].vision : 3 });
    this.fogSources = src;
    this.view.updateFog(src);
  }

  isVisible(x, z) {
    if (this.phase === 'menu') return true;
    for (const s of this.fogSources || []) if ((s.x - x) ** 2 + (s.z - z) ** 2 <= s.r * s.r) return true;
    return false;
  }

  rebuildGhosts() {
    this.view.clearGhosts();
    for (const [id, g] of this.lastSeen) {
      if (this.visibleIds.has(id)) continue;
      const alive = this.state.units.some(u => u.id === id);
      if (this.isVisible(g.x, g.z) || (!alive && this.knownDead?.has(id))) { this.lastSeen.delete(id); continue; }
      const m = makeUnitMesh(g.type, g.owner, { ghost: true });
      m.position.set(g.x, 0, g.z);
      this.view.ghosts.add(m);
      const r = ring(0.6, 0.05, GREY, 0.7, 0.04); r.position.set(g.x, 0.04, g.z); this.view.ghosts.add(r);
    }
  }

  entity(id) {
    if (!id) return null;
    if (id[0] === 'n') return this.state.map.nodes.find(n => n.id === id) || null;
    const e = findEntity(this.state, id);
    if (!e) return null;
    if (e.owner !== this.me && !this.visibleIds.has(id) && !(id[0] === 'b' && this.seenBuildings?.has(id))) return null;
    return e;
  }

  armyCount() { return armyCount(this.state, this.me); }

  changed(soft = false) {
    this.dirty = true;
    this.topDirty = true;
    if (!soft) this.panelDirty = true;
    else this.panelSoft = true;
  }
  refreshPanel() { this.panelDirty = true; }

  computeStancePreviews() {
    this.stancePreview.clear();
    const view = this.knownView || { units: [], buildings: [] };
    for (const u of this.state.units) {
      if (u.owner !== this.me || u.hp <= 0 || this.planner.plan(u.id)) continue;
      const st = this.planner.draft.stances[u.id];
      const uu = st ? { ...u, stance: st.stance, anchor: st.anchor || { x: u.x, z: u.z } } : u;
      try { this.stancePreview.set(u.id, buildStancePlan(this.state, uu, view, this.nav)); } catch (e) { console.warn(e); }
    }
  }

  syncPlanningDisplay(all = false) {
    const s = this.state, P = this.planner;
    const units = [], buildings = [];
    for (const u of s.units) {
      if (u.hp <= 0) continue;
      const def = unitDef(u);
      const mine = u.owner === this.me;
      const vis = all || mine || this.visibleIds.has(u.id);
      const plan = mine ? (P.plan(u.id) || this.stancePreview.get(u.id)) : null;
      const tier = Math.max(CONFIG.minTier, def.tier - u.tierDebuff + (mine ? (P.plan(u.id)?.upgrades || 0) : 0));
      units.push({ ...u, tier, visible: vis, defends: mine ? def.defends + (plan?.defends || 0) : 0 });
    }
    for (const b of s.buildings) {
      if (b.hp <= 0) continue;
      const vis = all || b.owner === this.me || this.visibleIds.has(b.id) || this.seenBuildings?.has(b.id);
      buildings.push({ ...b, visible: vis, progress: b.built ? 1 : b.progress / CONFIG.buildings[b.type].rounds });
    }
    this.view.sync({ units, buildings }, s.map.nodes);
  }

  // ---------------------------------------------------------------- overlays
  drawOverlay() {
    const V = this.view, s = this.state, P = this.planner;
    V.clearOverlay();
    if (this.phase !== 'planning' && this.phase !== 'waiting') return;
    this.computeStancePreviews();
    const O = V.overlay;
    const ink = BLACK;
    const selSet = new Set(this.selection);
    // control zones (all visible melee units)
    for (const u of s.units) {
      if (u.hp <= 0) continue;
      const def = unitDef(u);
      if (!def.melee || !def.zone) continue;
      if (u.owner !== this.me && !this.visibleIds.has(u.id)) continue;
      const mine = u.owner === this.me;
      const r = dashedRing(def.zone, selSet.has(u.id) ? 0.07 : 0.045, mine ? ink : 0x3a3a3a, selSet.has(u.id) ? 0.7 : mine ? 0.22 : 0.5, 0.035, Math.round(def.zone * 10));
      r.position.set(u.x, 0, u.z); O.add(r);
    }
    // enemy last-round trails
    for (const [id, pts] of this.trails) {
      if (pts.length < 2) continue;
      O.add(ribbon(pts, 0.07, 0x6a6a6a, 0.7, 0.18, 0.03));
      void id;
    }
    // revive zones
    for (const p of [0, 1]) {
      const rv = s.players[p].revive;
      if (!rv) continue;
      if (p !== this.me && !this.isVisible(rv.x, rv.z)) continue;
      const r = dashedRing(CONFIG.revive.radius, 0.12, p === this.me ? ink : 0x444444, 0.8, 0.05, 20); r.position.set(rv.x, 0, rv.z); O.add(r);
      const d = disc(CONFIG.revive.radius * (rv.progress / CONFIG.revive.rounds), PALETTE.team[p].body, 0.5, 0.04); d.position.set(rv.x, 0.04, rv.z); O.add(d);
    }
    // plans
    for (const u of s.units) {
      if (u.owner !== this.me || u.hp <= 0) continue;
      const direct = P.plan(u.id);
      const plan = direct || this.stancePreview.get(u.id);
      if (!plan) continue;
      const sel = selSet.has(u.id);
      const pr = P.predict(u, plan);
      const w = sel ? 0.13 : 0.08;
      const op = direct ? (sel ? 1 : 0.8) : 0.45;
      const dash = direct ? 0 : 0.22;
      for (const l of pr.legs) {
        if (l.kind === 'move' || l.kind === 'attack' || l.kind === 'shove' || l.kind === 'dash') {
          if (l.pts.length > 1) O.add(ribbon(l.pts, l.kind === 'dash' ? w * 1.6 : w, ink, op, dash, 0.05));
          const end = l.pts[l.pts.length - 1];
          if (l.kind === 'move') { const e = ring(0.28, 0.07, ink, op, 0.05, 24); e.position.set(end.x, 0.05, end.z); O.add(e); }
          if (l.kind === 'attack' || l.kind === 'shove') {
            O.add(ribbon([end, l.target], w * 0.6, ink, op * 0.7, 0.12, 0.05));
            O.add(ribbon([{ x: l.target.x - 0.35, z: l.target.z - 0.35 }, { x: l.target.x + 0.35, z: l.target.z + 0.35 }], 0.1, PALETTE.accent, op, 0, 0.06));
            O.add(ribbon([{ x: l.target.x - 0.35, z: l.target.z + 0.35 }, { x: l.target.x + 0.35, z: l.target.z - 0.35 }], 0.1, PALETTE.accent, op, 0, 0.06));
          }
        } else if (l.kind === 'shoot') {
          O.add(ribbon([l.from, l.to], sel ? 0.06 : 0.04, PALETTE.accent, op * 0.85, direct ? 0 : 0.2, 0.06));
          const a = ring(0.22, 0.05, PALETTE.accent, op, 0.06, 16); a.position.set(l.aim.x, 0.06, l.aim.z); O.add(a);
        } else if (l.kind === 'frag') {
          O.add(ribbon([l.from, l.at], 0.04, PALETTE.accent, op * 0.6, 0.15, 0.06));
          const r = ring(l.r, 0.08, PALETTE.accent, op, 0.06); r.position.set(l.at.x, 0.06, l.at.z); O.add(r);
          const d = disc(l.r, PALETTE.accent, 0.12, 0.05); d.position.set(l.at.x, 0.05, l.at.z); O.add(d);
        } else if (l.kind === 'sweep') {
          const r = ring(l.r, 0.1, PALETTE.accent, op, 0.06); r.position.set(l.at.x, 0.06, l.at.z); O.add(r);
          const d = disc(l.r, PALETTE.accent, 0.12, 0.05); d.position.set(l.at.x, 0.05, l.at.z); O.add(d);
        } else if (l.kind === 'disrupt') {
          O.add(ribbon([l.from, l.to], 0.06, PALETTE.accent, op, 0.15, 0.06));
        }
      }
      if ((plan.buffs || []).includes('rally')) {
        const r = dashedRing(skillDef(u.type, 'rally').radius, 0.09, ink, 0.75, 0.045, 36); r.position.set(u.x, 0, u.z); O.add(r);
      }
      if (plan.overwatch && sel) {
        const r = dashedRing(CONFIG.overwatchRange, 0.05, PALETTE.accent, 0.5, 0.04, 40); r.position.set(pr.x, 0, pr.z); O.add(r);
      }
      // reach circle for the last move of the selected unit
      if (sel && direct && this.selection.length === 1) {
        const last = direct.actions[direct.actions.length - 1];
        if (last && last.kind === 'move') {
          const leg = pr.legs.filter(l => l.kind === 'move').pop();
          const start = leg ? leg.pts[0] : u;
          const rr = ring(last.ap * moveSpeed(u.type), 0.05, ink, 0.6, 0.04, 64); rr.position.set(start.x, 0.04, start.z); O.add(rr);
        }
      }
    }
    // selection rings
    for (const id of this.selection) {
      const e = this.entity(id); if (!e) continue;
      const r0 = id[0] === 'u' ? 0.72 : (id[0] === 'b' ? CONFIG.buildings[e.type].r + 0.4 : 1.3);
      const a = ring(r0, 0.12, ink, 1, 0.06); a.position.set(e.x, 0.06, e.z); O.add(a);
      const b = ring(r0 - 0.11, 0.07, WHITE, 1, 0.061); b.position.set(e.x, 0.061, e.z); O.add(b);
      if (e.type === 'commander' && e.owner === this.me && this.uiMode === 'disrupt') {
        const c = dashedRing(skillDef('commander', 'disrupt').range, 0.06, PALETTE.accent, 0.7, 0.04, 40); c.position.set(e.x, 0, e.z); O.add(c);
      }
      if (e.id[0] === 'u' && e.owner === this.me && this.selection.length === 1) {
        const st = P.draft.stances[e.id];
        const anchor = st ? st.anchor : (e.stance === 'advance' || e.stance === 'holdground') ? e.anchor : null;
        const stn = st ? st.stance : e.stance;
        if (anchor && stn === 'advance') { O.add(ribbon([e, anchor], 0.05, ink, 0.4, 0.3, 0.04)); const f = ring(0.4, 0.08, ink, 0.6, 0.05, 4); f.position.set(anchor.x, 0.05, anchor.z); O.add(f); }
        if (anchor && stn === 'holdground') { const f = dashedRing(CONFIG.stance.holdGroundLeash, 0.06, ink, 0.6, 0.05, 20); f.position.set(anchor.x, 0, anchor.z); O.add(f); }
      }
      if (e.id[0] === 'b' && CONFIG.buildings[e.type].attack) {
        const c = dashedRing(CONFIG.buildings[e.type].attack.range, 0.05, e.owner === this.me ? ink : 0x444444, 0.45, 0.04, 40); c.position.set(e.x, 0, e.z); O.add(c);
      }
    }
    // build mode
    if (this.panelTab === 'build' || (this.uiMode && this.uiMode.startsWith('build:'))) {
      for (const b of s.buildings) {
        if (b.owner !== this.me || !b.built || (b.type !== 'hq' && b.type !== 'outpost')) continue;
        const r = dashedRing(CONFIG.economy.buildRadius, 0.08, ink, 0.6, 0.04, 56); r.position.set(b.x, 0, b.z); O.add(r);
      }
    }
    for (const bo of P.draft.builds) {
      const m = makeBuildingMesh(bo.type, this.me, { ghost: true });
      m.position.set(bo.x, 0, bo.z); O.add(m);
    }
    if (this.hoverBuild && this.uiMode?.startsWith('build:')) {
      const t = this.uiMode.slice(6);
      const m = makeBuildingMesh(t, this.me, { ghost: true });
      m.position.set(this.hoverBuild.x, 0, this.hoverBuild.z); O.add(m);
    }
  }

  // ======================================================================== input
  pickEntity(clientX, clientY) {
    const p = this.view.pick(clientX, clientY);
    if (!p) return { p: null, e: null };
    const tol = Math.max(0.6, 26 / Math.max(1, this.view.pxPerUnit(p.x, p.z)));
    let best = null, bd = 1e9;
    const disp = this.playback ? null : this.state;
    if (!disp) return { p, e: null };
    for (const u of disp.units) {
      if (u.hp <= 0 || (u.owner !== this.me && !this.visibleIds.has(u.id))) continue;
      const d = dist(u.x, u.z, p.x, p.z);
      if (d < tol && d < bd) { bd = d; best = u; }
    }
    if (!best) for (const b of disp.buildings) {
      if (b.hp <= 0 || !this.entity(b.id)) continue;
      const d = dist(b.x, b.z, p.x, p.z);
      if (d < CONFIG.buildings[b.type].r + 0.3 && d < bd) { bd = d; best = b; }
    }
    if (!best) for (const n of this.state.map.nodes) {
      const d = dist(n.x, n.z, p.x, p.z);
      if (d < 1.1 && d < bd) { bd = d; best = n; }
    }
    return { p, e: best };
  }

  onHover(cx, cy) {
    if (this.phase !== 'planning' || !this.uiMode?.startsWith('build:')) { if (this.hoverBuild) { this.hoverBuild = null; this.changed(true); } return; }
    const p = this.view.pick(cx, cy);
    this.hoverBuild = p; this.dirty = true;
  }

  ownSelected() { return this.selection.map(id => this.state.units.find(u => u.id === id)).filter(u => u && u.owner === this.me && u.hp > 0); }

  onTap(cx, cy, long) {
    if (this.phase !== 'planning') return;
    const { p, e } = this.pickEntity(cx, cy);
    if (!p) return;
    const mode = this.uiMode;
    const own = this.ownSelected();
    const P = this.planner;
    const isUnit = e && e.id[0] === 'u';
    const isEnemy = e && e.owner !== undefined && e.owner !== this.me && e.owner !== -1 && e.id[0] !== 'n';

    if (mode && mode.startsWith('build:')) {
      if (P.addBuild(mode.slice(6), p.x, p.z)) { this.uiMode = null; this.hoverBuild = null; this.panelTab = 'build'; this.changed(); }
      return;
    }
    if (mode === 'advance') {
      P.setStance(own.map(u => u.id), 'advance', p); this.uiMode = null; this.changed();
      return;
    }
    if (mode === 'move') {
      if (isUnit && !own.some(u => u.id === e.id)) own.forEach(u => P.orderMove(u.id, 0, 0, e.id));
      else this.groupMove(own, p);
      this.uiMode = null; this.changed();
      return;
    }
    if (mode === 'attack') {
      if (!isEnemy) { toast('Tap an enemy unit or building', true); return; }
      this.groupAttack(own, e);
      this.uiMode = null; this.changed();
      return;
    }
    if (mode === 'shoot' || mode === 'frag' || mode === 'dash') {
      const tgt = isEnemy ? { x: e.x, z: e.z } : p;
      const u = own[0];
      if (u) {
        const ok = P.orderPoint(u.id, mode, tgt.x, tgt.z);
        if (!ok || mode !== 'shoot' || P.apLeft(u) < unitDef(u).shot.ap) this.uiMode = null;
      }
      this.changed();
      return;
    }
    if (mode === 'shove' || mode === 'disrupt') {
      if (!isEnemy || !isUnit) { toast('Tap an enemy unit', true); return; }
      const u = own[0];
      if (u) { if (mode === 'shove') P.orderAttack(u.id, e.id, 'shove'); else P.orderTarget(u.id, 'disrupt', e.id); }
      this.uiMode = null; this.changed();
      return;
    }

    // ---- idle tap ----
    // Tapping a unit shows its stance first; orders are only given once you press Control.
    const controlled = own.filter(u => P.plan(u.id));
    const allControlled = own.length > 0 && controlled.length === own.length && this.panelTab !== 'stance';
    if (e && isUnit && e.owner === this.me) {
      if (this.multi || long) {
        const i = this.selection.indexOf(e.id);
        if (i >= 0) this.selection.splice(i, 1); else this.selection = [...this.selection.filter(id => id[0] === 'u' && this.entity(id)?.owner === this.me), e.id];
      } else this.selection = [e.id];
      this.panelTab = 'orders';
      this.changed();
      return;
    }
    if (isEnemy && allControlled) { this.groupAttack(own, e); this.changed(); return; }
    if (e) { this.selection = [e.id]; this.panelTab = 'orders'; this.changed(); return; }
    if (allControlled && !long) { this.groupMove(own, p); this.changed(); return; }
    this.selection = []; this.panelTab = 'orders'; this.changed();
  }

  groupMove(units, p) {
    if (!units.length) return;
    if (units.length === 1) { this.planner.orderMove(units[0].id, p.x, p.z); return; }
    const cx = units.reduce((a, u) => a + u.x, 0) / units.length, cz = units.reduce((a, u) => a + u.z, 0) / units.length;
    let maxR = 0; for (const u of units) maxR = Math.max(maxR, dist(u.x, u.z, cx, cz));
    const k = maxR > 2.5 ? 2.5 / maxR : 1;
    for (const u of units) this.planner.orderMove(u.id, p.x + (u.x - cx) * k, p.z + (u.z - cz) * k);
  }

  groupAttack(units, e) {
    for (const u of units) {
      const def = unitDef(u);
      if (def.melee) this.planner.orderAttack(u.id, e.id);
      else {
        if (dist(u.x, u.z, e.x, e.z) > def.shot.range + 1) toast(`${def.name}: target is beyond range ${def.shot.range}`, true);
        this.planner.orderPoint(u.id, 'shoot', e.x, e.z);
      }
    }
  }

  selectAndFocus(id) {
    const e = this.entity(id); if (!e) return;
    if (this.phase === 'planning') this.selection = [id];
    this.view.focus(e.x, e.z);
    this.changed();
  }

  panelAction(act, u, b, units) {
    const P = this.planner;
    const own = units && units.length ? units : this.ownSelected();
    const [k, arg] = act.split(':');
    switch (k) {
      case 'deselect': this.selection = []; this.uiMode = null; this.panelTab = 'orders'; break;
      case 'cancelmode': this.uiMode = null; this.hoverBuild = null; break;
      case 'mode': this.uiMode = this.uiMode === arg ? null : arg; break;
      case 'tab': this.panelTab = arg; this.uiMode = null; break;
      case 'control':
        for (const x of own) if (!P.control(x.id)) break;
        this.panelTab = 'orders'; this.uiMode = null;
        break;
      case 'release': for (const x of own) P.clear(x.id); this.panelTab = 'orders'; this.uiMode = null; break;
      case 'skill': {
        if (!u) break;
        const k2 = skillDef(u.type, arg);
        if (k2.prepaid) P.prepaid(u.id, 'buff:' + arg, 1);
        else if (k2.aim === 'self') P.addAction(u.id, { kind: arg });
        else { this.uiMode = this.uiMode === arg ? null : arg; }
        break;
      }
      case 'wait': if (u) P.addAction(u.id, { kind: 'wait', ap: 10 }); break;
      case 'pre': for (const x of own) P.prepaid(x.id, arg, 1); break;
      case 'undo': if (u) P.undo(u.id); break;
      case 'clear': for (const x of own) P.clear(x.id); break;
      case 'heal': if (u) P.toggleHeal(u.id); break;
      case 'stance':
        if (arg === 'advance') { this.uiMode = 'advance'; toast('Tap the point to advance towards'); }
        else P.setStance(own.map(x => x.id), arg);
        break;
      case 'prod': P.addProduction(b.id, arg); break;
      case 'unprod': P.removeProduction(+arg); break;
      case 'boost': P.toggleBoost(b.id); break;
      case 'rally': {
        const order = ['guard', 'hold', 'holdground', 'retreat'];
        const cur = P.draft.rally[b.id] || b.rally;
        P.setRally(b.id, order[(order.indexOf(cur) + 1) % order.length]);
        break;
      }
      case 'openbuild': this.panelTab = 'build'; break;
      case 'closebuild': this.panelTab = 'orders'; break;
      case 'place': this.uiMode = 'build:' + arg; this.panelTab = 'orders'; break;
      case 'unbuild': P.removeBuild(+arg); break;
    }
    this.changed();
  }

  onKey(e) {
    const k = e.key;
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      if (this.phase === 'planning') this.ready();
      else if (this.playback) { if (this.playback.holding) this.nextTier(); }
    }
    if (k === 'Escape') { if (this.uiMode) this.uiMode = null; else this.selection = []; this.changed(); }
    if (k === 'Backspace' && this.selection.length === 1) { e.preventDefault(); this.planner.undo(this.selection[0]); }
  }

  // ======================================================================== round flow
  ready() {
    if (this.phase !== 'planning') return;
    const orders = this.planner.final();
    this.lastOrders = orders;
    this.emit('ready');
    this.uiMode = null;
    if (this.mode === 'ai') {
      let o1;
      try { o1 = aiOrders(this.state, 1); } catch (e) { console.error(e); o1 = emptyOrders(); }
      this.resolveLocal([orders, o1]);
    } else if (this.mode === 'host') {
      this.myOrders = orders;
      this.setWaiting();
      if (this.guestOrders[this.state.round]) this.hostResolve();
    } else if (this.mode === 'guest') {
      this.net.send({ t: 'orders', round: this.state.round, orders });
      this.setWaiting();
    }
  }

  setWaiting() {
    this.phase = 'waiting';
    $('btn-ready').classList.add('waiting');
    $('btn-ready').textContent = 'Waiting for opponent…';
    this.changed();
  }

  hostResolve() {
    const round = this.state.round;
    const o = [this.myOrders, this.guestOrders[round]];
    delete this.guestOrders[round];
    const pre = this.state;
    const { state: post, log } = resolveRound(pre, o);
    this.net.send({ t: 'result', round, orders: o, post });
    this.play(pre, log, post);
  }

  resolveLocal(orders) {
    const pre = this.state;
    let res;
    try { res = resolveRound(pre, orders); } catch (e) { console.error(e); toast('Resolution error: ' + e.message, true); return; }
    this.play(pre, res.log, res.state);
  }

  play(pre, log, post, isReplay = false) {
    this.phase = isReplay ? 'replay' : 'resolution';
    this.playback = new Playback(pre, log, post, { step: this.stepMode });
    this.playback.isReplay = isReplay;
    this.deadline = null;
    this.view.clearOverlay();
    this.view.clearGhosts();
    this.clearIntents();
    $('playctl').classList.remove('hidden');
    $('btn-ready').classList.add('hidden');
    $('btn-build').classList.add('hidden'); $('btn-multi').classList.add('hidden');
    $('summary').classList.add('hidden');
    $('digest').classList.add('hidden');
    this.panelTab = 'orders';
    if (!isReplay) {
      this.digest = null; this.chipList = []; $('chips').innerHTML = '';
      this.newTrails = new Map(); this.knownDead = new Set();
      this.roundMarks = { deaths: [] };
      this.clearMarks();
      this.report = { round: log.round, lines: [], sum: { dealt: 0, taken: 0, killed: 0, lost: 0 } };
    }
    this.names = nameMap(pre, post);
    this.logged = new WeakSet();
    this.segLines = new Map();
    this.hpShown = new Map();
    this.feed.clear();
    this.lastFeedSeg = null;
    this.lastItem = -1; this.lastPhase = null;
    this.syncStepButtons();
    this.changed();
    this.emit('playStart');
  }

  // Turn a resolution event into a readable line (feed + tier card + report)
  logEvent(e, live) {
    if (this.logged.has(e)) return;
    this.logged.add(e);
    const pb = this.playback;
    const visId = id => {
      const u = pb.disp.units.get(id) || pb.disp.buildings.get(id);
      return u ? this.isVisible(u.x, u.z) : false;
    };
    if (!involvesVisible(e, this.names, this.me, visId)) return;
    const d = describe(e, this.names, this.me);
    if (!d) return;
    const seg = e.__seg;
    const label = segLabel(seg);
    if (seg) { if (!this.segLines.has(seg)) this.segLines.set(seg, []); this.segLines.get(seg).push(d); }
    if (live) { this.feed.push(d, label !== this.lastFeedSeg ? label : ''); this.lastFeedSeg = label; }
    if (pb.isReplay || !this.report) return;
    this.report.lines.push({ ...d, label });
    const S = this.report.sum;
    S.dealt += d.dealt || 0; S.taken += d.taken || 0; S.killed += d.killed || 0; S.lost += d.lost || 0;
  }

  openReport() {
    if (!this.report) return;
    $('report-title').textContent = `Round ${this.report.round} report`;
    $('report-body').innerHTML = reportHTML(this.report);
    $('report').classList.remove('hidden');
    this.emit('reportOpened');
  }

  showSummary() {
    const r = this.report; if (!r) return;
    const S = r.sum;
    const el = $('summary');
    el.innerHTML = `<span class="sum-k">Round ${r.round}</span>
      <span>Dealt <b>${S.dealt}</b></span><span>Taken <b>${S.taken}</b></span>
      <span>Killed <b>${S.killed}</b></span><span>Lost <b>${S.lost}</b></span>
      <button class="btn mini" id="sum-open">Report ▸</button><button class="btn mini" id="sum-close">✕</button>`;
    el.classList.remove('hidden');
    $('sum-open').onclick = () => this.openReport();
    $('sum-close').onclick = () => el.classList.add('hidden');
  }

  replay() {
    if (!this.lastRound || this.phase !== 'planning') return;
    const { pre, log, post } = this.lastRound;
    this.play(pre, log, post, true);
  }

  // ---- step controls --------------------------------------------------------
  syncStepButtons() {
    $('btn-auto').classList.toggle('on', !this.stepMode);
    $('btn-auto').textContent = this.stepMode ? 'Auto ▸▸' : 'Auto ✓';
    $('btn-follow').classList.toggle('on', this.followCam);
  }
  nextTier() {
    if (!this.playback) return;
    $('tiercard').classList.add('hidden');
    this.clearIntents();
    this.playback.next();
    this.emit('next');
  }
  replayTier() {
    if (!this.playback) return;
    $('tiercard').classList.add('hidden');
    this.clearIntents();
    this.playback.replaySegment();
    this.lastPhase = null; this.lastItem = -1;
    this.texts.clear();
  }
  setAuto(on) {
    this.stepMode = !on;
    try { localStorage.setItem('tiers-step', this.stepMode ? '1' : '0'); } catch {}
    if (this.playback) { this.playback.step = this.stepMode; if (!this.stepMode && this.playback.holding) this.nextTier(); }
    this.syncStepButtons();
  }

  skipPlayback() {
    if (!this.playback) return;
    const evs = this.playback.skip();
    for (const e of evs) { if (e.type === 'death') { this.knownDead?.add(e.id); this.addDeathMark(e); } this.logEvent(e, false); }
    this.finishPlayback();
  }

  finishPlayback() {
    const pb = this.playback;
    this.playback = null;
    this.texts.clear();
    this.feed.clear();
    this.clearIntents();
    $('banner').classList.add('hidden');
    $('tiercard').classList.add('hidden');
    $('timeline').classList.add('hidden');
    if (pb.isReplay) {
      this.phase = 'planning';
      $('playctl').classList.add('hidden');
      $('btn-ready').classList.remove('hidden'); $('btn-build').classList.remove('hidden'); $('btn-multi').classList.remove('hidden');
      this.updateFogFromState(); this.rebuildGhosts();
      this.changed();
      return;
    }
    this.state = pb.post;
    this.lastRound = { pre: pb.pre, log: pb.log, post: pb.post };
    this.trails = this.newTrails || new Map();
    this.emit('roundEnd', { round: pb.log.round });
    if (this.state.winner !== null && this.state.winner !== undefined) {
      const w = this.state.winner;
      if (w === -1) this.gameOver('Draw', 'Both sides fell.');
      else if (w === this.me) this.gameOver('Victory', `Enemy HQ destroyed in round ${pb.log.round}.`);
      else this.gameOver('Defeat', `Your HQ fell in round ${pb.log.round}.`);
      this.computeVisibility(); this.updateFogFromState(); this.syncPlanningDisplay();
      return;
    }
    const vis = id => this.lastSeen.has(id) || !!this.knownDead?.has(id);
    try { this.digest = buildDigest(pb.pre, pb.log, pb.post, this.me, this.lastOrders, vis); } catch (e) { console.error(e); this.digest = null; }
    this.beginPlanning();
    this.buildChips();
    if (this.digest) this.openDigest(); else this.showSummary();
  }

  // ---- round digest card + map chips -------------------------------------------
  openDigest() {
    const d = this.digest; if (!d) return;
    const el = $('digest');
    el.innerHTML = `<div class="tc-head"><div><div class="tc-k">What happened</div><div class="tc-title">Round ${d.round}</div></div>
      <button class="p-close" data-dg="close" aria-label="Close">✕</button></div>
      <div class="dg-body">${digestHTML(d)}</div>
      <div class="tc-btns two"><button class="btn" data-dg="report">All events</button><button class="btn" data-dg="replay">↺ Watch again</button><button class="btn primary" data-dg="close">Plan next round ▸</button></div>`;
    el.classList.remove('hidden');
    el.querySelectorAll('[data-dg="close"]').forEach(b => b.onclick = () => { el.classList.add('hidden'); this.emit('digestClosed'); });
    el.querySelector('[data-dg="report"]').onclick = () => this.openReport();
    el.querySelector('[data-dg="replay"]').onclick = () => { el.classList.add('hidden'); this.replay(); };
    el.querySelectorAll('.dg-row').forEach(r => r.onclick = () => {
      if (window.innerWidth < 720) el.classList.add('hidden');
      this.selectAndFocus(r.dataset.id);
    });
    this.emit('digestOpened');
  }

  buildChips() {
    const d = this.digest;
    this.chipList = [];
    const layer = $('chips');
    layer.innerHTML = '';
    if (!d) return;
    const add = (id, html, cls, title) => {
      const el = document.createElement('div');
      el.className = 'chip-mark ' + cls; el.innerHTML = html; if (title) el.title = title;
      el.onclick = ev => { ev.stopPropagation(); this.selectAndFocus(id); if (title) toast(title, cls === 'fail'); };
      layer.appendChild(el);
      this.chipList.push({ id, el });
    };
    for (const [id, dmg] of d.hurt) {
      const r = d.byId.get(id);
      if (r && r.died) continue;
      add(id, '−' + dmg, 'dmg', null);
    }
    for (const r of d.units) if (r.fails.length && !r.died) add(r.id, '⊘', 'fail', r.fails[0]);
  }

  updateChips() {
    if (!this.chipList || !this.chipList.length) return;
    const show = this.phase === 'planning' || this.phase === 'waiting';
    const off = {};
    for (const c of this.chipList) {
      const u = this.state.units.find(x => x.id === c.id);
      const visible = show && u && (u.owner === this.me || this.visibleIds.has(u.id));
      c.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const p = this.view.project(u.x, 0.2, u.z);
      const k = off[c.id] = (off[c.id] || 0) + 1;
      c.el.style.transform = `translate(${p.x + 18 + (k - 1) * 30}px, ${p.y - 6}px)`;
    }
  }

  // ---- intent arrows + round markers ----------------------------------------
  clearIntents() { this.intentMap = new Map(); for (const c of [...this.view.intents.children]) { this.view.intents.remove(c); disposeDeep(c); } }
  clearMarks() { for (const c of [...this.view.marks.children]) { this.view.marks.remove(c); disposeDeep(c); } }
  addDeathMark(e) {
    const u = this.playback?.disp.units.get(e.id) || this.state.units.find(x => x.id === e.id);
    if (!u) return;
    if (u.owner !== this.me && !this.isVisible(u.x, u.z)) return;
    if (this.roundMarks?.deaths.some(d => d.id === e.id)) return;
    this.roundMarks?.deaths.push({ id: e.id, x: u.x, z: u.z, owner: u.owner, type: u.type });
    const g = new THREE.Group();
    const col = PALETTE.accent;
    g.add(ribbon([{ x: u.x - 0.45, z: u.z - 0.45 }, { x: u.x + 0.45, z: u.z + 0.45 }], 0.14, col, 0.95, 0, 0.07));
    g.add(ribbon([{ x: u.x - 0.45, z: u.z + 0.45 }, { x: u.x + 0.45, z: u.z - 0.45 }], 0.14, col, 0.95, 0, 0.07));
    const r = ring(0.7, 0.06, u.owner === 0 ? WHITE : BLACK, 0.9, 0.065, 24); r.position.set(u.x, 0.065, u.z); g.add(r);
    this.view.marks.add(g);
  }
  onIntentEvent(e, disp) {
    const M = this.intentMap;
    switch (e.type) {
      case 'act':
        if (['attack', 'shove', 'disrupt'].includes(e.kind) && e.target) M.set(e.id, { kind: e.kind, target: e.target });
        else if (['shoot', 'frag', 'dash'].includes(e.kind) && e.x !== undefined) M.set(e.id, { kind: e.kind, x: e.x, z: e.z });
        else M.delete(e.id);
        break;
      case 'strike': case 'miss': case 'cancel': case 'shot': case 'frag': case 'disrupt': case 'dashstop': case 'sweep':
        if (e.type !== 'shot' || !e.ow) M.delete(e.id);
        break;
      case 'retarget': { const m = M.get(e.id); if (m) m.target = e.target; break; }
      case 'death': M.delete(e.id); for (const [k, m] of M) if (m.target === e.id) M.delete(k); break;
    }
    void disp;
  }
  drawIntents() {
    const G = this.view.intents;
    for (const c of [...G.children]) { G.remove(c); disposeDeep(c); }
    const pb = this.playback; if (!pb) return;
    for (const [id, m] of this.intentMap) {
      const u = pb.disp.units.get(id);
      if (!u || u.hp <= 0 || (u.owner !== this.me && !this.isVisible(u.x, u.z))) continue;
      let to;
      if (m.target) { const t = pb.disp.units.get(m.target) || pb.disp.buildings.get(m.target); if (!t) continue; to = { x: t.x, z: t.z }; }
      else to = { x: m.x, z: m.z };
      const ink = u.owner === 0 ? WHITE : BLACK;
      const melee = m.kind === 'attack' || m.kind === 'shove';
      G.add(arrow(u, to, melee ? 0.16 : 0.09, m.kind === 'disrupt' || m.kind === 'shoot' || m.kind === 'frag' ? PALETTE.accent : ink, melee ? 0 : 0.25));
    }
  }

  gameOver(title, msg) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    $('go-title').textContent = title;
    $('go-msg').textContent = msg;
    $('gameover').classList.remove('hidden');
    $('playctl').classList.add('hidden');
    this.net?.close();
  }

  // ======================================================================== frame loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.1, (performance.now() - (this.lastT || performance.now())) / 1000);
    this.lastT = performance.now();
    this.frame++;
    this.input.tick(dt);
    if (this.phase === 'menu') this.view.cam.yaw += dt * 0.05;

    if (this.playback) this.tickPlayback(dt);
    else if (this.phase !== 'menu') {
      if (this.dirty) { this.dirty = false; this.drawOverlay(); }
      this.syncPlanningDisplay();
    }
    if (this.panelDirty) { this.panelDirty = false; renderPanel(this); renderStrip(this); }
    if (this.phase !== 'menu' && (this.frame % 10 === 0 || this.topDirty)) { this.topDirty = false; renderTopbar(this); }
    this.tickTimer();
    this.updateChips();
    this.texts.update(dt);
    this.view.render();
  }

  tickTimer() {
    const el = $('tb-timer');
    if (this.mode === 'ai' || !this.deadline || (this.phase !== 'planning' && this.phase !== 'waiting')) { if (el) el.textContent = '—'; return; }
    const left = Math.max(0, (this.deadline - performance.now()) / 1000);
    el.textContent = Math.ceil(left);
    el.classList.toggle('warn', left < 15);
    if (left <= 0 && this.mode === 'host' && this.timeupSent !== this.state.round) {
      this.timeupSent = this.state.round;
      if (this.phase === 'planning') { toast('Time is up', true); this.ready(); }
      this.net.send({ t: 'timeup', round: this.state.round });
      const r = this.state.round;
      setTimeout(() => {
        if (this.phase === 'waiting' && this.state.round === r && !this.guestOrders[r]) {
          this.guestOrders[r] = emptyOrders();
          this.hostResolve();
        }
      }, 10000);
    }
    if (left <= 0 && this.mode === 'guest' && this.phase === 'planning') { toast('Time is up — orders sent', true); this.ready(); }
  }

  tickPlayback(dt) {
    const pb = this.playback;
    if (this.paused) { this.syncPlaybackDisplay(dt); return; }
    const evs = pb.advance(dt * this.speed);
    const ctx = { disp: pb.disp, vis: (x, z) => this.isVisible(x, z), me: this.me, nodes: pb.disp.nodes };
    for (const e of evs) {
      if (e.type === 'death') { this.knownDead?.add(e.id); this.lastSeen.delete(e.id); if (!pb.isReplay) this.addDeathMark(e); }
      eventFx(this.view, this.texts, e, ctx);
      this.onIntentEvent(e, pb.disp);
      this.logEvent(e, true);
    }
    if (pb.done) { this.finishPlayback(); return; }
    const seg = pb.curSeg, phase = pb.phase;
    // entering a new tier: frame the camera on the units acting in it
    if (pb.cursor !== this.lastItem) {
      this.lastItem = pb.cursor;
      this.clearIntents();
      if (this.followCam && seg) this.view.frame(this.segPoints(seg, pb), 0.8);
      this.emit('tierStart', { seg });
    }
    const banner = $('banner');
    if (phase === 'banner') {
      banner.classList.remove('hidden', 'active');
      banner.innerHTML = `<div class="b-title">${pb.bannerText(seg)}</div><div class="b-sub">${this.tierWho(seg, pb)}</div>`;
    } else banner.classList.add('hidden');
    // timeline during the tier
    if (seg && seg.kind === 'tier' && phase !== 'banner') this.renderTimeline(seg, pb);
    else $('timeline').classList.add('hidden');
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      $('playctl').classList.toggle('hidden', phase === 'hold');
      $('feed').style.visibility = phase === 'hold' ? 'hidden' : '';
      if (phase === 'hold') this.showTierCard(seg, pb);
      else $('tiercard').classList.add('hidden');
    }
    // fog + visibility from current display
    if (this.frame % 4 === 0) {
      const src = [];
      for (const [, u] of pb.disp.units) if (u.owner === this.me && u.hp > 0) src.push({ x: u.x, z: u.z, r: CONFIG.units[u.type].vision });
      for (const [, b] of pb.disp.buildings) if (b.owner === this.me && b.hp > 0) src.push({ x: b.x, z: b.z, r: b.built ? CONFIG.buildings[b.type].vision : 3 });
      this.fogSources = src;
      this.view.updateFog(src);
    }
    this.drawIntents();
    this.syncPlaybackDisplay(dt);
  }

  segPoints(seg, pb) {
    const pts = [];
    const ids = seg.kind === 'tier' ? seg.units : [];
    for (const id of ids) {
      const u = pb.disp.units.get(id);
      if (!u || (u.owner !== this.me && !this.isVisible(u.x, u.z))) continue;
      pts.push({ x: u.x, z: u.z });
      const tr = seg.tracks[id]; if (tr && tr.length) { const l = tr[tr.length - 1]; pts.push({ x: l[1], z: l[2] }); }
    }
    for (const e of seg.events) {
      if ((e.type === 'hit' || e.type === 'spawn' || e.type === 'build') && pts.length < 40) {
        const t = pb.disp.units.get(e.dst || e.id) || pb.disp.buildings.get(e.dst || e.id);
        if (t && (t.owner === this.me || this.isVisible(t.x, t.z))) pts.push({ x: t.x, z: t.z });
        else if (e.x !== undefined && e.owner === this.me) pts.push({ x: e.x, z: e.z });
      }
    }
    return pts;
  }

  tierWho(seg, pb) {
    if (!seg || seg.kind !== 'tier') return seg && seg.kind === 'buildings' ? 'Turrets fire, then income, construction and training' : '';
    const mine = [], theirs = []; let hidden = 0;
    for (const id of seg.units) {
      const u = pb.disp.units.get(id); if (!u) continue;
      const nm = CONFIG.units[u.type].name;
      if (u.owner === this.me) mine.push(nm); else if (this.isVisible(u.x, u.z)) theirs.push(nm); else hidden++;
    }
    const parts = [];
    if (mine.length) parts.push('Yours: ' + mine.join(', '));
    if (theirs.length) parts.push('Enemy: ' + theirs.join(', '));
    if (hidden) parts.push(`${hidden} unseen`);
    return (parts.join(' · ') || 'No visible units') + ' — all act at the same time';
  }

  renderTimeline(seg, pb) {
    const el = $('timeline');
    el.classList.remove('hidden');
    const key = seg;
    if (this.tlSeg !== key) {
      this.tlSeg = key;
      const rows = [];
      for (const id of seg.units) {
        const u = pb.disp.units.get(id) || this.names.get(id);
        if (!u) continue;
        const nm = this.names.get(id) || u;
        const mine = nm.owner === this.me;
        if (!mine && !(u.x !== undefined && this.isVisible(u.x, u.z))) continue;
        const acts = seg.events.filter(e => e.type === 'act' && e.id === id && e.kind !== 'wait');
        rows.push({ id, mine, type: nm.type, owner: nm.owner, acts });
      }
      rows.sort((a, b) => (b.mine - a.mine));
      const max = window.innerWidth < 720 ? 3 : 6;
      const shown = rows.slice(0, max);
      const len = Math.max(1, seg.len);
      const LBL = { move: 'MOVE', attack: 'ATTACK', shoot: 'SHOOT', shove: 'SHOVE', dash: 'DASH', frag: 'FRAG', disrupt: 'DISRUPT', sweep: 'SWEEP' };
      let html = `<div class="tl-head"><b>${pb.bannerText(seg)}</b><span>Time inside the tier → (AP = time)</span></div>`;
      for (const r of shown) {
        html += `<div class="tl-row${r.mine ? ' mine' : ''}"><span class="tl-name">${glyph(r.type, r.owner, 12)} ${r.mine ? 'Your' : 'Enemy'} ${CONFIG.units[r.type].name}</span><span class="tl-track">`;
        for (const a of r.acts) {
          const w = Math.max(1.5, (Math.min(a.cost || 0, len - a.t) / len) * 100);
          html += `<i class="tl-blk ${a.kind}" style="left:${(a.t / len) * 100}%;width:${w}%">${LBL[a.kind] || ''}</i>`;
        }
        if (!r.acts.length) html += `<i class="tl-none">holds / defends</i>`;
        html += '</span></div>';
      }
      if (rows.length > shown.length) html += `<div class="tl-more">+${rows.length - shown.length} more</div>`;
      html += '<div class="tl-play"></div>';
      el.innerHTML = html;
      this.tlPlay = el.querySelector('.tl-play');
    }
    const track = el.querySelector('.tl-track');
    if (track && this.tlPlay) {
      const k = pb.phase === 'hold' ? 1 : pb.tAP / Math.max(1, seg.len);
      const tr = track.getBoundingClientRect(), er = el.getBoundingClientRect();
      this.tlPlay.style.left = (tr.left - er.left + tr.width * k) + 'px';
    }
  }

  showTierCard(seg, pb) {
    const lines = this.segLines.get(seg) || [];
    const idx = pb.items.filter((it, i) => !it.silent && i <= pb.cursor).length;
    const total = pb.items.filter(it => !it.silent).length;
    const last = idx >= total;
    const el = $('tiercard');
    el.innerHTML = `<div class="tc-head"><div><div class="tc-k">Step ${idx} of ${total}</div><div class="tc-title">${pb.bannerText(seg)} — done</div></div>
        <button class="btn mini" data-tc="report">Full report</button></div>
      <div class="tc-who">${this.tierWho(seg, pb)}</div>
      <div class="tc-lines">${lines.length ? lines.map(d => `<div class="feed-line ${d.kind}${d.mine ? ' mine' : ''}">${d.html}</div>`).join('') : '<div class="note">Nothing hit anything. Units moved or held position.</div>'}</div>
      <div class="tc-btns"><button class="btn" data-tc="replay">◂ Replay step</button>
        <button class="btn primary" data-tc="next">${last ? 'Finish round ▸' : 'Next step ▸'}</button>
        <button class="btn" data-tc="auto">Auto ▸▸</button></div>`;
    el.classList.remove('hidden');
    el.querySelector('[data-tc="next"]').onclick = () => this.nextTier();
    el.querySelector('[data-tc="replay"]').onclick = () => this.replayTier();
    el.querySelector('[data-tc="auto"]').onclick = () => this.setAuto(true);
    el.querySelector('[data-tc="report"]').onclick = () => { this.openReport(); };
    this.emit('tierShown', { seg, last });
  }

  isVisibleUnit(u) { return !!u && this.isVisible(u.x, u.z); }

  syncPlaybackDisplay(dt = 0) {
    const pb = this.playback;
    const units = [], buildings = [];
    const seg = pb.curSeg;
    const acting = seg && seg.kind === 'tier' && pb.phase !== 'banner' ? new Set(seg.units) : null;
    for (const [id, u] of pb.disp.units) {
      const mine = u.owner === this.me;
      const vis = mine || this.isVisible(u.x, u.z);
      const isAct = !!acting && acting.has(id) && u.hp > 0;
      // HP bars drain smoothly
      let shown = this.hpShown.get(id);
      if (shown === undefined) shown = u.hp;
      shown += (u.hp - shown) * Math.min(1, dt * 4);
      if (Math.abs(shown - u.hp) < 0.3) shown = u.hp;
      this.hpShown.set(id, shown);
      units.push({ ...u, hp: shown, visible: vis, defends: 0, acting: isAct, dim: !!acting && !isAct });
      if (!mine && vis && !pb.isReplay && u.hp > 0) {
        this.lastSeen.set(id, { x: u.x, z: u.z, type: u.type, owner: u.owner });
        const tr = this.newTrails.get(id) || [];
        const last = tr[tr.length - 1];
        if (!last || dist(last.x, last.z, u.x, u.z) > 0.3) { tr.push({ x: u.x, z: u.z }); this.newTrails.set(id, tr); }
      }
    }
    for (const [, b] of pb.disp.buildings) {
      const vis = b.owner === this.me || this.isVisible(b.x, b.z) || this.seenBuildings?.has(b.id);
      buildings.push({ ...b, visible: vis });
    }
    this.view.sync({ units, buildings }, pb.disp.nodes);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.game = new Game(); }
  catch (e) {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', `<div class="overlay"><div class="card"><h2>Could not start</h2><p>${String(e.message || e)}</p><p class="fine">This game needs WebGL. Try another browser.</p></div></div>`);
  }
});
