// HUD rendering: top bar, turn-order strip, selection panel.
import { CONFIG, STANCES, STANCE_NAMES } from '../config.js';
import { glyph } from './icons.js';
import { apFor, cpPools, unitDef, hqOf } from '../sim/state.js';
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
  const pools = cpPools(s, me);
  $('tb-cp').innerHTML = `${c.leftBase}/${pools.base}` + (pools.cmd ? `<small style="font-size:10px;color:#8a8a8a"> ◆${c.leftCmd}</small>` : '');
  $('btn-pause').classList.toggle('hidden', g.mode !== 'ai');
  $('btn-replay').disabled = !g.lastRound || g.phase !== 'planning';
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
    let tier = unitDef(u).tier - u.tierDebuff;
    if (mine) tier += g.planner.plan(u.id)?.upgrades || 0;
    tier = Math.max(CONFIG.minTier, tier);
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(u);
  }
  const tiers = [...groups.keys()].sort((a, b) => b - a);
  let html = '<span class="strip-label">Turn order</span>';
  for (const t of tiers) {
    html += `<div class="tier-col"><span class="tnum">${t}</span>`;
    for (const u of groups.get(t).sort((a, b) => a.owner - b.owner)) {
      const sel = g.selection.includes(u.id) ? ' sel' : '';
      html += `<span class="chip${sel}${u.owner !== me ? ' enemy' : ''}" data-id="${u.id}">${glyph(u.type, u.owner)}</span>`;
    }
    html += '</div>';
  }
  html += '<span class="strip-label">Buildings last</span>';
  strip.innerHTML = html;
  strip.querySelectorAll('.chip').forEach(el => el.onclick = () => g.selectAndFocus(el.dataset.id));
}

function hpBar(e) {
  const f = Math.max(0, e.hp / e.maxHp);
  return `<div class="hpbar${f < 0.34 ? ' low' : ''}"><i style="width:${(f * 100).toFixed(1)}%"></i></div>`;
}

const ACT_LABEL = { move: 'MOVE', wait: 'WAIT', attack: 'ATK', shoot: 'SHOT', frag: 'FRAG', dash: 'DASH', shove: 'SHOVE', disrupt: 'DSRPT' };

function apBarHTML(u, plan, stancePlan) {
  const total = apFor(u);
  let html = '<div class="apbar">';
  const seg = (ap, cls, label) => { if (ap > 0) html += `<div class="seg ${cls}" style="width:${(ap / CONFIG.baseAP) * 100}%">${ap >= 12 ? label : ''}</div>`; };
  const p = plan || stancePlan;
  const cls = plan ? 'act' : 'stance';
  let used = 0;
  if (p) {
    const pre = prepaidCost(u, p);
    seg(pre, plan ? 'pre' : 'stance', 'PRE');
    used += pre;
    p.actions.forEach((a, i) => { const c = actionCost(u, a); seg(c, cls + (i % 2 ? ' alt' : ''), ACT_LABEL[a.kind] || a.kind); used += c; });
  }
  if (total < CONFIG.baseAP) seg(CONFIG.baseAP - total, 'pre', 'WOUND');
  html += `<span class="left">${Math.max(0, total - used)} AP left</span></div>`;
  return html;
}

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
    move: 'Tap a destination (or a unit to follow it)', attack: 'Tap an enemy to attack', shoot: 'Tap where to fire (line shot — aim ahead of moving targets)',
    dash: 'Tap a direction to dash', frag: 'Tap a spot to lob the grenade (passes over walls)', shove: 'Tap an enemy to shove',
    disrupt: 'Tap an enemy unit to disrupt', advance: 'Tap a point to advance towards',
  };
  if (!g.uiMode) return '';
  return `<div class="tagline">▸ ${notes[g.uiMode] || ''} <button class="btn" data-act="cancelmode" style="display:inline-flex;height:28px;min-width:0;margin-left:6px">Cancel</button></div>`;
}

function renderOwnUnit(g, u, show) {
  const def = unitDef(u);
  const P = g.planner;
  const plan = P.plan(u.id);
  const stPlan = plan ? null : g.stancePreview.get(u.id);
  const tierPlanned = Math.max(CONFIG.minTier, def.tier + (plan?.upgrades || 0) - u.tierDebuff);
  const hq = hqOf(g.state, u.owner);
  const nearHQ = hq && dist(hq.x, hq.z, u.x, u.z) <= CONFIG.defenderBonus.radius;
  const freeDef = def.defends + (nearHQ ? CONFIG.defenderBonus.defends : 0);
  const pend = P.pendingStance(u);
  const skill = def.skill;
  const cdTxt = u.cd > 0 ? `${skill.name} in ${u.cd}` : `${skill.name} ready`;
  let html = `<div class="p-head"><div class="p-icon">${glyph(u.type, u.owner, 34)}</div><div>
    <div class="p-title">${def.name} <span class="p-sub">· ${STANCE_NAMES[pend]}${pend !== u.stance ? ' (new)' : ''}</span></div>
    <div class="p-sub">${plan ? 'Direct orders · ' + P.controlCost(u) : 'Following stance · direct control costs ' + P.controlCost(u)}</div></div>
    <div class="p-stats">HP ${u.hp}/${u.maxHp}<br>Tier ${def.tier}${tierPlanned !== def.tier ? '→' + tierPlanned : ''} · Def ${freeDef}${plan?.defends ? '+' + plan.defends : ''}<br>${cdTxt}</div>
    <button class="p-close" data-act="deselect">✕</button></div>`;
  html += hpBar(u) + apBarHTML(u, plan, stPlan) + modeNote(g);
  if (g.panelTab === 'stance') {
    html += stanceButtons(g, [u]);
  } else {
    // slider for last adjustable action
    const last = plan?.actions[plan.actions.length - 1];
    if (last && (last.kind === 'move' || last.kind === 'wait' || last.kind === 'attack' || last.kind === 'shove')) {
      const isMove = last.kind === 'move' || last.kind === 'wait';
      const val = isMove ? last.ap : last.moveAp;
      const strike = last.kind === 'shove' ? skill.ap : last.kind === 'attack' ? def.strike.ap : 0;
      const max = apFor(u) - planCostExcept(u, plan, last) - strike;
      html += `<div class="slider-row"><span>${last.kind === 'wait' ? 'Wait' : isMove ? 'Move AP' : 'Approach AP'}</span>
        <input type="range" min="${isMove ? 1 : 0}" max="${Math.max(isMove ? 1 : 0, max)}" value="${val}" data-act="slider"><b id="slider-v">${val}</b></div>`;
    }
    const left = P.apLeft(u);
    const b = (act, label, sub = '', on = false, dis = false, cls = '') =>
      `<button class="btn${on ? ' on' : ''} ${cls}" data-act="${act}" ${dis ? 'disabled' : ''}>${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
    html += '<div class="btns">';
    html += b('mode:move', 'Move', 'AP/dist', g.uiMode === 'move');
    if (def.melee) html += b('mode:attack', 'Attack', def.strike.ap + ' AP', g.uiMode === 'attack');
    else html += b('mode:shoot', 'Shoot', def.shot.ap + ' AP', g.uiMode === 'shoot');
    if (skill.id === 'fortify') html += b('pre:fortify', 'Fortify', u.cd > 0 ? `cd ${u.cd}` : skill.ap + ' AP', plan?.fortify, u.cd > 0 && !plan?.fortify);
    else html += b('mode:' + skill.id, skill.name, u.cd > 0 ? `cd ${u.cd}` : skill.ap + ' AP', g.uiMode === skill.id, u.cd > 0);
    html += b('wait', 'Wait', '+10 AP');
    html += b('pre:defends', 'Defend+', `${CONFIG.extraDefendCost} AP · ${plan?.defends || 0}`, false, left < CONFIG.extraDefendCost || (plan?.defends || 0) >= CONFIG.maxExtraDefends);
    const nu = plan?.upgrades || 0;
    html += b('pre:upgrades', 'Tier+', nu < CONFIG.maxTierUpgrades ? `${CONFIG.tierUpgradeCost[nu]} AP · ${nu}` : 'max', false, nu >= CONFIG.maxTierUpgrades);
    if (def.parry) html += b('pre:parry', 'Parry', CONFIG.parryCost + ' AP', plan?.parry);
    if (def.overwatch) html += b('pre:overwatch', 'Overwatch', `${CONFIG.overwatchCost} AP · ${plan?.overwatch || 0}`, false, (plan?.overwatch || 0) >= CONFIG.maxOverwatch);
    html += b('tab:stance', 'Stance', STANCE_NAMES[pend]);
    if (u.hp < u.maxHp) html += b('heal', 'Heal', CONFIG.economy.healCost + ' supply', g.planner.draft.heals.includes(u.id));
    html += b('undo', 'Undo', '', false, !plan);
    html += b('clear', 'Clear', '', false, !plan, 'danger');
    html += '</div>';
  }
  show(html);
  bindPanel(g, u);
}

function planCostExcept(u, plan, except) {
  return prepaidCost(u, plan) + plan.actions.reduce((s, a) => s + (a === except ? 0 : actionCost(u, a)), 0);
}

function stanceButtons(g, units) {
  const n = units.length;
  const cost = Math.ceil(n / CONFIG.cp.stanceUnitsPerCP);
  const cur = units.length === 1 ? g.planner.pendingStance(units[0]) : null;
  const desc = {
    guard: 'Melee chase nearby enemies; ranged hold + overwatch',
    hold: 'Do nothing; all AP to extra defends',
    holdground: 'Leashed to this spot; strike nearby enemies',
    advance: 'Walk to a point, fighting enemies on the way',
    retreat: 'Run to the closest outpost / HQ',
  };
  let html = `<div class="tagline">Stance changes cost 1 CP per ${CONFIG.cp.stanceUnitsPerCP} units (this: ${cost} CP). Stances run every round without CP.</div><div class="btns">`;
  for (const st of STANCES) {
    html += `<button class="btn${cur === st ? ' on' : ''}" data-act="stance:${st}" title="${esc(desc[st])}">${STANCE_NAMES[st]}<small>${esc(desc[st].split(';')[0])}</small></button>`;
  }
  html += `<button class="btn" data-act="tab:orders">◂ Back</button></div>`;
  return html;
}

function renderMulti(g, sel, show) {
  const units = sel.filter(e => e.id[0] === 'u' && e.owner === g.me);
  let html = `<div class="p-head"><div class="p-title">${units.length} units selected</div>
    <div class="p-stats">Group order: 1 CP per unit</div><button class="p-close" data-act="deselect">✕</button></div>`;
  html += `<div class="qlist">${units.map(u => `<span class="qitem">${glyph(u.type, u.owner, 12)} ${unitDef(u).name} ${u.hp}/${u.maxHp}</span>`).join('')}</div>`;
  html += modeNote(g);
  if (g.panelTab === 'stance') html += stanceButtons(g, units);
  else {
    html += `<div class="btns">
      <button class="btn${g.uiMode === 'move' ? ' on' : ''}" data-act="mode:move">Move<small>formation</small></button>
      <button class="btn${g.uiMode === 'attack' ? ' on' : ''}" data-act="mode:attack">Attack<small>focus target</small></button>
      <button class="btn" data-act="pre:defends">Defend+<small>each</small></button>
      <button class="btn" data-act="tab:stance">Stance<small>1 CP / ${CONFIG.cp.stanceUnitsPerCP}</small></button>
      <button class="btn danger" data-act="clear">Clear<small>orders</small></button>
    </div>`;
  }
  show(html);
  bindPanel(g, null);
}

function renderEnemyUnit(g, u, show) {
  const def = unitDef(u);
  const sk = u.skillRevealed ? (u.cd > 0 ? `${def.skill.name}: ${u.cd} rounds` : `${def.skill.name}: ready`) : 'Skill: not seen yet';
  const html = `<div class="p-head"><div class="p-icon">${glyph(u.type, u.owner, 34)}</div><div>
    <div class="p-title">Enemy ${def.name}</div><div class="p-sub">Stance at planning start: ${STANCE_NAMES[u.stance]}</div></div>
    <div class="p-stats">HP ${u.hp}/${u.maxHp}<br>Base tier ${Math.max(CONFIG.minTier, def.tier - u.tierDebuff)}${u.tierDebuff ? ' (debuffed)' : ''}<br>${sk}</div>
    <button class="p-close" data-act="deselect">✕</button></div>${hpBar(u)}
    <div class="note">Enemy orders and tier upgrades for this round stay hidden until resolution. ${def.melee ? `Control zone ${def.zone} (dashed ring) slows your units inside.` : ''}</div>`;
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

function bindPanel(g, u, b) {
  const panel = $('panel');
  panel.querySelectorAll('[data-act]').forEach(el => {
    const act = el.dataset.act;
    if (act === 'slider') {
      el.oninput = () => { $('slider-v').textContent = el.value; g.planner.setLastAP(u.id, +el.value); };
      el.onchange = () => g.refreshPanel();
      return;
    }
    el.onclick = ev => { ev.stopPropagation(); g.panelAction(act, u, b); };
  });
}

export { upgradeCost };
