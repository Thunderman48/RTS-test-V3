# Rovina: complete game and balance reference

This document describes **every rule, number and behaviour** of the game (Rovina, at the site root) so the
game can be understood and balanced from this file alone. Tables marked *generated* are produced from
the game's data files by `npm run doc` (`node tools/gendoc.mjs`) and are always exact; the prose
around them describes the code in `js/sim/` (rules), `js/ai/` (the AI) and `js/data/` (numbers).

- Units: distances are **inches (″)** on the table; time is **AP** (action points). 1 round = 100 AP.
- Coordinates: x runs left → right (player 0 starts on the left, x small), z runs top → bottom.
- Player 0 = left side (host online / you vs AI); player 1 = right side. Maps are point-symmetric:
  a point (x, z) mirrors to (W − x, H − z).
- Everything in the sim is **deterministic**: same state + same orders = same result, on every machine.

Contents: 1 Overview · 2 Round structure · 3 Orders and limits · 4 Stances · 5 Combat ·
6 Movement and collisions · 7 Units (generated) · 8 Skills (generated) · 9 Derived combat numbers
(generated) · 10 Economy (generated + rules) · 11 Buildings and builders · 12 Fog of war and intel ·
13 Maps (generated) · 14 AI · 15 Online · 16 Balance status · 17 Tuning guide · 18 Change log ·
19 Keeping this document up to date · 20 Design references

---

## 1. Overview and win conditions

Two armies (**Kingdom** vs **Undead Legion**; mirror matches allowed) fight on a table. Both players
give orders at the same time, then the round resolves. Squads act in **speed tiers** (fast first); in a
tier everything happens at once on a shared timeline where an action's AP cost is how long it takes.
Every attack is a **non-targeted skillshot**: it hits whatever is in its shape when it lands.

**Win / loss (checked at the end of every round):** a side **loses** if
1. its **HQ** (Keep / Crypt) is destroyed, **or**
2. it has **no squads left and no finished barracks**.

If both sides lose in the same round it is a **draw**. **There is no round limit.**

Each side starts with: an HQ (at one of the map's 3 seeded HQ spots on its back edge), its army deployed
in front of it, and its faction's starting resource. **Small starting armies** (since 2026-11-16; the
rest comes from the base): **Kingdom:** The Chosen, **Men-at-arms** and **1 peasant (builder) squad**.
**Undead:** the Lich and **a Skeleton Warband pair** (2 swarm squads). The Keep trains peasants
and Men-at-arms; the Crypt trains the swarm.

**The two factions play differently** (since 2026-11-15):
- **Kingdom (all-rounder, beginner friendly):** plain squads with decent stats; peasants build every
  building and farm big farms for gold, so the economy grows strong late. Hero **The Chosen**: Leap
  Strike, Rally (+armour), Mighty Swing (stun).
- **Undead Legion (a never-ending horde, snowbally and slow to expand):** every squad is weaker but
  about half the price, and the **Skeleton Warband** swarm comes two squads at a time; **no builders**:
  buildings **rise out of the ground** on their own and spread **graveyards** around them; souls come
  from **deaths on grave ground** (which widens it; cheap squads pay back more than they cost), plus a
  tiny trickle from the Crypt (1) and Soul Wells (2). Hero **the Lich**, a slow **mage** with **mana**:
  Summon Warband (temporary skeletons), Dark Thunder (chain lightning), Corpse Explosion; its weaker
  caster troop, **Necromancers**, comes from the Ossuary. The **Monolith** (raised near a caster, off
  graves) spreads graves and heals instead of giving command points.
- **Both:** a fallen hero leaves a **revive zone**; hold it for 3 rounds to bring the hero back (§5.7b).

---

## 2. Round structure and timing (`js/sim/resolve.js` → `resolveRound`)

A round, in order:

1. **Planning** (players / AI build orders; not part of the sim).
2. **Intel update** (each side remembers enemy buildings it sees, §12).
3. **Order validation** (`js/sim/orders.js` → `validateOrders`, §3). Stance changes apply.
4. **Production queues at round start** (§10.3, `applyQueue` then `startQueues` in `js/sim/base.js`):
   this round's queue edits are applied for side 0 then side 1 (cancelled training is refunded); then for
   side 0, then side 1: the **build queue** starts what it can in order (each started item is paid and
   its **site is placed immediately**: blocks movement, can be attacked), then each training building
   (in building id order) starts its next squad if it is idle (paid now).
5. **Stance plans** are built for every squad without direct orders, from the positions at the start
   of the round and only from enemies its side **can see** at that moment (§4, §12).
6. **Prepared states at round start:** defends, parry, overwatch (and its cone direction), and
   **Lock Shields / Grave Wall** if the squad's plan contains it (braced for the whole round).
7. **Tiers, fastest to slowest:** tier = unit tier + act-earlier upgrades (max +2), so tiers run
   **8, 7, 6, 5, 4, 3, 2, 1** (only those with squads). Each tier is a segment:
   - All squads of the tier run their action lists **simultaneously**, 1 AP per step.
   - Each AP step: every acting squad does one AP of its current action → all walking squads move
     one AP (collisions, §6) → stopped friendly squads that overlap drift apart → overwatch checks
     (any tier, §5.9) → **all hits produced in this AP are applied together** (§5.1) → deaths checked
     (a squad killed this AP still delivered its own attacks this AP).
   - The segment ends when every squad of the tier has finished its actions; then up to 24 extra AP
     of "settling" separate friendly squads that overlap.
8. **Buildings act last** (segment "tier 0"): every finished **Watchtower / Bone Spire** and **HQ**
   fires one shot at the **nearest visible enemy squad** within range (§11.6).
9. **End of round:** fallen heroes leave a **revive zone** → destroyed undead buildings leave their
   **graveyard** as a patch → destroyed squads and buildings are removed → building HP rounded →
   **training** counters tick and finished squads spawn next to their building (a swarm pair: 2) →
   **summoned squads** lose 1 round of life (crumble at 0) → **undead sites rise** (+80 work) and
   finished undead buildings mend 5 % → **finished Monoliths heal** nearby own squads (§11.3c) →
   **mages regain mana**; carried-over stun still left is dropped →
   **resource sites** change owner (whoever has a *finished* Mine / Soul Well on it) → **souls** are paid
   for this round's deaths **on grave ground** (and those graveyards widen) → every undead graveyard
   grows 1″ toward its max → **revive zones** gain progress (and heroes return) → **income** is paid →
   intel update → **skill cooldowns tick** → win check → round number + 1.

**AP is time:** an action costing 25 AP takes 25 AP of the tier's timeline. A squad has exactly
`RULES.ap` = 100 AP per round. Unspent AP is lost (stance plans and the AI turn leftovers into defends).

**Speed:** a squad walks `tier × RULES.moveFactor` = tier × 0.012″ per AP on open ground
(tier 4 = 4.8″, tier 5 = 6.0″, tier 6 = 7.2″ per 100 AP). **Act-earlier upgrades change when a squad
acts, not how fast it walks** (speed uses the unit's base tier). Terrain multiplies speed: **forest ×0.75** (`RULES.forestSlow`),
**stream (not at a ford) ×0.5**. Ruins, rocks, buildings and lakes block movement.

---

## 3. Orders and limits (`js/sim/orders.js`)

### 3.1 Action costs (AP)
| Order | AP | Notes |
|---|---|---|
| Move | as long as the walk takes (the planner computes it from the path and terrain) | sanitising caps the total at 100 |
| Wait | chosen | |
| Basic attack (swing / volley / lob) | the unit's `attack.ap` | may be repeated while AP lasts |
| Skill | the skill's `ap` | each skill **at most once per round**, only when its cooldown is 0 |
| Builder work (`work`) | chosen (normally all AP left) | builders only (§11) |
| Defend | 20 each, max 4 bought per round | prepaid; each defend halves one hit |
| Act earlier | 15 for the 1st upgrade, +25 for the 2nd (total 40) | prepaid; max 2 upgrades |
| Parry | 15 | prepaid; **fighters only** (`parry: true` units) |
| Overwatch | 40 | prepaid; **shooters only** (volley / lob attack) |

Prepaid costs come first; then actions are added in order until 100 AP; a move / wait / work that
does not fit is trimmed to the AP left, any other action that does not fit is dropped (and so is
everything after it).

### 3.2 Command points (CP)
- Each round a side may give **direct orders to `RULES.cp` = 3 squads**, plus **+1 per finished
  Kingdom Banner** (max +2; the Undead have no CP building since 2026-11-17). **Heroes and builders
  are free** (no CP).
- Squads without direct orders follow their **stance** (§4). Stance changes are free and unlimited.
- AI difficulty changes the AI's CP: Easy −1, Hard +1 (§14.8).

### 3.3 Production queue orders (validated in `js/sim/base.js` → `validateQueue`)
Base orders edit the persistent production queues (§10.3); nothing is paid when queueing.
- `orders.queue = { builds?, trains?: { bid: [roles] }, cancel?: [bid] }`: `builds` (the side's whole
  build queue, items `{ qid, type, x, z, rot }`) and `trains[bid]` (one building's whole queue) **replace**
  the current lists when present; lists not sent are kept. `cancel` stops the squad currently in
  training at those buildings (full refund). `repeat: { bid: role | null }` **locks** a training
  building onto one role (or unlocks it, `null`); the role must be one it trains (§10.3). The legacy `orders.builds` / `orders.trains` arrays are
  **appended** to the current queues (the AI and tests use this form).
- **Build queue:** at most `RULES.queueMaxBuild` = 5 items; needs at least one builder (alive or in
  training); type in the faction's list; a **new or moved** item must pass placement (§11.2) against the
  buildings and the earlier queue items, **ignoring squads** (they move). Items left where they were keep
  their `qid` and are re-checked when they start. Farm / Banner limits count queued items.
- **Training queue:** per finished training building, at most `RULES.queueMax` = 5 roles waiting (the
  squad in training is not counted); roles must be ones it trains (HQ: builder; Barracks / Ossuary:
  tank, fighter, ranged, fast) and the faction can train. Cost, army cap and the builder cap are
  **not** checked when queueing, only when an item starts.

---

## 4. Stances (`js/sim/stances.js` → `buildStancePlan`)

A squad without direct orders gets a plan from its stance at the start of the round, using only enemies
its side sees right now (positions at round start). Leftover AP becomes defends (up to 4).

Squads start on **Advance** (builders on Guard; summoned skeletons on Advance). Stance changes are
free; `orders.stances[id]` is one of `guard`, `hold`, `advance`, `retreat`.

- **Advance** (the default):
  1. **Targets, all equal:** every enemy squad the side sees **and every enemy building it knows of**
     (intel, §12; the HQ included) is a target, with no preference by kind. If the **nearest** one's
     edge is within **`RULES.advanceEngage` = 10″**, the squad attacks it: melee walks to striking
     distance and swings (a fighter in contact with a squad prepares a parry first); shooters walk until
     within 0.8 × range (+ the target's radius) and shoot with what is left, or shoot at once if already
     within range − 0.3″. Building targets use their hit radius.
  2. Otherwise, with a **target point** (`q.goal`, set by the player): walk toward it (all AP); once
     within **`RULES.goalReach` = 1.5″** it acts like Guard there.
  3. Otherwise (no target point): march on the enemy HQ if known, else on the nearest possible HQ spot
     the side can't see right now (§13), else into the enemy half (stopping 3.2″ short); if there is no
     path, Guard.
  - **Target points:** `orders.goals[id] = { x, z }` (clamped to the board) sets it and puts the squad
    on Advance; `null` clears it. It stays on the squad across rounds until changed or cleared.
- **Guard:**
  - Shooters: if an enemy is within attack range → shoot at it until AP runs out; otherwise set
    **overwatch** facing the nearest visible enemy (40 AP) and defend with the rest.
  - Melee: if a visible enemy is within **8″** (`GUARD_RANGE`) → walk to striking distance and swing
    at it (it aims at where the enemy stands now); prepare a **parry** first if it is a fighter and
    already in contact (gap ≤ 0.35″).
- **Hold:** stand still; all AP into defends (max 4).
- **Auto skills** (per squad, **on by default**; `q.auto`, set with `orders.auto[id] = true|false`, the
  "Auto skills" chip in the squad panel): stance squads (not on **Hold**) use their skills with the
  AI's rules (`autoSkills` in `js/sim/skills.js`, the same function the AI uses, §14.2) against the
  target the stance picked (Advance: its target; Guard: the enemy it fights or shoots) before their basic
  attacks: shield walls, rally, Leap Strike, Mighty Swing, the Necromancer's spells, Arrow Storm,
  Piercing Bolt, charges.
- **Retreat:** fall back to the **nearest own Mine / Soul Well** (any state), else the own HQ: walk
  there with all AP (stopping beside it); once its edge is within **`RULES.retreatReach` = 3″** of
  that building it acts like Guard. (Stepping away from an engaged enemy still costs the disengage AP
  and gives the parting blow, §5.8.)
- **Builders** (whatever their stance except Hold): keep at their remembered build / repair task;
  else take an own unfinished site at any distance (fewest builders on it first, then nearest;
  gatherers leave for it); else **gather** (remembered gather building, else the nearest own gather
  building with a free slot) (§11.4). Hold = stand still.

Melee approach (`meleePlan`): the squad stops at centre distance = own radius + target radius +
0.55 × reach; if it cannot also swing this round it walks with all its AP.

---

## 5. Combat (`js/sim/resolve.js`)

### 5.1 Damage formula and hit order
For a hit with raw damage `D` on a squad with armour `A`:

```
damage = max(1, round( D × cover × wall × 20 / (20 + A) × (defended ? 0.5 : 1) ))
  cover  = 0.5 if the hit is a volley / pierce / tower shot and the target is in or behind a forest, else 1
  wall   = 0.3 if the target braced Lock Shields / Grave Wall and the attacker is in its front 120°, else 1
  defended: the target spends one of its defends (if it has any left) on this hit
```
(`RULES.armorK` = 20, `RULES.defendMult` = 0.5, `RULES.coverMult` = 0.5.)

- **Raw damage of an attack = damage per model × models alive at release × damage multiplier**
  (multiplier 1, or 1.25 after a Rally).
- **Models:** a squad's models = `ceil(hp / hpPer)`. Damage removes models from the back; a wounded
  squad hits for less.
- **Buildings:** `damage = max(1, round(D × 2.5 × 20 / (20 + building armour)))` (siege ×2.5);
  no defends, no cover, no parry.
- **Hits in the same AP are applied together.** Hits are grouped by target; each target takes its hits
  **strongest first**, so the strongest hit is the one that uses up a defend or a parry.
- **Defends** per round = the unit's base `defends` + bought defends (+1 from Rally). Each hit
  (any source, including tower fire) uses one while any remain.

### 5.2 Swing (melee)
Aimed at a point when the action starts (the squad turns to face it). At the end of the action's AP
(the **release**) it hits **every enemy squad and building** whose footprint touches the arc:
radius = squad radius + `reach`, half-angle 60° (cos 0.5) around the facing. The arc is drawn on the
table during the wind-up, so a faster enemy can walk out of it before it lands.

### 5.3 Volley (crossbows, bone archers)
At release: a straight line from the squad toward the aim, length = `range`, width = `width`. It hits
the **first** target (enemy squad or building) the line meets, unless **ruins, rocks or a building**
cut the line first (lakes do not). If the first thing on the line is the shooter's own building,
nothing is hit. **Cover:** ×0.5 if the target stands in a forest or the line crosses one.

### 5.4 Circles: lob, Bone Blast, Arrow Storm
Aimed at a point, clamped to the skill's `range`. At release, every enemy squad / building whose
centre is within `radius + 0.6 × target radius` of the point is hit. Ignores walls (arcs over).

### 5.5 Piercing Bolt
A line like a volley (`range`, `width`) that hits **every** target along it until a ruin / rock /
building cuts it. Cover applies per target.

### 5.6 Charge (Outriders, Wraiths)
Wind-up `wind` = 8 AP (lance lowered, lane telegraphed), then the squad **rushes** along the lane at
**4.6 × its walking speed** (× terrain), up to `len` inches. The first enemy squad (or building) it
meets takes `dmg` per model × models; the charger stops in contact (engaged). Walls / rocks /
the board edge stop the rush. Friendly squads are passed through (and stepped aside from at the end).
The action always costs its full AP.

### 5.7 Hero skills and specials
**The Chosen (Kingdom hero; cooldown skills):**
- **Leap Strike** (`leap`, 20 AP, cd 2): flies for 6 AP to the aim (clamped to range 7″), over
  everything; lands on the nearest free spot back along the line. On landing, every enemy squad /
  building within hero radius + **1.6″** (+ its radius) is hit for **12** (× models 1 × the hero's damage
  multiplier, kind `leap`, batched with the AP's other hits), and every adjacent enemy (edge gap < 0.3″)
  is **shoved 1″** away (if the spot is free).
- **Rally** (`rally`, 20 AP, cd 2): at release, every friendly squad within 5″ (+ its radius) gets
  **+1 defend** and **+4 armour** for the rest of the round (the armour is added in `hitOne` before
  `damageAfter`; several rallies don't stack, the highest applies). No damage bonus (`dmgMult` 1).
- **Mighty Swing** (`mighty`, 30 AP, cd 2): a swing arc with reach **2.6″** past the hero's edge and a
  wide half-angle (cos ≥ **0.2**, ±78°), **28** damage, and every squad it hits is **stunned for 25 AP**
  (see Stun below; a parried hit doesn't stun).

**The Lich (Undead hero; a mage, see Mana below; was called the Necromancer):** tier **3** (slow,
3.6″ per round), 90 HP, armour 5, 1 defend. A Lich or a Necromancer squad must stand within 6″ of a
Monolith's spot to raise it (§11.2). Basic attack: a **magic bolt** (a volley line: 25 AP, 10 damage, range 10″,
width 0.6″; walls block it, forests give cover).
- **Summon Warband** (`summon`, 20 AP, **40 mana**): aim within 4″. **When the cast releases**, **2
  squads of Summoned Skeletons** rise around the aim point (0.9″ either side, nudged clear with
  `freeSpot`). From that AP on they **block movement and can be hit**, but they are **not in this round's
  action list**, so they don't act until next round (`spawn` event with `mid: true`; the replay shows
  them from that moment). They have stance **Advance**, cost CP if ordered (the AI never orders them),
  **don't count toward the army cap**, give no souls when they die, and **crumble at the end of their
  3rd full round** (`ttl` = `RULES.summonTtl` + 1 at the cast, minus 1 at every end of round, removed at
  0; the summoning round doesn't count).
- **Dark Thunder** (`thunder`, 15 AP, **25 mana**): aim within 11″. At release it strikes the enemy
  squad nearest the aim point whose edge is within 1″ of it **and** that the caster has a clear line to
  (`losCut` = 1), for **14**; then it jumps up to **3** times to the nearest enemy squad not yet struck
  whose edge is within **3.5″** of the previous target's edge, each jump **×0.7** (14 → 9.8 → 6.9 → 4.8
  raw). All strikes are batched in the same AP. No target: nothing happens.
- **Corpse Explosion** (`explode`, 10 AP, **20 mana**): aim within 9″ at one of the caster side's
  **summoned** squads (the nearest whose edge is within 1.5″ of the aim). At release it bursts: it is
  removed (no souls), and every enemy squad / building within **2.5″** (+ 0.6 × its radius) of it takes
  **8 + 6 × its models left** (× the caster's damage multiplier). No summoned squad there: the spell
  fizzles (`fizzle` event; the mana is spent).

**Necromancers (Undead troop, role `mage`, high tier):** 2 models × 10 HP, armour 1, tier 4, vision
10, 1 defend, trained at the Ossuary (22 souls, 2 rounds). Same mage rules as the Lich (no cooldowns,
repeat casts while AP and mana last), with its own mana: **60 max, 40 at the start, +15 a round**.
- **Bolt** (basic attack): a volley line, 25 AP, 4 per model (8 for the full squad), range 9″.
- **Dark Thunder (weaker)** (`thunder`, 15 AP, **20 mana**): the same rules as the Lich's, aim within
  6″, **6 per model** (12 at full strength) on the first strike, up to **2** jumps within **3″**, ×0.7
  per jump.
- **Summon Warband** (`summon`, 20 AP, **35 mana**, aim within 4″): **1** squad of Summoned Skeletons
  (the count comes from the skill's `count`), same rules as the Lich's summon.
- With auto skills on (stances, and the AI), it uses the same `autoSkills` rules as the Lich.

### 5.7b Hero revive (`resolve.js`, end of round)
- The fallen hero's **body lies in the ring** (UI: its mini on its back at the zone's centre) until it
  returns, so the revive point is easy to find.
- When a hero dies, `s.revive[p] = { x, z, progress 0 }` is placed where it fell (radius
  **`RULES.reviveRadius` = 3″**; a `reviveZone` event).
- From the next end of round on: if any **own** living squad (not a builder, not summoned) has its edge
  inside the zone, progress **+1** (**enemies inside don't stop it**; a `reviveTick` event).
- At **`RULES.reviveRounds` = 3** the hero returns on the spot (`freeSpot`), with **50 %** of its HP
  (`RULES.reviveHp`), its starting mana and no cooldowns; the zone is removed. A hero that dies again
  leaves a new zone. The AI sends its 2 nearest squads not in a fight to hold the zone.

**Mana (mages: any unit with `mana`: the Lich and Necromancers; numbers per unit in §7):** `mana { max 100, start 60, regen
25 }`. A mage's skills have **no cooldown** and **may be cast several times in one round** (the
once-per-round rule doesn't apply); each cast pays its mana **when the cast starts**; a cast without
enough mana at that moment fizzles. Order validation (`sanitizePlan`) drops casts beyond the mana the
mage has at the start of the round (running total, in order). Mana regenerates **+25 at the end of every
round** (capped at the max).

**Stun:** a stunned squad's current action doesn't advance and it doesn't move (1 AP of stun is
used per AP step of its tier while it has actions; `stunned` / `unstun` events). Stun is applied when
the hit lands (`max` of the old and new stun). Stun left at the end of a round **carries into the
next round once** (used up at the start of the squad's actions there); stun that was carried and is
still left at the end of that next round is dropped. A squad with no actions doesn't use up stun.

**Other specials:**
- **Shadow Step, Sweep, Bone Blast, Raise:** still supported by the rules but no unit has them now.
- **Lock Shields / Grave Wall** (tanks): if in the plan, braced **from the start of the round** for the
  whole round: hits from the front 120° (cos ≥ 0.5 from the facing) deal ×0.3. Costs 15 AP.
- **Arrow Storm** (Bone Archers): a big circle, arcs over walls.
- **Wraiths** (`ghost`): pass through all squads when walking or charging, and **are never engaged**.

**Cooldowns (non-mages):** using a skill sets its cooldown to `cd + 1` at the start of the action; cooldowns tick
down by 1 at the end of every round, so a skill with `cd` 2 can be used again 2 rounds later.

### 5.8 Engagement, disengage, parting blows, parry
- A squad is **engaged** with every enemy **melee** squad (swing attack) whose edge is within
  `RULES.engageGap` = 0.35″ (Wraiths are never engaged).
- **Disengaging:** when a move's first waypoint leads away from an engaged enemy, the squad first
  stands still for **30 AP** (`disengageAP`) and each such enemy gets one **parting blow** =
  ×0.5 of its full attack (per model × models × its multiplier). Once per enemy per round.
- **Parry** (fighters, 15 AP prepaid): the next **melee hit** (swing, charge or parting blow) on the
  squad deals nothing, and the squad **ripostes** for ×0.5 of its own full attack.

### 5.9 Overwatch (shooters, 40 AP prepaid)
The squad faces the chosen point. During **any tier**, after each AP of movement, if an enemy squad that
just moved is inside its front cone (±60°) within attack range (edge), it fires **once** at the nearest
such enemy (a normal volley toward it, needing a clear line; a lobbing unit lobs instead).

---

## 6. Movement and collisions (`js/sim/nav.js`, `resolveMoves` in `resolve.js`)

- **Paths:** A* on a 0.5″ grid per squad radius (obstacles inflated by the radius; slow terrain costs
  more), then smoothed. Paths are computed when orders are given (planner / AI / stances).
- **Each AP:** a walking squad advances along its path by its speed × terrain factor.
  - **Enemy squads block.** Walking into contact with an enemy (within engage distance) **stops** the
    move ("arrived": the fight starts there).
  - **Friendly squads do not block** (you can walk through your own lines); squads that have stopped
    and overlap drift apart by up to 0.06″ per AP (never into enemies or terrain).
  - **Wraiths** pass through everything except terrain and buildings.
  - When blocked by terrain or an enemy, the squad sidesteps (0.5, 0.9, 1.3 rad) toward its preferred
    side (switches side after being stuck 4 steps); after 3 stuck steps it **re-paths** (at most every
    6 AP). A squad that ends up inside an obstacle can always step out.
  - Near the final waypoint (within 3 radii) a blocked squad counts as arrived.
- **Squad footprint radius:** 1 model = 0.65″; otherwise 0.5″ (0.62″ for riders / wraiths) +
  0.42″ × √models (shrinks as models die).
- **Deployment and spawns** are nudged to a free spot (no squad starts inside terrain).

---

## 7. Units *(generated)*

<!-- GEN:units -->
**Kingdom** (`FACTIONS.kingdom.units`)

| Role | Name | Models | HP/model | HP | Armour | Tier | Move "/rnd | Vision | Defends | Radius | Attack | AP | Dmg/model | Full squad/hit | Reach / range | Hits per 100 AP | Flags | Train cost | Train rnds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero | The Chosen | 1 | 130 | 130 | 9 | 5 | 6 | 12 | 2 | 0.65 | swing | 25 | 18 | 18 | reach 1.6" (arc +-60 deg) | 4 | - | - | - |
| tank | Shieldwall | 3 | 34 | 102 | 12 | 4 | 4.8 | 9 | 2 | 1.227 | swing | 30 | 4 | 12 | reach 1.3" (arc +-60 deg) | 3 | - | 30 | 3 |
| fighter | Men-at-arms | 4 | 20 | 80 | 7 | 5 | 6 | 9 | 1 | 1.34 | swing | 25 | 5 | 20 | reach 1.5" (arc +-60 deg) | 4 | parry | 24 | 2 |
| ranged | Crossbows | 4 | 15 | 60 | 3 | 5 | 6 | 11 | 1 | 1.34 | volley | 30 | 4 | 16 | range 14", width 0.7" | 3 | - | 26 | 2 |
| fast | Outriders | 3 | 24 | 72 | 5 | 6 | 7.2 | 11 | 1 | 1.347 | swing | 45 | 13 | 39 | reach 1.7" (arc +-60 deg) | 2 | - | 30 | 2 |
| builder | Peasants | 2 | 14 | 28 | 2 | 5 | 6 | 8 | 0 | 1.094 | swing | 25 | 2 | 4 | reach 1.2" (arc +-60 deg) | 4 | - | 10 | 1 |

**Undead Legion** (`FACTIONS.undead.units`)

| Role | Name | Models | HP/model | HP | Armour | Tier | Move "/rnd | Vision | Defends | Radius | Attack | AP | Dmg/model | Full squad/hit | Reach / range | Hits per 100 AP | Flags | Train cost | Train rnds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero | Lich | 1 | 90 | 90 | 5 | 3 | 3.6 | 12 | 1 | 0.65 | volley | 25 | 10 | 10 | range 10", width 0.6" | 4 | mage: mana 60/100, +25/rnd | - | - |
| tank | Grave Guard | 3 | 21 | 63 | 9 | 4 | 4.8 | 9 | 2 | 1.227 | swing | 30 | 3.2 | 9.600000000000001 | reach 1.3" (arc +-60 deg) | 3 | - | 16 | 3 |
| fighter | Skeleton Warriors | 5 | 9 | 45 | 3 | 5 | 6 | 9 | 1 | 1.439 | swing | 25 | 2.4 | 12 | reach 1.5" (arc +-60 deg) | 4 | parry | 9 | 2 |
| swarm | Skeleton Warband | 6 | 4 | 24 | 0 | 6 | 7.2 | 9 | 0 | 1.5290000000000001 | swing | 25 | 2.4 | 14.399999999999999 | reach 1.4" (arc +-60 deg) | 4 | - | 14 | 1 |
| ranged | Bone Archers | 4 | 10 | 40 | 1 | 5 | 6 | 11 | 1 | 1.34 | volley | 30 | 2.4 | 9.6 | range 14", width 0.9" | 3 | - | 13 | 2 |
| fast | Wraiths | 3 | 14 | 42 | 3 | 6 | 7.2 | 11 | 1 | 1.347 | swing | 45 | 9 | 27 | reach 1.7" (arc +-60 deg) | 2 | ghost | 16 | 2 |
| mage | Necromancers | 2 | 10 | 20 | 1 | 4 | 4.8 | 10 | 1 | 1.094 | volley | 25 | 4 | 8 | range 9", width 0.5" | 4 | mage: mana 40/60, +15/rnd | 22 | 2 |
| summon | Summoned Skeletons | 3 | 11 | 33 | 3 | 5 | 6 | 7 | 0 | 1.227 | swing | 25 | 3 | 9 | reach 1.5" (arc +-60 deg) | 4 | summoned (lasts 3 rnds, not trainable) | - | - |

<!-- /GEN:units -->

Notes: "Move ″/rnd" is the open-ground walk per 100 AP. "Full squad/hit" is the raw damage of one
attack at full models. "Hits per 100 AP" assumes standing in reach the whole round. Swing reach is
measured from the squad's edge. Heroes cannot be trained.

---

## 8. Skills *(generated)*

<!-- GEN:skills -->
| Faction | Unit | Skill | Kind | Category | AP | Cooldown (rounds) | Mana | Dmg (per model x models) | Parameters |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kingdom | The Chosen | Leap Strike | `leap` | move | 20 | 2 | - | 12 x 1 = 12 | range 7, flight 6, shove 1, dmg 12, radius 1.6 |
| Kingdom | The Chosen | Rally | `rally` | defense | 20 | 2 | - | - | radius 5, defends 1, dmgMult 1, armor 4 |
| Kingdom | The Chosen | Mighty Swing | `mighty` | attack | 30 | 2 | - | 28 x 1 = 28 | dmg 28, reach 2.6, cosHalf 0.2, stun 25 |
| Kingdom | Shieldwall | Lock Shields | `wall` | defense | 15 | 1 | - | - | mult 0.3, cosHalf 0.5 |
| Kingdom | Crossbows | Piercing Bolt | `pierce` | attack | 35 | 2 | - | 5 x 4 = 20 | dmg 5, range 16, width 0.7 |
| Kingdom | Outriders | Charge | `charge` | move | 35 | 1 | - | 9 x 3 = 27 | wind 8, dmg 9, len 9 |
| Undead Legion | Lich | Summon Warband | `summon` | defense | 20 | - (mage) | 40 | - | range 4, count 2, radius 1.6 |
| Undead Legion | Lich | Dark Thunder | `thunder` | attack | 15 | - (mage) | 25 | 14 x 1 = 14 | dmg 14, range 11, jumps 3, jump 3.5, decay 0.7, radius 1 |
| Undead Legion | Lich | Corpse Explosion | `explode` | attack | 10 | - (mage) | 20 | - | range 9, radius 2.5, base 8, perModel 6 |
| Undead Legion | Grave Guard | Grave Wall | `wall` | defense | 15 | 1 | - | - | mult 0.3, cosHalf 0.5 |
| Undead Legion | Bone Archers | Arrow Storm | `storm` | attack | 35 | 2 | - | 4 x 4 = 16 | dmg 4, range 15, radius 2.2 |
| Undead Legion | Wraiths | Charge | `charge` | move | 35 | 1 | - | 5.6 x 3 = 16.799999999999997 | wind 8, dmg 5.6, len 9 |
| Undead Legion | Necromancers | Dark Thunder | `thunder` | attack | 15 | - (mage) | 20 | 6 x 2 = 12 | dmg 6, range 10, jumps 2, jump 3, decay 0.7, radius 1 |
| Undead Legion | Necromancers | Summon Warband | `summon` | defense | 20 | - (mage) | 35 | - | range 4, count 1, radius 1.6 |
<!-- /GEN:skills -->

Lock Shields / Grave Wall: `mult` 0.3 = damage taken from the front arc, `cosHalf` 0.5 = ±60°.
Charge `wind` = wind-up AP before the rush, `len` = max rush distance. Leap `flight` = AP in the air,
`shove` = inches enemies are pushed. Rally `defends` = extra defends given, `dmgMult` = damage multiplier.

---

## 9. Derived combat numbers *(generated)*

<!-- GEN:derived -->
Damage per round = hits per 100 AP x damageAfter(dmg per model x models, armour), full squad, no defends, no cover, standing in reach. Real fights lose AP to walking.

**Kingdom: damage per 100 AP against armour**

| Unit | Raw/hit | vs 0 | vs 3 | vs 5 | vs 8 | vs 11 | vs 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The Chosen | 18 | 72 | 64 | 56 | 52 | 48 | 44 |
| Shieldwall | 12 | 36 | 30 | 30 | 27 | 24 | 24 |
| Men-at-arms | 20 | 80 | 68 | 64 | 56 | 52 | 52 |
| Crossbows | 16 | 48 | 42 | 39 | 33 | 30 | 30 |
| Outriders | 39 | 78 | 68 | 62 | 56 | 50 | 48 |
| Peasants | 4 | 16 | 12 | 12 | 12 | 12 | 12 |

**Undead Legion: damage per 100 AP against armour**

| Unit | Raw/hit | vs 0 | vs 3 | vs 5 | vs 8 | vs 11 | vs 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lich | 10 | 40 | 36 | 32 | 28 | 24 | 24 |
| Grave Guard | 9.600000000000001 | 30 | 24 | 24 | 21 | 18 | 18 |
| Skeleton Warriors | 12 | 48 | 40 | 40 | 36 | 32 | 32 |
| Skeleton Warband | 14.399999999999999 | 56 | 52 | 48 | 40 | 36 | 36 |
| Bone Archers | 9.6 | 30 | 24 | 24 | 21 | 18 | 18 |
| Wraiths | 27 | 54 | 46 | 44 | 38 | 34 | 34 |
| Necromancers | 8 | 32 | 28 | 24 | 24 | 20 | 20 |
| Summoned Skeletons | 9 | 36 | 32 | 28 | 24 | 24 | 24 |

**Attacks needed: Kingdom (rows, full squad, no losses) vs Undead Legion (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | Lich | Grave Guard | Skeleton Warriors | Skeleton Warband | Bone Archers | Wraiths | Necromancers | Summoned Skeletons |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The Chosen | 7 (1.8 r) | 6 (1.5 r) | 3 (0.8 r) | 2 (0.5 r) | 3 (0.8 r) | 3 (0.8 r) | 2 (0.5 r) | 3 (0.8 r) |
| Shieldwall | 9 (3 r) | 8 (2.7 r) | 5 (1.7 r) | 2 (0.7 r) | 4 (1.3 r) | 5 (1.7 r) | 2 (0.7 r) | 4 (1.3 r) |
| Men-at-arms | 6 (1.5 r) | 5 (1.3 r) | 3 (0.8 r) | 2 (0.5 r) | 3 (0.8 r) | 3 (0.8 r) | 2 (0.5 r) | 2 (0.5 r) |
| Crossbows | 7 (2.3 r) | 6 (2 r) | 4 (1.3 r) | 2 (0.7 r) | 3 (1 r) | 3 (1 r) | 2 (0.7 r) | 3 (1 r) |
| Outriders | 3 (1.5 r) | 3 (1.5 r) | 2 (1 r) | 1 (0.5 r) | 2 (1 r) | 2 (1 r) | 1 (0.5 r) | 1 (0.5 r) |
| Peasants | 30 (7.5 r) | 21 (5.3 r) | 15 (3.8 r) | 6 (1.5 r) | 10 (2.5 r) | 14 (3.5 r) | 5 (1.3 r) | 11 (2.8 r) |

**Attacks needed: Undead Legion (rows, full squad, no losses) vs Kingdom (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | The Chosen | Shieldwall | Men-at-arms | Crossbows | Outriders | Peasants |
| --- | --- | --- | --- | --- | --- | --- |
| Lich | 19 (4.8 r) | 17 (4.3 r) | 12 (3 r) | 7 (1.8 r) | 9 (2.3 r) | 4 (1 r) |
| Grave Guard | 19 (6.3 r) | 17 (5.7 r) | 12 (4 r) | 8 (2.7 r) | 9 (3 r) | 4 (1.3 r) |
| Skeleton Warriors | 17 (4.3 r) | 13 (3.3 r) | 9 (2.3 r) | 6 (1.5 r) | 8 (2 r) | 3 (0.8 r) |
| Skeleton Warband | 13 (3.3 r) | 12 (3 r) | 8 (2 r) | 5 (1.3 r) | 6 (1.5 r) | 3 (0.8 r) |
| Bone Archers | 19 (6.3 r) | 17 (5.7 r) | 12 (4 r) | 8 (2.7 r) | 9 (3 r) | 4 (1.3 r) |
| Wraiths | 7 (3.5 r) | 6 (3 r) | 4 (2 r) | 3 (1.5 r) | 4 (2 r) | 2 (1 r) |
| Necromancers | 22 (5.5 r) | 21 (5.3 r) | 14 (3.5 r) | 9 (2.3 r) | 12 (3 r) | 4 (1 r) |
| Summoned Skeletons | 22 (5.5 r) | 17 (4.3 r) | 12 (3 r) | 8 (2 r) | 11 (2.8 r) | 4 (1 r) |

<!-- /GEN:derived -->

---

## 10. Economy

### 10.1 Resources, income, training *(generated)*

<!-- GEN:economy -->
| Faction | Resource | Start | HQ income/rnd | Gather (AP per 1 resource) | Builder gathering a full round | Buildable |
| --- | --- | --- | --- | --- | --- | --- |
| Kingdom | Gold | 60 | 6 | farm 8 (4 gatherers), mine 10 (2 gatherers) | farm ~12, mine ~10 | barracks, tower, farm, mine, banner, wall |
| Undead Legion | Souls | 90 | 1 | - (no builders) | - | barracks, tower, well, monolith, wall |

Builders: Kingdom up to 10 peasant squads (not in the army cap); Undead 0 (buildings rise by themselves). HQ trains: Kingdom builder/fighter; Undead Legion swarm.

**Training cost (resource) and time (rounds)**

| Role | Kingdom cost | Undead Legion cost | Rounds | Trained at |
| --- | --- | --- | --- | --- |
| builder | 10 | - | 1 | Keep (Kingdom only) |
| tank | 30 | 16 | 3 | Barracks / Ossuary |
| fighter | 24 | 9 | 2 | Barracks / Ossuary |
| swarm | - | 14 | 1 | Crypt and Ossuary (Undead only; a pair per training) |
| ranged | 26 | 13 | 2 | Barracks / Ossuary |
| fast | 30 | 16 | 2 | Barracks / Ossuary |
| mage | - | 22 | 2 | Ossuary (Undead only) |

Souls: every model that dies (either side, not summoned skeletons) on the undead side's grave ground pays 3 souls (a hero: 15); graveyards: hq 10", barracks 6", tower 6", monolith 6", wall 6", well 10" (a new site spreads 50 % at once and the rest by the end of the round; the Crypt starts at 10"). Pairs: Skeleton Warband x2.

**Undead death economy: souls back when a whole squad dies on your graves vs its cost** (both sides' deaths pay; the table uses undead squads)

| Role | Name | Tier rule | Models | Cost (per squad) | Souls back (per squad) | Back / cost |
| --- | --- | --- | --- | --- | --- | --- |
| tank | Grave Guard | high (cost may change) | 3 | 16 | 9 | 0.6x |
| fighter | Skeleton Warriors | low (cost fixed) | 5 | 9 | 15 | 1.7x |
| swarm | Skeleton Warband | low (cost fixed) | 6 | 7 | 18 | 2.6x |
| ranged | Bone Archers | low (cost fixed) | 4 | 13 | 12 | 0.9x |
| fast | Wraiths | high (cost may change) | 3 | 16 | 9 | 0.6x |
| mage | Necromancers | high (cost may change) | 2 | 22 | 6 | 0.3x |

Flat income: Crypt 1 a round, Soul Well 2 a round each. Kingdom deaths on undead graves pay the same per model (Kingdom Shieldwall 9, Men-at-arms 12, Crossbows 12, Outriders 9).
<!-- /GEN:economy -->

### 10.2 Rules
- **Income** is paid at the end of every round: HQ income + income of every **finished** Farm / Mine /
  Soul Well; then × the side's `incomeMult` (1, or the AI difficulty multiplier vs AI: Easy 0.8, Hard
  1.25), rounded.
- **Kingdom (Gold): a farm economy that grows late.** Keep 6, Mine +6 (on a resource site), Farm +2
  passive. Farms are **big** (4.2 × 3.4″, so they cost build-zone land; no farm limit) and take up to
  **4 farmers** each (`BUILDINGS.farm.slots`); a peasant farming a full round makes ~12 gold (1 gold per
  **8 AP**); mines take 2 (1 per 10 AP). Peasants cost 10, up to **10 squads**
  (`FACTIONS.kingdom.maxBuilders`), and **don't count toward the army cap**.
- **Undead (Souls): a death economy** (§10.4). The flat income is tiny on purpose, just enough that
  the Undead never stop completely: the **Crypt +1** a round (`FACTIONS.undead.eco.hq`) and each
  **Soul Well +2** (`BUILDINGS.well.income`). **The main income is death on graves:** every model that
  dies on either side (summoned skeletons excepted) **on the undead side's grave ground** pays
  **`RULES.soulPerModel` = 3** souls (a hero **`soulPerHero`** = 15), credited at the end of the round
  from where it fell. Because the pay is per **model**, cheap many-model squads give back **more than
  they cost** when they fall on graves (a Skeleton Warband squad: 6 models → 18 souls for 7 souls of
  cost, 2.6×; Skeleton Warriors 1.7×) and elite few-model squads give back less (Grave Guard / Wraiths
  0.6×, Necromancers 0.3×; the generated table above). So the Undead plan is: spread graves toward the
  enemy (Monoliths, Bone Fences), fight on them, and spend cheap skeletons. Start: 90 souls (the
  Kingdom: 60 gold). No gathering (no builders). Mirror Undead matches: each side collects from deaths
  on its own graves.
- **The tier rule for balancing the Undead** (owner's rule): **low-tier** units (Skeleton Warband,
  Skeleton Warriors, Bone Archers; `FACTIONS.undead.lowTier`) keep their **costs**; only their stats
  change. **High-tier** units (Grave Guard, Wraiths, Necromancers, the Lich's spells) may have their
  costs (souls, mana) changed.

### 10.4 Graveyards (`graveCircles` / `graveAt` in `js/sim/base.js`, end of round in `resolve.js`)
- **Graves spread almost at once** (blight / creep / a Necron power matrix): an undead site gets
  **`RULES.graveStart` = 50 %** of its graveyard the moment it is placed, and **every undead building
  (rising or finished) reaches its full graveyard at the end of every round**. Reach (`BUILDINGS.<type>.
  grave`): **Soul Well 10″**, **Crypt 10″** (full from the start, `graveHqStart`), every other undead
  building **6″** (the Monolith too).
- **Every undead building except the Monolith must stand on its own graves** (its centre inside a
  graveyard), and so must Soul Wells (which also need a free resource site). The Undead expand by
  chaining graves outward: a **Monolith** raised near the Lich or Necromancers anywhere they have seen
  (§11.2) starts a new graveyard ahead of the army; a cheap Bone Fence (6 souls, 6″ graves) on the edge
  of the graves reaches further.
- **On the table** the grave ground is a change of the ground texture itself (dark purple-black blight
  with faint violet veins, edges fading over about 1.6″ with noise; `js/render/ground.js`), with
  headstones, crosses, bone piles and dead stumps scattered on it, thick in the middle and thinning
  toward the rim (`js/render/graves.js`). Visual only.
- **Deaths widen graves:** each model (either side, not summoned) that dies on a graveyard pays souls
  and widens **that** graveyard by **`graveDeathGrow` = 0.15″** per model. A building's graveyard can
  be widened up to **1.5 ×** its type's max (`graveCapMult`; the raised cap is kept on the building).
- A destroyed undead building **leaves its graveyard behind** as a patch (`s.graves[p]`, its radius
  at that moment); deaths on a patch pay and widen it up to max(its size, 3″) (`gravePatchCap`). Patches
  never disappear.
- If several graveyards overlap, a death counts once (on the first graveyard found: buildings first,
  then patches).
- Grave ground is drawn as dark soil with tombstones, crosses and bones (`js/render/graves.js`); the
  fog covers it like the rest of the table.
- **Resource sites:** fixed points per map (§13); a site holds one Mine / Soul Well; the site belongs to
  the owner of a finished one (destroying it frees the site).
- **Gathering:** a builder working at a gather building turns each AP spent in reach into progress;
  at the end of its work action it gets `floor(progress / rate)` resource; the remainder carries over to
  the next round while it stays at the same building. At most **2 builders per building** (Farms
  **4**); the next one is turned away and goes elsewhere next round.
- **Training:** paid when it **starts** (round start, from the building's queue, §10.3); the squad
  appears next to the building at the end of its last training round (builder 1, fighter / ranged /
  fast 2, tank 3), on the first free spot (toward the enemy first). Squads in training count toward the
  army cap; queued squads do not. Stopping a squad in training refunds its full cost.
- **Army cap:** `RULES.armyCap` = **30** squads + the map's bonus (Twin Rivers / Highland +4, Great Field
  +8). **Builders and summoned skeletons don't count** (`inArmy` in `js/sim/base.js`); squads in training
  do (builders in training don't).

### 10.3 Production queues (`startQueues` in `js/sim/base.js`)
Two kinds of persistent queue, stored in the state and kept across rounds with no new orders:
- **One base build queue per side** (`s.bq[p]`, up to 5 buildings, each a type + spot). Shared by all
  the side's builders.
- **One training queue per training building** (`b.queue`, up to 5 roles; HQ and Barracks / Ossuary).
  Lost (free) if the building is destroyed.

**Pay when it starts.** At round start (after this round's queue edits), with a running resource total:
1. **Build queue, front to back.** For each item:
   - If its spot is now **permanently invalid** (terrain, a building, the site taken, a farm / banner
     limit; `placeError` ignoring squads) it is **dropped** (`queueDrop` event, nothing paid) and the
     next item is considered.
   - Else it **waits** (and every item behind it waits too, strict order) if: the side already has as
     many unfinished sites as it has living builders (`builders`), or it can't pay (`gold` / `souls`,
     with the shortfall), or a squad stands on the spot (`blocked`).
   - Else it **starts**: the cost is paid, the site is placed (30 % HP, §11.3), a `construct` event
     with its `qid`, and the next item is considered.
2. **Training buildings, by building id.** A building with no squad in training starts the first role of
   its queue if the army (squads + squads in training) is below the cap, the builder cap allows it (for
   builders) and the side can pay; otherwise the queue waits (nothing behind it jumps ahead). At most one
   squad starts per building per round, and a building that finishes a squad at the end of round N
   starts the next one at the start of round N + 1 (no gap).
   **Repeat (locked production, `b.repeat`):** a locked building whose queue is **empty** treats its
   locked role as the next item: it starts it under the same rules (cap, builder cap, cost; it waits
   when it can't) without it ever leaving the queue, so the building keeps training that role every
   time it is free, with no new orders. Queued items always go first.
3. The build queue is served before training, so a waiting building does not stop training (only its
   cost is reserved once it can start).

The UI runs the same function without applying it (a forecast) to show "starts this round" or why an
item waits.
---

## 11. Buildings and builders

### 11.1 Building data *(generated)*

<!-- GEN:buildings -->
| Type | Names (Kingdom / Undead) | Cost | Work (builder AP) | Builder-rounds | Undead rise rounds | HP | Site HP | Armour | Footprint | Vision | Fire (after the tiers) | Income/rnd | Special | Built by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hq` | Keep / Crypt | 0 | 0 | 0 | - | 220 | 66 | 8 | 4 x 4 | 10 | 3 x 4 = 12 raw, range 8" | - | trains kingdom: builder/fighter, undead: swarm | kingdom, undead |
| `barracks` | Barracks / Ossuary | 30 | 240 | 2.4 | 3 | 150 | 45 | 8 | 3.5 x 2.5 | 6 | - | - | trains tank/fighter/swarm/ranged/fast/mage | kingdom, undead |
| `tower` | Watchtower / Bone Spire | 25 | 200 | 2 | 3 | 110 | 33 | 6 | circle r 0.9 | 13 | 4 x 4 = 16 raw, range 11" | - | - | kingdom, undead |
| `banner` | Banner / Obelisk | 20 | 120 | 1.2 | - | 60 | 18 | 4 | circle r 0.55 | 6 | - | - | +1 CP | kingdom |
| `monolith` | Monolith / Monolith | 20 | 120 | 1.2 | 2 | 70 | 21 | 4 | circle r 0.6 | 7 | - | - | - | undead |
| `wall` | Palisade / Bone Fence | 6 | 60 | 0.6 | 1 | 80 | 24 | 6 | 3 x 0.5 | 0 | - | - | - | kingdom, undead |
| `farm` | Farm / Farm | 25 | 140 | 1.4 | - | 90 | 27 | 3 | 4.2 x 3.4 | 5 | - | 2 | 4 gatherers | kingdom |
| `mine` | Mine / Mine | 30 | 160 | 1.6 | - | 100 | 30 | 6 | circle r 1.1 | 7 | - | 6 | resource site only | kingdom |
| `well` | Soul Well / Soul Well | 20 | 160 | 1.6 | 2 | 90 | 27 | 5 | circle r 1.1 | 7 | - | 2 | resource site only; soul collector (undefined") | undead |

Repair (Kingdom builders): builder AP x (max HP / work) HP per AP. Undead buildings rise by 80 work a round (at most 2 at once) and mend 5 % of max HP a round. Siege damage taken: damageAfter(raw x 2.5, armour) (no defends).
<!-- /GEN:buildings -->

### 11.2 Placement (`placeError` in `js/sim/base.js`)
- On the board (footprint at least 0.3″ inside the edge).
- **Normal buildings: anywhere on ground the side has seen** (the old "own third only" rule is gone),
  but not within 1.8″ (0.6 × 3) of a resource site.
- **Seen ground:** every building (both armies, the HQ excepted) needs its centre on a cell the side has
  seen at least once (§12): "You haven't seen that spot yet".
- **Undead graves:** every undead building except the Monolith (`offGraves: true`) needs its centre on
  the side's grave ground (§10.4): "Undead buildings must stand on your graves".
- **Monolith (`caster: 6`):** its centre must be within **6″** of a living own **Lich or Necromancer
  squad** (centre to centre; `casterNear`): "Place it near your Lich or Necromancers". This is checked
  when it is queued; at round start a queued Monolith whose caster has walked away **waits**
  (`caster`) instead of being dropped.
- **Mine / Soul Well:** only on a **free resource site** (within 0.6″; the UI snaps to it), anywhere on
  the table.
- Not overlapping terrain (+0.2″; not in a stream), other buildings (+0.3″) or squads (+0.1″).
- Max 2 Banners (Kingdom only; no farm limit). The building must be in the side's faction list.

### 11.3 Construction (builders)
- A new site appears at round start with **30 %** of max HP (`siteHp`), blocks movement, can be
  attacked, and sees only 3″.
- **Work:** each AP a builder spends with its edge within **1.0″** of the footprint adds 1 work and
  `max HP × 0.7 / work` HP. When the work total is reached the building is finished **mid-round**
  (full vision, its income / CP / fire from then on).
- **Two builders** on one site work twice as fast. One builder puts in ~100 AP per round minus walking.
- **Repair:** builder work on a damaged finished building restores `max HP / work` HP per AP.
- **Builders' work order** is "go there and work": the builder paths around the real obstacles at
  resolution, slips between its own squads, re-paths when stuck, then works with the AP left.
  **Builders remember their task** across rounds (finish → then gather automatically).
- Builders cost no CP; Kingdom max 10 squads; trained at the Keep (1 round, 10 gold).

### 11.3b Undead buildings rise out of the ground (no builders)
- The Undead have no builder unit. A started item of their build queue becomes a site (30 % HP, as
  above) and at the **end of every round** gains **`RULES.riseWork` = 80 work** (HP grows the same way
  as builder work: `max HP × 0.7 × work / total work`), so it finishes after `ceil(work / 80)` rounds:
  wall 1, monolith 2, soul well 2, bone spire 3, ossuary 3. It counts as finished at the end of that
  round (`built` event, `by: null`).
- At most **`RULES.maxRising` = 2** undead sites rise at the same time (this replaces "one site per
  builder" in `startQueues`: the front item waits with reason `rising`).
- Finished undead buildings (not the Crypt) **mend 5 % of max HP** at the end of every round
  (`RULES.undeadMend`), since nobody can repair them.
- The UI sinks the site's model into the table and raises it with progress (no scaffold).

### 11.3c The Monolith (Undead; replaced the Obelisk on 2026-11-17)
- `BUILDINGS.monolith`: cost **20**, work 120 (rises in **2 rounds**), HP 70, armour 4, a circle of
  r 0.6″, vision 7, graveyard **6″** (`grave`), **no command point**.
- **Placement:** the only Undead building that may stand **off graves** (`offGraves`), but it still
  needs seen ground, and its centre must be within **6″** (`caster`) of a living own **Lich or
  Necromancer squad** (§11.2). Like any undead site it spreads half its graves when placed and all of
  them by the end of the round, so it is how the horde pushes blight into new ground.
- **Heal** (`heal: { radius 4, hp 4 }`), at the end of every round after the undead mend and before
  mana regen: every own living, non-summoned squad below full HP whose **edge** is within **4″** of a
  **finished** Monolith's centre regains **4 HP per model alive** (at least 4; models come back as HP
  passes each model's threshold, up to full) (`heal` event). Several Monoliths each heal.

### 11.4 What a builder does with no orders (`builderIdleTarget` in `js/sim/builders.js`)
Kingdom builders gather at Farms and Mines. A builder with no direct orders (and not on
Hold) picks, in order:
1. its remembered **build or repair** task, while that building still needs it;
2. else an own **unfinished site at any distance** (so it takes the next started item of the build
   queue): the site with the **fewest builders already on it**, then the nearest. Idle builders choose in
   squad id order and count each other's picks, so two idle builders spread over two new sites. A
   **gatherer is free**: it leaves its gather building for a new site;
3. else its remembered gather task, else the nearest own gather building with a free slot (farms 4,
   mines 2).

### 11.5 Barracks / training buildings
The Keep trains builders (peasants); the **Crypt trains the Skeleton Warband swarm** (`FACTIONS.<f>.hqTrains`);
Barracks / Ossuary train tank, fighter, ranged, fast (the Ossuary also the swarm).
**Pairs:** a unit with `pair: 2` (the Skeleton Warband) spawns **2 squads** from one training (each a
full squad, both counting toward the army cap; the queue waits unless 2 cap slots are free). One squad in training at a
time each, with up to 5 more queued (§10.3).

### 11.6 Tower and HQ fire (after all tiers)
Each finished Watchtower / Bone Spire / HQ picks the **nearest enemy squad** whose edge is within its
range and that it can see (same sight rules as §12, its own footprint excluded), and fires one shot:
raw damage = `fire.dmg × 4` (HQ 3 × 4 = 12, tower 4 × 4 = 16); forest cover and the target's defends
apply. One shot per building per round.

---

## 12. Fog of war and intel (`js/sim/vision.js`)

- A side sees an enemy squad if **any** of its squads (vision = unit vision) or buildings (vision =
  building vision; sites 3″) can see it:
  - within vision range (centre to centre);
  - the line is not cut by a ruin, rock or building;
  - the line does not pass through more than **2″ of forest**;
  - a target **inside a forest** is only seen from within **4″**.
- **Stance plans and the AI** only use enemies the side can see (at round start); the AI also
  remembers enemies seen in the last 3 rounds.
- **Intel:** a side remembers every enemy building it has seen (snapshot) and forgets it when it sees
  the spot again without it. The **enemy HQ is not known until scouted.** Each HQ starts at one of the
  map's 3 HQ spots (seeded).
- **Seen ground (sim, `s.explored[p]`):** a 1″ grid per side, one char per cell, marked at every intel
  update (round start and end) for each cell an observer can see (`markSeen`, same rule as above). At the
  start each side has seen its own third of the table (`initSeen`). **Buildings may only be placed on
  ground the side has seen at least once** (§11.2).
- The display fog (UI only): unexplored ground is covered in mist, explored-but-unseen ground is hazed;
  the replay only shows enemies your side saw.

---

## 13. Maps *(generated)*

<!-- GEN:maps -->
| Map | id | Size | Build zone (x <) | Army cap | HQ spots (z, player 0 at x 3.5) | Resource sites | Rivers (x: fords z/width) | Lakes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Crossing | `crossing` | 48 x 32 | 16" (player 1: x > 32) | 30 | 9, 16, 23 | 4 | 24: 7/3, 25/3 | 0 |
| Twin Rivers | `twinrivers` | 64 x 40 | 21" (player 1: x > 43) | 34 | 10, 20, 30 | 6 | 22: 9/3, 29/3; 42: 31/3, 11/3 | 0 |
| Highland Ruins | `highland` | 64 x 44 | 21" (player 1: x > 43) | 34 | 11, 22, 33 | 6 | - | 1 |
| Great Field | `greatfield` | 80 x 52 | 27" (player 1: x > 53) | 38 | 12, 26, 40 | 8 | 40: 8/3, 26/3.4, 44/3 | 2 |

#### Crossing (`crossing`, 48" x 32")

A stream with two fords, woods and ruins. Small and quick.

Terrain (full, mirrored): forest (15, 7.5) r3.9; forest (33, 24.5) r3.9; forest (20, 26) r3.9; forest (28, 6) r3.9; ruin (22, 13.4) 4.2x0.6; ruin (26, 18.6) 4.2x0.6; ruin (20.2, 15.6) 0.6x3.2; ruin (27.8, 16.4) 0.6x3.2; rock (13.5, 25) r1.2; rock (34.5, 7) r1.2; rock (27.5, 5.2) r1; rock (20.5, 26.8) r1; river x24 (w 1.6, fords z7/3 z25/3).

Resource sites: (16.5, 19.5), (31.5, 12.5), (20.5, 6.5), (27.5, 25.5). Road control points: [[0,16],[14,12],[34,20],[48,16]].

```
...........~~...........
...........~~^^.........
......^^^..==oo^........
......^^^.$==^^^oo......
.H....^^^..==^^.......H.
.......^...~~...........
..........#~~..$........
..........#~~#..........
.H........#~~#........H.
........$..~~#..........
...........~~...^.......
.H.......^^==..^^^....H.
......oo^^^==$.^^^......
........^oo==..^^^......
.........^^~~...........
...........~~...........
```

#### Twin Rivers (`twinrivers`, 64" x 40")

Two streams split the field in three. Hold the middle ground between them.

Terrain (full, mirrored): forest (12, 8) r3.7; forest (52, 32) r3.7; forest (16, 32) r4.2; forest (48, 8) r4.2; forest (28.5, 20) r4.5; forest (35.5, 20) r4.5; ruin (27, 9) 4.2x0.6; ruin (37, 31) 4.2x0.6; ruin (25.2, 11.2) 0.6x3.2; ruin (38.8, 28.8) 0.6x3.2; rock (18.5, 25.5) r1.1; rock (45.5, 14.5) r1.1; rock (30, 33) r1; rock (34, 7) r1; river x22 (w 1.6, fords z9/3 z29/3); river x42 (w 1.6, fords z31/3 z11/3).

Resource sites: (16.5, 16), (47.5, 24), (27, 27.5), (37, 12.5), (31, 4), (33, 36). Road control points: [[0,20],[20,14],[44,26],[64,20]].

```
..........~~........~~..........
..........~~........~~..........
.....^^...~~...$....~~.^^.......
....^^^^..==....oo..~~^^^^......
....^^^^..==###.....==^^^^......
.H...^^...==#.......==.^^.....H.
..........~~#.....$.==o.........
..........~~........~~oo........
........$.~~.^^^^^^.~~..........
..........~~^^^^^^^^~~..........
.H........~~^^^^^^^^~~........H.
..........~~.^^^^^^.~~..........
........oo~~........~~.$........
.........o==.$.....#~~..........
.......^^.==.......#==...^^.....
.H....^^^^==.....###==..^^^^..H.
......^^^^~~..oo....==..^^^^....
.......^^.~~........~~...^^.....
..........~~....$...~~..........
..........~~........~~..........
```

#### Highland Ruins (`highland`, 64" x 44")

A maze of ruins around a mountain lake. Tight paths, good cover.

Terrain (full, mirrored): forest (14, 6) r5.1; forest (50, 38) r5.1; forest (12, 37) r4.4; forest (52, 7) r4.4; forest (24, 39) r3.9; forest (40, 5) r3.9; ruin (26, 16) 0.6x5; ruin (38, 28) 0.6x5; ruin (28.5, 13.5) 5x0.6; ruin (35.5, 30.5) 5x0.6; ruin (24, 27) 4x0.6; ruin (40, 17) 4x0.6; ruin (19, 20.5) 0.6x4; ruin (45, 23.5) 0.6x4; rock (27, 31) r1.3; rock (37, 13) r1.3; rock (22, 11) r1.2; rock (42, 33) r1.2; lake (32, 22) r3.6.

Resource sites: (17, 29.5), (47, 14.5), (25, 6), (39, 38), (30, 37.5), (34, 6.5). Road control points: [[0,22],[18,30],[46,14],[64,22]].

```
......^^........................
.....^^^^.........^^^^...^^.....
....^^^^^^........^^^^..^^^^....
....^^^^^^..$....$^^^^..^^^^....
.....^^^^...............^^^^....
.H....^^..oo.............^^...H.
.............###..o.............
.......................$........
...................##...........
.........#.....~~...............
.........#....~~~~....#.........
.H.......#....~~~~....#.......H.
...............~~.....#.........
...........##...................
........$.......................
.............o..###.............
.H...^^.............oo..^^....H.
....^^^^...............^^^^.....
....^^^^..^^^^.$......^^^^^^....
....^^^^..^^^^.....$..^^^^^^....
.....^^...^^^^.........^^^^.....
........................^^......
```

#### Great Field (`greatfield`, 80" x 52")

A huge open battlefield with ponds, woods and a long stream. For big armies.

Terrain (full, mirrored): forest (14, 9) r4.8; forest (66, 43) r4.8; forest (24, 41) r5.4; forest (56, 11) r5.4; forest (31, 17) r4.2; forest (49, 35) r4.2; forest (11, 45) r3.9; forest (69, 7) r3.9; lake (21, 27) r2.4; lake (59, 25) r2.4; ruin (33, 32) 4x0.6; ruin (47, 20) 4x0.6; ruin (30, 6) 0.6x3.6; ruin (50, 46) 0.6x3.6; rock (18, 34) r1.2; rock (62, 18) r1.2; rock (36, 12) r1; rock (44, 40) r1; river x40 (w 1.6, fords z8/3 z26/3.4 z44/3).

Resource sites: (20, 17), (60, 35), (30, 45), (50, 7), (34, 24), (46, 28), (26, 4), (54, 48). Road control points: [[0,26],[24,16],[56,36],[80,26]].

```
...................~~...................
...................~~...................
......^^.....$.....~~............^^^....
.....^^^^..........==....$^^^^...^^^....
.....^^^^..........==....^^^^^^..^^^....
.....^^^^........oo~~....^^^^^^.........
.H....^^.......^.oo~~....^^^^^^.......H.
..............^^^..~~.....^^^^..........
..........$..^^^^^.~~.........oo........
..............^^^..~~.........oo........
...............^...~~...................
...................~~.......~~~.........
.........~~~.....$.==.......~~~.........
.H.......~~~.......==.......~~~.......H.
.........~~~.......~~..$................
...................~~...^...............
........oo.........~~..^^^..............
........oo.........~~.^^^^^...$.........
..........^^^^.....~~..^^^..............
.........^^^^^^....~~oo.^.......^^......
.H.......^^^^^^....~~oo........^^^^...H.
....^^^..^^^^^^....==..........^^^^.....
....^^^...^^^^.$...==..........^^^^.....
....^^^............~~...........^^......
...................~~......$............
...................~~...................
```

Deployment (player 0; player 1 mirrored), relative to the chosen HQ spot z: hero x 9.5, z +0; fighter (kingdom only) x 12.5, z +2.5; builder (kingdom only) x 7, z +3.2; swarm (undead only) x 12.5, z +0. Each squad gets a seeded jitter of up to +-0.8" (builders none), then is nudged clear of terrain and other squads.
<!-- /GEN:maps -->

Legend for the sketches (1 character = 2″): `.` open ground, `^` forest, `#` ruin, `o` rock,
`~` water (stream or lake), `=` ford, `$` resource site, `H` possible HQ spot (left = player 0).

---

## 14. AI (`js/ai/ai.js`)

The AI sees only what its side sees (+ memory of enemies seen in the last 3 rounds, + building intel).

### 14.1 Command points and who gets orders
Each round it ranks its non-builder, non-summoned squads (summoned skeletons always follow their
Advance stance) and gives direct orders to the hero (free) and the first
`3 + banners ± difficulty` squads; the rest follow stances (§14.3). Ranking: hero first; squads near
its own HQ when the HQ is threatened (enemy within 12″); then, on wave maps while gathering, squads
in a fight (enemy within 8″) and then the ones farthest from the rally point; otherwise the ones
closest to an enemy.

### 14.2 Targets and tactics (ordered squads)
- Target = the nearest known enemy; the HQ only if it is the closest thing or within 9″ (except in an
  attack / assault, §14.4–14.5, when the HQ is the target unless the squad is in a fight).
- **Aim lead:** aims at the target's position + 0.5 × its last movement (not on Easy).
- **Melee:** walk to striking distance (stance `meleePlan`) and swing for the rest of the AP.
- **Shooters:** if beyond 0.9 × range or the line is blocked → walk up to 45 AP to within 0.75 × range
  (0.45 × if blocked), then overwatch if ≥ 40 AP left; else volley until AP runs out.
- **Skills:** Lock Shields when engaged or facing shooters in range; Rally when ≥ 2 friends are close;
  Leap Strike at a target 1″ to 7″ away; **Mighty Swing** when the target's edge is within reach − 0.2″;
  **Lich and Necromancers** (in this order, while mana and AP last): Corpse Explosion on each own summoned squad
  within 9″ with ≥ 2 enemies within 2.5″ (or ≥ 1 if it crumbles this round); Summon Warband toward the
  target when it is < 12″ away, fewer than 4 summoned squads are alive and mana ≥ 40 + 25; Dark Thunder
  at the target up to twice when it is in range with a clear line; then bolts; Arrow Storm when ≥ 2 enemies
  fit under it or the target hides behind a wall; Piercing Bolt at a target in range with a clear line;
  Charge at a **slower** enemy 0.5″ – len−1 away in a clear lane.
- Fighters engaged in melee prepare a parry. Leftover AP → defends.
- **Fast squads** scout: while the enemy HQ is unknown they head for unscouted HQ spots; once known,
  they raid the nearest known enemy Mine / Soul Well (unless a fight is within 8″).
- From round 8, if the enemy HQ is still unknown, ordered squads not in a fight go to the nearest
  unscouted HQ spot.

### 14.3 Stances it sets
Small maps: every non-builder squad on **Advance**. Wave maps: **Advance** while attacking, **Guard**
while gathering.

### 14.4 Waves (maps 60″ wide or more: Twin Rivers, Highland Ruins, Great Field)
- **Rally point:** 3″ in front of its build zone (x = zone + 3 for player 0), on the line from its HQ
  toward the target (known enemy HQ, else the nearest unscouted HQ spot), moved to a clear spot.
- **Gather phase:** ordered squads walk to the rally point (unless a fight is within 8″); squads there
  stand on Guard. Launch the wave (from round 3, with ≥ 3 squads) when **≥ 60 % of the army (and ≥ 4
  squads) is within 6″ of the rally point**, or the army is at its cap, or gathering has lasted 4
  rounds (3 on Hard). Easy needs 75 %, Hard 50 %.
- **Attack phase:** all squads Advance; ordered squads go for the HQ (or search for it) unless in a
  fight (enemy edge within 3″) or defending home; shooters within range + 8″ of the known HQ shoot the
  HQ (unless an enemy is within 2″).
- **Fall back:** when fewer than 40 % (Easy 50 %) of the wave's squads remain → regroup at home;
  when 10 rounds pass without damaging the enemy HQ → regroup at a **forward rally point** where the
  army stands (3″ back toward home), so the next wave starts close.

### 14.5 Small maps (Crossing): steady pressure
`assault` from round 6 when its known army HP ≥ 1.15 × the enemy's known army HP, or from round 12
regardless: ordered squads go for the HQ unless in a fight.

### 14.5c Small starts, seen ground and graves
- Build order: a **Barracks first** (Kingdom; the Undead only once they have a Soul Well), then the Farm.
  Kingdom peasants: at most 2 until a Barracks stands, then up to min(10, 2 + round / 3, 8). The Keep
  also trains Men-at-arms.
- Only **seen** resource sites are candidates. **Undead expansion:** when the nearest seen free site
  isn't on graves yet, the AI first tries a **Monolith** (no other Monolith rising or queued, enough
  souls): spots 2″, 3.5″ and 5.4″ around the Lich and each Necromancer squad, the 30 nearest the site,
  taken only if its 6″ graves reach at least 1″ closer to the site than the current graves; otherwise
  one Bone Fence on its grave edge closest to that site (one at a time, waiting for the last fence),
  until a Soul Well fits; without a Soul Well it keeps 32 souls back
  from training for that. Building spots are tried from 2.5″ out around its buildings.

### 14.5b Revive and the swarm
- A fallen hero's revive zone: the 2 nearest ordered squads that aren't within 6″ of an enemy walk to it
  and hold it (all defends) until the hero returns.
- Training (Undead): the Crypt always trains the swarm; an Ossuary trains **Necromancers** while it has
  fewer than floor(army / 6) of them, else a swarm pair whenever it has no more swarm squads than
  Warriors + archers, else the usual pick. It only starts a pair with 2 free
  cap slots.

### 14.6 Economy (build order, one new building per free builder per round, up to 3)
The AI queues **just in time**: it only appends buildings it can pay for now with a free builder (the
Undead: while fewer than 2 sites rise, no builder needed) so they start the same round, and only trains at an idle Barracks / HQ whose queue is empty, using the
legacy append orders (§3.3). Items still waiting in its build queue count as placed for its build
order and its placement checks.
Checked in this order each round (first that applies and can be placed):
1. Enemy within 14″ of its HQ and fewer than 2 walls → Palisade / Bone Fence toward the threat.
2. Kingdom: no Farm → Farm. Undead: no Soul Well → Soul Well.
3. No Barracks → Barracks.
4. No Mine / Soul Well → one on the nearest free site.
5. Has a Barracks, no tower, round ≥ 3 → Tower toward the front.
6. Fewer than 2 Mines / Wells, round ≥ 4 → another.
7. Kingdom, fewer farms than min(6, ceil(builders / 3)), round ≥ 3 → Farm.
7b. Has a Barracks and fewer than min(4, 1 + floor(resource / 60)), round ≥ 5 → another Barracks /
   Ossuary (so a big bank turns into squads under the bigger cap).
8. Kingdom: fewer than 2 Banners, round ≥ 5, resource ≥ cost + 20 → Banner.
8b. Undead: round ≥ 5, fewer than 1 + floor(round / 8) Monoliths, souls ≥ cost + 25 → a forward
   **Monolith** toward the known enemy HQ (else the table's centre), with the same spot rules as the
   expansion Monolith (a grave and heal station ahead of the horde).
9. Fewer than 2 towers, round ≥ 6, resource ≥ cost + 30 → Tower.

Once a Barracks is finished it keeps 24 in reserve for training (except for the Barracks itself).
Unfinished sites and buildings below 70 % HP that no builder is assigned to get the nearest free
builder. **Training:** Kingdom peasants up to min(10, 2 + floor(round / 3), 8) from round 2 (if resource
≥ cost + 10), one at a time at the Keep; every idle training building with an empty queue (Barracks /
Ossuary, and the Crypt for warbands) trains: fast if the enemy has ≥ 2 shooters and it has < 2 fast;
else a tank if it has none; else ranged if it has fewer ranged than fighters; else a fighter (the Crypt
only trains warbands).

### 14.7 Home defence
If an enemy squad is within 12″ of its HQ, squads within 16″ of the HQ are ranked first and fight.

### 14.8 Difficulty (vs AI only; online games are always 1×)
| | Easy | Normal | Hard |
|---|---|---|---|
| AI income | ×0.8 | ×1 | ×1.25 |
| AI command points | −1 | 0 | +1 |
| Aim lead | off | on | on |
| Wave launch (share at rally) | 75 % | 60 % | 50 % |
| Max gather rounds | 4 | 4 | 3 |
| Fall back below | 50 % | 40 % | 40 % |

---

## 15. Online (balance-relevant only)
Host = player 0 (left), guest = player 1. Both pick armies (mirror allowed; the second army is
repainted). The host picks the map and a planning timer (off / 60 / 90 / 120 s; when it runs out the
current draft is sent; a guest that does not answer within 8 s after the deadline plays with no
orders). The host resolves each round; the guest replays the same orders locally and adopts the host's
state. Income multiplier is 1 for both.

---

## 16. Balance status

<!-- BALANCE -->
_Latest run: 2026-11-17, after the Undead death economy (Crypt 1, Soul Well 2, deaths on graves the
main income), the Monolith, Necromancers, the Lich and bigger forests; Undead start 90 souls.
`node tools/balance.mjs --games 8` (8 seeds × both army orders = 16 AI-vs-AI games per map, both AIs
Normal, a game still going after 100 rounds counts as unfinished)._

| Map | Kingdom wins | Undead wins | Unfinished | Rounds (avg / median / min / max) | How games ended |
|---|---|---|---|---|---|
| Crossing | 3 (19 %) | 13 (81 %) | 0 | 31.3 / 29 / 19 / 67 | HQ destroyed 9, army + barracks 7 |
| Twin Rivers | 10 (63 %) | 6 (38 %) | 0 | 31.5 / 27 / 13 / 78 | HQ 15, army + barracks 1 |
| Highland Ruins | 9 (69 %) | 4 (31 %) | 3 | 29.4 / 17 / 13 / 80 | HQ 11, army + barracks 2, unfinished 3 |
| Great Field | 12 (100 %) | 0 (0 %) | 4 | 25.4 / 16 / 14 / 91 | HQ 11, army + barracks 1, unfinished 4 |
| **All** | **34 (60 %)** | **23 (40 %)** | **7 of 64** | | |

**What the numbers say (2026-11-17, death economy):**
- **Overall 60 / 40, still split by map.** The Undead swarm wins the small Crossing (81 %); the Kingdom
  wins the big maps, most of all Great Field (all 12 decided games). Games on the big maps end early
  (median 16–27 rounds): the Kingdom's wave reaches the Crypt before the Undead's death income gets
  going, so most big-map Undead losses are HQ kills.
- Souls from deaths on graves: 155–743 a game, against a flat income of only 96–152 (the Crypt 1 and
  Soul Wells 2 are just a floor, as intended). In long games the death income is 3–5× the flat income.
- The AI raises 1–2 Monoliths a game and trains about 2 Necromancer squads; Necromancers deal the most
  damage per squad of the Undead high-tier units.
- **Tuning path this session (3-seed runs unless noted):** death economy as asked (start 70) → Kingdom
  41 / Undead 20 (8 seeds); souls per model 3 → 4 → no change on the big maps, Crossing worse (reverted);
  Warband HP 4 → 5 (a stat: allowed for low tier) → Crossing 6 / 6 Undead (reverted); **Undead start 70
  → 90 souls** → this run, Kingdom 34 / Undead 23.
- **Next tuning ideas (keeping the tier rule):** cheaper high-tier units for the long big-map games
  (Grave Guard / Wraiths 16 → 13, they are rarely trained); a cheaper or faster Monolith (cost 20 → 15,
  or work 120 → 80) so the Undead reach far sites sooner; on Crossing, slow the swarm rush by stats
  (Warband damage 2.4 → 2.1) rather than cost; slow Kingdom late gold on big maps (farm 8 → 10 AP per gold).

<details><summary>Full report (per faction: buildings finished, squads trained, income, gathering, souls, HQ found, per unit type damage dealt / taken / models lost / squads lost)</summary>

```
Balance report 2026-11-17 · 8 seeds x 2 orders per map · AI normal · stop at round 100

## crossing: 16 games · Kingdom 3 (19% of decided) · Undead 13 (81%) · draws 0 · unfinished 0
   rounds (decided): avg 31.3, median 29, min 19, max 67 · ends: {"hq destroyed":9,"army and barracks gone":7}
   kingdom: built/game {"barracks":1.1,"farm":1.4,"wall":1.8,"banner":1.4,"mine":0.7,"tower":0.6} · trained/game {"fighter":5.5,"builder":10.4,"tank":0.5,"ranged":0.4,"fast":0.4}
      income/game 290.3 · gathered/game 140.4 · souls/game 0.0 · found enemy HQ in 7/16 games, avg round 13.4
      per unit type (per game): builder dealt 0.1 taken 347.6 models lost 20.1 squads lost 10.0 trained 10.4 | fast dealt 31.1 taken 19.8 models lost 0.8 squads lost 0.3 trained 0.4 | fighter dealt 389.3 taken 482.6 models lost 23.1 squads lost 5.6 trained 5.5 | hero dealt 281.0 taken 131.8 models lost 1.0 squads lost 1.0 trained 0.0 | ranged dealt 5.9 taken 11.7 models lost 0.8 squads lost 0.2 trained 0.4 | tank dealt 8.6 taken 26.4 models lost 0.8 squads lost 0.3 trained 0.5
   undead: built/game {"monolith":1.4,"wall":1.8,"well":1.7,"barracks":1,"tower":0.8} · trained/game {"swarm":30,"summon":8.8,"mage":1.4,"tank":0.6,"fast":0.1,"fighter":0.2,"ranged":0.1}
      income/game 100.4 · gathered/game 0.0 · souls/game 217.7 · found enemy HQ in 13/16 games, avg round 8.2
      per unit type (per game): fast dealt 26.0 taken 2.9 models lost 0.1 squads lost 0.0 trained 0.1 | fighter dealt 0.0 taken 0.0 models lost 0.0 squads lost 0.0 trained 0.2 | hero dealt 299.6 taken 51.4 models lost 0.3 squads lost 0.3 trained 0.0 | mage dealt 63.2 taken 5.6 models lost 0.4 squads lost 0.2 trained 1.4 | ranged dealt 0.0 taken 0.0 models lost 0.0 squads lost 0.0 trained 0.1 | summon dealt 147.3 taken 154.6 models lost 11.8 squads lost 3.7 trained 8.8 | swarm dealt 1208.6 taken 616.9 models lost 121.5 squads lost 18.8 trained 30.0 | tank dealt 33.6 taken 9.9 models lost 0.4 squads lost 0.1 trained 0.6

## twinrivers: 16 games · Kingdom 10 (63% of decided) · Undead 6 (38%) · draws 0 · unfinished 0
   rounds (decided): avg 31.5, median 27, min 13, max 78 · ends: {"hq destroyed":15,"army and barracks gone":1}
   kingdom: built/game {"barracks":1.3,"farm":1.4,"banner":1.4,"wall":1.9,"mine":0.6,"tower":0.3} · trained/game {"fighter":5.7,"builder":9.9,"tank":0.5,"ranged":0.5,"fast":0.6}
      income/game 299.1 · gathered/game 130.3 · souls/game 0.0 · found enemy HQ in 13/16 games, avg round 11.2
      per unit type (per game): builder dealt 0.1 taken 310.1 models lost 17.8 squads lost 8.8 trained 9.9 | fast dealt 42.5 taken 42.8 models lost 1.7 squads lost 0.6 trained 0.6 | fighter dealt 470.1 taken 447.8 models lost 21.1 squads lost 5.0 trained 5.7 | hero dealt 253.5 taken 76.6 models lost 0.5 squads lost 0.5 trained 0.0 | ranged dealt 9.9 taken 11.8 models lost 0.8 squads lost 0.2 trained 0.5 | tank dealt 12.2 taken 39.6 models lost 1.1 squads lost 0.3 trained 0.5
   undead: built/game {"monolith":1.6,"well":1.2,"wall":2.1,"barracks":0.6,"tower":0.4} · trained/game {"swarm":23.8,"summon":4.8,"mage":0.8,"tank":0.4,"fighter":0.9,"ranged":0.7}
      income/game 96.4 · gathered/game 0.0 · souls/game 154.7 · found enemy HQ in 15/16 games, avg round 13.9
      per unit type (per game): fighter dealt 34.6 taken 13.5 models lost 1.3 squads lost 0.2 trained 0.9 | hero dealt 142.4 taken 27.2 models lost 0.2 squads lost 0.2 trained 0.0 | mage dealt 57.3 taken 0.0 models lost 0.0 squads lost 0.0 trained 0.8 | ranged dealt 102.7 taken 3.1 models lost 0.3 squads lost 0.1 trained 0.7 | summon dealt 88.1 taken 54.8 models lost 3.8 squads lost 1.2 trained 4.8 | swarm dealt 1090.6 taken 586.6 models lost 113.8 squads lost 17.9 trained 23.8 | tank dealt 15.8 taken 9.4 models lost 0.4 squads lost 0.1 trained 0.4

## highland: 16 games · Kingdom 9 (69% of decided) · Undead 4 (31%) · draws 0 · unfinished 3
   rounds (decided): avg 29.4, median 17, min 13, max 80 · ends: {"unfinished":3,"hq destroyed":11,"army and barracks gone":2}
   kingdom: built/game {"barracks":1.8,"farm":1.6,"banner":1.3,"mine":0.8,"wall":1.5,"tower":0.8} · trained/game {"fighter":12.1,"builder":10.5,"tank":1.6,"ranged":4,"fast":1.4}
      income/game 536.9 · gathered/game 357.0 · souls/game 0.0 · found enemy HQ in 12/16 games, avg round 17.4
      per unit type (per game): builder dealt 0.1 taken 292.9 models lost 17.0 squads lost 8.4 trained 10.5 | fast dealt 111.9 taken 81.2 models lost 3.3 squads lost 1.1 trained 1.4 | fighter dealt 777.0 taken 842.8 models lost 40.0 squads lost 9.5 trained 12.1 | hero dealt 235.6 taken 88.6 models lost 0.5 squads lost 0.5 trained 0.0 | ranged dealt 480.4 taken 123.4 models lost 7.6 squads lost 1.8 trained 4.0 | tank dealt 71.5 taken 115.5 models lost 3.1 squads lost 1.0 trained 1.6
   undead: built/game {"monolith":2.1,"wall":3.4,"well":1.3,"barracks":1.4,"tower":1.1} · trained/game {"swarm":38.3,"summon":7.4,"mage":2.5,"tank":1.1,"fighter":1.1,"fast":1.3,"ranged":0.8}
      income/game 123.3 · gathered/game 0.0 · souls/game 491.6 · found enemy HQ in 15/16 games, avg round 14.7
      per unit type (per game): fast dealt 44.7 taken 47.0 models lost 3.0 squads lost 1.0 trained 1.3 | fighter dealt 18.9 taken 38.4 models lost 3.4 squads lost 0.6 trained 1.1 | hero dealt 188.6 taken 42.1 models lost 0.4 squads lost 0.4 trained 0.0 | mage dealt 129.1 taken 34.6 models lost 2.6 squads lost 1.3 trained 2.5 | ranged dealt 59.1 taken 9.0 models lost 0.8 squads lost 0.2 trained 0.8 | summon dealt 128.2 taken 97.4 models lost 6.9 squads lost 2.4 trained 7.4 | swarm dealt 1429.0 taken 1047.1 models lost 204.1 squads lost 33.1 trained 38.3 | tank dealt 15.6 taken 41.1 models lost 1.8 squads lost 0.5 trained 1.1

## greatfield: 16 games · Kingdom 12 (100% of decided) · Undead 0 (0%) · draws 0 · unfinished 4
   rounds (decided): avg 25.4, median 16, min 14, max 91 · ends: {"hq destroyed":11,"unfinished":4,"army and barracks gone":1}
   kingdom: built/game {"barracks":1.9,"farm":1.8,"banner":1.4,"mine":1.1,"wall":0.9,"tower":1.1} · trained/game {"fighter":16.8,"builder":5.9,"tank":1.8,"ranged":8.2,"fast":2.1}
      income/game 655.3 · gathered/game 492.0 · souls/game 0.0 · found enemy HQ in 14/16 games, avg round 15.9
      per unit type (per game): builder dealt 0.0 taken 94.4 models lost 5.3 squads lost 2.4 trained 5.9 | fast dealt 193.8 taken 125.5 models lost 5.0 squads lost 1.6 trained 2.1 | fighter dealt 1066.1 taken 1027.3 models lost 48.0 squads lost 11.3 trained 16.8 | hero dealt 226.8 taken 69.0 models lost 0.4 squads lost 0.4 trained 0.0 | ranged dealt 965.2 taken 324.6 models lost 19.8 squads lost 4.8 trained 8.2 | tank dealt 66.3 taken 132.1 models lost 3.7 squads lost 1.2 trained 1.8
   undead: built/game {"monolith":1.9,"wall":3.3,"well":1.6,"barracks":1.3,"tower":1.6} · trained/game {"swarm":43.9,"summon":5.8,"tank":1.7,"mage":5.2,"fighter":2.6,"fast":3.3,"ranged":2.1}
      income/game 151.9 · gathered/game 0.0 · souls/game 743.1 · found enemy HQ in 14/16 games, avg round 17.3
      per unit type (per game): fast dealt 127.9 taken 138.1 models lost 8.5 squads lost 2.7 trained 3.3 | fighter dealt 36.1 taken 93.2 models lost 9.1 squads lost 1.8 trained 2.6 | hero dealt 31.3 taken 38.9 models lost 0.4 squads lost 0.4 trained 0.0 | mage dealt 188.4 taken 102.1 models lost 7.7 squads lost 3.8 trained 5.2 | ranged dealt 209.5 taken 68.3 models lost 5.9 squads lost 1.4 trained 2.1 | summon dealt 59.3 taken 143.8 models lost 10.9 squads lost 3.5 trained 5.8 | swarm dealt 1214.4 taken 1275.1 models lost 248.2 squads lost 39.9 trained 43.9 | tank dealt 40.6 taken 108.1 models lost 4.9 squads lost 1.5 trained 1.7
```
</details>
<!-- /BALANCE -->

### Known issues and open questions
- Two equal AIs can stall in a siege (each rebuilds at its barracks as fast as it loses squads; HQ and
  towers help the defender; builders repair the HQ between waves). Longer build / training times
  (2026-11-14) made this much rarer.
- The AI sometimes never scouts the enemy HQ on the big maps (fast squads die before they get there).
- In the latest run (2026-11-17, death economy) the Undead win the small map and lose the big ones,
  Great Field most of all (see §16). The AI's Undead still train mostly the swarm.
- Skeleton Warbands are now the Undead's top damage dealers (by numbers); Wraiths are rarely trained.
- With 30-squad armies the nameplates crowd the screen (part of the phone / tablet layout to-do).

---

## 16b. Planned (not in the game yet)
- **Upgrades:** an upgrade that makes the Skeleton Warband train in **threes** instead of pairs (its
  `pair` 2 → 3). Other upgrades to follow.

## 17. Tuning guide (where each number lives)

| What | Where | Effect / notes |
|---|---|---|
| Unit stats (models, HP, armour, tier, vision, defends, attack, skills, parry, ghost) | `js/data/units.js` → `FACTIONS.<faction>.units.<role>` | attack helpers `SWING(ap, dmg, reach)`, `VOLLEY(ap, dmg, range, width)`; skills `CHARGE(ap, dmg, len, cd)`, `BLAST(ap, dmg, range, radius, cd)`, `STORM(...)`, `RALLY(ap, radius, cd)`, `SWEEP(ap, dmg, reach, cd)`, `LEAP(ap, range, cd)`, `STEP(ap, range, cd)`, `WALL(name, ap, cd)`, `PIERCE(ap, dmg, range, width, cd)`, `RAISE(ap, radius, cd)` |
| Global combat rules | `RULES` in `js/data/units.js` (table in §7 of the generated rules below) | armour constant, defend / cover / siege multipliers, engagement, parry, overwatch |
| Economy per faction | `FACTIONS.<f>.eco` (`start`, `hq`, `gather`), `FACTIONS.<f>.train` (costs), `FACTIONS.<f>.buildings` (build list) | |
| Buildings | `BUILDINGS` in `js/data/units.js` | cost, work, hp, armour, footprint, vision, fire, income, cp, site, souls, trains |
| Training time, caps, souls, sites, work reach | `RULES.trainRounds`, `armyCap`, `maxBuilders`, `gatherSlots`, `maxBannerCp`, `maxFarms`, `soulRange`, `soulPerModel`, `soulPerHero`, `siteHp`, `workReach` | |
| Faction identity | `FACTIONS.<f>.hqTrains` (what the HQ trains), `FACTIONS.<f>.maxBuilders` (Kingdom 10, Undead 0), `FACTIONS.undead.rises` (buildings rise, no builders) | |
| Undead rising buildings | `RULES.riseWork` (work per round, 80), `RULES.maxRising` (2 at once), `RULES.undeadMend` (0.05 of max HP per round) | build speed and resilience of the Undead base |
| Souls (death economy) | `soulPerModel` 3 (per model dying on graves: cheap many-model squads pay back more than they cost), `soulPerHero` 15; `FACTIONS.undead.eco.hq` (Crypt, 1), `BUILDINGS.well.income` (2) | the whole Undead economy; the flat incomes are only a floor |
| Ground look (visual only) | `js/render/ground.js` (`TEX` 4 texels per inch, `EDGE` 1.6″ soft edge, shader colours); props in `js/render/graves.js` (`CELL` 0.95″, density cov² × 0.32) and forests in `js/render/table.js` | blight and forest floors as a ground texture |
| Kingdom farms | `BUILDINGS.farm` (`w`, `d` = land used, `slots` = farmers, `income`), `FACTIONS.kingdom.eco.gather.farm` (AP per gold), `FACTIONS.kingdom.train.builder` | late-game gold; land trade-off |
| Mage / mana | `units.<role>.mana` (`max`, `start`, `regen`), each skill's `mana`; `isMage` in `js/data/units.js` | how often the Lich and Necromancers cast |
| Necromancers (troop) | `FACTIONS.undead.units.mage` (2 × 10 HP, bolt `VOLLEY(25, 4, 9)`, mana 60 / 40 / +15, `THUNDER(15, 20, 6, 10, 2, 3, 0.7)`, `SUMMON(20, 35, 4, 1)`), `train.mage` (22), `RULES.trainRounds.mage` (2) | high tier: cost may change |
| Monolith | `BUILDINGS.monolith` (`cost` 20, `work` 120, `grave` 6, `caster` 6 = max distance to a Lich / Necromancers, `offGraves`, `heal: { radius 4, hp 4 }` per model per round) | how fast the Undead push graves forward and recover between fights |
| Undead tier rule | `FACTIONS.undead.lowTier` (`swarm`, `fighter`, `ranged`) | low tier: only stats change, never `train` costs; everything else may change cost |
| Lich spells | `SUMMON(ap, mana, range, count)`, `THUNDER(ap, mana, dmg, range, jumps, jump, decay)`, `EXPLODE(ap, mana, range, radius, base, perModel)`; summoned squad def `FACTIONS.undead.units.summon`; `RULES.summonTtl` | |
| The Chosen | `LEAP(ap, range, cd, dmg, radius, name)`, `RALLY(ap, radius, cd, armor, dmgMult)`, `MIGHTY(ap, dmg, reach, cosHalf, stun, cd)` | stun length = `stun` AP |
| Army cap | `RULES.armyCap` (30), map `capBonus` (`js/data/maps.js`) | big battles cost frame time and AI time |
| Graveyards and souls | `BUILDINGS.<type>.grave` (reach: well 10, hq 10, others 6, Monolith 6), `RULES.graveStart` (0.5 at placement; full by the end of the round), `graveHqStart` (10), `graveDeathGrow` (0.15″ per model), `graveCapMult` (1.5), `gravePatchCap` (3), `soulPerModel`, `soulPerHero`; `FACTIONS.undead.eco.hq` (1), `BUILDINGS.well.income` (2) | the whole Undead economy: how fast it snowballs |
| Hero revive | `RULES.reviveRadius` (3″), `reviveRounds` (3), `reviveHp` (0.5) | how costly losing the hero is |
| The swarm | `FACTIONS.undead.units.swarm` (`pair`, stats), `train.swarm`, `RULES.trainRounds.swarm` | the Undead horde's size |
| Forests | `RULES.forestSlow` (0.75); sight rules `FOREST_DEPTH` / `FOREST_CLOSE` in `js/sim/vision.js`; `coverMult` | |
| Stances | `RULES.advanceEngage` (10″: Advance fights the nearest squad / building within this), `RULES.goalReach` (1.5″), `RULES.retreatReach` (3″); `GUARD_RANGE` 8″ in `js/sim/stances.js` | how eager stance squads are |
| Production queues | `RULES.queueMax` (squads waiting per training building, 5), `RULES.queueMaxBuild` (base build queue, 5); start order and wait rules in `startQueues` (`js/sim/base.js`) | longer queues = fewer decisions per round; the "one unfinished site per builder" rule limits how fast a base grows |
| Builder site pick | `builderIdleTarget` in `js/sim/builders.js` | idle builders take any unfinished site (fewest builders, then nearest); gatherers leave for new sites. A distance limit there would keep builders (Undead especially) off long, exposed walks |
| Maps | `js/data/maps.js` → `MAPS` | size, terrain (`half` mirrored, `center` not), rivers, sites, HQ spots, road, `capBonus` |
| AI behaviour | `js/ai/ai.js` | wave thresholds (`frac`, 6″ rally radius, 4 rounds, 40 % / 10 rounds), assault (round 6 / 12, ×1.15), economy order, training picks, difficulty |
| AI difficulty income | `js/main.js` → `start()` (`{ easy: 0.8, normal: 1, hard: 1.25 }`) | |
| Stances | `js/sim/stances.js` | guard range 8″, advance HQ rule (10″) |

**All RULES (generated):**

<!-- GEN:rules -->
| Key | Value | Meaning |
| --- | --- | --- |
| `board` | `{"w":48,"h":32}` | default board (each map sets its own size) |
| `ap` | `100` | AP per squad per round; AP = time |
| `tierCost` | `[15,25]` | AP cost of the 1st / 2nd "act earlier" upgrade |
| `maxUpgrades` | `2` | max act-earlier upgrades per squad per round |
| `minTier` | `1` | lowest tier |
| `moveFactor` | `0.012` | inches per AP per speed tier (tier 5 = 6" per 100 AP) |
| `defendCost` | `20` | AP per bought defend |
| `maxDefends` | `4` | max bought defends per round |
| `armorK` | `20` | armour constant in damage * K / (K + armour) |
| `defendMult` | `0.5` | a defended hit deals x this |
| `cp` | `3` | command points per round (hero and builders are free) |
| `engageGap` | `0.35` | inches between squad edges that count as engaged |
| `disengageAP` | `30` | AP spent standing still when stepping away from an engaged enemy |
| `partingMult` | `0.5` | parting blow strength (x the enemy's full attack) |
| `parryCost` | `15` | AP for a prepared parry |
| `riposteMult` | `0.5` | riposte strength (x own attack) |
| `overwatchCost` | `40` | AP for prepared overwatch |
| `overwatchCos` | `0.5` | overwatch cone: cos of the half angle (0.5 = 60 deg each side) |
| `coverMult` | `0.5` | damage x this through / into a forest (volleys, pierce, tower fire) |
| `forestSlow` | `0.75` | movement x this inside a forest |
| `siegeMult` | `2.5` | damage x this against buildings |
| `shrineRadius` | `3` | ring drawn around resource sites (visual + placement keep-out x 0.6) |
| `armyCap` | `30` | base squad cap (builders and summoned squads do not count; maps add capBonus) |
| `maxBuilders` | `3` | default builder cap (FACTIONS.<f>.maxBuilders overrides) |
| `gatherSlots` | `2` | builders that can gather at one building (BUILDINGS.<type>.slots overrides: farm 4) |
| `buildZone` | `16` | default build zone (each map: round(width / 3)) |
| `maxBannerCp` | `2` | max Kingdom banners (and max bonus CP) |
| `riseWork` | `80` | undead: work a rising site gains at the end of every round (no builders) |
| `maxRising` | `2` | undead: sites rising at the same time |
| `undeadMend` | `0.05` | undead: finished buildings regain this share of max HP every round |
| `summonTtl` | `3` | rounds a summoned squad lasts |
| `advanceEngage` | `10` |  |
| `goalReach` | `1.5` |  |
| `retreatReach` | `3` |  |
| `trainRounds` | `{"builder":1,"swarm":1,"fighter":2,"ranged":2,"fast":2,"mage":2,"tank":3}` | rounds each role takes to train |
| `queueMax` | `5` | squads waiting per training building |
| `queueMaxBuild` | `5` | buildings waiting in the base build queue |
| `siteHp` | `0.3` | share of max HP a new site starts with |
| `workReach` | `1` | inches between builder edge and footprint to work |
| `soulPerModel` | `3` | souls per model that dies |
| `soulPerHero` | `15` | souls when a hero dies |
| `graveStart` | `0.5` | share of its graveyard a new undead site spreads at once (the rest by the round's end) |
| `graveHqStart` | `10` | the Crypt's graveyard at the start |
| `graveDeathGrow` | `0.15` | inches a graveyard widens per model dying on it |
| `graveCapMult` | `1.5` | deaths can widen a building's graveyard to this x its max |
| `gravePatchCap` | `3` | leftover patches widen up to max(size, this) |
| `reviveRadius` | `3` | revive zone radius |
| `reviveRounds` | `3` | rounds a side must hold the zone |
| `reviveHp` | `0.5` | revived hero's HP share |
| `planningTimerSec` | `120` | (unused; the online timer is chosen in the lobby) |
<!-- /GEN:rules -->

**Test loop for a balance change**
1. Change the number(s).
2. `node tests/sim.test.mjs` (some tests assert exact values: update them if the change is intended).
3. `node tools/balance.mjs --games 8` (≈ 3–6 minutes) and compare with §16; for a quick look
   `--games 3 --maps crossing,twinrivers`.
4. `npm run doc` to refresh the generated tables; update §16 and add a §18 change-log entry.

---

## 18. Change log (balance-relevant)

| Date | Change | Measured effect |
|---|---|---|
| 2026-11 (M1–M2) | Core (the 4th remake, then called V4): squads, tiers, skillshots, engagement, parry, overwatch, cover, cooldowns. HP tuning for Lord vs Necromancer, Grave Guard, Bone Archers | 40 mirrored games roughly even |
| 2026-11 (M3) | Bases: HQ 220 HP / armour 8, siege ×2.5, shrine income, towers; round limit 30 | Kingdom 26 / Undead 14 of 40; 24 of 40 reached the limit |
| 2026-11-13 (M3c) | Faction economies: Kingdom gold (Keep, Farms, Mines), Undead souls (Crypt, Soul Wells, deaths ×2 within 8″); builders; real fog; HQ at 1 of 3 seeded spots | iterated Keep income 6 → 8 → 7: Kingdom 34 / Undead 26 of 60 |
| 2026-11-13 (M3d) | Builders gather (Kingdom farm 12 / mine 10 AP per gold; Undead well 9 / crypt 8 AP per soul, 2 per building); Keep income 7 → 6; round-limit tiebreak counts squads and HQ only | 30 / 30 of 60 |
| 2026-11-13 | **No round limit.** Movement: friendly pass-through, contact stop, sidesteps, re-pathing, no deploys inside rocks; Advance marches on the known HQ / searches HQ spots | stuck moves 18 % → 5 %; 25 of 30 games finish within 80 rounds |
| 2026-11-14 (M5) | Four maps (Crossing 48×32, Twin Rivers 64×40, Highland 64×44, Great Field 80×52; army cap +1/+1/+2); lakes; AI difficulty (income ×0.8 / ×1.25, CP ±1) | big maps stalled often (Twin Rivers 6 of 8 unfinished) |
| 2026-11-14 | AI waves on maps ≥ 60″ wide (rally, launch at 60 %, fall back at 40 % / forward rally after 10 rounds, shooters siege the HQ) | unfinished per 8: Twin Rivers 6 → 1, Highland 5 → 2, Great Field ~3 → 2 |
| 2026-11-14 | **Building work ×2** (wall 60, farm / banner 120, mine / well 160, tower 200, barracks 240); **training 1–3 rounds** (builder 1, fighter / ranged / fast 2, tank 3) | games end far more often: 0–1 of 8 unfinished per map; Twin Rivers 16/16 in 11–23 rounds (Undead 10, Kingdom 6) |
| 2026-11-15 | This document, `tools/balance.mjs`, `tools/gendoc.mjs` | see §16 |
| 2026-11-15 | **Production queues:** one base build queue per side (5 buildings) and a training queue per HQ / Barracks (5 squads); each item paid when it **starts**; waits while unaffordable / no free builder / army cap, in strict order; cancelling a waiting item is free, stopping training refunds it. Idle builders take **any** unfinished site (no 12″ limit; fewest builders first) and gatherers leave to take new sites. AI queues just in time | Kingdom / Undead of 64: 32 / 30 → **38 / 24**; Great Field 8 / 7 → 11 / 4; Highland 9 / 6 → 10 / 5; Twin Rivers 6 / 10 → 9 / 7; Crossing 9 / 7 → 8 / 8; unfinished 2 → 2 |
| 2026-11-15 | The game is renamed **Rovina**; the old versions (v1–v3) and the `v4/` redirect are removed. No rule or number changes | none |
| 2026-11-15 | **Faction split.** Undead: units weaker (HP ~−25 %, damage ~−20 %) and ~half price (warband 9, archers 13, guard 16, wraiths 16); **no builders** (buildings rise 80 work a round, 2 at once, mend 5 %/round); the Crypt raises warbands; souls only from deaths within 10″ of a finished Soul Well (3 per model, 15 per hero), Crypt 4, Well +2 (cost 20); **Necromancer = mage** (tier 3, mana 100 / start 60 / +25, bolt 10 at 10″, Summon Warband 2 temporary squads for 3 rounds, Dark Thunder 14 chaining ×0.7 up to 3 jumps, Corpse Explosion 8 + 6/model). Kingdom: **The Chosen** (Leap Strike 12 dmg, Rally +4 armour +1 defend, Mighty Swing 28 / reach 2.6 / 25 AP stun); farms 4.2×3.4″, 4 farmers, 8 AP per gold, +2 passive, no farm cap; peasants 10 gold, max 10, not in the cap. **Army cap 8 → 30** (map bonus ×4). AI: more peasants and farms, extra barracks when rich, Necromancer spell logic | Kingdom / Undead of 64: 38 / 24 → **40 / 24**; median rounds 13–20 → **25–42**; unfinished 2 → 0 |
| 2026-11-15 | **Stances:** Advance is the default and attacks the nearest known enemy within 10″ (squads, buildings and the HQ alike), else marches to a player-set **target point** (then guards it) or on the enemy HQ; new **Retreat** (to the nearest own Mine / Soul Well, else the HQ). **Repeat production** (lock a building onto one squad). **Fast squads:** swing 20 AP → 45 AP; Outriders 7 → 13 per model, Wraiths 6 → 11 | Kingdom / Undead of 64: 40 / 24 → **40 / 24** (Crossing 10/6 → 8/8, Twin Rivers 10/6 → 12/4, Highland 11/5 → 10/6, Great Field 9/7 → 10/6); median rounds 25–42 → 24–48 |
| 2026-11-16 | **Graveyards** (undead buildings spread grave ground: well 10″, Crypt 6″ (starts 3″), others 3″, +1″/round; deaths on graves pay 2 souls per model (hero 15) and widen them 0.15″; destroyed buildings leave their graves; Crypt income 4 → 0; start souls 35 → 45); **hero revive** (hold the spot 3 rounds, back at 50 % HP); **auto skills** for stance squads (toggle per squad); **Skeleton Warband = swarm** (6 × 5 HP, armour 0, tier 6, 3 per model, 12 souls a pair, 1 round; the Crypt trains it) and the old warband becomes **Skeleton Warriors**; **summons rise mid-round** (can be hit, don't act); **build anywhere**; forests slow ×0.75 (was ×0.6) and a new look | Kingdom / Undead of 64: 40 / 24 → **34 / 28**; tries: swarm 8 + 3 souls → Undead 67 % (3 seeds), 12 + 3 → 65 %, 12 + 2 → 45 % (8 seeds) |
| 2026-11-16 | **Small starting armies** (Kingdom: hero, Men-at-arms, 1 peasant; Undead: Necromancer, a swarm pair); the Keep also trains Men-at-arms; **Undead units ×0.8 HP and damage**; **build only on seen ground** (`s.explored`); **Undead build only on their graves**; **graves spread almost at once** (50 % at placement, full by the round's end; Crypt 10″, others 6″, wells 10″); Soul Well income 2 → 4; souls per model 2 → 3; Undead start 45 → 70 souls, Kingdom 40 → 60 gold; swarm pair 12 → 14; fallen hero's body at its revive point; AI: Kingdom Barracks first + peasants by jobs, Undead grave expansion with Bone Fences | Kingdom / Undead of 64: 34 / 28 → **38 / 22** (Crossing 3 / 13, Twin Rivers 12 / 4, Highland 13 / 1, Great Field 10 / 4) |
| 2026-11-17 | **Undead death economy:** Crypt income 0 → 1, Soul Well income 4 → 2 (deaths on graves are the main income); **Monolith** replaces the Obelisk for the Undead (off graves, within 6″ of a caster, 6″ graves, heal 4 HP per model in 4″, no CP); new **Necromancers** troop (22 souls); hero renamed **Lich**; forests ×1.5; Undead start 70 → 90 souls; AI expands with Monoliths and trains Necromancers | Kingdom / Undead of 64: 38 / 22 → 41 / 20 (death economy, start 70) → **34 / 23** with start 90 (Crossing 3 / 13, Twin Rivers 10 / 6, Highland 9 / 4, Great Field 12 / 0; 7 unfinished) |

---

## 19. Keeping this document up to date

Whenever rules, numbers, the AI or maps change:
1. Run `npm run doc` (regenerates every `GEN` table from the data files).
2. Update the prose sections that describe the changed behaviour (§2–§6, §10–§15).
3. For balance-relevant changes, run `node tools/balance.mjs --games 8`, paste the summary into §16,
   and add a row to §18 with the before / after numbers.

---

## 20. Design references

**How references are chosen (the owner's rule, from 2026-11-15):**
- **Gameplay, systems and balance:** most references are **well-known real RTS games** and established
  RTS design guides (and the tabletop wargames the game grew from). They are used for **mechanics and
  ideas** (how a system works, typical numbers, why a design choice is made), never to recreate a
  specific game: no copied names, characters, art, music, maps or levels.
- **Art and look:** only the references the owner gives or names. Nothing else is used for art.
- When a new feature is designed after a reference, add a row below (feature, reference, what was
  taken, what is different here).

**Mechanics already in the game and the real RTS games they resemble:**

| Feature here | Similar to | What is shared | What is different here |
|---|---|---|---|
| Squads of several models; damage removes models; a big squad cap (30) | Dawn of War, Company of Heroes | squad-based armies, losses shown as fewer models, a squad cap | turn-based with simultaneous orders; damage scales with the models left |
| Speed tiers inside a round, simultaneous orders | tabletop wargames (alternating / initiative activation), WeGo games such as Combat Mission | everyone plans, then the round resolves | faster tiers act first; AP is time inside a tier |
| Heroes with three skills | Warcraft III | heroes with a small kit that shapes fights | no hero levels or items |
| Mana mages (the Lich, Necromancers): spells cost mana, regenerate each round | Warcraft III casters | mana pool and regeneration | no cooldowns for mages; casts repeat while AP and mana last |
| Chain lightning (Dark Thunder) | Warcraft III (Far Seer's Chain Lightning) | a bolt that jumps to nearby enemies, weaker each jump | aimed skillshot; first target needs line of sight |
| Stun (Mighty Swing) | Warcraft III (Storm Bolt, Thunder Clap) | a hit that stops the target acting for a while | stun is measured in AP inside the round |
| Temporary summons that crumble | Warcraft III summoned units with a timed life | free bodies that expire | they rise at the end of the round; Corpse Explosion can spend them |
| Undead buildings that build themselves | Warcraft III Undead (summoned buildings), StarCraft Protoss (warped-in buildings) | no worker has to stay to finish a building | a separate limit of 2 rising at once; they mend slowly |
| Workers on farms; farms use land | Age of Empires | farmers gather at farms; farms take building space | 4 farmers per farm; peasants also build and repair |
| Resource sites to claim (Mines, Soul Wells) | Dawn of War (strategic points), Company of Heroes (territory) | fixed spots on the map worth fighting over | Soul Wells only trickle souls and spread graves far |
| Production queues paid when the item starts | the queues of most RTS games (StarCraft II: 5 per building) | queue several items per building | payment at start, the queue waits when you can't pay |
| Fog of war with explored / visible ground | most RTS games (Warcraft, StarCraft, Age of Empires) | black mist for never-seen ground, a haze for explored ground | line of sight blocked by walls and deep forests |
| Command points (3 direct orders a round) | tabletop command / order systems | you can't micro everything | squads without orders follow stances |
| Stances (Advance / Guard / Hold / Retreat) | Age of Empires II unit stances (aggressive, defensive, stand ground, no attack) | standing orders for squads you don't micro | Retreat falls back to a resource site; stances run inside the round's tiers |
| Advance to a target point, fighting on the way | attack-move (StarCraft and most RTS games) | move somewhere but stop to fight what you meet | the point persists over rounds; buildings and squads are equal targets |
| Repeat production (lock a building onto a squad) | Supreme Commander (repeat build on factories), Rise of Nations (continuous production) | a building keeps producing without new orders | the lock only fills an empty queue; each squad is still paid when it starts |
| Graveyards spreading around undead buildings; souls from deaths on them; undead build only on graves | Warcraft III Undead blight, StarCraft Zerg creep, and the Necron power-matrix idea from Dawn of War IV the owner named | ground that spreads almost at once from the faction's buildings; the faction can only build on it | graves pay souls when things die on them and widen with each death |
| Build only on ground you have seen | fog-of-war placement rules of most RTS games | no building blind in unexplored ground | seen once is enough (it doesn't have to be in sight now) |
| Small starting armies | most RTS games (a few workers and a hero, the rest from the base) | the base matters from the first round | the Keep and the Crypt train soldiers from round 1 |
| A swarm unit trained in pairs | StarCraft zerglings (two per egg) | cheap, fragile, fast bodies in numbers | an upgrade to threes is planned |
| Auto skills toggle | Warcraft III autocast | units use abilities by themselves when switched on | applies to every skill of a squad without orders |
| Hero revive by holding the spot | the owner's original design (compare Warcraft III's altar revive) | a fallen hero can come back | you revive it on the battlefield by holding the ground where it fell |
| Fast squads: few heavy hits | cavalry in many RTS games (high damage, slower attack) | burst damage instead of many small hits | 2 swings a round, so they strip fewer defends |
| Blight as a ground texture with soft, noisy edges; big headstones and crosses | Warcraft III Undead blight (named by the owner for the look), StarCraft Zerg creep | the land itself turns dark and dead where the faction spreads, with an organic edge | it is the graveyard (souls); the props thin out toward the edge |
| Death economy (income from things dying on your ground; cheap units pay back more than they cost) | Warcraft III Undead corpses and graveyards (raising from the dead), Dawn of War Necrons / "blood for the god" style economies, StarCraft Zerg (cheap, expendable units) | losses feed the faction; expendable units are part of the plan | per model, so many-model cheap squads profit and elites lose value; the flat income is a floor only |
| Monolith: placed by a caster, spreads graves, heals nearby units | Warcraft III Undead Ziggurat-style blight spreaders and healing structures such as fountains of health / moon wells; Dawn of War IV-style Necron power-matrix pylons (the owner's reference for spreading ground) | a structure that extends your ground and supports units around it | must be raised within 6″ of the Lich or Necromancers; no command points |
| Necromancers as a caster troop under a caster hero | Warcraft III Necromancers / Liches and other caster units with mana | cheap-ish casters with a small spellbook and their own mana | weaker copies of the hero's spells (one-squad summon, short chain) |
| Forests as large woodland that thins at the edges | the forests of most RTS maps (Age of Empires woods, Company of Heroes hedges and woods) | woodland reads as terrain with cover and slower movement | trees thin out across a soft edge; lone trees outside are only decoration |
| AI waves (gather at a rally point, attack together) | the attack-wave behaviour of classic RTS AIs | the AI groups up before attacking | thresholds per difficulty (§14.4) |

