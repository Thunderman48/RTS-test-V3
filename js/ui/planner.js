// Draft orders for this round + predictions for drawing them.
import { RULES, isMelee, isShooter, skillOf, skillsOf, cdOf } from '../data/units.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { planCost, actionCost, cpUsage, SKILL_KINDS } from '../sim/orders.js';
import { clampAim, engagedWith } from '../sim/resolve.js';
import { Nav, pathAP, walkAP } from '../sim/nav.js';
import { obstacles, navKey, placeError, footprint, armySize, builderCount, BUILDINGS, trainCost, bdef } from '../sim/base.js';
import { builderPlan, builderIdleTarget, gatherTarget } from '../sim/builders.js';
import { gatherRate, hitRadius } from '../sim/base.js';
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
      } else if (a.kind === 'work') {
        // a builder walks to its target, then works there: show the walk and where it ends up
        const tg = this.workTarget(q, a);
        const bp = tg ? builderPlan(this.s, { ...q, x, z }, tg.f, c) : null;
        const line = bp && bp.pts && bp.pts.length ? [{ x, z }, ...bp.pts] : null;
        legs.push({ kind: 'work', ox: x, oz: z, cx: a.x, cz: a.z, line, mode: tg ? tg.mode : null, t0: t, t1: t + c });
        if (bp && bp.end) { const d = norm(a.x - bp.end.x, a.z - bp.end.z); if (d.l > 0.01) { fx = d.x; fz = d.z; } x = bp.end.x; z = bp.end.z; }
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
    if (!plan.hist.length) this.clear(id);
    this.g.changed();
  }
  // clearing a builder's orders also cancels the building it was sent to put up
  clear(id) { delete this.draft.squads[id]; this.draft.builds = this.draft.builds.filter(b => b.by !== id); this.g.changed(); }

  setStance(id, st) {
    const q = this.squad(id);
    if (q.stance === st) delete this.draft.stances[id]; else this.draft.stances[id] = st;
    this.g.changed();
  }
  stanceOf(q) { return this.draft.stances[q.id] || q.stance; }

  // ---- base: builders, queued builds and training ---------------------------------------
  get fac() { return this.s.players[this.g.me].faction; }
  supplyLeft() {
    let v = (this.s.supply || [0, 0])[this.g.me];
    for (const b of this.draft.builds) v -= BUILDINGS[b.type].cost;
    for (const t of this.draft.trains) v -= trainCost(this.fac, t.role);
    return v;
  }
  queued(except = -1) { return this.draft.builds.filter((_, i) => i !== except).map(b => ({ ...b, owner: this.g.me, ...footprint(b.type, b.x, b.z, b.rot) })); }
  buildError(type, x, z, rot = 0, by = null) {
    const own = by ? this.draft.builds.find(b => b.by === by) : null;   // re-placing replaces this builder's build
    const left = this.supplyLeft() + (own ? BUILDINGS[own.type].cost : 0);
    if (BUILDINGS[type].cost > left) return `Needs ${BUILDINGS[type].cost} ${this.g.ecoName()} (you have ${left})`;
    return placeError(this.s, this.g.me, type, x, z, rot, this.queued(own ? this.draft.builds.indexOf(own) : -1));
  }
  // what builder q would do for a building at footprint f: walk, then work with the AP left
  builderPreview(q, f) {
    const bp = builderPlan(this.s, q, f, apFor(q));
    const need = f.build !== undefined ? f.build : BUILDINGS[f.type].work;
    const rounds = bp.work >= need ? 1 : 1 + Math.ceil((need - bp.work) / RULES.ap);
    return { ...bp, need, rounds: bp.actions.length ? rounds : 0 };
  }
  // send builder q to put up a new building (replacing whatever it was told before)
  addBuild(id, type, x, z, rot = 0) {
    const q = this.squad(id);
    const err = this.buildError(type, x, z, rot, id);
    if (err) { this.g.toast(err, true); return false; }
    const f = { type, x, z, rot, ...footprint(type, x, z, rot) };
    const bp = builderPlan(this.s, q, f, apFor(q));
    if (!bp.actions.length) { this.g.toast('The builder can\'t reach that spot', true); return false; }
    this.draft.builds = this.draft.builds.filter(b => b.by !== id);
    this.draft.builds.push({ type, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot: rot ? 1 : 0, by: id });
    this.setBuilderPlan(id, bp.actions);
    return true;
  }
  // what a builder's work order at (a.x, a.z) is aimed at: { f (footprint), mode, b, draft }
  workTarget(q, a) {
    const d = this.draft.builds.find(b => b.by === q.id && Math.hypot(b.x - a.x, b.z - a.z) < 0.6);
    if (d) return { f: { type: d.type, ...footprint(d.type, d.x, d.z, d.rot) }, mode: 'build', draft: d };
    const b = this.s.buildings.find(b => b.owner === q.owner && b.hp > 0 && Math.hypot(b.x - a.x, b.z - a.z) < hitRadius(b) + 0.6);
    if (!b) return null;
    return { f: b, b, mode: b.build > 0 ? 'build' : b.hp < bdef(b).hp ? 'repair' : gatherRate(this.s, b) ? 'gather' : null };
  }
  // send builder q to build / repair / gather at an existing building of ours
  addWork(id, b) {
    const q = this.squad(id);
    const mode = b.build > 0 ? 'build' : b.hp < bdef(b).hp ? 'repair' : gatherRate(this.s, b) ? 'gather' : null;
    if (!mode) { this.g.toast('Nothing to do there: builders finish sites, repair, and gather at ' + this.g.gatherNames(), true); return false; }
    const bp = builderPlan(this.s, q, b, apFor(q));
    if (!bp.actions.length) { this.g.toast('The builder can\'t reach it', true); return false; }
    this.draft.builds = this.draft.builds.filter(x => x.by !== id);
    this.setBuilderPlan(id, bp.actions);
    delete this.draft.stances[id];
    this.g.confirm(q, { build: 'Building', repair: 'Repairing', gather: 'Gathering' }[mode]);
    return true;
  }
  // a builder's next round, in words (its orders, or what it will do on its own)
  builderTask(q) {
    const plan = this.plan(q.id);
    const a = plan && plan.actions.find(x => x.kind === 'work');
    let tg = a ? this.workTarget(q, a) : null, own = !!a;
    if (!tg && !plan) {
      if (this.stanceOf(q) === 'hold') return { text: 'Holding: it stays put and does nothing', mode: 'hold' };
      const b = builderIdleTarget(this.s, q);
      if (!b) return { text: `Idle: build a ${this.g.gatherNames()} and it will gather there`, mode: null };
      tg = { f: b, b, mode: b.build > 0 ? 'build' : b.hp < bdef(b).hp ? 'repair' : 'gather' };
    }
    if (!tg) return { text: plan ? 'Your orders' : 'Idle', mode: null };
    const bp = builderPlan(this.s, q, tg.f, a ? a.ap : apFor(q));
    const name = BUILDINGS[tg.f.type].name[this.fac];
    const pre = own ? '' : 'No orders, so it will ';
    if (tg.mode === 'gather') {
      const n = Math.floor(bp.work / gatherRate(this.s, tg.b));
      return { text: `${pre ? pre + 'gather' : 'Gathering'} at the ${name}: about +${n} ${this.g.ecoName()} this round`, mode: 'gather', name };
    }
    const need = tg.draft ? BUILDINGS[tg.f.type].work : tg.mode === 'build' ? tg.b.build : Math.ceil((bdef(tg.b).hp - tg.b.hp) * bdef(tg.b).work / bdef(tg.b).hp);
    const rounds = bp.work >= need ? 'done this round' : `${1 + Math.ceil((need - bp.work) / RULES.ap)} rounds`;
    const verb = tg.mode === 'repair' ? 'repair' : tg.draft ? 'build' : 'finish';
    return { text: `${pre ? pre + verb : verb[0].toUpperCase() + verb.slice(1) + 'ing'} the ${name}${bp.arrive ? ` (walks ${bp.arrive} AP)` : ''}: ${rounds}`, mode: tg.mode, name };
  }
  gatherAuto(id) {
    const q = this.squad(id), b = gatherTarget(this.s, q);
    if (!b) { this.g.toast('No free spot to gather at: build a ' + this.g.gatherNames(), true); return false; }
    return this.addWork(id, b);
  }
  setBuilderPlan(id, actions) {
    const p = emptyPlan(); p.hist = actions.map(() => 'a');
    p.actions = actions;
    this.draft.squads[id] = p;
    this.g.changed();
  }
  removeBuild(i) { const b = this.draft.builds[i]; this.draft.builds.splice(i, 1); if (b?.by) delete this.draft.squads[b.by]; this.g.changed(); }
  trainOf(bid) { return this.draft.trains.find(t => t.bid === bid) || null; }
  trainError(b, role) {
    const cur = this.trainOf(b.id);
    if (b.build) return 'Still under construction';
    if (b.train) return 'Already training';
    const cost = trainCost(this.fac, role);
    const left = this.supplyLeft() + (cur ? trainCost(this.fac, cur.role) : 0);
    if (cost > left) return `Needs ${cost} ${this.g.ecoName()}`;
    if (!cur && armySize(this.s, this.g.me) + this.draft.trains.length >= this.s.board.cap) return `Army cap reached (${this.s.board.cap} squads)`;
    if (role === 'builder' && builderCount(this.s, this.g.me) + this.draft.trains.filter(t => t.role === 'builder').length >= RULES.maxBuilders) return `At most ${RULES.maxBuilders} builders`;
    return '';
  }
  addTrain(b, role) {
    const cur = this.trainOf(b.id);
    if (cur && cur.role === role) { this.removeTrain(b.id); return true; }
    const err = this.trainError(b, role);
    if (err) { this.g.toast(err, true); return false; }
    if (cur) cur.role = role; else this.draft.trains.push({ bid: b.id, role });
    this.g.changed();
    return true;
  }
  removeTrain(bid) { this.draft.trains = this.draft.trains.filter(t => t.bid !== bid); this.g.changed(); }

  final() {
    const o = JSON.parse(JSON.stringify(this.draft));
    for (const p of Object.values(o.squads)) { delete p.hist; for (const a of p.actions) delete a.disengage; }
    for (const b of o.builds) delete b.by;
    return o;
  }
}
export { dist };
