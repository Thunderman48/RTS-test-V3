// Data: rules, factions and rosters. Every tunable number lives here.
// Distances are in inches (the board is a 48" x 32" battle mat).

export const RULES = {
  board: { w: 48, h: 32 },
  ap: 100,                      // AP per squad per round (AP = time)
  tierCost: [15, 25],           // act-earlier upgrades
  maxUpgrades: 2,
  minTier: 1,
  moveFactor: 0.012,            // inches per AP per speed tier (tier 5 => 6" per 100 AP)
  defendCost: 20,
  maxDefends: 4,
  armorK: 20,                   // damage * armorK / (armorK + armor)
  defendMult: 0.5,              // a defended hit deals half
  cp: 3,                        // squads you can directly control per round (hero is free)
  // M2 tactics
  engageGap: 0.35,              // squads this close to an enemy melee squad are engaged
  disengageAP: 30,              // stepping away from an engaged enemy costs this much AP...
  partingMult: 0.5,             // ...and that enemy gets a free hit at this strength
  parryCost: 15,                // prepared parry: negates the next melee hit and ripostes
  riposteMult: 0.5,
  overwatchCost: 40,            // prepared overwatch: fire once at the first enemy that moves in the front cone (any tier)
  overwatchCos: 0.5,            // overwatch fires at enemies moving inside this front cone
  coverMult: 0.5,               // volleys through a forest deal half damage
  forestSlow: 0.75,             // movement x this inside a forest
  siegeMult: 2.5,               // attacks deal this much more to buildings
  // M3 base & economy (each faction's currency and income: FACTIONS[f].eco)
  shrineRadius: 3,              // resource sites: the ring drawn around them
  armyCap: 30,                  // squads (builders and summoned squads don't count); maps add capBonus
  maxBuilders: 3,               // default builder cap (each faction sets its own: FACTIONS.<f>.maxBuilders)
  gatherSlots: 2,               // builders that can gather at one building (BUILDINGS.<type>.slots overrides)
  buildZone: 16,                // own third of the board (inches from your edge)
  maxBannerCp: 2,
  // Undead buildings rise out of the ground on their own (no builders)
  riseWork: 80,                 // work a rising undead site gains at the end of every round
  maxRising: 2,                 // undead sites rising at the same time
  undeadMend: 0.05,             // finished undead buildings regain this share of max HP every round
  // stun: a stunned squad's actions and movement pause for this many AP (leftover carries over)
  summonTtl: 3,                 // rounds a summoned squad lasts (it crumbles at the end of the last one)
  // stances (js/sim/stances.js)
  advanceEngage: 10,            // advance: fight the nearest enemy squad or building within this gap, else march on
  goalReach: 1.5,               // advance: within this of its target point the squad stops and guards there
  retreatReach: 3,              // retreat: within this of its fallback point the squad guards there
  // rounds a squad takes to train (it appears at the end of the last one)
  trainRounds: { builder: 1, swarm: 1, fighter: 2, ranged: 2, fast: 2, mage: 2, tank: 3 },
  // production queues (each item is paid when it starts)
  queueMax: 5,                  // squads waiting per training building (not counting the one in training)
  queueMaxBuild: 5,             // buildings waiting in the base build queue
  siteHp: 0.3,                  // a construction site starts with this share of its HP; work fills the rest
  workReach: 1.0,               // a builder works on a site while its edge is this close to the footprint
  // undead graveyards: grave ground spreads around undead buildings (BUILDINGS.<type>.grave = max radius);
  // every model that dies on it pays souls and widens it a little
  soulPerModel: 3,
  soulPerHero: 15,
  graveStart: 0.5,              // a new undead site spreads this share of its graveyard at once; the rest by the end of the round
  graveHqStart: 10,             // the Crypt's graveyard at the start of the game (its full reach)
  graveDeathGrow: 0.15,         // inches a graveyard widens per model that dies on it
  graveCapMult: 1.5,            // deaths can widen a building's graveyard up to this x its max
  gravePatchCap: 3,             // a leftover patch (from a destroyed building) can be widened up to max(its size, this)
  // a fallen hero leaves a revive zone: hold it with any squad for reviveRounds rounds to bring it back
  reviveRadius: 3,
  reviveRounds: 3,
  reviveHp: 0.5,                // the revived hero's share of max HP
  planningTimerSec: 120,
};

// Paint colours for the miniatures (basic flat colours, like a quick tabletop paint job)
export const PAINT = {
  kingdom: { cloth: 0x2f5aa8, cloth2: 0xf2efe6, metal: 0xc4cad3, trim: 0xe0b84f, skin: 0xe2ad84, hair: 0x7a4a26, wood: 0x7a5230, leather: 0x5a3b22, horse: 0x8a5a36, mane: 0x3b2a1e, rim: 0x3a78d8, base: 0x2d5fb6, bevel: 0x6f9be6, flock: 0x6f8f48 },
  undead: { cloth: 0x5b3a7a, cloth2: 0x2b2533, metal: 0x6e6f78, trim: 0x9be15d, skin: 0xe6dcc3, hair: 0x2b2533, wood: 0x4a3a2c, leather: 0x3a2e28, horse: 0x2b2533, mane: 0x1a161e, rim: 0x9b59d0, glow: 0x7dff9a, rust: 0x8a5a3a, base: 0x5e3a88, bevel: 0xa47ad0, flock: 0x5f6b44 },
  // mirror matches: the second player's army in a different scheme
  kingdomAlt: { cloth: 0xb3262e, cloth2: 0xf2e2b6, metal: 0xc4cad3, trim: 0xe0b84f, skin: 0xe2ad84, hair: 0x3b2a1e, wood: 0x7a5230, leather: 0x5a3b22, horse: 0x5c3a24, mane: 0x2a1d14, rim: 0xd83a3a, base: 0xa82828, bevel: 0xe06a6a, flock: 0x6f8f48 },
  undeadAlt: { cloth: 0x2f7a5a, cloth2: 0x1f2a24, metal: 0x6e6f78, trim: 0xd9c27a, skin: 0xe6dcc3, hair: 0x1f2a24, wood: 0x4a3a2c, leather: 0x3a2e28, horse: 0x1f2a24, mane: 0x141a17, rim: 0x2fb8a0, glow: 0x7dff9a, rust: 0x8a5a3a, base: 0x23806f, bevel: 0x5fd0bf, flock: 0x5f6b44 },
};

// Attack shapes:
//  swing  : arc in front of the squad (reach beyond the squad's edge, half-angle cos)
//  volley : straight line toward the aim point (range, width); stopped by hard cover
const SWING = (ap, dmg, reach = 1.5) => ({ kind: 'swing', ap, dmg, reach, cosHalf: 0.5 });
const VOLLEY = (ap, dmg, range, width = 0.7) => ({ kind: 'volley', ap, dmg, range, width });
//  lob    : arcs over walls onto a circle at the aim point (no line of sight needed)
const LOB = (ap, dmg, range, radius = 1.5) => ({ kind: 'lob', ap, dmg, range, radius });
// Skills (once per round at most, then a cooldown in rounds):
//  charge : lower weapons for `wind` AP, then rush along a lane up to `len`; the first enemy
//           squad met takes the impact and the squad stops in contact (engaged)
//  blast  : a circle of necromantic force at the aim point (within `range`)
//  rally  : a circle around the hero; allies inside gain a defend and hit harder this round
// cat: skill category -> colour (move = green, attack = red, defense = blue)
const CHARGE = (ap, dmg, len, cd = 1) => ({ kind: 'charge', name: 'Charge', cat: 'move', ap, wind: 8, dmg, len, cd });
const BLAST = (ap, dmg, range, radius, cd = 2) => ({ kind: 'blast', name: 'Bone Blast', cat: 'attack', ap, dmg, range, radius, cd });
//  storm  : a big lobbed volley onto a circle at the aim point; arcs over walls
const STORM = (ap, dmg, range, radius, cd = 2) => ({ kind: 'storm', name: 'Arrow Storm', cat: 'attack', ap, dmg, range, radius, cd });
const RALLY = (ap, radius, cd = 2, armor = 0, dmgMult = 1.25) => ({ kind: 'rally', name: 'Rally', cat: 'defense', ap, radius, defends: 1, dmgMult, armor, cd });
//  mighty : a heavy, wide swing in front of the hero that stuns everyone it hits for `stun` AP
const MIGHTY = (ap, dmg, reach, cosHalf, stun, cd = 2) => ({ kind: 'mighty', name: 'Mighty Swing', cat: 'attack', ap, dmg, reach, cosHalf, stun, cd });
// Mage skills (units with `mana`): no cooldown, may be cast again in the same round; each cast pays `mana`
//  summon : `count` summoned squads rise at the aim point at the end of the round; they crumble after `ttl` rounds
const SUMMON = (ap, mana, range, count) => ({ kind: 'summon', name: 'Summon Warband', cat: 'defense', ap, mana, range, count, radius: 1.6, cd: 0 });
//  thunder: strikes the first enemy at the aim point (line of sight), then jumps to the nearest
//           enemy not yet struck within `jump`, up to `jumps` times, x`decay` damage per jump
const THUNDER = (ap, mana, dmg, range, jumps, jump, decay) => ({ kind: 'thunder', name: 'Dark Thunder', cat: 'attack', ap, mana, dmg, range, jumps, jump, decay, radius: 1, cd: 0 });
//  explode: one of your summoned squads near the aim point bursts: every enemy within `radius`
//           takes `base + perModel x its models`; the summoned squad is gone
const EXPLODE = (ap, mana, range, radius, base, perModel) => ({ kind: 'explode', name: 'Corpse Explosion', cat: 'attack', ap, mana, range, radius, base, perModel, cd: 0 });
//  sweep  : a full circle swing around the hero
const SWEEP = (ap, dmg, reach, cd = 2) => ({ kind: 'sweep', name: 'Sweep', cat: 'attack', ap, dmg, reach, cd });
//  leap   : jump to a point (over terrain and squads); the landing shoves adjacent enemies back
const LEAP = (ap, range, cd = 2, dmg = 0, radius = 0, name = 'Heroic Leap') => ({ kind: 'leap', name, cat: 'move', ap, range, flight: 6, shove: 1, cd, dmg, radius });
//  step   : vanish and reappear at a point when the wind-up ends; no parting blows
const STEP = (ap, range, cd = 2) => ({ kind: 'step', name: 'Shadow Step', cat: 'move', ap, range, cd });
//  wall   : until the round ends, hits from the front 120 degrees deal 30%
const WALL = (name, ap = 15, cd = 1) => ({ kind: 'wall', name, cat: 'defense', ap, mult: 0.3, cosHalf: 0.5, cd });
//  pierce : a bolt line that hits every target along it (walls still stop it)
const PIERCE = (ap, dmg, range, width = 0.7, cd = 2) => ({ kind: 'pierce', name: 'Piercing Bolt', cat: 'attack', ap, dmg, range, width, cd });
//  raise  : friendly squads in a circle around the caster regain one fallen model each
const RAISE = (ap, radius, cd = 3) => ({ kind: 'raise', name: 'Raise', cat: 'defense', ap, radius, cd });

// The two factions play differently:
//  Kingdom: plain all-rounders with decent stats, peasants who build and farm, a strong late farm economy.
//  Undead: weaker but very cheap squads, no builders (buildings rise from the ground), souls from deaths
//          near Soul Wells, and a slow mage hero with mana who summons skeletons.
//  models: miniatures in the squad, hpPer: HP of each model, dmg is PER MODEL alive
export const FACTIONS = {
  kingdom: {
    name: 'Kingdom', short: 'KGD', colorCss: '#3a78d8',
    units: {
      hero:    { name: 'The Chosen', role: 'hero', models: 1, hpPer: 130, armor: 9, tier: 5, look: 'lord', vision: 12, defends: 2, attack: SWING(25, 18, 1.6), skills: [LEAP(20, 7, 2, 12, 1.6, 'Leap Strike'), RALLY(20, 5, 2, 4, 1), MIGHTY(30, 28, 2.6, 0.2, 25)] },
      tank:    { name: 'Shieldwall', role: 'tank', models: 3, hpPer: 34, armor: 12, tier: 4, look: 'shield', vision: 9, defends: 2, attack: SWING(30, 4, 1.3), skills: [WALL('Lock Shields')] },
      fighter: { name: 'Men-at-arms', role: 'fighter', parry: true, models: 4, hpPer: 20, armor: 7, tier: 5, look: 'sword', vision: 9, defends: 1, attack: SWING(25, 5, 1.5) },
      ranged:  { name: 'Crossbows', role: 'ranged', models: 4, hpPer: 15, armor: 3, tier: 5, look: 'crossbow', vision: 11, defends: 1, attack: VOLLEY(30, 4, 14), skills: [PIERCE(35, 5, 16)] },
      fast:    { name: 'Outriders', role: 'fast', models: 3, hpPer: 24, armor: 5, tier: 6, look: 'rider', vision: 11, defends: 1, attack: SWING(45, 13, 1.7), skills: [CHARGE(35, 9, 9)] },
      builder: { name: 'Peasants', role: 'builder', models: 2, hpPer: 14, armor: 2, tier: 5, look: 'peasant', vision: 8, defends: 0, attack: SWING(25, 2, 1.2) },
    },
    // Gold: a steady builder economy (keep, big farms worked by many peasants, mines on resource sites)
    eco: { res: 'gold', name: 'Gold', icon: 'gold', start: 60, hq: 6, gather: { farm: 8, mine: 10 } },
    buildings: ['barracks', 'tower', 'farm', 'mine', 'banner', 'wall'],
    train: { builder: 10, tank: 30, fighter: 24, ranged: 26, fast: 30 },
    hqTrains: ['builder', 'fighter'],   // the Keep trains peasants and Men-at-arms
    maxBuilders: 10,
  },
  undead: {
    name: 'Undead Legion', short: 'UND', colorCss: '#9b59d0',
    units: {
      hero:    { name: 'Lich', role: 'hero', models: 1, hpPer: 90, armor: 5, tier: 3, look: 'necro', vision: 12, defends: 1, magic: true, attack: VOLLEY(25, 10, 10, 0.6),
                 mana: { max: 100, start: 60, regen: 25 }, skills: [SUMMON(20, 40, 4, 2), THUNDER(15, 25, 14, 11, 3, 3.5, 0.7), EXPLODE(10, 20, 9, 2.5, 8, 6)] },
      tank:    { name: 'Grave Guard', role: 'tank', models: 3, hpPer: 21, armor: 9, tier: 4, look: 'graveguard', vision: 9, defends: 2, attack: SWING(30, 3.2, 1.3), skills: [WALL('Grave Wall')] },
      fighter: { name: 'Skeleton Warriors', role: 'fighter', parry: true, models: 5, hpPer: 9, armor: 3, tier: 5, look: 'skeleton', vision: 9, defends: 1, attack: SWING(25, 2.4, 1.5) },
      // the swarm: fragile, quick, cheap, trained two squads at a time (`pair`; a later upgrade: three)
      swarm:   { name: 'Skeleton Warband', role: 'swarm', pair: 2, models: 6, hpPer: 4, armor: 0, tier: 6, look: 'skeleton', vision: 9, defends: 0, attack: SWING(25, 2.4, 1.4) },
      ranged:  { name: 'Bone Archers', role: 'ranged', models: 4, hpPer: 10, armor: 1, tier: 5, look: 'archer', vision: 11, defends: 1, attack: VOLLEY(30, 2.4, 14, 0.9), skills: [STORM(35, 4, 15, 2.2)] },
      fast:    { name: 'Wraiths', role: 'fast', models: 3, hpPer: 14, armor: 3, tier: 6, look: 'wraith', vision: 11, defends: 1, ghost: true, attack: SWING(45, 9, 1.7), skills: [CHARGE(35, 5.6, 9)] },
      // a weaker caster troop: bolts, a weaker Dark Thunder, a one-squad summon; raises Monoliths near it
      mage:    { name: 'Necromancers', role: 'mage', models: 2, hpPer: 10, armor: 1, tier: 4, look: 'necro', vision: 10, defends: 1, magic: true, attack: VOLLEY(25, 4, 9, 0.5),
                 mana: { max: 60, start: 40, regen: 15 }, skills: [THUNDER(15, 20, 6, 10, 2, 3, 0.7), SUMMON(20, 35, 4, 1)] },
      // raised by Summon Warband (the Lich, Necromancers): not trainable, crumbles after RULES.summonTtl rounds
      summon:  { name: 'Summoned Skeletons', role: 'summon', summoned: true, models: 3, hpPer: 11, armor: 3, tier: 5, look: 'skeleton', vision: 7, defends: 0, attack: SWING(25, 3, 1.5) },
    },
    // Souls: fed by death on graveyards (grave ground spreads around undead buildings); Soul Wells give a
    // trickle and spread graves far. No builders.
    // a death economy: the Crypt (1) and Soul Wells (2) only keep it from stalling; deaths on graves pay the rest
    eco: { res: 'souls', name: 'Souls', icon: 'souls', start: 90, hq: 1, gather: {} },
    buildings: ['barracks', 'tower', 'well', 'monolith', 'wall'],
    train: { tank: 16, fighter: 9, swarm: 14, ranged: 13, fast: 16, mage: 22 },
    // balancing rule (owner): low tier (swarm, fighter, ranged) keep their costs, change their stats;
    // high tier (tank, fast, mage, the Lich's spells) may change costs
    lowTier: ['swarm', 'fighter', 'ranged'],
    hqTrains: ['swarm'],
    graves: true,             // its buildings spread graveyards
    maxBuilders: 0,
    rises: true,              // buildings rise out of the ground by themselves (RULES.riseWork per round)
  },
};

// Buildings. Builders put them up: `work` is the builder AP needed to finish one.
//  shape: 'rect' (w x d, rotated by rot 0/90) or 'circle' (r). fire: { dmg (x4 shots), range }
//  income: per round once finished. site: must stand on a resource site. souls: collects souls nearby.
export const BUILDINGS = {
  hq:       { name: { kingdom: 'Keep', undead: 'Crypt' }, icon: 'goal', cost: 0, work: 0, hp: 220, armor: 8, shape: 'rect', w: 4, d: 4, vision: 10, fire: { dmg: 3, range: 8 }, trains: 'faction', grave: 10 },
  barracks: { name: { kingdom: 'Barracks', undead: 'Ossuary' }, icon: 'spawn', cost: 30, work: 240, hp: 150, armor: 8, shape: 'rect', w: 3.5, d: 2.5, vision: 6, trains: ['tank', 'fighter', 'swarm', 'ranged', 'fast', 'mage'], grave: 6 },
  tower:    { name: { kingdom: 'Watchtower', undead: 'Bone Spire' }, icon: 'range', cost: 25, work: 200, hp: 110, armor: 6, shape: 'circle', r: 0.9, vision: 13, fire: { dmg: 4, range: 11 }, grave: 6 },
  banner:   { name: { kingdom: 'Banner', undead: 'Obelisk' }, icon: 'cp', cost: 20, work: 120, hp: 60, armor: 4, shape: 'circle', r: 0.55, vision: 6, cp: 1 },
  // undead: the only building allowed off graves; must be raised near the Lich or Necromancers (caster);
  // spreads graves and slowly heals friendly squads around it (heal: HP per model a round)
  monolith: { name: { kingdom: 'Monolith', undead: 'Monolith' }, icon: 'heal', cost: 20, work: 120, hp: 70, armor: 4, shape: 'circle', r: 0.6, vision: 7, grave: 6, offGraves: true, caster: 6, heal: { radius: 4, hp: 4 } },
  wall:     { name: { kingdom: 'Palisade', undead: 'Bone Fence' }, icon: 'fortify', cost: 6, work: 60, hp: 80, armor: 6, shape: 'rect', w: 3, d: 0.5, vision: 0, grave: 6 },
  farm:     { name: { kingdom: 'Farm', undead: 'Farm' }, icon: 'farm', cost: 25, work: 140, hp: 90, armor: 3, shape: 'rect', w: 4.2, d: 3.4, vision: 5, income: 2, slots: 4 },
  mine:     { name: { kingdom: 'Mine', undead: 'Mine' }, icon: 'node', cost: 30, work: 160, hp: 100, armor: 6, shape: 'circle', r: 1.1, vision: 7, income: 6, site: true },
  well:     { name: { kingdom: 'Soul Well', undead: 'Soul Well' }, icon: 'souls', cost: 20, work: 160, hp: 90, armor: 5, shape: 'circle', r: 1.1, vision: 7, income: 2, site: true, souls: true, grave: 10 },
};
export const ecoOf = faction => FACTIONS[faction].eco;
export const trainCost = (faction, role) => FACTIONS[faction].train[role] || 0;
// roles a building type trains for a faction (the HQ trains different things per faction)
export const trainsOf = (type, faction) => (BUILDINGS[type].trains === 'faction' ? FACTIONS[faction].hqTrains : BUILDINGS[type].trains || []).filter(r => FACTIONS[faction].units[r]);
// squads one training produces (the undead swarm comes in pairs)
export const pairOf = (faction, role) => FACTIONS[faction].units[role]?.pair || 1;
export const maxBuildersOf = faction => FACTIONS[faction].maxBuilders ?? RULES.maxBuilders;
export const gatherSlotsOf = type => BUILDINGS[type].slots || RULES.gatherSlots;
// mages: units with mana cast skills with no cooldown, several times a round
export const isMage = def => !!def.mana;
export const manaOf = q => q.mana ?? 0;

export const ROLE_ORDER = ['hero', 'tank', 'fighter', 'swarm', 'ranged', 'mage', 'fast', 'summon', 'builder'];

// Squad footprint radius (inches) from model count and look
export function squadRadius(def, models) {
  if (def.models === 1) return 0.65;
  const base = def.look === 'rider' || def.look === 'wraith' ? 0.62 : 0.5;
  return base + 0.42 * Math.sqrt(Math.max(1, models));
}

export function unitDef(faction, role) { return FACTIONS[faction].units[role]; }
export const isMelee = def => def.attack.kind === 'swing';
export const skillsOf = def => def.skills || [];
export const skillOf = (def, kind) => (def.skills || []).find(k => k.kind === kind) || null;
export const SKILL_KINDS = ['charge', 'blast', 'rally', 'storm', 'sweep', 'leap', 'step', 'wall', 'pierce', 'raise', 'mighty', 'summon', 'thunder', 'explode'];
// skills cast on the squad itself (no aim): tap the knob to use
export const SELF_SKILLS = ['rally', 'sweep', 'wall', 'raise'];
export const cdOf = (q, kind) => (q.cd && q.cd[kind]) | 0;
export const CAT_COLOR = { move: '#34c759', attack: '#ff3b30', defense: '#3fa9ff' };
export const isShooter = def => def.attack.kind === 'volley' || def.attack.kind === 'lob';
