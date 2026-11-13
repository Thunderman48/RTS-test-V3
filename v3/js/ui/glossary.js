// Plain-language definitions shown when a player taps an ⓘ chip.
import { CONFIG } from '../config.js';
import { icon } from './iconset.js';

export const GLOSSARY = {
  AP: ['Action points (AP)', `Every unit gets ${CONFIG.baseAP} AP each round. Every action costs AP, and the AP cost is also how long the action takes. AP you don't use is lost (except on stance units, which spend it on defends).`],
  Tier: ['Tier (turn order)', 'Higher tiers act first: fast units are tier 6, normal 5, slow 4. Units in the same tier act at the same time. "Tier +1" makes a unit act earlier, but costs AP. Buildings always act last.'],
  CP: ['Command points (CP)', `You can take direct control of ${CONFIG.cp.base} units per round (more with Command Posts). Each controlled unit costs 1 CP. Your commander is always free. Everyone else follows their stance.`],
  Stance: ['Stance', 'What a unit does on its own when you don\'t control it. It keeps doing this every round until you change it. Changing a stance is free.'],
  Defend: ['Defends', 'Each defend shrinks the damage of one hit. Units get some free defends every round, and you can buy more with AP (Defend +1). The strongest hit uses a defend first.'],
  Zone: ['Control zone', `Melee units have a zone (dashed ring). Enemies inside move at ${CONFIG.zoneMoveFactor * 100}% speed. The zone lasts until its owner moves or attacks, so units that hold still keep it.`],
  Parry: ['Parry (Fighter)', `Costs ${CONFIG.parryCost} AP. Blocks one hit of ${CONFIG.parryThreshold} damage or less, and hits a melee attacker back for free.`],
  Overwatch: ['Overwatch (Ranged)', `Costs ${CONFIG.overwatchCost} AP per charge. Fires automatically at the closest visible enemy that moves within range ${CONFIG.overwatchRange}. Always hits, low damage.`],
  Cooldown: ['Cooldown', 'After a skill is used, it can\'t be used again for that many rounds. A cooldown of 2 means it is ready again on the third round.'],
  Supply: ['Supply', `Money for buildings and units. Your HQ gives +${CONFIG.economy.hqIncome} each round, and each resource node you hold gives +${CONFIG.economy.nodeIncome}.`],
  Army: ['Army', `How many units you have (plus ones being trained) out of the cap of ${CONFIG.economy.armyCap}. The commander doesn't count.`],
  Reach: ['Reach', 'Whether this unit can get to the target this round with the AP it has left. If not, the attack becomes a move toward the target so no AP is wasted.'],
};

export function glChip(key) {
  return `<button class="gl" data-gl="${key}" aria-label="What is ${key}?">ⓘ</button>`;
}

let pop = null;
export function showGlossary(key, anchor) {
  const d = GLOSSARY[key];
  if (!d) return;
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'glossary-pop';
    document.body.appendChild(pop);
    document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !e.target.closest?.('.gl')) pop.classList.add('hidden'); }, true);
  }
  const ICON_OF = { AP: 'ap', Tier: 'tier', CP: 'cp', Stance: 'stance', Defend: 'defend', Zone: 'zone', Parry: 'parry', Overwatch: 'overwatch', Cooldown: 'cooldown', Supply: 'supply', Reach: 'attack', Army: 'army' };
  pop.innerHTML = `<b>${icon(ICON_OF[key], 18)} ${d[0]}</b><p>${d[1]}</p>`;
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 16);
  pop.style.width = w + 'px';
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - w / 2));
  pop.style.left = left + 'px';
  const top = r.top - 10;
  pop.style.top = '0px';
  const h = pop.offsetHeight;
  pop.style.top = (top - h > 8 ? top - h : r.bottom + 10) + 'px';
}
