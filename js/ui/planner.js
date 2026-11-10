// Client-side planning: the draft orders for this round, plus predictions for drawing them.
import { CONFIG } from '../config.js';
import { dist, norm } from '../sim/geom.js';
import { emptyOrders, emptyPlan, apFor, moveSpeed, findEntity, entRadius, unitDef, skillDef, cdOf } from '../sim/state.js';
import { actionCost, planCost, cpUsage, canPlace, skillsPlanned, SKILL_KINDS, stanceChanges, nearBase } from '../sim/orders.js';
import { pathLength } from '../sim/nav.js';
import { approachAP } from '../sim/stances.js';

export function truncatePath(ax, az, pts, d) {
  const out = [{ x: ax, z: az }];
  let x = ax, z = az;
  for (const p of pts) {
    const s = dist(x, z, p.x, p.z);
    if (s >= d) { const t = s > 0 ? d / s : 0; out.push({ x: x + (p.x - x) * t, z: z + (p.z - z) * t }); return out; }
    d -= s; x = p.x; z = p.z; out.push({ x, z });
  }
  return out;
}

export class Planner {
  constructor(game) { this.g = game; this.draft = emptyOrders(); }
  reset() { this.draft = emptyOrders(); }
  get s() { return this.g.state; }
  get me() { return this.g.me; }

  plan(id) { return this.draft.units[id] || null; }
  unit(id) { return this.s.units.find(u => u.id === id); }

  cp() { return cpUsage(this.s, this.me, this.draft); }

  // CP cost label for directly controlling a unit
  controlCost(u) {
    if (u.type === 'commander') return 'free (hero)';
    if (this.draft.units[u.id]) return 'controlled';
    return '1 CP';
  }
  canControl(u) { return u.type === 'commander' || !!this.draft.units[u.id] || this.cp().leftBase > 0; }

  ensure(id, quiet = false) {
    if (this.draft.units[id]) return this.draft.units[id];
    const u = this.unit(id);
    if (!u) return null;
    const trial = { ...this.draft, units: { ...this.draft.units, [id]: emptyPlan() } };
    const c = cpUsage(this.s, this.me, trial);
    if (!c.accepted.includes(id)) {
      if (!quiet) this.g.toast('No CP left — this unit keeps following its stance', true);
      return null;
    }
    const p = emptyPlan(); p.hist = [];
    this.draft.units[id] = p;
    return p;
  }

  // Take direct control (spends CP). The plan is kept even while empty.
  control(id) {
    const p = this.ensure(id);
    if (p) { p.keep = true; this.g.changed(); }
    return !!p;
  }

  apLeft(u, plan = this.plan(u.id)) { return apFor(u) - (plan ? planCost(u, plan) : 0); }

  // Predict where a unit ends up, and the legs to draw.
  predict(u, plan) {
    const nav = this.g.nav;
    const sp = moveSpeed(u.type);
    let x = u.x, z = u.z;
    const legs = [];
    for (const a of plan.actions) {
      if (a.kind === 'move') {
        const t = a.follow ? findEntity(this.s, a.follow) : null;
        const tx = t ? t.x : a.x, tz = t ? t.z : a.z;
        const pts = nav.path(x, z, tx, tz);
        const line = truncatePath(x, z, pts, a.ap * sp);
        legs.push({ kind: 'move', pts: line, target: { x: tx, z: tz }, follow: !!t });
        ({ x, z } = line[line.length - 1]);
      } else if (a.kind === 'attack' || a.kind === 'shove') {
        const t = findEntity(this.s, a.target);
        if (!t) continue;
        const reach = CONFIG.unitRadius + entRadius(t) + CONFIG.meleeReach - 0.1;
        const pts = nav.path(x, z, t.x, t.z);
        const total = pathLength(x, z, pts);
        const need = Math.max(0, total - reach);
        const line = truncatePath(x, z, pts, Math.min(need, a.moveAp * sp));
        legs.push({ kind: a.kind, pts: line, target: { x: t.x, z: t.z }, reached: a.moveAp * sp >= need - 0.05 });
        ({ x, z } = line[line.length - 1]);
      } else if (a.kind === 'shoot') {
        const d = norm(a.x - x, a.z - z);
        const rg = unitDef(u).shot.range;
        legs.push({ kind: 'shoot', from: { x, z }, to: { x: x + d.x * rg, z: z + d.z * rg }, aim: { x: a.x, z: a.z } });
      } else if (a.kind === 'sweep') {
        legs.push({ kind: 'sweep', at: { x, z }, r: skillDef(u.type, 'sweep').radius });
      } else if (a.kind === 'frag') {
        const sk = skillDef(u.type, 'frag');
        const d = norm(a.x - x, a.z - z);
        const l = Math.min(d.l, sk.range);
        legs.push({ kind: 'frag', from: { x, z }, at: { x: x + d.x * l, z: z + d.z * l }, r: sk.radius });
      } else if (a.kind === 'dash') {
        const d = norm(a.x - x, a.z - z);
        const L = skillDef(u.type, 'dash').length;
        let tx = x, tz = z;
        for (let s = 0.1; s <= L + 1e-6; s += 0.1) {
          const nx = x + d.x * s, nz = z + d.z * s;
          if (!nav.free(nx, nz)) break;
          tx = nx; tz = nz;
        }
        legs.push({ kind: 'dash', pts: [{ x, z }, { x: tx, z: tz }] });
        x = tx; z = tz;
      } else if (a.kind === 'disrupt') {
        const t = findEntity(this.s, a.target);
        if (t) legs.push({ kind: 'disrupt', from: { x, z }, to: { x: t.x, z: t.z } });
      }
    }
    return { x, z, legs };
  }

  // ---- order building ----------------------------------------------------------
  addAction(id, a) {
    const u = this.unit(id);
    const plan = this.ensure(id);
    if (!plan) return false;
    if (SKILL_KINDS.includes(a.kind)) {
      const k = skillDef(u.type, a.kind);
      if (cdOf(u, a.kind) > 0) { this.g.toast(`${k.name} is on cooldown (${cdOf(u, a.kind)} rounds)`, true); return false; }
      if (skillsPlanned(plan).has(a.kind)) { this.g.toast(`${k.name} is already planned this round`, true); return false; }
    }
    const cost = actionCost(u, a);
    const left = this.apLeft(u, plan);
    if (cost > left) {
      if ((a.kind === 'move' || a.kind === 'wait') && left >= 1) a.ap = left;
      else { this.g.toast(`Not enough AP (${cost} needed, ${left} left)`, true); this.cleanup(id); return false; }
    }
    plan.actions.push(a);
    plan.hist.push('a');
    this.g.changed();
    this.g.emit?.('order', { id, kind: a.kind });
    return true;
  }

  orderMove(id, x, z, follow = null) {
    const u = this.unit(id);
    const plan = this.plan(id) || emptyPlan();
    const from = this.predict(u, plan);
    const t = follow ? findEntity(this.s, follow) : null;
    const tx = t ? t.x : x, tz = t ? t.z : z;
    const pts = this.g.nav.path(from.x, from.z, tx, tz);
    const need = Math.max(1, Math.ceil(pathLength(from.x, from.z, pts) / moveSpeed(u.type)) - (t ? Math.floor(1.1 / moveSpeed(u.type)) : 0));
    const left = this.apLeft(u, this.plan(id));
    if (left < 1) { this.g.toast('No AP left for this unit', true); return false; }
    const a = { kind: 'move', ap: Math.max(1, Math.min(need, left)) };
    if (t) a.follow = t.id; else { a.x = x; a.z = z; }
    return this.addAction(id, a);
  }

  orderAttack(id, targetId, kind = 'attack') {
    const u = this.unit(id);
    const def = unitDef(u);
    const t = findEntity(this.s, targetId);
    if (!t) return false;
    const plan = this.plan(id) || emptyPlan();
    const from = this.predict(u, plan);
    const reach = CONFIG.unitRadius + entRadius(t) + CONFIG.meleeReach - 0.1;
    const need = approachAP(this.g.nav, { ...u, x: from.x, z: from.z }, t.x, t.z, reach) + 4;
    const strike = kind === 'shove' ? skillDef(u.type, 'shove').ap : def.strike.ap;
    const left = this.apLeft(u, this.plan(id));
    if (left < strike) { this.g.toast(`Not enough AP (${strike} needed to strike)`, true); return false; }
    const moveAp = Math.max(0, Math.min(need, left - strike));
    if (moveAp < need - 4) this.g.toast('Target may be out of reach this round — AP for approach is short');
    return this.addAction(id, { kind, target: t.id, moveAp });
  }

  orderPoint(id, kind, x, z) { return this.addAction(id, { kind, x, z }); }
  orderTarget(id, kind, targetId) { return this.addAction(id, { kind, target: targetId }); }

  prepaid(id, field, delta) {
    const u = this.unit(id);
    const def = unitDef(u);
    const plan = this.ensure(id);
    if (!plan) return false;
    const before = JSON.stringify(plan);
    if (field === 'upgrades') plan.upgrades = Math.max(0, Math.min(CONFIG.maxTierUpgrades, plan.upgrades + delta));
    if (field === 'defends') plan.defends = Math.max(0, Math.min(CONFIG.maxExtraDefends, plan.defends + delta));
    if (field === 'overwatch') plan.overwatch = Math.max(0, Math.min(CONFIG.maxOverwatch, plan.overwatch + delta));
    if (field === 'parry') plan.parry = !plan.parry;
    if (field.startsWith('buff:')) {
      const id = field.slice(5);
      const k = skillDef(u.type, id);
      const i = plan.buffs.indexOf(id);
      if (i >= 0) plan.buffs.splice(i, 1);
      else {
        if (cdOf(u, id) > 0) { this.g.toast(`${k.name} is on cooldown (${cdOf(u, id)} rounds)`, true); return false; }
        plan.buffs.push(id);
      }
    }
    if (planCost(u, plan) > apFor(u)) {
      Object.assign(plan, JSON.parse(before));
      this.g.toast('Not enough AP', true);
      return false;
    }
    if (JSON.stringify(plan) !== before) { plan.hist.push(field + (delta < 0 ? '-' : '')); }
    void def;
    this.g.changed();
    return true;
  }

  undo(id) {
    const plan = this.plan(id);
    if (!plan) return;
    const h = plan.hist.pop();
    if (h === 'a') plan.actions.pop();
    else if (h === 'upgrades') plan.upgrades--;
    else if (h === 'defends') plan.defends--;
    else if (h === 'overwatch') plan.overwatch--;
    else if (h === 'parry') plan.parry = !plan.parry;
    else if (h && h.startsWith('buff:')) { const id = h.slice(5); const i = plan.buffs.indexOf(id); if (i >= 0) plan.buffs.splice(i, 1); else plan.buffs.push(id); }
    else if (h && h.endsWith('-')) { const f = h.slice(0, -1); if (f in plan) plan[f]++; }
    this.cleanup(id);
    this.g.changed();
  }

  cleanup(id) {
    const p = this.plan(id);
    if (p && !p.keep && !p.actions.length && !p.upgrades && !p.defends && !p.overwatch && !p.parry && !p.buffs.length) delete this.draft.units[id];
  }

  clear(id) { delete this.draft.units[id]; this.g.changed(); }

  // adjust AP of last move / attack approach / wait
  setLastAP(id, v) {
    const u = this.unit(id), plan = this.plan(id);
    if (!plan || !plan.actions.length) return;
    const a = plan.actions[plan.actions.length - 1];
    const others = planCost(u, plan) - actionCost(u, a);
    const max = apFor(u) - others;
    if (a.kind === 'move' || a.kind === 'wait') a.ap = Math.max(1, Math.min(max, v));
    else if (a.kind === 'attack' || a.kind === 'shove') {
      const strike = a.kind === 'shove' ? skillDef(u.type, 'shove').ap : unitDef(u).strike.ap;
      a.moveAp = Math.max(0, Math.min(max - strike, v));
    }
    this.g.changed(true);
  }

  setStance(ids, stance, anchor) {
    for (const id of ids) {
      const u = this.unit(id);
      if (!u) continue;
      const st = { stance, anchor: anchor ? { x: anchor.x, z: anchor.z } : (stance === 'holdground' ? { x: u.x, z: u.z } : null) };
      if (stance === u.stance && stance !== 'advance' && stance !== 'holdground') delete this.draft.stances[id];
      else this.draft.stances[id] = st;
    }
    this.g.changed();
  }

  pendingStance(u) { return this.draft.stances[u.id]?.stance || u.stance; }

  addBuild(type, x, z) {
    const def = CONFIG.buildings[type];
    const err = canPlace(this.s, this.me, type, x, z, this.draft.builds);
    if (err) { this.g.toast(err, true); return false; }
    if (this.supplyLeft() < def.cost) { this.g.toast('Not enough supply', true); return false; }
    this.draft.builds.push({ type, x, z });
    this.g.changed();
    return true;
  }
  removeBuild(i) { this.draft.builds.splice(i, 1); this.g.changed(); }

  addProduction(bid, unit) {
    const def = CONFIG.units[unit];
    if (this.supplyLeft() < def.cost) { this.g.toast('Not enough supply', true); return false; }
    const army = this.s.units.filter(u => u.owner === this.me && u.type !== 'commander').length
      + this.s.buildings.filter(b => b.owner === this.me).reduce((n, b) => n + b.queue.length, 0) + this.draft.production.length;
    if (army >= CONFIG.economy.armyCap) { this.g.toast(`Army cap reached (${CONFIG.economy.armyCap})`, true); return false; }
    this.draft.production.push({ building: bid, unit });
    this.g.changed();
    return true;
  }
  removeProduction(i) { this.draft.production.splice(i, 1); this.g.changed(); }

  toggleBoost(bid) {
    const i = this.draft.boosts.indexOf(bid);
    if (i >= 0) this.draft.boosts.splice(i, 1);
    else {
      this.draft.boosts.push(bid);
      const c = this.cp();
      if (!c.boosts.includes(bid)) { this.draft.boosts.pop(); this.g.toast('Not enough CP to boost', true); return; }
    }
    this.g.changed();
  }

  toggleHeal(id) {
    const i = this.draft.heals.indexOf(id);
    if (i >= 0) this.draft.heals.splice(i, 1);
    else {
      const u = this.unit(id);
      if (!nearBase(this.s, u)) { this.g.toast('Must be near your HQ or an Outpost', true); return; }
      if (this.supplyLeft() < CONFIG.economy.healCost) { this.g.toast('Not enough supply', true); return; }
      this.draft.heals.push(id);
    }
    this.g.changed();
  }

  setRally(bid, st) { this.draft.rally[bid] = st; this.g.changed(); }

  supplyLeft() {
    let n = this.s.players[this.me].supply;
    for (const b of this.draft.builds) n -= CONFIG.buildings[b.type].cost;
    for (const q of this.draft.production) n -= CONFIG.units[q.unit].cost;
    n -= this.draft.heals.length * CONFIG.economy.healCost;
    return n;
  }

  stanceChangeCount() { return stanceChanges(this.s, this.me, this.draft).length; }

  // Orders sent to the resolver (strip UI-only fields)
  final() {
    const o = JSON.parse(JSON.stringify(this.draft));
    for (const p of Object.values(o.units)) { delete p.hist; delete p.keep; }
    return o;
  }
}
