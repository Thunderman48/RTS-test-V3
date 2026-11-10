// Headless tests for the core rules. Run: node tests/sim.test.mjs
import { CONFIG } from '../js/config.js';
import { createGame, addUnit, apFor, emptyOrders, emptyPlan } from '../js/sim/state.js';
import { resolveRound, damageAfter } from '../js/sim/resolve.js';
import { validateOrders } from '../js/sim/orders.js';
import { aiOrders } from '../js/ai/ai.js';
import { buildDigest } from '../js/ui/log.js';
import { createTutorialState, tutorialEnemyOrders } from '../js/tutorial/scenario.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

// Empty arena: no walls, HQs far away in corners, no starting units.
function arena() {
  const s = createGame(1);
  s.map.walls = [];
  s.map.nodes = [];
  s.units = [];
  s.buildings[0].x = 2; s.buildings[0].z = 2;
  s.buildings[1].x = 46; s.buildings[1].z = 30;
  return s;
}
function orders(map0 = {}, map1 = {}) {
  const o = [emptyOrders(), emptyOrders()];
  for (const [id, p] of Object.entries(map0)) o[0].units[id] = { ...emptyPlan(), ...p };
  for (const [id, p] of Object.entries(map1)) o[1].units[id] = { ...emptyPlan(), ...p };
  return o;
}
const allEvents = log => log.segments.flatMap(seg => seg.events.map(e => ({ ...e, seg: seg.kind === 'tier' ? seg.tier : seg.kind })));
const hold = { stance: 'hold' };

console.log('Rules');

test('faster tier acts first; slower unit still acts if it survives', () => {
  const s = arena();
  const a = addUnit(s, 0, 'assassin', 20, 16);
  const f = addUnit(s, 1, 'fighter', 21.3, 16);
  a.stance = f.stance = 'hold';
  const { log } = resolveRound(s, orders({ [a.id]: { actions: [{ kind: 'attack', target: f.id, moveAp: 0 }] } }, { [f.id]: { actions: [{ kind: 'attack', target: a.id, moveAp: 0 }] } }));
  const strikes = allEvents(log).filter(e => e.type === 'strike');
  assert(strikes.length === 2, 'two strikes');
  assert(strikes[0].id === a.id && strikes[0].seg === 6, 'assassin first in tier 6');
  assert(strikes[1].id === f.id && strikes[1].seg === 5, 'fighter second in tier 5');
});

test('tier upgrades change turn order (fighter +2 = tier 7 before assassin)', () => {
  const s = arena();
  const a = addUnit(s, 0, 'assassin', 20, 16);
  const f = addUnit(s, 1, 'fighter', 21.3, 16);
  const { log } = resolveRound(s, orders({ [a.id]: { actions: [{ kind: 'attack', target: f.id, moveAp: 0 }] } }, { [f.id]: { upgrades: 2, actions: [{ kind: 'attack', target: a.id, moveAp: 0 }] } }));
  const strikes = allEvents(log).filter(e => e.type === 'strike');
  assert(strikes[0].id === f.id && strikes[0].seg === 7, 'fighter acts in tier 7 first');
});

test('AP cost is duration: strike lands at t = strike AP', () => {
  const s = arena();
  const a = addUnit(s, 0, 'fighter', 20, 16);
  const b = addUnit(s, 1, 'tank', 21.3, 16);
  b.stance = 'hold';
  const { log } = resolveRound(s, orders({ [a.id]: { actions: [{ kind: 'wait', ap: 10 }, { kind: 'attack', target: b.id, moveAp: 0 }] } }));
  const st = allEvents(log).find(e => e.type === 'strike');
  assert(Math.abs(st.t - (10 + CONFIG.units.fighter.strike.ap - 1)) <= 1, 'strike at t≈35, got ' + st.t);
});

test('exact ties: both units die at the same moment', () => {
  const s = arena();
  const a = addUnit(s, 0, 'fighter', 20, 16);
  const b = addUnit(s, 1, 'fighter', 21.3, 16);
  a.hp = 5; b.hp = 5;
  const { state, log } = resolveRound(s, orders({ [a.id]: { actions: [{ kind: 'attack', target: b.id, moveAp: 0 }] } }, { [b.id]: { actions: [{ kind: 'attack', target: a.id, moveAp: 0 }] } }));
  const deaths = allEvents(log).filter(e => e.type === 'death');
  assert(deaths.length === 2, 'both die');
  assert(deaths[0].t === deaths[1].t, 'same moment');
  assert(state.units.length === 0, 'both removed');
});

test('control zone halves enemy movement', () => {
  const run = withTank => {
    const s = arena();
    const m = addUnit(s, 0, 'fighter', 20, 16);
    if (withTank) { const t = addUnit(s, 1, 'tank', 21.5, 17.5); t.stance = 'hold'; }
    const { state } = resolveRound(s, orders({ [m.id]: { actions: [{ kind: 'move', ap: 40, x: 30, z: 16 }] } }));
    return state.units.find(u => u.id === m.id).x - 20;
  };
  const free = run(false), slowed = run(true);
  assert(Math.abs(free - 40 * CONFIG.units.fighter.tier * CONFIG.moveFactor) < 0.05, 'free move distance ' + free);
  assert(slowed < free * 0.8, `slowed ${slowed} vs free ${free}`);
});

test('zone ends when its owner acts', () => {
  const s = arena();
  const t = addUnit(s, 1, 'tank', 21.3, 16);
  const f = addUnit(s, 0, 'fighter', 20, 16); f.stance = 'hold';
  const { log } = resolveRound(s, orders({}, { [t.id]: { actions: [{ kind: 'attack', target: f.id, moveAp: 0 }] } }));
  assert(allEvents(log).some(e => e.type === 'zoneoff' && e.id === t.id), 'zoneoff event');
});

test('dash is cancelled when starting inside an enemy control zone', () => {
  const s = arena();
  const a = addUnit(s, 0, 'assassin', 20, 16);
  const f = addUnit(s, 1, 'fighter', 21.5, 16); f.stance = 'hold';
  const { state, log } = resolveRound(s, orders({ [a.id]: { actions: [{ kind: 'dash', x: 20, z: 25 }] } }));
  assert(allEvents(log).some(e => e.type === 'cancel' && e.id === a.id), 'cancel event');
  assert(!state.units.find(u => u.id === a.id).cds.dash, 'cancelled dash does not go on cooldown');
});

test('dash moves a fixed straight line and goes on cooldown', () => {
  const s = arena();
  const a = addUnit(s, 0, 'assassin', 20, 10);
  const { state } = resolveRound(s, orders({ [a.id]: { actions: [{ kind: 'dash', x: 20, z: 25 }] } }));
  const u = state.units.find(x => x.id === a.id);
  const dash = CONFIG.units.assassin.skills[0];
  assert(Math.abs(u.z - 10 - dash.length) < 0.05, 'dash length ' + (u.z - 10));
  assert(u.cds.dash === dash.cd, 'cooldown ' + u.cds.dash);
  const v = validateOrders(state, 0, orders({ [a.id]: { actions: [{ kind: 'dash', x: 0, z: 0 }] } })[0]);
  assert(v.units[a.id].actions.length === 0, 'skill rejected while on cooldown');
});

test('parry blocks a light melee hit and counterattacks; heavy hits skip it', () => {
  const s = arena();
  const f = addUnit(s, 0, 'fighter', 20, 16);
  const e = addUnit(s, 1, 'fighter', 21.3, 16);
  const { log } = resolveRound(s, orders({ [f.id]: { parry: true } }, { [e.id]: { actions: [{ kind: 'attack', target: f.id, moveAp: 0 }] } }));
  const ev = allEvents(log);
  assert(ev.some(x => x.type === 'parry' && x.id === f.id), 'parried');
  assert(ev.some(x => x.type === 'hit' && x.dst === e.id && x.kind === 'counter'), 'counter hit');
  assert(!ev.some(x => x.type === 'hit' && x.dst === f.id), 'no damage to parrying fighter');

  const s2 = arena();
  const f2 = addUnit(s2, 0, 'fighter', 20, 16);
  const a2 = addUnit(s2, 1, 'assassin', 21.3, 16);
  const r2 = resolveRound(s2, orders({ [f2.id]: { parry: true } }, { [a2.id]: { actions: [{ kind: 'attack', target: f2.id, moveAp: 0 }] } }));
  const ev2 = allEvents(r2.log);
  assert(!ev2.some(x => x.type === 'parry'), 'assassin hit is above threshold');
  assert(ev2.some(x => x.type === 'hit' && x.dst === f2.id), 'fighter takes the hit');
});

test('overwatch fires at an enemy moving in range and always hits', () => {
  const s = arena();
  const r = addUnit(s, 0, 'ranged', 20, 16);
  const e = addUnit(s, 1, 'fighter', 30, 16);
  const { log } = resolveRound(s, orders({ [r.id]: { overwatch: 1 } }, { [e.id]: { actions: [{ kind: 'move', ap: 60, x: 24, z: 16 }] } }));
  const ev = allEvents(log);
  assert(ev.some(x => x.type === 'shot' && x.ow && x.id === r.id), 'overwatch shot');
  assert(ev.some(x => x.type === 'hit' && x.dst === e.id && x.kind === 'overwatch'), 'hit');
});

test('line shots are blocked by the first enemy and by walls; frags pass over walls and hit allies', () => {
  const s = arena();
  const r = addUnit(s, 0, 'ranged', 20, 16);
  const near = addUnit(s, 1, 'tank', 24, 16); near.stance = 'hold';
  const far = addUnit(s, 1, 'ranged', 27, 16); far.stance = 'hold';
  const { log } = resolveRound(s, orders({ [r.id]: { actions: [{ kind: 'shoot', x: 27, z: 16 }] } }));
  const hits = allEvents(log).filter(x => x.type === 'hit' && x.src === r.id);
  assert(hits.length === 1 && hits[0].dst === near.id, 'tank screens the ranged unit');

  const s2 = arena();
  s2.map.walls = [{ x: 23, z: 16, w: 1, d: 6 }];
  const r2 = addUnit(s2, 0, 'ranged', 20, 16);
  const t2 = addUnit(s2, 1, 'fighter', 26, 16); t2.stance = 'hold';
  const ally = addUnit(s2, 0, 'fighter', 26, 17.2); ally.stance = 'hold';
  const res = resolveRound(s2, orders({ [r2.id]: { actions: [{ kind: 'shoot', x: 26, z: 16 }, { kind: 'frag', x: 26, z: 16.6 }] } }));
  const h2 = allEvents(res.log).filter(x => x.type === 'hit' && x.src === r2.id);
  assert(!h2.some(x => x.kind === 'shot'), 'wall blocks line shot');
  assert(h2.some(x => x.kind === 'frag' && x.dst === t2.id), 'frag hits enemy over the wall');
  assert(h2.some(x => x.kind === 'frag' && x.dst === ally.id), 'frag hits allies too');
});

test('simultaneous hits: the strongest uses the defend first', () => {
  const s = arena();
  const tgt = addUnit(s, 1, 'ranged', 22, 16); tgt.stance = 'hold'; // 1 free defend, no extras under direct orders
  const a = addUnit(s, 0, 'assassin', 21, 15.2);
  const f = addUnit(s, 0, 'fighter', 21, 16.8);
  // align: assassin waits 5 so both strikes land at t=25; fighter upgraded to tier 6
  const { log } = resolveRound(s, orders(
    { [a.id]: { actions: [{ kind: 'wait', ap: 5 }, { kind: 'attack', target: tgt.id, moveAp: 0 }] }, [f.id]: { upgrades: 1, actions: [{ kind: 'attack', target: tgt.id, moveAp: 0 }] } },
    { [tgt.id]: { actions: [{ kind: 'wait', ap: 1 }] } }));
  const hits = allEvents(log).filter(x => x.type === 'hit' && x.dst === tgt.id);
  assert(hits.length === 2 && hits[0].t === hits[1].t, 'same moment');
  const big = hits.find(h => h.src === a.id), small = hits.find(h => h.src === f.id);
  assert(big.defended && !small.defended, 'defend used on the 24-damage hit');
  assert(big.dmg === damageAfter(24, CONFIG.units.ranged.armor, true), 'defended damage formula');
});

test('disrupt drains AP from the end of the plan and lowers tier now if target has not acted', () => {
  const s = arena();
  const c = addUnit(s, 0, 'commander', 20, 16);
  const t = addUnit(s, 1, 'tank', 24, 16);
  const { log } = resolveRound(s, orders({ [c.id]: { actions: [{ kind: 'disrupt', target: t.id }] } },
    { [t.id]: { actions: [{ kind: 'wait', ap: 20 }, { kind: 'move', ap: 30, x: 30, z: 16 }, { kind: 'move', ap: 30, x: 30, z: 20 }] } }));
  const ev = allEvents(log);
  const d = ev.find(x => x.type === 'disrupt');
  assert(d && d.drained === 25 && d.tierNow, 'drained 25 and tier lowered');
  const tierSeg = log.segments.find(sg => sg.kind === 'tier' && sg.units.includes(t.id));
  assert(tierSeg.tier === 3, 'tank acts in tier 3, got ' + tierSeg.tier);
});

test('wounds lower AP from the next round', () => {
  const s = arena();
  const u = addUnit(s, 0, 'fighter', 10, 10);
  assert(apFor(u) === 100);
  u.hp = 50; assert(apFor(u) === 100 - CONFIG.woundSteps[0][1]);
  u.hp = 20; assert(apFor(u) === 100 - CONFIG.woundSteps[1][1]);
});

test('CP limits direct orders; extra units follow their stance', () => {
  const s = arena();
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(addUnit(s, 0, 'fighter', 10 + i * 1.2, 20).id);
  const o = {};
  for (const id of ids) o[id] = { actions: [{ kind: 'wait', ap: 10 }] };
  const v = validateOrders(s, 0, orders(o)[0]);
  assert(Object.keys(v.units).length === CONFIG.cp.base, 'only base CP worth of orders: ' + Object.keys(v.units).length);
});

test('commander is free to control; stance changes are free', () => {
  const s = arena();
  const c = addUnit(s, 0, 'commander', 8, 8);
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(addUnit(s, 0, 'fighter', 10 + i * 1.2, 20).id);
  const o = { [c.id]: { actions: [{ kind: 'wait', ap: 5 }] } };
  for (const id of ids) o[id] = { actions: [{ kind: 'wait', ap: 5 }] };
  const ord = orders(o)[0];
  for (const id of ids) ord.stances[id] = { stance: 'hold' };
  const v = validateOrders(s, 0, ord);
  assert(v.units[c.id], 'commander accepted');
  assert(Object.keys(v.units).length === CONFIG.cp.base + 1, 'base CP + free commander');
  assert(Object.keys(v.stances).length === 6, 'all stance changes accepted');
});

test('commander Rally: allies in range act one tier earlier', () => {
  const s = arena();
  const c = addUnit(s, 0, 'commander', 20, 16);
  const near = addUnit(s, 0, 'tank', 22, 16);
  const far = addUnit(s, 0, 'tank', 32, 16);
  const { state, log } = resolveRound(s, orders({ [c.id]: { buffs: ['rally'], actions: [{ kind: 'wait', ap: 5 }] }, [near.id]: { actions: [{ kind: 'wait', ap: 5 }] }, [far.id]: { actions: [{ kind: 'wait', ap: 5 }] } }));
  const segOf = id => log.segments.find(sg => sg.kind === 'tier' && sg.units.includes(id)).tier;
  assert(segOf(c.id) === 6 && segOf(near.id) === 5 && segOf(far.id) === 4, `tiers ${segOf(c.id)} ${segOf(near.id)} ${segOf(far.id)}`);
  assert(state.units.find(u => u.id === c.id).cds.rally > 0, 'rally on cooldown');
});

test('commander Sweep hits every enemy around it and cannot be parried', () => {
  const s = arena();
  const c = addUnit(s, 0, 'commander', 20, 16);
  const e1 = addUnit(s, 1, 'fighter', 21.2, 16);
  const e2 = addUnit(s, 1, 'fighter', 19, 16.6);
  const e3 = addUnit(s, 1, 'fighter', 26, 16);
  const { log } = resolveRound(s, orders({ [c.id]: { actions: [{ kind: 'sweep' }] } }, { [e1.id]: { parry: true } }));
  const hits = allEvents(log).filter(x => x.type === 'hit' && x.kind === 'sweep');
  assert(hits.some(h => h.dst === e1.id) && hits.some(h => h.dst === e2.id), 'both adjacent enemies hit');
  assert(!hits.some(h => h.dst === e3.id), 'far enemy not hit');
  assert(!allEvents(log).some(x => x.type === 'parry'), 'not parried');
});

test('each commander skill has its own cooldown; all three usable in one round', () => {
  const s = arena();
  const c = addUnit(s, 0, 'commander', 20, 16);
  const e = addUnit(s, 1, 'fighter', 21.2, 16);
  const v = validateOrders(s, 0, orders({ [c.id]: { buffs: ['rally'], actions: [{ kind: 'disrupt', target: e.id }, { kind: 'sweep' }] } })[0]);
  assert(v.units[c.id].buffs.length === 1 && v.units[c.id].actions.length === 2, 'all three kept');
  c.cds = { sweep: 2 };
  const v2 = validateOrders(s, 0, orders({ [c.id]: { actions: [{ kind: 'disrupt', target: e.id }, { kind: 'sweep' }] } })[0]);
  assert(v2.units[c.id].actions.length === 1 && v2.units[c.id].actions[0].kind === 'disrupt', 'sweep blocked by its own cooldown only');
});

test('round digest: HP before/after, kills, failure reasons with AP numbers', () => {
  const s = arena();
  const f = addUnit(s, 0, 'fighter', 20, 16);
  const far = addUnit(s, 0, 'fighter', 10, 5);
  const e = addUnit(s, 1, 'ranged', 21.3, 16); e.hp = 3; e.stance = 'hold';
  const t = addUnit(s, 1, 'tank', 30, 5); t.stance = 'hold';
  const o = orders({ [f.id]: { actions: [{ kind: 'attack', target: e.id, moveAp: 0 }] }, [far.id]: { actions: [{ kind: 'attack', target: t.id, moveAp: 20 }] } });
  const { state, log } = resolveRound(s, o);
  const c = allEvents(log).find(x => x.type === 'cancel' && x.id === far.id);
  assert(c && c.code === 'outofreach' && c.needAp > c.hadAp && c.hadAp === 20, 'cancel has needAp/hadAp');
  const d = buildDigest(s, log, state, 0, o[0]);
  const rf = d.byId.get(f.id), rfar = d.byId.get(far.id);
  assert(rf.kills.includes('Ranged') && rf.dealt > 0, 'kill credited');
  assert(rfar.fails.length === 1 && /out of reach/.test(rfar.fails[0]), 'failure reason listed');
  assert(rf.hpBefore === 90 && rf.controlled, 'hp before + controlled');
  assert(d.enemy.lost === 1, 'enemy loss counted');
});

test('tutorial scenario: attacking as taught wins within a few rounds', () => {
  let s = createTutorialState();
  const ids = s.tutorialIds;
  let rounds = 0;
  while (s.buildings.some(b => b.id === ids.outpost) && rounds < 8) {
    const o = emptyOrders();
    const tgt = [ids.e1, ids.e2].find(id => s.units.some(u => u.id === id)) || ids.outpost;
    for (const key of ['fighter', 'commander']) {
      if (s.units.some(u => u.id === ids[key])) o.units[ids[key]] = { ...emptyPlan(), actions: [{ kind: 'attack', target: tgt, moveAp: 45 }, { kind: 'attack', target: tgt, moveAp: 5 }] };
    }
    const r = resolveRound(s, [o, tutorialEnemyOrders(s)]);
    if (rounds === 0) assert(!r.state.units.some(u => u.id === ids.e1), 'first enemy dies in round 1');
    s = r.state; rounds++;
  }
  assert(!s.buildings.some(b => b.id === ids.outpost), 'outpost destroyed');
  assert(s.units.filter(u => u.owner === 0).length === 3, 'no losses');
  console.log(`      (outpost destroyed in round ${rounds})`);
});

test('production: unit spawns after its build rounds, at the end of the round', () => {
  let s = arena();
  const hq = s.buildings[0];
  const o = orders(); o[0].production.push({ building: hq.id, unit: 'fighter' });
  s = resolveRound(s, o).state;
  assert(!s.units.some(u => u.owner === 0), 'not after 1 round');
  const r = resolveRound(s, orders());
  assert(r.state.units.some(u => u.owner === 0 && u.type === 'fighter'), 'spawned after 2 rounds');
  assert(allEvents(r.log).some(e => e.type === 'spawn' && e.seg === 'buildings'), 'spawn logged in buildings phase');
});

test('income each round; destroying the HQ wins', () => {
  let s = arena();
  const sup = s.players[0].supply;
  s = resolveRound(s, orders()).state;
  assert(s.players[0].supply === sup + CONFIG.economy.hqIncome, 'hq income');
  s.buildings[1].hp = 5;
  const a = addUnit(s, 0, 'fighter', 46 - 2.4, 30); a.stance = 'hold';
  const r = resolveRound(s, orders({ [a.id]: { actions: [{ kind: 'attack', target: s.buildings[1].id, moveAp: 10 }] } }));
  assert(r.state.winner === 0, 'player 0 wins');
});

test('AI vs AI full match runs without errors', () => {
  let s = createGame(7);
  let rounds = 0;
  while (s.winner === null && rounds < CONFIG.roundLimit + 1) {
    s = resolveRound(s, [aiOrders(s, 0), aiOrders(s, 1)]).state;
    rounds++;
  }
  assert(s.winner !== null, 'match finished');
  console.log(`      (winner ${s.winner} after ${rounds} rounds)`);
});

test('resolution is deterministic (host and guest compute the same result)', () => {
  let s = createGame(3);
  for (let i = 0; i < 12; i++) {
    const o = [aiOrders(s, 0), aiOrders(s, 1)];
    const a = resolveRound(s, o), b = resolveRound(JSON.parse(JSON.stringify(s)), JSON.parse(JSON.stringify(o)));
    assert(JSON.stringify(a.state) === JSON.stringify(b.state), 'same state at round ' + s.round);
    s = a.state;
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
