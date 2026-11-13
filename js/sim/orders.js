// Order costs and validation (shared by the planner UI, the AI and the resolver).
import { RULES, isMelee, isShooter, skillOf, cdOf, SKILL_KINDS as SK } from '../data/units.js';
import { defOf, emptyPlan, apFor } from './state.js';
import { validateBase, bonusCp } from './base.js';

export function upgradeCost(n) { let c = 0; for (let i = 0; i < n; i++) c += RULES.tierCost[i]; return c; }

export function actionCost(q, a) {
  const def = defOf(q);
  switch (a.kind) {
    case 'move': case 'wait': case 'work': return a.ap;
    case 'swing': case 'volley': case 'lob': return def.attack.ap;
    default: { const sk = skillOf(def, a.kind); return sk ? sk.ap : 0; }
  }
}
export const SKILL_KINDS = SK;
export function prepaidCost(plan) { return upgradeCost(plan.upgrades || 0) + (plan.defends || 0) * RULES.defendCost + (plan.parry ? RULES.parryCost : 0) + (plan.overwatch ? RULES.overwatchCost : 0); }
export function planCost(q, plan) { return prepaidCost(plan) + plan.actions.reduce((n, a) => n + actionCost(q, a), 0); }

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

export function sanitizePlan(q, plan) {
  const def = defOf(q);
  const p = emptyPlan();
  p.upgrades = Math.max(0, Math.min(RULES.maxUpgrades, plan.upgrades | 0));
  p.defends = Math.max(0, Math.min(RULES.maxDefends, plan.defends | 0));
  if (plan.parry && def.parry) p.parry = true;
  if (plan.overwatch && isShooter(def)) p.overwatch = { x: num(plan.overwatch.x), z: num(plan.overwatch.z) };
  let used = prepaidCost(p);
  const budget = apFor(q);
  if (used > budget) return emptyPlan();
  const used1 = new Set();          // each skill at most once per round
  for (const a0 of plan.actions || []) {
    let a;
    if (a0.kind === 'move') {
      const pts = (a0.pts || []).slice(0, 24).map(pt => ({ x: num(pt.x), z: num(pt.z) }));
      if (!pts.length) continue;
      a = { kind: 'move', pts, ap: Math.max(1, Math.round(num(a0.ap))) };
    } else if (a0.kind === 'wait') a = { kind: 'wait', ap: Math.max(1, Math.round(num(a0.ap))) };
    else if (a0.kind === 'work' && q.role === 'builder') a = { kind: 'work', x: num(a0.x), z: num(a0.z), ap: Math.max(1, Math.round(num(a0.ap))) };
    else if (a0.kind === def.attack.kind) a = { kind: a0.kind, x: num(a0.x), z: num(a0.z) };
    else if (skillOf(def, a0.kind)) {
      if (used1.has(a0.kind) || cdOf(q, a0.kind) > 0) continue;
      used1.add(a0.kind);
      a = { kind: a0.kind, x: num(a0.x), z: num(a0.z) };
    } else continue;
    const c = actionCost(q, a);
    if (used + c > budget) {
      if ((a.kind === 'move' || a.kind === 'wait' || a.kind === 'work') && budget - used >= 1) { a.ap = budget - used; p.actions.push(a); used = budget; }
      break;
    }
    used += c; p.actions.push(a);
  }
  return p;
}

// Direct control costs 1 CP per squad; the hero and builders are free. Returns accepted ids.
export function cpUsage(s, p, orders) {
  const total = RULES.cp + bonusCp(s, p);
  let left = total;
  const accepted = [], rejected = [];
  for (const id of Object.keys(orders.squads || {})) {
    const q = s.squads.find(x => x.id === id);
    if (!q || q.owner !== p || q.hp <= 0) { rejected.push(id); continue; }
    if (q.role === 'hero' || q.role === 'builder') { accepted.push(id); continue; }
    if (left > 0) { left--; accepted.push(id); } else rejected.push(id);
  }
  return { total, left, accepted, rejected };
}

export function validateOrders(s, p, orders0) {
  const orders = orders0 || {};
  const out = { squads: {}, stances: {}, builds: [], trains: [] };
  if (s.buildings) Object.assign(out, validateBase(s, p, orders.builds || [], orders.trains || []));
  const plans = {};
  for (const [id, plan] of Object.entries(orders.squads || {})) {
    const q = s.squads.find(x => x.id === id);
    if (q && q.owner === p && q.hp > 0) plans[id] = sanitizePlan(q, plan || {});
  }
  for (const id of cpUsage(s, p, { squads: plans }).accepted) out.squads[id] = plans[id];
  for (const [id, st] of Object.entries(orders.stances || {})) {
    const q = s.squads.find(x => x.id === id);
    if (q && q.owner === p && ['guard', 'hold', 'advance'].includes(st)) out.stances[id] = st;
  }
  return out;
}
