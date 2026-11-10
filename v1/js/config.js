// ============================================================================
// ALL TUNABLE NUMBERS LIVE HERE.
// The design doc leaves most numbers open; these are prototype starting values.
// Change anything below and reload the page to rebalance.
// ============================================================================

export const CONFIG = {
  // ---- Map ---------------------------------------------------------------
  map: { w: 48, h: 32, navCell: 0.5 },

  // ---- Rounds / turn structure ---------------------------------------------
  baseAP: 100,                 // every unit gets the same AP each round
  tierUpgradeCost: [15, 25],   // 1st tier upgrade 15 AP, 2nd 25 AP (turn order only)
  maxTierUpgrades: 2,
  minTier: 1,                  // tiers can be lowered below slow (4) down to this
  planningTimerSec: 90,        // multiplayer safety-net timer
  roundLimit: 80,              // stalemate protection: after this, most building HP wins

  // Health lowers AP (applied from the next round; computed at round start)
  woundSteps: [                // [hp fraction below which, AP lost]
    [0.66, 10],
    [0.33, 25],
  ],

  // Movement: distance per AP = baseTier * moveFactor (normal tier 5 => 0.06/AP => 6 units / 100 AP)
  moveFactor: 0.012,
  unitRadius: 0.45,
  meleeReach: 0.55,            // extra distance beyond touching for melee strikes

  // Control zones
  zoneMoveFactor: 0.5,         // enemies inside a zone move this fraction of distance per AP

  // Defense
  extraDefendCost: 20,
  maxExtraDefends: 4,
  // final damage = dmg * armorMult * (defended ? defendMult : 1)
  // armorMult  = armorK / (armorK + armor)
  // defendMult = clamp(defendMin, defendMax, defendBase + (dmg - armor) / defendSlope)
  armorK: 20,
  defendBase: 0.4, defendSlope: 80, defendMin: 0.2, defendMax: 0.75,
  coverRadius: 2.5,            // unit within this of a barricade gets +1 defend vs ranged crossing it
  defenderBonus: { radius: 8, defends: 1 }, // comeback tool: +1 free defend near own HQ

  // Parry (fighter)
  parryCost: 20,
  parryThreshold: 18,          // hits with damage <= this can be parried

  // Overwatch (ranged)
  overwatchCost: 35,
  maxOverwatch: 2,
  overwatchDamage: 8,
  overwatchRange: 8,

  // Command points
  cp: {
    base: 3,
    perCommandPost: 1,
    commanderBonus: 2,         // only usable on units in commander range at planning start
    commanderRange: 7,
    stanceUnitsPerCP: 4,       // 1 CP changes stance of up to this many units
    boostCost: 1,              // CP per production building per round
  },

  // Commander revive
  revive: { radius: 2.2, rounds: 3, hpFrac: 0.5 },

  // Economy
  economy: {
    startSupply: 50,
    hqIncome: 8,
    nodeIncome: 4,
    nodeRadius: 2.5,
    armyCap: 16,               // excluding commander
    buildRadius: 8,            // around HQ / outposts
    outOfCombatRounds: 2,
    regenFrac: 0.04,           // per round when out of combat
    baseRegenFrac: 0.06,       // extra when near own HQ/outpost
    baseRegenRadius: 6,
    healCost: 10,              // paid heal near HQ/outpost
    healFrac: 0.35,
  },

  // ---- Units -------------------------------------------------------------
  // tier: base speed tier (slow 4, normal 5, fast 6)
  // strike: basic attack {ap, dmg}; zone: control zone radius (melee only)
  units: {
    assassin: {
      name: 'Assassin', tier: 6, hp: 60, armor: 4, defends: 1, vision: 8,
      cost: 30, buildRounds: 2, melee: true, zone: 1.6,
      strike: { ap: 20, dmg: 24 },
      skill: { id: 'dash', name: 'Dash', ap: 20, cd: 2, length: 5 },
    },
    fighter: {
      name: 'Fighter', tier: 5, hp: 90, armor: 8, defends: 1, vision: 7,
      cost: 25, buildRounds: 2, melee: true, zone: 2.2,
      strike: { ap: 25, dmg: 16 },
      skill: { id: 'shove', name: 'Shove', ap: 25, cd: 2, dmg: 6, push: 3 },
      parry: true,
    },
    ranged: {
      name: 'Ranged', tier: 5, hp: 60, armor: 3, defends: 1, vision: 9,
      cost: 25, buildRounds: 2, melee: false, zone: 0,
      shot: { ap: 30, dmg: 14, range: 10 },
      skill: { id: 'frag', name: 'Frag', ap: 35, cd: 3, dmg: 18, range: 9, radius: 1.8, hitsAllies: true, unparryable: true },
      overwatch: true,
    },
    tank: {
      name: 'Tank', tier: 4, hp: 140, armor: 12, defends: 2, vision: 7,
      cost: 40, buildRounds: 3, melee: true, zone: 3.2,
      strike: { ap: 30, dmg: 12 },
      skill: { id: 'fortify', name: 'Fortify', ap: 20, cd: 3, defends: 2, armor: 6, prepaid: true },
    },
    commander: {
      name: 'Commander', tier: 5, hp: 120, armor: 8, defends: 2, vision: 9,
      cost: 0, buildRounds: 0, melee: true, zone: 2.2, hero: true,
      strike: { ap: 25, dmg: 18 },
      skill: { id: 'disrupt', name: 'Disrupt', ap: 25, cd: 3, range: 6, drain: 25, tierDown: 1 },
    },
  },

  // ---- Buildings ---------------------------------------------------------
  // Buildings act last each round. They have AP but no defends.
  buildings: {
    hq:        { name: 'HQ', hp: 450, r: 1.6, vision: 10, cost: 0, rounds: 0,
                 produces: ['fighter', 'ranged'], attack: { dmg: 10, range: 6, ap: 100 } },
    barracks:  { name: 'Barracks', hp: 250, r: 1.3, vision: 6, cost: 40, rounds: 2,
                 produces: ['fighter', 'assassin', 'tank'] },
    turret:    { name: 'Turret', hp: 200, r: 0.8, vision: 9, cost: 35, rounds: 2,
                 attack: { dmg: 14, range: 8, ap: 50 } },
    command:   { name: 'Command Post', hp: 200, r: 1.0, vision: 7, cost: 50, rounds: 3 },
    outpost:   { name: 'Outpost', hp: 180, r: 1.0, vision: 9, cost: 30, rounds: 2, outpost: true },
    barricade: { name: 'Barricade', hp: 120, r: 0.7, vision: 3, cost: 10, rounds: 1, cover: true },
  },
  buildingAP: 100,

  // ---- Stances -----------------------------------------------------------
  stance: {
    guardRange: 6,             // melee guard reacts to enemies this close
    holdGroundLeash: 3,
    advanceEngage: 5,          // advance stance engages enemies this close
    guardSpreadDeg: [0, 7, -7, 14, -14],
  },
};

export const ROLE_ORDER = ['commander', 'fighter', 'assassin', 'ranged', 'tank'];
export const STANCES = ['guard', 'hold', 'holdground', 'advance', 'retreat'];
export const STANCE_NAMES = {
  guard: 'Guard', hold: 'Hold', holdground: 'Hold ground', advance: 'Advance', retreat: 'Retreat',
};
