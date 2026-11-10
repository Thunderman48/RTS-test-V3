// HUD rendering: top bar, turn-order strip, selection panel.
import { CONFIG, STANCES, STANCE_NAMES } from '../config.js';
import { glyph } from './icons.js';
import { apFor, cpPools, unitDef, hqOf, skillDef, cdOf } from '../sim/state.js';
import { actionCost, prepaidCost, upgradeCost } from '../sim/orders.js';
import { dist } from '../sim/geom.js';

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
  $('btn-pause').classList.toggle('hidden', g.mode !== 'ai');
  $('btn-replay').disabled = !g.lastRound || g.phase !== 'planning';
  $('btn-log').disabled = !g.report || !g.report.lines.length;
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
  let html = '<span class="strip-label">Acts first ▸</span>';
  for (const t of tiers) {
    html += `<div class="tier-col"><span class="tnum">${t}</span>`;
    for (const u of groups.get(t).sort((a, b) => a.owner - b.owner)) {
      const sel = g.selection.includes(u.id) ? ' sel' : '';
      html += `<span class="chip${sel}${u.owner !== me ? ' enemy' : ''}" data-id="${u.id}" title="${u.owner === me ? 'Your' : 'Enemy'} ${unitDef(u).name}">${glyph(u.type, u.owner)}</span>`;
    }
    html += '</div>';
  }
  html += '<span class="strip-label">▸ buildings last</span>';
  strip.innerHTML = html;
  strip.querySelectorAll('.chip').forEach(el => el.onclick = () => g.selectAndFocus(el.dataset.id));
}

function hpBar(e) {
  const f = Math.max(0, e.hp / e.maxHp);
  return `<div class="hpbar${f < 0.34 ? ' low' : ''}"><i style="width:${(f * 100).toFixed(1)}%"></i></div>`;
}

const ACT_LABEL = { move: 'MOVE', wait: 'WAIT', attack: 'ATTACK', shoot: 'SHOOT', frag: 'FRAG', dash: 'DASH', shove: 'SHOVE', disrupt: 'DISRUPT', sweep: 'SWEEP' };

function apBarHTML(u, plan, stancePlan) {
  const total = apFor(u);
  let html = '<div class="apbar">';
  const seg = (ap, cls, label) => { if (ap > 0) html += `<div class="seg ${cls}" style="width:${(ap / CONFIG.baseAP) * 100}%">${ap >= 14 ? label : ''}</div>`; };
  const p = plan || stancePlan;
  const cls = plan ? 'act' : 'stance';
  let used = 0;
  if (p) {
    const pre = prepaidCost(u, p);
    seg(pre, plan ? 'pre' : 'stance', 'PREPAID');
    used += pre;
    p.actions.forEach((a, i) => { const c = actionCost(u, a); seg(c, cls + (i % 2 ? ' alt' : ''), ACT_LABEL[a.kind] || a.kind); used += c; });
  }
  if (total < CONFIG.baseAP) seg(CONFIG.baseAP - total, 'pre', 'WOUND');
  html += `<span class="left">${Math.max(0, total - used)} / ${total} AP left</span></div>`;
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
      case 'move': txt = a.follow ? `follow ${name(a.follow)}` : 'move'; break;
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
    <div class="p-sub">Tier ${def.tier} (${def.tier >= 6 ? 'fast' : def.tier <= 4 ? 'slow' : 'normal'}) · ${freeDef} free defend${freeDef > 1 ? 's' : ''} · ${sk}</div></div>
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
    html += `<div class="stance-now"><span class="stance-k">Stance</span><span class="stance-v">${STANCE_NAMES[cur]}${cur !== one.stance ? ' <small>(new)</small>' : ''}</span></div>
      <div class="stance-desc">${esc(STANCE_DESC[cur])}</div>
      <div class="will"><b>${controlled ? 'Your orders' : 'This round'}:</b> ${esc(describePlan(g, one, controlled ? P.plan(one.id) : preview))}</div>`;
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
      <div class="note">${can ? `Direct control lets you give exact orders this round. ${left} of ${g.planner.cp().totalBase} CP left. Stance changes are free.` : `Not enough CP (${left} left). Stance changes are free.`}</div>`;
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
  html += `<div class="will"><b>Orders:</b> ${esc(describePlan(g, u, plan))} <span class="dimtxt">Acts in tier ${tierPlanned}.</span></div>`;
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
  html += b('mode:move', 'Move', 'AP per distance', g.uiMode === 'move');
  if (def.melee) html += b('mode:attack', 'Attack', def.strike.ap + ' AP', g.uiMode === 'attack');
  else html += b('mode:shoot', 'Shoot', def.shot.ap + ' AP', g.uiMode === 'shoot');
  html += b('wait', 'Wait', '+10 AP');
  html += '</div></div><div class="btn-group"><span class="grp">Skills</span><div class="btns">';
  for (const k of def.skills) {
    const cd = cdOf(u, k.id);
    const sub = cd > 0 ? `cooldown ${cd}` : planned.has(k.id) ? 'planned' : `${k.ap} AP`;
    html += b('skill:' + k.id, k.name, sub, g.uiMode === k.id || (k.prepaid && plan.buffs.includes(k.id)), cd > 0 || (!k.prepaid && planned.has(k.id)), 'skill');
  }
  html += '</div></div><div class="btn-group"><span class="grp">Prepare</span><div class="btns">';
  html += b('pre:defends', 'Defend +1', `${CONFIG.extraDefendCost} AP · ${plan.defends || 0}`, false, left < CONFIG.extraDefendCost || (plan.defends || 0) >= CONFIG.maxExtraDefends);
  const nu = plan.upgrades || 0;
  html += b('pre:upgrades', 'Tier +1', nu < CONFIG.maxTierUpgrades ? `${CONFIG.tierUpgradeCost[nu]} AP · ${nu}` : 'max', false, nu >= CONFIG.maxTierUpgrades);
  if (def.parry) html += b('pre:parry', 'Parry', CONFIG.parryCost + ' AP', plan.parry);
  if (def.overwatch) html += b('pre:overwatch', 'Overwatch', `${CONFIG.overwatchCost} AP · ${plan.overwatch || 0}`, false, (plan.overwatch || 0) >= CONFIG.maxOverwatch);
  if (u.hp < u.maxHp) html += b('heal', 'Heal', CONFIG.economy.healCost + ' supply', g.planner.draft.heals.includes(u.id));
  html += '</div></div></div><div class="btns foot">';
  html += b('undo', 'Undo', '', false, !plan.hist?.length);
  html += b('tab:stance', '◂ Stance', STANCE_NAMES[P.pendingStance(u)]);
  html += b('release', 'Release', u.type === 'commander' ? 'back to stance' : 'refund 1 CP', false, false, 'danger');
  html += '</div>';
  if (left > 0) html += `<div class="note">${left} AP unassigned. Unassigned AP is lost, so finish with Defend +1.</div>`;
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
  show(`<div class="p-head"><div class="p-icon">${glyph(t, g.me, 34)}</div><div><div class="p-title">Place ${d.name}</div>
    <div class="p-sub">${d.cost} supply · ${d.rounds} rounds · ${buildingDesc(t)}</div></div></div>
    <div class="tagline">▸ Tap inside a build ring to place it</div>
    <div class="btns"><button class="btn" data-act="cancelmode">Cancel</button></div>`);
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
}

export { upgradeCost };
