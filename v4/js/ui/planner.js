// Draft orders for this round + predictions for drawing them.
import { RULES, isMelee, isShooter, skillOf, skillsOf, cdOf } from '../data/units.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { planCost, actionCost, cpUsage, SKILL_KINDS } from '../sim/orders.js';
import { clampAim, engagedWith } from '../sim/resolve.js';
import { Nav, pathAP, walkAP } from '../sim/nav.js';
import { obstacles, navKey } from '../sim/base.js';
import { norm, segCircle, dist } from '../sim/geom.js';

export class Planner {
  constructor(g) { this.g = g; this.reset(); }
  reset() { this.draft = emptyOrders(); }
  get s() { return this.g.state; }
  squad(id) { return this.s.squads.find(q => q.id === id); }
  plan(id) { return this.draft.squads[id] || null; }
  cp() { return cpUsage(this.s, this.g.me, this.draft); }
  apLeft(q) { const p = this.plan(q.id); return apFor(q) - (p ? planCost(q, p) : 0); }
  skillUsed(id, kind) { const p = this.plan(id); return !!p && p.actions.some(a => a.kind === kind); }
  skillReady(q, kind) { return !!skillOf(defOf(q), kind) && cdOf(q, kind) === 0 && !this.skillUsed(q.id, kind); }
  enemies(q) { return this.s.squads.filter(e => e.owner !== q.owner && e.hp > 0 && (!this.g.canSeeEnemy || this.g.canSeeEnemy(e.id))); }

  // Take control (1 CP, hero free). Returns the plan or null.
  ensure(id) {
    if (this.draft.squads[id]) return this.draft.squads[id];
    const trial = { squads: { ...this.draft.squads, [id]: emptyPlan() } };
    if (!cpUsage(this.s, this.g.me, trial).accepted.includes(id)) {
      this.g.toast(`No command points left (${RULES.cp} per round). This squad keeps its stance.`, true);
      return null;
    }
    const p = emptyPlan(); p.hist = [];
    this.draft.squads[id] = p;
    return p;
  }

  // the charge lane from (ox,oz) toward (x,z): where it stops and who it hits (enemies where they stand now)
  chargeLane(q, ox, oz, x, z) {
    const sk = skillOf(defOf(q), 'charge'), d = norm(x - ox, z - oz);
    const dx = d.l > 0.01 ? d.x : q.fx, dz = d.l > 0.01 ? d.z : q.fz;
    const ex = ox + dx * sk.len, ez = oz + dz * sk.len;
    let hit = null, ht = 2;
    for (const e of this.enemies(q)) {
      const t = segCircle(ox, oz, ex, ez, e.x, e.z, radiusOf(q) + radiusOf(e));
      if (t >= 0 && t < ht) { ht = t; hit = e; }
    }
    const t = hit ? Math.max(0, ht - 0.01) : 1;
    return { dx, dz, len: sk.len, w: radiusOf(q) * 2, hit, x: ox + (ex - ox) * t, z: oz + (ez - oz) * t };
  }

  // Where the squad is after its planned actions, plus drawable legs
  predict(q, plan = this.plan(q.id)) {
    const def = defOf(q);
    let x = q.x, z = q.z, fx = q.fx, fz = q.fz, t = 0;
    const legs = [];
    if (plan && plan.overwatch) { const d = norm(plan.overwatch.x - x, plan.overwatch.z - z); if (d.l > 0.01) { fx = d.x; fz = d.z; } legs.push({ kind: 'overwatch', ox: x, oz: z, dx: fx, dz: fz, R: def.attack.range, ch: RULES.overwatchCos }); }
    for (const a of (plan ? plan.actions : [])) {
      const c = actionCost(q, a);
      if (a.kind === 'move') {
        const w = walkAP(this.s.terrain, x, z, a.pts, a.ap - (a.disengage ? RULES.disengageAP : 0), def.tier);
        const last = w.line[w.line.length - 1], prev = w.line[w.line.length - 2] || { x, z };
        const d = norm(last.x - prev.x, last.z - prev.z);
        if (d.l > 1e-3) { fx = d.x; fz = d.z; }
        legs.push({ kind: 'move', line: w.line, t0: t, t1: t + c, disengage: !!a.disengage });
        x = w.x; z = w.z;
      } else if (a.kind === 'swing' || a.kind === 'volley') {
        const d = norm(a.x - x, a.z - z);
        if (d.l > 0.01) { fx = d.x; fz = d.z; }
        legs.push({ kind: a.kind, ox: x, oz: z, dx: fx, dz: fz, t0: t, t1: t + c, R: radiusOf(q) + (def.attack.reach || 0), ch: def.attack.cosHalf, len: def.attack.range, w: def.attack.width });
      } else if (a.kind === 'lob' || a.kind === 'blast' || a.kind === 'storm') {
        const sk = skillOf(def, a.kind);
        const range = a.kind === 'lob' ? def.attack.range : sk.range;
        const c2 = clampAim(x, z, a.x, a.z, range);
        const d = norm(c2.x - x, c2.z - z);
        if (d.l > 0.01) { fx = d.x; fz = d.z; }
        legs.push({ kind: a.kind, ox: x, oz: z, cx: c2.x, cz: c2.z, R: a.kind === 'lob' ? def.attack.radius : sk.radius, range, t0: t, t1: t + c });
      } else if (a.kind === 'rally' || a.kind === 'raise') {
        legs.push({ kind: a.kind, cx: x, cz: z, R: skillOf(def, a.kind).radius, t0: t, t1: t + c });
      } else if (a.kind === 'sweep') {
        legs.push({ kind: 'sweep', ox: x, oz: z, dx: fx, dz: fz, R: radiusOf(q) + skillOf(def, 'sweep').reach, ch: -1, t0: t, t1: t + c });
      } else if (a.kind === 'wall') {
        legs.push({ kind: 'wall', ox: x, oz: z, dx: fx, dz: fz, R: radiusOf(q) + 0.6, ch: 0.5, t0: t, t1: t + c });
      } else if (a.kind === 'pierce') {
        const sk = skillOf(def, 'pierce'), d = norm(a.x - x, a.z - z);
        if (d.l > 0.01) { fx = d.x; fz = d.z; }
        legs.push({ kind: 'pierce', ox: x, oz: z, dx: fx, dz: fz, len: sk.range, w: sk.width, t0: t, t1: t + c });
      } else if (a.kind === 'leap' || a.kind === 'step') {
        const sk = skillOf(def, a.kind), c2 = clampAim(x, z, a.x, a.z, sk.range);
        const d = norm(c2.x - x, c2.z - z);
        if (d.l > 0.01) { fx = d.x; fz = d.z; }
        legs.push({ kind: a.kind, ox: x, oz: z, cx: c2.x, cz: c2.z, range: sk.range, t0: t, t1: t + c });
        x = c2.x; z = c2.z;
      } else if (a.kind === 'charge') {
        const ln = this.chargeLane(q, x, z, a.x, a.z);
        fx = ln.dx; fz = ln.dz;
        legs.push({ kind: 'charge', ox: x, oz: z, dx: ln.dx, dz: ln.dz, len: ln.len, w: ln.w, hit: ln.hit, ex: ln.x, ez: ln.z, t0: t, t1: t + c });
        x = ln.x; z = ln.z;
      }
      t += c;
    }
    return { x, z, fx, fz, t, legs };
  }

  // engaged at a position (enemies where they stand now)?
  engagedAt(q, x, z) { return engagedWith({ ...q, x, z }, this.s.squads); }

  // Path from the squad's planned end point to (tx,tz), cut to the AP left.
  previewMove(q, tx, tz) {
    const def = defOf(q);
    const from = this.predict(q);
    const nav = Nav.for(obstacles(this.s), radiusOf(q), navKey(this.s));
    const pts = nav.path(from.x, from.z, tx, tz);
    // stepping away from an engaged enemy: 30 AP to disengage first
    let disengage = false;
    if (pts.length) {
      const d = norm(pts[0].x - from.x, pts[0].z - from.z);
      disengage = this.engagedAt(q, from.x, from.z).some(e => (e.x - from.x) * d.x + (e.z - from.z) * d.z < 0);
    }
    const extra = disengage ? RULES.disengageAP : 0;
    const need = pathAP(this.s.terrain, from.x, from.z, pts, def.tier) + extra;
    const left = this.plan(q.id) ? this.apLeft(q) : apFor(q);
    const ap = Math.max(1, Math.min(left, Math.ceil(need)));
    const w = walkAP(this.s.terrain, from.x, from.z, pts, Math.max(0, ap - extra), def.tier);
    let inches = 0;
    for (let i = 1; i < w.line.length; i++) inches += Math.hypot(w.line[i].x - w.line[i - 1].x, w.line[i].z - w.line[i - 1].z);
    return { from, pts, need: Math.ceil(need), ap, left, line: w.line, end: { x: w.x, z: w.z }, inches, short: need > left + 0.5, disengage };
  }

  addMove(id, tx, tz) {
    const q = this.squad(id);
    const pv = this.previewMove(q, tx, tz);
    if (pv.left < 1) { this.g.toast('No AP left for this squad', true); return false; }
    const plan = this.ensure(id); if (!plan) return false;
    plan.actions.push({ kind: 'move', pts: pv.pts, ap: pv.ap, disengage: pv.disengage });
    plan.hist.push('a');
    if (pv.disengage) this.g.toast('Disengaging costs 30 AP and gives the enemy a parting blow');
    else if (pv.short) this.g.toast(`Out of reach this round: it stops after ${pv.inches.toFixed(1)}″`);
    this.g.confirm(q, pv.disengage ? 'Disengage' : `Move ${pv.inches.toFixed(1)}″`);
    this.g.changed();
    return true;
  }

  addAttack(id, x, z) {
    const q = this.squad(id), def = defOf(q);
    if (this.plan(id) && this.apLeft(q) < def.attack.ap) { this.g.toast(`Not enough AP (${def.attack.ap} needed)`, true); return false; }
    const plan = this.ensure(id); if (!plan) return false;
    if (this.apLeft(q) < def.attack.ap) { this.g.toast(`Not enough AP (${def.attack.ap} needed)`, true); return false; }
    plan.actions.push({ kind: def.attack.kind, x, z });
    plan.hist.push('a');
    this.g.confirm(q, { swing: 'Swing', volley: 'Volley', lob: 'Lob' }[def.attack.kind]);
    this.g.changed();
    return true;
  }

  addSkill(id, kind, x, z) {
    const q = this.squad(id), sk = skillOf(defOf(q), kind);
    if (!sk) return false;
    const cd = cdOf(q, kind);
    if (cd > 0) { this.g.toast(`${sk.name} is recharging (${cd} round${cd > 1 ? 's' : ''})`, true); return false; }
    if (this.skillUsed(id, kind)) { this.g.toast(`${sk.name} can be used once per round`, true); return false; }
    if (this.plan(id) && this.apLeft(q) < sk.ap) { this.g.toast(`Not enough AP (${sk.ap} needed)`, true); return false; }
    const plan = this.ensure(id); if (!plan) return false;
    if (this.apLeft(q) < sk.ap) { this.g.toast(`Not enough AP (${sk.ap} needed)`, true); return false; }
    plan.actions.push({ kind: sk.kind, x, z });
    plan.hist.push('a');
    this.g.confirm(q, sk.name + '!');
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
    const q = this.squad(id), def = defOf(q);
    const plan = this.ensure(id); if (!plan) return false;
    if (field === 'parry') {
      if (!def.parry) return false;
      if (plan.parry) { this.g.toast('Parry is already prepared', true); return false; }
      if (this.apLeft(q) < RULES.parryCost) { this.g.toast(`Not enough AP (${RULES.parryCost} needed)`, true); return false; }
      plan.parry = true; plan.hist.push('parry');
      this.g.confirm(q, 'Parry ready'); this.g.changed();
      return true;
    }
    const cost = field === 'defends' ? RULES.defendCost : RULES.tierCost[plan.upgrades] || 999;
    if (field === 'defends' && plan.defends >= RULES.maxDefends) { this.g.toast('Max defends', true); return false; }
    if (field === 'upgrades' && plan.upgrades >= RULES.maxUpgrades) { this.g.toast('Already acting as early as possible', true); return false; }
    if (this.apLeft(q) < cost) { this.g.toast(`Not enough AP (${cost} needed)`, true); return false; }
    plan[field]++; plan.hist.push(field);
    this.g.confirm(q, field === 'defends' ? '+1 Defend' : 'Act earlier');
    this.g.changed();
    return true;
  }

  setOverwatch(id, x, z) {
    const q = this.squad(id);
    if (!isShooter(defOf(q))) return false;
    const plan = this.ensure(id); if (!plan) return false;
    if (!plan.overwatch && this.apLeft(q) < RULES.overwatchCost) { this.g.toast(`Not enough AP (${RULES.overwatchCost} needed)`, true); return false; }
    if (!plan.overwatch) plan.hist.push('overwatch');
    plan.overwatch = { x, z };
    this.g.confirm(q, 'Overwatch');
    this.g.changed();
    return true;
  }

  undo(id) {
    const plan = this.plan(id); if (!plan) return;
    const h = plan.hist.pop();
    if (h === 'a') plan.actions.pop();
    else if (h === 'parry') plan.parry = false;
    else if (h === 'overwatch') plan.overwatch = null;
    else if (h) plan[h]--;
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
    for (const p of Object.values(o.squads)) { delete p.hist; for (const a of p.actions) delete a.disengage; }
    return o;
  }
}
export { dist };
