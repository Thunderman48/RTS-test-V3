// Online play: lobby (both players pick a faction, the host picks the timer), the round
// protocol (the host is authoritative: it resolves each round and sends the result), the
// planning timer and connection health. Mixed into Game.
//
// Messages: hello {v} · lobby {picks, ready, timer} (host -> guest) · pick {faction, ready} ·
// start {seed, factions, timer} · planning {round} · orders {round, orders} · ready {round} ·
// result {round, orders, post} · timer {round, ms} · ping · bye
import { Net, BcNet, randomCode } from '../net/net.js';
import { resolveRound } from '../sim/resolve.js';
import { FACTIONS } from '../data/units.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PROTO = 4;
const TIMERS = [0, 60, 90, 120];
const NetCls = () => (/nettest/.test(location.search) ? BcNet : Net);

export const OnlineUI = {
  bindOnline() {
    $('m-online').onclick = () => this.showLobby('choose');
    $('lb-host').onclick = () => this.hostGame();
    $('lb-join').onclick = () => this.joinGame($('lb-code').value.trim().toUpperCase());
    $('lb-code').addEventListener('keydown', e => { if (e.key === 'Enter') this.joinGame($('lb-code').value.trim().toUpperCase()); });
    $('lb-cancel').onclick = () => this.leaveLobby();
    $('lb-copy').onclick = () => { try { navigator.clipboard.writeText(this.code); this.toast('Code copied'); } catch {} };
  },

  // ---------------------------------------------------------------- lobby
  showLobby(step) {
    $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden');
    for (const id of ['lb-choose', 'lb-room']) $(id).classList.toggle('hidden', id !== 'lb-' + step);
    if (step === 'room') this.renderLobby();
  },
  leaveLobby() {
    try { this.net?.send({ t: 'bye' }); } catch {}
    this.net?.close(); this.net = null;
    $('lobby').classList.add('hidden'); $('menu').classList.remove('hidden');
  },
  async hostGame() {
    const Cls = NetCls(), net = this.net = new Cls();
    this.code = randomCode();
    this.lobby = { picks: ['kingdom', 'undead'], ready: [false, false], timer: 90, joined: false };
    this.netRole = 'host';
    this.showLobby('room');
    $('lb-status').textContent = 'Connecting to matchmaking…';
    try { await net.host(this.code); }
    catch (e) { $('lb-status').textContent = 'Could not host: ' + (e.message || e.type || e); return; }
    $('lb-status').textContent = 'Share the code. Waiting for your opponent…';
    this.renderLobby();
    net.on('msg', m => this.onNet(m));
    net.on('connected', () => { this.lobby.joined = true; $('lb-status').textContent = 'Opponent joined. Pick your armies.'; this.sendLobby(); this.renderLobby(); this.startPing(); });
    net.on('closed', () => this.netClosed());
    net.on('error', e => this.toast('Network: ' + (e.type || e.message || 'error'), true));
  },
  async joinGame(code) {
    if (!/^[A-Z0-9]{5}$/.test(code)) { this.toast('Enter the 5-letter code from the host', true); return; }
    const Cls = NetCls(), net = this.net = new Cls();
    this.code = code; this.netRole = 'guest';
    this.lobby = { picks: ['kingdom', 'undead'], ready: [false, false], timer: 90, joined: true };
    this.showLobby('room');
    $('lb-status').textContent = 'Connecting…';
    net.on('msg', m => this.onNet(m));
    net.on('closed', () => this.netClosed());
    net.on('error', e => { if (!this.match) $('lb-status').textContent = 'Network: ' + (e.type || e.message || 'error'); });
    try { await net.join(code); }
    catch (e) { $('lb-status').textContent = 'Could not join: ' + (e.message || e.type || e); return; }
    $('lb-status').textContent = 'Connected. Pick your army.';
    net.send({ t: 'hello', v: PROTO });
    this.pushPick();
    this.startPing();
    this.renderLobby();
  },
  sendLobby() { if (this.netRole === 'host') this.net?.send({ t: 'lobby', ...this.lobby }); },
  renderLobby() {
    const L = this.lobby; if (!L) return;
    const me = this.netRole === 'host' ? 0 : 1, host = me === 0;
    $('lb-codebox').classList.toggle('hidden', !host);
    $('lb-code-v').textContent = this.code || '·····';
    const row = p => {
      const mine = p === me, f = L.picks[p];
      const btns = Object.keys(FACTIONS).map(k => `<button class="fac-pick ${k}${f === k ? ' on' : ''}" data-f="${k}" ${mine && !L.ready[p] ? '' : 'disabled'}>${esc(FACTIONS[k].name)}</button>`).join('');
      const who = mine ? 'You' : (p === 0 || L.joined ? 'Opponent' : 'Waiting for a player…');
      return `<div class="lb-row${mine ? ' me' : ''}"><div class="lb-who">${who}<small>${p === 0 ? 'host · left side' : 'guest · right side'}</small></div><div class="lb-picks">${btns}</div><span class="lb-ready${L.ready[p] ? ' on' : ''}">${L.ready[p] ? '✓ Ready' : '…'}</span></div>`;
    };
    $('lb-players').innerHTML = row(0) + row(1);
    $('lb-timer').innerHTML = 'Planning timer: ' + TIMERS.map(t => `<button class="chip${L.timer === t ? ' on' : ''}" data-t="${t}" ${host ? '' : 'disabled'}>${t ? t + ' s' : 'Off'}</button>`).join('');
    const both = L.joined && L.ready[0] && L.ready[1];
    $('lb-ready').textContent = L.ready[me] ? 'Not ready' : '✓ Ready';
    $('lb-ready').disabled = !L.joined;
    $('lb-start').classList.toggle('hidden', !host);
    $('lb-start').disabled = !both;
    $('lb-players').querySelectorAll('[data-f]').forEach(el => el.onclick = () => { L.picks[me] = el.dataset.f; this.pushPick(); });
    $('lb-timer').querySelectorAll('[data-t]').forEach(el => el.onclick = () => { L.timer = +el.dataset.t; this.sendLobby(); this.renderLobby(); });
    $('lb-ready').onclick = () => { L.ready[me] = !L.ready[me]; this.pushPick(); };
    $('lb-start').onclick = () => this.hostStart();
  },
  pushPick() {
    const me = this.netRole === 'host' ? 0 : 1;
    if (this.netRole === 'host') this.sendLobby();
    else this.net?.send({ t: 'pick', faction: this.lobby.picks[me], ready: this.lobby.ready[me] });
    this.renderLobby();
  },
  hostStart() {
    const L = this.lobby;
    if (!(L.joined && L.ready[0] && L.ready[1])) return;
    const seed = (Math.random() * 1e9) | 0;
    const msg = { t: 'start', seed, factions: L.picks.slice(), timer: L.timer };
    this.net.send(msg);
    this.beginOnline(msg, 0);
  },
  beginOnline(m, me) {
    $('lobby').classList.add('hidden');
    this.hostOrders = {}; this.guestOrders = {}; this.timerRound = null; this.guestPlanning = null;
    this.start({ mode: me === 0 ? 'host' : 'guest', factions: m.factions, me, seed: m.seed, timer: m.timer });
  },

  // ---------------------------------------------------------------- messages
  onNet(m) {
    this.lastMsg = performance.now();
    if (m.t === 'ping') return;
    if (m.t === 'bye') { this.netClosed(true); return; }
    const L = this.lobby;
    if (!this.match) {
      // still in the lobby
      if (this.netRole === 'host') {
        if (m.t === 'hello') { if (m.v !== PROTO) this.toast('Your opponent runs a different version', true); this.lobby.joined = true; this.sendLobby(); this.renderLobby(); }
        else if (m.t === 'pick') { L.picks[1] = m.faction in FACTIONS ? m.faction : L.picks[1]; L.ready[1] = !!m.ready; this.sendLobby(); this.renderLobby(); }
      } else {
        if (m.t === 'lobby') { const mine = { f: L.picks[1], r: L.ready[1] }; Object.assign(L, m); L.picks[1] = mine.f; L.ready[1] = mine.r; this.renderLobby(); }
        else if (m.t === 'start') this.beginOnline(m, 1);
      }
      return;
    }
    const s = this.state;
    if (this.match === 'host') {
      if (m.t === 'orders' && m.round >= s.round) {
        this.guestOrders[m.round] = m.orders;
        if (m.round === s.round) { if (this.phase === 'waiting') this.hostTryResolve(); else this.toast('Your opponent is ready'); }
      } else if (m.t === 'planning') { this.guestPlanning = m.round; this.maybeStartTimer(); }
    } else if (this.match === 'guest') {
      if (m.t === 'result') this.guestResult(m);
      else if (m.t === 'ready' && m.round === s.round && this.phase === 'planning') this.toast('Your opponent is ready');
      else if (m.t === 'timer' && m.round === s.round) this.deadline = performance.now() + m.ms;
    }
  },
  // my orders for this round (online): send them / wait for the other side
  onlineReady(mine) {
    const r = this.state.round;
    this.phase = 'waiting';
    this.changed();
    this.setWaiting(true);
    if (this.match === 'host') { this.hostOrders[r] = mine; this.net.send({ t: 'ready', round: r }); this.hostTryResolve(); }
    else this.net.send({ t: 'orders', round: r, orders: mine });
  },
  hostTryResolve() {
    const r = this.state.round;
    if (!this.hostOrders[r] || !this.guestOrders[r] || this.phase !== 'waiting') return;
    const orders = [this.hostOrders[r], this.guestOrders[r]];
    const pre = this.state;
    const { state: post, log } = resolveRound(pre, orders);
    this.net.send({ t: 'result', round: r, orders, post });
    this.setWaiting(false);
    this.play(pre, log, post);
  },
  guestResult(m) {
    const pre = this.state;
    if (m.round !== pre.round) { this.state = m.post; this.beginPlanning(); return; }
    let log;
    try {
      const r = resolveRound(pre, m.orders);
      log = r.log;
      if (JSON.stringify(r.state) !== JSON.stringify(m.post)) console.warn('online: local result differs from the host; using the host\'s');
    } catch (e) { console.error(e); log = { round: pre.round, segments: [] }; }
    this.setWaiting(false);
    this.play(pre, log, m.post);
  },
  setWaiting(on) {
    const b = $('b-ready');
    b.classList.toggle('waiting', on);
    b.innerHTML = on ? 'Waiting for your opponent…' : 'Ready <span>▸</span>';
  },

  // ---------------------------------------------------------------- planning timer
  onlinePlanning() {
    if (this.match === 'guest') this.net.send({ t: 'planning', round: this.state.round });
    if (this.match === 'host') { this.deadline = null; this.maybeStartTimer(); }
    if (this.match === 'guest') this.deadline = null;
  },
  maybeStartTimer() {
    if (this.match !== 'host' || !this.timerMs) return;
    if (this.guestPlanning !== this.state.round || this.timerRound === this.state.round) return;
    if (this.phase !== 'planning' && this.phase !== 'waiting') return;
    this.timerRound = this.state.round;
    this.deadline = performance.now() + this.timerMs;
    this.net.send({ t: 'timer', round: this.state.round, ms: this.timerMs });
  },
  tickTimer() {
    const el = $('t-timer');
    if (!this.deadline || (this.phase !== 'planning' && this.phase !== 'waiting')) { el.classList.add('hidden'); return; }
    const left = Math.max(0, (this.deadline - performance.now()) / 1000);
    el.classList.remove('hidden');
    el.textContent = left >= 60 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : `${Math.ceil(left)}s`;
    el.classList.toggle('low', left < 10);
    if (left <= 0 && this.phase === 'planning') { this.toast('Time is up: your orders were sent', true); this.ready(); }
    // the host waits a few seconds more for a guest that didn't answer, then resolves without it
    if (this.match === 'host' && this.phase === 'waiting' && left <= 0 && performance.now() - this.deadline > 8000 && !this.guestOrders[this.state.round]) {
      this.guestOrders[this.state.round] = { squads: {}, stances: {}, builds: [], trains: [] };
      this.hostTryResolve();
    }
  },

  // ---------------------------------------------------------------- connection health
  startPing() {
    this.lastMsg = performance.now();
    clearInterval(this.pinger);
    this.pinger = setInterval(() => {
      if (!this.net) { clearInterval(this.pinger); return; }
      this.net.send({ t: 'ping' });
      const quiet = (performance.now() - this.lastMsg) / 1000;
      if (quiet > 60) this.netClosed();
      else if (quiet > 12 && !this.warnedQuiet) { this.warnedQuiet = true; this.toast('Connection unstable…', true); }
      else if (quiet < 5) this.warnedQuiet = false;
    }, 3000);
  },
  netClosed(left = false) {
    clearInterval(this.pinger);
    if (!this.net) return;
    this.net.close(); this.net = null;
    if (!this.match) { $('lb-status').textContent = left ? 'Your opponent left the lobby.' : 'Connection closed.'; if (this.lobby) { this.lobby.joined = this.netRole === 'guest'; this.lobby.ready = [false, false]; this.renderLobby(); } return; }
    if (this.state?.winner !== null && this.state?.winner !== undefined) return;
    $('over-title').textContent = 'Opponent left';
    $('over-msg').textContent = left ? 'Your opponent left the battle.' : 'The connection to your opponent was lost.';
    $('over').classList.remove('hidden');
    this.phase = 'over';
  },
};
