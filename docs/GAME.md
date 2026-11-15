# TIERS V4: complete game and balance reference

This document describes **every rule, number and behaviour** of the game (V4, at the site root) so the
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
19 Keeping this document up to date

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

Each side starts with: an HQ (at one of the map's 3 seeded HQ spots on its back edge), 6 squads (hero,
tank, fighter, ranged, fast, builder) deployed in front of it, and its faction's starting resource.

---

## 2. Round structure and timing (`js/sim/resolve.js` → `resolveRound`)

A round, in order:

1. **Planning** (players / AI build orders; not part of the sim).
2. **Intel update** (each side remembers enemy buildings it sees, §12).
3. **Order validation** (`js/sim/orders.js` → `validateOrders`, §3). Stance changes apply.
4. **Base orders at round start:** each valid build is paid and its **site is placed immediately**
   (blocks movement, can be attacked); each valid training order is paid and starts.
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
9. **End of round:** destroyed squads and buildings are removed → building HP rounded → **training**
   counters tick and finished squads spawn next to their building → **resource sites** change owner
   (whoever has a *finished* Mine / Soul Well on it) → **souls** are paid for this round's deaths →
   **income** is paid → intel update → **skill cooldowns tick** → win check → round number + 1.

**AP is time:** an action costing 25 AP takes 25 AP of the tier's timeline. A squad has exactly
`RULES.ap` = 100 AP per round. Unspent AP is lost (stance plans and the AI turn leftovers into defends).

**Speed:** a squad walks `tier × RULES.moveFactor` = tier × 0.012″ per AP on open ground
(tier 4 = 4.8″, tier 5 = 6.0″, tier 6 = 7.2″ per 100 AP). **Act-earlier upgrades change when a squad
acts, not how fast it walks** (speed uses the unit's base tier). Terrain multiplies speed: **forest ×0.6**,
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
  Banner / Obelisk** (max +2). **Heroes and builders are free** (no CP).
- Squads without direct orders follow their **stance** (§4). Stance changes are free and unlimited.
- AI difficulty changes the AI's CP: Easy −1, Hard +1 (§14.8).

### 3.3 Base orders (validated in `js/sim/base.js` → `validateBase`)
- **Builds:** at most 6 per side per round; need at least one living builder; the building must be
  in the side's faction list (§10), affordable (running total), and pass placement (§11.2).
- **Training:** at most 4 orders per side per round; at most one per building; the building must be
  finished and idle and able to train that role (HQ: builders; Barracks / Ossuary: tank, fighter,
  ranged, fast); affordable; army size (squads + squads in training) below the map's army cap;
  builders also limited to `RULES.maxBuilders` = 3.

---

## 4. Stances (`js/sim/stances.js` → `buildStancePlan`)

A squad without direct orders gets a plan from its stance at the start of the round, using only enemies
its side sees right now (positions at round start). Leftover AP becomes defends (up to 4).

- **Hold:** stand still; all AP into defends (max 4).
- **Guard** (default):
  - Shooters: if an enemy is within attack range → shoot at it until AP runs out; otherwise set
    **overwatch** facing the nearest visible enemy (40 AP) and defend with the rest.
  - Melee: if a visible enemy is within **8″** (`GUARD_RANGE`) → walk to striking distance and swing
    at it (it aims at where the enemy stands now); prepare a **parry** first if it is a fighter and
    already in contact (gap ≤ 0.35″).
- **Advance:**
  - If the **enemy HQ is known** (§12) and **no visible enemy is within 10″**: march on the HQ
    (melee: walk to it and swing; shooters: walk until within range − 0.5″ of the HQ's edge, then shoot it).
  - If **no enemy is visible** at all: march to the HQ if known, else to the nearest **possible HQ spot**
    the side cannot currently see (§13), else toward the enemy half.
  - Otherwise like guard but with unlimited chase distance (melee) / shooters walk until within
    0.8 × range.
- **Builders** (whatever their stance except Hold): keep at their remembered task (finish / repair /
  gather); else finish an own unfinished site within 12″; else **gather** at the nearest own
  gather building with a free slot (§11.4). Hold = stand still.

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
- **Heroic Leap** (Lord): flies for 6 AP to the aim (clamped to range 7″), over everything; lands on
  the nearest free spot back along the line; every adjacent enemy (edge gap < 0.3″) is **shoved 1″**
  away (if the spot is free).
- **Sweep** (Lord): at release hits every enemy within hero radius + reach (full circle).
- **Rally** (Lord): at release, every friendly squad within 5″ (+ its radius) gets **+1 defend** and
  **×1.25 damage** for the rest of the round.
- **Shadow Step** (Necromancer): at release the hero teleports to the aim (≤ 7″), no parting blows.
- **Bone Blast** (Necromancer): a circle (§5.4).
- **Raise** (Necromancer): at release every friendly multi-model squad within 3″ (+ its radius) that is
  missing models regains one model: hp = min(max, models × hpPer + hpPer).
- **Lock Shields / Grave Wall** (tanks): if in the plan, braced **from the start of the round** for the
  whole round: hits from the front 120° (cos ≥ 0.5 from the facing) deal ×0.3. Costs 15 AP.
- **Arrow Storm** (Bone Archers): a big circle, arcs over walls.
- **Wraiths** (`ghost`): pass through all squads when walking or charging, and **are never engaged**.

**Cooldowns:** using a skill sets its cooldown to `cd + 1` at the start of the action; cooldowns tick
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
| hero | Lord Commander | 1 | 120 | 120 | 9 | 5 | 6 | 12 | 2 | 0.65 | swing | 25 | 18 | 18 | reach 1.6" (arc +-60 deg) | 4 | - | - | - |
| tank | Shieldwall | 3 | 34 | 102 | 12 | 4 | 4.8 | 9 | 2 | 1.227 | swing | 30 | 4 | 12 | reach 1.3" (arc +-60 deg) | 3 | - | 30 | 3 |
| fighter | Men-at-arms | 4 | 20 | 80 | 7 | 5 | 6 | 9 | 1 | 1.34 | swing | 25 | 5 | 20 | reach 1.5" (arc +-60 deg) | 4 | parry | 24 | 2 |
| ranged | Crossbows | 4 | 15 | 60 | 3 | 5 | 6 | 11 | 1 | 1.34 | volley | 30 | 4 | 16 | range 14", width 0.7" | 3 | - | 26 | 2 |
| fast | Outriders | 3 | 24 | 72 | 5 | 6 | 7.2 | 11 | 1 | 1.347 | swing | 20 | 7 | 21 | reach 1.7" (arc +-60 deg) | 5 | - | 30 | 2 |
| builder | Peasants | 2 | 14 | 28 | 2 | 5 | 6 | 8 | 0 | 1.094 | swing | 25 | 2 | 4 | reach 1.2" (arc +-60 deg) | 4 | - | 15 | 1 |

**Undead Legion** (`FACTIONS.undead.units`)

| Role | Name | Models | HP/model | HP | Armour | Tier | Move "/rnd | Vision | Defends | Radius | Attack | AP | Dmg/model | Full squad/hit | Reach / range | Hits per 100 AP | Flags | Train cost | Train rnds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero | Necromancer | 1 | 118 | 118 | 7 | 5 | 6 | 12 | 2 | 0.65 | swing | 25 | 16 | 16 | reach 1.6" (arc +-60 deg) | 4 | - | - | - |
| tank | Grave Guard | 3 | 34 | 102 | 11 | 4 | 4.8 | 9 | 2 | 1.227 | swing | 30 | 5 | 15 | reach 1.3" (arc +-60 deg) | 3 | - | 30 | 3 |
| fighter | Skeleton Warband | 5 | 15 | 75 | 5 | 5 | 6 | 9 | 1 | 1.439 | swing | 25 | 4 | 20 | reach 1.5" (arc +-60 deg) | 4 | parry | 18 | 2 |
| ranged | Bone Archers | 4 | 16 | 64 | 2 | 5 | 6 | 11 | 1 | 1.34 | volley | 30 | 4 | 16 | range 14", width 0.9" | 3 | - | 26 | 2 |
| fast | Wraiths | 3 | 24 | 72 | 4 | 6 | 7.2 | 11 | 1 | 1.347 | swing | 20 | 7 | 21 | reach 1.7" (arc +-60 deg) | 5 | ghost | 30 | 2 |
| builder | Grave Thralls | 2 | 14 | 28 | 2 | 4 | 4.8 | 8 | 0 | 1.094 | swing | 25 | 2 | 4 | reach 1.2" (arc +-60 deg) | 4 | - | 15 | 1 |

<!-- /GEN:units -->

Notes: "Move ″/rnd" is the open-ground walk per 100 AP. "Full squad/hit" is the raw damage of one
attack at full models. "Hits per 100 AP" assumes standing in reach the whole round. Swing reach is
measured from the squad's edge. Heroes cannot be trained.

---

## 8. Skills *(generated)*

<!-- GEN:skills -->
| Faction | Unit | Skill | Kind | Category | AP | Cooldown (rounds) | Dmg (per model x models) | Parameters |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kingdom | Lord Commander | Heroic Leap | `leap` | move | 20 | 2 | - | range 7, flight 6, shove 1 |
| Kingdom | Lord Commander | Sweep | `sweep` | attack | 30 | 2 | 14 x 1 = 14 | dmg 14, reach 1.6 |
| Kingdom | Lord Commander | Rally | `rally` | defense | 20 | 2 | - | radius 5, defends 1, dmgMult 1.25 |
| Kingdom | Shieldwall | Lock Shields | `wall` | defense | 15 | 1 | - | mult 0.3, cosHalf 0.5 |
| Kingdom | Crossbows | Piercing Bolt | `pierce` | attack | 35 | 2 | 5 x 4 = 20 | dmg 5, range 16, width 0.7 |
| Kingdom | Outriders | Charge | `charge` | move | 35 | 1 | 9 x 3 = 27 | wind 8, dmg 9, len 9 |
| Undead Legion | Necromancer | Shadow Step | `step` | move | 15 | 2 | - | range 7 |
| Undead Legion | Necromancer | Bone Blast | `blast` | attack | 30 | 2 | 16 x 1 = 16 | dmg 16, range 9, radius 2.2 |
| Undead Legion | Necromancer | Raise | `raise` | defense | 25 | 3 | - | radius 3 |
| Undead Legion | Grave Guard | Grave Wall | `wall` | defense | 15 | 1 | - | mult 0.3, cosHalf 0.5 |
| Undead Legion | Bone Archers | Arrow Storm | `storm` | attack | 35 | 2 | 6 x 4 = 24 | dmg 6, range 15, radius 2.2 |
| Undead Legion | Wraiths | Charge | `charge` | move | 35 | 1 | 8 x 3 = 24 | wind 8, dmg 8, len 9 |
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
| Lord Commander | 18 | 72 | 64 | 56 | 52 | 48 | 44 |
| Shieldwall | 12 | 36 | 30 | 30 | 27 | 24 | 24 |
| Men-at-arms | 20 | 80 | 68 | 64 | 56 | 52 | 52 |
| Crossbows | 16 | 48 | 42 | 39 | 33 | 30 | 30 |
| Outriders | 21 | 105 | 90 | 85 | 75 | 70 | 65 |
| Peasants | 4 | 16 | 12 | 12 | 12 | 12 | 12 |

**Undead Legion: damage per 100 AP against armour**

| Unit | Raw/hit | vs 0 | vs 3 | vs 5 | vs 8 | vs 11 | vs 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Necromancer | 16 | 64 | 56 | 52 | 44 | 40 | 40 |
| Grave Guard | 15 | 45 | 39 | 36 | 33 | 30 | 27 |
| Skeleton Warband | 20 | 80 | 68 | 64 | 56 | 52 | 52 |
| Bone Archers | 16 | 48 | 42 | 39 | 33 | 30 | 30 |
| Wraiths | 21 | 105 | 90 | 85 | 75 | 70 | 65 |
| Grave Thralls | 4 | 16 | 12 | 12 | 12 | 12 | 12 |

**Attacks needed: Kingdom (rows, full squad, no losses) vs Undead Legion (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | Necromancer | Grave Guard | Skeleton Warband | Bone Archers | Wraiths | Grave Thralls |
| --- | --- | --- | --- | --- | --- | --- |
| Lord Commander | 10 (2.5 r) | 9 (2.3 r) | 6 (1.5 r) | 4 (1 r) | 5 (1.3 r) | 2 (0.5 r) |
| Shieldwall | 14 (4.7 r) | 13 (4.3 r) | 8 (2.7 r) | 6 (2 r) | 8 (2.7 r) | 3 (1 r) |
| Men-at-arms | 8 (2 r) | 8 (2 r) | 5 (1.3 r) | 4 (1 r) | 5 (1.3 r) | 2 (0.5 r) |
| Crossbows | 10 (3.3 r) | 11 (3.7 r) | 6 (2 r) | 5 (1.7 r) | 6 (2 r) | 2 (0.7 r) |
| Outriders | 8 (1.6 r) | 8 (1.6 r) | 5 (1 r) | 4 (0.8 r) | 4 (0.8 r) | 2 (0.4 r) |
| Peasants | 40 (10 r) | 34 (8.5 r) | 25 (6.3 r) | 16 (4 r) | 24 (6 r) | 7 (1.8 r) |

**Attacks needed: Undead Legion (rows, full squad, no losses) vs Kingdom (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | Lord Commander | Shieldwall | Men-at-arms | Crossbows | Outriders | Peasants |
| --- | --- | --- | --- | --- | --- | --- |
| Necromancer | 11 (2.8 r) | 11 (2.8 r) | 7 (1.8 r) | 5 (1.3 r) | 6 (1.5 r) | 2 (0.5 r) |
| Grave Guard | 12 (4 r) | 12 (4 r) | 8 (2.7 r) | 5 (1.7 r) | 6 (2 r) | 2 (0.7 r) |
| Skeleton Warband | 9 (2.3 r) | 8 (2 r) | 6 (1.5 r) | 4 (1 r) | 5 (1.3 r) | 2 (0.5 r) |
| Bone Archers | 11 (3.7 r) | 11 (3.7 r) | 7 (2.3 r) | 5 (1.7 r) | 6 (2 r) | 2 (0.7 r) |
| Wraiths | 9 (1.8 r) | 8 (1.6 r) | 5 (1 r) | 4 (0.8 r) | 5 (1 r) | 2 (0.4 r) |
| Grave Thralls | 40 (10 r) | 34 (8.5 r) | 27 (6.8 r) | 20 (5 r) | 24 (6 r) | 7 (1.8 r) |

<!-- /GEN:derived -->

---

## 10. Economy

### 10.1 Resources, income, training *(generated)*

<!-- GEN:economy -->
| Faction | Resource | Start | HQ income/rnd | Gather (AP per 1 resource) | Builder gathering a full round | Buildable |
| --- | --- | --- | --- | --- | --- | --- |
| Kingdom | Gold | 40 | 6 | farm 12, mine 10 | farm ~8, mine ~10 | barracks, tower, farm, mine, banner, wall |
| Undead Legion | Souls | 35 | 4 | well 9, hq 8 | well ~11, hq ~12 | barracks, tower, well, banner, wall |

**Training cost (resource) and time (rounds)**

| Role | Kingdom cost | Undead Legion cost | Rounds | Trained at |
| --- | --- | --- | --- | --- |
| builder | 15 | 15 | 1 | HQ |
| tank | 30 | 30 | 3 | Barracks / Ossuary |
| fighter | 24 | 18 | 2 | Barracks / Ossuary |
| ranged | 26 | 26 | 2 | Barracks / Ossuary |
| fast | 30 | 30 | 2 | Barracks / Ossuary |

Souls: every model that dies (either side) within 8" of an undead squad (alive at the end of the round), Crypt, Obelisk or Soul Well pays 2 souls (a hero: 10). Each death pays once.
<!-- /GEN:economy -->

### 10.2 Rules
- **Income** is paid at the end of every round: HQ income + income of every **finished** Farm / Mine /
  Soul Well; then × the side's `incomeMult` (1, or the AI difficulty multiplier vs AI: Easy 0.8, Hard
  1.25), rounded.
- **Kingdom (Gold):** steady. Keep 6, Farm +4 (max 4 farms, in the build zone), Mine +6 (on a resource
  site). Builders gather at Farms (1 gold per 12 AP) and Mines (1 per 10 AP).
- **Undead (Souls):** fed by death. Crypt 4, Soul Well +4 (on a resource site). Builders gather at Soul
  Wells (1 per 9 AP) and at the **Crypt** (1 per 8 AP). **Every model that dies on either side** within
  8″ of an Undead squad (alive at the end of the round), the Crypt, an Obelisk or a Soul Well pays
  **2 souls** (a hero 10). Mirror Undead matches: both sides collect from the same deaths.
- **Resource sites:** fixed points per map (§13); a site holds one Mine / Soul Well; the site belongs to
  the owner of a finished one (destroying it frees the site).
- **Gathering:** a builder working at a gather building turns each AP spent in reach into progress;
  at the end of its work action it gets `floor(progress / rate)` resource; the remainder carries over to
  the next round while it stays at the same building. At most **2 builders per building** (a third is
  turned away and goes elsewhere next round).
- **Training:** paid when ordered (round start); the squad appears next to the building at the end of
  its last training round (builder 1, fighter / ranged / fast 2, tank 3), on the first free spot
  (toward the enemy first). Squads in training count toward the army cap.
- **Army cap:** `RULES.armyCap` = 8 squads + the map's bonus (Twin Rivers / Highland +1, Great Field +2);
  builders count.

---

## 11. Buildings and builders

### 11.1 Building data *(generated)*

<!-- GEN:buildings -->
| Type | Names (Kingdom / Undead) | Cost | Work (builder AP) | Builder-rounds | HP | Site HP | Armour | Footprint | Vision | Fire (after the tiers) | Income/rnd | Special | Built by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hq` | Keep / Crypt | 0 | 0 | 0 | 220 | 66 | 8 | 4 x 4 | 10 | 3 x 4 = 12 raw, range 8" | - | soul collector; trains builder | kingdom, undead |
| `barracks` | Barracks / Ossuary | 30 | 240 | 2.4 | 150 | 45 | 8 | 3.5 x 2.5 | 6 | - | - | trains tank/fighter/ranged/fast | kingdom, undead |
| `tower` | Watchtower / Bone Spire | 25 | 200 | 2 | 110 | 33 | 6 | circle r 0.9 | 13 | 4 x 4 = 16 raw, range 11" | - | - | kingdom, undead |
| `banner` | Banner / Obelisk | 20 | 120 | 1.2 | 60 | 18 | 4 | circle r 0.55 | 6 | - | - | soul collector; +1 CP | kingdom, undead |
| `wall` | Palisade / Bone Fence | 6 | 60 | 0.6 | 80 | 24 | 6 | 3 x 0.5 | 0 | - | - | - | kingdom, undead |
| `farm` | Farm / Farm | 20 | 120 | 1.2 | 70 | 21 | 3 | 2.6 x 2.2 | 5 | - | 4 | - | kingdom |
| `mine` | Mine / Mine | 30 | 160 | 1.6 | 100 | 30 | 6 | circle r 1.1 | 7 | - | 6 | resource site only | kingdom |
| `well` | Soul Well / Soul Well | 25 | 160 | 1.6 | 90 | 27 | 5 | circle r 1.1 | 7 | - | 4 | resource site only; soul collector | undead |

Repair: builder AP x (max HP / work) HP per AP. Siege damage taken: damageAfter(raw x 2.5, armour) (no defends).
<!-- /GEN:buildings -->

### 11.2 Placement (`placeError` in `js/sim/base.js`)
- On the board (footprint at least 0.3″ inside the edge).
- **Normal buildings:** only in the side's **build zone** = its third of the table (player 0: x ≤ zone;
  player 1: x ≥ W − zone; zone = round(W / 3)); not within 1.8″ (0.6 × 3) of a resource site.
- **Mine / Soul Well:** only on a **free resource site** (within 0.6″; the UI snaps to it), anywhere on
  the table.
- Not overlapping terrain (+0.2″; not in a stream), other buildings (+0.3″) or squads (+0.1″).
- Max 2 Banners / Obelisks, max 4 Farms. The building must be in the side's faction list.

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
- Builders cost no CP; max 3 per side; trained at the HQ (1 round).

### 11.4 Gather targets (automatic)
Kingdom: Farm, Mine. Undead: Soul Well, Crypt. A builder with no orders picks: its remembered task →
an own unfinished site within 12″ → the nearest own gather building with a free slot (2 per building).

### 11.5 Barracks / training buildings
HQ trains builders; Barracks / Ossuary train tank, fighter, ranged, fast. One squad at a time each.

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
- The display fog (UI only): unexplored ground is covered in mist, explored-but-unseen ground is hazed;
  the replay only shows enemies your side saw.

---

## 13. Maps *(generated)*

<!-- GEN:maps -->
| Map | id | Size | Build zone (x <) | Army cap | HQ spots (z, player 0 at x 3.5) | Resource sites | Rivers (x: fords z/width) | Lakes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Crossing | `crossing` | 48 x 32 | 16" (player 1: x > 32) | 8 | 9, 16, 23 | 4 | 24: 7/3, 25/3 | 0 |
| Twin Rivers | `twinrivers` | 64 x 40 | 21" (player 1: x > 43) | 9 | 10, 20, 30 | 6 | 22: 9/3, 29/3; 42: 31/3, 11/3 | 0 |
| Highland Ruins | `highland` | 64 x 44 | 21" (player 1: x > 43) | 9 | 11, 22, 33 | 6 | - | 1 |
| Great Field | `greatfield` | 80 x 52 | 27" (player 1: x > 53) | 10 | 12, 26, 40 | 8 | 40: 8/3, 26/3.4, 44/3 | 2 |

#### Crossing (`crossing`, 48" x 32")

A stream with two fords, woods and ruins. Small and quick.

Terrain (full, mirrored): forest (15, 7.5) r3.2; forest (33, 24.5) r3.2; forest (20, 26) r2.6; forest (28, 6) r2.6; ruin (22, 13.4) 4.2x0.6; ruin (26, 18.6) 4.2x0.6; ruin (20.2, 15.6) 0.6x3.2; ruin (27.8, 16.4) 0.6x3.2; rock (13.5, 25) r1.2; rock (34.5, 7) r1.2; rock (27.5, 5.2) r1; rock (20.5, 26.8) r1; river x24 (w 1.6, fords z7/3 z25/3).

Resource sites: (16.5, 19.5), (31.5, 12.5), (20.5, 6.5), (27.5, 25.5). Road control points: [[0,16],[14,12],[34,20],[48,16]].

```
...........~~...........
...........~~...........
.......^...==oo.........
......^^^.$==^^.oo......
.H....^^^..==.........H.
...........~~...........
..........#~~..$........
..........#~~#..........
.H........#~~#........H.
........$..~~#..........
...........~~...........
.H.........==..^^^....H.
......oo.^^==$.^^^......
.........oo==...^.......
...........~~...........
...........~~...........
```

#### Twin Rivers (`twinrivers`, 64" x 40")

Two streams split the field in three. Hold the middle ground between them.

Terrain (full, mirrored): forest (12, 8) r3; forest (52, 32) r3; forest (16, 32) r2.8; forest (48, 8) r2.8; forest (28.5, 20) r3; forest (35.5, 20) r3; ruin (27, 9) 4.2x0.6; ruin (37, 31) 4.2x0.6; ruin (25.2, 11.2) 0.6x3.2; ruin (38.8, 28.8) 0.6x3.2; rock (18.5, 25.5) r1.1; rock (45.5, 14.5) r1.1; rock (30, 33) r1; rock (34, 7) r1; river x22 (w 1.6, fords z9/3 z29/3); river x42 (w 1.6, fords z31/3 z11/3).

Resource sites: (16.5, 16), (47.5, 24), (27, 27.5), (37, 12.5), (31, 4), (33, 36). Road control points: [[0,20],[20,14],[44,26],[64,20]].

```
..........~~........~~..........
..........~~........~~..........
..........~~...$....~~..........
.....^^...==....oo..~~.^^.......
.....^^...==###.....==.^^.......
.H........==#.......==........H.
..........~~#.....$.==o.........
..........~~........~~oo........
........$.~~........~~..........
..........~~.^^^^^^.~~..........
.H........~~.^^^^^^.~~........H.
..........~~........~~..........
........oo~~........~~.$........
.........o==.$.....#~~..........
..........==.......#==..........
.H.....^^.==.....###==...^^...H.
.......^^.~~..oo....==...^^.....
..........~~........~~..........
..........~~....$...~~..........
..........~~........~~..........
```

#### Highland Ruins (`highland`, 64" x 44")

A maze of ruins around a mountain lake. Tight paths, good cover.

Terrain (full, mirrored): forest (14, 6) r3.4; forest (50, 38) r3.4; forest (12, 37) r3.2; forest (52, 7) r3.2; forest (24, 39) r2.6; forest (40, 5) r2.6; ruin (26, 16) 0.6x5; ruin (38, 28) 0.6x5; ruin (28.5, 13.5) 5x0.6; ruin (35.5, 30.5) 5x0.6; ruin (24, 27) 4x0.6; ruin (40, 17) 4x0.6; ruin (19, 20.5) 0.6x4; ruin (45, 23.5) 0.6x4; rock (27, 31) r1.3; rock (37, 13) r1.3; rock (22, 11) r1.2; rock (42, 33) r1.2; lake (32, 22) r3.6.

Resource sites: (17, 29.5), (47, 14.5), (25, 6), (39, 38), (30, 37.5), (34, 6.5). Road control points: [[0,22],[18,30],[46,14],[64,22]].

```
................................
......^^...........^^...........
.....^^^^..........^^....^^.....
.....^^^^...$....$.^^...^^^^....
......^^.................^^.....
.H........oo..................H.
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
.H..................oo........H.
.....^^.................^^......
....^^^^...^^..$.......^^^^.....
.....^^....^^......$...^^^^.....
...........^^...........^^......
................................
```

#### Great Field (`greatfield`, 80" x 52")

A huge open battlefield with ponds, woods and a long stream. For big armies.

Terrain (full, mirrored): forest (14, 9) r3.2; forest (66, 43) r3.2; forest (24, 41) r3.6; forest (56, 11) r3.6; forest (31, 17) r2.8; forest (49, 35) r2.8; forest (11, 45) r2.6; forest (69, 7) r2.6; lake (21, 27) r2.4; lake (59, 25) r2.4; ruin (33, 32) 4x0.6; ruin (47, 20) 4x0.6; ruin (30, 6) 0.6x3.6; ruin (50, 46) 0.6x3.6; rock (18, 34) r1.2; rock (62, 18) r1.2; rock (36, 12) r1; rock (44, 40) r1; river x40 (w 1.6, fords z8/3 z26/3.4 z44/3).

Resource sites: (20, 17), (60, 35), (30, 45), (50, 7), (34, 24), (46, 28), (26, 4), (54, 48). Road control points: [[0,26],[24,16],[56,36],[80,26]].

```
...................~~...................
...................~~...................
.............$.....~~.............^.....
......^^...........==....$.......^^^....
.....^^^^..........==......^^.....^.....
......^^.........oo~~.....^^^^..........
.H...............oo~~......^^.........H.
...............^...~~...................
..........$...^^^..~~.........oo........
...............^...~~.........oo........
...................~~...................
...................~~.......~~~.........
.........~~~.....$.==.......~~~.........
.H.......~~~.......==.......~~~.......H.
.........~~~.......~~..$................
...................~~...................
........oo.........~~...^...............
........oo.........~~..^^^....$.........
...................~~...^...............
...........^^......~~oo.................
.H........^^^^.....~~oo.........^^....H.
.....^.....^^......==..........^^^^.....
....^^^........$...==...........^^......
.....^.............~~...................
...................~~......$............
...................~~...................
```

Deployment (player 0; player 1 mirrored), relative to the chosen HQ spot z: hero x 9.5, z +0; tank x 12.5, z -3; fighter x 12.5, z +3.5; ranged x 9, z -5.5; fast x 9, z +6; builder x 7, z +3.2. Each squad gets a seeded jitter of up to +-0.8" (builders none), then is nudged clear of terrain and other squads.
<!-- /GEN:maps -->

Legend for the sketches (1 character = 2″): `.` open ground, `^` forest, `#` ruin, `o` rock,
`~` water (stream or lake), `=` ford, `$` resource site, `H` possible HQ spot (left = player 0).

---

## 14. AI (`js/ai/ai.js`)

The AI sees only what its side sees (+ memory of enemies seen in the last 3 rounds, + building intel).

### 14.1 Command points and who gets orders
Each round it ranks its non-builder squads and gives direct orders to the hero (free) and the first
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
- **Skills:** Lock Shields when engaged or facing shooters in range; Shadow Step away when engaged
  below 50 % HP; Raise when a nearby squad is missing models; Rally when ≥ 2 friends are close; Heroic
  Leap at a target 1″ to 7″ away; Sweep when ≥ 2 enemies are in reach; Arrow Storm when ≥ 2 enemies
  fit under it or the target hides behind a wall; Piercing Bolt at a target in range with a clear line;
  Bone Blast at the target in range; Charge at a **slower** enemy 0.5″ – len−1 away in a clear lane.
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

### 14.6 Economy (build order, one new building per free builder per round, up to 3)
Checked in this order each round (first that applies and can be placed):
1. Enemy within 14″ of its HQ and fewer than 2 walls → Palisade / Bone Fence toward the threat.
2. Kingdom: no Farm → Farm. Undead: no Soul Well → Soul Well.
3. No Barracks → Barracks.
4. No Mine / Soul Well → one on the nearest free site.
5. Has a Barracks, no tower, round ≥ 3 → Tower toward the front.
6. Fewer than 2 Mines / Wells, round ≥ 4 → another.
7. Kingdom, fewer than 3 farms, round ≥ 4 → Farm.
8. Fewer than 2 Banners / Obelisks, round ≥ 5, resource ≥ cost + 20 → Banner.
9. Fewer than 2 towers, round ≥ 6, resource ≥ cost + 30 → Tower.

Once a Barracks is finished it keeps 24 in reserve for training (except for the Barracks itself).
Unfinished sites and buildings below 70 % HP that no builder is assigned to get the nearest free
builder. **Training:** a 2nd builder from round 2 (if resource ≥ 15 + 10); every idle Barracks trains:
fast if the enemy has ≥ 2 shooters and it has < 2 fast; else a tank if it has none; else ranged if
it has fewer ranged than fighters; else a fighter.

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
_Latest run: 2026-11-15, `node tools/balance.mjs --games 8` (8 seeds × both army orders = 16 AI-vs-AI
games per map, both AIs Normal, a game still going after 100 rounds counts as unfinished)._

| Map | Kingdom wins | Undead wins | Unfinished | Rounds (avg / median / min / max) | How games ended |
|---|---|---|---|---|---|
| Crossing | 9 (56 %) | 7 (44 %) | 0 | 18.9 / 15 / 8 / 69 | HQ destroyed 16 |
| Twin Rivers | 6 (38 %) | 10 (63 %) | 0 | 13.8 / 13 / 10 / 22 | HQ destroyed 16 |
| Highland Ruins | 9 (60 %) | 6 (40 %) | 1 | 14.9 / 13 / 10 / 26 | HQ 14, army + barracks 1, unfinished 1 |
| Great Field | 8 (53 %) | 7 (47 %) | 1 | 22.0 / 18 / 15 / 43 | HQ 15, unfinished 1 |
| **All** | **32 (52 %)** | **30 (48 %)** | **2 of 64** | | |

**What the numbers say (2026-11-15):**
- Overall the factions are even (32–30), but per map: Twin Rivers leans Undead (63 %), Highland
  Kingdom (60 %).
- **Games are short** (median 13–18 rounds) and almost always end with an HQ destroyed. Since building
  work and training were made slower, the AIs **finish only 0.3–1 Barracks per game** and train few
  squads (Undead on Twin Rivers: 0.4 soldiers per game): games are decided mostly by the **starting
  armies**. If longer, base-building games are wanted, the AI attacks too early relative to the new
  build times (waves launch from round 3, small-map assault from round 6) or the timings are too slow.
- **Builders are the most-killed squads** (2–5 builder squads lost per game per side): they walk to
  far sites and resource sites in the open.
- **Wraiths** are the top Undead damage dealers on every map (~290–300 damage per game vs Outriders
  ~140–260); Bone Archers and Crossbows next. Tanks deal the least (~20–85).
- The Undead find the enemy HQ earlier (round ~7–11) than the Kingdom (~9–13) and more often.
- Kingdom income per game is ~1.5–2× the Undead's (gold is steady), the Undead make it up with souls
  (~50–115 per game) and gathering.

<details><summary>Full report (per faction: buildings finished, squads trained, income, gathering, souls, HQ found, per unit type damage dealt / taken / models lost / squads lost)</summary>

```
Balance report 2026-11-15 · 8 seeds x 2 orders per map · AI normal · stop at round 100

## crossing: 16 games · Kingdom 9 (56% of decided) · Undead 7 (44%) · draws 0 · unfinished 0
   rounds (decided): avg 18.9, median 15, min 8, max 69 · ends: {"hq destroyed":16}
   kingdom: built/game {"farm":1.8,"barracks":0.6,"tower":0.4,"wall":1.1,"banner":0.3,"mine":0.1} · trained/game {"builder":3.4,"fighter":1,"ranged":0.5,"tank":0.4,"fast":0.1}
      income/game 225.3 · gathered/game 27.9 · souls/game 0.0 · found enemy HQ in 10/16 games, avg round 9.1
      per unit type (per game): builder dealt 0.1 taken 122.1 models lost 7.1 squads lost 3.4 trained 3.4 | fast dealt 181.9 taken 66.5 models lost 2.5 squads lost 0.8 trained 0.1 | fighter dealt 122.4 taken 114.6 models lost 5.3 squads lost 1.3 trained 1.0 | hero dealt 136.6 taken 101.8 models lost 0.6 squads lost 0.6 trained 0.0 | ranged dealt 215.1 taken 55.1 models lost 3.3 squads lost 0.6 trained 0.5 | tank dealt 53.3 taken 106.6 models lost 2.8 squads lost 0.8 trained 0.4
   undead: built/game {"well":0.9,"barracks":0.4,"tower":0.6,"wall":0.4,"banner":0.3} · trained/game {"builder":3.1,"fighter":0.7,"ranged":0.3,"fast":0.4,"tank":0.3}
      income/game 130.8 · gathered/game 10.9 · souls/game 87.6 · found enemy HQ in 16/16 games, avg round 6.9
      per unit type (per game): builder dealt 0.0 taken 112.6 models lost 6.4 squads lost 3.1 trained 3.1 | fast dealt 304.3 taken 69.9 models lost 2.6 squads lost 0.7 trained 0.4 | fighter dealt 107.9 taken 103.5 models lost 6.3 squads lost 1.0 trained 0.7 | hero dealt 140.2 taken 88.6 models lost 0.6 squads lost 0.6 trained 0.0 | ranged dealt 246.7 taken 31.4 models lost 1.8 squads lost 0.4 trained 0.3 | tank dealt 85.9 taken 93.8 models lost 2.5 squads lost 0.6 trained 0.3

## twinrivers: 16 games · Kingdom 6 (38% of decided) · Undead 10 (63%) · draws 0 · unfinished 0
   rounds (decided): avg 13.8, median 13, min 10, max 22 · ends: {"hq destroyed":16}
   kingdom: built/game {"farm":1.6,"barracks":0.7,"tower":0.4,"wall":0.8} · trained/game {"builder":2.6,"fighter":0.8,"ranged":0.4}
      income/game 147.0 · gathered/game 20.1 · souls/game 0.0 · found enemy HQ in 15/16 games, avg round 9.1
      per unit type (per game): builder dealt 0.0 taken 91.3 models lost 5.1 squads lost 2.4 trained 2.6 | fast dealt 141.8 taken 52.4 models lost 1.9 squads lost 0.6 trained 0.0 | fighter dealt 100.1 taken 63.3 models lost 2.8 squads lost 0.6 trained 0.8 | hero dealt 127.1 taken 38.1 models lost 0.1 squads lost 0.1 trained 0.0 | ranged dealt 106.9 taken 42.3 models lost 2.3 squads lost 0.4 trained 0.4 | tank dealt 19.7 taken 23.1 models lost 0.5 squads lost 0.1 trained 0.0
   undead: built/game {"well":1,"barracks":0.3,"wall":0.2} · trained/game {"builder":2.8,"fighter":0.2,"ranged":0.1,"fast":0.1}
      income/game 92.3 · gathered/game 7.8 · souls/game 53.4 · found enemy HQ in 16/16 games, avg round 8.0
      per unit type (per game): builder dealt 0.0 taken 104.9 models lost 5.9 squads lost 2.9 trained 2.8 | fast dealt 288.1 taken 50.9 models lost 1.4 squads lost 0.2 trained 0.1 | fighter dealt 57.3 taken 72.9 models lost 4.2 squads lost 0.7 trained 0.2 | hero dealt 96.3 taken 54.3 models lost 0.3 squads lost 0.3 trained 0.0 | ranged dealt 84.2 taken 25.6 models lost 1.3 squads lost 0.3 trained 0.1 | tank dealt 38.8 taken 55.6 models lost 1.4 squads lost 0.3 trained 0.0

## highland: 16 games · Kingdom 9 (60% of decided) · Undead 6 (40%) · draws 0 · unfinished 1
   rounds (decided): avg 14.9, median 13, min 10, max 26 · ends: {"hq destroyed":14,"army and barracks gone":1,"unfinished":1}
   kingdom: built/game {"farm":2,"barracks":0.8,"tower":0.8,"wall":0.7,"mine":0.3,"banner":0.3} · trained/game {"builder":2.1,"fighter":2.2,"ranged":1.2,"tank":0.4,"fast":0.1}
      income/game 332.4 · gathered/game 95.5 · souls/game 0.0 · found enemy HQ in 14/16 games, avg round 10.7
      per unit type (per game): builder dealt 0.0 taken 76.6 models lost 4.3 squads lost 2.0 trained 2.1 | fast dealt 256.4 taken 62.8 models lost 2.3 squads lost 0.6 trained 0.1 | fighter dealt 158.1 taken 166.4 models lost 7.8 squads lost 1.7 trained 2.2 | hero dealt 134.0 taken 64.5 models lost 0.4 squads lost 0.4 trained 0.0 | ranged dealt 153.6 taken 87.8 models lost 5.4 squads lost 1.3 trained 1.2 | tank dealt 42.6 taken 90.0 models lost 2.4 squads lost 0.7 trained 0.4
   undead: built/game {"well":0.8,"wall":0.8,"barracks":0.6,"tower":0.3,"banner":0.2} · trained/game {"builder":2.5,"fighter":1.1,"tank":0.3,"fast":0.5,"ranged":0.5}
      income/game 130.8 · gathered/game 56.1 · souls/game 91.5 · found enemy HQ in 13/16 games, avg round 7.8
      per unit type (per game): builder dealt 0.0 taken 70.1 models lost 4.0 squads lost 1.9 trained 2.5 | fast dealt 302.5 taken 85.2 models lost 3.1 squads lost 0.9 trained 0.5 | fighter dealt 133.3 taken 139.8 models lost 8.4 squads lost 1.5 trained 1.1 | hero dealt 134.9 taken 67.4 models lost 0.3 squads lost 0.3 trained 0.0 | ranged dealt 120.5 taken 61.2 models lost 3.4 squads lost 0.8 trained 0.5 | tank dealt 82.4 taken 88.1 models lost 2.3 squads lost 0.6 trained 0.3

## greatfield: 16 games · Kingdom 8 (53% of decided) · Undead 7 (47%) · draws 0 · unfinished 1
   rounds (decided): avg 22.0, median 18, min 15, max 43 · ends: {"hq destroyed":15,"unfinished":1}
   kingdom: built/game {"farm":2.1,"barracks":1,"tower":0.7,"wall":0.4,"mine":0.4,"banner":0.3} · trained/game {"builder":4.8,"fighter":2.9,"ranged":1.8,"tank":0.6,"fast":1.2}
      income/game 422.5 · gathered/game 64.4 · souls/game 0.0 · found enemy HQ in 14/16 games, avg round 12.7
      per unit type (per game): builder dealt 0.1 taken 165.1 models lost 9.7 squads lost 4.8 trained 4.8 | fast dealt 161.9 taken 124.4 models lost 4.7 squads lost 1.5 trained 1.2 | fighter dealt 156.7 taken 199.9 models lost 9.1 squads lost 2.1 trained 2.9 | hero dealt 194.7 taken 56.4 models lost 0.3 squads lost 0.3 trained 0.0 | ranged dealt 191.1 taken 93.2 models lost 5.6 squads lost 1.3 trained 1.8 | tank dealt 26.8 taken 92.6 models lost 2.4 squads lost 0.7 trained 0.6
   undead: built/game {"well":1.1,"barracks":0.6,"banner":0.3,"tower":0.3,"wall":0.1} · trained/game {"builder":3.5,"tank":0.6,"fighter":2.1,"ranged":1,"fast":0.3}
      income/game 200.3 · gathered/game 92.8 · souls/game 115.0 · found enemy HQ in 15/16 games, avg round 11.3
      per unit type (per game): builder dealt 0.0 taken 116.6 models lost 6.6 squads lost 3.2 trained 3.5 | fast dealt 298.2 taken 65.6 models lost 2.3 squads lost 0.6 trained 0.3 | fighter dealt 253.9 taken 168.3 models lost 9.9 squads lost 1.6 trained 2.1 | hero dealt 187.3 taken 63.8 models lost 0.4 squads lost 0.4 trained 0.0 | ranged dealt 337.9 taken 75.2 models lost 4.3 squads lost 0.9 trained 1.0 | tank dealt 43.3 taken 91.7 models lost 2.5 squads lost 0.8 trained 0.6
```
</details>
<!-- /BALANCE -->

### Known issues and open questions
- Two equal AIs can stall in a siege (each rebuilds at its barracks as fast as it loses squads; HQ and
  towers help the defender; builders repair the HQ between waves). Longer build / training times
  (2026-11-14) made this much rarer.
- The AI sometimes never scouts the enemy HQ on the big maps (fast squads die before they get there).
- Twin Rivers favours the Undead (63 %), Highland the Kingdom (60 %) in the latest run.
- Wraiths (ghost, tier 6, charge) deal the most damage per game of any Undead unit in AI games.
- Builders are the most-killed squads in AI games (they walk to far sites in the open).
- With the slower build / training times the AI rarely finishes a Barracks before the game is decided:
  check the AI's attack timing against the build times when balancing the economy.

---

## 17. Tuning guide (where each number lives)

| What | Where | Effect / notes |
|---|---|---|
| Unit stats (models, HP, armour, tier, vision, defends, attack, skills, parry, ghost) | `js/data/units.js` → `FACTIONS.<faction>.units.<role>` | attack helpers `SWING(ap, dmg, reach)`, `VOLLEY(ap, dmg, range, width)`; skills `CHARGE(ap, dmg, len, cd)`, `BLAST(ap, dmg, range, radius, cd)`, `STORM(...)`, `RALLY(ap, radius, cd)`, `SWEEP(ap, dmg, reach, cd)`, `LEAP(ap, range, cd)`, `STEP(ap, range, cd)`, `WALL(name, ap, cd)`, `PIERCE(ap, dmg, range, width, cd)`, `RAISE(ap, radius, cd)` |
| Global combat rules | `RULES` in `js/data/units.js` (table in §7 of the generated rules below) | armour constant, defend / cover / siege multipliers, engagement, parry, overwatch |
| Economy per faction | `FACTIONS.<f>.eco` (`start`, `hq`, `gather`), `FACTIONS.<f>.train` (costs), `FACTIONS.<f>.buildings` (build list) | |
| Buildings | `BUILDINGS` in `js/data/units.js` | cost, work, hp, armour, footprint, vision, fire, income, cp, site, souls, trains |
| Training time, caps, souls, sites, work reach | `RULES.trainRounds`, `armyCap`, `maxBuilders`, `gatherSlots`, `maxBannerCp`, `maxFarms`, `soulRange`, `soulPerModel`, `soulPerHero`, `siteHp`, `workReach` | |
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
| `siegeMult` | `2.5` | damage x this against buildings |
| `shrineRadius` | `3` | ring drawn around resource sites (visual + placement keep-out x 0.6) |
| `armyCap` | `8` | base squad cap (builders count; maps add capBonus) |
| `maxBuilders` | `3` | builder squads per side |
| `gatherSlots` | `2` | builders that can gather at one building |
| `buildZone` | `16` | default build zone (each map: round(width / 3)) |
| `maxBannerCp` | `2` | max banners / obelisks (and max bonus CP) |
| `maxFarms` | `4` | max farms |
| `trainRounds` | `{"builder":1,"fighter":2,"ranged":2,"fast":2,"tank":3}` | rounds each role takes to train |
| `siteHp` | `0.3` | share of max HP a new site starts with |
| `workReach` | `1` | inches between builder edge and footprint to work |
| `soulRange` | `8` | deaths within this of an undead collector pay souls |
| `soulPerModel` | `2` | souls per model that dies |
| `soulPerHero` | `10` | souls when a hero dies |
| `planningTimerSec` | `120` | (unused in V4; online timer is chosen in the lobby) |
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
| 2026-11 (M1–M2) | V4 core: squads, tiers, skillshots, engagement, parry, overwatch, cover, cooldowns. HP tuning for Lord vs Necromancer, Grave Guard, Bone Archers | 40 mirrored games roughly even |
| 2026-11 (M3) | Bases: HQ 220 HP / armour 8, siege ×2.5, shrine income, towers; round limit 30 | Kingdom 26 / Undead 14 of 40; 24 of 40 reached the limit |
| 2026-11-13 (M3c) | Faction economies: Kingdom gold (Keep, Farms, Mines), Undead souls (Crypt, Soul Wells, deaths ×2 within 8″); builders; real fog; HQ at 1 of 3 seeded spots | iterated Keep income 6 → 8 → 7: Kingdom 34 / Undead 26 of 60 |
| 2026-11-13 (M3d) | Builders gather (Kingdom farm 12 / mine 10 AP per gold; Undead well 9 / crypt 8 AP per soul, 2 per building); Keep income 7 → 6; round-limit tiebreak counts squads and HQ only | 30 / 30 of 60 |
| 2026-11-13 | **No round limit.** Movement: friendly pass-through, contact stop, sidesteps, re-pathing, no deploys inside rocks; Advance marches on the known HQ / searches HQ spots | stuck moves 18 % → 5 %; 25 of 30 games finish within 80 rounds |
| 2026-11-14 (M5) | Four maps (Crossing 48×32, Twin Rivers 64×40, Highland 64×44, Great Field 80×52; army cap +1/+1/+2); lakes; AI difficulty (income ×0.8 / ×1.25, CP ±1) | big maps stalled often (Twin Rivers 6 of 8 unfinished) |
| 2026-11-14 | AI waves on maps ≥ 60″ wide (rally, launch at 60 %, fall back at 40 % / forward rally after 10 rounds, shooters siege the HQ) | unfinished per 8: Twin Rivers 6 → 1, Highland 5 → 2, Great Field ~3 → 2 |
| 2026-11-14 | **Building work ×2** (wall 60, farm / banner 120, mine / well 160, tower 200, barracks 240); **training 1–3 rounds** (builder 1, fighter / ranged / fast 2, tank 3) | games end far more often: 0–1 of 8 unfinished per map; Twin Rivers 16/16 in 11–23 rounds (Undead 10, Kingdom 6) |
| 2026-11-15 | This document, `tools/balance.mjs`, `tools/gendoc.mjs` | see §16 |

---

## 19. Keeping this document up to date

Whenever rules, numbers, the AI or maps change:
1. Run `npm run doc` (regenerates every `GEN` table from the data files).
2. Update the prose sections that describe the changed behaviour (§2–§6, §10–§15).
3. For balance-relevant changes, run `node tools/balance.mjs --games 8`, paste the summary into §16,
   and add a row to §18 with the before / after numbers.
