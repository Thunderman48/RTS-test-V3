// HUD rendering: top bar, turn-order strip, selection panel.
import { CONFIG, STANCES, STANCE_NAMES } from '../config.js';
import { glyph } from './icons.js';
import { apFor, cpPools, unitDef, hqOf, skillDef, cdOf } from '../sim/state.js';
import { actionCost, prepaidCost, upgradeCost } from '../sim/orders.js';
import { dist } from '../sim/geom.js';
import { glChip, showGlossary } from './glossary.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let lastToast = { msg: '', t: 0 };
export function toast(msg, warn = false) {
  const now = performance.now();
  if (msg === lastToast.msg && now - lastToast.t < 1500) return;
  lastToast = { msg, t: now };
  const box = $('toast');
  const el = document.createElement('div');
  el.className = 'toast-item' + (warn ? ' warn' : '');
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 2600);
}

export function renderTopbar(g) {
  const s = g.state, me = g.me;
  $('tb-round').textContent = s.round;
  const phase = { planning: 'Planning', resolution: 'Resolving', replay: 'Replay', waiting: 'Waiting', over: 'Game over' }[g.phase] || g.phase;
  $('tb-phase').textContent = phase;
  const sup = g.planner.supplyLeft();
  const inc = (hqOf(s, me) ? CONFIG.economy.hqIncome : 0) + s.map.nodes.filter(n => n.owner === me).length * CONFIG.economy.nodeIncome;
  $('tb-supply').innerHTML = `${sup}<small style="font-size:10px;color:#8a8a8a"> +${inc}</small>`;
  const c = g.planner.cp();
  $('tb-cp').textContent = `${c.leftBase}/${cpPools(s, me).base}`;
  $('btn-pause').classList.toggle('hidden', !g.isLocal);
  $('btn-replay').disabled = !g.lastRound || g.phase !== 'planning';
  $('btn-log').disabled = !g.digest && (!g.report || !g.report.lines.length);
  $('btn-showall').classList.toggle('on', !!g.showAll);
}

// planned tier of an own unit this round (upgrades, debuffs, commander Rally)
export function plannedTier(g, u) {
  const def = unitDef(u);
  let t = def.tier - u.tierDebuff;
  if (u.owner === g.me) {
    t += g.planner.plan(u.id)?.upgrades || 0;
    const c = g.state.units.find(x => x.owner === g.me && x.type === 'commander' && x.hp > 0);
    const cp = c && g.planner.plan(c.id);
    const rally = skillDef('commander', 'rally');
    if (cp && cp.buffs.includes('rally') && dist(c.x, c.z, u.x, u.z) <= rally.radius) t += rally.tierUp;
  }
  return Math.max(CONFIG.minTier, t);
}

export function renderStrip(g) {
  const strip = $('order-strip');
  if (g.phase !== 'planning' && g.phase !== 'waiting') { strip.innerHTML = ''; return; }
  const s = g.state, me = g.me;
  const groups = new Map();
  for (const u of s.units) {
    if (u.hp <= 0) continue;
    const mine = u.owner === me;
    if (!mine && !g.visibleIds.has(u.id)) continue;
    const tier = plannedTier(g, u);
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(u);
  }
  const tiers = [...groups.keys()].sort((a, b) => b - a);
  let html = `<span class="strip-label">Turn order ${glChip('Tier')}</span>`;
  tiers.forEach((t, i) => {
    html += `<div class="tier-col"><span class="tord">${ordinal(i + 1)}</span><span class="tnum">T${t}</span>`;
    const list = groups.get(t);
    const mine = list.filter(u => u.owner === me), theirs = list.filter(u => u.owner !== me);
    const chip = u => `<span class="chip${g.selection.includes(u.id) ? ' sel' : ''}${u.owner !== me ? ' enemy' : ''}" data-id="${u.id}" title="${u.owner === me ? 'Your' : 'Enemy'} ${unitDef(u).name}">${glyph(u.type, u.owner)}</span>`;
    html += mine.map(chip).join('');
    if (mine.length && theirs.length) html += '<span class="tsep">vs</span>';
    html += theirs.map(chip).join('');
    html += '</div>';
  });
  html += '<span class="strip-label">then buildings</span>';
  strip.innerHTML = html;
  strip.querySelectorAll('.chip').forEach(el => el.onclick = () => g.selectAndFocus(el.dataset.id));
  strip.querySelectorAll('.gl').forEach(el => el.onclick = ev => { ev.stopPropagation(); showGlossary(el.dataset.gl, el); });
}

export const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

// "Acts 2nd (tier 5): after Enemy Assassin, at the same time as Enemy Fighter."
export function whenActs(g, u) {
  const me = g.me;
  const all = g.state.units.filter(x => x.hp > 0 && (x.owner === me || g.visibleIds.has(x.id)));
  const tiers = [...new Set(all.map(x => plannedTier(g, x)))].sort((a, b) => b - a);
  const t = plannedTier(g, u);
  const nm = x => (x.owner === me ? 'your ' : 'enemy ') + unitDef(x).name;
  const before = all.filter(x => plannedTier(g, x) > t);
  const same = all.filter(x => x !== u && plannedTier(g, x) === t);
  let txt = `Acts ${ordinal(tiers.indexOf(t) + 1)} (tier ${t})`;
  const parts = [];
  if (before.length) parts.push('after ' + (before.length > 3 ? `${before.length} units` : before.map(nm).join(', ')));
  if (same.length) parts.push('at the same time as ' + (same.length > 3 ? `${same.length} units` : same.map(nm).join(', ')));
  if (!before.length) parts.unshift('first');
  return txt + ': ' + parts.join(', ') + '.';
}

function hpBar(e) {
  const f = Math.max(0, e.hp / e.maxHp);
  return `<div class="hpbar${f < 0.34 ? ' low' : ''}"><i style="width:${(f * 100).toFixed(1)}%"></i></div>`;
}

const ACT_LABEL = { move: 'MOVE', wait: 'WAIT', attack: 'ATTACK', shoot: 'SHOOT', frag: 'FRAG', dash: 'DASH', shove: 'SHOVE', disrupt: 'DISRUPT', sweep: 'SWEEP' };

// The unit's round as a row of labelled blocks (AP = time). Unused AP shows in red.
function apBarHTML(u, plan, stancePlan) {
  const total = apFor(u);
  const p = plan || stancePlan;
  const cls = plan ? 'act' : 'stance';
  let html = `<div class="otl-head"><span>${plan ? 'Your orders this round' : 'Stance plan this round'} ${glChip('AP')}</span><span class="otl-ap">${total} AP</span></div><div class="apbar">`;
  const seg = (ap, c, label, title) => { if (ap > 0) html += `<div class="seg ${c}" title="${title || label} · ${ap} AP" style="width:${(ap / CONFIG.baseAP) * 100}%">${ap >= 12 ? label : ''}</div>`; };
  let used = 0;
  if (p) {
    const pre = [];
    if (p.upgrades) pre.push('TIER+');
    for (const id of p.buffs || []) pre.push(skillDef(u.type, id).name.toUpperCase());
    if (p.parry) pre.push('PARRY');
    if (p.overwatch) pre.push('OVERWATCH');
    if (p.defends) pre.push(`DEF×${p.defends}`);
    const pc = prepaidCost(u, p);
    seg(pc, plan ? 'pre' : 'stance', pre.join(' '), 'Paid during planning');
    used += pc;
    p.actions.forEach((a, i) => { const c = actionCost(u, a); seg(c, cls + (i % 2 ? ' alt' : ''), ACT_LABEL[a.kind] || a.kind); used += c; });
  }
  const left = Math.max(0, total - used);
  if (left > 0) html += `<div class="seg unused" style="width:${(left / CONFIG.baseAP) * 100}%">${plan ? (left >= 12 ? `${left} UNUSED` : '') : ''}</div>`;
  if (total < CONFIG.baseAP) seg(CONFIG.baseAP - total, 'wound', 'WOUNDED', 'Lost to wounds');
  html += '</div>';
  if (plan && left > 0) html += `<div class="unused-note">${left} AP unused → lost. Add Defend +1 or another action.</div>`;
  return html;
}

// Plain-language summary of a plan ("what will this unit do this round?")
export function describePlan(g, u, plan) {
  if (!plan) return 'Nothing.';
  const parts = [];
  const name = id => { const e = g.entity(id); return e ? (e.owner === g.me ? 'your ' : 'enemy ') + (e.id[0] === 'u' ? unitDef(e).name : CONFIG.buildings[e.type].name) : 'a target'; };
  let lastKind = null, count = 0;
  const flush = () => { if (lastKind) parts.push(lastKind + (count > 1 ? ` ×${count}` : '')); lastKind = null; count = 0; };
  for (const a of plan.actions) {
    let txt;
    switch (a.kind) {
      case 'move': txt = a.intent === 'approach' ? `move toward ${name(a.follow)} (too far to attack yet)` : a.follow ? `follow ${name(a.follow)}` : 'move'; break;
      case 'attack': txt = `attack ${name(a.target)}`; break;
      case 'shoot': txt = 'shoot'; break;
      case 'shove': txt = `shove ${name(a.target)}`; break;
      case 'disrupt': txt = `disrupt ${name(a.target)}`; break;
      case 'wait': txt = 'wait'; break;
      default: txt = skillDef(u.type, a.kind)?.name.toLowerCase() || a.kind;
    }
    if (txt === lastKind) count++; else { flush(); lastKind = txt; count = 1; }
  }
  flush();
  for (const id of plan.buffs || []) parts.unshift(skillDef(u.type, id).name.toLowerCase());
  if (plan.upgrades) parts.unshift(`tier +${plan.upgrades}`);
  if (plan.parry) parts.push('parry ready');
  if (plan.overwatch) parts.push(`overwatch ×${plan.overwatch}`);
  if (plan.defends) parts.push(`${plan.defends} extra defend${plan.defends > 1 ? 's' : ''}`);
  if (!parts.length) return 'Nothing (all AP unused).';
  const s = parts.join(', then ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

const STANCE_DESC = {
  guard: 'Melee units chase and attack enemies within 6. Ranged units stay put, keep 1 overwatch and fire at enemies in range.',
  hold: 'Stays put and spends all AP on extra defends. Keeps its control zone.',
  holdground: 'Leashed to this spot (3). Strikes enemies that come close, never chases further.',
  advance: 'Walks to the chosen point and fights enemies it meets on the way.',
  retreat: 'Runs to the closest Outpost, or the HQ. Never attacks.',
};

export function renderPanel(g) {
  const panel = $('panel');
  const show = html => { panel.innerHTML = html; panel.classList.add('show'); };
  if (g.phase !== 'planning') { panel.classList.remove('show'); return; }
  if (g.uiMode && g.uiMode.startsWith('build:')) return renderPlacing(g, show);
  if (g.panelTab === 'build') return renderBuildMenu(g, show);
  const sel = g.selection.map(id => g.entity(id)).filter(Boolean);
  if (!sel.length) { panel.classList.remove('show'); return; }
  // While aiming on small screens, shrink the panel to the instruction bar so the map stays visible
  const small = window.innerWidth < 720 || window.innerHeight < 500;
  if (small && g.uiMode && !g.uiMode.startsWith('build:')) {
    const u = sel[0];
    const nm = u.id[0] === 'u' ? unitDef(u).name : '';
    show(`<div class="aimbar"><span class="aim-who">${glyph(u.type, u.owner, 16)} ${esc(nm)}</span>${modeNote(g)}</div>`);
    bindPanel(g, u.id[0] === 'u' && u.owner === g.me ? u : null, null, g.ownSelected());
    return;
  }
  const e = sel[0];
  if (sel.length > 1) return renderMulti(g, sel, show);
  if (e.id[0] === 'u') return e.owner === g.me ? renderOwnUnit(g, e, show) : renderEnemyUnit(g, e, show);
  if (e.id[0] === 'b') return renderBuilding(g, e, show);
  if (e.id[0] === 'n') return renderNode(g, e, show);
}

function modeNote(g) {
  const notes = {
    move: 'Tap a destination (or a unit to follow it)', attack: 'Tap an enemy to attack', shoot: 'Tap where to fire. Line shot: aim where the enemy will be',
    dash: 'Tap a direction to dash', frag: 'Tap a spot to lob the grenade (passes over walls)', shove: 'Tap an enemy to shove',
    disrupt: 'Tap an enemy unit to disrupt (range 6)', advance: 'Tap the point to advance towards',
  };
  if (!g.uiMode) return '';
  return `<div class="modebar">▸ ${notes[g.uiMode] || ''} <button class="btn mini" data-act="cancelmode">Cancel</button></div>`;
}

function unitHead(g, u, extra = '') {
  const def = unitDef(u);
  const hq = hqOf(g.state, u.owner);
  const nearHQ = hq && dist(hq.x, hq.z, u.x, u.z) <= CONFIG.defenderBonus.radius;
  const freeDef = def.defends + (nearHQ ? CONFIG.defenderBonus.defends : 0);
  const sk = def.skills.map(k => `${k.name} ${cdOf(u, k.id) > 0 ? `(${cdOf(u, k.id)})` : '✓'}`).join(' · ');
  return `<div class="p-head"><div class="p-icon">${glyph(u.type, u.owner, 34)}</div><div class="p-main">
    <div class="p-title">${def.hero ? 'Hero · ' : ''}${def.name}${extra}</div>
    <div class="p-sub">${def.tier >= 6 ? 'Fast' : def.tier <= 4 ? 'Slow' : 'Normal'} speed · ${freeDef} free defend${freeDef > 1 ? 's' : ''} ${glChip('Defend')} · ${sk} ${glChip('Cooldown')}</div></div>
    <div class="p-stats">HP ${u.hp}/${u.maxHp}</div>
    <button class="p-close" data-act="deselect" aria-label="Close">✕</button></div>${hpBar(u)}`;
}

function lastRoundLine(g, u) {
  const r = g.digest?.byId.get(u.id);
  if (!r) return '';
  const bits = [];
  if (r.hpBefore !== null && r.hpAfter !== r.hpBefore) bits.push(`HP ${r.hpBefore}→${r.hpAfter}`);
  bits.push(r.summary);
  if (r.kills.length) bits.push('killed ' + r.kills.join(', '));
  let html = `<div class="lastround"><b>Last round:</b> ${esc(bits.join(' · '))}</div>`;
  for (const f of r.fails) html += `<div class="dg-fail">⊘ ${esc(f)}</div>`;
  return html;
}

function renderOwnUnit(g, u, show) {
  const P = g.planner;
  const plan = P.plan(u.id);
  if (!plan || g.panelTab === 'stance') return renderStanceCard(g, [u], show);
  renderCommand(g, u, plan, show);
}

// Stance-first card: what the unit does on its own, free stance buttons, and a Control button.
function renderStanceCard(g, units, show) {
  const P = g.planner;
  const one = units.length === 1 ? units[0] : null;
  const cur = one ? P.pendingStance(one) : null;
  let html = one ? unitHead(g, one) : `<div class="p-head"><div class="p-main"><div class="p-title">${units.length} units selected</div>
      <div class="p-sub">${units.map(u => unitDef(u).name).join(', ')}</div></div><button class="p-close" data-act="deselect">✕</button></div>`;
  html += modeNote(g);
  if (one) {
    const controlled = !!P.plan(one.id);
    const preview = controlled ? null : g.stancePreview.get(one.id);
    html += lastRoundLine(g, one);
    html += `<div class="stance-now"><span class="stance-k">Stance ${glChip('Stance')}</span><span class="stance-v">${STANCE_NAMES[cur]}${cur !== one.stance ? ' <small>(new)</small>' : ''}</span></div>
      <div class="stance-desc">${esc(STANCE_DESC[cur])}</div>
      <div class="will"><b>${controlled ? 'Your orders' : 'This round it will'}:</b> ${esc(describePlan(g, one, controlled ? P.plan(one.id) : preview))}<div class="when">${esc(whenActs(g, one))}</div></div>`;
  } else {
    html += `<div class="stance-desc">Pick a stance for all of them (free), or take direct control.</div>`;
  }
  html += '<div class="btns stance-btns">';
  for (const st of STANCES) html += `<button class="btn${cur === st ? ' on' : ''}" data-act="stance:${st}">${STANCE_NAMES[st]}</button>`;
  html += '</div>';
  const need = units.filter(u => !P.plan(u.id) && u.type !== 'commander').length;
  const left = P.cp().leftBase;
  const anyControlled = units.some(u => P.plan(u.id));
  if (one && P.plan(one.id)) {
    html += `<button class="control" data-act="tab:orders">Open orders ▸</button>`;
  } else {
    const free = need === 0;
    const can = free || left >= need;
    const label = free ? 'Control · free (hero)' : `Control${units.length > 1 ? ' all' : ''} · ${need} CP`;
    html += `<button class="control" data-act="control" ${can ? '' : 'disabled'}>${label}</button>
      <div class="note">${can ? `Control = give exact orders this round. ${left} of ${g.planner.cp().totalBase} CP left ${glChip('CP')}` : `No CP left (${left}) ${glChip('CP')} — this unit follows its stance. Release another unit to free CP.`}</div>`;
  }
  if (units.length > 1 && anyControlled) html += `<button class="btn danger wide" data-act="release">Release all (refund CP)</button>`;
  show(html);
  bindPanel(g, one, null, units);
}

function renderCommand(g, u, plan, show) {
  const def = unitDef(u);
  const P = g.planner;
  const tierPlanned = plannedTier(g, u);
  let html = unitHead(g, u, ` <span class="ctl-tag">${u.type === 'commander' ? 'CONTROLLED · FREE' : 'CONTROLLED · 1 CP'}</span>`);
  html += `<div class="will"><b>Orders:</b> ${esc(describePlan(g, u, plan))}<div class="when">${esc(whenActs(g, u))}</div></div>`;
  void tierPlanned;
  html += apBarHTML(u, plan, null) + modeNote(g);
  const last = plan.actions[plan.actions.length - 1];
  if (last && (last.kind === 'move' || last.kind === 'wait' || last.kind === 'attack' || last.kind === 'shove')) {
    const isMove = last.kind === 'move' || last.kind === 'wait';
    const val = isMove ? last.ap : last.moveAp;
    const strike = last.kind === 'shove' ? skillDef(u.type, 'shove').ap : last.kind === 'attack' ? def.strike.ap : 0;
    const max = apFor(u) - planCostExcept(u, plan, last) - strike;
    html += `<div class="slider-row"><span>${last.kind === 'wait' ? 'Wait AP' : isMove ? 'Move AP' : 'Approach AP'}</span>
      <input type="range" min="${isMove ? 1 : 0}" max="${Math.max(isMove ? 1 : 0, max)}" value="${val}" data-act="slider"><b id="slider-v">${val}</b></div>`;
  }
  const left = P.apLeft(u);
  const planned = new Set([...(plan.buffs || []), ...plan.actions.map(a => a.kind)]);
  const b = (act, label, sub = '', on = false, dis = false, cls = '') =>
    `<button class="btn${on ? ' on' : ''} ${cls}" data-act="${act}" ${dis ? 'disabled' : ''}>${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
  html += '<div class="cmd-groups"><div class="btn-group"><span class="grp">Actions</span><div class="btns">';
  const why = (need, label = 'AP') => `need ${need} ${label}, ${left} left`;
  html += b('mode:move', 'Move', left < 1 ? 'no AP left' : 'AP per distance', g.uiMode === 'move', left < 1);
  if (def.melee) html += b('mode:attack', 'Attack', left < def.strike.ap ? why(def.strike.ap) : def.strike.ap + ' AP + walk', g.uiMode === 'attack', left < def.strike.ap);
  else html += b('mode:shoot', 'Shoot', left < def.shot.ap ? why(def.shot.ap) : def.shot.ap + ' AP · range ' + def.shot.range, g.uiMode === 'shoot', left < def.shot.ap);
  html += b('wait', 'Wait', left < 1 ? 'no AP left' : '+10 AP (delay)', false, left < 1);
  html += '</div></div><div class="btn-group"><span class="grp">Skills</span><div class="btns">';
  for (const k of def.skills) {
    const cd = cdOf(u, k.id);
    const on = g.uiMode === k.id || (k.prepaid && plan.buffs.includes(k.id));
    const noAp = !on && !planned.has(k.id) && left < k.ap;
    const sub = cd > 0 ? `ready in ${cd} round${cd > 1 ? 's' : ''}` : planned.has(k.id) ? (k.prepaid ? 'on · tap to undo' : 'planned') : noAp ? why(k.ap) : `${k.ap} AP`;
    html += b('skill:' + k.id, k.name, sub, on, cd > 0 || (!k.prepaid && planned.has(k.id)) || noAp, 'skill');
  }
  html += '</div></div><div class="btn-group"><span class="grp">Prepare</span><div class="btns">';
  const nd = plan.defends || 0;
  html += b('pre:defends', 'Defend +1', nd >= CONFIG.maxExtraDefends ? `max ${nd}` : left < CONFIG.extraDefendCost ? why(CONFIG.extraDefendCost) : `${CONFIG.extraDefendCost} AP · have ${nd}`, false, left < CONFIG.extraDefendCost || nd >= CONFIG.maxExtraDefends);
  const nu = plan.upgrades || 0;
  const uc = CONFIG.tierUpgradeCost[nu];
  html += b('pre:upgrades', 'Act earlier', nu >= CONFIG.maxTierUpgrades ? 'max (+2 tiers)' : left < uc ? why(uc) : `tier +1 · ${uc} AP`, false, nu >= CONFIG.maxTierUpgrades || left < uc);
  if (def.parry) html += b('pre:parry', 'Parry', plan.parry ? 'on · tap to undo' : left < CONFIG.parryCost ? why(CONFIG.parryCost) : CONFIG.parryCost + ' AP', plan.parry, !plan.parry && left < CONFIG.parryCost);
  if (def.overwatch) html += b('pre:overwatch', 'Overwatch', (plan.overwatch || 0) >= CONFIG.maxOverwatch ? 'max' : left < CONFIG.overwatchCost ? why(CONFIG.overwatchCost) : `${CONFIG.overwatchCost} AP · have ${plan.overwatch || 0}`, false, (plan.overwatch || 0) >= CONFIG.maxOverwatch || left < CONFIG.overwatchCost);
  if (u.hp < u.maxHp) html += b('heal', 'Heal', CONFIG.economy.healCost + ' supply', g.planner.draft.heals.includes(u.id));
  html += '</div></div></div><div class="btns foot">';
  html += b('undo', 'Undo', '', false, !plan.hist?.length);
  html += b('tab:stance', '◂ Stance', STANCE_NAMES[P.pendingStance(u)]);
  html += b('release', 'Release', u.type === 'commander' ? 'back to stance' : 'refund 1 CP', false, false, 'danger');
  html += '</div>';
  show(html);
  bindPanel(g, u);
}

function planCostExcept(u, plan, except) {
  return prepaidCost(u, plan) + plan.actions.reduce((s, a) => s + (a === except ? 0 : actionCost(u, a)), 0);
}

function renderMulti(g, sel, show) {
  const units = sel.filter(e => e.id[0] === 'u' && e.owner === g.me);
  const P = g.planner;
  const allControlled = units.length && units.every(u => P.plan(u.id));
  if (!allControlled || g.panelTab === 'stance') return renderStanceCard(g, units, show);
  let html = `<div class="p-head"><div class="p-main"><div class="p-title">${units.length} units · controlled</div>
    <div class="p-sub">${units.map(u => unitDef(u).name).join(', ')}</div></div><button class="p-close" data-act="deselect">✕</button></div>`;
  html += modeNote(g);
  html += `<div class="btns">
      <button class="btn${g.uiMode === 'move' ? ' on' : ''}" data-act="mode:move">Move<small>keep formation</small></button>
      <button class="btn${g.uiMode === 'attack' ? ' on' : ''}" data-act="mode:attack">Attack<small>focus one target</small></button>
      <button class="btn" data-act="pre:defends">Defend +1<small>each</small></button>
      <button class="btn" data-act="tab:stance">◂ Stance</button>
      <button class="btn danger" data-act="release">Release all<small>refund CP</small></button>
    </div>`;
  show(html);
  bindPanel(g, null, null, units);
}

function renderEnemyUnit(g, u, show) {
  const def = unitDef(u);
  const sk = def.skills.map(k => u.revealed?.[k.id] ? `${k.name}: ${cdOf(u, k.id) > 0 ? cdOf(u, k.id) + ' rounds' : 'ready'}` : `${k.name}: not seen yet`).join(' · ');
  const html = `<div class="p-head"><div class="p-icon">${glyph(u.type, u.owner, 34)}</div><div class="p-main">
    <div class="p-title">Enemy ${def.hero ? 'Hero · ' : ''}${def.name}</div><div class="p-sub">Base tier ${Math.max(CONFIG.minTier, def.tier - u.tierDebuff)}${u.tierDebuff ? ' (debuffed)' : ''} · stance at planning start: ${STANCE_NAMES[u.stance]}</div></div>
    <div class="p-stats">HP ${u.hp}/${u.maxHp}</div>
    <button class="p-close" data-act="deselect">✕</button></div>${hpBar(u)}
    <div class="will">${esc(sk)}</div>
    <div class="note">Enemy orders and tier upgrades stay hidden until resolution. ${def.melee ? `Its control zone (radius ${def.zone}, dashed ring) slows your units inside.` : `Shot range ${def.shot.range}.`}</div>`;
  show(html); bindPanel(g, null);
}

function renderBuilding(g, b, show) {
  const def = CONFIG.buildings[b.type];
  const mine = b.owner === g.me;
  const P = g.planner;
  let html = `<div class="p-head"><div class="p-icon">${glyph(b.type, b.owner, 34)}</div><div>
    <div class="p-title">${mine ? '' : 'Enemy '}${def.name}</div><div class="p-sub">${b.built ? buildingDesc(b.type) : `Under construction · ${b.progress}/${def.rounds} rounds`}</div></div>
    <div class="p-stats">HP ${b.hp}/${b.maxHp}${def.attack ? `<br>Atk ${def.attack.dmg} · rng ${def.attack.range}` : ''}</div>
    <button class="p-close" data-act="deselect">✕</button></div>${hpBar(b)}`;
  if (mine && b.built && def.produces) {
    const queued = b.queue.map(q => `<span class="qitem">${glyph(q.unit, b.owner, 12)} ${q.progress}/${CONFIG.units[q.unit].buildRounds}</span>`);
    P.draft.production.forEach((q, i) => { if (q.building === b.id) queued.push(`<span class="qitem" data-act="unprod:${i}">+ ${CONFIG.units[q.unit].name} ✕</span>`); });
    html += `<div class="qlist">Queue: ${queued.join('') || '<span>empty</span>'}</div><div class="btns">`;
    for (const t of def.produces) {
      const ud = CONFIG.units[t];
      html += `<button class="btn" data-act="prod:${t}" ${P.supplyLeft() < ud.cost ? 'disabled' : ''}>${glyph(t, b.owner, 14)} ${ud.name}<small>${ud.cost} · ${ud.buildRounds} rnd</small></button>`;
    }
    const boosted = P.draft.boosts.includes(b.id);
    html += `<button class="btn${boosted ? ' on' : ''}" data-act="boost">Boost<small>1 CP · +1 progress</small></button>`;
    const rally = P.draft.rally[b.id] || b.rally;
    html += `<button class="btn" data-act="rally">Rally<small>${STANCE_NAMES[rally]}</small></button></div>`;
    html += `<div class="note">New units spawn at the end of a round and act next round. Army ${g.armyCount()}/${CONFIG.economy.armyCap}.</div>`;
  } else if (mine && (b.type === 'hq' || b.type === 'outpost')) {
    html += `<div class="btns"><button class="btn" data-act="openbuild">Build…<small>near here</small></button></div>`;
  }
  show(html); bindPanel(g, null, b);
}

function buildingDesc(t) {
  return {
    hq: 'Income, vision, defensive gun. Lose all HQs and you lose.', barracks: 'Trains Fighters, Assassins and Tanks.',
    turret: 'Shoots the closest enemy in range at the end of the round.', command: `+${CONFIG.cp.perCommandPost} CP per round.`,
    outpost: 'Retreat point, vision, lets you build nearby.', barricade: `Cover: units within ${CONFIG.coverRadius} get +1 defend vs shots that cross it.`,
  }[t];
}

function renderNode(g, n, show) {
  const own = n.owner === -1 ? 'Neutral' : n.owner === g.me ? 'Yours' : 'Enemy';
  show(`<div class="p-head"><div class="p-icon">${glyph('node', n.owner, 34)}</div><div><div class="p-title">Resource node</div>
    <div class="p-sub">${own} · +${CONFIG.economy.nodeIncome} supply per round</div></div><button class="p-close" data-act="deselect">✕</button></div>
    <div class="note">Captured at the end of a round when only one side has units within ${CONFIG.economy.nodeRadius} of it.</div>`);
  bindPanel(g, null);
}

function renderBuildMenu(g, show) {
  const P = g.planner;
  let html = `<div class="p-head"><div class="p-title">Build</div><div class="p-stats">Supply ${P.supplyLeft()}</div><button class="p-close" data-act="closebuild">✕</button></div><div class="btns">`;
  for (const [t, d] of Object.entries(CONFIG.buildings)) {
    if (t === 'hq') continue;
    html += `<button class="btn" data-act="place:${t}" ${P.supplyLeft() < d.cost ? 'disabled' : ''}>${glyph(t, g.me, 14)} ${d.name}<small>${d.cost} · ${d.rounds} rnd</small></button>`;
  }
  html += '</div>';
  if (P.draft.builds.length) html += `<div class="qlist">Planned: ${P.draft.builds.map((b, i) => `<span class="qitem" data-act="unbuild:${i}">${CONFIG.buildings[b.type].name} ✕</span>`).join('')}</div>`;
  html += `<div class="note">Place within ${CONFIG.economy.buildRadius} of your HQ or an Outpost. Construction starts at the end of this round.</div>`;
  show(html); bindPanel(g, null);
}

function renderPlacing(g, show) {
  const t = g.uiMode.slice(6);
  const d = CONFIG.buildings[t];
  const err = g.ghost?.err;
  show(`<div class="p-head"><div class="p-icon">${glyph(t, g.me, 34)}</div><div class="p-main"><div class="p-title">Place ${d.name}</div>
    <div class="p-sub">${d.cost} supply · ${d.rounds} round${d.rounds > 1 ? 's' : ''} to build · ${buildingDesc(t)}</div></div></div>
    <div class="place-help">${err ? `<span class="bad">✕ ${esc(err)}</span>` : '<span class="ok">✓ This spot works.</span>'} Drag the ghost (or tap the map) to move it.</div>
    <div class="place-btns"><button class="btn" data-act="cancelbuild">Cancel</button>
      <button class="control" data-act="confirmbuild" ${err ? 'disabled' : ''}>Confirm ✓</button></div>`);
  bindPanel(g, null);
}

function bindPanel(g, u, b, units) {
  const panel = $('panel');
  panel.querySelectorAll('[data-act]').forEach(el => {
    const act = el.dataset.act;
    if (act === 'slider') {
      el.oninput = () => { $('slider-v').textContent = el.value; g.planner.setLastAP(u.id, +el.value); };
      el.onchange = () => g.refreshPanel();
      return;
    }
    el.onclick = ev => { ev.stopPropagation(); g.panelAction(act, u, b, units); };
  });
  panel.querySelectorAll('.gl').forEach(el => el.onclick = ev => { ev.stopPropagation(); showGlossary(el.dataset.gl, el); });
}

export { upgradeCost };
