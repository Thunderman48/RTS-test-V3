// Base & economy: buildings (footprints, obstacles, placement), shrine nodes, supply,
// training. Deterministic, shared by the resolver, the planner UI and the AI.
import { RULES, BUILDINGS, FACTIONS, squadRadius, trainCost } from '../data/units.js';
import { dist, inRect } from './geom.js';
import { pointBlocked } from './nav.js';

export const bdef = b => BUILDINGS[b.type];
export const bname = (b, faction) => BUILDINGS[b.type].name[faction];

// footprint of a building at (x,z) with rot (0 or 1 = rotated 90 degrees)
export function footprint(type, x, z, rot = 0) {
  const d = BUILDINGS[type];
  if (d.shape === 'circle') return { x, z, r: d.r };
  return rot ? { x, z, w: d.d, d: d.w } : { x, z, w: d.w, d: d.d };
}
// a round "hit" radius for attacks and sight
export function hitRadius(b) { const d = bdef(b); return d.shape === 'circle' ? d.r : Math.sqrt(b.w * b.d) / 2 + 0.15; }

// distance from (x,z) to the building's footprint edge (0 inside)
export function edgeDist(b, x, z) {
  if (b.r !== undefined) return Math.max(0, dist(b.x, b.z, x, z) - b.r);
  const dx = Math.max(0, Math.abs(x - b.x) - b.w / 2), dz = Math.max(0, Math.abs(z - b.z) - b.d / 2);
  return Math.sqrt(dx * dx + dz * dz);
}
export function addBuilding(s, owner, type, x, z, rot = 0, built = true) {
  const d = BUILDINGS[type];
  const b = { id: 'b' + (s.nextBid = (s.nextBid || 0) + 1), owner, type, rot, ...footprint(type, x, z, rot),
    hp: built || !d.work ? d.hp : Math.max(1, Math.round(d.hp * RULES.siteHp)), build: built ? 0 : d.work, train: null, vision: built || !d.work ? d.vision : 3 };
  if (d.trains) b.queue = [];
  s.buildings.push(b);
  return b;
}

// terrain + standing buildings as one obstacle list (buildings use kind 'building' so nav blocks them)
const obsCache = new Map();
export function buildingSig(s) { return (s.map || '') + '#' + (s.buildings || []).filter(b => b.hp > 0).map(b => b.id + '@' + b.x + ',' + b.z + ',' + b.rot).join('|'); }
export function obstacles(s) {
  const sig = buildingSig(s);
  if (!sig) return s.terrain;
  let o = obsCache.get(sig);
  if (!o) {
    o = s.terrain.concat(s.buildings.filter(b => b.hp > 0).map(b => b.r !== undefined ? { kind: 'building', x: b.x, z: b.z, r: b.r } : { kind: 'building', x: b.x, z: b.z, w: b.w, d: b.d }));
    if (obsCache.size > 60) obsCache.clear();
    obsCache.set(sig, o);
  }
  return o;
}
export const navKey = s => 'r' + buildingSig(s);

// ---- placement ------------------------------------------------------------------------
function overlaps(a, b, pad = 0) {
  // circle / rect vs circle / rect (rects are axis aligned)
  const ra = a.r !== undefined, rb = b.r !== undefined;
  if (ra && rb) return dist(a.x, a.z, b.x, b.z) < a.r + b.r + pad;
  if (ra && !rb) return inRect(a.x, a.z, b, a.r + pad);
  if (!ra && rb) return inRect(b.x, b.z, a, b.r + pad);
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad;
}
// resource site at (x,z) (within a small snap distance), or null
export function siteAt(s, x, z, snap = 0.6) { return (s.shrines || []).find(sh => dist(sh.x, sh.z, x, z) <= snap) || null; }
export function siteTaken(s, sh, extra = []) { return (s.buildings || []).filter(b => b.hp > 0).concat(extra).some(b => BUILDINGS[b.type].site && dist(b.x, b.z, sh.x, sh.z) < 0.6); }
// nearest resource site to (x,z) that is still free
export function nearestFreeSite(s, x, z, extra = []) {
  let best = null, bd = 1e9;
  for (const sh of s.shrines || []) { const d = dist(sh.x, sh.z, x, z); if (d < bd && !siteTaken(s, sh, extra)) { bd = d; best = sh; } }
  return best;
}
export const canBuild = (s, p, type) => FACTIONS[s.players[p].faction].buildings.includes(type);

// can side p place `type` at (x,z,rot)? `extra` = buildings already queued. `squads` = false ignores
// squads standing there (they move; used for the build queue). Returns '' or a reason.
export function placeError(s, p, type, x, z, rot = 0, extra = [], squads = true) {
  const W = s.board.w, H = s.board.h, d = BUILDINGS[type];
  if (!d || !canBuild(s, p, type)) return 'Your side can\'t build that';
  const f = footprint(type, x, z, rot), half = f.r !== undefined ? f.r : Math.max(f.w, f.d) / 2;
  if (x - half < 0.3 || z - half < 0.3 || x + half > W - 0.3 || z + half > H - 0.3) return 'Off the board';
  const live = (s.buildings || []).filter(b => b.hp > 0).concat(extra);
  if (d.site) {
    const sh = siteAt(s, x, z);
    if (!sh) return 'Must stand on a resource site';
    if (siteTaken(s, sh, extra)) return 'That site is already taken';
  } else {
    if (p === 0 ? x > s.board.zone : x < W - s.board.zone) return 'Only in your third of the table';
    for (const sh of s.shrines || []) if (overlaps(f, { x: sh.x, z: sh.z, r: RULES.shrineRadius * 0.6 }, 0)) return 'Too close to a resource site';
  }
  for (const t of s.terrain) {
    if (t.kind === 'board') continue;
    if (t.kind === 'river') { if (Math.abs(x - t.x) < t.w / 2 + half) return 'Not in the stream'; continue; }
    const tf = t.r !== undefined ? { x: t.x, z: t.z, r: t.r } : { x: t.x, z: t.z, w: t.w, d: t.d };
    if (overlaps(f, tf, 0.2)) return 'Blocked by terrain';
  }
  for (const b of live) if (overlaps(f, b, 0.3)) return 'Too close to another building';
  if (squads) for (const q of s.squads) if (q.hp > 0 && overlaps(f, { x: q.x, z: q.z, r: squadRadius(FACTIONS[q.faction].units[q.role], q.models) }, 0.1)) return 'A squad is standing there';
  const count = t => live.filter(b => b.owner === p && b.type === t).length;
  if (type === 'banner' && count('banner') >= RULES.maxBannerCp) return `At most ${RULES.maxBannerCp} ${d.name[s.players[p].faction].toLowerCase()}s`;
  if (type === 'farm' && count('farm') >= RULES.maxFarms) return `At most ${RULES.maxFarms} farms`;
  return '';
}
export function bannerCount(s, p) { return (s.buildings || []).filter(b => b.owner === p && b.type === 'banner' && b.hp > 0).length; }
export function bonusCp(s, p) { return Math.min(RULES.maxBannerCp, (s.buildings || []).filter(b => b.owner === p && b.type === 'banner' && b.hp > 0 && !b.build).length); }
export const isBuilder = q => q.role === 'builder';
export function builderCount(s, p) { return s.squads.filter(q => q.owner === p && q.hp > 0 && isBuilder(q)).length + (s.buildings || []).filter(b => b.owner === p && b.train && b.train.role === 'builder').length; }
export function armySize(s, p) { return s.squads.filter(q => q.owner === p && q.hp > 0).length + (s.buildings || []).filter(b => b.owner === p && b.train).length; }
// income per round for side p (finished buildings only)
export function incomeOf(s, p) {
  const eco = FACTIONS[s.players[p].faction].eco;
  let v = 0;
  for (const b of s.buildings || []) {
    if (b.owner !== p || b.hp <= 0 || b.build) continue;
    if (b.type === 'hq') v += eco.hq;
    else v += BUILDINGS[b.type].income || 0;
  }
  return Math.round(v * (s.players[p].incomeMult || 1));   // AI difficulty
}
// AP of builder work per 1 resource when gathering at building b (0 = can't gather there)
export function gatherRate(s, b) {
  if (!b || b.hp <= 0 || b.build) return 0;
  return FACTIONS[s.players[b.owner].faction].eco.gather[b.type] || 0;
}
// can building b train `role` (ignoring supply)?
export function trainsRole(b, role) { return (BUILDINGS[b.type].trains || []).includes(role); }

// ---- production queues ------------------------------------------------------------------
// Two kinds: one base build queue per side (s.bq[p], items { qid, type, x, z, rot }) that free
// builders take from, and a queue of roles on every training building (b.queue). Items are paid
// when they start (at the start of a round); a queue whose front item can't start waits.
export const trainers = (s, p) => (s.buildings || []).filter(b => b.owner === p && b.hp > 0 && !b.build && (BUILDINGS[b.type].trains || []).length);
const qfoot = (it, p) => ({ type: it.type, x: it.x, z: it.z, rot: it.rot, owner: p, ...footprint(it.type, it.x, it.z, it.rot) });
export const buildQueue = (s, p) => (s.bq && s.bq[p]) || [];

// validate side p's queue orders. orders.queue = { builds?: full list, trains?: { bid: roles }, cancel?: [bid] }
// replaces lists; the legacy orders.builds / orders.trains are appended. Returns the new queues.
export function validateQueue(s, p, o = {}) {
  const fac = s.players[p].faction, oq = o.queue || {};
  const cur = buildQueue(s, p);
  const hasBuilder = builderCount(s, p) > 0;
  const src = Array.isArray(oq.builds) ? oq.builds : cur.concat(Array.isArray(o.builds) ? o.builds : []);
  const bq = [], ids = new Set();
  for (const it of src) {
    if (bq.length >= RULES.queueMaxBuild) break;
    const d = BUILDINGS[it?.type];
    if (!d || it.type === 'hq' || !hasBuilder) continue;
    const x = +it.x || 0, z = +it.z || 0, rot = it.rot ? 1 : 0;
    const qid = it.qid && !ids.has(it.qid) && cur.some(c => c.qid === it.qid) ? it.qid : null;
    // a new or moved item must fit; an item left where it was is checked when it starts (and dropped
    // there with an event if its spot became invalid)
    const same = qid && cur.some(c => c.qid === qid && c.type === it.type && c.x === x && c.z === z && c.rot === rot);
    if (!same && placeError(s, p, it.type, x, z, rot, bq.map(b => qfoot(b, p)), false)) continue;
    if (qid) ids.add(qid);
    bq.push({ qid, type: it.type, x, z, rot });
  }
  const tq = {}, legacy = Array.isArray(o.trains) ? o.trains : [];
  for (const b of trainers(s, p)) {
    const rep = oq.trains && oq.trains[b.id];
    const list = Array.isArray(rep) ? rep : (b.queue || []).concat(legacy.filter(t => t && t.bid === b.id).map(t => t.role));
    tq[b.id] = list.filter(r => typeof r === 'string' && trainCost(fac, r) && trainsRole(b, r)).slice(0, RULES.queueMax);
  }
  const cancel = [...new Set((Array.isArray(oq.cancel) ? oq.cancel : []).filter(bid => trainers(s, p).some(b => b.id === bid && b.train)))];
  return { bq, tq, cancel };
}

// put validated queues into the state (assigns ids to new items; cancelling training refunds it)
export function applyQueue(s, p, v, ev = () => {}) {
  s.bq = s.bq || [[], []];
  s.bq[p] = v.bq.map(it => ({ ...it, qid: it.qid || 'k' + (s.nextQid = (s.nextQid || 0) + 1) }));
  for (const b of trainers(s, p)) b.queue = (v.tq[b.id] || []).slice();
  for (const bid of v.cancel) {
    const b = s.buildings.find(x => x.id === bid);
    const refund = trainCost(s.players[p].faction, b.train.role);
    s.supply[p] += refund;
    ev({ type: 'trainCancel', id: b.id, role: b.train.role, owner: p, refund });
    b.train = null;
  }
}

// start what can start, in order: the build queue first, then each training building (by id).
// With opts.apply the state changes (pay, place sites, start training) and events go to opts.ev;
// without it this is a forecast for the UI. opts.bq / opts.tq / opts.cancel override the queues.
// Returns { builds: [{ qid, starts | wait, need | drop }], trains: { bid: [{ starts | wait, need }] } }.
//   waits: 'gold' / 'souls' (need = shortfall), 'builders' (every builder already has a site),
//   'blocked' (a squad stands on the spot), 'cap' (army cap), 'line' (behind an item that waits)
//   drop: the spot became invalid (terrain, building, site taken, limit): the item leaves the queue
export function startQueues(s, p, opts = {}) {
  const apply = !!opts.apply, ev = opts.ev || (() => {});
  const fac = s.players[p].faction, res = FACTIONS[fac].eco.res;
  const cancel = new Set(opts.cancel || []);
  let supply = s.supply[p];
  for (const b of s.buildings) if (cancel.has(b.id) && b.owner === p && b.train) supply += trainCost(fac, b.train.role);
  const out = { builds: [], trains: {} };
  const crews = s.squads.filter(q => q.owner === p && q.hp > 0 && isBuilder(q)).length;
  let sites = s.buildings.filter(b => b.owner === p && b.hp > 0 && b.build > 0).length;
  const extra = [], keep = [];
  let line = false;
  for (const it of opts.bq || buildQueue(s, p)) {
    const d = BUILDINGS[it.type];
    const hard = placeError(s, p, it.type, it.x, it.z, it.rot, extra, false);
    if (hard) {
      out.builds.push({ qid: it.qid, drop: hard });
      if (apply) ev({ type: 'queueDrop', owner: p, qid: it.qid, btype: it.type, x: it.x, z: it.z, why: hard });
      continue;
    }
    let wait = '', need = 0;
    if (line) wait = 'line';
    else if (sites >= crews) wait = 'builders';
    else if (supply < d.cost) { wait = res; need = d.cost - supply; }
    else if (placeError(s, p, it.type, it.x, it.z, it.rot, extra, true)) wait = 'blocked';
    if (wait) { out.builds.push({ qid: it.qid, wait, need }); keep.push(it); line = true; continue; }
    supply -= d.cost; sites++;
    out.builds.push({ qid: it.qid, starts: true });
    if (apply) {
      s.supply[p] -= d.cost;
      const b = addBuilding(s, p, it.type, it.x, it.z, it.rot, !d.work);
      ev({ type: 'construct', id: b.id, btype: b.type, owner: p, x: b.x, z: b.z, rot: b.rot, hp: b.hp, build: b.build, done: !b.build, qid: it.qid });
    } else extra.push(qfoot(it, p));
  }
  if (apply) s.bq[p] = keep;
  let army = armySize(s, p), nb = builderCount(s, p);
  for (const b of cancel.size ? s.buildings : []) if (cancel.has(b.id) && b.owner === p && b.train) { army--; if (b.train.role === 'builder') nb--; }
  for (const b of trainers(s, p).sort((a, c) => +a.id.slice(1) - +c.id.slice(1))) {
    const list = out.trains[b.id] = [];
    let busy = !!b.train && !cancel.has(b.id), started = false;
    for (const role of (opts.tq && opts.tq[b.id]) || b.queue || []) {
      if (busy) { list.push({ wait: 'line' }); continue; }
      const c = trainCost(fac, role);
      let wait = '', need = 0;
      if (army >= s.board.cap) wait = 'cap';
      else if (role === 'builder' && nb >= RULES.maxBuilders) wait = 'builders';
      else if (supply < c) { wait = res; need = c - supply; }
      busy = true;
      if (wait) { list.push({ wait, need }); continue; }
      supply -= c; army++; if (role === 'builder') nb++;
      list.push({ starts: true }); started = true;
      if (apply) {
        s.supply[p] -= c;
        const n = RULES.trainRounds[role] || 2;
        b.train = { role, left: n, total: n };
        ev({ type: 'train', id: b.id, role, owner: p });
      }
    }
    if (apply && started) b.queue = b.queue.slice(1);
  }
  return out;
}

// a free spot next to a building for a newly trained squad (toward the enemy first)
export function spawnSpot(s, b, radius) {
  const dir = b.owner === 0 ? 1 : -1;
  const base = hitRadius(b) + radius + 0.4;
  const obs = obstacles(s);
  for (let ring = 0; ring < 3; ring++) for (let k = 0; k < 12; k++) {
    const a = (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * Math.PI / 6;
    const r = base + ring * 1.2;
    const x = b.x + Math.cos(a) * r * dir, z = b.z + Math.sin(a) * r;
    if (pointBlocked(obs, x, z, radius)) continue;
    if (s.squads.some(q => q.hp > 0 && dist(q.x, q.z, x, z) < radius + squadRadius(FACTIONS[q.faction].units[q.role], q.models) + 0.1)) continue;
    return { x, z };
  }
  return null;
}

// army value used for the round-limit tiebreak
export function armyValue(s, p) {
  let v = 0;
  for (const q of s.squads) if (q.owner === p && q.hp > 0) v += q.hp;
  for (const b of s.buildings || []) if (b.owner === p && b.hp > 0 && b.type === 'hq') v += b.hp * 2;   // only the HQ: farms and walls don't win battles
  return v;
}
export { BUILDINGS, trainCost };
