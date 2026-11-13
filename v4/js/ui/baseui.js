// Base UI: building and shrine views, the Build menu with drag-to-place, the barracks
// training dock, building nameplates and the economy readout. Mixed into Game.
import * as THREE from 'three';
import { RULES, FACTIONS, BUILDINGS, BUILD_ORDER, TRAIN_COST } from '../data/units.js';
import { footprint, hitRadius, armySize, bonusCp } from '../sim/base.js';
import { buildingsSeenBy } from '../sim/vision.js';
import { BuildingView, ShrineView } from '../render/buildings.js';
import { ribbon, ring } from '../render/fx.js';
import { icon } from './iconset.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEAM = ['#3a78d8', '#9b59d0'];
export const BUILD_FX = {
  hq: 'Your base. Lose it and you lose the battle. Earns supply, sees and shoots nearby enemies.',
  barracks: 'Trains a new squad each round.',
  tower: `Sees ${BUILDINGS.tower.vision}″ and shoots the nearest enemy within ${BUILDINGS.tower.fire.range}″ after every round.`,
  banner: '+1 command point while it stands (max +2).',
  wall: 'Instant. Blocks movement and volleys.',
};
const SHORT = { barracks: 'Trains squads', tower: `Sees ${BUILDINGS.tower.vision}″ · shoots`, banner: '+1 command point', wall: 'Blocks paths and shots' };

export const BaseUI = {
  // ---------------------------------------------------------------- views
  faction(owner) { return this.state.players[owner].faction; },
  bname(b) { return BUILDINGS[b.type].name[this.faction(b.owner)]; },

  makeShrines() {
    for (const v of this.shrineViews || []) this.view.layers.units.remove(v.group);
    this.shrineViews = (this.state.shrines || []).map(sh => new ShrineView(sh, this.view.layers.units, RULES.shrineRadius));
  },
  syncShrines(list) {
    const t = this.view.time || 0;
    (this.shrineViews || []).forEach((v, i) => v.update(list[i] ? list[i].owner : -1, t));
  },

  // list: [{ id, type, owner, x, z, w, d, r, rot, hp, build, ghost, dying, key }]
  syncBuildings(list) {
    this.bviews = this.bviews || new Map();
    this.blist = list;
    const keep = new Set();
    for (const b of list) {
      const key = b.vkey || b.id;
      keep.add(key);
      let v = this.bviews.get(key);
      if (v && v.sig !== b.type + b.rot + b.owner) { v.destroy(); v = null; this.bviews.delete(key); }
      if (!v) { v = new BuildingView(b, this.faction(b.owner), this.view.layers.units); v.sig = b.type + b.rot + b.owner; this.bviews.set(key, v); }
      v.group.position.set(b.x, 0, b.z);
      v.update({ build: b.build, ghost: b.ghost, visible: !(b.dying > 1), dying: b.dying });
      v.ring.visible = !b.ghost;
    }
    for (const [k, v] of this.bviews) if (!keep.has(k)) { v.destroy(); this.bviews.delete(k); }
  },

  // what my side knows about enemy buildings (the HQ is always known)
  updateBuildingFog() {
    this.knownB = this.knownB || new Map();
    const seen = buildingsSeenBy(this.state, this.me);
    for (const b of this.state.buildings) if (seen.has(b.id)) this.knownB.set(b.id, { ...b });
    for (const id of [...this.knownB.keys()]) if (!this.state.buildings.some(b => b.id === id)) this.knownB.delete(id);
  },

  planningBuildings() {
    const out = [];
    for (const b of this.state.buildings) {
      if (b.owner === this.me) out.push({ ...b, selected: b.id === this.selB });
      else if (this.knownB?.has(b.id)) out.push({ ...this.knownB.get(b.id), selected: b.id === this.selB });
    }
    if (this.phase === 'planning') {
      this.planner.draft.builds.forEach((d, i) => out.push({ id: 'draft' + i, vkey: 'draft' + i + d.type, draft: i, type: d.type, owner: this.me, rot: d.rot, ...footprint(d.type, d.x, d.z, d.rot), hp: BUILDINGS[d.type].hp, build: 0, ghost: true }));
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
    if (!pm) { if (this.placeMark) this.placeMark.visible = false; return; }
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
  },

  // ---------------------------------------------------------------- build mode
  openBuild(on = !this.buildOpen) {
    this.buildOpen = on;
    if (!on) this.buildMode = null;
    if (on) { this.selected = null; this.selB = null; }
    this.changed();
  },
  // a sensible first spot: in front of the HQ, nearest valid place
  defaultSpot(type, rot) {
    const hq = this.state.buildings.find(b => b.owner === this.me && b.type === 'hq');
    const dir = this.me === 0 ? 1 : -1;
    const cx = hq ? hq.x + dir * 5 : (this.me === 0 ? 8 : 40), cz = hq ? hq.z : 16;
    // beside the HQ first (behind the army), then anywhere nearby
    if (hq) for (const [ox, oz] of [[0.5, 6], [0.5, -6], [3, 7], [3, -7], [0.5, 9], [0.5, -9]]) {
      const x = hq.x + dir * ox, z = hq.z + oz;
      if (!this.planner.buildError(type, x, z, rot)) return { x, z };
    }
    for (let r = 0; r < 9; r += 0.75) for (let k = 0; k < Math.max(1, Math.round(r * 5)); k++) {
      const a = k / Math.max(1, Math.round(r * 5)) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!this.planner.buildError(type, x, z, rot)) return { x, z };
    }
    return { x: cx, z: cz };
  },
  startPlace(type) {
    const rot = type === 'wall' ? 1 : 0;
    const p = this.buildMode && this.buildMode.type === type ? this.buildMode : this.defaultSpot(type, rot);
    this.buildMode = { type, rot, x: p.x, z: p.z };
    this.movePlace(p.x, p.z);
  },
  movePlace(x, z) {
    const pm = this.buildMode; if (!pm) return;
    pm.x = Math.round(x * 4) / 4; pm.z = Math.round(z * 4) / 4;
    pm.err = this.planner.buildError(pm.type, pm.x, pm.z, pm.rot);
    this.renderBuildBar();
  },
  rotatePlace() { const pm = this.buildMode; if (!pm || BUILDINGS[pm.type].shape === 'circle') return; pm.rot = pm.rot ? 0 : 1; this.movePlace(pm.x, pm.z); this.changed(); },
  confirmPlace() {
    const pm = this.buildMode; if (!pm) return false;
    if (pm.err) { this.toast(pm.err, true); return false; }
    if (!this.planner.addBuild(pm.type, pm.x, pm.z, pm.rot)) return false;
    this.texts.add(pm.x, pm.z, `${BUILDINGS[pm.type].name[this.faction(this.me)]} queued`, 'ok', 2.6, 1.3);
    // walls: keep placing the next section; everything else: back to the build menu
    if (pm.type === 'wall' && this.planner.supplyLeft() >= BUILDINGS.wall.cost) {
      const f = footprint('wall', 0, 0, pm.rot);
      this.movePlace(pm.x + (pm.rot ? 0 : f.w + 0.4), pm.z + (pm.rot ? f.d + 0.4 : 0));
    } else this.buildMode = null;
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
    this.selB = id; this.selected = null; this.buildOpen = false; this.buildMode = null;
    this.changed();
  },
  selectedBuilding() { return this.selB ? (this.blist || []).find(b => b.id === this.selB) || null : null; },

  // ---------------------------------------------------------------- HUD
  income(p = this.me) {
    const hq = this.state.buildings.some(b => b.owner === p && b.type === 'hq');
    return (hq ? RULES.hqIncome : 0) + (this.state.shrines || []).filter(sh => sh.owner === p).length * RULES.shrineIncome;
  },
  supplyHTML() {
    const left = this.phase === 'planning' ? this.planner.supplyLeft() : this.state.supply[this.me];
    const army = armySize(this.state, this.me) + (this.phase === 'planning' ? this.planner.draft.trains.length : 0);
    return `<span class="ec" title="Supply: spend it on buildings and new squads">${icon('supply', 16)}<b>${left}</b><small>+${this.income()}</small></span>`
      + `<span class="ec" title="Army size / cap">${icon('army', 16)}<b>${army}</b><small>/${RULES.armyCap}</small></span>`;
  },

  renderBuildBar() {
    const bar = $('buildbar');
    $('b-build')?.classList.toggle('on', !!this.buildOpen);
    if (this.phase !== 'planning' || !this.buildOpen) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const fac = this.faction(this.me);
    const pm = this.buildMode;
    if (pm) {
      const d = BUILDINGS[pm.type];
      bar.innerHTML = `<div class="bb-place">
        <div class="bb-t">${icon(d.icon, 20)}<div><b>${esc(d.name[fac])}</b> · ${d.cost} supply<div class="bb-st ${pm.err ? 'bad' : 'ok'}">${pm.err ? esc(pm.err) : 'Good spot. Tap <b>Place</b>, or drag it and let go.'}</div></div></div>
        <div class="bb-btns">${d.shape === 'circle' ? '' : '<button class="chip" data-bb="rot">⟳ Rotate</button>'}<button class="chip" data-bb="back">✕ Cancel</button><button class="ready sm" data-bb="place" ${pm.err ? 'disabled' : ''}>Place</button></div></div>`;
    } else {
      const left = this.planner.supplyLeft();
      const q = this.planner.draft.builds;
      bar.innerHTML = `<div class="bb-head"><b>Build</b><span>${icon('supply', 14)} ${left} supply left · build in your third of the table, within ${RULES.buildRange}″ of your buildings</span><button class="ib sm" data-bb="close">✕</button></div>
        <div class="bb-cards">${BUILD_ORDER.map(t => {
          const d = BUILDINGS[t];
          const banners = t === 'banner' && this.state.buildings.filter(b => b.owner === this.me && b.type === 'banner').length + q.filter(b => b.type === 'banner').length >= RULES.maxBannerCp;
          const dis = d.cost > left || banners;
          return `<button class="bcard" data-bt="${t}" ${dis ? 'disabled' : ''}>${icon(d.icon, 22)}<b>${esc(d.name[fac])}</b><small>${d.cost} supply · ${d.build ? d.build + ' round' : 'instant'}</small><small class="fx">${banners ? 'Max banners' : SHORT[t]}</small></button>`;
        }).join('')}</div>
        ${q.length ? `<div class="bb-q">Queued: ${q.map((b, i) => `<button class="chip" data-bq="${i}">${esc(BUILDINGS[b.type].name[fac])} ✕</button>`).join('')}</div>` : ''}`;
    }
    bar.querySelectorAll('[data-bt]').forEach(el => el.onclick = () => { this.startPlace(el.dataset.bt); this.changed(); });
    bar.querySelectorAll('[data-bq]').forEach(el => el.onclick = () => { this.planner.removeBuild(+el.dataset.bq); });
    bar.querySelectorAll('[data-bb]').forEach(el => el.onclick = () => {
      const a = el.dataset.bb;
      if (a === 'close') this.openBuild(false);
      else if (a === 'back') { this.buildMode = null; this.changed(); }
      else if (a === 'rot') this.rotatePlace();
      else if (a === 'place') this.confirmPlace();
    });
  },

  // dock for a selected building: training cards for my barracks, info for everything else
  renderBuildingDock(b) {
    const dock = $('dock'), info = $('info');
    const fac = this.faction(b.owner), d = BUILDINGS[b.type];
    const hpTxt = `${b.hp}/${d.hp} HP · armour ${d.armor}`;
    if (b.draft !== undefined) {
      dock.classList.add('hidden'); info.classList.remove('hidden');
      info.innerHTML = `<b>${esc(d.name[fac])}</b> · planned · ${d.cost} supply<br><span style="color:var(--muted)">${BUILD_FX[b.type]} It is placed when the round starts.</span>
        <div style="margin-top:8px"><button class="chip" data-x="cancel">Cancel this build</button></div>`;
      info.querySelector('[data-x]').onclick = () => { this.planner.removeBuild(b.draft); this.selB = null; this.changed(); };
      return;
    }
    if (b.owner !== this.me || b.type !== 'barracks') {
      dock.classList.add('hidden'); info.classList.remove('hidden');
      const st = b.build ? ` · under construction (${b.build} round${b.build > 1 ? 's' : ''})` : '';
      const extra = b.type === 'hq' && b.owner === this.me ? ` Earns ${RULES.hqIncome} supply a round; each shrine you hold adds ${RULES.shrineIncome}.` : '';
      info.innerHTML = `<b>${b.owner === this.me ? 'Your' : 'Enemy'} ${esc(d.name[fac])}</b> · ${hpTxt}${st}<br><span style="color:var(--muted)">${BUILD_FX[b.type]}${extra}${b.owner !== this.me ? ' Attack it with swings, volleys and skills: buildings take extra damage.' : ''}</span>`;
      return;
    }
    info.classList.add('hidden'); dock.classList.remove('hidden');
    const cur = this.planner.trainOf(b.id);
    const units = FACTIONS[fac].units;
    const status = b.build ? 'Under construction: it can train once it is finished.' : b.train ? `Training ${esc(units[b.train.role].name)}: it arrives at the end of this round.` : cur ? `${esc(units[cur.role].name)} will train this round and arrive at the end of the next.` : 'Pick a squad to train. It takes a round and appears next to the barracks.';
    dock.innerHTML = `<div class="dk-head"><div><div class="nm">${esc(d.name[fac])}</div><div class="sub">${hpTxt} · ${icon('supply', 12)} ${this.planner.supplyLeft()} supply left · army ${armySize(this.state, this.me) + this.planner.draft.trains.length}/${RULES.armyCap}</div></div><button class="ib x" data-tr="close">✕</button></div>
      <div class="dk-btns">${Object.keys(TRAIN_COST).map(role => {
        const u = units[role], on = cur?.role === role;
        const err = on ? '' : this.planner.trainError(b, role);
        return `<button class="act cat-none${on ? ' on' : ''}" data-tr="${role}" ${err ? 'disabled' : ''} title="${esc(err || `${u.models} models`)}">${icon(role, 20)}${esc(u.name)}<small>${on ? 'queued ✕' : `${TRAIN_COST[role]} supply`}</small></button>`;
      }).join('')}</div>
      <div class="hint">${status}</div>`;
    dock.querySelectorAll('[data-tr]').forEach(el => el.onclick = () => {
      if (el.dataset.tr === 'close') { this.selB = null; this.changed(); return; }
      if (this.planner.addTrain(b, el.dataset.tr) && this.planner.trainOf(b.id)) this.texts.add(b.x, b.z, `Training ${units[el.dataset.tr].name}`, 'ok', 2.8, 1.3);
    });
  },

  // build zone outlines while placing: your third of the table and the range around your buildings
  drawBuildZone(L) {
    if (!this.buildMode) return;
    const W = RULES.board.w, H = RULES.board.h, x = this.me === 0 ? RULES.buildZone : W - RULES.buildZone;
    L.add(ribbon([{ x, z: 0.3 }, { x, z: H - 0.3 }], 0.08, 0xffc400, 0.6));
    for (const b of this.state.buildings.filter(b => b.owner === this.me).concat(this.planner.queued())) {
      const r = ring(RULES.buildRange, 0.05, 0xffc400, 0.25, 0.1, 72); r.position.x = b.x; r.position.z = b.z; L.add(r);
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
      const status = b.ghost ? 'planned' : b.build ? `building · ${b.build} rd` : b.train ? `training ${FACTIONS[fac].units[b.train.role].name}` : train ? `queued: ${FACTIONS[fac].units[train.role].name}` : '';
      const key = `${b.hp}|${status}|${sel}|${zoomedOut}|${b.dying !== undefined}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.style.setProperty('--team', TEAM[b.owner]);
        el.innerHTML = `<div class="sl-h"><span class="tr bi">${icon(d.icon, 12)}</span><span class="nm">${esc(d.name[fac])}</span></div>`
          + (b.ghost ? '' : `<div class="sl-hp"><b style="width:${(100 * b.hp / d.hp).toFixed(0)}%"></b><span>${b.hp}</span></div>`)
          + (status ? `<div class="sl-s"><span class="st">${esc(status)}</span></div>` : '');
        el.className = 'sl bl' + (sel ? ' sel' : '') + (b.ghost ? ' ghost' : '') + (zoomedOut && !sel && b.type !== 'hq' ? ' compact' : '') + (b.dying !== undefined ? ' dim' : '');
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

export { bonusCp };
