// Order costs and validation (shared by the planner UI, the AI and the resolver).
import { RULES } from '../data/units.js';
import { defOf, emptyPlan, apFor } from './state.js';

export function upgradeCost(n) { let c = 0; for (let i = 0; i < n; i++) c += RULES.tierCost[i]; return c; }

export function actionCost(q, a) {
  const def = defOf(q);
  switch (a.kind) {
    case 'move': case 'wait': return a.ap;
    case 'swing': case 'volley': return def.attack.ap;
    default: return 0;
  }
}
export function prepaidCost(plan) { return upgradeCost(plan.upgrades || 0) + (plan.defends || 0) * RULES.defendCost; }
export function planCost(q, plan) { return prepaidCost(plan) + plan.actions.reduce((n, a) => n + actionCost(q, a), 0); }

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

export function sanitizePlan(q, plan) {
  const def = defOf(q);
  const p = emptyPlan();
  p.upgrades = Math.max(0, Math.min(RULES.maxUpgrades, plan.upgrades | 0));
  p.defends = Math.max(0, Math.min(RULES.maxDefends, plan.defends | 0));
  let used = prepaidCost(p);
  const budget = apFor(q);
  if (used > budget) return emptyPlan();
  for (const a0 of plan.actions || []) {
    let a;
    if (a0.kind === 'move') {
      const pts = (a0.pts || []).slice(0, 24).map(pt => ({ x: num(pt.x), z: num(pt.z) }));
      if (!pts.length) continue;
      a = { kind: 'move', pts, ap: Math.max(1, Math.round(num(a0.ap))) };
    } else if (a0.kind === 'wait') a = { kind: 'wait', ap: Math.max(1, Math.round(num(a0.ap))) };
    else if (a0.kind === def.attack.kind) a = { kind: a0.kind, x: num(a0.x), z: num(a0.z) };
    else continue;
    const c = actionCost(q, a);
    if (used + c > budget) {
      if ((a.kind === 'move' || a.kind === 'wait') && budget - used >= 1) { a.ap = budget - used; p.actions.push(a); used = budget; }
      break;
    }
    used += c; p.actions.push(a);
  }
  return p;
}

// Direct control costs 1 CP per squad; the hero is free. Returns accepted ids.
export function cpUsage(s, p, orders) {
  let left = RULES.cp;
  const accepted = [], rejected = [];
  for (const id of Object.keys(orders.squads || {})) {
    const q = s.squads.find(x => x.id === id);
    if (!q || q.owner !== p || q.hp <= 0) { rejected.push(id); continue; }
    if (q.role === 'hero') { accepted.push(id); continue; }
    if (left > 0) { left--; accepted.push(id); } else rejected.push(id);
  }
  return { total: RULES.cp, left, accepted, rejected };
}

export function validateOrders(s, p, orders0) {
  const orders = orders0 || {};
  const out = { squads: {}, stances: {} };
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
