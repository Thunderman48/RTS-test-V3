import { CONFIG } from '../config.js';
import { glyph } from './icons.js';

export function helpHTML() {
  const U = CONFIG.units;
  const row = (t) => {
    const d = U[t];
    const atk = d.strike ? `${d.strike.dmg} dmg / ${d.strike.ap} AP` : `${d.shot.dmg} dmg / ${d.shot.ap} AP, range ${d.shot.range}`;
    return `<tr><td>${glyph(t, 0, 14)} ${d.name}</td><td>${d.tier}</td><td>${d.hp}</td><td>${d.armor}</td><td>${d.defends}</td><td>${atk}</td><td>${d.skill.name} (cd ${d.skill.cd})</td></tr>`;
  };
  return `
<h3>Goal</h3>
<p>Destroy the enemy <b>HQ</b>. Build an economy, train units and fight in rounds. You are the <b>white</b> pieces vs AI; online, the host is white and the guest is black.</p>

<h3>A round</h3>
<ul>
<li><b>Planning</b> — both players plan at the same time. Press <b>Ready</b> when done (online: a ${CONFIG.planningTimerSec}s timer is the safety net).</li>
<li><b>Resolution</b> — speed tiers act from fastest to slowest; buildings act last. Inside a tier everyone acts <i>at once</i> on a shared timeline where an action's AP cost is its duration.</li>
<li><b>Economy</b> — income, construction and production advance one step.</li>
</ul>

<h3>AP, tiers and command points</h3>
<ul>
<li>Every unit gets <b>${CONFIG.baseAP} AP</b> per round (wounded units get less from the next round). Tiers: slow 4, normal 5, fast 6.</li>
<li><b>Tier+</b> costs ${CONFIG.tierUpgradeCost[0]} AP, a second one ${CONFIG.tierUpgradeCost[1]} AP. It only changes turn order, not distance.</li>
<li>Directly ordering a unit costs <b>1 CP</b> (you have ${CONFIG.cp.base} + 1 per Command Post). The <b>commander</b> is free to order and gives ${CONFIG.cp.commanderBonus} extra CP usable only on units within ${CONFIG.cp.commanderRange} of it.</li>
<li>Units you don't order follow their <b>stance</b> (dashed preview lines). Changing stance costs 1 CP per ${CONFIG.cp.stanceUnitsPerCP} units.</li>
<li>For directly ordered units, AP you don't assign is lost — spend it on <b>Defend+</b>.</li>
</ul>

<h3>Combat rules</h3>
<ul>
<li><b>Defends</b>: each unit has free defends per round; each reduces one hit. Extra defends cost ${CONFIG.extraDefendCost} AP. The strongest simultaneous hit uses the defend first.</li>
<li><b>Control zones</b> (dashed rings around melee units): enemies inside move at ${CONFIG.zoneMoveFactor * 100}% speed. A zone lasts until its owner moves or acts (or is pushed).</li>
<li><b>Parry</b> (Fighter, ${CONFIG.parryCost} AP): replaces the first defend, blocks a hit of ≤${CONFIG.parryThreshold} damage and counterattacks melee instantly.</li>
<li><b>Overwatch</b> (Ranged, ${CONFIG.overwatchCost} AP per charge): fires once per enemy action at the closest visible enemy moving in range (${CONFIG.overwatchRange}). Always hits, ${CONFIG.overwatchDamage} damage.</li>
<li><b>Shots</b> are aimed at a <i>place</i> — a slower shooter must aim where the enemy <i>will be</i>. Line shots stop at the first enemy or wall. Frag grenades pass over walls and hit everyone in the area (allies too).</li>
<li><b>Barricades</b> give +1 defend vs shots that cross them. Hit checks happen when the attack lands, not when it was ordered.</li>
<li>Same-moment hits both land — both units can die.</li>
<li>Dead commanders leave a revive zone: keep a unit there for ${CONFIG.revive.rounds} rounds to bring them back.</li>
</ul>

<h3>Units</h3>
<table><tr><th>Unit</th><th>Tier</th><th>HP</th><th>Armor</th><th>Defends</th><th>Attack</th><th>Skill</th></tr>
${['commander', 'fighter', 'assassin', 'ranged', 'tank'].map(row).join('')}</table>
<ul>
<li><b>Dash</b> (Assassin): fixed ${U.assassin.skill.length}-unit straight move; cancelled inside or into an enemy control zone.</li>
<li><b>Shove</b> (Fighter): pushes the target ${U.fighter.skill.push} units — breaks its control zone.</li>
<li><b>Frag</b> (Ranged): area ${U.ranged.skill.radius}, ${U.ranged.skill.dmg} dmg, unparryable, hits allies.</li>
<li><b>Fortify</b> (Tank): +${U.tank.skill.defends} defends and +${U.tank.skill.armor} armor this round.</li>
<li><b>Disrupt</b> (Commander): drains ${U.commander.skill.drain} AP from the end of the target's plan and lowers its tier by 1.</li>
</ul>

<h3>Economy</h3>
<ul>
<li>HQ gives ${CONFIG.economy.hqIncome} supply per round; each captured <b>resource node</b> gives ${CONFIG.economy.nodeIncome}. Capture a node by being the only side near it at round end.</li>
<li>Build near your HQ or an Outpost. Units out of combat for ${CONFIG.economy.outOfCombatRounds} rounds slowly heal (faster near base). Paid heal: ${CONFIG.economy.healCost} supply near base.</li>
</ul>

<h3>Controls</h3>
<ul>
<li><b>Tap</b> a unit to select it, tap the ground to move, tap an enemy to attack/shoot. Use the panel for skills, defends, tiers and stances.</li>
<li><b>Multi</b> button (or long-press) adds units to the selection for group orders.</li>
<li><b>Drag</b> to pan, <b>pinch</b> to zoom, <b>two-finger twist</b> to rotate. Desktop: drag / wheel / right-drag, <kbd>WASD</kbd> <kbd>Q</kbd><kbd>E</kbd>, <kbd>Space</kbd> = Ready, <kbd>Esc</kbd> = cancel, <kbd>Backspace</kbd> = undo.</li>
<li>Numbers in the square badge above a unit are its <b>tier</b>; small boxes are its defends.</li>
</ul>
<p class="fine">All numbers are prototype values and live in <code>js/config.js</code>.</p>`;
}
