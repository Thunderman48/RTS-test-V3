// Settings (one stored object, applied live) and the Battle setup screen. Mixed into Game.
import { MAPS, MAP_ORDER } from '../data/maps.js';
import { FACTIONS } from '../data/units.js';
import { drawMapPreview } from './mappreview.js';
import { soundOn, setSound, setMaster, sfx, unlockAudio } from '../audio/sfx.js';
import { MINI_MODE } from '../render/minis.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'tiers-v4-settings';
export const DEFAULTS = {
  quality: 'high', lens: true, anim: 'posable', mist: true,
  sound: true, volume: 0.8,
  speed: 1, plates: 'always', askReady: true,
  pan: 1, zoom: 1, invertZoom: false, keysRotate: true,
};
export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  // settings from older versions
  try {
    if (s.lens === undefined && localStorage.getItem('tiers-v4-lens') === '0') s.lens = false;
    if (s.anim === undefined && localStorage.getItem('tiers-v4-anim')) s.anim = localStorage.getItem('tiers-v4-anim');
    if (s.sound === undefined && localStorage.getItem('tiers-v4-sound') === '0') s.sound = false;
  } catch {}
  return { ...DEFAULTS, ...s };
}
const SETUP_KEY = 'tiers-v4-setup';

const TABS = [['graphics', 'Graphics'], ['audio', 'Audio'], ['gameplay', 'Gameplay'], ['camera', 'Camera & controls']];

export const SettingsUI = {
  // ---------------------------------------------------------------- settings
  initSettings() {
    this.settings = loadSettings();
    this.applySettings(true);
    $('m-settings').onclick = () => this.openSettings();
    $('o-settings').onclick = () => { $('opts').classList.add('hidden'); this.openSettings(); };
    $('o-help').onclick = () => { $('opts').classList.add('hidden'); $('b-help').click(); };
    $('st-close').onclick = () => $('settings').classList.add('hidden');
  },
  saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch {} },
  set(k, v) { this.settings[k] = v; this.saveSettings(); this.applySettings(false, k); this.renderSettings(); },
  applySettings(first, only = null) {
    const S = this.settings, all = !only;
    if (all || only === 'quality') this.view.setQuality?.(S.quality), this.fogLayer?.setDetail(S.quality === 'low' ? 0 : 1);
    if (all || only === 'lens') this.setLens(S.lens, false);
    if ((all && S.anim !== MINI_MODE) || only === 'anim') this.setAnim(S.anim, false);
    if (all || only === 'mist') this.fogLayer?.setMist(S.mist);
    if (all || only === 'sound') { if (soundOn() !== S.sound) setSound(S.sound); }
    if (all || only === 'volume') setMaster(S.volume);
    if (all || only === 'pan' || only === 'zoom' || only === 'invertZoom') { this.view.panMul = S.pan; this.view.zoomMul = S.zoom; this.view.invertZoom = S.invertZoom; }
    if (all || only === 'plates') this.labels?.forEach(el => { el.dataset.key = ''; });
  },
  openSettings(tab = this.stTab || 'graphics') {
    this.stTab = tab;
    $('settings').classList.remove('hidden');
    this.renderSettings();
  },
  renderSettings() {
    if ($('settings').classList.contains('hidden')) return;
    const S = this.settings, tab = this.stTab;
    const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="chip${S[k] === v ? ' on' : ''}" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const sw = (k) => `<button class="sw-btn${S[k] ? ' on' : ''}" data-k="${k}" data-t="1"><i class="sw"></i></button>`;
    const slider = (k, min, max, step) => `<input type="range" min="${min}" max="${max}" step="${step}" value="${S[k]}" data-k="${k}"><span class="val">${k === 'volume' ? Math.round(S[k] * 100) + '%' : S[k].toFixed(1) + '×'}</span>`;
    const row = (title, sub, ctl) => `<div class="st-row"><div><b>${title}</b><small>${sub}</small></div><div class="st-ctl">${ctl}</div></div>`;
    const pages = {
      graphics: row('Quality', 'Low is fastest: no shadows, lower resolution, simpler mist', seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]))
        + row('Miniature lens', 'Soft tilt-shift blur, like a macro photo of a tabletop', sw('lens'))
        + row('Mini animation', 'Posable arms swing their weapons; solid statues lunge like minis moved by hand', seg('anim', [['posable', 'Posable arms'], ['statue', 'Solid statues']]))
        + row('Fog mist', 'The low clouds over ground you have never seen (the haze always stays)', sw('mist')),
      audio: row('Sound', 'Clashes, volleys, hammers, coins and drums', sw('sound'))
        + row('Volume', 'Sound effects', slider('volume', 0, 1, 0.05))
        + row('Test', 'Play a sound', '<button class="chip" data-act="test">▶ Play</button>'),
      gameplay: row('Replay speed', 'How fast each battle plays back at first', seg('speed', [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']]))
        + row('Nameplates', 'Labels over squads and buildings', seg('plates', [['always', 'Always'], ['compact', 'Compact'], ['selected', 'Selected only']]))
        + row('Ask before Ready', 'When you still have unused command points', sw('askReady'))
        + row('First-game tips', 'Show the tips strip and the help again', '<button class="chip" data-act="tips">Show again</button>'),
      camera: row('Pan speed', 'Dragging the table', slider('pan', 0.5, 2, 0.1))
        + row('Zoom speed', 'Scroll wheel and pinch', slider('zoom', 0.5, 2, 0.1))
        + row('Invert zoom', 'Scroll the other way to zoom in', sw('invertZoom'))
        + row('Rotate with Q / E', 'Keyboard rotation (right-drag and two-finger twist always work)', sw('keysRotate'))
        + row('Reset camera', 'Back to the view over your army', '<button class="chip" data-act="cam">Reset</button>'),
    };
    $('st-body').innerHTML = `<div class="help-tabs">${TABS.map(([k, n]) => `<button class="chip${k === tab ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div><div class="st-page">${pages[tab]}</div>`;
    const body = $('st-body');
    body.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => this.openSettings(el.dataset.tab));
    body.querySelectorAll('button[data-k]').forEach(el => el.onclick = () => {
      const k = el.dataset.k;
      if (el.dataset.t) this.set(k, !this.settings[k]);
      else { const v = el.dataset.v; this.set(k, isNaN(+v) ? v : +v); }
    });
    body.querySelectorAll('input[type=range]').forEach(el => {
      el.oninput = () => { this.settings[el.dataset.k] = +el.value; el.nextElementSibling.textContent = el.dataset.k === 'volume' ? Math.round(+el.value * 100) + '%' : (+el.value).toFixed(1) + '×'; this.applySettings(false, el.dataset.k); };
      el.onchange = () => { this.saveSettings(); if (el.dataset.k === 'volume') { unlockAudio(); sfx('confirm'); } };
    });
    body.querySelectorAll('[data-act]').forEach(el => el.onclick = () => {
      const a = el.dataset.act;
      if (a === 'test') { unlockAudio(); setTimeout(() => sfx('victory'), 60); }
      else if (a === 'tips') { this.hintsDone = false; this.hintStep = 0; try { localStorage.removeItem('tiers-v4-hints'); localStorage.removeItem('tiers-v4-help'); } catch {} this.toast('Tips will show again'); this.hint?.(); }
      else if (a === 'cam') { if (this.homeCam && this.state && this.phase !== 'menu') this.view.cam = this.homeCam(); this.toast('Camera reset'); }
    });
  },

  // ---------------------------------------------------------------- battle setup (vs AI)
  openSetup() {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(SETUP_KEY) || '{}') || {}; } catch {}
    this.setupSel = { faction: FACTIONS[saved.faction] ? saved.faction : 'kingdom', map: MAPS[saved.map] ? saved.map : 'crossing', level: ['easy', 'normal', 'hard'].includes(saved.level) ? saved.level : 'normal' };
    $('menu').classList.add('hidden'); $('setup').classList.remove('hidden');
    this.renderSetup();
  },
  renderSetup() {
    const S = this.setupSel;
    $('su-armies').innerHTML = Object.keys(FACTIONS).map(f => `<button class="fac ${f}${S.faction === f ? ' on' : ''}" data-f="${f}"><b>${esc(FACTIONS[f].name)}</b><small>${f === 'kingdom' ? 'Knights, shieldwalls and crossbows · gold economy' : 'Skeletons, wraiths and necromancy · souls economy'}</small></button>`).join('');
    $('su-maps').innerHTML = this.mapCards(S.map);
    $('su-level').innerHTML = [['easy', 'Easy', 'The AI earns less and commands fewer squads'], ['normal', 'Normal', 'A fair fight'], ['hard', 'Hard', 'The AI earns more and commands more squads']].map(([k, n, d]) => `<button class="chip${S.level === k ? ' on' : ''}" data-l="${k}" title="${d}">${n}</button>`).join('');
    this.drawMapCards($('su-maps'));
    $('su-armies').querySelectorAll('[data-f]').forEach(el => el.onclick = () => { S.faction = el.dataset.f; this.renderSetup(); });
    $('su-maps').querySelectorAll('[data-map]').forEach(el => el.onclick = () => { S.map = el.dataset.map; this.renderSetup(); });
    $('su-level').querySelectorAll('[data-l]').forEach(el => el.onclick = () => { S.level = el.dataset.l; this.renderSetup(); });
    $('su-back').onclick = () => { $('setup').classList.add('hidden'); $('menu').classList.remove('hidden'); };
    $('su-start').onclick = () => {
      try { localStorage.setItem(SETUP_KEY, JSON.stringify(S)); } catch {}
      $('setup').classList.add('hidden');
      const other = S.faction === 'kingdom' ? 'undead' : 'kingdom';
      this.start({ mode: 'ai', factions: [S.faction, other], me: 0, map: S.map, level: S.level });
    };
  },
  mapCards(sel, compact = false) {
    return MAP_ORDER.map(id => { const m = MAPS[id]; return `<button class="mapcard${sel === id ? ' on' : ''}${compact ? ' compact' : ''}" data-map="${id}"><canvas data-prev="${id}"></canvas><b>${esc(m.name)}</b><small>${m.w}″ × ${m.h}″${m.capBonus ? ` · army cap +${m.capBonus}` : ''}</small>${compact ? '' : `<small class="bl">${esc(m.blurb)}</small>`}</button>`; }).join('');
  },
  drawMapCards(root) { requestAnimationFrame(() => root.querySelectorAll('canvas[data-prev]').forEach(c => drawMapPreview(c, c.dataset.prev))); },
};
