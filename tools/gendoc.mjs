// Regenerates the data tables in docs/GAME.md straight from js/data (so the numbers there are
// always exactly the game's). Each table sits between <!-- GEN:name --> and <!-- /GEN:name -->.
//   node tools/gendoc.mjs        (npm run doc)
import { readFileSync, writeFileSync } from 'node:fs';
import { RULES, FACTIONS, BUILDINGS, squadRadius, trainsOf, maxBuildersOf, gatherSlotsOf } from '../js/data/units.js';
import { MAPS, MAP_ORDER, buildMapTerrain, mapSites, boardOf, DEPLOY, HQ_X } from '../js/data/maps.js';
import { damageAfter } from '../js/sim/resolve.js';

const DOC = new URL('../docs/GAME.md', import.meta.url);
const F = ['kingdom', 'undead'];
const ROLES_ALL = ['hero', 'tank', 'fighter', 'swarm', 'ranged', 'fast', 'mage', 'summon', 'builder'];
const rolesOf = f => ROLES_ALL.filter(r => FACTIONS[f].units[r]);
const n1 = v => Math.round(v * 10) / 10;
const row = cells => '| ' + cells.join(' | ') + ' |';
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const speed = tier => n1(tier * RULES.moveFactor * RULES.ap);

const RULE_NOTES = {
  board: 'default board (each map sets its own size)', ap: 'AP per squad per round; AP = time', tierCost: 'AP cost of the 1st / 2nd "act earlier" upgrade',
  maxUpgrades: 'max act-earlier upgrades per squad per round', minTier: 'lowest tier', moveFactor: 'inches per AP per speed tier (tier 5 = 6" per 100 AP)',
  defendCost: 'AP per bought defend', maxDefends: 'max bought defends per round', armorK: 'armour constant in damage * K / (K + armour)', defendMult: 'a defended hit deals x this',
  cp: 'command points per round (hero and builders are free)', engageGap: 'inches between squad edges that count as engaged', disengageAP: 'AP spent standing still when stepping away from an engaged enemy',
  partingMult: 'parting blow strength (x the enemy\'s full attack)', parryCost: 'AP for a prepared parry', riposteMult: 'riposte strength (x own attack)', overwatchCost: 'AP for prepared overwatch',
  overwatchCos: 'overwatch cone: cos of the half angle (0.5 = 60 deg each side)', coverMult: 'damage x this through / into a forest (volleys, pierce, tower fire)', siegeMult: 'damage x this against buildings',
  shrineRadius: 'ring drawn around resource sites (visual + placement keep-out x 0.6)', armyCap: 'base squad cap (builders and summoned squads do not count; maps add capBonus)', maxBuilders: 'default builder cap (FACTIONS.<f>.maxBuilders overrides)',
  gatherSlots: 'builders that can gather at one building (BUILDINGS.<type>.slots overrides: farm 4)', buildZone: 'default build zone (each map: round(width / 3))', maxBannerCp: 'max Kingdom banners (and max bonus CP)', riseWork: 'undead: work a rising site gains at the end of every round (no builders)', maxRising: 'undead: sites rising at the same time', undeadMend: 'undead: finished buildings regain this share of max HP every round', summonTtl: 'rounds a summoned squad lasts', queueMax: 'squads waiting per training building', queueMaxBuild: 'buildings waiting in the base build queue',
  trainRounds: 'rounds each role takes to train', siteHp: 'share of max HP a new site starts with', workReach: 'inches between builder edge and footprint to work',
  graveStart: "share of its graveyard a new undead site spreads at once (the rest by the round's end)", graveHqStart: "the Crypt's graveyard at the start", graveDeathGrow: 'inches a graveyard widens per model dying on it', graveCapMult: "deaths can widen a building's graveyard to this x its max", gravePatchCap: 'leftover patches widen up to max(size, this)', reviveRadius: 'revive zone radius', reviveRounds: 'rounds a side must hold the zone', reviveHp: "revived hero's HP share", forestSlow: 'movement x this inside a forest', soulPerModel: 'souls per model that dies', soulPerHero: 'souls when a hero dies', planningTimerSec: '(unused; the online timer is chosen in the lobby)',
};

function genRules() {
  return table(['Key', 'Value', 'Meaning'], Object.entries(RULES).map(([k, v]) => ['`' + k + '`', '`' + JSON.stringify(v) + '`', RULE_NOTES[k] || '']));
}

function genUnits() {
  const out = [];
  for (const f of F) {
    const U = FACTIONS[f].units;
    out.push(`**${FACTIONS[f].name}** (\`FACTIONS.${f}.units\`)\n`);
    out.push(table(['Role', 'Name', 'Models', 'HP/model', 'HP', 'Armour', 'Tier', 'Move "/rnd', 'Vision', 'Defends', 'Radius', 'Attack', 'AP', 'Dmg/model', 'Full squad/hit', 'Reach / range', 'Hits per 100 AP', 'Flags', 'Train cost', 'Train rnds'],
      rolesOf(f).map(r => { const d = U[r], a = d.attack; return [r, d.name, d.models, d.hpPer, d.models * d.hpPer, d.armor, d.tier, speed(d.tier), d.vision, d.defends, n1(squadRadius(d, d.models) * 100) / 100, a.kind, a.ap, a.dmg, a.dmg * d.models,
        a.kind === 'swing' ? `reach ${a.reach}" (arc +-60 deg)` : `range ${a.range}", width ${a.width}"`, Math.floor(RULES.ap / a.ap),
        [d.parry ? 'parry' : '', d.ghost ? 'ghost' : '', d.mana ? `mage: mana ${d.mana.start}/${d.mana.max}, +${d.mana.regen}/rnd` : '', d.summoned ? `summoned (lasts ${RULES.summonTtl} rnds, not trainable)` : ''].filter(Boolean).join(', ') || '-', r === 'hero' || d.summoned ? '-' : FACTIONS[f].train[r], r === 'hero' || d.summoned ? '-' : RULES.trainRounds[r]]; })));
    out.push('');
  }
  return out.join('\n');
}

function genSkills() {
  const rows = [];
  for (const f of F) for (const r of rolesOf(f)) for (const k of FACTIONS[f].units[r].skills || []) {
    const d = FACTIONS[f].units[r];
    const params = Object.entries(k).filter(([key]) => !['kind', 'name', 'cat', 'ap', 'cd', 'mana'].includes(key)).map(([key, v]) => `${key} ${v}`).join(', ');
    const full = k.dmg ? `${k.dmg} x ${d.models} = ${k.dmg * d.models}` : '-';
    rows.push([FACTIONS[f].name, d.name, k.name, '`' + k.kind + '`', k.cat, k.ap, d.mana ? '- (mage)' : k.cd, d.mana ? k.mana : '-', full, params]);
  }
  return table(['Faction', 'Unit', 'Skill', 'Kind', 'Category', 'AP', 'Cooldown (rounds)', 'Mana', 'Dmg (per model x models)', 'Parameters'], rows);
}

// damage per 100 AP of the full squad against an armour value (each hit rounded on its own)
const perHit = (d, armor) => damageAfter(d.attack.dmg * d.models, armor, false);
function genDerived() {
  const out = [];
  out.push('Damage per round = hits per 100 AP x damageAfter(dmg per model x models, armour), full squad, no defends, no cover, standing in reach. Real fights lose AP to walking.\n');
  for (const f of F) {
    out.push(`**${FACTIONS[f].name}: damage per 100 AP against armour**\n`);
    out.push(table(['Unit', 'Raw/hit', 'vs 0', 'vs 3', 'vs 5', 'vs 8', 'vs 11', 'vs 12'], rolesOf(f).map(r => { const d = FACTIONS[f].units[r], h = Math.floor(RULES.ap / d.attack.ap); return [d.name, d.attack.dmg * d.models, ...[0, 3, 5, 8, 11, 12].map(a => h * perHit(d, a))]; })));
    out.push('');
  }
  // time to kill: attacks needed by a full attacking squad to destroy a full defending squad (no defends)
  for (const [A, B] of [['kingdom', 'undead'], ['undead', 'kingdom']]) {
    out.push(`**Attacks needed: ${FACTIONS[A].name} (rows, full squad, no losses) vs ${FACTIONS[B].name} (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)\n`);
    out.push(table(['Attacker \\ Target', ...rolesOf(B).map(r => FACTIONS[B].units[r].name)], rolesOf(A).map(ra => {
      const a = FACTIONS[A].units[ra];
      return [a.name, ...rolesOf(B).map(rb => { const b = FACTIONS[B].units[rb], hp = b.models * b.hpPer, h = perHit(a, b.armor); const n = Math.ceil(hp / h); return `${n} (${n1(n / Math.floor(RULES.ap / a.attack.ap))} r)`; })];
    })));
    out.push('');
  }
  return out.join('\n');
}

function genBuildings() {
  const rows = Object.entries(BUILDINGS).map(([k, b]) => [
    '`' + k + '`', `${b.name.kingdom} / ${b.name.undead}`, b.cost, b.work, b.work ? n1(b.work / 100) : 0, FACTIONS.undead.buildings.includes(k) ? Math.ceil(b.work / RULES.riseWork) : '-', b.hp, Math.round(b.hp * RULES.siteHp), b.armor,
    b.shape === 'circle' ? `circle r ${b.r}` : `${b.w} x ${b.d}`, b.vision, b.fire ? `${b.fire.dmg} x 4 = ${b.fire.dmg * 4} raw, range ${b.fire.range}"` : '-', b.income || '-',
    [b.site ? 'resource site only' : '', b.souls ? `soul collector (${RULES.soulRange}")` : '', b.cp ? `+${b.cp} CP` : '', b.slots ? `${b.slots} gatherers` : '', b.trains ? 'trains ' + (b.trains === 'faction' ? F.map(f => `${f}: ${trainsOf(k, f).join('/')}`).join(', ') : b.trains.join('/')) : ''].filter(Boolean).join('; ') || '-',
    F.filter(f => k === 'hq' || FACTIONS[f].buildings.includes(k)).join(', ')]);
  return table(['Type', 'Names (Kingdom / Undead)', 'Cost', 'Work (builder AP)', 'Builder-rounds', 'Undead rise rounds', 'HP', 'Site HP', 'Armour', 'Footprint', 'Vision', 'Fire (after the tiers)', 'Income/rnd', 'Special', 'Built by'], rows)
    + '\n\nRepair (Kingdom builders): builder AP x (max HP / work) HP per AP. Undead buildings rise by ' + RULES.riseWork + ' work a round (at most ' + RULES.maxRising + ' at once) and mend ' + (RULES.undeadMend * 100) + ' % of max HP a round. Siege damage taken: damageAfter(raw x ' + RULES.siegeMult + ', armour) (no defends).';
}

function genEconomy() {
  const out = [];
  out.push(table(['Faction', 'Resource', 'Start', 'HQ income/rnd', 'Gather (AP per 1 resource)', 'Builder gathering a full round', 'Buildable'],
    F.map(f => { const e = FACTIONS[f].eco; return [FACTIONS[f].name, e.name, e.start, e.hq, Object.entries(e.gather).map(([b, v]) => `${b} ${v} (${gatherSlotsOf(b)} gatherers)`).join(', ') || '- (no builders)', Object.entries(e.gather).map(([b, v]) => `${b} ~${Math.floor(RULES.ap / v)}`).join(', ') || '-', FACTIONS[f].buildings.join(', ')]; })));
  out.push(`\nBuilders: Kingdom up to ${maxBuildersOf('kingdom')} peasant squads (not in the army cap); Undead ${maxBuildersOf('undead')} (buildings rise by themselves). HQ trains: ${F.map(f => `${FACTIONS[f].name} ${trainsOf('hq', f).join('/')}`).join('; ')}.`);
  out.push('\n**Training cost (resource) and time (rounds)**\n');
  out.push(table(['Role', ...F.map(f => FACTIONS[f].name + ' cost'), 'Rounds', 'Trained at'], ['builder', 'tank', 'fighter', 'swarm', 'ranged', 'fast', 'mage'].map(r => [r, ...F.map(f => FACTIONS[f].train[r] ?? '-'), RULES.trainRounds[r], r === 'builder' ? 'Keep (Kingdom only)' : r === 'swarm' ? 'Crypt and Ossuary (Undead only; a pair per training)' : r === 'mage' ? 'Ossuary (Undead only)' : 'Barracks / Ossuary'])));
  out.push(`\nSouls: every model that dies (either side, not summoned skeletons) on the undead side's grave ground pays ${RULES.soulPerModel} souls (a hero: ${RULES.soulPerHero}); graveyards: ${Object.entries(BUILDINGS).filter(([, b]) => b.grave).map(([k, b]) => `${k} ${b.grave}"`).join(', ')} (a new site spreads ${RULES.graveStart * 100} % at once and the rest by the end of the round; the Crypt starts at ${RULES.graveHqStart}"). Pairs: ${F.flatMap(f => Object.values(FACTIONS[f].units).filter(u => u.pair).map(u => `${u.name} x${u.pair}`)).join(', ') || '-'}.`);
  // the undead death economy: what a squad pays back when it is wiped out on its own graves
  const U = FACTIONS.undead, low = U.lowTier || [];
  out.push('\n**Undead death economy: souls back when a whole squad dies on your graves vs its cost** (both sides\' deaths pay; the table uses undead squads)\n');
  out.push(table(['Role', 'Name', 'Tier rule', 'Models', 'Cost (per squad)', 'Souls back (per squad)', 'Back / cost'],
    Object.entries(U.units).filter(([r]) => U.train[r] !== undefined).map(([r, d]) => {
      const cost = U.train[r] / (d.pair || 1), back = r === 'hero' ? RULES.soulPerHero : d.models * RULES.soulPerModel;
      return [r, d.name, low.includes(r) ? 'low (cost fixed)' : 'high (cost may change)', d.models, n1(cost), back, n1(back / cost) + 'x'];
    })));
  out.push(`\nFlat income: Crypt ${U.eco.hq} a round, Soul Well ${BUILDINGS.well.income} a round each. Kingdom deaths on undead graves pay the same per model (Kingdom ${['tank', 'fighter', 'ranged', 'fast'].map(r => `${FACTIONS.kingdom.units[r].name} ${FACTIONS.kingdom.units[r].models * RULES.soulPerModel}`).join(', ')}).`);
  return out.join('\n');
}

function genMaps() {
  const out = [];
  out.push(table(['Map', 'id', 'Size', 'Build zone (x <)', 'Army cap', 'HQ spots (z, player 0 at x ' + HQ_X + ')', 'Resource sites', 'Rivers (x: fords z/width)', 'Lakes'],
    MAP_ORDER.map(id => { const m = MAPS[id], b = boardOf(m); const t = buildMapTerrain(m);
      return [m.name, '`' + id + '`', `${m.w} x ${m.h}`, `${b.zone}" (player 1: x > ${m.w - b.zone})`, b.cap, m.hqSpots.join(', '), mapSites(m).length,
        t.filter(x => x.kind === 'river').map(r => `${r.x}: ${r.fords.map(f => f.z + '/' + f.d).join(', ')}`).join('; ') || '-', t.filter(x => x.kind === 'lake').length]; })));
  out.push('');
  for (const id of MAP_ORDER) {
    const m = MAPS[id], t = buildMapTerrain(m).filter(x => x.kind !== 'board');
    out.push(`#### ${m.name} (\`${id}\`, ${m.w}" x ${m.h}")\n\n${m.blurb}\n`);
    out.push('Terrain (full, mirrored): ' + t.map(x => x.kind === 'river' ? `river x${x.x} (w ${x.w}, fords ${x.fords.map(f => 'z' + f.z + '/' + f.d).join(' ')})` : x.r !== undefined ? `${x.kind} (${x.x}, ${x.z}) r${x.r}` : `${x.kind} (${x.x}, ${x.z}) ${x.w}x${x.d}`).join('; ') + '.\n');
    out.push('Resource sites: ' + mapSites(m).map(s => `(${s.x}, ${s.z})`).join(', ') + '. Road control points: ' + JSON.stringify(m.road) + '.\n');
    // ASCII sketch: 1 char = 2" (H = possible HQ spot, $ = site, ~ = water, ^ = forest, # = ruin, o = rock, = = ford)
    const cw = 2, W = Math.ceil(m.w / cw), H = Math.ceil(m.h / cw);
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    const put = (x, z, c) => { const i = Math.floor(x / cw), j = Math.floor(z / cw); if (j >= 0 && j < H && i >= 0 && i < W) g[j][i] = c; };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = i * cw + cw / 2, z = j * cw + cw / 2;
      for (const p of t) {
        if (p.kind === 'river' && Math.abs(x - p.x) < cw / 2 + p.w / 2) g[j][i] = p.fords.some(f => Math.abs(z - f.z) <= f.d / 2 + 0.5) ? '=' : '~';
        else if (p.kind === 'lake' && Math.hypot(x - p.x, z - p.z) < p.r + 0.6) g[j][i] = '~';
        else if (p.kind === 'forest' && Math.hypot(x - p.x, z - p.z) < p.r) g[j][i] = '^';
        else if (p.kind === 'rock' && Math.hypot(x - p.x, z - p.z) < p.r + 0.7) g[j][i] = 'o';
        else if (p.kind === 'ruin' && Math.abs(x - p.x) < p.w / 2 + 0.7 && Math.abs(z - p.z) < p.d / 2 + 0.7) g[j][i] = '#';
      }
    }
    for (const s of mapSites(m)) put(s.x, s.z, '$');
    for (const z of m.hqSpots) { put(HQ_X, z, 'H'); put(m.w - HQ_X, m.h - z, 'H'); }
    out.push('```\n' + g.map(r => r.join('')).join('\n') + '\n```\n');
  }
  out.push('Deployment (player 0; player 1 mirrored), relative to the chosen HQ spot z: ' + DEPLOY.map(d => `${d.role}${d.alt ? ` (undead: ${d.alt})` : ''}${d.only ? ` (${d.only} only)` : ''} x ${d.x}, z ${d.dz >= 0 ? '+' : ''}${d.dz}`).join('; ') + '. Each squad gets a seeded jitter of up to +-0.8" (builders none), then is nudged clear of terrain and other squads.');
  return out.join('\n');
}

const GEN = { rules: genRules, units: genUnits, skills: genSkills, derived: genDerived, buildings: genBuildings, economy: genEconomy, maps: genMaps };
let doc = readFileSync(DOC, 'utf8');
for (const [k, fn] of Object.entries(GEN)) {
  const re = new RegExp(`(<!-- GEN:${k} -->)[\\s\\S]*?(<!-- /GEN:${k} -->)`);
  if (!re.test(doc)) { console.warn('missing marker GEN:' + k); continue; }
  doc = doc.replace(re, `$1\n${fn()}\n$2`);
}
writeFileSync(DOC, doc);
console.log('docs/GAME.md tables regenerated');
