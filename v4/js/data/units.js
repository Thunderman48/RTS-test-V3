// V4 data: rules, factions and rosters. Every tunable number lives here.
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
  roundLimit: 40,
  // M3 base & economy
  startSupply: 40,
  hqIncome: 10,
  shrineIncome: 4,
  shrineRadius: 3,
  armyCap: 10,
  buildZone: 16,                // own third of the board (inches from your edge)
  buildRange: 9,                // new buildings within this distance of one of yours
  maxBannerCp: 2,
  trainRounds: 1,
  siteHp: 0.4,                  // a construction site starts with this share of its HP
  planningTimerSec: 120,
};

// Paint colours for the miniatures (basic flat colours, like a quick tabletop paint job)
export const PAINT = {
  kingdom: { cloth: 0x2f5aa8, cloth2: 0xf2efe6, metal: 0xc4cad3, trim: 0xe0b84f, skin: 0xe2ad84, hair: 0x7a4a26, wood: 0x7a5230, leather: 0x5a3b22, horse: 0x8a5a36, mane: 0x3b2a1e, rim: 0x3a78d8, base: 0x2d5fb6, bevel: 0x6f9be6, flock: 0x6f8f48 },
  undead: { cloth: 0x5b3a7a, cloth2: 0x2b2533, metal: 0x6e6f78, trim: 0x9be15d, skin: 0xe6dcc3, hair: 0x2b2533, wood: 0x4a3a2c, leather: 0x3a2e28, horse: 0x2b2533, mane: 0x1a161e, rim: 0x9b59d0, glow: 0x7dff9a, rust: 0x8a5a3a, base: 0x5e3a88, bevel: 0xa47ad0, flock: 0x5f6b44 },
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
const RALLY = (ap, radius, cd = 2) => ({ kind: 'rally', name: 'Rally', cat: 'defense', ap, radius, defends: 1, dmgMult: 1.25, cd });
//  sweep  : a full circle swing around the hero
const SWEEP = (ap, dmg, reach, cd = 2) => ({ kind: 'sweep', name: 'Sweep', cat: 'attack', ap, dmg, reach, cd });
//  leap   : jump to a point (over terrain and squads); the landing shoves adjacent enemies back
const LEAP = (ap, range, cd = 2) => ({ kind: 'leap', name: 'Heroic Leap', cat: 'move', ap, range, flight: 6, shove: 1, cd });
//  step   : vanish and reappear at a point when the wind-up ends; no parting blows
const STEP = (ap, range, cd = 2) => ({ kind: 'step', name: 'Shadow Step', cat: 'move', ap, range, cd });
//  wall   : until the round ends, hits from the front 120 degrees deal 30%
const WALL = (name, ap = 15, cd = 1) => ({ kind: 'wall', name, cat: 'defense', ap, mult: 0.3, cosHalf: 0.5, cd });
//  pierce : a bolt line that hits every target along it (walls still stop it)
const PIERCE = (ap, dmg, range, width = 0.7, cd = 2) => ({ kind: 'pierce', name: 'Piercing Bolt', cat: 'attack', ap, dmg, range, width, cd });
//  raise  : friendly squads in a circle around the caster regain one fallen model each
const RAISE = (ap, radius, cd = 3) => ({ kind: 'raise', name: 'Raise', cat: 'defense', ap, radius, cd });

// Unit roles are the same for both sides; looks and numbers differ a little.
//  models: miniatures in the squad, hpPer: HP of each model, dmg is PER MODEL alive
export const FACTIONS = {
  kingdom: {
    name: 'Kingdom', short: 'KGD', colorCss: '#3a78d8',
    units: {
      hero:    { name: 'Lord Commander', role: 'hero', models: 1, hpPer: 120, armor: 9, tier: 5, look: 'lord', vision: 12, defends: 2, attack: SWING(25, 18, 1.6), skills: [LEAP(20, 7), SWEEP(30, 14, 1.6), RALLY(20, 5)] },
      tank:    { name: 'Shieldwall', role: 'tank', models: 3, hpPer: 34, armor: 12, tier: 4, look: 'shield', vision: 9, defends: 2, attack: SWING(30, 4, 1.3), skills: [WALL('Lock Shields')] },
      fighter: { name: 'Men-at-arms', role: 'fighter', parry: true, models: 4, hpPer: 20, armor: 7, tier: 5, look: 'sword', vision: 9, defends: 1, attack: SWING(25, 5, 1.5) },
      ranged:  { name: 'Crossbows', role: 'ranged', models: 4, hpPer: 15, armor: 3, tier: 5, look: 'crossbow', vision: 11, defends: 1, attack: VOLLEY(30, 4, 14), skills: [PIERCE(35, 5, 16)] },
      fast:    { name: 'Outriders', role: 'fast', models: 3, hpPer: 24, armor: 5, tier: 6, look: 'rider', vision: 11, defends: 1, attack: SWING(20, 7, 1.7), skills: [CHARGE(35, 9, 9)] },
    },
  },
  undead: {
    name: 'Undead Legion', short: 'UND', colorCss: '#9b59d0',
    units: {
      hero:    { name: 'Necromancer', role: 'hero', models: 1, hpPer: 118, armor: 7, tier: 5, look: 'necro', vision: 12, defends: 2, attack: SWING(25, 16, 1.6), skills: [STEP(15, 7), BLAST(30, 16, 9, 2.2), RAISE(25, 3)] },
      tank:    { name: 'Grave Guard', role: 'tank', models: 3, hpPer: 34, armor: 11, tier: 4, look: 'graveguard', vision: 9, defends: 2, attack: SWING(30, 5, 1.3), skills: [WALL('Grave Wall')] },
      fighter: { name: 'Skeleton Warband', role: 'fighter', parry: true, models: 5, hpPer: 15, armor: 5, tier: 5, look: 'skeleton', vision: 9, defends: 1, attack: SWING(25, 4, 1.5) },
      ranged:  { name: 'Bone Archers', role: 'ranged', models: 4, hpPer: 16, armor: 2, tier: 5, look: 'archer', vision: 11, defends: 1, attack: VOLLEY(30, 4, 14, 0.9), skills: [STORM(35, 6, 15, 2.2)] },
      fast:    { name: 'Wraiths', role: 'fast', models: 3, hpPer: 24, armor: 4, tier: 6, look: 'wraith', vision: 11, defends: 1, ghost: true, attack: SWING(20, 7, 1.7), skills: [CHARGE(35, 8, 9)] },
    },
  },
};

// Buildings (both factions share the rules; names and looks differ).
//  shape: 'rect' (w x d, rotated by rot 0/90) or 'circle' (r). fire: { dmg (x4 shots), range }
export const BUILDINGS = {
  hq:       { name: { kingdom: 'Keep', undead: 'Crypt' }, icon: 'goal', cost: 0, build: 0, hp: 320, armor: 12, shape: 'rect', w: 4, d: 4, vision: 10, fire: { dmg: 3, range: 8 } },
  barracks: { name: { kingdom: 'Barracks', undead: 'Ossuary' }, icon: 'spawn', cost: 30, build: 1, hp: 150, armor: 8, shape: 'rect', w: 3.5, d: 2.5, vision: 6 },
  tower:    { name: { kingdom: 'Watchtower', undead: 'Bone Spire' }, icon: 'range', cost: 25, build: 1, hp: 110, armor: 6, shape: 'circle', r: 0.9, vision: 13, fire: { dmg: 4, range: 11 } },
  banner:   { name: { kingdom: 'Banner', undead: 'Obelisk' }, icon: 'cp', cost: 20, build: 1, hp: 60, armor: 4, shape: 'circle', r: 0.55, vision: 6, cp: 1 },
  wall:     { name: { kingdom: 'Palisade', undead: 'Bone Fence' }, icon: 'fortify', cost: 8, build: 0, hp: 80, armor: 6, shape: 'rect', w: 3, d: 0.5, vision: 0 },
};
export const BUILD_ORDER = ['barracks', 'tower', 'banner', 'wall'];
// what a barracks can train (supply cost); heroes can't be trained
export const TRAIN_COST = { tank: 25, fighter: 20, ranged: 22, fast: 26 };

export const ROLE_ORDER = ['hero', 'tank', 'fighter', 'ranged', 'fast'];

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
export const SKILL_KINDS = ['charge', 'blast', 'rally', 'storm', 'sweep', 'leap', 'step', 'wall', 'pierce', 'raise'];
// skills cast on the squad itself (no aim): tap the knob to use
export const SELF_SKILLS = ['rally', 'sweep', 'wall', 'raise'];
export const cdOf = (q, kind) => (q.cd && q.cd[kind]) | 0;
export const CAT_COLOR = { move: '#34c759', attack: '#ff3b30', defense: '#3fa9ff' };
export const isShooter = def => def.attack.kind === 'volley' || def.attack.kind === 'lob';
