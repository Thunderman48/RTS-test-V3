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
  roundLimit: 40,
  planningTimerSec: 120,
};

// Paint colours for the miniatures (basic flat colours, like a quick tabletop paint job)
export const PAINT = {
  kingdom: { cloth: 0x2f5aa8, cloth2: 0xf2efe6, metal: 0xc4cad3, trim: 0xe0b84f, skin: 0xe2ad84, wood: 0x7a5230, leather: 0x5a3b22, horse: 0x8a5a36, rim: 0x3a78d8 },
  undead: { cloth: 0x5b3a7a, cloth2: 0x2b2533, metal: 0x6e6f78, trim: 0x9be15d, skin: 0xe6dcc3, wood: 0x4a3a2c, leather: 0x3a2e28, horse: 0x2b2533, rim: 0x9b59d0, glow: 0x7dff9a },
};

// Attack shapes:
//  swing  : arc in front of the squad (reach beyond the squad's edge, half-angle cos)
//  volley : straight line toward the aim point (range, width); stopped by hard cover
const SWING = (ap, dmg, reach = 1.5) => ({ kind: 'swing', ap, dmg, reach, cosHalf: 0.5 });
const VOLLEY = (ap, dmg, range, width = 0.7) => ({ kind: 'volley', ap, dmg, range, width });

// Unit roles are the same for both sides; looks and numbers differ a little.
//  models: miniatures in the squad, hpPer: HP of each model, dmg is PER MODEL alive
export const FACTIONS = {
  kingdom: {
    name: 'Kingdom', short: 'KGD', colorCss: '#3a78d8',
    units: {
      hero:    { name: 'Lord Commander', role: 'hero', models: 1, hpPer: 120, armor: 9, tier: 5, look: 'lord', vision: 12, defends: 2, attack: SWING(25, 18, 1.6) },
      tank:    { name: 'Shieldwall', role: 'tank', models: 3, hpPer: 34, armor: 12, tier: 4, look: 'shield', vision: 9, defends: 2, attack: SWING(30, 4, 1.3) },
      fighter: { name: 'Men-at-arms', role: 'fighter', models: 4, hpPer: 20, armor: 7, tier: 5, look: 'sword', vision: 9, defends: 1, attack: SWING(25, 5, 1.5) },
      ranged:  { name: 'Crossbows', role: 'ranged', models: 4, hpPer: 15, armor: 3, tier: 5, look: 'crossbow', vision: 11, defends: 1, attack: VOLLEY(30, 4, 14) },
      fast:    { name: 'Outriders', role: 'fast', models: 3, hpPer: 24, armor: 5, tier: 6, look: 'rider', vision: 11, defends: 1, attack: SWING(20, 7, 1.7) },
    },
  },
  undead: {
    name: 'Undead Legion', short: 'UND', colorCss: '#9b59d0',
    units: {
      hero:    { name: 'Necromancer', role: 'hero', models: 1, hpPer: 105, armor: 7, tier: 5, look: 'necro', vision: 12, defends: 2, attack: SWING(25, 16, 1.6) },
      tank:    { name: 'Grave Guard', role: 'tank', models: 3, hpPer: 34, armor: 11, tier: 4, look: 'graveguard', vision: 9, defends: 2, attack: SWING(30, 5, 1.3) },
      fighter: { name: 'Skeleton Warband', role: 'fighter', models: 5, hpPer: 14, armor: 5, tier: 5, look: 'skeleton', vision: 9, defends: 1, attack: SWING(25, 4, 1.5) },
      ranged:  { name: 'Bone Archers', role: 'ranged', models: 4, hpPer: 14, armor: 2, tier: 5, look: 'archer', vision: 11, defends: 1, attack: VOLLEY(30, 4, 14, 0.9) },
      fast:    { name: 'Wraiths', role: 'fast', models: 3, hpPer: 22, armor: 4, tier: 6, look: 'wraith', vision: 11, defends: 1, attack: SWING(20, 7, 1.7) },
    },
  },
};

export const ROLE_ORDER = ['hero', 'tank', 'fighter', 'ranged', 'fast'];

// Squad footprint radius (inches) from model count and look
export function squadRadius(def, models) {
  if (def.models === 1) return 0.65;
  const base = def.look === 'rider' || def.look === 'wraith' ? 0.62 : 0.5;
  return base + 0.42 * Math.sqrt(Math.max(1, models));
}

export function unitDef(faction, role) { return FACTIONS[faction].units[role]; }
