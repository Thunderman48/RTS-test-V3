// Order costs, CP accounting and validation. Shared by the planner UI, the AI and the resolver.
import { CONFIG } from '../config.js';
import { dist, inRect } from './geom.js';
import { apFor, cpPools, unitDef, armyCount, emptyPlan, findEntity, skillDef, cdOf } from './state.js';

export const SKILL_KINDS = ['dash', 'shove', 'frag', 'disrupt', 'sweep'];
export const PREPAID_SKILLS = ['fortify', 'rally'];

export function actionCost(u, a) {
  const d = CONFIG.units[u.type];
  switch (a.kind) {
    case 'move': case 'wait': return a.ap;
    case 'attack': return (a.moveAp || 0) + d.strike.ap;
    case 'shoot': return d.shot.ap;
    case 'shove': return (a.moveAp || 0) + (skillDef(u.type, 'shove')?.ap || 0);
    default: {
      const k = skillDef(u.type, a.kind);
      return k ? k.ap : 0;
    }
  }
}

export function upgradeCost(n) {
  let c = 0;
  for (let i = 0; i < n; i++) c += CONFIG.tierUpgradeCost[i];
  return c;
}

export function prepaidCost(u, plan) {
  return upgradeCost(plan.upgrades || 0)
    + (plan.defends || 0) * CONFIG.extraDefendCost
    + (plan.overwatch || 0) * CONFIG.overwatchCost
    + (plan.parry ? CONFIG.parryCost : 0)
    + (plan.buffs || []).reduce((n, id) => n + (skillDef(u.type, id)?.ap || 0), 0);
}

export function planCost(u, plan) {
  return prepaidCost(u, plan) + plan.actions.reduce((s, a) => s + actionCost(u, a), 0);
}

// Skill ids already planned this round (each skill can be used once per round)
export function skillsPlanned(plan) {
  const out = new Set(plan.buffs || []);
  for (const a of plan.actions) if (SKILL_KINDS.includes(a.kind)) out.add(a.kind);
  return out;
}

// Sanitize a single unit plan (counts, cooldowns, AP budget). Returns a new plan.
export function sanitizePlan(u, plan) {
  const d = unitDef(u);
  const p = emptyPlan();
  p.upgrades = Math.max(0, Math.min(CONFIG.maxTierUpgrades, plan.upgrades | 0));
  p.defends = Math.max(0, Math.min(CONFIG.maxExtraDefends, plan.defends | 0));
  p.overwatch = d.overwatch ? Math.max(0, Math.min(CONFIG.maxOverwatch, plan.overwatch | 0)) : 0;
  p.parry = !!(d.parry && plan.parry);
  const used = new Set();
  for (const id of plan.buffs || []) {
    const k = skillDef(u.type, id);
    if (!k || !k.prepaid || cdOf(u, id) > 0 || used.has(id)) continue;
    used.add(id); p.buffs.push(id);
  }
  const budget = apFor(u);
  let spent = prepaidCost(u, p);
  if (spent > budget) return emptyPlan();
  for (const a0 of plan.actions || []) {
    const a = { ...a0 };
    if (a.ap !== undefined) a.ap = Math.max(1, Math.round(a.ap));
    if (a.moveAp !== undefined) a.moveAp = Math.max(0, Math.round(a.moveAp));
    if (SKILL_KINDS.includes(a.kind)) {
      const k = skillDef(u.type, a.kind);
      if (!k || k.prepaid || cdOf(u, a.kind) > 0 || used.has(a.kind)) continue;
      used.add(a.kind);
    } else if (!['move', 'wait', 'attack', 'shoot'].includes(a.kind)) continue;
    if (a.kind === 'shoot' && !d.shot) continue;
    if (a.kind === 'attack' && !d.strike) continue;
    const c = actionCost(u, a);
    if (spent + c > budget) {
      // shrink a trailing move/wait to fit
      if ((a.kind === 'move' || a.kind === 'wait') && budget - spent >= 1) { a.ap = budget - spent; p.actions.push(a); spent = budget; }
      break;
    }
    spent += c;
    p.actions.push(a);
  }
  return p;
}

// CP usage for a set of orders. 1 CP per directly controlled unit; the commander is free.
// Stance changes are free.
export function cpUsage(s, p, orders) {
  const pools = cpPools(s, p);
  let base = pools.base;
  const accepted = [], rejected = [];
  for (const id of Object.keys(orders.units)) {
    const u = s.units.find(x => x.id === id);
    if (!u || u.owner !== p || u.hp <= 0) { rejected.push(id); continue; }
    if (u.type === 'commander') { accepted.push(id); continue; }
    if (base > 0) { base--; accepted.push(id); }
    else rejected.push(id);
  }
  const boostsOk = [];
  for (const bid of orders.boosts || []) { if (base >= CONFIG.cp.boostCost) { base -= CONFIG.cp.boostCost; boostsOk.push(bid); } }
  return {
    totalBase: pools.base, leftBase: base,
    accepted, rejected,
    stanceChanges: stanceChanges(s, p, orders),
    boosts: boostsOk,
  };
}

export function stanceChanges(s, p, orders) {
  const out = [];
  for (const [id, st] of Object.entries(orders.stances || {})) {
    const u = s.units.find(x => x.id === id);
    if (!u || u.owner !== p || u.hp <= 0) continue;
    const anchorChanged = st.anchor && (!u.anchor || dist(st.anchor.x, st.anchor.z, u.anchor.x, u.anchor.z) > 0.01);
    if (st.stance !== u.stance || (anchorChanged && (st.stance === 'advance' || st.stance === 'holdground'))) out.push(id);
  }
  return out;
}

// Can player p place building `type` at x,z?  `pending` = other planned builds this round.
export function canPlace(s, p, type, x, z, pending = []) {
  const def = CONFIG.buildings[type];
  if (!def || type === 'hq') return 'Invalid building';
  const r = def.r;
  if (x < r + 0.5 || z < r + 0.5 || x > s.map.w - r - 0.5 || z > s.map.h - r - 0.5) return 'Too close to the edge';
  const anchors = s.buildings.filter(b => b.owner === p && b.hp > 0 && b.built && (b.type === 'hq' || b.type === 'outpost'));
  if (!anchors.some(b => dist(b.x, b.z, x, z) <= CONFIG.economy.buildRadius)) return 'Must be near your HQ or an Outpost';
  for (const w of s.map.walls) if (inRect(x, z, w, r + 0.3)) return 'Blocked by a wall';
  for (const b of s.buildings) if (b.hp > 0 && dist(b.x, b.z, x, z) < r + CONFIG.buildings[b.type].r + 0.4) return 'Blocked by a building';
  for (const b of pending) if (dist(b.x, b.z, x, z) < r + CONFIG.buildings[b.type].r + 0.4) return 'Overlaps another planned building';
  for (const n of s.map.nodes) if (dist(n.x, n.z, x, z) < r + 1.2) return 'Too close to a resource node';
  return null;
}

// Full validation. Returns sanitized orders (never throws).
export function validateOrders(s, p, orders0) {
  const orders = orders0 || {};
  const out = { units: {}, stances: {}, builds: [], production: [], boosts: [], heals: [], rally: {} };
  const src = { units: orders.units || {}, stances: orders.stances || {}, boosts: orders.boosts || [] };
  // sanitize plans first
  const plans = {};
  for (const [id, plan] of Object.entries(src.units)) {
    const u = s.units.find(x => x.id === id);
    if (!u || u.owner !== p || u.hp <= 0) continue;
    plans[id] = sanitizePlan(u, plan);
  }
  const stances = {};
  for (const [id, st] of Object.entries(src.stances)) {
    if (!st || !['guard', 'hold', 'holdground', 'advance', 'retreat'].includes(st.stance)) continue;
    stances[id] = { stance: st.stance, anchor: st.anchor ? { x: +st.anchor.x, z: +st.anchor.z } : null };
  }
  const use = cpUsage(s, p, { units: plans, stances, boosts: src.boosts });
  for (const id of use.accepted) out.units[id] = plans[id];
  for (const id of use.stanceChanges) out.stances[id] = stances[id];
  // building production boosts
  out.boosts = use.boosts.filter(bid => {
    const b = s.buildings.find(x => x.id === bid);
    return b && b.owner === p && b.built && b.hp > 0 && (b.queue.length || (orders.production || []).some(q => q.building === bid));
  });
  // supply spending
  let supply = s.players[p].supply;
  let army = armyCount(s, p);
  for (const bo of orders.builds || []) {
    const def = CONFIG.buildings[bo.type];
    if (!def || def.cost > supply) continue;
    if (canPlace(s, p, bo.type, bo.x, bo.z, out.builds)) continue;
    supply -= def.cost;
    out.builds.push({ type: bo.type, x: +bo.x, z: +bo.z });
  }
  for (const q of orders.production || []) {
    const b = s.buildings.find(x => x.id === q.building);
    const def = CONFIG.units[q.unit];
    if (!b || !def || b.owner !== p || !b.built || b.hp <= 0) continue;
    if (!CONFIG.buildings[b.type].produces?.includes(q.unit)) continue;
    if (def.cost > supply || army >= CONFIG.economy.armyCap) continue;
    supply -= def.cost; army++;
    out.production.push({ building: b.id, unit: q.unit });
  }
  for (const id of orders.heals || []) {
    const u = s.units.find(x => x.id === id);
    if (!u || u.owner !== p || u.hp <= 0 || u.hp >= u.maxHp || out.heals.includes(id)) continue;
    if (CONFIG.economy.healCost > supply || !nearBase(s, u)) continue;
    supply -= CONFIG.economy.healCost;
    out.heals.push(id);
  }
  for (const [bid, st] of Object.entries(orders.rally || {})) {
    const b = s.buildings.find(x => x.id === bid);
    if (b && b.owner === p && ['guard', 'hold', 'holdground', 'retreat'].includes(st)) out.rally[bid] = st;
  }
  return out;
}

export function nearBase(s, u) {
  return s.buildings.some(b => b.owner === u.owner && b.hp > 0 && b.built && (b.type === 'hq' || b.type === 'outpost')
    && dist(b.x, b.z, u.x, u.z) <= CONFIG.economy.baseRegenRadius);
}

export function supplySpent(s, p, orders) {
  let n = 0;
  for (const bo of orders.builds) n += CONFIG.buildings[bo.type].cost;
  for (const q of orders.production) n += CONFIG.units[q.unit].cost;
  n += orders.heals.length * CONFIG.economy.healCost;
  return n;
}

export function targetName(s, id) {
  const e = findEntity(s, id);
  if (!e) return '?';
  return (e.id[0] === 'u' ? CONFIG.units[e.type].name : CONFIG.buildings[e.type].name);
}
