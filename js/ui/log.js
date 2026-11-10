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
