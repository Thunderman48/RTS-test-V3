// Unified mouse + touch input for the 3D view.
//  - tap / click: select or issue order
//  - one-finger drag / left-drag: pan
//  - pinch: zoom, two-finger twist: rotate, two-finger drag: pan
//  - mouse wheel: zoom, right-drag: rotate
//  - long press: secondary tap (adds to selection)
export class Input {
  constructor(canvas, view, handlers) {
    this.c = canvas; this.view = view; this.h = handlers;
    this.pts = new Map();
    this.drag = false;
    this.longTimer = null;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e, true));
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.up(e, true); });
    canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousemove', e => { if (!this.pts.size) this.h.hover?.(e.clientX, e.clientY); });
    this.keys = new Set();
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      this.h.key?.(e);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
  }

  down(e) {
    this.c.setPointerCapture?.(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button });
    if (this.pts.size === 1) {
      this.drag = false; this.multi = false;
      clearTimeout(this.longTimer);
      this.longTimer = setTimeout(() => {
        const p = this.pts.get(e.pointerId);
        if (p && !this.drag && this.pts.size === 1) { this.longFired = true; this.h.longpress?.(p.x, p.y); }
      }, 520);
      this.longFired = false;
    } else {
      this.multi = true; this.drag = true; clearTimeout(this.longTimer);
      this.initGesture();
    }
  }

  initGesture() {
    const [a, b] = [...this.pts.values()];
    this.g = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  move(e) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pts.size === 1) {
      if (!this.drag && Math.hypot(p.x - p.sx, p.y - p.sy) > 9) { this.drag = true; clearTimeout(this.longTimer); }
      if (this.drag) {
        if (p.btn === 2) this.view.rotate(dx * 0.006);
        else this.view.panPixels(dx, dy);
      }
    } else if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (this.g && this.g.d > 0) this.view.zoom(this.g.d / Math.max(1, d));
      let da = ang - this.g.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      this.view.rotate(-da);
      this.view.panPixels(mx - this.g.mx, my - this.g.my);
      this.g = { d, ang, mx, my };
    }
  }

  up(e, cancel = false) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    this.pts.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.pts.size === 2) this.initGesture();
    if (this.pts.size > 0) return;
    if (!cancel && !this.drag && !this.multi && !this.longFired && performance.now() - p.t < 700) {
      if (p.btn === 2) this.h.secondary?.(p.x, p.y);
      else this.h.tap?.(p.x, p.y, e);
    }
    this.drag = false; this.multi = false;
  }

  // keyboard camera movement, called every frame
  tick(dt) {
    const k = this.keys; if (!k.size) return;
    const sp = 600 * dt;
    if (k.has('w') || k.has('arrowup')) this.view.panPixels(0, sp);
    if (k.has('s') || k.has('arrowdown')) this.view.panPixels(0, -sp);
    if (k.has('a') || k.has('arrowleft')) this.view.panPixels(sp, 0);
    if (k.has('d') || k.has('arrowright')) this.view.panPixels(-sp, 0);
    if (k.has('q')) this.view.rotate(-1.5 * dt);
    if (k.has('e')) this.view.rotate(1.5 * dt);
  }
}
