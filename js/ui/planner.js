// Draft orders for this round + predictions for drawing them.
import { RULES, isMelee, isShooter, skillOf, skillsOf, cdOf, isMage, trainsOf } from '../data/units.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { planCost, actionCost, cpUsage, SKILL_KINDS } from '../sim/orders.js';
import { clampAim, engagedWith } from '../sim/resolve.js';
import { Nav, pathAP, walkAP } from '../sim/nav.js';
import { obstacles, navKey, placeError, footprint, armySize, builderCount, BUILDINGS, trainCost, bdef, startQueues, trainsRole } from '../sim/base.js';
import { builderPlan, builderIdleTarget, gatherTarget } from '../sim/builders.js';
import { gatherRate, hitRadius } from '../sim/base.js';
import { norm, segCircle, dist } from '../sim/geom.js';

export class Planner {
  constructor(g) { this.g = g; this.reset(); }
  // draft.bq / draft.tq[bid] are edited copies of the queues (null = unchanged); draft.cancel stops training
  reset() { this.draft = { ...emptyOrders(), goals: {}, auto: {}, bq: null, tq: {}, cancel: [], repeat: {} }; this._fc = null; }
  get s() { return this.g.state; }
  squad(id) { return this.s.squads.find(q => q.id === id); }
  plan(id) { return this.draft.squads[id] || null; }
  cp() { return cpUsage(this.s, this.g.me, this.draft); }
  apLeft(q) { const p = this.plan(q.id); return apFor(q) - (p ? planCost(q, p) : 0); }
  skillUsed(id, kind) { const p = this.plan(id); return !!p && p.actions.some(a => a.kind === kind); }
  skillReady(q, kind) {
    const sk = skillOf(defOf(q), kind);
    if (!sk) return false;
    if (isMage(defOf(q))) return this.manaLeft(q) >= sk.mana;
    return cdOf(q, kind) === 0 && !this.skillUsed(q.id, kind);
  }
  // mages: mana left after the spells already planned this round
  manaLeft(q) {
    const def = defOf(q), p = this.plan(q.id);
    let m = q.mana || 0;
    if (p) for (const a of p.actions) { const k = skillOf(def, a.kind); if (k && k.mana) m -= k.mana; }
    return m;
  }
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
      } else if (a.kind === 'lob' || a.kind === 'blast' || a.kind === 'storm' || a.kind === 'summon' || a.kind === 'thunder' || a.kind === 'explode') {
        const sk = skillOf(def, a.kind);
        const range = a.kind === 'lob' ? def.attack.range : sk.range;
        const c2 = clampAim(x, z, a.x, a.z, range);
        const d = norm(c2.x - x, c2.z - z);
        if (d.l > 0.01) { fx = d.x; fz = d.z; }
        legs.push({ kind: a.kind, ox: x, oz: z, cx: c2.x, cz: c2.z, R: a.kind === 'lob' ? def.attack.radius : sk.radius, range, t0: t, t1: t + c });
      } else if (a.kind === 'rally' || a.kind === 'raise') {
        legs.push({ kind: a.kind, cx: x, cz: z, R: skillOf(def, a.kind).radius, t0: t, t1: t + c });
      } else if (a.kind === 'mighty') {
        const sk = skillOf(def, 'mighty'), d = norm(a.x - x, a.z - z);
        if (d.l > 0.01) { fx = d.x; fz = d.z; }
        legs.push({ kind: 'mighty', ox: x, oz: z, dx: fx, dz: fz, R: radiusOf(q) + sk.reach, ch: sk.cosHalf, t0: t, t1: t + c });
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
    if (isMage(defOf(q))) {
      if (this.manaLeft(q) < sk.mana) { this.g.toast(`Not enough mana (${sk.mana} needed, ${this.manaLeft(q)} left)`, true); return false; }
    } else {
      if (cd > 0) { this.g.toast(`${sk.name} is recharging (${cd} round${cd > 1 ? 's' : ''})`, true); return false; }
      if (this.skillUsed(id, kind)) { this.g.toast(`${sk.name} can be used once per round`, true); return false; }
    }
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
  clear(id) { delete this.draft.squads[id]; this.g.changed(); }

  setStance(id, st) {
    const q = this.squad(id);
    if (q.stance === st) delete this.draft.stances[id]; else this.draft.stances[id] = st;
    this.g.changed();
  }
  stanceOf(q) { return this.draft.stances[q.id] || q.stance; }
  // Advance target point (planned this round, else the one the squad keeps)
  goalOf(q) { return q.id in this.draft.goals ? this.draft.goals[q.id] : q.goal || null; }
  setGoal(id, x, z) {
    const q = this.squad(id);
    this.draft.goals[id] = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
    if (q.stance === 'advance') delete this.draft.stances[id]; else this.draft.stances[id] = 'advance';
    this.g.changed();
  }
  // auto skills (on unless switched off)
  autoOf(q) { return q.id in this.draft.auto ? this.draft.auto[q.id] : q.auto !== false; }
  toggleAuto(id) { const q = this.squad(id), v = !this.autoOf(q); if (v === (q.auto !== false)) delete this.draft.auto[id]; else this.draft.auto[id] = v; this.g.changed(); }
  clearGoal(id) { const q = this.squad(id); if (q.goal) this.draft.goals[id] = null; else delete this.draft.goals[id]; this.g.changed(); }

  // ---- base: production queues ------------------------------------------------------------
  // Both queues live in the state and carry over between rounds; this round's edits are drafts.
  // Nothing is paid when queued: each item is paid when it starts (see startQueues in sim/base.js).
  get fac() { return this.s.players[this.g.me].faction; }
  bqList() { return this.draft.bq || (this.s.bq?.[this.g.me] || []); }
  tqList(b) { return this.draft.tq[b.id] || b.queue || []; }
  training(b) { return b.train && !this.draft.cancel.includes(b.id) ? b.train : null; }
  // what starts when the round begins, and why the rest waits (cached until the draft changes)
  forecast() {
    const key = JSON.stringify([this.s.round, this.s.supply, this.bqList(), this.draft.tq, this.draft.cancel, this.draft.repeat]);
    if (this._fc && this._fc.key === key && this._fc.s === this.s) return this._fc.v;
    const tq = {};
    for (const b of this.s.buildings) if (b.owner === this.g.me && b.queue) tq[b.id] = this.tqList(b);
    const v = startQueues(this.s, this.g.me, { bq: this.bqList(), tq, cancel: this.draft.cancel, rep: this.draft.repeat });
    this._fc = { key, s: this.s, v };
    return v;
  }
  // supply after this round's queue starts (and refunds)
  supplyLeft() {
    let v = (this.s.supply || [0, 0])[this.g.me];
    for (const b of this.s.buildings) if (this.draft.cancel.includes(b.id) && b.train) v += trainCost(this.fac, b.train.role);
    const fc = this.forecast();
    this.bqList().forEach((it, i) => { if (fc.builds[i]?.starts) v -= BUILDINGS[it.type].cost; });
    for (const b of this.s.buildings) if (b.owner === this.g.me && b.queue) this.tqList(b).forEach((r, i) => { if (fc.trains[b.id]?.[i]?.starts) v -= trainCost(this.fac, r); });
    return v;
  }
  // squads training or starting this round (for the army count)
  armyNext() {
    const fc = this.forecast();
    let n = armySize(this.s, this.g.me) - this.draft.cancel.length;
    for (const l of Object.values(fc.trains)) n += l.filter(x => x.starts).length;
    return n;
  }
  // footprints of the queued buildings (except index `except`)
  queued(except = -1) { return this.bqList().filter((_, i) => i !== except).map(b => ({ ...b, owner: this.g.me, ...footprint(b.type, b.x, b.z, b.rot) })); }
  // can a building go into the queue here? (`except` = the queue item being moved)
  buildError(type, x, z, rot = 0, except = -1) {
    if (except < 0 && this.bqList().length >= RULES.queueMaxBuild) return `The build queue is full (${RULES.queueMaxBuild})`;
    if (!builderCount(this.s, this.g.me) && !this.g.rises?.()) return 'You need a builder: train one at your HQ';
    return placeError(this.s, this.g.me, type, x, z, rot, this.queued(except), false);
  }
  editBq(fn) { const l = this.bqList().map(x => ({ ...x })); fn(l); this.draft.bq = l; this.g.changed(); }
  queueBuild(type, x, z, rot = 0) {
    const err = this.buildError(type, x, z, rot);
    if (err) { this.g.toast(err, true); return -1; }
    let n = 0;
    this.editBq(l => { n = l.push({ qid: null, type, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot: rot ? 1 : 0 }); });
    return n - 1;
  }
  replaceBuild(i, x, z, rot = 0) {
    const it = this.bqList()[i]; if (!it) return false;
    const err = this.buildError(it.type, x, z, rot, i);
    if (err) { this.g.toast(err, true); return false; }
    this.editBq(l => Object.assign(l[i], { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot: rot ? 1 : 0 }));
    return true;
  }
  unqueueBuild(i) { this.editBq(l => l.splice(i, 1)); }
  moveBuild(i, j) { this.editBq(l => { if (j < 0 || j >= l.length) return; const [x] = l.splice(i, 1); l.splice(j, 0, x); }); }
  trainError(b, role) {
    if (b.build) return 'Still under construction';
    if (!trainsRole(b, role, this.fac)) return 'It can\'t train that';
    if (this.tqList(b).length >= RULES.queueMax) return `Queue full (${RULES.queueMax})`;
    return '';
  }
  editTq(b, fn) { const l = this.tqList(b).slice(); fn(l); this.draft.tq[b.id] = l; this.g.changed(); }
  queueTrain(b, role) {
    const err = this.trainError(b, role);
    if (err) { this.g.toast(err, true); return false; }
    this.editTq(b, l => l.push(role));
    return true;
  }
  unqueueTrain(b, i) { this.editTq(b, l => l.splice(i, 1)); }
  moveTrain(b, i, j) { this.editTq(b, l => { if (j < 0 || j >= l.length) return; const [x] = l.splice(i, 1); l.splice(j, 0, x); }); }
  // lock a training building onto one squad: it trains it whenever its queue is empty (null = unlock)
  repeatOf(b) { return b.id in this.draft.repeat ? this.draft.repeat[b.id] : b.repeat || null; }
  setRepeat(b, role) {
    const want = this.repeatOf(b) === role ? null : role;
    if ((b.repeat || null) === want) delete this.draft.repeat[b.id]; else this.draft.repeat[b.id] = want;
    this.g.changed();
  }
  // stop (or un-stop) the squad in training: it is refunded in full
  toggleCancel(b) {
    const c = this.draft.cancel;
    if (c.includes(b.id)) c.splice(c.indexOf(b.id), 1); else if (b.train) c.push(b.id);
    this.g.changed();
  }
  // what builder q would do for a building at footprint f: walk, then work with the AP left
  builderPreview(q, f) {
    const bp = builderPlan(this.s, q, f, apFor(q));
    const need = f.build !== undefined ? f.build : BUILDINGS[f.type].work;
    const rounds = bp.work >= need ? 1 : 1 + Math.ceil((need - bp.work) / RULES.ap);
    return { ...bp, need, rounds: bp.actions.length ? rounds : 0 };
  }
  // what a builder's work order at (a.x, a.z) is aimed at: { f (footprint), mode, b, draft }
  workTarget(q, a) {
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
      const fresh = this.bqList().find((it, i) => this.forecast().builds[i]?.starts);
      if (fresh && (!b || !(b.build > 0 || q.task?.kind === 'repair'))) return { text: `No orders, so it will take the queued ${BUILDINGS[fresh.type].name[this.fac]} when it starts this round`, mode: 'build', name: BUILDINGS[fresh.type].name[this.fac] };
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
    const need = tg.mode === 'build' ? tg.b.build : Math.ceil((bdef(tg.b).hp - tg.b.hp) * bdef(tg.b).work / bdef(tg.b).hp);
    const rounds = bp.work >= need ? 'done this round' : `${1 + Math.ceil((need - bp.work) / RULES.ap)} rounds`;
    const verb = tg.mode === 'repair' ? 'repair' : 'finish';
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
  final() {
    const o = JSON.parse(JSON.stringify(this.draft));
    for (const p of Object.values(o.squads)) { delete p.hist; for (const a of p.actions) delete a.disengage; }
    const queue = {};
    if (o.bq) queue.builds = o.bq;
    if (Object.keys(o.tq).length) queue.trains = o.tq;
    if (o.cancel.length) queue.cancel = o.cancel;
    if (Object.keys(o.repeat).length) queue.repeat = o.repeat;
    delete o.bq; delete o.tq; delete o.cancel; delete o.repeat;
    if (Object.keys(queue).length) o.queue = queue;
    return o;
  }
}
export { dist };
