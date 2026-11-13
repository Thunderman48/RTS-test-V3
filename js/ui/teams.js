// Team colours per player (owner index), following each army's paint scheme.
import { PAINT } from '../data/units.js';
export const TEAM = ['#3a78d8', '#9b59d0'];
export const TEAM_HEX = [0x3a78d8, 0x9b59d0];
export function setTeams(state) {
  for (const p of [0, 1]) {
    const c = PAINT[state.players[p].paint || state.players[p].faction].rim;
    TEAM_HEX[p] = c; TEAM[p] = '#' + c.toString(16).padStart(6, '0');
  }
  document.documentElement.style.setProperty('--t0', TEAM[0]);
  document.documentElement.style.setProperty('--t1', TEAM[1]);
}
