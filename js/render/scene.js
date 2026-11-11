// Three.js scene: board, walls, nodes, entity meshes, fog of war and camera rig.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import {
  PALETTE, makeUnitMesh, makeBuildingMesh, makeWallMesh, makeNodeMesh, makeLabel, drawLabel, ring, makeUnitBase,
} from './models.js';

export class View3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.void);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
    this.cam = { x: 12, z: 16, dist: 30, yaw: 0, pitch: 0.95 };
    const W = CONFIG.map.w, H = CONFIG.map.h;
    this.W = W; this.H = H;

    // lights
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(W / 2 - 14, 30, H / 2 + 18);
    sun.target.position.set(W / 2, 0, H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun, sun.target);

    // board
    const board = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: PALETTE.board, roughness: 1 }));
    board.rotation.x = -Math.PI / 2; board.position.set(W / 2, 0, H / 2); board.receiveShadow = true;
    this.scene.add(board);
    this.board = board;
    const lines = [];
    for (let x = 0; x <= W; x += 2) lines.push(x, 0.005, 0, x, 0.005, H);
    for (let z = 0; z <= H; z += 2) lines.push(0, 0.005, z, W, 0.005, z);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: PALETTE.boardLine })));
    // border frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.4, H + 1.2), new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.8 }));
    frame.position.set(W / 2, -0.21, H / 2); this.scene.add(frame);

    // fog
    this.fogW = W * 2; this.fogH = H * 2;
    this.fogData = new Uint8Array(this.fogW * this.fogH * 4);
    this.fogTex = new THREE.DataTexture(this.fogData, this.fogW, this.fogH, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter;
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false }));
    fog.rotation.x = -Math.PI / 2; fog.position.set(W / 2, 0.02, H / 2); fog.renderOrder = 2;
    this.scene.add(fog);

    this.entities = new Map();   // id -> {mesh, label, kind}
    this.nodeMeshes = new Map();
    this.overlay = new THREE.Group(); this.scene.add(this.overlay);
    this.fxGroup = new THREE.Group(); this.scene.add(this.fxGroup);
    this.ghosts = new THREE.Group(); this.scene.add(this.ghosts);
    this.marks = new THREE.Group(); this.scene.add(this.marks);     // round markers (deaths, damage)
    this.intents = new THREE.Group(); this.scene.add(this.intents); // attack/aim arrows during playback
    this.fx = [];
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  initMap(map) {
    if (this.mapBuilt) return;
    this.mapBuilt = true;
    for (const w of map.walls) this.scene.add(makeWallMesh(w));
    for (const n of map.nodes) {
      const m = makeNodeMesh(); m.position.set(n.x, 0, n.z); this.scene.add(m);
      const rr = ring(CONFIG.economy.nodeRadius, 0.06, 0x333333, 0.35, 0.03, 40); rr.position.x = n.x; rr.position.z = n.z; this.scene.add(rr);
      this.nodeMeshes.set(n.id, m);
    }
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // wider FOV on portrait phones
    this.camera.fov = w < h ? 50 : 34;
    this.camera.updateProjectionMatrix();
  }

  // ---- camera ------------------------------------------------------------------
  updateCamera() {
    const c = this.cam;
    c.x = Math.max(-2, Math.min(this.W + 2, c.x));
    c.z = Math.max(-2, Math.min(this.H + 2, c.z));
    c.dist = Math.max(7, Math.min(60, c.dist));
    const horiz = Math.cos(c.pitch) * c.dist;
    this.camera.position.set(c.x - Math.sin(c.yaw) * horiz, Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * horiz);
    this.camera.lookAt(c.x, 0, c.z);
  }
  // Smoothly move the camera to frame a set of points.
  frame(points, dur = 0.7) {
    if (!points.length) return;
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (const p of points) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
    const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
    const span = Math.max(maxx - minx, maxz - minz);
    const portrait = (this.canvas.clientHeight || 1) > (this.canvas.clientWidth || 1);
    const dist = Math.max(22, Math.min(46, span * (portrait ? 2.6 : 1.7) + 14));
    this.camAnim = { t: 0, dur, from: { x: this.cam.x, z: this.cam.z, dist: this.cam.dist }, to: { x: cx, z: cz, dist } };
  }
  stopAnim() { this.camAnim = null; }

  panPixels(dx, dy) {
    this.camAnim = null;
    const h = this.canvas.clientHeight || 600;
    const k = (this.cam.dist * Math.tan((this.camera.fov * Math.PI) / 360) * 2) / h;
    const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw);
    // screen right = (cos yaw, sin yaw), screen up = (sin yaw, -cos yaw) projected on ground
    this.cam.x -= (dx * cy - dy * sy / Math.sin(this.cam.pitch)) * k;
    this.cam.z -= (dx * sy + dy * cy / Math.sin(this.cam.pitch)) * k;
  }
  zoom(f) { this.camAnim = null; this.cam.dist *= f; }
  rotate(da) { this.camAnim = null; this.cam.yaw += da; }
  focus(x, z) { this.cam.x = x; this.cam.z = z; }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const p = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    return { x: p.x, z: p.z };
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height, behind: v.z > 1 };
  }
  // pixels per world unit near a point (for touch tolerances)
  pxPerUnit(x, z) {
    const a = this.project(x, 0, z), b = this.project(x + 1, 0, z);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ---- entities ------------------------------------------------------------------
  // disp: { units:[{id,type,owner,x,z,hp,maxHp,tier,defends,visible,ghost,facing}], buildings:[{...,built,progress}] }
  sync(disp, nodes) {
    const seenIds = new Set();
    for (const u of disp.units) {
      seenIds.add(u.id);
      let e = this.entities.get(u.id);
      if (!e) {
        const mesh = makeUnitMesh(u.type, u.owner);
        const label = makeLabel('unit');
        mesh.add(label); label.position.y = 2.15;
        const base = makeUnitBase(u.owner);
        mesh.add(base);
        mesh.userData.base = base;
        this.scene.add(mesh);
        e = { mesh, label, kind: 'unit', fx: 0, fy: u.owner === 0 ? 0 : Math.PI, x: u.x, z: u.z };
        mesh.rotation.y = e.fy;
        this.entities.set(u.id, e);
      }
      const dx = u.x - e.x, dz = u.z - e.z;
      if (dx * dx + dz * dz > 1e-5) e.fy = Math.atan2(dx, dz);
      if (u.face) e.fy = Math.atan2(u.face.x - u.x, u.face.z - u.z);
      e.x = u.x; e.z = u.z;
      e.mesh.position.set(u.x, u.lift || 0, u.z);
      let d = e.fy - e.mesh.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      e.mesh.rotation.y += d * 0.25;
      e.mesh.visible = u.visible !== false;
      e.label.material.rotation = 0;
      drawLabel(e.label, { tier: u.tier, name: CONFIG.units[u.type].name, hpFrac: Math.max(0, u.hp / u.maxHp), team: u.owner, low: u.hp / u.maxHp < 0.34, dim: !!u.dim, tag: u.tag || '', icons: u.icons || [] });
      const act = e.mesh.userData.base.userData.act;
      act.visible = !!u.acting;
      if (act.visible) act.scale.setScalar(1 + 0.12 * Math.sin((this.time || 0) * 8));
      // dying units tip over and sink; the label hides
      const body = e.mesh.userData.body;
      if (u.dying !== undefined) {
        body.rotation.x = Math.min(1.45, u.dying * 2.2);
        body.position.y = -0.35 * Math.max(0, u.dying - 0.5);
        e.label.visible = u.dying < 0.3;
        e.mesh.userData.base.visible = u.dying < 0.6;
      } else {
        body.rotation.x = 0; e.label.visible = true; e.mesh.userData.base.visible = true;
        body.position.y = u.flash ? 0.15 * Math.sin(u.flash * 30) : 0;
      }
      e.mesh.scale.setScalar(1);
    }
    for (const b of disp.buildings) {
      seenIds.add(b.id);
      let e = this.entities.get(b.id);
      const ghostKey = b.built ? 'b' : 'c';
      if (e && e.ghostKey !== ghostKey) { this.scene.remove(e.mesh); this.entities.delete(b.id); e = null; }
      if (!e) {
        const mesh = makeBuildingMesh(b.type, b.owner, { ghost: !b.built });
        const label = makeLabel('building');
        mesh.add(label); label.position.y = b.type === 'hq' ? 3.9 : 2.75;
        mesh.position.set(b.x, 0, b.z);
        if (b.type === 'barricade') mesh.rotation.y = Math.atan2(this.W / 2 - b.x, 0) > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.scene.add(mesh);
        e = { mesh, label, kind: 'building', ghostKey };
        this.entities.set(b.id, e);
      }
      e.mesh.visible = b.visible !== false;
      const s = b.dying ? Math.max(0.01, 1 - b.dying) : 1;
      const sy = s * (b.built ? 1 : 0.35 + 0.65 * (b.progress || 0));
      e.mesh.scale.set(1, sy, 1);
      e.label.scale.y = (e.label.userData.w * e.label.userData.ratio) / Math.max(0.05, sy);
      const bname = CONFIG.buildings[b.type].name + (b.built ? '' : ' (building)');
      drawLabel(e.label, { name: bname, hpFrac: Math.max(0, b.hp / b.maxHp), team: b.owner, low: b.hp / b.maxHp < 0.34, dim: !!b.dim });
      if (b.aim && e.mesh.userData.head) e.mesh.userData.head.rotation.y = Math.atan2(b.aim.x - b.x, b.aim.z - b.z);
    }
    for (const [id, e] of this.entities) {
      if (!seenIds.has(id)) { this.scene.remove(e.mesh); this.entities.delete(id); }
    }
    if (nodes) for (const n of nodes) {
      const m = this.nodeMeshes.get(n.id); if (!m) continue;
      const c = m.userData.crystal;
      c.material.color.setHex(n.owner === -1 ? PALETTE.neutral : PALETTE.team[n.owner].body);
    }
  }

  // Fog: visibleAt(x,z) -> boolean
  updateFog(sources) {
    const d = this.fogData, W = this.fogW, H = this.fogH;
    for (let j = 0; j < H; j++) {
      const z = (j + 0.5) / 2;
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / 2;
        let best = 1e9;
        for (const s of sources) {
          const dd = Math.sqrt((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z)) - s.r;
          if (dd < best) best = dd;
        }
        const k = ((H - 1 - j) * W + i) * 4;
        const a = best <= -0.6 ? 0 : best >= 0.6 ? 150 : Math.round((best + 0.6) / 1.2 * 150);
        d[k] = 8; d[k + 1] = 8; d[k + 2] = 8; d[k + 3] = a;
      }
    }
    this.fogTex.needsUpdate = true;
  }

  clearOverlay() {
    for (const c of [...this.overlay.children]) { this.overlay.remove(c); disposeDeep(c); }
  }
  clearGhosts() {
    for (const c of [...this.ghosts.children]) { this.ghosts.remove(c); disposeDeep(c); }
  }

  addFx(obj, life, update) {
    this.fxGroup.add(obj);
    this.fx.push({ obj, life, t: 0, update });
  }

  render() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time = (this.time || 0) + dt;
    for (const f of [...this.fx]) {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { this.fxGroup.remove(f.obj); disposeDeep(f.obj); this.fx.splice(this.fx.indexOf(f), 1); continue; }
      f.update && f.update(f.obj, k);
    }
    for (const [, e] of this.entities) {
      const sp = e.mesh.userData.spin; if (sp) sp.rotation.y += dt * 0.8;
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
    return dt;
  }
}

export function disposeDeep(o) {
  o.traverse?.(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material && !c.material.userData?.shared) {
      if (c.material.map && c.isSprite) c.material.map.dispose();
      if (!c.material.__cached) c.material.dispose?.();
    }
  });
}
