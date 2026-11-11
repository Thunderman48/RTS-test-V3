// Draft orders for this round + predictions for drawing them.
import { RULES } from '../data/units.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { planCost, actionCost, cpUsage } from '../sim/orders.js';
import { Nav, pathAP, walkAP } from '../sim/nav.js';
import { norm } from '../sim/geom.js';

export class Planner {
  constructor(g) { this.g = g; this.reset(); }
  reset() { this.draft = emptyOrders(); }
  get s() { return this.g.state; }
  squad(id) { return this.s.squads.find(q => q.id === id); }
  plan(id) { return this.draft.squads[id] || null; }
  cp() { return cpUsage(this.s, this.g.me, this.draft); }
  apLeft(q) { const p = this.plan(q.id); return apFor(q) - (p ? planCost(q, p) : 0); }

  // Take control (1 CP, hero free). Returns the plan or null.
  ensure(id) {
    if (this.draft.squads[id]) return this.draft.squads[id];
    const q = this.squad(id);
    const trial = { squads: { ...this.draft.squads, [id]: emptyPlan() } };
    if (!cpUsage(this.s, this.g.me, trial).accepted.includes(id)) {
      this.g.toast(`No command points left (${RULES.cp} per round). This squad keeps its stance.`, true);
      return null;
    }
    const p = emptyPlan(); p.hist = [];
    this.draft.squads[id] = p;
    void q;
    return p;
  }

  // Where the squad is after its planned actions, plus drawable legs
  predict(q, plan = this.plan(q.id)) {
    const def = defOf(q);
    let x = q.x, z = q.z, fx = q.fx, fz = q.fz, t = 0;
    const legs = [];
    for (const a of (plan ? plan.actions : [])) {
      const c = actionCost(q, a);
      if (a.kind === 'move') {
        const w = walkAP(this.s.terrain, x, z, a.pts, a.ap, def.tier);
        const last = w.line[w.line.length - 1], prev = w.line[w.line.length - 2] || { x, z };
        const d = norm(last.x - prev.x, last.z - prev.z);
        if (d.l > 1e-3) { fx = d.x; fz = d.z; }
        legs.push({ kind: 'move', line: w.line, t0: t, t1: t + c });
        x = w.x; z = w.z;
      } else if (a.kind === 'swing' || a.kind === 'volley') {
        const d = norm(a.x - x, a.z - z);
        if (d.l > 0.01) { fx = d.x; fz = d.z; }
        legs.push({ kind: a.kind, ox: x, oz: z, dx: fx, dz: fz, t0: t, t1: t + c, R: radiusOf(q) + (def.attack.reach || 0), ch: def.attack.cosHalf, len: def.attack.range, w: def.attack.width });
      }
      t += c;
    }
    return { x, z, fx, fz, t, legs };
  }

  // Path from the squad's planned end point to (tx,tz), cut to the AP left.
  previewMove(q, tx, tz) {
    const def = defOf(q);
    const from = this.predict(q);
    const nav = Nav.for(this.s.terrain, radiusOf(q), 'r');
    const pts = nav.path(from.x, from.z, tx, tz);
    const need = pathAP(this.s.terrain, from.x, from.z, pts, def.tier);
    const left = this.plan(q.id) ? this.apLeft(q) : apFor(q);
    const ap = Math.max(1, Math.min(left, Math.ceil(need)));
    const w = walkAP(this.s.terrain, from.x, from.z, pts, ap, def.tier);
    let inches = 0;
    for (let i = 1; i < w.line.length; i++) inches += Math.hypot(w.line[i].x - w.line[i - 1].x, w.line[i].z - w.line[i - 1].z);
    return { from, pts, need: Math.ceil(need), ap, left, line: w.line, end: { x: w.x, z: w.z }, inches, short: need > left + 0.5 };
  }

  addMove(id, tx, tz) {
    const q = this.squad(id);
    const pv = this.previewMove(q, tx, tz);
    if (pv.left < 1) { this.g.toast('No AP left for this squad', true); return false; }
    const plan = this.ensure(id); if (!plan) return false;
    plan.actions.push({ kind: 'move', pts: pv.pts, ap: pv.ap });
    plan.hist.push('a');
    if (pv.short) this.g.toast(`Out of reach this round: it stops after ${pv.inches.toFixed(1)}″`);
    this.g.changed();
    return true;
  }

  addAttack(id, x, z) {
    const q = this.squad(id), def = defOf(q);
    if (this.apLeft(q) < def.attack.ap && this.plan(id)) { this.g.toast(`Not enough AP (${def.attack.ap} needed)`, true); return false; }
    const plan = this.ensure(id); if (!plan) return false;
    if (this.apLeft(q) < def.attack.ap) { this.g.toast(`Not enough AP (${def.attack.ap} needed)`, true); return false; }
    plan.actions.push({ kind: def.attack.kind, x, z });
    plan.hist.push('a');
    this.g.changed();
    return true;
  }

  addWait(id, ap = 10) {
    const q = this.squad(id);
    const plan = this.ensure(id); if (!plan) return false;
    const a = Math.min(ap, this.apLeft(q));
    if (a < 1) { this.g.toast('No AP left', true); return false; }
    plan.actions.push({ kind: 'wait', ap: a }); plan.hist.push('a');
    this.g.changed();
    return true;
  }

  prepaid(id, field) {
    const q = this.squad(id);
    const plan = this.ensure(id); if (!plan) return false;
    const cost = field === 'defends' ? RULES.defendCost : RULES.tierCost[plan.upgrades] || 999;
    if (field === 'defends' && plan.defends >= RULES.maxDefends) { this.g.toast('Max defends', true); return false; }
    if (field === 'upgrades' && plan.upgrades >= RULES.maxUpgrades) { this.g.toast('Already acting as early as possible', true); return false; }
    if (this.apLeft(q) < cost) { this.g.toast(`Not enough AP (${cost} needed)`, true); return false; }
    plan[field]++; plan.hist.push(field);
    this.g.changed();
    return true;
  }

  undo(id) {
    const plan = this.plan(id); if (!plan) return;
    const h = plan.hist.pop();
    if (h === 'a') plan.actions.pop(); else if (h) plan[h]--;
    if (!plan.hist.length) delete this.draft.squads[id];
    this.g.changed();
  }
  clear(id) { delete this.draft.squads[id]; this.g.changed(); }

  setStance(id, st) {
    const q = this.squad(id);
    if (q.stance === st) delete this.draft.stances[id]; else this.draft.stances[id] = st;
    this.g.changed();
  }
  stanceOf(q) { return this.draft.stances[q.id] || q.stance; }

  final() {
    const o = JSON.parse(JSON.stringify(this.draft));
    for (const p of Object.values(o.squads)) delete p.hist;
    return o;
  }
}
