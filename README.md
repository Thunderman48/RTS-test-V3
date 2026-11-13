# TIERS: tabletop battles

A turn-based strategy game played like a miniatures wargame: two armies of low-poly painted
minis on a games table, simultaneous orders, and speed tiers that decide who acts first.
It is a static site with no build step and no server, so it runs on GitHub Pages.

* **Kingdom vs Undead Legion.** Each side has a hero with three skills, tanks, fighters,
  shooters, fast squads and builders. Every attack is an aimed skillshot that hits whatever is
  in its shape when it lands, so faster tiers can dodge.
* **Two economies.** The Kingdom earns **gold** from its Keep, farms and mines. The Undead earn
  **souls** from the Crypt and soul wells, and from every model that dies near them. **Builders**
  put up every building, finish over several rounds on their own, and gather resources when idle.
* **Fog of war.** Low-poly mist covers what you have never seen and a haze covers what you can't
  see right now. The enemy HQ starts at one of three spots, so you have to scout. Destroy it to win.
* **Play vs the AI or online.** Online play uses a room code and connects peer to peer: both
  players pick an army (mirror matches are allowed), and the host picks a planning timer.
* Scrubbable battle replay with a combat log, help with tabs and an icon legend, and generated
  sound effects.

## Versions
* **V4** (this one) is at the site root.
* Older versions stay playable: [`v3/`](v3/), [`v2/`](v2/) and [`v1/`](v1/). `v4/` redirects here.

## Running
```
python3 -m http.server 8080      # then open http://localhost:8080/
node tests/sim.test.mjs          # V4 simulation tests
node v3/tests/sim.test.mjs       # V3 tests
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
* Every tunable number lives in `js/data/units.js`.

## To do
* Phone and tablet layout pass: dock size, crowded nameplates, and the builder panel covering
  half the screen on phones.
