// Headless tests for the V4 simulation. Run: node v4/tests/sim.test.mjs
import { RULES } from '../js/data/units.js';
import { createGame, addSquad, defOf, radiusOf, emptyOrders, emptyPlan } from '../js/sim/state.js';
import { resolveRound, damageAfter, engagedWith } from '../js/sim/resolve.js';
import { cpUsage, validateOrders } from '../js/sim/orders.js';
import { aiOrders, aiMemory } from '../js/ai/ai.js';
import { Nav, walkAP } from '../js/sim/nav.js';

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
  for (const [owner, role, x, z, extra] of list) Object.assign(addSquad(s, owner, role, x, z), extra || {});
  return s;
}
const orders = (squads = {}, stances = {}) => ({ squads, stances });
const plan = (actions, extra = {}) => ({ ...emptyPlan(), actions, ...extra });
const holdAll = s => { const o = [orders(), orders()]; for (const q of s.squads) o[q.owner].stances[q.id] = 'hold'; return o; };
const events = log => log.segments.flatMap(sg => sg.events.map(e => ({ ...e, seg: sg })));

console.log('V4 simulation');

test('createGame deploys 5 squads per side with full models', () => {
  const s = createGame(1);
  eq(s.squads.length, 10);
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

test('command points: 3 squads plus the hero', () => {
  const s = createGame(1);
  const o = emptyOrders();
  for (const q of s.squads.filter(q => q.owner === 0)) o.squads[q.id] = plan([{ kind: 'wait', ap: 10 }]);
  const cp = cpUsage(s, 0, o);
  eq(cp.accepted.length, RULES.cp + 1);
  const v = validateOrders(s, 0, o);
  eq(Object.keys(v.squads).length, RULES.cp + 1);
});

test('orders over 100 AP are trimmed by validation', () => {
  const s = createGame(1);
  const o = emptyOrders();
  o.squads.q1 = plan([{ kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }, { kind: 'swing', x: 30, z: 16 }]);
  const v = validateOrders(s, 0, o);
  const used = v.squads.q1.actions.length * defOf(s.squads[0]).attack.ap;
  ok(used <= RULES.ap, 'used ' + used);
});

test('AI vs AI plays to a finish within the round limit', () => {
  for (const seed of [1, 2, 3]) {
    let s = createGame(seed); const mem = [aiMemory(s), aiMemory(s)];
    while (s.winner === null) { s = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]).state; }
    ok(s.round <= RULES.roundLimit + 1, 'round ' + s.round);
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
  ok(q1.cd > 0, 'charge goes on cooldown');
});

test('a skill on cooldown is dropped from the orders', () => {
  const s = arena([[0, 'fast', 10, 4, { cd: 1 }], [1, 'fighter', 17, 4]]);
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

test('lobbed shots arc over walls that stop volleys', () => {
  const s = arena([[1, 'ranged', 22, 8], [0, 'fighter', 22, 19]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'lob', x: 22, z: 19 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q1');
  eq(rel.kind, 'lob'); eq(rel.hit.join(), 'q2');
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
    let s = createGame(seed, fac); let mem = aiMemory(s);
    while (s.winner === null) { const o = [aiOrders(s, 0, mem), aiOrders(s, 1, mem)]; mem = aiMemory(s); s = resolveRound(s, o).state; }
    if (s.winner === -1) wins.draw++; else wins[fac[s.winner]]++;
  }
  console.log('       wins over 12 games:', JSON.stringify(wins));
  ok(wins.kingdom > 0 && wins.undead > 0, 'both factions should be able to win');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
