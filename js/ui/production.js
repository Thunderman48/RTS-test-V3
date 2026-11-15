// The Production bar: every production queue of your base in one strip above the squad cards.
// One group for the base build queue, one per training building (HQ, Barracks / Ossuary).
// Tap an icon to remove it (the squad in training needs a second tap: it is refunded), drag an
// icon sideways to reorder its queue, tap a group's name to select that building, ＋ to add.
// Mixed into Game. The same queue rows are reused inside the building and builder panels.
import { RULES, BUILDINGS, FACTIONS, trainCost } from '../data/units.js';
import { trainers } from '../sim/base.js';
import { icon } from './iconset.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ProductionUI = {
  // why a queue item waits, in words
  waitText(f) {
    if (!f) return '';
    if (f.starts) return 'Starts this round';
    if (f.drop) return 'Will be dropped: ' + f.drop;
    const eco = this.eco();
    return {
      gold: `Waits: needs ${f.need} more gold`, souls: `Waits: needs ${f.need} more souls`,
      builders: 'Waits for a free builder', blocked: 'Waits: a squad is standing on the spot',
      cap: `Waits: army cap (${this.state.board.cap} squads)`, line: 'Waits its turn',
    }[f.wait] || (f.wait === eco.res ? 'Waits for ' + eco.name.toLowerCase() : 'Waits');
  },
  // the icons of one queue. kind 'b' (base build queue) or 't' (training building b)
  queueRowHTML(kind, b = null) {
    const P = this.planner, fc = P.forecast(), fac = this.faction(this.me), units = FACTIONS[fac].units;
    const cls = f => f?.starts ? ' go' : f?.drop ? ' drop' : f?.wait && f.wait !== 'line' ? ' wait' : '';
    if (kind === 'b') {
      return P.bqList().map((it, i) => {
        const d = BUILDINGS[it.type], f = fc.builds[i];
        return `<button class="pq-it${cls(f)}" data-q="b" data-i="${i}" title="${esc(`#${i + 1} ${d.name[fac]} · ${d.cost} · ${this.waitText(f)} · tap to remove, drag to reorder`)}">${icon(d.icon, 18)}<i class="n">${i + 1}</i></button>`;
      }).join('');
    }
    const tr = P.training(b), list = P.tqList(b), f = fc.trains[b.id] || [];
    let h = '';
    if (tr) {
      const done = (tr.total - tr.left) / tr.total;
      h += `<button class="pq-it cur${this.armCancel === b.id ? ' arm' : ''}" data-q="t" data-bid="${b.id}" data-i="-1" style="--p:${(done * 100).toFixed(0)}%" title="${esc(`Training ${units[tr.role].name}: ${tr.left > 1 ? `ready in ${tr.left} rounds` : 'ready at the end of this round'} · tap twice to stop (refund ${trainCost(fac, tr.role)})`)}">${icon(tr.role, 18)}<i class="rd">${tr.left}</i></button>`;
    } else if (b.train) {
      h += `<button class="pq-it cur stopped" data-q="t" data-bid="${b.id}" data-i="-1" title="Stopped: refunded when the round starts · tap to keep training">${icon(b.train.role, 18)}<i class="rd">✕</i></button>`;
    }
    h += list.map((role, i) => `<button class="pq-it${cls(f[i])}" data-q="t" data-bid="${b.id}" data-i="${i}" title="${esc(`${units[role].name} · ${trainCost(fac, role)} · ${RULES.trainRounds[role]} rd · ${this.waitText(f[i])} · tap to remove, drag to reorder`)}">${icon(role, 18)}</button>`).join('');
    return h;
  },
  prodGroups() {
    if (!this.state || this.phase !== 'planning') return [];
    const fac = this.faction(this.me);
    const gs = [{ kind: 'b', name: 'Build', ic: 'build', n: this.planner.bqList().length, max: RULES.queueMaxBuild }];
    for (const b of trainers(this.state, this.me)) gs.push({ kind: 't', b, name: BUILDINGS[b.type].name[fac], ic: BUILDINGS[b.type].icon, n: this.planner.tqList(b).length, max: RULES.queueMax });
    return gs;
  },
  renderProd() {
    const el = $('prod'); if (!el || this.prodDrag) return;
    const gs = this.prodGroups();
    el.classList.toggle('hidden', !gs.length);
    if (!gs.length) { document.documentElement.style.setProperty('--prod-h', '0px'); return; }
    el.innerHTML = `<span class="pq-t">${icon('queue', 14)}Production</span>` + gs.map(g => `<div class="pq-g${g.b && g.b.id === this.selB ? ' sel' : ''}" data-g="${g.kind}" ${g.b ? `data-bid="${g.b.id}"` : ''}>
        <button class="pq-n" data-pick="${g.b ? g.b.id : 'build'}" title="${g.b ? 'Select' : 'Open the building cards'}">${icon(g.ic, 14)}<span>${esc(g.name)}</span><small>${g.n}/${g.max}</small></button>
        <div class="pq-row">${this.queueRowHTML(g.kind, g.b)}${g.n < g.max ? `<button class="pq-add" data-add="${g.b ? g.b.id : 'build'}" title="Add">＋</button>` : ''}</div></div>`).join('');
    this.wireQueueRows(el);
    document.documentElement.style.setProperty('--prod-h', el.offsetHeight + 6 + 'px');
    el.querySelectorAll('[data-pick]').forEach(x => x.onclick = () => this.pickProd(x.dataset.pick));
    el.querySelectorAll('[data-add]').forEach(x => x.onclick = () => this.pickProd(x.dataset.add));
  },
  pickProd(id) {
    if (id === 'build') { this.openBuild(); return; }
    const b = this.state.buildings.find(x => x.id === id);
    if (b) { this.selectBuilding(b.id); this.focusOn(b); }
  },
  // tap = remove (two taps to stop training); drag sideways = reorder
  wireQueueRows(root) {
    root.querySelectorAll('.pq-it').forEach(el => {
      el.onpointerdown = e => {
        e.stopPropagation();
        const row = el.parentElement, x0 = e.clientX;
        let drag = false;
        const items = [...row.querySelectorAll('.pq-it:not(.cur)')];
        const from = items.indexOf(el);
        let to = from;
        const move = ev => {
          if (!drag && Math.abs(ev.clientX - x0) > 10 && from >= 0 && items.length > 1) { drag = true; this.prodDrag = true; el.classList.add('drag'); try { el.setPointerCapture(e.pointerId); } catch {} }
          if (!drag) return;
          el.style.transform = `translateX(${ev.clientX - x0}px)`;
          to = items.filter(o => o !== el && o.getBoundingClientRect().left + o.offsetWidth / 2 < ev.clientX).length;
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          el.style.transform = ''; el.classList.remove('drag'); this.prodDrag = false;
          if (drag) { if (to !== from) this.reorderQueue(el, from, to); return; }
          this.tapQueueItem(el);
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };
      el.onclick = e => e.stopPropagation();
    });
  },
  reorderQueue(el, i, j) {
    if (el.dataset.q === 'b') this.planner.moveBuild(i, j);
    else this.planner.moveTrain(this.state.buildings.find(b => b.id === el.dataset.bid), i, j);
    this.changed();
  },
  tapQueueItem(el) {
    const i = +el.dataset.i;
    if (el.dataset.q === 'b') { this.planner.unqueueBuild(i); this.toast('Removed from the build queue'); this.changed(); return; }
    const b = this.state.buildings.find(x => x.id === el.dataset.bid); if (!b) return;
    if (i >= 0) { this.planner.unqueueTrain(b, i); this.changed(); return; }
    // the squad in training: first tap arms, second tap stops it (refunded); a stopped one is restored
    if (!this.planner.training(b)) { this.planner.toggleCancel(b); this.changed(); return; }
    if (this.armCancel !== b.id) {
      this.armCancel = b.id; clearTimeout(this.armT);
      this.armT = setTimeout(() => { this.armCancel = null; this.changed(); }, 3000);
      this.toast(`Tap again to stop training (refund ${trainCost(this.faction(this.me), b.train.role)})`);
      this.changed(); return;
    }
    this.armCancel = null;
    this.planner.toggleCancel(b);
    this.toast('Training stopped: refunded when the round starts');
    this.changed();
  },
};
