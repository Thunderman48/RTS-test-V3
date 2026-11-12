# TIERS: Turn-Based RTS prototype

A playable prototype of the **Turn-Based RTS (Design Doc V3)**. It combines RTS economy and base building with tabletop-style combat. Both players plan at the same time, then speed tiers act from fastest to slowest.

* **Top-down 3D low-poly** (Three.js) in a black & white geometric style: white pieces vs black pieces.
* **Solo vs AI** and **online multiplayer** (room code, peer-to-peer).
* **Works on phones**: tap to select and order, drag to pan, pinch to zoom, twist to rotate.
* **Static site** with no build step and no server, so it runs on GitHub Pages.

**V4 preview (in progress):** a full remake as a tabletop miniatures wargame lives at [`v4/`](v4/) (`…/RTS-test-V3/v4/`). Milestone 1 is playable vs the AI:
* Faceted, painted low-poly miniatures on thick team-coloured bases, in squads of 3–5 on a diorama table: Kingdom vs Undead Legion. They wind up, swing, thrust, shoot and topple over when they fall. A painted-miniature shader (edge highlights, washes, cool shadows) and a faceted low-poly diorama board, plus an optional tilt-shift "Miniature lens" (menu). `v4/?gallery` shows every mini (`?gallery=anim` animates them).
* Free movement in inches: drag a path from a squad; the tape shows inches and AP, and a ring shows the reach left.
* Every attack is a drag-aimed skillshot (Swing arc, Volley line). It hits whatever stands in the shape when it lands, so faster tiers can dodge.
* Damage removes models, and a squad hits for damage per model × models left.
* The battle plays back on a scrubbable timeline with a combat log.
* Tests: `node v4/tests/sim.test.mjs`.

**Versions:** this is **V3**. Earlier versions stay playable: [`v1/`](v1/) at `…/RTS-test-V3/v1/` and [`v2/`](v2/) at `…/RTS-test-V3/v2/`.

### What changed in V3.2: icons everywhere
One coloured icon set (`js/ui/iconset.js`) is used across the whole game, in the same colours as the effects:
* **Top bar:** supply with income per round, CP with filled/empty pips, army size / cap, round, timer, goal. The supply counter flashes when you can't afford something.
* **Buttons and panels:**
  * Every action, skill, prepare, stance, Control/Release, build and production button has an icon.
  * Costs show as AP / supply / CP / rounds icons.
  * Unit cards have an icon stat row: HP, AP, tier, speed, defends, range, vision.
  * Skills show as chips with cooldowns.
  * Order-bar blocks have icons.
  * Production queues show progress.
* **Map:**
  * Building plates show what each building is doing: construction, production progress, income, +CP, range, cover.
  * Resource nodes have a `+4` badge in the owner's colour.
  * Planned orders get icon chips (move, attack, shoot, skill spots, advance/hold points).
  * Revive zones show progress, and last-seen enemies get an eye marker.
  * `+8` income pops up over your HQ and nodes after each round; `−40` pops up when you spend.
* **Logs:** every feed, tier-card, report and digest line starts with its event icon. The digest's tiles and base summary use icons too.
* Help has an **Icons** legend, glossary popovers show the term's icon, and the tutorial text uses them.

### What changed in V3.1
* **Attacks don't waste AP anymore.**
  * The first time you attack an enemy, the unit gets enough approach AP to reach it, plus a margin in case it steps away. A second attack on the same target gets only a small top-up.
  * If the enemy is too far to reach this round, the order becomes a move toward it ("in reach in ~N rounds").
  * **Rule change:** when a hit lands before the approach AP is used up, the leftover AP goes to the unit's next action ("+N AP back").
* **Building on touch.** Pick a building and a ghost appears on a good spot near your HQ. **Drag** it, or tap the map, to move it. It turns **green** when the spot is OK and **red** with the reason when it isn't. Press **Confirm** to place it.
* **Colour-coded effects** (UI stays black & white):
  * damage: orange
  * defend: blue shield dome + "BLOCKED N"
  * parry: gold burst, plus a counter-slash
  * overwatch: red tracer + eye
  * control zones: purple rings, "SLOWED", zone break
  * tier up / Rally / AP returned: lime
  * dash: cyan
  * sweep: magenta
  * disrupt: violet lightning
  * fortify: steel
  * shove / turrets / construction: amber
  * heal: green
  * miss / cancel: grey

  Help → *Colours & icons* has the full key.
* **Status icons** above each unit show what it has ready this round: defends ×N, parry, overwatch ×N, fortify, rallied / tier up, slowed. During the round they tick down as each one is used.

### What changed in V3: easy to understand and control
V3 is built around three questions: *What will my units do? What just happened, and why? What should I do next?*
* **Guided tutorial (~5 min).** It's on the menu and is offered the first time you play vs AI. A coach card gives one instruction at a time, highlights what to tap, and blocks anything else. You fight a small scripted skirmish: select, stance, Control, attack, Defend +1, turn order, Ready, step through the round, read the report, use the hero, destroy an Outpost.
* **Step-by-step rounds:**
  * Each tier plays, then stops on a card that says in words what happened.
  * Buttons: **Next step**, **Replay step**, **Auto** (no stopping), **Skip**.
  * The camera frames the units acting in that tier, and arrows show who they attack.
  * A timeline at the bottom shows every acting unit's actions over time.
  * Dying units fall over and leave an ✕.
* **"What happened" card after every round:**
  * For each of your units: HP before → after, what it did, kills, and **why an order failed** (e.g. "target out of reach, needed ~82 AP, had 75").
  * It also summarises the enemy and your base.
  * Damage (−N) and failed-order (⊘) chips stay on the map while you plan.
* **Planning that explains itself:**
  * Turn order reads 1st / 2nd / 3rd.
  * Each unit card says when it acts and who acts with it, and has a "Last round" line.
  * The order bar shows unused AP in red, and disabled buttons say why.
  * In Attack mode, enemies are tagged ✓ in reach / ✕ N rounds.
  * Pressing READY warns about wasted AP.
  * Every key term has a tap-to-explain ⓘ.
  * A goal compass points at the enemy HQ.
* **Less clutter:**
  * Name plates show tier, name and HP.
  * Zones and plan lines show for the selection only; ◎ shows everything.
  * On phones, the panel shrinks to one line while you aim.

### What changed in V2
* **Commander is a hero.** It is always free to control and has **3 skills**, each with its own cooldown:
  * **Disrupt**: drains 25 AP from the end of an enemy's plan and lowers its tier by 1. Range 6.
  * **Sweep**: hits every enemy within 1.9. Cannot be parried.
  * **Rally**: the commander and allies within 5 act one tier earlier this round. Paid during planning.
* The commander's extra CP is gone. **Base CP is 3** (+1 per Command Post), and 1 CP = direct control of one unit for the round.
* **Stance changes are free.**
* **Stance first, then Control.** Tapping a unit shows its stance card: what it will do on its own this round, plus free stance buttons. The full command screen opens only after you press **Control**. **Release** gives the CP back.
* **Readability:**
  * Every unit and building has a name plate with its tier, name, HP and defends. White and black bases under units show the team.
  * During resolution, units acting right now get an orange ring and everyone else is dimmed. The tier banner names who is acting, and Move/Attack/Shoot tags pop over units.
  * A live feed explains each hit, parry, skill and death in words.
  * After each round you get a summary (damage dealt/taken, kills, losses) and a full **Report** (≣ in the top bar).

## Play it on GitHub Pages

1. In the repo, open **Settings → Pages**.
2. Under **Build and deployment**, set *Source* to **Deploy from a branch**. Pick the branch (`main` after merging, or `claude/bold-brown-o46yid`) and the **/ (root)** folder, then save.
3. After a minute the game is live at `https://thunderman48.github.io/RTS-test-V3/`.

Local play: run `python3 -m http.server 8080` in the repo, then open <http://localhost:8080>. ES modules need a server, so opening the file directly won't work.

## Online multiplayer

One player presses **Host online game** and shares the 5-letter code. The other player enters it and presses **Join**. The two browsers connect directly over WebRTC. The free public PeerJS broker is used only to introduce them. The host is white and runs the authoritative simulation. The guest is black and replays the same deterministic resolution locally for its animation.

Some very strict networks (certain school or corporate Wi-Fi) block peer-to-peer connections. In that case try mobile data.

## How a round works

1. **Planning.** Both players plan at once and press **Ready**. In multiplayer, a 90 s timer is a safety net. When it runs out, the orders given so far count and every other unit follows its stance.
2. **Resolution.** Tiers act from 8 down to 1, and **buildings act last**. Inside a tier, every unit from both sides acts at the same time on a shared timeline, where an action's AP cost is also its duration. Playback can be run at 1×/2×/4× or skipped, and the last round can be replayed (↺).
3. **Economy tick.** Income, construction and production each advance one step.

## What's implemented from the design doc

| Area | Status |
|---|---|
| Simultaneous planning, Ready button, MP timer, pause in solo only | ✅ |
| Speed tiers 4/5/6, fixed AP, tier upgrades 15 + 25 AP (turn order only, up to tier 8) | ✅ |
| Shared timeline inside a tier; AP cost = duration; exact ties both happen | ✅ |
| Hit check at the moment of the attack; interrupts (parry counters, overwatch) resolve immediately | ✅ |
| Free movement with AP per distance, pathing around walls/buildings, stop on contact | ✅ |
| Move to place / follow unit, attack unit (follows target, retargets to closest reachable enemy, else cancelled) | ✅ |
| Control zones (slow enemies inside, last until owner moves/acts/is pushed, no stacking) | ✅ |
| Defends (free per unit + bought with AP; strongest simultaneous hit uses defend first) | ✅ |
| Parry, overwatch, shot blocking (first enemy / walls), place shots pass over, cover buildings | ✅ |
| Health lowers AP from next round | ✅ |
| AP drain & tier debuffs (remove actions from end of plan; tier now or next round) | ✅ (Commander *Disrupt*) |
| 4 roles + hero commander with skills and per-skill cooldowns; enemy cooldowns revealed once used | ✅ |
| Commander: always free to order, revive zone (hold it for 3 rounds) | ✅ |
| Stances: Guard, Hold, Hold ground, Retreat (+ **Advance**, see below); stance plans previewed | ✅ |
| CP: direct control 1 CP/unit (commander free), stance changes free, production boost 1 CP | ✅ (V2 rules) |
| Fog of war, last-known markers, last round's enemy movement trails, enemy base tier/stance shown | ✅ |
| Buildings act last, turrets shoot closest enemy, spawning at round end, outposts as retreat points | ✅ |
| Economy on the round clock, construction/production over rounds, healing (out of combat, near base, paid) | ✅ |
| Win by destroying the enemy HQ; round limit as stalemate protection | ✅ |

### Decisions made for the prototype (doc left these open)

* **Base AP 100.** All other AP costs are scaled to it.
* **Economy:** one resource, *Supply*. The HQ gives +8/round and each captured resource node gives +4/round. A node is captured when only one side has units near it at round end. There are no workers.
* **Advance stance** (the doc says "more stances, such as advancing toward a point, are still to be designed"). The unit walks toward a chosen point and fights enemies it meets on the way.
* **Skills:** Assassin *Dash*, Fighter *Parry* + *Shove* (push), Ranged *Frag* (place-targeted AoE, hits allies, unparryable), Tank *Fortify* (+defends, +armor). Commander *Disrupt* (AP drain + tier −1), *Sweep* (area melee) and *Rally* (+1 tier to nearby allies).
* **Defend formula:** `damage × 20/(20+armor) × (defended ? clamp(0.2, 0.75, 0.4 + (damage − armor)/80) : 1)`.
* **Shots:** ranged basic attacks are line shots aimed at a place (blocked by the first enemy or wall). Frags are place shots that pass over everything.
* **Match size:** small map (48×32), aimed at roughly 15–25 minute matches. The round limit is 80, after which the side with the most building HP wins.
* **Defender bonus** (comeback tool): +1 free defend within 8 of your own HQ. Healing is faster near your base.
* **Army cap:** 16 units, not counting the commander.

### Not in this prototype yet

Factions, healer units, squads, multi-HQ modes, the "held decisions" retargeting variants, a front-facing shield, and in-depth economy (workers, multiple resources). Fog of war is enforced by each client, so it is not cheat-proof.

## All numbers live in one file

Every tunable value is in [`js/config.js`](js/config.js): AP, tier costs, wound penalties, movement, zones, defends, parry, overwatch, CP, economy, unit stats, building stats and stance ranges. Edit it and reload.

| Unit | Tier | HP | Armor | Free defends | Basic attack | Skill (cooldown) |
|---|---|---|---|---|---|---|
| Commander ◆ (hero) | 5 | 150 | 9 | 2 | 18 dmg / 25 AP | Disrupt (3), Sweep (2), Rally (4) |
| Fighter ■ | 5 | 90 | 8 | 1 | 16 dmg / 25 AP | Shove (2), Parry |
| Assassin ▲ | 6 | 60 | 4 | 1 | 24 dmg / 20 AP | Dash (2) |
| Ranged ● | 5 | 60 | 3 | 1 | 14 dmg / 30 AP, range 10 | Frag (3), Overwatch |
| Tank ⬣ | 4 | 140 | 12 | 2 | 12 dmg / 30 AP | Fortify (3) |

Other key costs: extra defend 20 AP · parry 20 AP · overwatch charge 35 AP · base CP 3 (+1 per Command Post; commander always free) · start supply 50.

## Controls

| | Touch | Desktop |
|---|---|---|
| Select unit / building (shows its stance) | tap | click |
| Take direct control | **Control** button | **Control** button |
| Move a controlled unit | tap ground | click ground |
| Attack / shoot with a controlled unit | tap enemy | click enemy |
| Add to selection | **Multi** button or long-press | **Multi** button |
| Pan / zoom / rotate | drag / pinch / two-finger twist | drag / wheel / right-drag, `WASD` `Q` `E` |
| Ready / skip playback | **READY** / **Skip** | `Space` |
| Cancel / undo | panel buttons | `Esc` / `Backspace` |

The unit panel has Move (with an AP slider and a reach circle), Attack/Shoot, the unit's skill, Wait, Defend+, Tier+, Parry/Overwatch, Stance, Heal, Undo and Clear. Select an HQ or Barracks to train units. Use **Build** to place buildings.

## Code layout

```
index.html, css/style.css     UI shell (black & white, responsive, safe-area aware)
js/config.js                  all tunable numbers
js/sim/                       pure simulation (no DOM): state, map, nav (A*), orders/CP, stances,
                              resolve (tier timeline, combat, interrupts), economy
js/ai/ai.js                   AI opponent (same orders API and rules as a player)
js/render/                    Three.js scene, models, playback of the resolution log, effects
js/ui/                        input (mouse + touch), planner (draft orders), HUD, help, glossary, iconset,
                              log (feed, tier cards, round digest)
js/tutorial/                  tutorial scenario (scripted enemy) and coach steps
v1/, v2/                      saved earlier versions (playable at /v1/ and /v2/)
js/net/net.js                 PeerJS host/join + message queue
vendor/                       three.js r160 and PeerJS 1.5.4 (MIT), bundled so Pages needs no CDN
tests/sim.test.mjs            headless rule tests (node tests/sim.test.mjs)
```

## Tests

```
node tests/sim.test.mjs
```

There are 29 tests. They cover the early-hit AP return, automatic approach AP and too-far moves, the new effect events, the round digest and the tutorial scenario, the commander's skills, free control and free stance changes, tier order and upgrades, AP-as-duration, exact ties, control zones, dash cancellation, parry and counters, overwatch, shot blocking and frags over walls, defend ordering, AP drain and tier debuff, wounds, CP limits, production timing, the win condition, a full AI-vs-AI match, and determinism (host and guest compute identical results).
