// Game controller: menu, modes (AI / host / guest), planning UI, resolution playback.
import { CONFIG } from './config.js';
import { createGame, visibleEnemies, findEntity, unitDef, moveSpeed, emptyOrders, armyCount, hqOf, commanderOf } from './sim/state.js';
import { dist } from './sim/geom.js';
import { Nav } from './sim/nav.js';
import { resolveRound } from './sim/resolve.js';
import { buildStancePlan } from './sim/stances.js';
import { aiOrders } from './ai/ai.js';
import { View3D } from './render/scene.js';
import { Playback, displayFromState } from './render/playback.js';
import { FloatTexts, eventFx } from './render/fx.js';
import { ribbon, ring, dashedRing, disc, makeUnitMesh, makeBuildingMesh, PALETTE } from './render/models.js';
import { Input } from './ui/input.js';
import { Planner } from './ui/planner.js';
import { renderTopbar, renderStrip, renderPanel, toast } from './ui/hud.js';
import { helpHTML } from './ui/help.js';
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
  }

  openPause() {
    if (this.phase === 'menu') return;
    if (this.mode === 'ai') { this.paused = true; $('pause-title').textContent = 'Paused'; }
    else $('pause-title').textContent = 'Menu (online games keep running)';
    $('pausemenu').classList.remove('hidden');
  }

  toast(m, w) { toast(m, w); }

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
        } else if (l.kind === 'disrupt') {
          O.add(ribbon([l.from, l.to], 0.06, PALETTE.accent, op, 0.15, 0.06));
        }
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
      if (e.type === 'commander' && e.owner === this.me) {
        const c = dashedRing(CONFIG.cp.commanderRange, 0.06, ink, 0.5, 0.04, 44); c.position.set(e.x, 0, e.z); O.add(c);
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
      P.setStance(own.map(u => u.id), 'advance', p); this.uiMode = null; this.panelTab = 'orders'; this.changed();
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
    if (e && isUnit && e.owner === this.me) {
      if (this.multi || long) {
        const i = this.selection.indexOf(e.id);
        if (i >= 0) this.selection.splice(i, 1); else this.selection = [...this.selection.filter(id => id[0] === 'u'), e.id];
      } else this.selection = [e.id];
      this.panelTab = this.panelTab === 'build' ? 'orders' : this.panelTab;
      if (this.panelTab === 'stance' && this.selection.length !== 1) this.panelTab = 'orders';
      this.changed();
      return;
    }
    if (isEnemy && own.length) {
      this.groupAttack(own, e);
      this.changed();
      return;
    }
    if (e) { this.selection = [e.id]; this.panelTab = 'orders'; this.changed(); return; }
    if (own.length && !long) { this.groupMove(own, p); this.changed(); return; }
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

  panelAction(act, u, b) {
    const P = this.planner;
    const own = this.ownSelected();
    const [k, arg] = act.split(':');
    switch (k) {
      case 'deselect': this.selection = []; this.uiMode = null; this.panelTab = 'orders'; break;
      case 'cancelmode': this.uiMode = null; this.hoverBuild = null; break;
      case 'mode': this.uiMode = this.uiMode === arg ? null : arg; break;
      case 'tab': this.panelTab = arg; this.uiMode = null; break;
      case 'wait': if (u) P.addAction(u.id, { kind: 'wait', ap: 10 }); break;
      case 'pre': for (const x of own) P.prepaid(x.id, arg, 1); break;
      case 'undo': if (u) P.undo(u.id); break;
      case 'clear': for (const x of own) P.clear(x.id); break;
      case 'heal': if (u) P.toggleHeal(u.id); break;
      case 'stance':
        if (arg === 'advance') { this.uiMode = 'advance'; toast('Tap a point to advance towards'); }
        else { P.setStance(own.map(x => x.id), arg); this.panelTab = 'orders'; }
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
    if (k === ' ' || k === 'Enter') { e.preventDefault(); if (this.phase === 'planning') this.ready(); else if (this.playback) this.skipPlayback(); }
    if (k === 'Escape') { if (this.uiMode) this.uiMode = null; else this.selection = []; this.changed(); }
    if (k === 'Backspace' && this.selection.length === 1) { e.preventDefault(); this.planner.undo(this.selection[0]); }
  }

  // ======================================================================== round flow
  ready() {
    if (this.phase !== 'planning') return;
    const orders = this.planner.final();
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
    this.playback = new Playback(pre, log, post);
    this.playback.isReplay = isReplay;
    this.deadline = null;
    this.view.clearOverlay();
    this.view.clearGhosts();
    $('playctl').classList.remove('hidden');
    $('btn-ready').classList.add('hidden');
    $('btn-build').classList.add('hidden'); $('btn-multi').classList.add('hidden');
    this.panelTab = 'orders';
    if (!isReplay) { this.newTrails = new Map(); this.knownDead = new Set(); }
    this.changed();
  }

  replay() {
    if (!this.lastRound || this.phase !== 'planning') return;
    this.savedDraft = JSON.parse(JSON.stringify(this.planner.draft));
    const { pre, log, post } = this.lastRound;
    this.play(pre, log, post, true);
  }

  skipPlayback() {
    if (!this.playback) return;
    const evs = this.playback.skip();
    for (const e of evs) if (e.type === 'death') this.knownDead?.add(e.id);
    this.finishPlayback();
  }

  finishPlayback() {
    const pb = this.playback;
    this.playback = null;
    this.texts.clear();
    $('banner').classList.add('hidden');
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
    if (this.state.winner !== null && this.state.winner !== undefined) {
      const w = this.state.winner;
      if (w === -1) this.gameOver('Draw', 'Both sides fell.');
      else if (w === this.me) this.gameOver('Victory', `Enemy HQ destroyed in round ${pb.log.round}.`);
      else this.gameOver('Defeat', `Your HQ fell in round ${pb.log.round}.`);
      this.computeVisibility(); this.updateFogFromState(); this.syncPlanningDisplay();
      return;
    }
    this.beginPlanning();
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
    if (this.paused) { this.syncPlaybackDisplay(); return; }
    const res = pb.advance(dt * this.speed);
    const banner = $('banner');
    if (res.banner) {
      banner.classList.remove('hidden');
      const seg = res.banner.seg;
      const n = seg.units ? seg.units.filter(id => id && (pb.disp.units.get(id)?.owner === this.me || this.isVisibleUnit(pb.disp.units.get(id)))).length : 0;
      banner.textContent = pb.bannerText(seg) + (seg.kind === 'tier' ? ` · ${n} unit${n === 1 ? '' : 's'}` : '');
      banner.style.opacity = res.banner.active ? '0.25' : '1';
    }
    const ctx = { disp: pb.disp, vis: (x, z) => this.isVisible(x, z), me: this.me, nodes: pb.disp.nodes };
    for (const e of res.events) {
      if (e.type === 'death') { this.knownDead?.add(e.id); this.lastSeen.delete(e.id); }
      eventFx(this.view, this.texts, e, ctx);
    }
    // fog + visibility from current display
    if (this.frame % 4 === 0) {
      const src = [];
      for (const [, u] of pb.disp.units) if (u.owner === this.me && u.hp > 0) src.push({ x: u.x, z: u.z, r: CONFIG.units[u.type].vision });
      for (const [, b] of pb.disp.buildings) if (b.owner === this.me && b.hp > 0) src.push({ x: b.x, z: b.z, r: b.built ? CONFIG.buildings[b.type].vision : 3 });
      this.fogSources = src;
      this.view.updateFog(src);
    }
    this.syncPlaybackDisplay();
    if (pb.done) this.finishPlayback();
  }

  isVisibleUnit(u) { return !!u && this.isVisible(u.x, u.z); }

  syncPlaybackDisplay() {
    const pb = this.playback;
    const units = [], buildings = [];
    for (const [id, u] of pb.disp.units) {
      const mine = u.owner === this.me;
      const vis = mine || this.isVisible(u.x, u.z);
      units.push({ ...u, visible: vis, defends: 0 });
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
