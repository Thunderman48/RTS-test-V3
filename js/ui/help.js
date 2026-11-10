import { CONFIG } from '../config.js';
import { glyph } from './icons.js';

export function helpHTML() {
  const U = CONFIG.units;
  const row = (t) => {
    const d = U[t];
    const atk = d.strike ? `${d.strike.dmg} dmg / ${d.strike.ap} AP` : `${d.shot.dmg} dmg / ${d.shot.ap} AP, range ${d.shot.range}`;
    return `<tr><td>${glyph(t, 0, 14)} ${d.name}</td><td>${d.tier}</td><td>${d.hp}</td><td>${d.armor}</td><td>${d.defends}</td><td>${atk}</td><td>${d.skills.map(k => `${k.name} (cd ${k.cd})`).join(', ')}</td></tr>`;
  };
  return `
<p><button class="btn" id="help-tutorial" style="display:inline-flex;height:40px">▸ Play the 5-minute tutorial</button></p>

<h3>Goal</h3>
<p>Destroy the enemy <b>HQ</b>. You are the <b>white</b> pieces vs the AI; online, the host is white and the guest is black. The orange arrow in the top bar points to the enemy HQ.</p>

<h3>1 · What will my units do?</h3>
<ul>
<li>Tap a unit. Its card shows its <b>stance</b> and a plain sentence: <b>"This round it will…"</b>. Units you don't control just follow that.</li>
<li>Change a stance any time (free). Press <b>Control</b> (1 CP, commander free) to give exact orders instead: Move, Attack, skills, Defend +1, Act earlier.</li>
<li>The bar under <b>Your orders</b> is the unit's round: each block is an action, longer = takes more time. <b>Red = unused AP</b>, which is lost.</li>
<li>In Attack mode, enemies show <b>✓ in reach</b> or <b>✕ N rnds</b> (too far this round).</li>
<li>The <b>turn order</b> strip (top) shows who acts 1st, 2nd, 3rd. Units in the same group act at the same time.</li>
<li>READY warns you if a controlled unit would waste AP.</li>
</ul>

<h3>2 · What is happening?</h3>
<ul>
<li>The round plays <b>step by step</b>, one tier at a time. A banner says who acts, orange rings mark them, arrows show who they attack.</li>
<li>The timeline at the bottom shows each acting unit's actions over time (AP = time).</li>
<li>After each step a card lists what happened in plain words. Use <b>Next step</b>, <b>Replay step</b>, or <b>Auto</b> (plays without stopping). <b>Cam</b> turns camera following on/off.</li>
</ul>

<h3>3 · What happened, and why?</h3>
<ul>
<li>After the round, the <b>What happened</b> card lists each of your units: HP before → after, kills, and <b>why an order failed</b> (⊘), e.g. "target out of reach (needed ~82 AP, had 75)".</li>
<li>On the map: orange <b>−N</b> chips = damage taken, <b>⊘</b> = a failed order (tap it), <b>✕</b> = a unit died there, grey trails = where enemies moved.</li>
<li>Reopen the card with ≣ in the top bar, or watch the round again with ↺.</li>
</ul>

<h3>A round</h3>
<ul>
<li><b>Planning</b>: both players plan at the same time. Press <b>Ready</b> when done (online: a ${CONFIG.planningTimerSec}s timer is the safety net).</li>
<li><b>Resolution</b>: speed tiers act from fastest to slowest; buildings act last. Inside a tier everyone acts <i>at once</i> on a shared timeline where an action's AP cost is its duration.</li>
<li><b>Economy</b>: income, construction and production advance one step.</li>
</ul>

<h3>AP, tiers and command points</h3>
<ul>
<li>Every unit gets <b>${CONFIG.baseAP} AP</b> per round (wounded units get less from the next round). Tiers: slow 4, normal 5, fast 6.</li>
<li><b>Tier+</b> costs ${CONFIG.tierUpgradeCost[0]} AP, a second one ${CONFIG.tierUpgradeCost[1]} AP. It only changes turn order, not distance.</li>
<li>Tap a unit to see its <b>stance</b>: what it will do on its own this round (dashed preview lines). Changing stance is <b>free</b>.</li>
<li>Press <b>Control</b> to give a unit exact orders. That costs <b>1 CP</b> (you have ${CONFIG.cp.base} + 1 per Command Post). <b>Release</b> refunds it. Your <b>commander</b> is a hero and is always free to control.</li>
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
<li><b>Dash</b> (Assassin): fixed ${U.assassin.skills[0].length}-unit straight move; cancelled inside or into an enemy control zone.</li>
<li><b>Shove</b> (Fighter): pushes the target ${U.fighter.skills[0].push} units — breaks its control zone.</li>
<li><b>Frag</b> (Ranged): area ${U.ranged.skills[0].radius}, ${U.ranged.skills[0].dmg} dmg, unparryable, hits allies.</li>
<li><b>Fortify</b> (Tank): +${U.tank.skills[0].defends} defends and +${U.tank.skills[0].armor} armor this round.</li>
<li>Commander (hero) skills, each with its own cooldown:<ul>${U.commander.skills.map(k => `<li><b>${k.name}</b>: ${k.desc}</li>`).join('')}</ul></li>
</ul>

<h3>Economy</h3>
<ul>
<li>HQ gives ${CONFIG.economy.hqIncome} supply per round; each captured <b>resource node</b> gives ${CONFIG.economy.nodeIncome}. Capture a node by being the only side near it at round end.</li>
<li>Build near your HQ or an Outpost. Units out of combat for ${CONFIG.economy.outOfCombatRounds} rounds slowly heal (faster near base). Paid heal: ${CONFIG.economy.healCost} supply near base.</li>
</ul>

<h3>Name plates</h3>
<ul>
<li>Every unit has a <b>name plate</b>: the square is its tier (when it acts), then its name and HP bar. White plates are the white side, black plates the black side.</li>
<li>Tap <b>ⓘ</b> next to any term for a short explanation. <b>◎</b> in the top bar shows all details (every zone, plan line and defend pip).</li>
</ul>

<h3>Controls</h3>
<ul>
<li><b>Tap</b> a unit to see its stance. After <b>Control</b>: tap the ground to move, tap an enemy to attack/shoot, and use the panel for skills, defends and tiers.</li>
<li><b>Multi</b> button (or long-press) adds units to the selection for group orders.</li>
<li><b>Drag</b> to pan, <b>pinch</b> to zoom, <b>two-finger twist</b> to rotate. Desktop: drag / wheel / right-drag, <kbd>WASD</kbd> <kbd>Q</kbd><kbd>E</kbd>, <kbd>Space</kbd> = Ready, <kbd>Esc</kbd> = cancel, <kbd>Backspace</kbd> = undo.</li>
<li>Numbers in the square badge above a unit are its <b>tier</b>; small boxes are its defends.</li>
</ul>
<p class="fine">All numbers are prototype values and live in <code>js/config.js</code>.</p>`;
}
