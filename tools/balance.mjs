// AI-vs-AI balance report. Runs mirrored games (each seed with both army orders, so each
// faction plays both sides) on the chosen maps and prints win rates, game length, how games
// ended, the economy and per-unit combat numbers.
//
//   node tools/balance.mjs                       # 8 seeds x 2 orders on every map
//   node tools/balance.mjs --games 4 --maps crossing,greatfield --level hard --rounds 100
//   node tools/balance.mjs --json > out.json     # machine-readable
//
// Options: --games N (seeds per map, default 8), --maps a,b|all, --level easy|normal|hard (both
// AIs), --rounds N (stop and call it unfinished after N rounds, default 100), --seed S (first seed).
import { createGame, defOf } from '../js/sim/state.js';
import { resolveRound } from '../js/sim/resolve.js';
import { aiOrders, aiMemory } from '../js/ai/ai.js';
import { knownEnemyHq } from '../js/sim/vision.js';
import { MAP_ORDER } from '../js/data/maps.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes('--' + k);
const GAMES = +arg('games', 8), ROUNDS = +arg('rounds', 100), LEVEL = arg('level', 'normal'), SEED0 = +arg('seed', 1);
const maps = arg('maps', 'all') === 'all' ? MAP_ORDER : arg('maps').split(',');
const FACS = ['kingdom', 'undead'];
const report = { date: new Date().toISOString().slice(0, 10), games: GAMES, rounds: ROUNDS, level: LEVEL, maps: {} };

for (const map of maps) {
  const R = {
    games: 0, wins: { kingdom: 0, undead: 0 }, unfinished: 0, draws: 0, rounds: [], ends: {},
    fac: Object.fromEntries(FACS.map(f => [f, { built: {}, trained: {}, gathered: 0, souls: 0, income: 0, hqFound: [], units: {} }])),
  };
  for (let seed = SEED0; seed < SEED0 + GAMES; seed++) for (const order of [['kingdom', 'undead'], ['undead', 'kingdom']]) {
    let s = createGame(seed, order, map);
    const mem = [aiMemory(), aiMemory()];
    const found = [0, 0];
    const role = {};
    const tally = (f, r) => (R.fac[f].units[r] ||= { dealt: 0, taken: 0, modelsLost: 0, squadsLost: 0, trained: 0 });
    for (const q of s.squads) role[q.id] = [order[q.owner], q.role];
    while (s.winner === null && s.round <= ROUNDS) {
      const r = resolveRound(s, [aiOrders(s, 0, mem[0], { level: LEVEL }), aiOrders(s, 1, mem[1], { level: LEVEL })]);
      for (const g of r.log.segments) for (const e of g.events) {
        if (e.type === 'spawn') { role[e.id] = [order[e.owner], e.role]; R.fac[order[e.owner]].trained[e.role] = (R.fac[order[e.owner]].trained[e.role] || 0) + 1; tally(order[e.owner], e.role).trained++; }
        else if (e.type === 'built') R.fac[order[e.owner]].built[e.btype] = (R.fac[order[e.owner]].built[e.btype] || 0) + 1;
        else if (e.type === 'gather') R.fac[order[e.owner]].gathered += e.amount;
        else if (e.type === 'souls') R.fac[order[e.owner]].souls += e.amount;
        else if (e.type === 'income') R.fac[order[e.owner]].income += e.amount;
        else if (e.type === 'hit' && !e.building) {
          const a = role[e.src], d = role[e.dst];
          if (a) tally(a[0], a[1]).dealt += e.dmg;
          if (d) { const t = tally(d[0], d[1]); t.taken += e.dmg; t.modelsLost += e.lost || 0; }
        } else if (e.type === 'hit' && e.building) { const a = role[e.src]; if (a) tally(a[0], a[1]).dealt += e.dmg; }
        else if (e.type === 'down') { const d = role[e.id]; if (d) tally(d[0], d[1]).squadsLost++; }
      }
      s = r.state;
      for (const p of [0, 1]) if (!found[p] && knownEnemyHq(s, p)) { found[p] = s.round - 1; R.fac[order[p]].hqFound.push(found[p]); }
    }
    R.games++;
    const hqs = [0, 1].map(p => s.buildings.some(b => b.owner === p && b.type === 'hq'));
    const why = s.winner === null ? 'unfinished' : !hqs[0] || !hqs[1] ? 'hq destroyed' : 'army and barracks gone';
    R.ends[why] = (R.ends[why] || 0) + 1;
    if (s.winner === null) R.unfinished++;
    else if (s.winner === -1) R.draws++;
    else { R.wins[order[s.winner]]++; R.rounds.push(s.round - 1); }
  }
  report.maps[map] = R;
}

if (flag('json')) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';
const per = (v, n) => (v / n).toFixed(1);
console.log(`Balance report ${report.date} · ${GAMES} seeds x 2 orders per map · AI ${LEVEL} · stop at round ${ROUNDS}\n`);
for (const [map, R] of Object.entries(report.maps)) {
  const fin = R.wins.kingdom + R.wins.undead;
  const sorted = R.rounds.slice().sort((a, b) => a - b);
  console.log(`## ${map}: ${R.games} games · Kingdom ${R.wins.kingdom} (${pct(R.wins.kingdom, fin)} of decided) · Undead ${R.wins.undead} (${pct(R.wins.undead, fin)}) · draws ${R.draws} · unfinished ${R.unfinished}`);
  console.log(`   rounds (decided): avg ${sorted.length ? per(sorted.reduce((a, b) => a + b, 0), sorted.length) : '-'}, median ${sorted.length ? sorted[sorted.length >> 1] : '-'}, min ${sorted[0] ?? '-'}, max ${sorted[sorted.length - 1] ?? '-'} · ends: ${JSON.stringify(R.ends)}`);
  for (const f of FACS) {
    const F = R.fac[f], n = R.games;
    console.log(`   ${f}: built/game ${JSON.stringify(Object.fromEntries(Object.entries(F.built).map(([k, v]) => [k, +per(v, n)])))} · trained/game ${JSON.stringify(Object.fromEntries(Object.entries(F.trained).map(([k, v]) => [k, +per(v, n)])))}`);
    console.log(`      income/game ${per(F.income, n)} · gathered/game ${per(F.gathered, n)} · souls/game ${per(F.souls, n)} · found enemy HQ in ${F.hqFound.length}/${n} games, avg round ${F.hqFound.length ? per(F.hqFound.reduce((a, b) => a + b, 0), F.hqFound.length) : '-'}`);
    console.log(`      per unit type (per game): ` + Object.entries(F.units).sort().map(([r, u]) => `${r} dealt ${per(u.dealt, n)} taken ${per(u.taken, n)} models lost ${per(u.modelsLost, n)} squads lost ${per(u.squadsLost, n)} trained ${per(u.trained, n)}`).join(' | '));
  }
  console.log('');
}
