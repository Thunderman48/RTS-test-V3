// Headless tests for the simulation. Run: node tests/sim.test.mjs
import { RULES, FACTIONS, BUILDINGS, trainCost } from '../js/data/units.js';
import { createGame, addSquad, defOf, radiusOf, emptyOrders, emptyPlan } from '../js/sim/state.js';
import { resolveRound, damageAfter, engagedWith, losCut } from '../js/sim/resolve.js';
import { cpUsage, validateOrders } from '../js/sim/orders.js';
import { aiOrders, aiMemory } from '../js/ai/ai.js';
import { canSee, visibleTo } from '../js/sim/vision.js';
import { placeError, addBuilding, incomeOf, obstacles, startQueues, armySize } from '../js/sim/base.js';
import { builderPlan } from '../js/sim/builders.js';
import { buildStancePlan } from '../js/sim/stances.js';
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
  s.explored = s.explored.map(g => '1'.repeat(g.length));   // the whole table counts as seen (tests of the seen rule set their own)
  return s;
}
const orders = (squads = {}, stances = {}) => ({ squads, stances });
const plan = (actions, extra = {}) => ({ ...emptyPlan(), actions, ...extra });
const holdAll = s => { const o = [orders(), orders()]; for (const q of s.squads) o[q.owner].stances[q.id] = 'hold'; return o; };
const events = log => log.segments.flatMap(sg => sg.events.map(e => ({ ...e, seg: sg })));

console.log('Simulation');

test('createGame deploys small starting armies (kingdom: hero, warrior, builder; undead: hero, a warband pair)', () => {
  const s = createGame(1);
  eq(s.squads.filter(q => q.owner === 0).map(q => q.role).sort().join(), 'builder,fighter,hero');
  eq(s.squads.filter(q => q.owner === 1).map(q => q.role).sort().join(), 'hero,swarm,swarm', 'the swarm deploys as a pair');
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
  ok(hit, 'no hit'); eq(hit.raw, Math.round(d2.attack.dmg * 2));
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
  const s = arena([[0, 'hero', 6, 6], [0, 'builder', 6, 9], [0, 'builder', 6, 12], [0, 'fighter', 9, 4], [0, 'tank', 9, 8], [0, 'ranged', 9, 12], [0, 'fast', 9, 16], [0, 'fighter', 9, 20]]);
  const o = emptyOrders();
  for (const q of s.squads.filter(q => q.owner === 0)) o.squads[q.id] = plan([{ kind: 'wait', ap: 10 }]);
  const cp = cpUsage(s, 0, o);
  eq(cp.accepted.length, RULES.cp + 3, 'hero and both builders are free');
  const v = validateOrders(s, 0, o);
  eq(Object.keys(v.squads).length, RULES.cp + 3);
});

test('orders over 100 AP are trimmed by validation', () => {
  const s = createGame(1);
  const o = emptyOrders();
  o.squads.q1 = plan([{ kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }]);
  const v = validateOrders(s, 0, o);
  const used = v.squads.q1.actions.length * defOf(s.squads[0]).attack.ap;
  ok(used <= RULES.ap, 'used ' + used);
});

test('AI vs AI: most games finish (no round limit; on the big maps the AI attacks in waves)', () => {
  const finished = (map, seeds) => seeds.filter(seed => {
    let s = createGame(seed, ['kingdom', 'undead'], map); const mem = [aiMemory(), aiMemory()];
    while (s.winner === null && s.round < 80) s = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]).state;
    return s.winner !== null;
  }).length;
  const c = finished('crossing', [1, 2, 3, 4, 5, 6]), t = finished('twinrivers', [1, 2, 3, 4]);
  ok(c >= 4, 'crossing: ' + c + ' of 6 finished');
  ok(t >= 3, 'twin rivers: ' + t + ' of 4 finished');
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
  ok(Math.hypot(q1.x - q2.x, q1.z - q2.z) <= radiusOf(q1) + radiusOf(q2) + 0.35, 'should end in contact (the struck squad shrinks as it loses a model)');
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

test('Rally gives nearby allies extra armour and a defend', () => {
  const s = arena([[0, 'hero', 30, 16], [0, 'ranged', 32, 17], [1, 'ranged', 32, 26]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'rally', x: 30, z: 16 }]);
  o[1].squads.q3 = plan([{ kind: 'wait', ap: 40 }, { kind: 'volley', x: 32, z: 17 }]);
  const { log } = resolveRound(s, o);
  const buff = events(log).find(e => e.type === 'buff');
  ok(buff && buff.ids.includes('q2') && buff.armor === 4, 'rally reaches the crossbows with +4 armour');
  const h = events(log).find(e => e.type === 'hit' && e.dst === 'q2');
  ok(h, 'the volley lands');
  eq(h.dmg, damageAfter(h.raw * (h.cover ? RULES.coverMult : 1), FACTIONS.kingdom.units.ranged.armor + 4, true), 'armour + 4 and the extra defend apply');
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
    eq(cats, f === 'kingdom' ? 'attack,defense,move' : 'attack,attack,defense', f);
  }
  const s = arena([[0, 'hero', 10, 16], [1, 'fighter', 16, 16], [0, 'fighter', 9, 18]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'rally', x: 10, z: 16 }, { kind: 'leap', x: 13.2, z: 16 }, { kind: 'mighty', x: 16, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const acts = events(log).filter(e => e.type === 'act' && e.id === 'q1').map(e => e.kind).join();
  eq(acts, 'rally,leap,mighty');
  const q1 = state.squads.find(q => q.id === 'q1');
  ok(q1.cd.rally > 0 && q1.cd.leap > 0 && q1.cd.mighty > 0, 'each skill has its own cooldown');
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'leap' && e.dst === 'q2'), 'Leap Strike hits at the landing');
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'mighty' && e.dst === 'q2'), 'Mighty Swing hits after the leap');
});

test('the same skill cannot be used twice in a round', () => {
  const s = arena([[0, 'hero', 10, 16], [1, 'fighter', 30, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'mighty', x: 30, z: 16 }, { kind: 'mighty', x: 30, z: 16 }]);
  const { log } = resolveRound(s, o);
  eq(events(log).filter(e => e.type === 'act' && e.kind === 'mighty').length, 1);
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

test('mage: the Necromancer casts the same spell again with mana, pays per cast, regains mana each round', () => {
  const N = FACTIONS.undead.units.hero, th = N.skills.find(k => k.kind === 'thunder');
  const s = arena([[1, 'hero', 30, 16], [0, 'fighter', 24, 16]]);
  eq(s.squads[0].mana, N.mana.start);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'thunder', x: 24, z: 16 }, { kind: 'thunder', x: 24, z: 16 }, { kind: 'thunder', x: 24, z: 16 }]);
  const v = validateOrders(s, 1, o[1]);
  eq(v.squads.q1.actions.length, Math.floor(N.mana.start / th.mana), 'only as many casts as the mana allows');
  const { state, log } = resolveRound(s, o);
  eq(events(log).filter(e => e.type === 'release' && e.kind === 'thunder').length, 2, 'cast twice in one round (no cooldown)');
  const q1 = state.squads.find(q => q.id === 'q1');
  eq(q1.mana, N.mana.start - 2 * th.mana + N.mana.regen, 'paid per cast, then regained');
  ok(!q1.cd.thunder, 'mages have no cooldowns');
});

test('Dark Thunder strikes the target, then chains to nearby enemies with weaker jumps', () => {
  const s = arena([[1, 'hero', 30, 4], [0, 'fighter', 22, 4], [0, 'fighter', 19, 4.5], [0, 'ranged', 16, 5], [0, 'tank', 6, 4]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'thunder', x: 22, z: 4 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.kind === 'thunder');
  eq(rel.hit.join(), 'q2,q3,q4', 'first target, then the two in reach; the far tank is out of reach');
  const raw = events(log).filter(e => e.type === 'hit' && e.kind === 'thunder').map(e => e.raw);
  ok(raw[0] > raw[1] && raw[1] > raw[2], 'each jump is weaker: ' + raw);
});

test('Summon Warband: two squads rise when it is cast (hittable, but they don\'t act that round) and crumble after 3 more rounds; not in the army cap', () => {
  // a kingdom tower fires after all the tiers: at the nearest enemy, which by then is a summoned squad
  const s = arena([[1, 'hero', 31, 4]]);
  addBuilding(s, 0, 'tower', 22, 4, 0, true);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'summon', x: 27.5, z: 4 }]);
  let r = resolveRound(s, o);
  const mid = events(r.log).filter(e => e.type === 'spawn' && e.mid);
  eq(mid.length, 2, 'they appear during the round');
  ok(!events(r.log).some(e => e.type === 'act' && mid.some(m => m.id === e.id)), 'and do nothing that round');
  ok(events(r.log).some(e => e.type === 'hit' && mid.some(m => m.id === e.dst)), 'but can be hit at once');
  r.state.buildings = r.state.buildings.filter(b => b.type !== 'tower');   // no more tower fire from here on
  const sum = r.state.squads.filter(q => q.role === 'summon');
  eq(sum.length, 2, 'two squads'); ok(sum.every(q => q.ttl === RULES.summonTtl), 'ttl ' + sum.map(q => q.ttl));
  eq(armySize(r.state, 1), 1, 'summons are not in the army cap');
  for (let i = 0; i < 2; i++) r = resolveRound(r.state, holdAll(r.state));
  eq(r.state.squads.filter(q => q.role === 'summon').length, 2, 'still there after 2 more rounds');
  r = resolveRound(r.state, holdAll(r.state));
  eq(r.state.squads.filter(q => q.role === 'summon').length, 0, 'crumbled at the end of their 3rd round');
  ok(events(r.log).filter(e => e.type === 'crumble').length === 2);
});

test('Corpse Explosion bursts a summoned squad and hits the enemies around it (no souls)', () => {
  const s = arena([[1, 'hero', 30, 16], [0, 'fighter', 22.2, 16], [0, 'tank', 21, 17.8]]);
  const z = addSquad(s, 1, 'summon', 21, 16); z.ttl = 2;
  addBuilding(s, 1, 'well', 31.5, 19.5, 0, true);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'explode', x: 21, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.kind === 'explode');
  ok(rel && rel.burst === z.id && rel.hit.length === 2, 'both enemies caught: ' + JSON.stringify(rel));
  ok(!state.squads.some(q => q.id === z.id), 'the summoned squad is gone');
  const raw = events(log).find(e => e.type === 'hit' && e.kind === 'explode').raw;
  const sk = FACTIONS.undead.units.hero.skills.find(k => k.kind === 'explode');
  eq(raw, sk.base + sk.perModel * 3);
});

test('Mighty Swing stuns: the target\'s actions wait; leftover stun carries into the next round', () => {
  const s = arena([[0, 'hero', 20, 16], [1, 'fighter', 22.4, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'mighty', x: 22.4, z: 16 }]);
  o[1].squads.q2 = plan([{ kind: 'wait', ap: 40 }, { kind: 'move', pts: [{ x: 30, z: 16 }], ap: 30 }]);
  const { state, log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'stun' && e.id === 'q2'), 'stunned');
  const sk = FACTIONS.kingdom.units.hero.skills.find(k => k.kind === 'mighty');
  ok(sk.stun === 25 && sk.reach > FACTIONS.kingdom.units.hero.attack.reach, 'longer reach than the basic swing');
  ok(events(log).some(e => e.type === 'stunned' && e.id === 'q2'), 'its actions were held up');
});

test('Leap Strike clears a wall and shoves enemies at the landing', () => {
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
  const { log } = resolveRound(s, [orders({}, { q1: 'guard' }), { squads: {}, stances: { q2: 'hold' } }]);
  ok(!events(log).some(e => e.type === 'act' && e.id === 'q1'), 'guard squad does not react');
});

console.log('Revive, auto skills, the swarm, forests');
test('a fallen hero comes back after its side holds the spot for 3 rounds (enemies inside don\'t stop it)', () => {
  const s = arena([[0, 'hero', 20, 4, { hp: 1 }], [1, 'ranged', 30, 4], [0, 'fighter', 17, 4]]);
  const o = holdAll(s); o[1].squads.q2 = plan([{ kind: 'volley', x: 20, z: 4 }]);
  let r = resolveRound(s, o);
  ok(!r.state.squads.some(q => q.role === 'hero' && q.owner === 0), 'the hero fell');
  const z = r.state.revive[0]; ok(z && Math.abs(z.x - 20) < 0.5 && Math.abs(z.z - 4) < 0.5, 'a revive zone where it fell');
  // nobody inside: no progress
  const away = r.state; away.squads.find(q => q.id === 'q3').x = 8;
  let r2 = resolveRound(away, holdAll(away));
  eq(r2.state.revive[0].progress, 0, 'empty zone: no progress');
  // a squad (and an enemy) inside: 3 rounds
  const st = r.state; st.squads.find(q => q.id === 'q3').x = 19; st.squads.find(q => q.id === 'q2').x = 22; st.squads.find(q => q.id === 'q2').z = 5;
  r = { state: st };
  for (let i = 0; i < 3; i++) r = resolveRound(r.state, holdAll(r.state));
  const h = r.state.squads.find(q => q.owner === 0 && q.role === 'hero');
  ok(h, 'revived'); eq(h.hp, Math.round(FACTIONS.kingdom.units.hero.hpPer * RULES.reviveHp), 'at half HP');
  ok(!r.state.revive[0], 'the zone is gone');
});

test('stance squads use their skills on their own unless auto skills is switched off', () => {
  const mk = auto => { const s = arena([[0, 'hero', 20, 4], [1, 'fighter', 22.6, 4]]); if (!auto) s.squads[0].auto = false; s.squads[0].stance = 'guard'; return s; };
  const used = s => events(resolveRound(s, [orders(), { squads: {}, stances: { q2: 'hold' } }]).log).some(e => e.type === 'act' && e.id === 'q1' && ['mighty', 'rally', 'leap'].includes(e.kind));
  ok(used(mk(true)), 'auto: the hero swings its Mighty Swing');
  ok(!used(mk(false)), 'off: basic swings only');
  const s = mk(true);
  const r = resolveRound(s, [{ squads: {}, stances: {}, auto: { q1: false } }, orders()]);
  eq(r.state.squads[0].auto, false, 'switched off by order');
});

test('the Skeleton Warband swarm trains in pairs (one round), fragile and fast; Skeleton Warriors are the old warband', () => {
  const U = FACTIONS.undead.units;
  eq(U.swarm.pair, 2); ok(U.swarm.hpPer < U.fighter.hpPer && U.swarm.tier > U.fighter.tier); eq(U.fighter.name, 'Skeleton Warriors');
  eq(RULES.trainRounds.swarm, 1);
  const s = arena([[1, 'fighter', 40, 4]]); s.supply[1] = 100;
  const crypt = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  const r = resolveRound(s, [orders(), { squads: {}, stances: {}, queue: { trains: { [crypt.id]: ['swarm'] } } }]);
  eq(r.state.squads.filter(q => q.owner === 1 && q.role === 'swarm').length, 2, 'two squads from one training');
  eq(armySize(r.state, 1), 3, 'both count toward the cap');
  const full = arena([[1, 'fighter', 40, 4]]); full.supply[1] = 100; full.board.cap = 2;
  eq(startQueues(full, 1, { tq: { [crypt.id]: ['swarm'] } }).trains[crypt.id][0].wait, 'cap', 'needs room for both');
});

test('buildings only on ground the side has seen; undead buildings only on their graves', () => {
  const s = createGame(2);
  const far = s.board.w - 14;
  eq(placeError(s, 0, 'tower', far, 10), 'You haven\'t seen that spot yet');
  // once a squad has looked there, it is allowed
  const q = s.squads.find(x => x.owner === 0 && x.role === 'fighter'); q.x = far - 4; q.z = 10;
  const r = resolveRound(s, [{ squads: {}, stances: { [q.id]: 'hold' } }, orders()]);
  ok(placeError(r.state, 0, 'tower', far, 10) !== 'You haven\'t seen that spot yet', 'seen now');
  const u = arena([[1, 'fighter', 40, 4]]);
  eq(placeError(u, 1, 'tower', 30, 9.5), 'Undead buildings must stand on your graves');
  eq(placeError(u, 1, 'tower', 40, 12), '', 'on the Crypt\'s graves');
  ok(placeError(u, 1, 'well', 31.5, 12.5) === 'Undead buildings must stand on your graves', 'a Soul Well needs graves too');
});

test('forests slow movement less, and you can build anywhere', () => {
  eq(RULES.forestSlow, 0.75);
  const s = arena([[0, 'builder', 7, 9], [1, 'fighter', 41, 23]]);
  eq(placeError(s, 0, 'tower', 34, 10), '', 'a tower in the enemy half is allowed');
});

console.log('Stances');
test('squads start on Advance (builders on Guard)', () => {
  const s = createGame(1);
  ok(s.squads.filter(q => q.role !== 'builder').every(q => q.stance === 'advance'));
  ok(s.squads.filter(q => q.role === 'builder').every(q => q.stance === 'guard'));
});

test('Advance with a target point marches there over the rounds, then guards it', () => {
  const s = arena([[0, 'fighter', 6, 4]]);
  let r = resolveRound(s, [{ squads: {}, stances: {}, goals: { q1: { x: 14, z: 6 } } }, orders()]);
  let q = r.state.squads[0];
  ok(q.goal && q.stance === 'advance', 'goal stored, stance advance');
  ok(q.x > 9, 'walked toward it: ' + q.x);
  r = resolveRound(r.state, [orders(), orders()]);
  q = r.state.squads[0];
  ok(Math.hypot(q.x - 14, q.z - 6) <= RULES.goalReach + 0.6, 'arrived');
  const x1 = q.x;
  r = resolveRound(r.state, [orders(), orders()]);
  ok(Math.abs(r.state.squads[0].x - x1) < 0.3, 'and stays there');
  r = resolveRound(r.state, [{ squads: {}, stances: {}, goals: { q1: null } }, orders()]);
  ok(!r.state.squads[0].goal, 'cleared');
});

test('Advance treats squads, buildings and the HQ alike: the nearest one is attacked', () => {
  // an enemy tower right next to the squad, an enemy squad further away (both seen)
  const s = arena([[0, 'fighter', 30, 8], [1, 'fighter', 30, 17]]);
  const tw = addBuilding(s, 1, 'tower', 33, 8, 0, true);
  s.intel[0].known[tw.id] = { id: tw.id, owner: 1, type: 'tower', x: tw.x, z: tw.z, r: tw.r, hp: tw.hp, build: 0 };
  const { log } = resolveRound(s, [orders(), { squads: {}, stances: { q2: 'hold' } }]);
  ok(events(log).some(e => e.type === 'hit' && e.src === 'q1' && e.dst === tw.id), 'it attacks the nearer tower, not the squad');
});

test('Retreat falls back to the nearest own mine / soul well, else the HQ', () => {
  const s = arena([[0, 'fighter', 24, 12], [0, 'tank', 24, 26]]);
  addBuilding(s, 0, 'mine', 16.5, 19.5, 0, true);
  s.squads[1].hp = 1; s.squads[1].models = 1;
  const r = resolveRound(s, [orders({}, { q1: 'retreat', q2: 'retreat' }), orders()]);
  const q1 = r.state.squads.find(q => q.id === 'q1'), q2 = r.state.squads.find(q => q.id === 'q2');
  const pl = buildStancePlan(s, { ...s.squads[0], stance: 'retreat' }, []), end = pl.actions[0].pts.slice(-1)[0];
  ok(Math.hypot(end.x - 16.5, end.z - 19.5) < 5, 'its path ends at the mine');
  ok(Math.hypot(q1.x - 24, q1.z - 12) > 2, 'and it walks');
  ok(Math.hypot(q2.x - 16.5, q2.z - 19.5) < Math.hypot(24 - 16.5, 26 - 19.5), 'the other too (nearest fallback)');
  eq(r.state.squads[0].stance, 'retreat');
});

test('a building locked onto a squad keeps training it; queued squads go first', () => {
  const s = arena([[0, 'builder', 7, 9], [1, 'fighter', 41, 23]]); s.supply[0] = 300;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const qo = (queue = {}) => ({ squads: {}, stances: {}, queue }), ob = () => ({ squads: {}, stances: {} });
  let r = resolveRound(s, [qo({ repeat: { [b.id]: 'fighter' }, trains: { [b.id]: ['ranged'] } }), ob()]);
  let B = r.state.buildings.find(x => x.id === b.id);
  eq(B.repeat, 'fighter'); eq(B.train.role, 'ranged', 'the queue first');
  for (let i = 0; i < 2; i++) r = resolveRound(r.state, [ob(), ob()]);
  B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train?.role, 'fighter', 'then the locked squad, with no new orders');
  for (let i = 0; i < 2; i++) r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(x => x.id === b.id).train?.role, 'fighter', 'and again');
  ok(r.state.squads.filter(q => q.owner === 0 && q.role === 'fighter').length >= 1, 'the first locked fighter is out');
  r = resolveRound(r.state, [qo({ repeat: { [b.id]: null } }), ob()]);
  ok(!r.state.buildings.find(x => x.id === b.id).repeat, 'unlocked');
});

test('fast squads hit hard but rarely (2 swings a round)', () => {
  for (const f of ['kingdom', 'undead']) {
    const a = FACTIONS[f].units.fast.attack;
    eq(Math.floor(RULES.ap / a.ap), 2, f);
    ok(a.dmg * FACTIONS[f].units.fast.models >= 25, f + ' strong per hit');
  }
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

const k = () => arena([[0, 'builder', 7, 9], [1, 'fighter', 41, 23]]);
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
test('a builder puts up a new building over its work (a farm takes it into a second round)', () => {
  const s = k();
  const q = s.squads[0], f = { type: 'farm', x: 6, z: 5, w: 2.6, d: 2.2 };
  const o = [ob([{ type: 'farm', x: 6, z: 5 }]), ob()];
  o[0].squads = workOrder(s, q, f);
  let r = resolveRound(s, o);
  let b = r.state.buildings.find(x => x.type === 'farm');
  ok(b && b.build > 0 && b.build < BUILDINGS.farm.work, 'site placed and worked on');
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start - BUILDINGS.farm.cost + FACTIONS.kingdom.eco.hq, 'paid; no farm income yet');
  r = resolveRound(r.state, [ob(), ob()]);
  b = r.state.buildings.find(x => x.type === 'farm');
  eq(b.build, 0, 'finished in round 2 (the builder kept at it)'); eq(b.hp, BUILDINGS.farm.hp, 'full hp');
  ok(events(r.log).some(x => x.type === 'built' && x.by === q.id), 'built by the builder');
});

test('two builders stack; a builder further away walks over and works when it arrives', () => {
  const s = arena([[0, 'builder', 7, 4], [0, 'builder', 7, 9.5], [0, 'builder', 10, 28]]);
  const b = addBuilding(s, 0, 'tower', 7, 6.8, 0, false);
  const o = holdAll(s);
  for (const id of ['q1', 'q2']) o[0].squads[id] = plan([{ kind: 'work', x: b.x, z: b.z, ap: 100 }]);
  o[0].squads.q3 = plan([{ kind: 'work', x: b.x, z: b.z, ap: 100 }]);
  const r = resolveRound(s, o);
  eq(r.state.buildings.find(x => x.id === b.id).build, 0, '2 x 100 AP of work finishes a 200-work tower');
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
      if (r.state.buildings.some(b => b.type === 'barracks' && b.owner === 0 && b.build < BUILDINGS.barracks.work) || Math.hypot(q2.x - q.x, q2.z - q.z) > 4) built++;
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
  for (let i = 0; i < 4 && r.state.buildings.find(x => x.id === b.id).build > 0; i++) r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(x => x.id === b.id).build, 0, 'finished over the next rounds with no orders');
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.squads[0].task.kind, 'gather', 'walks to the farm');
  r = resolveRound(r.state, [ob(), ob()]);
  ok(events(r.log).some(e => e.type === 'gather' && e.owner === 0 && e.amount >= 7), 'and gathers a full round there');
});

test('gathering: four farmers per (big) farm, two per mine; builders are not in the army cap', () => {
  const s = arena([[0, 'builder', 11, 2.5], [0, 'builder', 11, 5], [0, 'builder', 11, 7.5], [0, 'builder', 11, 10], [0, 'builder', 7, 11]]);
  const f = addBuilding(s, 0, 'farm', 6.5, 6, 0, true);
  const o = [ob(), ob()];
  for (const q of s.squads) o[0].squads[q.id] = plan([{ kind: 'work', x: f.x, z: f.z, ap: 100 }]);
  const r = resolveRound(s, o);
  const g = events(r.log).filter(e => e.type === 'gather');
  eq(g.filter(e => e.owner === 0).length, 4, 'four farmers at the farm');
  ok(events(r.log).some(e => e.type === 'workFail' && e.full), 'the fifth is turned away');
  eq(armySize(s, 0), 0, 'builders do not count toward the army cap');
  eq(BUILDINGS.farm.w * BUILDINGS.farm.d > 14, true, 'farms are big');
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
  eq(r.state.buildings.find(x => x.id === b.id).hp, 72, '40 AP x 110 HP / 200 work');
});

test('builders cost no command points; the HQ trains builders, barracks soldiers', () => {
  const s = createGame(1);
  const sq = {}; for (const q of s.squads.filter(q => q.owner === 0)) sq[q.id] = plan([]);
  const u = cpUsage(s, 0, { squads: sq });
  eq(u.accepted.length, 3, 'hero + builder (free) + the warrior');
  const hq = s.buildings.find(b => b.owner === 0 && b.type === 'hq');
  const v = validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'builder' }]));
  eq(v.queue.tq[hq.id].length, 1);
  eq(validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'fighter' }])).queue.tq[hq.id].length, 1, 'the Keep also trains Men-at-arms');
  eq(validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'ranged' }])).queue.tq[hq.id].length, 0, 'but no other soldiers');
  const hq1 = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  eq(validateOrders(s, 1, ob([], [{ bid: hq1.id, role: 'swarm' }])).queue.tq[hq1.id].length, 1, 'the crypt raises skeleton warbands (the swarm)');
  eq(validateOrders(s, 1, ob([], [{ bid: hq1.id, role: 'builder' }])).queue.tq[hq1.id].length, 0, 'the undead have no builders');
});

test('training takes rounds: a fighter appears at the end of its second round', () => {
  const s = k();
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const n0 = s.squads.filter(q => q.owner === 0).length;
  let r = resolveRound(s, [ob([], [{ bid: b.id, role: 'fighter' }]), ob()]);
  eq(r.state.squads.filter(q => q.owner === 0).length, n0, 'not yet');
  eq(r.state.buildings.find(x => x.id === b.id).train.left, 1, 'one round to go');
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start - trainCost('kingdom', 'fighter') + incomeOf(r.state, 0), 'paid up front');
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.squads.filter(q => q.owner === 0).length, n0 + 1);
  ok(events(r.log).some(e => e.type === 'spawn' && e.role === 'fighter'));
  eq(RULES.trainRounds.tank, 3); eq(RULES.trainRounds.builder, 1);
});

// ---- production queues ----
const qo = (queue = {}, extra = {}) => ({ squads: {}, stances: {}, queue, ...extra });
console.log('Production queues');
test('training queue: each squad is paid when it starts, and they come out one after another', () => {
  const s = k(); s.supply[0] = 100;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  let r = resolveRound(s, [qo({ trains: { [b.id]: ['fighter', 'fighter', 'ranged'] } }), ob()]);
  let B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train.role, 'fighter'); eq(B.queue.join(), 'fighter,ranged', 'two still waiting');
  eq(r.state.supply[0], 100 - trainCost('kingdom', 'fighter') + incomeOf(r.state, 0), 'only the first is paid');
  r = resolveRound(r.state, [ob(), ob()]);
  ok(events(r.log).some(e => e.type === 'spawn' && e.role === 'fighter'), 'first fighter out after 2 rounds');
  r = resolveRound(r.state, [ob(), ob()]);
  B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train.role, 'fighter', 'the next one started the round after, with no new orders'); eq(B.queue.join(), 'ranged');
});

test('an unaffordable front item waits and nothing behind it jumps ahead', () => {
  const s = k(); s.supply[0] = 25;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const fc = startQueues(s, 0, { tq: { [b.id]: ['tank', 'fighter'] } });
  eq(fc.trains[b.id][0].wait, 'gold'); eq(fc.trains[b.id][0].need, 5); eq(fc.trains[b.id][1].wait, 'line');
  let r = resolveRound(s, [qo({ trains: { [b.id]: ['tank', 'fighter'] } }), ob()]);
  let B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train, null, 'the tank waits (25 < 30) and the fighter (24) does not jump ahead'); eq(r.state.supply[0], 25 + incomeOf(r.state, 0));
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(x => x.id === b.id).train.role, 'tank', 'starts once income arrives');
});

test('the army cap holds the queue; cancelling a waiting item is free, stopping training refunds it', () => {
  const s = k(); s.supply[0] = 100;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  s.board.cap = armySize(s, 0);
  eq(startQueues(s, 0, { tq: { [b.id]: ['fighter'] } }).trains[b.id][0].wait, 'cap');
  s.board.cap = 8;
  let r = resolveRound(s, [qo({ trains: { [b.id]: ['fighter', 'tank'] } }), ob()]);
  const paid = r.state.supply[0];
  r = resolveRound(r.state, [qo({ trains: { [b.id]: [] }, cancel: [b.id] }), ob()]);
  const B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train, null); eq(B.queue.length, 0);
  eq(r.state.supply[0], paid + trainCost('kingdom', 'fighter') + incomeOf(r.state, 0), 'fighter refunded, the tank cost nothing');
  ok(events(r.log).some(e => e.type === 'trainCancel'));
});

test('queues hold at most 5 items', () => {
  const s = k(); s.supply[0] = 400;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const v = validateOrders(s, 0, qo({ trains: { [b.id]: Array(7).fill('fighter') }, builds: [4, 13, 20, 23, 26, 29, 11].map(z => ({ type: 'wall', x: 9, z })) }));
  eq(v.queue.tq[b.id].length, RULES.queueMax); eq(v.queue.bq.length, RULES.queueMaxBuild);
});

test('base queue: one builder takes one site at a time; two builders start two at once', () => {
  const one = k(); one.supply[0] = 200;
  const q2 = [{ type: 'farm', x: 6, z: 5 }, { type: 'tower', x: 10, z: 13 }];
  let r = resolveRound(one, [qo({ builds: q2 }), ob()]);
  eq(r.state.buildings.filter(b => b.owner === 0 && b.build > 0).length, 1, 'one site');
  eq(r.state.bq[0].length, 1); eq(r.state.bq[0][0].type, 'tower', 'the tower waits for a free builder');
  eq(startQueues(r.state, 0).builds[0].wait, 'builders');
  for (let i = 0; i < 6 && r.state.bq[0].length; i++) r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.bq[0].length, 0, 'the tower started once the farm was done');
  ok(r.state.buildings.some(b => b.type === 'farm' && !b.build));
  const two = arena([[0, 'builder', 7, 9], [0, 'builder', 9, 8], [1, 'fighter', 41, 23]]); two.supply[0] = 200;
  r = resolveRound(two, [qo({ builds: q2 }), ob()]);
  eq(r.state.buildings.filter(b => b.owner === 0 && b.build > 0).length, 2, 'both start in the same round');
  ok(r.state.squads.filter(q => q.owner === 0).every(q => q.task && q.task.kind === 'build'), 'and each builder took one');
  ok(new Set(r.state.squads.filter(q => q.owner === 0).map(q => q.task.bid)).size === 2, 'different sites');
});

test('an idle builder walks to a far queued site (no distance limit)', () => {
  const s = arena([[0, 'builder', 7, 4]]); s.supply[0] = 100;
  let r = resolveRound(s, [qo({ builds: [{ type: 'tower', x: 12, z: 28 }] }), ob()]);
  const b = r.state.buildings.find(x => x.type === 'tower');
  ok(b, 'site placed'); eq(r.state.squads[0].task?.bid, b.id, 'the builder took it');
  for (let i = 0; i < 4; i++) r = resolveRound(r.state, [ob(), ob()]);
  ok(r.state.buildings.find(x => x.id === b.id).build < BUILDINGS.tower.work, 'and works on it');
});

test('queued builds: a squad on the spot makes it wait; a building on it drops it; reorder keeps ids', () => {
  const s = k(); s.supply[0] = 200;
  let r = resolveRound(s, [qo({ builds: [{ type: 'tower', x: 7, z: 9 }] }), holdAll(s)[1]]);   // the builder stands there
  // the builder is on Hold? no: it has no orders, so it may walk off; the item either waited or started
  const st = r.state;
  const w = startQueues(st, 0, { bq: [{ qid: 'x', type: 'wall', x: st.squads[0].x, z: st.squads[0].z, rot: 0 }] });
  eq(w.builds[0].wait === 'blocked' || w.builds[0].wait === 'builders', true, 'a squad on the spot: wait, not drop');
  const t = k(); t.supply[0] = 10;   // too poor: items wait in the queue
  r = resolveRound(t, [qo({ builds: [{ type: 'farm', x: 6, z: 5 }, { type: 'wall', x: 10, z: 4 }] }), ob()]);
  const ids = r.state.bq[0].map(i => i.qid);
  eq(ids.length, 2); ok(ids[0] && ids[1] && ids[0] !== ids[1], 'stable ids');
  r = resolveRound(r.state, [qo({ builds: r.state.bq[0].slice().reverse() }), ob()]);
  eq(r.state.bq[0].length >= 1, true);
  ok(events(r.log).some(e => e.type === 'construct' && e.btype === 'wall' && e.qid === ids[1]) || r.state.bq[0][0].qid === ids[1], 'the wall moved to the front');
  const u = r.state; u.supply[0] = 0;
  const far = u.bq[0].find(i => i.type === 'farm');
  addBuilding(u, 0, 'barracks', far.x, far.z, 0, true);
  r = resolveRound(u, [ob(), ob()]);
  ok(events(r.log).some(e => e.type === 'queueDrop' && e.qid === far.qid), 'a building on the spot drops it');
  ok(!r.state.bq[0].some(i => i.qid === far.qid));
});

test('queues are deterministic and survive several rounds without orders', () => {
  const run = () => { const s = k(); s.supply[0] = 30; const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
    let r = resolveRound(s, [qo({ trains: { [b.id]: ['fighter', 'ranged', 'fighter'] }, builds: [{ type: 'farm', x: 6, z: 9.5 }] }), ob()]);
    for (let i = 0; i < 8; i++) r = resolveRound(r.state, [ob(), ob()]);
    return r.state; };
  const a = run();
  eq(JSON.stringify(a), JSON.stringify(run()));
  ok(a.squads.filter(q => q.owner === 0 && q.role !== 'builder').length >= 2, 'queued squads came out over the rounds');
});

test('gold: a finished mine owns its site and pays every round', () => {
  const s = k();
  addBuilding(s, 0, 'mine', 16.5, 19.5, 0, true);
  const r = resolveRound(s, holdAll(s));
  eq(r.state.shrines[0].owner, 0);
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start + FACTIONS.kingdom.eco.hq + BUILDINGS.mine.income);
  ok(placeError(r.state, 1, 'well', 16.5, 19.5), 'the site is taken');
});

test('souls: only models dying on undead grave ground pay (either side); the graveyard widens; no Crypt income', () => {
  // a kingdom model dies inside the soul well's graveyard (souls); another dies next to the warriors far from any graves (none)
  const s = arena([[1, 'fighter', 18.4, 19.5], [0, 'fighter', 20.3, 19.5, { hp: 2, models: 1 }], [1, 'fighter', 30, 29], [0, 'fighter', 31.9, 29, { hp: 2, models: 1 }]]);
  const w = addBuilding(s, 1, 'well', 16.5, 19.5, 0, true); w.grave = 5;
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'swing', x: 20.3, z: 19.5 }]);
  o[1].squads.q3 = plan([{ kind: 'swing', x: 31.9, z: 29 }]);
  const r = resolveRound(s, o);
  const souls = events(r.log).filter(e => e.type === 'souls');
  ok(events(r.log).filter(e => e.type === 'hit' && e.lost).length === 2, 'two models fell');
  ok(souls.length === 1 && souls[0].owner === 1 && souls[0].amount === RULES.soulPerModel, 'only the one on the graves: ' + JSON.stringify(souls));
  eq(FACTIONS.undead.eco.hq, 0, 'the Crypt earns nothing by itself');
  eq(r.state.supply[1], FACTIONS.undead.eco.start + RULES.soulPerModel + BUILDINGS.well.income);
  const w2 = r.state.buildings.find(b => b.id === w.id);
  ok(w2.graveCap > BUILDINGS.well.grave && w2.grave === w2.graveCap, 'it widened beyond its reach (death) and filled it: ' + w2.grave);
});

test('graveyards spread almost at once to their building\'s reach; a destroyed building leaves its graves', () => {
  const s = arena([[1, 'fighter', 40, 4]]);
  const crypt = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  eq(createGame(1).buildings.find(b => b.owner === 1).grave, RULES.graveHqStart, 'the Crypt starts on graves');
  const w = addBuilding(s, 1, 'well', 31.5, 12.5, 0, true);
  let r = resolveRound(s, holdAll(s));
  eq(r.state.buildings.find(b => b.id === w.id).grave, BUILDINGS.well.grave, 'graves spread at once: the full 10" by the end of the round');
  eq(r.state.buildings.find(b => b.id === crypt.id).grave, BUILDINGS.hq.grave, 'the Crypt at its full reach');
  // a new undead site spreads half its graves the moment it is placed
  const q = arena([[1, 'fighter', 40, 4]]); q.supply[1] = 100;
  const r1 = resolveRound(q, [orders(), { squads: {}, stances: {}, queue: { builds: [{ type: 'tower', x: 40, z: 12 }] } }]);
  const tw = r1.state.buildings.find(b => b.type === 'tower');
  eq(tw.grave, BUILDINGS.tower.grave, 'full by the end of its first round');
  ok(events(r1.log).some(e => e.type === 'graves' && e.id === tw.id));
  r.state.buildings.find(b => b.id === w.id).hp = 0;
  r = resolveRound(r.state, holdAll(r.state));
  ok(r.state.graves[1].some(g => g.x === 31.5 && g.r === BUILDINGS.well.grave), 'its graveyard stays');
  ok(placeError(r.state, 1, 'barracks', 24, 16) === '' || placeError(r.state, 1, 'barracks', 24, 16) !== 'Only in your third of the table', 'and you can build anywhere');
});

test('undead buildings rise out of the ground with no builders (two at a time) and mend', () => {
  const s = arena([[1, 'fighter', 40, 4]]); s.supply[1] = 200;
  let r = resolveRound(s, [ob(), qo({ builds: [{ type: 'tower', x: 40, z: 10 }, { type: 'banner', x: 41.5, z: 21 }, { type: 'wall', x: 40, z: 22.5 }] })]);
  eq(r.state.buildings.filter(b => b.owner === 1 && b.build > 0).length, 2, 'two rise at once');
  eq(r.state.bq[1].length, 1, 'the third waits');
  eq(startQueues(r.state, 1).builds[0].wait, 'rising');
  const tw = r.state.buildings.find(b => b.type === 'tower');
  eq(tw.build, BUILDINGS.tower.work - RULES.riseWork, 'rose by riseWork at the end of the round');
  for (let i = 0; i < 3; i++) r = resolveRound(r.state, [ob(), ob()]);
  const t2 = r.state.buildings.find(b => b.type === 'tower');
  eq(t2.build, 0, 'finished by itself'); eq(t2.hp, BUILDINGS.tower.hp);
  t2.hp = 50; r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(b => b.type === 'tower').hp, 50 + Math.round(BUILDINGS.tower.hp * RULES.undeadMend), 'mends a little every round');
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
  eq(s.board.zone, Math.round(80 / 3)); eq(s.board.cap, RULES.armyCap + 8); eq(RULES.armyCap, 30);
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

test('AI waves: on a big map the AI gathers, then its wave reaches a passive player\'s base', () => {
  let s = createGame(3, ['kingdom', 'undead'], 'greatfield'); const mem = aiMemory();
  const phases = new Set(); let closest = 1e9;
  const hq0 = () => s.buildings.find(b => b.owner === 0 && b.type === 'hq');
  for (let r = 0; r < 30 && s.winner === null; r++) {
    const ai = aiOrders(s, 1, mem);
    phases.add(mem.wave.phase);
    const passive = { squads: {}, stances: Object.fromEntries(s.squads.filter(q => q.owner === 0).map(q => [q.id, 'hold'])) };   // squads start on Advance now
    s = resolveRound(s, [passive, ai]).state;
    const h = hq0(); if (h) for (const q of s.squads.filter(q => q.owner === 1 && q.role !== 'builder')) closest = Math.min(closest, Math.hypot(q.x - h.x, q.z - h.z));
  }
  ok(phases.has('gather') && phases.has('attack'), 'gathers and attacks: ' + [...phases]);
  ok(closest < 14 || s.winner === 1, 'the wave reached the base (closest ' + closest.toFixed(1) + ')');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
