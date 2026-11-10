// "What happened": plain-language event feed during playback + round report afterwards.
import { CONFIG } from '../config.js';
import { glyph } from './icons.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// names: id -> {type, owner, kind:'u'|'b'}
export function nameMap(...states) {
  const m = new Map();
  for (const s of states) {
    if (!s) continue;
    for (const u of s.units) m.set(u.id, { type: u.type, owner: u.owner, kind: 'u' });
    for (const b of s.buildings) m.set(b.id, { type: b.type, owner: b.owner, kind: 'b' });
  }
  return m;
}

function who(names, id, me) {
  const n = names.get(id);
  if (!n) return { txt: 'Someone', owner: -1, html: 'Someone' };
  const nm = n.kind === 'u' ? CONFIG.units[n.type].name : CONFIG.buildings[n.type].name;
  const txt = (n.owner === me ? 'Your ' : 'Enemy ') + nm;
  return { txt, owner: n.owner, html: `<span class="who ${n.owner === me ? 'me' : 'en'}">${glyph(n.kind === 'u' ? n.type : n.type, n.owner, 12)} ${esc(txt)}</span>` };
}

// Returns {html, mine:bool, kind} or null for events not worth a line.
export function describe(e, names, me) {
  const W = id => who(names, id, me);
  switch (e.type) {
    case 'act': return null; // shown as floating tags over the unit instead
    case 'hit': {
      const verbs = { melee: 'hits', shot: 'shoots', overwatch: 'overwatch-shoots', counter: 'counter-attacks', turret: 'fires at', frag: 'Frag hits', sweep: 'Sweep hits', shove: 'shoves' };
      const src = W(e.src), dst = W(e.dst);
      const verb = verbs[e.kind] || 'hits';
      const how = e.cover ? ' (cover)' : e.defended ? ' (defended)' : '';
      const body = (e.kind === 'frag' || e.kind === 'sweep') ? `${src.html}'s ${verb} ${dst.html}` : `${src.html} ${verb} ${dst.html}`;
      return { ...line(`${body} <b class="dmg">−${e.dmg}</b>${how}`, e, names, me, 'hit'), dealt: src.owner === me ? e.dmg : 0, taken: dst.owner === me ? e.dmg : 0 };
    }
    case 'parry': return line(`${W(e.id).html} <b>parries</b> ${W(e.src).html}`, e, names, me, 'parry');
    case 'miss': return line(`${W(e.id).html} misses ${W(e.target).html} (moved out of reach)`, e, names, me, 'miss');
    case 'death': {
      const d = W(e.id);
      return { ...line(`✕ ${d.html} ${d.owner === me ? 'was lost' : 'was killed'}`, e, names, me, 'death'), lost: d.owner === me ? 1 : 0, killed: d.owner !== me ? 1 : 0 };
    }
    case 'bdestroy': return line(`✕ ${W(e.id).html} destroyed`, e, names, me, 'death');
    case 'skill': return line(`${W(e.id).html} uses <b>${esc(e.name || e.skill)}</b>`, e, names, me, 'skill');
    case 'cancel': return line(`${W(e.id).html}: ${esc(e.reason)}`, e, names, me, 'cancel');
    case 'retarget': return line(`${W(e.id).html} switches target to ${W(e.target).html}`, e, names, me, 'miss');
    case 'disrupt': return line(`${W(e.id).html} disrupts ${W(e.target).html}: −${e.drained} AP, tier −1${e.tierNow ? '' : ' next round'}`, e, names, me, 'skill');
    case 'rally': return line(`${W(e.id).html} rallies ${e.ids.length} unit${e.ids.length === 1 ? '' : 's'}: +1 tier this round`, e, names, me, 'skill');
    case 'spawn': return line(e.revive ? `${W(e.id).html} revived` : `${W(e.id).html} is ready`, e, names, me, 'econ');
    case 'built': return line(`${W(e.id).html} finished building`, e, names, me, 'econ');
    case 'build': return line(`${W(e.id).html} construction started`, e, names, me, 'econ');
    case 'capture': return { html: `Resource node ${e.owner === me ? 'captured' : 'lost to the enemy'}`, mine: e.owner === me, kind: 'econ', owner: e.owner };
    case 'heal': if (e.regen) return null; return line(`${W(e.id).html} healed +${e.amount}`, e, names, me, 'econ');
    case 'zoneoff': return null;
    case 'revivezone': return { html: `${e.owner === me ? 'Your' : 'Enemy'} commander fell: hold the spot to revive`, mine: e.owner === me, kind: 'death', owner: e.owner };
    default: return null;
  }
}

function line(html, e, names, me, kind) {
  const n = names.get(e.id || e.src);
  return { html, mine: n ? n.owner === me : false, kind };
}

// Which events involve something the viewer could see (own stuff is always visible)
export function involvesVisible(e, names, me, visId) {
  const ids = [e.id, e.src, e.dst, e.target].filter(Boolean);
  if (!ids.length) return true;
  return ids.some(id => { const n = names.get(id); return n && (n.owner === me || visId(id)); });
}

export class Feed {
  constructor(el) { this.el = el; this.items = []; }
  clear() { this.items = []; this.el.innerHTML = ''; this.el.classList.add('hidden'); }
  push(d, label) {
    this.el.classList.remove('hidden');
    const div = document.createElement('div');
    div.className = `feed-line ${d.kind}${d.mine ? ' mine' : ''}`;
    div.innerHTML = (label ? `<span class="ftier">${esc(label)}</span>` : '') + d.html;
    div.dataset.label = this.cur = label || this.cur || '';
    this.el.appendChild(div); // oldest on top, newest at the bottom
    const max = window.innerWidth < 720 ? 3 : 6;
    while (this.el.children.length > max) this.el.firstChild.remove();
    const first = this.el.firstChild;
    if (first && !first.querySelector('.ftier') && first.dataset.label) first.insertAdjacentHTML('afterbegin', `<span class="ftier">${esc(first.dataset.label)}</span>`);
  }
}

export function reportHTML(report) {
  const s = report.sum;
  let html = `<div class="rep-sum">
    <div><span class="k">Damage dealt</span><b>${s.dealt}</b></div>
    <div><span class="k">Damage taken</span><b>${s.taken}</b></div>
    <div><span class="k">Enemies killed</span><b>${s.killed}</b></div>
    <div><span class="k">Units lost</span><b>${s.lost}</b></div></div>`;
  let cur = null;
  for (const l of report.lines) {
    if (l.label !== cur) { if (cur !== null) html += '</div>'; cur = l.label; html += `<h4>${esc(l.label)}</h4><div class="rep-group">`; }
    html += `<div class="feed-line ${l.kind}${l.mine ? ' mine' : ''}">${l.html}</div>`;
  }
  if (cur !== null) html += '</div>';
  if (!report.lines.length) html += '<p class="note">Nothing visible happened.</p>';
  return html;
}

export function segLabel(seg) {
  if (!seg) return '';
  if (seg.kind === 'start') return 'Start of round';
  if (seg.kind === 'buildings') return 'Buildings & economy';
  const n = { 6: ' · fast', 5: ' · normal', 4: ' · slow' }[seg.tier] || '';
  return 'Tier ' + seg.tier + n;
}

// ---------------------------------------------------------------------------------
// Round digest: per-unit "what happened to my units and why", enemy summary, base.
// visible(id) -> whether the viewer could see that entity during the round
export function buildDigest(pre, log, post, me, myOrders, visible = () => true) {
  const names = nameMap(pre, post);
  const unitName = id => { const n = names.get(id); return n ? (n.kind === 'u' ? CONFIG.units[n.type].name : CONFIG.buildings[n.type].name) : '?'; };
  const rows = new Map();
  const row = id => {
    if (!rows.has(id)) {
      const u0 = pre.units.find(u => u.id === id), u1 = post.units.find(u => u.id === id);
      const u = u0 || u1;
      rows.set(id, {
        id, type: u.type, hpBefore: u0 ? u0.hp : null, hpAfter: u1 ? u1.hp : 0, maxHp: u.maxHp,
        died: false, spawned: !u0, dealt: 0, taken: 0, kills: [], hitBy: new Map(), did: [], fails: [],
        controlled: !!(myOrders && myOrders.units && myOrders.units[id]), stance: u0 ? u0.stance : (u1 ? u1.stance : ''),
      });
    }
    return rows.get(id);
  };
  for (const u of pre.units) if (u.owner === me && u.hp > 0) row(u.id);
  const lastHitter = new Map();
  const enemy = { dealt: 0, killedMine: 0, seen: new Set(), lost: 0 };
  const base = { income: log.econ ? log.econ.income[me] : 0, built: [], ready: [], captured: 0, lostNodes: 0, buildingsLost: [], enemyBuildingsKilled: [] };
  const own = id => names.get(id)?.owner === me;
  const ACT = { attack: 'attacked', shoot: 'fired', move: 'moved', dash: 'dashed', frag: 'threw a Frag', shove: 'shoved', disrupt: 'used Disrupt', sweep: 'used Sweep' };
  for (const seg of log.segments) for (const e of seg.events) {
    switch (e.type) {
      case 'act':
        if (own(e.id) && ACT[e.kind]) { const r = row(e.id); const w = ACT[e.kind] + (e.target && e.kind === 'attack' ? ' ' + (own(e.target) ? 'your ' : 'enemy ') + unitName(e.target) : ''); if (r.did[r.did.length - 1] !== w) r.did.push(w); }
        if (!own(e.id) && visible(e.id)) enemy.seen.add(e.id);
        break;
      case 'skill': if (own(e.id)) { const r = row(e.id); if (e.skill === 'fortify' || e.skill === 'rally') r.did.unshift('used ' + (e.name || e.skill)); } break;
      case 'hit': {
        lastHitter.set(e.dst, e.src);
        if (own(e.src) && names.get(e.src)?.kind === 'u') row(e.src).dealt += e.dmg;
        if (own(e.dst) && names.get(e.dst)?.kind === 'u') {
          const r = row(e.dst); r.taken += e.dmg;
          const k = (own(e.src) ? 'your ' : 'enemy ') + unitName(e.src);
          r.hitBy.set(k, (r.hitBy.get(k) || 0) + e.dmg);
        }
        if (!own(e.src) && own(e.dst)) enemy.dealt += e.dmg;
        break;
      }
      case 'death': {
        const killer = lastHitter.get(e.id);
        if (own(e.id)) { row(e.id).died = true; enemy.killedMine++; }
        else if (killer && own(killer) && names.get(killer)?.kind === 'u') row(killer).kills.push(unitName(e.id));
        if (!own(e.id)) enemy.lost++;
        break;
      }
      case 'bdestroy': (own(e.id) ? base.buildingsLost : base.enemyBuildingsKilled).push(unitName(e.id)); break;
      case 'cancel': case 'miss': if (own(e.id)) row(e.id).fails.push(e.reason || 'Order failed'); break;
      case 'dashstop': if (own(e.id)) row(e.id).fails.push(`Dash stopped early: hit ${e.code === 'wall' ? 'a wall' : 'a unit'}`); break;
      case 'built': if (own(e.id)) base.built.push(unitName(e.id)); break;
      case 'spawn': if (e.owner === me) base.ready.push(unitName(e.id)); break;
      case 'capture': if (e.owner === me) base.captured++; else base.lostNodes++; break;
    }
  }
  const units = [...rows.values()].filter(r => !r.spawned);
  for (const r of units) {
    r.summary = r.did.length ? r.did.join(', ') : (r.controlled ? 'did nothing (no actions given)' : `followed ${r.stance} stance: held and defended`);
    r.hitByText = [...r.hitBy].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ');
  }
  const hurt = new Map();
  for (const seg of log.segments) for (const e of seg.events) if (e.type === 'hit' && names.get(e.dst)?.kind === 'u' && (own(e.dst) || visible(e.dst))) hurt.set(e.dst, (hurt.get(e.dst) || 0) + e.dmg);
  return { me, round: log.round, units, byId: new Map(units.map(r => [r.id, r])), enemy: { ...enemy, seen: enemy.seen.size }, base, supply: post.players[me].supply, hurt };
}

export function digestHTML(d) {
  const S = d.units.reduce((a, r) => ({ dealt: a.dealt + r.dealt, taken: a.taken + r.taken, kills: a.kills + r.kills.length }), { dealt: 0, taken: 0, kills: 0 });
  let html = `<div class="rep-sum">
    <div><span class="k">You dealt</span><b>${S.dealt}</b></div>
    <div><span class="k">You took</span><b>${S.taken}</b></div>
    <div><span class="k">Enemies killed</span><b>${d.enemy.lost}</b></div>
    <div><span class="k">Units lost</span><b>${d.enemy.killedMine}</b></div></div>`;
  html += '<h4>Your units</h4><div class="dg-units">';
  for (const r of d.units) {
    const hp = r.died ? '<b class="dead">DIED</b>' : `${r.hpBefore}→<b>${r.hpAfter}</b>`;
    const delta = r.died ? '' : r.hpAfter < r.hpBefore ? ` <span class="minus">−${r.hpBefore - r.hpAfter}</span>` : r.hpAfter > r.hpBefore ? ` <span class="plus">+${r.hpAfter - r.hpBefore}</span>` : '';
    html += `<div class="dg-row${r.died ? ' died' : ''}${r.fails.length ? ' failed' : ''}" data-id="${r.id}">
      <div class="dg-top">${glyph(r.type, d.me, 14)} <b>${CONFIG.units[r.type].name}</b> <span class="dg-ctl">${r.controlled ? 'your orders' : 'stance'}</span><span class="dg-hp">HP ${hp}${delta}</span></div>
      <div class="dg-did">${esc(r.summary[0].toUpperCase() + r.summary.slice(1))}.${r.dealt ? ` Dealt <b>${r.dealt}</b>.` : ''}${r.kills.length ? ` Killed ${esc(r.kills.join(', '))}.` : ''}${r.taken ? ` Took ${r.taken} from ${esc(r.hitByText)}.` : ''}</div>
      ${r.fails.map(f => `<div class="dg-fail">⊘ ${esc(f)}</div>`).join('')}
    </div>`;
  }
  html += '</div>';
  html += `<h4>Enemy (what you could see)</h4><div class="dg-text">${d.enemy.seen ? `${d.enemy.seen} enemy unit${d.enemy.seen > 1 ? 's' : ''} acted in view. ` : 'No enemy acted in view. '}They dealt <b>${d.enemy.dealt}</b> damage to you${d.enemy.killedMine ? ` and killed ${d.enemy.killedMine} of your units` : ''}.${d.base.enemyBuildingsKilled.length ? ` You destroyed: ${esc(d.base.enemyBuildingsKilled.join(', '))}.` : ''}</div>`;
  const b = d.base;
  const parts = [`+${b.income} supply (now ${d.supply})`];
  if (b.built.length) parts.push('finished ' + b.built.join(', '));
  if (b.ready.length) parts.push('ready: ' + b.ready.join(', '));
  if (b.captured) parts.push(`captured ${b.captured} node${b.captured > 1 ? 's' : ''}`);
  if (b.lostNodes) parts.push(`lost ${b.lostNodes} node${b.lostNodes > 1 ? 's' : ''}`);
  if (b.buildingsLost.length) parts.push('LOST ' + b.buildingsLost.join(', '));
  html += `<h4>Your base</h4><div class="dg-text">${esc(parts.join(' · '))}</div>`;
  return html;
}
