// Base UI: building and resource-site views, builders' Build menu (ghost + Confirm),
// training docks, building nameplates and the economy readout. Mixed into Game.
import * as THREE from 'three';
import { RULES, FACTIONS, BUILDINGS, trainCost } from '../data/units.js';
import { footprint, hitRadius, armySize, nearestFreeSite, siteTaken, bdef, incomeOf, gatherRate } from '../sim/base.js';
import { buildingsSeenBy } from '../sim/vision.js';
import { defOf } from '../sim/state.js';
import { BuildingView, ShrineView } from '../render/buildings.js';
import { ribbon, ring, chevrons } from '../render/fx.js';
import { icon } from './iconset.js';
import { sfx } from '../audio/sfx.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
import { TEAM } from './teams.js';
const FX = (type, fac) => {
  const eco = FACTIONS[fac].eco, d = BUILDINGS[type];
  return {
    hq: `Your base: lose it and you lose the battle. Earns ${eco.hq} ${eco.name.toLowerCase()} a round, trains builders, and shoots nearby enemies.` + (eco.res === 'souls' ? ` Collects souls from deaths within ${RULES.soulRange}″.` : ''),
    barracks: 'Trains a new squad each round.',
    tower: `Sees ${d.vision}″ and shoots the nearest enemy within ${d.fire?.range}″ after every round.`,
    banner: '+1 command point while it stands (max +2).' + (eco.res === 'souls' ? ` Collects souls from deaths within ${RULES.soulRange}″.` : ''),
    wall: 'Blocks movement and volleys.',
    farm: `+${d.income} gold every round.`,
    mine: `Built on a resource site: +${d.income} gold every round.`,
    well: `Built on a resource site: +${d.income} souls every round, and collects souls from deaths within ${RULES.soulRange}″.`,
  }[type];
};
const SHORT = { barracks: 'Trains squads', tower: 'Sees far · shoots', banner: '+1 command point', wall: 'Blocks paths and shots', farm: `+${BUILDINGS.farm.income} gold a round`, mine: `On a site · +${BUILDINGS.mine.income} gold`, well: `On a site · +${BUILDINGS.well.income} souls` };

export const BaseUI = {
  // ---------------------------------------------------------------- views
  faction(owner) { return this.state.players[owner].faction; },
  paint(owner) { return this.state.players[owner].paint || this.state.players[owner].faction; },
  eco(p = this.me) { return FACTIONS[this.faction(p)].eco; },
  ecoName(p = this.me) { return this.eco(p).name.toLowerCase(); },
  bname(b) { return BUILDINGS[b.type].name[this.faction(b.owner)]; },

  makeShrines() {
    for (const v of this.shrineViews || []) this.view.layers.units.remove(v.group);
    this.shrineViews = (this.state.shrines || []).map(sh => new ShrineView(sh, this.view.layers.units, RULES.shrineRadius));
  },
  // list: [{ x, z, owner }]; a site with a building on it hides its stones
  syncShrines(list) {
    const t = this.view.time || 0;
    (this.shrineViews || []).forEach((v, i) => {
      const sh = list[i]; if (!sh) return;
      const occ = (this.blist || []).some(b => !b.place && BUILDINGS[b.type].site && Math.hypot(b.x - sh.x, b.z - sh.z) < 0.6);
      v.update(sh.owner, t, occ);
    });
  },

  // list: [{ id, type, owner, x, z, w, d, r, rot, hp, build, ghost, stale, dying, vkey }]
  syncBuildings(list) {
    this.bviews = this.bviews || new Map();
    this.blist = list;
    const keep = new Set();
    for (const b of list) {
      const key = b.vkey || b.id;
      keep.add(key);
      let v = this.bviews.get(key);
      if (v && v.sig !== b.type + b.rot + b.owner) { v.destroy(); v = null; this.bviews.delete(key); }
      if (!v) { v = new BuildingView(b, this.paint(b.owner), this.view.layers.units); v.sig = b.type + b.rot + b.owner; this.bviews.set(key, v); }
      v.group.position.set(b.x, 0, b.z);
      v.update({ build: b.build, ghost: b.ghost || b.stale, visible: !(b.dying > 1), dying: b.dying, work: b.build ? 1 - b.build / (bdef(b).work || 1) : 1 });
      v.ring.visible = !b.ghost;
    }
    for (const [k, v] of this.bviews) if (!keep.has(k)) { v.destroy(); this.bviews.delete(k); }
  },

  // enemy buildings my side knows about (remembered in the sim's intel) and sees right now
  updateBuildingFog() {
    const known = this.state.intel?.[this.me]?.known || {};
    this.knownB = new Map(Object.entries(known));
    this.visB = buildingsSeenBy(this.state, this.me);
  },

  planningBuildings() {
    const out = [];
    for (const b of this.state.buildings) {
      if (b.owner === this.me || this.phase === 'menu') out.push({ ...b, selected: b.id === this.selB });
      else if (this.visB?.has(b.id)) out.push({ ...b, selected: b.id === this.selB });
      else if (this.knownB?.has(b.id)) out.push({ ...this.knownB.get(b.id), stale: true, selected: b.id === this.selB });
    }
    // remembered buildings destroyed out of sight still show where they were last seen
    for (const [id, k] of this.knownB || []) if (!this.state.buildings.some(b => b.id === id)) out.push({ ...k, stale: true });
    if (this.phase === 'planning') {
      this.planner.draft.builds.forEach((d, i) => out.push({ id: 'draft' + i, vkey: 'draft' + i + d.type, draft: i, by: d.by, type: d.type, owner: this.me, rot: d.rot, ...footprint(d.type, d.x, d.z, d.rot), hp: BUILDINGS[d.type].hp, build: 0, ghost: true }));
      const pm = this.buildMode;
      if (pm) out.push({ id: 'place', vkey: 'place', type: pm.type, owner: this.me, rot: pm.rot, ...footprint(pm.type, pm.x, pm.z, pm.rot), hp: 1, build: 0, ghost: true, place: true });
    }
    return out;
  },
  playbackBuildings(T) {
    return this.tl.buildingsAt(T).filter(b => b.owner === this.me || this.knownB?.has(b.id) || this.tl.pointSeen(b.x, b.z, T, hitRadius(b)));
  },

  // the footprint under the building being placed: green when it can go there, red when not
  updatePlaceMark() {
    const pm = this.phase === 'planning' ? this.buildMode : null;
    if (!pm) { if (this.placeMark) this.placeMark.visible = false; this.updatePlacer(); return; }
    if (!this.placeMark || this.placeMark.userData.type !== pm.type + pm.rot) {
      if (this.placeMark) { this.view.layers.fx.remove(this.placeMark); this.placeMark.geometry.dispose(); this.placeMark.material.dispose(); }
      const f = footprint(pm.type, 0, 0, pm.rot);
      const g = f.r !== undefined ? new THREE.CircleGeometry(f.r + 0.15, 32) : new THREE.PlaneGeometry(f.w + 0.3, f.d + 0.3);
      g.rotateX(-Math.PI / 2);
      this.placeMark = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }));
      this.placeMark.userData.type = pm.type + pm.rot;
      this.view.layers.fx.add(this.placeMark);
    }
    this.placeMark.visible = true;
    this.placeMark.position.set(pm.x, 0.13, pm.z);
    this.placeMark.material.color.setHex(pm.err ? 0xff3b30 : 0x34c759);
    this.updatePlacer();
  },
  // ✓ Confirm / ⟳ / ✕ buttons floating under the ghost
  updatePlacer() {
    let el = $('placer');
    const pm = this.phase === 'planning' ? this.buildMode : null;
    if (!pm) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'placer'; $('labels').appendChild(el);
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('click', e => {
        const a = e.target.closest('[data-pl]')?.dataset.pl;
        if (a === 'ok') this.confirmPlace(); else if (a === 'rot') this.rotatePlace(); else if (a === 'x') { this.buildMode = null; this.view.clear('ghost'); this.changed(); }
      });
    }
    const key = pm.type + pm.rot + (pm.err ? 'e' : '');
    if (el._k !== key) {
      el._k = key;
      el.innerHTML = `${BUILDINGS[pm.type].shape === 'circle' ? '' : '<button data-pl="rot" title="Rotate (R)">⟳</button>'}<button data-pl="ok" class="ok" ${pm.err ? 'disabled' : ''} title="Confirm (Enter)">✓ Confirm</button><button data-pl="x" title="Cancel (Esc)">✕</button>`;
    }
    const f = footprint(pm.type, pm.x, pm.z, pm.rot), r = f.r !== undefined ? f.r : f.d / 2;
    const p = this.view.project(pm.x, 0, pm.z + r + 0.5);
    const q = this.view.project(pm.x, 0, pm.z - r - 0.5);
    const lo = p.y > q.y ? p : q;     // whichever side is lower on screen
    el.style.display = lo.behind ? 'none' : '';
    el.style.transform = `translate(${lo.x}px, ${lo.y + 14}px) translate(-50%, 0)`;
  },

  // ---------------------------------------------------------------- build mode (needs a builder)
  myBuilders() { return this.state.squads.filter(q => q.owner === this.me && q.role === 'builder' && q.hp > 0); },
  builderSq() { return this.buildBy ? this.state.squads.find(q => q.id === this.buildBy) : null; },
  // the Build button: select a builder (its dock holds the building cards)
  openBuild() {
    const sel = this.selectedSquad?.();
    const bs = this.myBuilders();
    const q = sel && sel.role === 'builder' && sel.owner === this.me ? sel : bs.find(x => !this.planner.plan(x.id)) || bs[0];
    if (!q) {
      this.toast(`You have no builders. Train one at your ${BUILDINGS.hq.name[this.faction(this.me)]}.`, true);
      const hq = this.state.buildings.find(b => b.owner === this.me && b.type === 'hq');
      if (hq) this.selectBuilding(hq.id);
      return;
    }
    if (this.selected !== q.id) this.select(q.id, true);
    this.buildBy = q.id;
    this.flashCards = true;
    this.changed();
  },
  gatherNames() { return this.eco().res === 'gold' ? 'farm or mine' : 'soul well or your crypt'; },
  // first spot for a new building: next to the builder, toward home (sites: the nearest free one)
  defaultSpot(type, rot) {
    const q = this.builderSq();
    const c = q || this.state.buildings.find(b => b.owner === this.me && b.type === 'hq') || { x: 8, z: 16 };
    if (BUILDINGS[type].site) { const sh = nearestFreeSite(this.state, c.x, c.z, this.planner.queued()); return sh ? { x: sh.x, z: sh.z } : { x: c.x, z: c.z }; }
    const home = this.me === 0 ? Math.PI : 0;
    for (let r = 2.5; r < 10; r += 0.75) for (let k = 0; k < 16; k++) {
      const a = home + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (!this.planner.buildError(type, x, z, rot, this.buildBy)) return { x, z };
    }
    return { x: c.x + (this.me === 0 ? -3 : 3), z: c.z };
  },
  startPlace(type) {
    const rot = type === 'wall' ? 1 : 0;
    const p = this.defaultSpot(type, rot);
    this.buildMode = { type, rot, x: p.x, z: p.z };
    this.movePlace(p.x, p.z);
  },
  movePlace(x, z) {
    const pm = this.buildMode; if (!pm) return;
    if (BUILDINGS[pm.type].site) {
      // resource-site buildings snap onto the nearest free site
      const own = this.planner.draft.builds.findIndex(b => b.by === this.buildBy);
      const sh = nearestFreeSite(this.state, x, z, this.planner.queued(own));
      if (sh && Math.hypot(sh.x - x, sh.z - z) < 5) { x = sh.x; z = sh.z; }
      pm.x = x; pm.z = z;
    } else { pm.x = Math.round(x * 4) / 4; pm.z = Math.round(z * 4) / 4; }
    pm.err = this.planner.buildError(pm.type, pm.x, pm.z, pm.rot, this.buildBy);
    const q = this.builderSq();
    pm.prev = q && !pm.err ? this.planner.builderPreview(q, { type: pm.type, ...footprint(pm.type, pm.x, pm.z, pm.rot) }) : null;
    if (pm.prev && !pm.prev.actions.length) pm.err = 'The builder can\'t reach that spot';
    this.changed();
    this.drawPlaceLine();
  },
  // the builder's walk to the site, drawn while placing
  drawPlaceLine() {
    this.view.clear('ghost');
    const pm = this.buildMode, q = this.builderSq();
    if (!pm || !pm.prev || !q || !pm.prev.pts) return;
    const line = [{ x: q.x, z: q.z }, ...pm.prev.pts];
    this.view.layers.ghost.add(ribbon(line, 0.1, 0xffc400, 0.8));
    this.view.layers.ghost.add(chevrons(line, 0x111111, 0.5));
  },
  rotatePlace() { const pm = this.buildMode; if (!pm || BUILDINGS[pm.type].shape === 'circle') return; pm.rot = pm.rot ? 0 : 1; this.movePlace(pm.x, pm.z); this.changed(); },
  confirmPlace() {
    const pm = this.buildMode; if (!pm) return false;
    if (pm.err) { this.toast(pm.err, true); return false; }
    if (!this.planner.addBuild(this.buildBy, pm.type, pm.x, pm.z, pm.rot)) return false;
    const pv = pm.prev;
    sfx('confirm');
    this.texts.add(pm.x, pm.z, `${BUILDINGS[pm.type].name[this.faction(this.me)]}: ${pv && pv.rounds <= 1 ? 'done this round' : pv ? pv.rounds + ' rounds' : 'queued'}`, 'ok', 2.6, 1.6);
    this.buildMode = null;
    this.view.clear('ghost');
    this.changed();
    return true;
  },
  nearPlace(p) {
    const pm = this.buildMode; if (!pm || !p) return false;
    const f = footprint(pm.type, pm.x, pm.z, pm.rot);
    const r = f.r !== undefined ? f.r : Math.max(f.w, f.d) / 2;
    return Math.hypot(p.x - pm.x, p.z - pm.z) < r + 1.4;
  },

  // ---------------------------------------------------------------- selection
  pickBuilding(cx, cy) {
    const p = this.view.pick(cx, cy, 0); if (!p) return null;
    let best = null, bd = 1e9;
    for (const b of this.blist || []) {
      if (b.place) continue;
      const inside = b.r !== undefined ? Math.hypot(p.x - b.x, p.z - b.z) < b.r + 0.5 : Math.abs(p.x - b.x) < b.w / 2 + 0.4 && Math.abs(p.z - b.z) < b.d / 2 + 0.4;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (inside && d < bd) { bd = d; best = b; }
    }
    return best;
  },
  selectBuilding(id) {
    this.selB = id; this.selected = null; this.buildMode = null;
    this.view.clear('ghost');
    this.changed();
  },
  selectedBuilding() { return this.selB ? (this.blist || []).find(b => b.id === this.selB) || null : null; },
  needsWork(b) { return !!b && b.owner === this.me && !b.ghost && !b.stale && (b.build > 0 || b.hp < BUILDINGS[b.type].hp); },
  // send the nearest builder (preferring ones without orders) to finish / repair a building
  sendBuilder(b) {
    const cost = q => (this.planner.plan(q.id) ? 100 : 0) + Math.hypot(q.x - b.x, q.z - b.z);
    const bs = this.myBuilders().sort((a, c) => cost(a) - cost(c));
    if (!bs.length) { this.toast('You have no builders', true); return; }
    this.planner.addWork(bs[0].id, b);
  },

  // ---------------------------------------------------------------- HUD
  income(p = this.me) { return incomeOf(this.state, p); },
  supplyHTML() {
    const eco = this.eco();
    const left = this.phase === 'planning' ? this.planner.supplyLeft() : this.state.supply[this.me];
    const army = armySize(this.state, this.me) + (this.phase === 'planning' ? this.planner.draft.trains.length : 0);
    const tip = eco.res === 'gold' ? 'Gold: your keep, farms and mines earn it every round' : `Souls: your crypt and soul wells earn a few each round; models dying within ${RULES.soulRange}″ of your squads, crypt, obelisks and soul wells give more`;
    return `<span class="ec ${eco.res}" title="${tip}">${icon(eco.icon, 16)}<b>${left}</b><small>+${this.income()}${eco.res === 'souls' ? ' +☠' : ''}</small></span>`
      + `<span class="ec" title="Army size / cap">${icon('army', 16)}<b>${army}</b><small>/${RULES.armyCap}</small></span>`;
  },

  renderBuildBar() {
    const q = this.selectedSquad?.();
    $('b-build')?.classList.toggle('on', !!(q && q.role === 'builder' && q.owner === this.me));
    $('buildbar').classList.add('hidden');
  },

  // ---------------------------------------------------------------- the builder's own dock
  renderBuilderDock(q) {
    const dock = $('dock'), info = $('info');
    info.classList.add('hidden'); dock.classList.remove('hidden');
    this.buildBy = q.id;
    const fac = this.faction(this.me), eco = this.eco(), def = defOf(q);
    const plan = this.planner.plan(q.id);
    const task = this.planner.builderTask(q);
    const st = this.planner.stanceOf(q);
    const pm = this.buildMode;
    const head = `<div class="dk-head"><div><div class="nm">${icon('builder', 16)} ${esc(def.name)}</div><div class="sub">${q.models}/${def.models} models · ${q.hp} HP · Builder: free to command</div></div><button class="ib x" data-bd="close">✕</button></div>
      <div class="bd-task ${task.mode || ''}">${esc(task.text)}</div>`;
    if (pm) {
      const d = BUILDINGS[pm.type], pv = pm.prev;
      const stt = pm.err ? esc(pm.err)
        : pv ? `${pv.arrive ? `Walks ${pv.arrive} AP, then ` : 'Right here: '}${Math.min(pv.work, pv.need)}/${pv.need} work this round → <b>${pv.rounds <= 1 ? 'finished this round' : pv.rounds + ' rounds'}</b>` : '';
      dock.innerHTML = head + `<div class="bd-place"><div class="bb-t">${icon(d.icon, 22)}<div><b>${esc(d.name[fac])}</b> · ${d.cost} ${esc(eco.name.toLowerCase())}<div class="bb-st ${pm.err ? 'bad' : 'ok'}">${stt}</div><div class="bb-tip">Drag the ghost or tap the table to move it.</div></div></div>
        <div class="bd-pbtns">${d.shape === 'circle' ? '' : '<button class="chip" data-bd="rot">⟳ Rotate</button>'}<button class="chip" data-bd="cancel">✕ Cancel</button><button class="ready sm ok" data-bd="confirm" ${pm.err ? 'disabled' : ''}>✓ Confirm</button></div></div>`;
    } else {
      const own = this.planner.draft.builds.find(b => b.by === q.id);
      const left = this.planner.supplyLeft() + (own ? BUILDINGS[own.type].cost : 0);
      const live = this.state.buildings.filter(b => b.owner === this.me).concat(this.planner.queued());
      const needs = this.state.buildings.filter(b => this.needsWork(b));
      const gb = this.state.buildings.filter(b => b.owner === this.me && gatherRate(this.state, b));
      const btn = (act, ic, label, sub, on = false, dis = false) => `<button class="act cat-none${on ? ' on' : ''}" data-bd="${act}" ${dis ? 'disabled' : ''}>${icon(ic, 20)}${label}<small>${sub}</small></button>`;
      dock.innerHTML = head + `<div class="dk-btns bd-btns">
          ${btn('move', 'move', 'Move', 'or tap', this.mode === 'move' && !!plan && plan.actions.some(a => a.kind === 'move'))}
          ${btn('gather', eco.icon, 'Gather', gb.length ? 'nearest' : 'none yet', task.mode === 'gather' && !!plan, !gb.length)}
          ${btn('fix', 'build', needs.length ? (needs.some(b => b.build) ? 'Finish' : 'Repair') : 'Repair', needs.length ? esc(this.bname(needs.sort((a, b) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(b.x - q.x, b.z - q.z))[0])) : 'none', false, !needs.length)}
          ${btn('hold', 'hold', st === 'hold' ? 'Holding' : 'Hold', st === 'hold' ? 'tap: work' : 'stay put', st === 'hold' && !plan)}
          ${btn('undo', 'undo', 'Undo', '', false, !plan)}
          ${btn('clear', 'release', 'Clear', 'automatic', false, !plan)}
        </div>
        <div class="bd-sec${this.flashCards ? ' flash' : ''}">Build · ${icon(eco.icon, 12)} ${left} ${esc(eco.name.toLowerCase())}</div>
        <div class="bb-cards bd-cards">${FACTIONS[fac].buildings.map(t => {
          const d = BUILDINGS[t];
          const n = live.filter(b => b.type === t).length;
          const max = t === 'banner' ? RULES.maxBannerCp : t === 'farm' ? RULES.maxFarms : 0;
          const full = max && n >= max, nosite = d.site && !nearestFreeSite(this.state, 24, 16, this.planner.queued());
          const dis = d.cost > left || full || nosite;
          return `<button class="bcard" data-bt="${t}" ${dis ? 'disabled' : ''} title="${esc(FX(t, fac))}">${icon(d.icon, 20)}<b>${esc(d.name[fac])}</b><small>${d.cost} · ${d.work} work</small><small class="fx">${full ? 'Max reached' : nosite ? 'No free site' : SHORT[t]}</small></button>`;
        }).join('')}</div>
        ${own ? `<div class="bb-q">Ordered to build a ${esc(BUILDINGS[own.type].name[fac])}. Picking another replaces it.</div>` : ''}
        <div class="hint">With no orders a builder keeps at its job: it finishes its building, then gathers ${esc(eco.name.toLowerCase())} at the nearest ${esc(this.gatherNames())}. Tap one of your buildings to send it there.</div>`;
    }
    this.flashCards = false;
    dock.querySelectorAll('[data-bt]').forEach(el => el.onclick = () => { this.startPlace(el.dataset.bt); });
    dock.querySelectorAll('[data-bd]').forEach(el => el.onclick = () => {
      const a = el.dataset.bd;
      if (a === 'close') this.select(null);
      else if (a === 'rot') this.rotatePlace();
      else if (a === 'cancel') { this.buildMode = null; this.view.clear('ghost'); }
      else if (a === 'confirm') this.confirmPlace();
      else if (a === 'move') { this.mode = 'move'; this.toast('Drag the green knob, or tap the table'); }
      else if (a === 'gather') this.planner.gatherAuto(q.id);
      else if (a === 'fix') { const b = this.state.buildings.filter(b => this.needsWork(b)).sort((a, b) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(b.x - q.x, b.z - q.z))[0]; if (b) this.planner.addWork(q.id, b); }
      else if (a === 'hold') { if (this.planner.plan(q.id)) this.planner.clear(q.id); this.planner.setStance(q.id, st === 'hold' ? 'guard' : 'hold'); }
      else if (a === 'undo') this.planner.undo(q.id);
      else if (a === 'clear') this.planner.clear(q.id);
      this.changed();
    });
  },

  // dock for a selected building: training cards, work / repair, or info
  renderBuildingDock(b) {
    const dock = $('dock'), info = $('info');
    const fac = this.faction(b.owner), d = BUILDINGS[b.type], eco = this.eco();
    const hpTxt = `${Math.round(b.hp)}/${d.hp} HP · armour ${d.armor}`;
    if (b.draft !== undefined) {
      dock.classList.add('hidden'); info.classList.remove('hidden');
      info.innerHTML = `<b>${esc(d.name[fac])}</b> · planned · ${d.cost} ${esc(eco.name.toLowerCase())}<br><span style="color:var(--muted)">${FX(b.type, fac)} The site goes down when the round starts; the builder then works on it.</span>
        <div style="margin-top:8px"><button class="chip" data-x="cancel">Cancel this build</button></div>`;
      info.querySelector('[data-x]').onclick = () => { this.planner.removeBuild(b.draft); this.selB = null; this.changed(); };
      return;
    }
    const roles = b.owner === this.me && !b.stale ? d.trains || [] : [];
    const work = this.needsWork(b) ? `<div style="margin-top:8px"><button class="chip" data-x="work">${icon('builder', 14)} ${b.build ? 'Send a builder to finish it' : 'Send a builder to repair it'}</button></div>` : '';
    if (!roles.length) {
      dock.classList.add('hidden'); info.classList.remove('hidden');
      const st = b.build ? ` · under construction: ${Math.round(d.work - b.build)}/${d.work} work` : '';
      info.innerHTML = `<b>${b.owner === this.me ? 'Your' : 'Enemy'} ${esc(d.name[fac])}</b>${b.stale ? ' (last seen)' : ''} · ${hpTxt}${st}<br><span style="color:var(--muted)">${FX(b.type, fac)}${b.owner !== this.me ? ' Attack it with swings, volleys and skills: buildings take extra damage.' : ''}</span>${work}`;
      info.querySelector('[data-x]')?.addEventListener('click', () => this.sendBuilder(b));
      return;
    }
    info.classList.add('hidden'); dock.classList.remove('hidden');
    const cur = this.planner.trainOf(b.id);
    const units = FACTIONS[fac].units;
    const status = b.build ? `Under construction (${Math.round(d.work - b.build)}/${d.work} work): it can train once it is finished.` : b.train ? `Training ${esc(units[b.train.role].name)}: it arrives at the end of this round.` : cur ? `${esc(units[cur.role].name)} will train this round and arrive at the end of the next.` : `Pick a squad to train. It takes a round and appears next to the ${esc(d.name[fac].toLowerCase())}.`;
    dock.innerHTML = `<div class="dk-head"><div><div class="nm">${esc(d.name[fac])}</div><div class="sub">${hpTxt} · ${icon(eco.icon, 12)} ${this.planner.supplyLeft()} left · army ${armySize(this.state, this.me) + this.planner.draft.trains.length}/${RULES.armyCap}</div></div><button class="ib x" data-tr="close">✕</button></div>
      <div class="dk-btns">${roles.map(role => {
        const u = units[role], on = cur?.role === role;
        const err = on ? '' : this.planner.trainError(b, role);
        return `<button class="act cat-none${on ? ' on' : ''}" data-tr="${role}" ${err ? 'disabled' : ''} title="${esc(err || `${u.models} models`)}">${icon(role, 20)}${esc(u.name)}<small>${on ? 'queued ✕' : `${trainCost(fac, role)} ${esc(eco.name.toLowerCase())}`}</small></button>`;
      }).join('')}</div>
      <div class="hint">${status}</div>${work}`;
    dock.querySelectorAll('[data-tr]').forEach(el => el.onclick = () => {
      if (el.dataset.tr === 'close') { this.selB = null; this.changed(); return; }
      if (this.planner.addTrain(b, el.dataset.tr) && this.planner.trainOf(b.id)) this.texts.add(b.x, b.z, `Training ${units[el.dataset.tr].name}`, 'ok', 2.8, 1.3);
    });
    dock.querySelector('[data-x]')?.addEventListener('click', () => this.sendBuilder(b));
  },

  // while placing: your build zone, or the free resource sites for mines / wells
  drawBuildZone(L) {
    if (!this.buildMode) return;
    const W = RULES.board.w, H = RULES.board.h;
    if (BUILDINGS[this.buildMode.type].site) {
      for (const sh of this.state.shrines) if (!siteTaken(this.state, sh, this.planner.queued())) { const r = ring(1.4, 0.1, 0xffc400, 0.7, 0.1, 48); r.position.x = sh.x; r.position.z = sh.z; L.add(r); }
    } else {
      const x = this.me === 0 ? RULES.buildZone : W - RULES.buildZone;
      L.add(ribbon([{ x, z: 0.3 }, { x, z: H - 0.3 }], 0.08, 0xffc400, 0.6));
    }
  },

  // nameplates for buildings (added to the squad label pass)
  buildingLabelItems(items, seen, zoomedOut) {
    const layer = $('labels');
    for (const b of this.blist || []) {
      if (b.place) continue;
      const lid = 'B' + (b.vkey || b.id);
      const v = this.bviews.get(b.vkey || b.id); if (!v) continue;
      seen.add(lid);
      let el = this.labels.get(lid);
      if (!el) { el = document.createElement('div'); el.className = 'sl bl'; layer.appendChild(el); this.labels.set(lid, el); }
      const d = BUILDINGS[b.type], fac = this.faction(b.owner);
      const train = this.phase === 'planning' && b.owner === this.me ? this.planner.trainOf(b.id) : null;
      const sel = b.id === this.selB;
      const status = b.ghost ? 'planned' : b.stale ? 'last seen' : b.build ? `${Math.round(d.work - b.build)}/${d.work} work` : b.train ? `training ${FACTIONS[fac].units[b.train.role].name}` : train ? `queued: ${FACTIONS[fac].units[train.role].name}` : '';
      const key = `${Math.round(b.hp)}|${status}|${sel}|${zoomedOut}|${b.dying !== undefined}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.style.setProperty('--team', TEAM[b.owner]);
        el.innerHTML = `<div class="sl-h"><span class="tr bi">${icon(d.icon, 12)}</span><span class="nm">${esc(d.name[fac])}</span></div>`
          + (b.ghost ? '' : `<div class="sl-hp"><b style="width:${(100 * b.hp / d.hp).toFixed(0)}%"></b><span>${Math.round(b.hp)}</span></div>`)
          + (b.build && !b.ghost ? `<div class="sl-wk"><b style="width:${(100 * (1 - b.build / d.work)).toFixed(0)}%"></b></div>` : '')
          + (status ? `<div class="sl-s"><span class="st">${esc(status)}</span></div>` : '');
        el.className = 'sl bl' + (sel ? ' sel' : '') + (b.ghost || b.stale ? ' ghost' : '') + (zoomedOut && !sel && b.type !== 'hq' ? ' compact' : '') + (b.dying !== undefined ? ' dim' : '');
        el._w = el.offsetWidth; el._h = el.offsetHeight;
      }
      const t = v.top();
      const p = this.view.project(t.x, t.y, t.z);
      const hide = p.behind || b.dying > 0.6 || (zoomedOut && b.type === 'wall' && !sel);
      el.style.display = hide ? 'none' : '';
      if (!hide) items.push({ el, x: p.x, y: p.y, sel });
    }
  },
};
