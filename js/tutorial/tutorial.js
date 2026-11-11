// Guided tutorial: one instruction at a time, with the target highlighted.
// Listens to game events (game.on) and only allows the expected action.

const $ = id => document.getElementById(id);

export class Tutorial {
  constructor(game) {
    this.g = game;
    this.i = 0;
    this.offs = [];
    const ids = game.state.tutorialIds;
    this.ids = ids;
    const isUnit = id => (type, d) => type === 'tap' && d.e && d.e.id === id;
    const panel = act => (type, d) => type === 'panel' && d === act;
    const always = () => true;

    this.steps = [
      { title: 'Welcome', text: 'You lead the <b>white</b> pieces. Goal of this lesson: destroy the enemy <b>Outpost</b> (black hexagon, right). Each round has two parts: you <b>plan</b>, then everything <b>plays out</b>.', next: true, allow: () => false },
      { title: 'Select a unit', text: 'Tap your <b>Fighter</b> (the white cube with the pulsing marker).', target: { unit: ids.fighter }, done: ev => ev.name === 'select' && ev.data.id === ids.fighter, allow: isUnit(ids.fighter), hint: 'Tap the white cube marked by the arrow.' },
      { title: 'Stance', text: 'This card shows the unit\'s <b>stance</b>: what it does on its own. "This round it will…" tells you exactly what will happen. Tap <b>Hold</b>.', target: { el: '[data-act="stance:hold"]' }, done: ev => ev.name === 'stance' && ev.data.stance === 'hold', allow: panel('stance:hold'), hint: 'Tap the Hold button in the card.' },
      { title: 'Stances are free', text: 'Hold = stay put and defend. Changing stance is <b>free</b>. Now set it back to <b>Guard</b>.', target: { el: '[data-act="stance:guard"]' }, done: ev => ev.name === 'stance' && ev.data.stance === 'guard', allow: panel('stance:guard'), hint: 'Tap the Guard button.' },
      { title: 'Take control', text: 'To give exact orders, press <b>Control</b>. It costs <b>1 CP</b>; you can control 3 units per round. Everyone else follows their stance.', target: { el: '[data-act="control"]' }, done: ev => ev.name === 'control', allow: panel('control'), hint: 'Press the big Control button.' },
      { title: 'Attack', text: 'Tap <b>Attack</b>, then tap the enemy <b>Ranged</b> (black cylinder). The game gives the unit enough AP to walk there; anything not needed comes back for its next action.', target: { el: '[data-act="mode:attack"]', unit: ids.e1 }, done: ev => ev.name === 'order' && ev.data.kind === 'attack', allow: (t, d) => (t === 'panel' && (d === 'mode:attack' || d === 'cancelmode')) || (t === 'tap' && d.e && d.e.id === ids.e1), hint: 'Tap Attack, then the black cylinder with the arrow.' },
      { title: 'Use all your AP', text: 'The bar shows this unit\'s round: <b>MOVE/ATTACK</b> blocks, and <b>red = unused AP</b>, which is lost. Tap <b>Defend +1</b> to turn leftover AP into protection.', target: { el: '[data-act="pre:defends"]' }, done: ev => ev.name === 'prepaid' && ev.data.field === 'defends', allow: panel('pre:defends'), hint: 'Tap Defend +1.' },
      { title: 'Turn order', text: 'This strip shows <b>who acts first</b>. Fast units (tier 6) go 1st, normal (5) 2nd, slow (4) 3rd. Units in the same tier act <b>at the same time</b>. Your Fighter and the enemy Ranged are both tier 5.', target: { el: '#order-strip' }, next: true, allow: () => false },
      { title: 'Ready', text: 'Your Commander and Ranged will follow their <b>Guard</b> stance: the Ranged shoots at enemies in range by itself. Press <b>READY</b>. (If it warns about unused AP, choose <b>Ready anyway</b>.)', target: { el: '#btn-ready' }, done: ev => ev.name === 'playStart', allow: (t, d) => t === 'ready' || (t === 'panel' && d === 'deselect'), hint: 'Press READY (bottom right).' },
      { title: 'Watch step by step', text: 'The round plays <b>one tier at a time</b>. The bar at the bottom is the tier\'s timeline: each block is an action, the red line is time. Orange rings mark who is acting right now.', done: ev => ev.name === 'tierShown', allow: always },
      { title: 'What just happened', text: 'After each tier you get a summary in plain words. Read it, then tap <b>Next step</b> until the round ends.', target: { el: '[data-tc="next"]' }, done: ev => ev.name === 'digestOpened', allow: always },
      { title: 'Round report', text: 'This card explains the whole round: HP before → after, kills, and <b>why an order failed</b> (⊘). Orange chips on the map mark damage. The coloured icons above units show what they have ready: <b style="color:#1d7fd6">blue shield</b> = defends, <b style="color:#b38600">gold X</b> = parry, <b style="color:#d6143b">red eye</b> = overwatch. Tap <b>Plan next round</b>.', target: { el: '[data-dg="close"].primary' }, done: ev => ev.name === 'digestClosed', allow: always },
      { title: 'Your hero', text: 'Your <b>Commander</b> (white diamond) is a hero: always <b>free</b> to control. Select it, press <b>Control</b>, and try a skill: <b>Rally</b> makes nearby units act a tier earlier, <b>Sweep</b> hits everything next to it. Then attack and press READY.', target: { unit: ids.commander }, done: ev => ev.name === 'playStart', allow: always },
      { title: 'Finish them', text: 'Keep going: control your units, <b>Attack</b> the enemy Ranged units and then the <b>Outpost</b>. Use <b>Next step</b> to follow each round. Destroy the Outpost to finish.', target: { unit: ids.outpost }, done: ev => ev.name === 'roundEnd' && !this.g.state.buildings.some(b => b.id === ids.outpost), allow: always },
      { title: 'Done!', text: 'You know the basics. In a real match you also run a base: <b>Build</b> near your HQ, train units at the HQ or a Barracks, and capture <b>resource nodes</b> (grey hexagons) for income. Destroy the enemy <b>HQ</b> to win.', final: true, allow: always },
    ];
    this.ui();
    document.body.classList.add('tutorial');
    for (const name of ['select', 'stance', 'control', 'order', 'prepaid', 'ready', 'playStart', 'tierShown', 'roundEnd', 'digestOpened', 'digestClosed']) {
      this.offs.push(game.on(name, data => this.onEvent({ name, data })));
    }
    this.show();
  }

  get step() { return this.steps[this.i]; }

  ui() {
    let el = $('coach');
    if (!el) { el = document.createElement('div'); el.id = 'coach'; document.getElementById('hud').appendChild(el); }
    this.el = el;
    let ptr = $('coach-ptr');
    if (!ptr) { ptr = document.createElement('div'); ptr.id = 'coach-ptr'; ptr.textContent = '▼'; document.body.appendChild(ptr); }
    this.ptr = ptr;
  }

  show() {
    const st = this.step;
    document.querySelectorAll('.tut-hl').forEach(e => e.classList.remove('tut-hl'));
    this.el.classList.remove('hidden');
    this.el.innerHTML = `<div class="co-k">Tutorial · ${this.i + 1} / ${this.steps.length}</div>
      <div class="co-title">${st.title}</div><div class="co-text">${st.text}</div>
      <div class="co-btns">${st.final ? '<button class="btn primary" data-co="ai">Play vs AI ▸</button><button class="btn" data-co="menu">Menu</button>'
        : `${st.next ? '<button class="btn primary" data-co="next">Next ▸</button>' : ''}<button class="btn mini" data-co="skip">Skip tutorial</button>`}</div>`;
    this.el.querySelector('[data-co="next"]')?.addEventListener('click', () => this.advance());
    this.el.querySelector('[data-co="skip"]')?.addEventListener('click', ev => {
      const b = ev.currentTarget;
      if (b.dataset.armed) { this.finish(false); return; }
      b.dataset.armed = '1'; b.textContent = 'Tap again to skip';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Skip tutorial'; } }, 2500);
    });
    this.el.querySelector('[data-co="ai"]')?.addEventListener('click', () => { this.finish(true); this.g.restartAI(); });
    this.el.querySelector('[data-co="menu"]')?.addEventListener('click', () => { this.finish(true); location.reload(); });
    if (st.final) { try { localStorage.setItem('tiers-tut-done', '1'); } catch {} }
    // bring the step's unit into view (above the bottom panel on phones)
    const id = st.target?.unit;
    const u = id && (this.g.state.units.find(x => x.id === id) || this.g.state.buildings.find(x => x.id === id));
    if (u && this.g.phase === 'planning') {
      // centre the camera a little "below" the unit so it shows above the bottom panel
      const yaw = this.g.view.cam.yaw, portrait = window.innerHeight > window.innerWidth;
      const k = portrait ? 4 : 2;
      this.g.view.frame([{ x: u.x - Math.sin(yaw) * k, z: u.z + Math.cos(yaw) * k }], 0.6);
    }
  }

  advance() {
    if (this.i < this.steps.length - 1) { this.i++; this.show(); this.g.changed(); }
  }

  onEvent(ev) {
    const st = this.step;
    if (st.done && st.done(ev)) this.advance();
  }

  // Called by the game before handling input. Returns true if allowed.
  allows(type, data) {
    const st = this.step;
    if (!st || !st.allow) return true;
    const ok = st.allow(type, data);
    if (!ok && st.hint) this.g.toast(st.hint, true);
    return ok;
  }

  // per frame: highlight DOM target + pointer over a unit
  tick() {
    const st = this.step;
    if (!st || !st.target) { this.ptr.style.display = 'none'; return; }
    if (st.target.el) {
      const el = document.querySelector(st.target.el);
      if (el && !el.classList.contains('tut-hl')) { document.querySelectorAll('.tut-hl').forEach(e => e.classList.remove('tut-hl')); el.classList.add('tut-hl'); }
    }
    const id = st.target.unit;
    const u = id && (this.g.state.units.find(x => x.id === id) || this.g.state.buildings.find(x => x.id === id));
    const busy = this.g.phase !== 'planning';
    if (!u || busy || (st.target.el && document.querySelector(st.target.el) && !this.g.uiMode && st.title === 'Attack')) { this.ptr.style.display = 'none'; return; }
    const p = this.g.view.project(u.x, 2.6, u.z);
    this.ptr.style.display = '';
    this.ptr.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
  }

  finish(done) {
    for (const off of this.offs) off();
    document.querySelectorAll('.tut-hl').forEach(e => e.classList.remove('tut-hl'));
    this.el.classList.add('hidden');
    this.ptr.style.display = 'none';
    try { localStorage.setItem('tiers-tut-done', '1'); } catch {}
    this.g.tutorial = null;
    document.body.classList.remove('tutorial');
    void done;
  }
}
