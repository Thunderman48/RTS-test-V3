# Working on Rovina

## The game reference doc must stay complete and current
`docs/GAME.md` is the single source for understanding and balancing the game (the owner balances the
game from it in other sessions). **After every change to rules, numbers, units, skills, buildings,
economy, maps, fog, stances or the AI:**
1. Run `npm run doc` (`node tools/gendoc.mjs`): regenerates every `<!-- GEN:... -->` table from
   `js/data/*.js`. Never hand-edit inside those markers.
2. Update the prose sections that describe the changed behaviour (exact formulas, thresholds, order
   of operations), with the same level of detail as the rest of the doc.
3. For anything that can change balance: run `node tools/balance.mjs --games 8` (or at least
   `--games 3`), replace the §16 "Balance status" summary and full report, and add a row to the §18
   change log with the date and before / after numbers.
4. Add new tunables to the §17 tuning guide (where the number lives, what it affects).

## Commands
- `node tests/sim.test.mjs` — simulation tests (must pass).
- `node tools/balance.mjs --games 8 [--maps a,b] [--level easy|normal|hard] [--rounds 100] [--json]`
- `python3 -m http.server 8080` then open http://localhost:8080/ (`?nettest` for two-tab online tests).

## Layout
- `js/data/units.js` (all unit / building / economy numbers, `RULES`), `js/data/maps.js` (maps).
- `js/sim/` deterministic rules (resolve, orders, stances, base, builders, vision, nav); `js/ai/ai.js`.
- `js/render/`, `js/ui/`, `js/net/`, `js/audio/`: presentation, UI, online, sound.
