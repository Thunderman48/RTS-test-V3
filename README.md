# Rovina: tabletop battles

A turn-based strategy game played like a miniatures wargame: two armies of low-poly painted
minis on a games table, simultaneous orders, and speed tiers that decide who acts first.
It is a static site with no build step and no server, so it runs on GitHub Pages.

* **Two very different armies.** The **Kingdom** is a sturdy all-rounder for beginners: peasants
  build everything and farm big fields for a strong late economy, and its hero, The Chosen, leaps,
  rallies and stuns with a Mighty Swing. The **Undead Legion** is a cheap, never-ending horde: a
  skeleton swarm trained two squads at a time, no builders (its buildings rise out of the ground and
  spread graveyards that turn the ground into dark blight), a death economy (souls from everything
  that dies on its graves; cheap skeletons pay back more than they cost), and a slow Lich mage who
  spends mana on summoned skeletons, chain lightning and corpse explosions, backed by Necromancer
  caster squads and Monoliths that push graves forward and heal.
* Small starting armies (a hero and a squad or two); the rest comes from your base.
* A fallen hero lies where it fell; hold that spot to revive it. Squads use their skills on their
  own (switchable per squad). Build anywhere you have seen; the Undead only on their graves, which
  spread almost at once around their buildings (like blight or creep), except the Monolith, which a
  Lich or Necromancers raise anywhere near them. Forests are big woodland with soft edges.
* Every attack is an aimed skillshot that hits whatever is in its shape when it lands, so faster
  tiers can dodge. Armies grow up to 30 squads (more on big maps).
* **Two economies.** The Kingdom earns **gold** from its Keep, mines and farms worked by up to 4
  peasants each. The Undead earn **souls** mainly from every model that dies on their graveyards;
  the Crypt (1) and Soul Wells (2) only trickle.
* **Production queues.** Queue up to 5 buildings for your base (free builders take the next one) and up
  to 5 squads at each HQ / Barracks. Everything is paid when it starts, and the **Production** bar above
  your squad cards shows every queue: tap to cancel, drag to reorder.
* **Fog of war.** Low-poly mist covers what you have never seen and a haze covers what you can't
  see right now. The enemy HQ starts at one of three spots, so you have to scout. Destroy it to win.
* **Four battlefields:** Crossing (48″×32″, small and quick), Twin Rivers (64×40), Highland Ruins
  (64×44, a ruin maze around a lake) and Great Field (80×52, for big armies). Pick one on the
  **Battle setup** screen, along with your army and the AI's strength (Easy / Normal / Hard). Online,
  the host picks the map.
* **Settings** (⚙ on the start screen, or in the in-game ≡ menu): graphics quality, miniature
  lens, mini animation, fog mist, sound and volume, default replay speed, nameplates, ask before
  Ready, pan and zoom speed, inverted zoom, Q / E rotation and a camera reset.
* **Play vs the AI or online.** Online play uses a room code and connects peer to peer: both
  players pick an army (mirror matches are allowed), and the host picks a planning timer.
* Scrubbable battle replay with a combat log, help with tabs and an icon legend, and generated
  sound effects.

## Game reference and balancing
* **[`docs/GAME.md`](docs/GAME.md)**: every rule, formula and number, the AI's behaviour, the maps,
  the latest balance report and a change log. Its tables are generated from the data files
  (`npm run doc`); `npm run balance` runs the AI-vs-AI balance report (`tools/balance.mjs`).

## Running
```
python3 -m http.server 8080      # then open http://localhost:8080/
node tests/sim.test.mjs          # simulation tests
```
* `?gallery` shows every miniature and `?gallery&build` every building.
* `?nettest` swaps the online transport for a BroadcastChannel, so two tabs of one browser can
  play each other offline.

## Code
* `js/sim/`: the deterministic rules (resolve, orders, stances, base and economy, builders, vision).
* `js/ai/`: the AI opponent.
* `js/render/`: the table, minis, buildings, fog and effects (three.js).
* `js/ui/`: the planner, base and builder UI, online lobby, icons and fog map.
* `js/net/`: the PeerJS transport.
* `js/audio/`: generated sound effects.
* Every tunable number lives in `js/data/units.js`; the maps in `js/data/maps.js`.

## To do
* Upgrades (planned): first, Skeleton Warbands trained in threes instead of pairs.
* Phone and tablet layout pass: dock size, crowded nameplates, and the builder panel covering
  half the screen on phones.
