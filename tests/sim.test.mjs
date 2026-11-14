// Headless tests for the V4 simulation. Run: node v4/tests/sim.test.mjs
import { RULES, FACTIONS, BUILDINGS, trainCost } from '../js/data/units.js';
import { createGame, addSquad, defOf, radiusOf, emptyOrders, emptyPlan } from '../js/sim/state.js';
import { resolveRound, damageAfter, engagedWith, losCut } from '../js/sim/resolve.js';
import { cpUsage, validateOrders } from '../js/sim/orders.js';
import { aiOrders, aiMemory } from '../js/ai/ai.js';
import { canSee, visibleTo } from '../js/sim/vision.js';
import { placeError, addBuilding, incomeOf, obstacles } from '../js/sim/base.js';
import { builderPlan } from '../js/sim/builders.js';
import { knownEnemyHq } from '../js/sim/vision.js';
import { Nav, walkAP, pointBlocked } from '../js/sim/nav.js';
import { MAPS, MAP_ORDER } from '../js/data/maps.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}
function ok(c, msg = 'assertion failed') { if (!c) throw new Error(msg); }
const eq = (a, b, msg) => ok(a === b, `${msg || 'expected equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// an empty board (open ground in the middle of the mat) with chosen squads
function arena(list) {
  const s = createGame(7);
  s.squads = []; s.nextId = 1;
  // HQs at fixed spots for the tests
  for (const b of s.buildings) { b.z = 16; b.x = b.owner === 0 ? 3.5 : 44.5; }
  for (const [owner, role, x, z, extra] of list) Object.assign(addSquad(s, owner, role, x, z), extra || {});
  return s;
}
const orders = (squads = {}, stances = {}) => ({ squads, stances });
const plan = (actions, extra = {}) => ({ ...emptyPlan(), actions, ...extra });
const holdAll = s => { const o = [orders(), orders()]; for (const q of s.squads) o[q.owner].stances[q.id] = 'hold'; return o; };
const events = log => log.segments.flatMap(sg => sg.events.map(e => ({ ...e, seg: sg })));

console.log('V4 simulation');

test('createGame deploys 6 squads per side (with a builder) with full models', () => {
  const s = createGame(1);
  eq(s.squads.length, 12);
  eq(s.squads.filter(q => q.role === 'builder').length, 2);
  for (const q of s.squads) { eq(q.models, defOf(q).models); eq(q.hp, defOf(q).models * defOf(q).hpPer); }
});

test('resolution is deterministic', () => {
  const run = () => {
    let s = createGame(42); const mem = [aiMemory(s), aiMemory(s)];
    const out = [];
    for (let r = 0; r < 6; r++) { const res = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]); s = res.state; out.push(JSON.stringify(res.log)); }
    return JSON.stringify(s) + out.join('');
  };
  eq(run(), run(), 'two runs differ');
});

test('resolve does not mutate the input state', () => {
  const s = createGame(3); const before = JSON.stringify(s);
  resolveRound(s, [aiOrders(s, 0), aiOrders(s, 1)]);
  eq(JSON.stringify(s), before);
});

test('tiers act fastest first (6 before 5 before 4)', () => {
  const s = createGame(1);
  const { log } = resolveRound(s, [orders(), orders()]);
  const tiers = log.segments.filter(g => g.kind === 'tier').map(g => g.tier);
  for (let i = 1; i < tiers.length; i++) ok(tiers[i] < tiers[i - 1], 'order ' + tiers);
});

test('AP is time: a 40 AP move takes 40 steps and covers tier × moveFactor × 40 inches', () => {
  const s = arena([[0, 'fighter', 10, 16], [1, 'fighter', 40, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'move', pts: [{ x: 30, z: 16 }], ap: 40 }]);
  const { state, log } = resolveRound(s, o);
  const q = state.squads.find(x => x.id === 'q1');
  const want = defOf(q).tier * RULES.moveFactor * 40;
  ok(Math.abs(q.x - 10 - want) < 1e-6, `moved ${q.x - 10} want ${want}`);
  const seg = log.segments.find(g => g.kind === 'tier' && g.squads.includes('q1'));
  eq(seg.len, 40);
});

test('act earlier: an upgraded squad acts in a higher tier', () => {
  const s = arena([[0, 'fighter', 10, 16], [1, 'fighter', 40, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'wait', ap: 10 }], { upgrades: 1 });
  const { log } = resolveRound(s, o);
  const prep = events(log).find(e => e.type === 'prep' && e.id === 'q1');
  eq(prep.tier, defOf(s.squads[0]).tier + 1);
});

test('swing hits an enemy standing in the arc; damage = per model × models', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 16]]);
  const o = holdAll(s);
  delete o[1].stances.q2; o[1].stances.q2 = 'hold';
  o[0].squads.q1 = plan([{ kind: 'swing', x: 23, z: 16 }]);
  const { log } = resolveRound(s, o);
  const hit = events(log).find(e => e.type === 'hit' && e.src === 'q1');
  ok(hit, 'no hit');
  const def = defOf(s.squads[0]);
  eq(hit.raw, def.attack.dmg * def.models);
});

test('swing aimed the other way misses', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'swing', x: 17, z: 16 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'hit' && e.src === 'q1'), 'should miss');
});

test('a faster squad can walk out of a slower squad\'s swing (dodge)', () => {
  // the enemy Wraiths (tier 6) move away before the tier-5 swing lands
  const s = arena([[0, 'fighter', 20, 16], [1, 'fast', 22.4, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'swing', x: 23, z: 16 }]);
  o[1].squads.q2 = plan([{ kind: 'move', pts: [{ x: 30, z: 16 }], ap: 60 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'hit' && e.src === 'q1'), 'wraiths should have dodged');
});

test('models are removed as HP falls, and wounded squads hit weaker', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 16]]);
  const q2 = s.squads[1], d2 = defOf(q2);
  q2.hp = d2.hpPer * 2; q2.models = 2;
  const o = holdAll(s);
  o[1].squads.q2 = plan([{ kind: 'swing', x: 20, z: 16 }]);
  const { log } = resolveRound(s, o);
  const hit = events(log).find(e => e.type === 'hit' && e.src === 'q2');
  ok(hit, 'no hit'); eq(hit.raw, d2.attack.dmg * 2);
  const after = events(log).find(e => e.type === 'hit' && e.dst === 'q1');
  const q1def = defOf(s.squads[0]);
  eq(after.models, Math.ceil(after.hp / q1def.hpPer));
});

test('a defend halves the hit and armour reduces damage', () => {
  ok(damageAfter(20, 0, true) < damageAfter(20, 0, false));
  ok(damageAfter(20, 20, false) < damageAfter(20, 0, false));
  ok(damageAfter(1, 100, true) >= 1, 'minimum 1 damage');
});

test('volleys are blocked by ruins', () => {
  // ruin wall at x 19.9-24.1, z 13.1-13.7 sits between the two squads
  const s = arena([[0, 'ranged', 22, 8], [1, 'fighter', 22, 19]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'volley', x: 22, z: 19 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q1');
  eq(rel.hit.length, 0, 'should be blocked'); ok(rel.blocked, 'blocked flag');
});

test('volley in the open hits the first enemy on the line', () => {
  const s = arena([[0, 'ranged', 8, 4], [1, 'fighter', 16, 4], [1, 'tank', 20, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'volley', x: 20, z: 4 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q1');
  eq(rel.hit.join(), 'q2');
});

test('squads do not walk through each other', () => {
  const s = arena([[0, 'fighter', 10, 4], [1, 'tank', 14, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'move', pts: [{ x: 18, z: 4 }], ap: 100 }]);
  const { state } = resolveRound(s, o);
  const [a, b] = state.squads;
  ok(Math.hypot(a.x - b.x, a.z - b.z) >= radiusOf(a) + radiusOf(b) - 0.05, 'overlap');
});

test('movement goes around rocks and slows in forests', () => {
  const s = createGame(1);
  const nav = Nav.for(s.terrain, 1, 't');
  const pts = nav.path(10.5, 25, 16.5, 25);   // rock at 13.5,25
  ok(pts.length >= 2, 'path should bend round the rock');
  const open = walkAP(s.terrain, 4, 2, [{ x: 20, z: 2 }], 50, 5);
  const wood = walkAP(s.terrain, 12, 7.5, [{ x: 28, z: 7.5 }], 50, 5);
  ok(wood.x - 12 < open.x - 4, 'forest should be slower');
});

test('command points: 3 squads plus the hero and builders', () => {
  const s = createGame(1);
  const o = emptyOrders();
  for (const q of s.squads.filter(q => q.owner === 0)) o.squads[q.id] = plan([{ kind: 'wait', ap: 10 }]);
  const cp = cpUsage(s, 0, o);
  eq(cp.accepted.length, RULES.cp + 2, 'hero and builder are free');
  const v = validateOrders(s, 0, o);
  eq(Object.keys(v.squads).length, RULES.cp + 2);
});

test('orders over 100 AP are trimmed by validation', () => {
  const s = createGame(1);
  const o = emptyOrders();
  o.squads.q1 = plan([{ kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }]);
  const v = validateOrders(s, 0, o);
  const used = v.squads.q1.actions.length * defOf(s.squads[0]).attack.ap;
  ok(used <= RULES.ap, 'used ' + used);
});

test('AI vs AI plays to a finish (no round limit, but the AI does finish games)', () => {
  for (const seed of [1, 2, 3]) {
    let s = createGame(seed); const mem = [aiMemory(s), aiMemory(s)];
    while (s.winner === null && s.round < 80) { s = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]).state; }
    ok(s.winner !== null, 'still going at round ' + s.round);
  }
});

console.log('M2 tactics');

test('charge rushes down the lane and hits the first enemy squad', () => {
  const s = arena([[0, 'fast', 10, 4], [1, 'fighter', 17, 4], [1, 'tank', 22, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'charge', x: 30, z: 4 }]);
  const { state, log } = resolveRound(s, o);
  const imp = events(log).find(e => e.type === 'hit' && e.src === 'q1' && e.kind === 'charge');
  ok(imp, 'no charge impact'); eq(imp.dst, 'q2');
  const q1 = state.squads.find(q => q.id === 'q1'), q2 = state.squads.find(q => q.id === 'q2');
  ok(Math.hypot(q1.x - q2.x, q1.z - q2.z) <= radiusOf(q1) + radiusOf(q2) + 0.1, 'should end in contact');
  ok(q1.cd.charge > 0, 'charge goes on cooldown');
});

test('a skill on cooldown is dropped from the orders', () => {
  const s = arena([[0, 'fast', 10, 4, { cd: { charge: 1 } }], [1, 'fighter', 17, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'charge', x: 30, z: 4 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'act' && e.kind === 'charge'), 'charge should not happen');
});

test('stepping away from an engaged enemy costs AP and gives it a parting blow', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.2, 16]]);
  ok(engagedWith(s.squads[0], s.squads).length === 1, 'should start engaged');
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'move', pts: [{ x: 10, z: 16 }], ap: 60 }]);
  const { state, log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'disengage' && e.id === 'q1'), 'disengage event');
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'parting' && e.dst === 'q1'), 'parting blow');
  const q1 = state.squads.find(q => q.id === 'q1');
  const free = defOf(q1).tier * RULES.moveFactor * 60;
  ok(20 - q1.x < free - 1, 'disengaging should cost distance');
});

test('wraiths ignore engagement', () => {
  const s = arena([[1, 'fast', 20, 16], [0, 'fighter', 22.4, 16]]);
  eq(engagedWith(s.squads[0], s.squads).length, 0);
});

test('a parry negates the first melee hit and ripostes', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.2, 16]]);
  const o = holdAll(s);
  delete o[1].stances.q2;
  o[1].squads.q2 = { ...plan([]), parry: true, defends: 0 };
  o[0].squads.q1 = plan([{ kind: 'swing', x: 23, z: 16 }]);
  const { log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'parry' && e.id === 'q2'), 'parry event');
  ok(!events(log).some(e => e.type === 'hit' && e.dst === 'q2' && e.kind === 'swing'), 'swing negated');
  ok(events(log).some(e => e.type === 'hit' && e.dst === 'q1' && e.kind === 'riposte'), 'riposte');
});

test('overwatch fires once at an enemy moving into the front cone, even in another tier', () => {
  const s = arena([[0, 'ranged', 10, 2], [1, 'fast', 30, 2]]);
  const o = holdAll(s);
  o[0].squads.q1 = { ...plan([]), overwatch: { x: 20, z: 2 } };
  o[1].squads.q2 = plan([{ kind: 'move', pts: [{ x: 18, z: 2 }], ap: 100 }]);
  const { log } = resolveRound(s, o);
  const shots = events(log).filter(e => e.type === 'release' && e.id === 'q1' && e.overwatch);
  eq(shots.length, 1, 'one overwatch shot');
  eq(shots[0].hit.join(), 'q2');
  eq(shots[0].seg.tier, 6, 'fired during the wraiths\' tier');
});

test('Arrow Storm arcs over walls that stop the archers\' volleys, then recharges', () => {
  const s = arena([[1, 'ranged', 22, 8], [0, 'fighter', 22, 19]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'volley', x: 22, z: 19 }, { kind: 'storm', x: 22, z: 19 }]);
  const { state, log } = resolveRound(s, o);
  const rel = events(log).filter(e => e.type === 'release' && e.id === 'q1');
  eq(rel[0].kind, 'volley'); ok(rel[0].blocked, 'volley blocked by the wall');
  eq(rel[1].kind, 'storm'); eq(rel[1].hit.join(), 'q2');
  ok(state.squads.find(q => q.id === 'q1').cd.storm > 0, 'storm goes on cooldown');
});

test('only fighters can parry', () => {
  const s = arena([[0, 'tank', 20, 16], [1, 'fighter', 22.2, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = { ...plan([]), parry: true };
  o[1].squads.q2 = plan([{ kind: 'swing', x: 20, z: 16 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'parry'), 'a tank parry order is dropped');
});

test('volleys into a forest deal reduced damage (cover)', () => {
  const s = arena([[0, 'ranged', 15, 1.5], [1, 'fighter', 15, 7.5]]);   // forest at 15,7.5
  const o = holdAll(s);
  for (const k of Object.keys(o[1].stances)) delete o[1].stances[k];
  o[1].squads.q2 = { ...plan([]), defends: 0 };
  o[0].squads.q1 = plan([{ kind: 'volley', x: 15, z: 7.5 }]);
  const { log } = resolveRound(s, o);
  const hit = events(log).find(e => e.type === 'hit' && e.src === 'q1');
  ok(hit && hit.cover, 'should be in cover');
  ok(hit.dmg < damageAfter(hit.raw, defOf(s.squads[1]).armor, false), 'cover reduces damage');
});

test('bone blast hits every enemy in the circle and rally buffs nearby allies', () => {
  const s = arena([[1, 'hero', 10, 16], [0, 'fighter', 17, 15.4], [0, 'tank', 17, 17.2], [0, 'hero', 30, 16], [0, 'ranged', 32, 17]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'blast', x: 17, z: 16.3 }]);
  o[0].squads.q4 = plan([{ kind: 'rally', x: 30, z: 16 }]);
  const { log } = resolveRound(s, o);
  const bl = events(log).find(e => e.type === 'release' && e.kind === 'blast');
  eq(bl.hit.length, 2, 'blast should catch both squads');
  const buff = events(log).find(e => e.type === 'buff');
  ok(buff && buff.ids.includes('q5') && buff.ids.includes('q4'), 'rally reaches the crossbows');
});

test('charges weave through their own lines and end beside friends', () => {
  const s = arena([[0, 'fast', 8, 3], [0, 'fighter', 12, 3], [1, 'tank', 17.5, 3]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'charge', x: 22, z: 3 }]);
  const { state, log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'charge' && e.dst === 'q3'), 'charge should reach the enemy');
  const [a, b] = state.squads;
  ok(Math.hypot(a.x - b.x, a.z - b.z) >= radiusOf(a) + radiusOf(b) - 0.05, 'no overlap with the friend');
});

test('balance report: AI vs AI with both factions on both sides', () => {
  const wins = { kingdom: 0, undead: 0, draw: 0 };
  for (let seed = 1; seed <= 6; seed++) for (const fac of [['kingdom', 'undead'], ['undead', 'kingdom']]) {
    let s = createGame(seed, fac); const mem = [aiMemory(), aiMemory()];
    while (s.winner === null) { const o = [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]; s = resolveRound(s, o).state; }
    if (s.winner === -1) wins.draw++; else wins[fac[s.winner]]++;
  }
  console.log('       wins over 12 games:', JSON.stringify(wins));
  ok(wins.kingdom > 0 && wins.undead > 0, 'both factions should be able to win');
});

console.log('M3 skills');

test('heroes have three skills, one of each colour, usable in the same round', () => {
  for (const f of ['kingdom', 'undead']) {
    const def = createGame(1, [f, f]).squads.find(q => q.role === 'hero');
    const cats = defOf(def).skills.map(k => k.cat).sort().join();
    eq(cats, 'attack,defense,move', f);
  }
  const s = arena([[0, 'hero', 10, 16], [1, 'fighter', 16, 16], [0, 'fighter', 9, 18]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'rally', x: 10, z: 16 }, { kind: 'leap', x: 13.2, z: 16 }, { kind: 'sweep', x: 13, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const acts = events(log).filter(e => e.type === 'act' && e.id === 'q1').map(e => e.kind).join();
  eq(acts, 'rally,leap,sweep');
  const q1 = state.squads.find(q => q.id === 'q1');
  ok(q1.cd.rally > 0 && q1.cd.leap > 0 && q1.cd.sweep > 0, 'each skill has its own cooldown');
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'sweep' && e.dst === 'q2'), 'sweep hits after the leap');
});

test('the same skill cannot be used twice in a round', () => {
  const s = arena([[0, 'hero', 10, 16], [1, 'fighter', 30, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'sweep', x: 0, z: 0 }, { kind: 'sweep', x: 0, z: 0 }]);
  const { log } = resolveRound(s, o);
  eq(events(log).filter(e => e.type === 'act' && e.kind === 'sweep').length, 1);
});

test('Lock Shields blunts hits from the front only', () => {
  const run = (bx) => {
    const s = arena([[0, 'tank', 20, 16], [1, 'fighter', bx, 16]]);
    s.squads[0].fx = 1; s.squads[0].fz = 0;
    const o = holdAll(s);
    for (const k of Object.keys(o[0].stances)) delete o[0].stances[k];
    o[0].squads.q1 = { ...plan([{ kind: 'wall', x: 20, z: 16 }]), defends: 0 };
    o[1].squads.q2 = plan([{ kind: 'swing', x: 20, z: 16 }]);
    const { log } = resolveRound(s, o);
    return events(log).find(e => e.type === 'hit' && e.dst === 'q1');
  };
  const front = run(22.2), back = run(17.8);
  ok(front.walled && !back.walled, 'only the front is shielded');
  ok(front.dmg < back.dmg, 'front hit is smaller');
});

test('Piercing Bolt hits every squad on the line', () => {
  const s = arena([[0, 'ranged', 6, 3], [1, 'fighter', 11, 3], [1, 'tank', 15, 3]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'pierce', x: 20, z: 3 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.kind === 'pierce');
  eq(rel.hit.sort().join(), 'q2,q3');
});

test('Raise brings back a fallen model', () => {
  const s = arena([[1, 'hero', 10, 16], [1, 'fighter', 12, 16]]);
  const w = s.squads[1], d = defOf(w); w.hp = d.hpPer * 2; w.models = 2;
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'raise', x: 10, z: 16 }]);
  const { state } = resolveRound(s, o);
  eq(state.squads.find(q => q.id === 'q2').models, 3);
});

test('Shadow Step relocates the necromancer without parting blows', () => {
  const s = arena([[1, 'hero', 20, 16], [0, 'fighter', 21.9, 16]]);
  ok(engagedWith(s.squads[0], s.squads).length, 'starts engaged');
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'step', x: 27, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  ok(!events(log).some(e => e.kind === 'parting'), 'no parting blow');
  ok(state.squads.find(q => q.id === 'q1').x > 25, 'moved away');
});

test('Heroic Leap clears a wall and shoves enemies at the landing', () => {
  const s = arena([[0, 'hero', 16, 16], [1, 'fighter', 23.6, 16.2]]);   // ruin wall at x 20.2
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'leap', x: 22.2, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const q1 = state.squads.find(q => q.id === 'q1');
  ok(q1.x > 20.6, 'landed beyond the wall');
  const land = events(log).find(e => e.type === 'land');
  ok(land && land.pushed.includes('q2'), 'enemy shoved');
});

test('Wraiths drift through squads', () => {
  const s = arena([[1, 'fast', 8, 3], [0, 'tank', 12, 3]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'move', pts: [{ x: 17, z: 3 }], ap: 100 }]);
  const { state } = resolveRound(s, o);
  ok(state.squads.find(q => q.id === 'q1').x > 14, 'passed through the tank');
});

console.log('M3 fog of war');

test('sight: range, walls, deep forests, and squads hidden inside forests', () => {
  const t = createGame(1).terrain;
  ok(canSee(t, 4, 2, 11, 12, 2), 'open ground in range');
  ok(!canSee(t, 4, 2, 11, 16, 2), 'out of range');
  ok(!canSee(t, 22, 8, 12, 22, 19), 'ruin wall blocks sight');            // wall at x 19.9-24.1, z 13.1-13.7
  ok(!canSee(t, 9, 7.5, 12, 21, 7.5), 'through a whole forest is blocked'); // forest 15,7.5 r3.2
  ok(!canSee(t, 9, 7.5, 12, 15, 7.5), 'inside a forest: only seen up close');
  ok(canSee(t, 11.5, 7.5, 12, 14, 7.5), 'seen from within 4 inches');
});

test('stance squads ignore enemies they cannot see', () => {
  // an enemy behind the ruin wall, inside guard range but out of sight
  const s = arena([[0, 'fighter', 22, 11], [1, 'fighter', 22, 16.4]]);
  ok(!visibleTo(s, 0).has('q2'), 'hidden behind the wall');
  const { log } = resolveRound(s, [orders(), { squads: {}, stances: { q2: 'hold' } }]);
  ok(!events(log).some(e => e.type === 'act' && e.id === 'q1'), 'guard squad does not react');
});

test('the AI only targets what it sees or remembers', () => {
  const s = arena([[0, 'fighter', 6, 3], [1, 'fighter', 44, 29]]);
  const mem = aiMemory();
  aiOrders(s, 1, mem);
  ok(!mem.seen.q1, 'nothing seen across the board');
});

console.log('M3 base & economy');

const ob = (builds = [], trains = []) => ({ squads: {}, stances: {}, builds, trains });

test('a new game: an HQ each at a seeded spot, faction currencies, four free resource sites', () => {
  const s = createGame(1);
  eq(s.buildings.filter(b => b.type === 'hq').length, 2);
  eq(s.supply.join(), FACTIONS.kingdom.eco.start + ',' + FACTIONS.undead.eco.start);
  eq(s.shrines.length, 4); ok(s.shrines.every(x => x.owner === -1));
  const spots = new Set();
  for (let sd = 1; sd < 30; sd++) spots.add(createGame(sd).buildings[0].z);
  ok(spots.size === 3, 'three HQ spots in use: ' + [...spots]);
  eq(JSON.stringify(createGame(5).buildings), JSON.stringify(createGame(5).buildings), 'deterministic per seed');
});

const k = () => arena([[0, 'builder', 7, 9], [1, 'builder', 41, 23]]);
test('placement: own third only, sites only on resource sites, faction lists', () => {
  const s = k();
  eq(placeError(s, 0, 'barracks', 6, 4), '', 'a valid spot');
  ok(placeError(s, 0, 'barracks', 30, 9), 'outside your third');
  ok(placeError(s, 0, 'barracks', 3.5, 16), 'on top of the HQ');
  ok(placeError(s, 0, 'barracks', 7, 9), 'on a squad');
  eq(placeError(s, 0, 'mine', 16.5, 19.5), '', 'a mine on a site');
  ok(placeError(s, 0, 'mine', 10, 10), 'a mine off a site');
  ok(placeError(s, 0, 'well', 16.5, 19.5), 'the kingdom has no soul wells');
  ok(placeError(s, 1, 'farm', 40, 4), 'the undead have no farms');
});

const workOrder = (s, q, f) => ({ [q.id]: plan(builderPlan(s, q, f, 100).actions) });
test('a builder walks to a new site and finishes it mid-round with its work', () => {
  const s = k();
  const q = s.squads[0], f = { type: 'farm', x: 6, z: 5, w: 2.6, d: 2.2 };
  const o = [ob([{ type: 'farm', x: 6, z: 5 }]), ob()];
  o[0].squads = workOrder(s, q, f);
  const r = resolveRound(s, o);
  const b = r.state.buildings.find(x => x.type === 'farm');
  ok(b, 'site placed'); eq(b.build, 0, 'finished'); eq(b.hp, BUILDINGS.farm.hp, 'full hp');
  const e = events(r.log);
  ok(e.some(x => x.type === 'work') && e.some(x => x.type === 'built' && x.by === q.id), 'work then built');
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start - 20 + FACTIONS.kingdom.eco.hq + BUILDINGS.farm.income, 'paid, then the farm pays this round');
});

test('two builders stack; a builder further away walks over and works when it arrives', () => {
  const s = arena([[0, 'builder', 7, 4], [0, 'builder', 7, 9.5], [0, 'builder', 10, 28]]);
  const b = addBuilding(s, 0, 'barracks', 7, 6.8, 0, false);
  const o = holdAll(s);
  for (const id of ['q1', 'q2']) o[0].squads[id] = plan([{ kind: 'work', x: b.x, z: b.z, ap: 100 }]);
  o[0].squads.q3 = plan([{ kind: 'work', x: b.x, z: b.z, ap: 100 }]);
  const r = resolveRound(s, o);
  eq(r.state.buildings.find(x => x.id === b.id).build, 0, '2 x 100 AP of work finishes a 120-work barracks');
  const q3 = r.state.squads.find(q => q.id === 'q3');
  ok(Math.hypot(q3.x - 10, q3.z - 28) > 5, 'the far builder walked toward it');
  ok(!events(r.log).some(e => e.type === 'workFail'), 'nobody failed');
});

test('a far-away site is reached and built even with squads in the way (no failures across seeds)', () => {
  let fails = 0, built = 0, tried = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = createGame(seed);
    const q = s.squads.find(x => x.owner === 0 && x.role === 'builder');
    for (const [dx, dz] of [[6, 3], [5, 0], [3, 4], [3, -4], [-1, 6]]) {
      const x = q.x + dx, z = q.z + dz;
      if (placeError(s, 0, 'barracks', x, z, 0)) continue;
      const bp = builderPlan(s, q, { type: 'barracks', ...{ x, z, w: 3.5, d: 2.5 } }, 100);
      if (!bp.actions.length) continue;
      const o = [ob([{ type: 'barracks', x, z }]), ob()];
      o[0].squads = { [q.id]: plan(bp.actions) };
      const r = resolveRound(s, o); tried++;
      if (events(r.log).some(e => e.type === 'workFail')) fails++;
      const q2 = r.state.squads.find(o => o.id === q.id);
      if (r.state.buildings.some(b => b.type === 'barracks' && b.owner === 0 && b.build < 120) || Math.hypot(q2.x - q.x, q2.z - q.z) > 4) built++;
      break;
    }
  }
  eq(fails, 0, 'no failed work'); ok(tried >= 6, 'tried ' + tried); eq(built, tried, 'every builder worked or made real progress');
});

test('builders keep at their task next round without new orders, then go gathering', () => {
  const s = arena([[0, 'builder', 7, 2.4]]);
  const b = addBuilding(s, 0, 'barracks', 7, 6.5, 0, false);
  addBuilding(s, 0, 'farm', 4, 9, 0, true);
  const o = holdAll(s); delete o[0].stances.q1;
  o[0].squads.q1 = plan([{ kind: 'wait', ap: 40 }, { kind: 'work', x: b.x, z: b.z, ap: 60 }]);
  let r = resolveRound(s, o);
  ok(r.state.buildings.find(x => x.id === b.id).build > 0, 'not finished in round 1');
  eq(r.state.squads[0].task.kind, 'build');
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(x => x.id === b.id).build, 0, 'finished in round 2 with no orders');
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.squads[0].task.kind, 'gather', 'walks to the farm');
  r = resolveRound(r.state, [ob(), ob()]);
  ok(events(r.log).some(e => e.type === 'gather' && e.owner === 0 && e.amount >= 7), 'and gathers a full round there');
});

test('gathering: at most two builders per building; the undead gather at the crypt', () => {
  const s = arena([[0, 'builder', 10, 3], [0, 'builder', 10, 6], [0, 'builder', 10, 9], [1, 'builder', 41.5, 16]]);
  const f = addBuilding(s, 0, 'farm', 7, 6, 0, true);
  const o = [ob(), ob()];
  for (const id of ['q1', 'q2', 'q3']) o[0].squads[id] = plan([{ kind: 'work', x: f.x, z: f.z, ap: 100 }]);
  const hq1 = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  o[1].squads.q4 = plan([{ kind: 'work', x: hq1.x, z: hq1.z, ap: 100 }]);
  const r = resolveRound(s, o);
  const g = events(r.log).filter(e => e.type === 'gather');
  eq(g.filter(e => e.owner === 0).length, 2, 'two gatherers at the farm');
  ok(events(r.log).some(e => e.type === 'workFail' && e.full), 'the third is turned away');
  ok(g.some(e => e.owner === 1 && e.amount > 0), 'the thrall gathers souls at the crypt');
});

test('a builder on Hold stays put', () => {
  const s = arena([[0, 'builder', 10, 3]]);
  addBuilding(s, 0, 'farm', 7, 9, 0, true);
  const r = resolveRound(s, holdAll(s));
  eq(r.state.squads[0].x, 10); ok(!events(r.log).some(e => e.type === 'gather'));
});

test('builders repair damaged buildings', () => {
  const s = arena([[0, 'builder', 7, 4]]);
  const b = addBuilding(s, 0, 'tower', 7, 6, 0, true); b.hp = 50;
  const o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'work', x: 7, z: 6, ap: 40 }]);
  const r = resolveRound(s, o);
  eq(r.state.buildings.find(x => x.id === b.id).hp, 94, '40 AP x 110/100 HP');
});

test('builders cost no command points; the HQ trains builders, barracks soldiers', () => {
  const s = createGame(1);
  const sq = {}; for (const q of s.squads.filter(q => q.owner === 0)) sq[q.id] = plan([]);
  const u = cpUsage(s, 0, { squads: sq });
  eq(u.accepted.length, 5, 'hero + builder + 3');
  const hq = s.buildings.find(b => b.owner === 0 && b.type === 'hq');
  const v = validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'builder' }]));
  eq(v.trains.length, 1);
  eq(validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'fighter' }])).trains.length, 0, 'no soldiers from the HQ');
});

test('a barracks trains a squad that appears at the end of the round', () => {
  const s = k();
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const n0 = s.squads.filter(q => q.owner === 0).length;
  const r = resolveRound(s, [ob([], [{ bid: b.id, role: 'fighter' }]), ob()]);
  eq(r.state.squads.filter(q => q.owner === 0).length, n0 + 1);
  ok(events(r.log).some(e => e.type === 'spawn' && e.role === 'fighter'));
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start - trainCost('kingdom', 'fighter') + incomeOf(r.state, 0));
});

test('gold: a finished mine owns its site and pays every round', () => {
  const s = k();
  addBuilding(s, 0, 'mine', 16.5, 19.5, 0, true);
  const r = resolveRound(s, holdAll(s));
  eq(r.state.shrines[0].owner, 0);
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start + FACTIONS.kingdom.eco.hq + BUILDINGS.mine.income);
  ok(placeError(r.state, 1, 'well', 16.5, 19.5), 'the site is taken');
});

test('souls: models dying near undead pay souls (either side); far away they do not', () => {
  // a kingdom model dies next to the warband (souls); another dies to a kingdom volley far from any undead (none)
  const s = arena([[1, 'fighter', 24, 9], [0, 'fighter', 25.9, 9, { hp: 5, models: 1 }], [1, 'builder', 8, 29, { hp: 3, models: 1 }], [0, 'ranged', 4, 29]]);
  for (const b of s.buildings) b.z = 4;   // keep the crypt far away
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'swing', x: 25.9, z: 9 }]);
  o[0].squads.q4 = plan([{ kind: 'volley', x: 8, z: 29 }]);
  const r = resolveRound(s, o);
  const souls = events(r.log).filter(e => e.type === 'souls');
  ok(events(r.log).filter(e => e.type === 'hit' && e.lost).length === 2, 'two models fell');
  ok(souls.length === 1 && souls[0].owner === 1 && souls[0].amount === RULES.soulPerModel, 'only the one near the warband: ' + JSON.stringify(souls));
  eq(r.state.supply[1], FACTIONS.undead.eco.start + RULES.soulPerModel + FACTIONS.undead.eco.hq);
});

test('the enemy HQ is unknown until seen, then remembered', () => {
  const s = arena([[0, 'fast', 20, 16]]);
  let r = resolveRound(s, holdAll(s));
  ok(!knownEnemyHq(r.state, 0), 'not seen from the middle');
  const s2 = arena([[0, 'fast', 36, 16]]);
  r = resolveRound(s2, holdAll(s2));
  ok(knownEnemyHq(r.state, 0), 'scouted');
  const t = r.state; t.squads = [];
  ok(knownEnemyHq(resolveRound(t, holdAll(t)).state, 0), 'remembered after the scout is gone');
});

test('watchtowers fire in a Buildings segment after the tiers', () => {
  const s = arena([[1, 'fighter', 10, 8]]);
  addBuilding(s, 0, 'tower', 5, 8, 0, true);
  const { log } = resolveRound(s, holdAll(s));
  const seg = log.segments.find(g => g.kind === 'tier' && g.tier === 0);
  ok(seg, 'buildings segment');
  ok(seg.events.some(e => e.type === 'hit' && e.dst === 'q1'), 'tower hits');
});

test('buildings block movement and shots, and can be attacked', () => {
  const s = arena([[0, 'fighter', 6, 5], [1, 'ranged', 14, 5]]);
  const w = addBuilding(s, 0, 'wall', 10, 5, 1, true);   // a palisade across the line
  const o = holdAll(s);
  o[1].squads.q2 = plan([{ kind: 'volley', x: 6, z: 5 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q2');
  eq(rel.hit.join(), w.id, 'the volley hits the palisade');
});

test('destroying the enemy HQ wins', () => {
  const s = arena([[0, 'fighter', 42.4, 16]]);
  const hq = s.buildings.find(b => b.owner === 1 && b.type === 'hq'); hq.hp = 5;
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'swing', x: 44.5, z: 16 }]);
  const r = resolveRound(s, o);
  eq(r.state.winner, 0);
});

console.log('M4 online');

test('online: host and guest stay in sync (same seed, orders sent as JSON, guest re-resolves)', () => {
  for (const factions of [['kingdom', 'undead'], ['undead', 'undead']]) {
    let host = createGame(4242, factions), guest = createGame(4242, factions);
    eq(JSON.stringify(host), JSON.stringify(guest), 'same start');
    const mem = [aiMemory(), aiMemory()];
    for (let r = 0; r < 6 && host.winner === null; r++) {
      const orders = JSON.parse(JSON.stringify([aiOrders(host, 0, mem[0]), aiOrders(guest, 1, mem[1])]));
      const h = resolveRound(host, orders);
      const wire = JSON.parse(JSON.stringify({ orders, post: h.state }));   // the 'result' message
      const g = resolveRound(guest, wire.orders);
      eq(JSON.stringify(g.state), JSON.stringify(wire.post), 'round ' + host.round + ' matches');
      host = h.state; guest = wire.post;
    }
  }
});

test('mirror match: the second army gets the alternate paint scheme', () => {
  const s = createGame(3, ['kingdom', 'kingdom']);
  eq(s.players[1].paint, 'kingdomAlt');
  ok(s.squads.filter(q => q.owner === 1).every(q => q.paint === 'kingdomAlt') && s.squads.filter(q => q.owner === 0).every(q => q.paint === 'kingdom'));
  eq(createGame(3, ['kingdom', 'undead']).players[1].paint, 'undead');
});

console.log('M5 maps');

test('every map: point-symmetric terrain, deployments clear of obstacles, HQ spots on the board', () => {
  for (const id of MAP_ORDER) {
    const s = createGame(5, ['kingdom', 'undead'], id), W = s.board.w, H = s.board.h;
    eq(s.map, id);
    const key = t => t.kind + Math.round(t.x * 10) + ',' + Math.round(t.z * 10);
    const set = new Set(s.terrain.filter(t => t.kind !== 'board').map(key));
    for (const t of s.terrain) if (t.kind !== 'board') ok(set.has(key({ ...t, x: W - t.x, z: H - t.z })), id + ': mirror of ' + key(t));
    for (const q of s.squads) ok(!pointBlocked(obstacles(s), q.x, q.z, radiusOf(q) * 0.9), id + ': ' + q.role + ' deploys clear');
    for (const b of s.buildings) ok(b.x > 0 && b.x < W && b.z > 0 && b.z < H, id + ': HQ on the board');
    eq(s.shrines.length, MAPS[id].sites.length * 2);
  }
});

test('lakes block movement but not sight or shots', () => {
  const s = createGame(2, ['kingdom', 'undead'], 'highland');
  const lake = s.terrain.find(t => t.kind === 'lake');
  ok(pointBlocked(s.terrain, lake.x, lake.z, 0.5), 'cannot stand in the lake');
  ok(canSee(s.terrain, lake.x - lake.r - 1, lake.z, 12, lake.x + lake.r + 1, lake.z), 'can see across');
  ok(losCut(s.terrain, lake.x - lake.r - 1, lake.z, lake.x + lake.r + 1, lake.z) === 1, 'can shoot across');
});

test('big maps: build zone, army cap and pathing follow the map', () => {
  const s = createGame(3, ['kingdom', 'undead'], 'greatfield');
  eq(s.board.zone, Math.round(80 / 3)); eq(s.board.cap, RULES.armyCap + 2);
  const nav = Nav.for(obstacles(s), 1, 'gf');
  ok(nav.path(5, 5, 75, 47).length > 0, 'a path across the great field');
  ok(!placeError(s, 0, 'farm', 22, 20) || placeError(s, 0, 'farm', 22, 20) !== 'Only in your third of the table', 'x 22 is in your third on an 80 wide table');
});

test('AI difficulty: the AI income multiplier', () => {
  const s = createGame(1, ['kingdom', 'undead'], 'crossing', { incomeMult: [1, 1.25] });
  eq(incomeOf(s, 1), Math.round(FACTIONS.undead.eco.hq * 1.25));
  eq(incomeOf(s, 0), FACTIONS.kingdom.eco.hq);
});

test('online sync on the biggest map', () => {
  let host = createGame(77, ['undead', 'kingdom'], 'greatfield'), guest = createGame(77, ['undead', 'kingdom'], 'greatfield');
  const mem = [aiMemory(), aiMemory()];
  for (let r = 0; r < 4; r++) {
    const orders = JSON.parse(JSON.stringify([aiOrders(host, 0, mem[0]), aiOrders(guest, 1, mem[1])]));
    const h = resolveRound(host, orders), g = resolveRound(guest, orders);
    eq(JSON.stringify(g.state), JSON.stringify(h.state), 'round ' + host.round);
    host = h.state; guest = JSON.parse(JSON.stringify(h.state));
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
