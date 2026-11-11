// Renderer, camera rig and lights for the tabletop.
import * as THREE from 'three';
import { RULES } from '../data/units.js';

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d1915);
    this.scene.fog = new THREE.Fog(0x1d1915, 70, 140);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);
    const W = RULES.board.w, H = RULES.board.h;
    this.W = W; this.H = H;
    this.cam = { x: W / 2, z: H / 2, dist: 46, yaw: 0, pitch: 0.95 };

    // warm "games room" lighting
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3b2f24, 1.0));
    const key = new THREE.DirectionalLight(0xffe2b8, 2.3);
    key.position.set(W / 2 - 18, 34, H / 2 + 22);
    key.target.position.set(W / 2, 0, H / 2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 100;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.45);
    fill.position.set(W / 2 + 20, 18, H / 2 - 20);
    this.scene.add(fill);

    this.layers = {};
    for (const n of ['table', 'units', 'plan', 'fx', 'ghost']) { this.layers[n] = new THREE.Group(); this.scene.add(this.layers[n]); }
    this.fx = [];
    this.raycaster = new THREE.Raycaster();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 52 : 36;
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const c = this.cam;
    c.x = Math.max(-4, Math.min(this.W + 4, c.x));
    c.z = Math.max(-4, Math.min(this.H + 4, c.z));
    c.dist = Math.max(10, Math.min(80, c.dist));
    c.pitch = Math.max(0.55, Math.min(1.35, c.pitch));
    const horiz = Math.cos(c.pitch) * c.dist;
    this.camera.position.set(c.x - Math.sin(c.yaw) * horiz, Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * horiz);
    this.camera.lookAt(c.x, 0, c.z);
  }
  panPixels(dx, dy) {
    this.camAnim = null;
    const h = this.canvas.clientHeight || 600;
    const k = (this.cam.dist * Math.tan((this.camera.fov * Math.PI) / 360) * 2) / h;
    const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw), sp = Math.sin(this.cam.pitch);
    this.cam.x -= (dx * cy - dy * sy / sp) * k;
    this.cam.z -= (dx * sy + dy * cy / sp) * k;
  }
  zoom(f) { this.camAnim = null; this.cam.dist *= f; }
  rotate(da) { this.camAnim = null; this.cam.yaw += da; }
  tilt(dp) { this.camAnim = null; this.cam.pitch += dp; }
  frame(points, dur = 0.6, minDist = 18) {
    if (!points.length) return;
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (const p of points) { a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.z); d = Math.max(d, p.z); }
    const span = Math.max(b - a, d - c);
    const portrait = this.canvas.clientHeight > this.canvas.clientWidth;
    const dist = Math.max(minDist, Math.min(60, span * (portrait ? 1.9 : 1.5) + 10));
    this.camAnim = { t: 0, dur, from: { ...this.cam }, to: { x: (a + b) / 2, z: (c + d) / 2, dist } };
  }

  pick(clientX, clientY, y = 0) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p)) return null;
    return { x: p.x, z: p.z };
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height, behind: v.z > 1 };
  }
  pxPerInch(x, z) { const a = this.project(x, 0, z), b = this.project(x + 1, 0, z); return Math.hypot(a.x - b.x, a.y - b.y); }

  clear(name) { const g = this.layers[name]; for (const c of [...g.children]) { g.remove(c); dispose(c); } }

  addFx(obj, life, update) { this.layers.fx.add(obj); this.fx.push({ obj, life, t: 0, update }); }

  render(dt) {
    this.time = (this.time || 0) + dt;
    for (const f of [...this.fx]) {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { this.layers.fx.remove(f.obj); dispose(f.obj); this.fx.splice(this.fx.indexOf(f), 1); continue; }
      f.update && f.update(f.obj, k, dt);
    }
    if (this.camAnim) {
      const A = this.camAnim; A.t += dt;
      const k = Math.min(1, A.t / A.dur), e = k * k * (3 - 2 * k);
      this.cam.x = A.from.x + (A.to.x - A.from.x) * e;
      this.cam.z = A.from.z + (A.to.z - A.from.z) * e;
      this.cam.dist = A.from.dist + (A.to.dist - A.from.dist) * e;
      if (k >= 1) this.camAnim = null;
    }
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}

export function dispose(o) {
  o.traverse?.(c => {
    if (c.geometry && !c.geometry.userData?.shared) c.geometry.dispose();
    if (c.material && !c.material.userData?.shared) { if (c.material.map && !c.material.map.userData?.shared) c.material.map.dispose(); c.material.dispose?.(); }
  });
}
