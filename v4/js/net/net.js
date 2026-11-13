// Online multiplayer over WebRTC using PeerJS (works from static hosting like GitHub Pages).
// The host is authoritative: it resolves each round and sends the result to the guest.
const PREFIX = 'tiers-v4-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode() {
  let s = '';
  const a = new Uint32Array(5); crypto.getRandomValues(a);
  for (const v of a) s += ALPHA[v % ALPHA.length];
  return s;
}

export class Net {
  constructor() { this.peer = null; this.conn = null; this.handlers = {}; this.isHost = false; this.closed = false; }
  on(t, fn) { this.handlers[t] = fn; return this; }
  emit(t, d) { this.handlers[t]?.(d); }

  available() { return typeof window.Peer === 'function' || typeof window.peerjs?.Peer === 'function'; }
  PeerCls() { return window.Peer || window.peerjs.Peer; }

  host(code) {
    this.isHost = true;
    return new Promise((resolve, reject) => {
      if (!this.available()) return reject(new Error('PeerJS failed to load'));
      const P = this.PeerCls();
      this.peer = new P(PREFIX + code, { debug: 1 });
      const to = setTimeout(() => reject(new Error('Could not reach the matchmaking server')), 15000);
      this.peer.on('open', () => { clearTimeout(to); resolve(code); });
      this.peer.on('error', err => {
        clearTimeout(to);
        if (err.type === 'unavailable-id') reject(new Error('Code already in use, try again'));
        else { reject(err); this.emit('error', err); }
      });
      this.peer.on('connection', conn => {
        if (this.conn) { conn.close(); return; }
        this.attach(conn);
      });
      this.peer.on('disconnected', () => { if (!this.closed && this.peer && !this.peer.destroyed) this.peer.reconnect(); });
    });
  }

  join(code) {
    this.isHost = false;
    return new Promise((resolve, reject) => {
      if (!this.available()) return reject(new Error('PeerJS failed to load'));
      const P = this.PeerCls();
      this.peer = new P(undefined, { debug: 1 });
      const to = setTimeout(() => reject(new Error('Could not connect — check the code')), 20000);
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        conn.on('open', () => { clearTimeout(to); resolve(); });
        this.attach(conn);
      });
      this.peer.on('error', err => {
        clearTimeout(to);
        if (err.type === 'peer-unavailable') reject(new Error('No game found with that code'));
        else reject(err);
        this.emit('error', err);
      });
    });
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => { this.flush(); this.emit('connected'); });
    conn.on('data', d => { try { this.emit('msg', typeof d === 'string' ? JSON.parse(d) : d); } catch (e) { console.error(e); } });
    conn.on('close', () => { if (!this.closed) this.emit('closed'); });
    conn.on('error', e => this.emit('error', e));
    if (conn.open) this.emit('connected');
  }

  send(msg) {
    if (!this.conn) return false;
    if (!this.conn.open) { (this.outbox ||= []).push(msg); return true; } // sent once the channel opens
    this.flush();
    this.conn.send(JSON.stringify(msg));
    return true;
  }

  flush() {
    if (!this.conn?.open || !this.outbox?.length) return;
    const q = this.outbox; this.outbox = [];
    for (const m of q) this.conn.send(JSON.stringify(m));
  }

  close() {
    this.closed = true;
    try { this.conn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.conn = null; this.peer = null;
  }
}

// In-memory transport pair for testing the protocol without the network.
export function loopbackPair() {
  const mk = () => ({ handlers: {}, isHost: false, on(t, f) { this.handlers[t] = f; return this; }, emit(t, d) { this.handlers[t]?.(d); }, close() {} });
  const a = mk(), b = mk();
  a.isHost = true;
  a.send = m => { setTimeout(() => b.emit('msg', JSON.parse(JSON.stringify(m))), 5); return true; };
  b.send = m => { setTimeout(() => a.emit('msg', JSON.parse(JSON.stringify(m))), 5); return true; };
  return [a, b];
}

// Test transport: two pages of the same browser talk over a BroadcastChannel (?nettest).
export class BcNet {
  constructor() { this.handlers = {}; this.isHost = false; this.closed = false; this.me = Math.random().toString(36).slice(2); }
  on(t, fn) { this.handlers[t] = fn; return this; }
  emit(t, d) { this.handlers[t]?.(d); }
  available() { return typeof BroadcastChannel === 'function'; }
  open(code) {
    this.ch = new BroadcastChannel('tiers-v4-test-' + code);
    this.ch.onmessage = e => {
      const m = e.data; if (!m || m.from === this.me) return;
      if (m.sys === 'join' && this.isHost && !this.peerId) { this.peerId = m.from; this.ch.postMessage({ sys: 'welcome', to: m.from, from: this.me }); this.emit('connected'); return; }
      if (m.sys === 'welcome' && m.to === this.me) { this.peerId = m.from; this.joined?.(); this.emit('connected'); return; }
      if (m.sys === 'bye' && m.from === this.peerId) { if (!this.closed) this.emit('closed'); return; }
      if (m.msg && m.from === this.peerId) this.emit('msg', JSON.parse(JSON.stringify(m.msg)));
    };
  }
  host(code) { this.isHost = true; this.open(code); return Promise.resolve(code); }
  join(code) {
    this.isHost = false; this.open(code.toUpperCase());
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('No game found with that code')), 6000);
      this.joined = () => { clearTimeout(to); resolve(); };
      this.ch.postMessage({ sys: 'join', from: this.me });
    });
  }
  send(msg) { if (!this.ch || !this.peerId) return false; this.ch.postMessage({ msg, from: this.me }); return true; }
  close() { this.closed = true; try { this.ch?.postMessage({ sys: 'bye', from: this.me }); this.ch?.close(); } catch {} this.ch = null; }
}
