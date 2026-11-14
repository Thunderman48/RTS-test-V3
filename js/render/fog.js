// The fog over the table:
//  - a 48x32 texture (R = visible now, G = explored) eased every frame so the fog rolls in and out;
//    every painted material samples it (fogPatch): explored-but-unseen ground is hazed and dimmed,
//    unexplored ground fades into a pale mist
//  - low-poly mist puffs drifting over unexplored cells, shrinking away as they are explored
import * as THREE from 'three';


export const FOG = { map: { value: null }, on: { value: 0 }, size: { value: new THREE.Vector2(48, 32) } };

// patch a material's shaders (call from onBeforeCompile, after any other patch)
export function fogPatch(sh) {
  sh.uniforms.fogMap = FOG.map; sh.uniforms.fogOn = FOG.on; sh.uniforms.fogSize = FOG.size;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvFogXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;\nuniform sampler2D fogMap;\nuniform float fogOn;\nuniform vec2 fogSize;')
    .replace('#include <opaque_fragment>', `
      if (fogOn > 0.5 && vFogXZ.x > 0.0 && vFogXZ.x < fogSize.x && vFogXZ.y > 0.0 && vFogXZ.y < fogSize.y) {
        vec4 fg = texture2D(fogMap, vFogXZ / fogSize);
        float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
        vec3 haze = mix(outgoingLight, vec3(lum) * vec3(0.66, 0.72, 0.86), 0.6) * 0.6 + vec3(0.03, 0.035, 0.05);
        outgoingLight = mix(haze, outgoingLight, fg.r);
        float n = sin(vFogXZ.x * 1.7 + vFogXZ.y * 0.9) * 0.03 + sin(vFogXZ.y * 2.3 - vFogXZ.x * 0.6) * 0.03;
        outgoingLight = mix(outgoingLight, vec3(0.74, 0.77, 0.82) + n, (1.0 - fg.g) * 0.9);
      }
      #include <opaque_fragment>`);
}

export class FogLayer {
  constructor(view) {
    this.view = view;
    this.geo = new THREE.IcosahedronGeometry(1, 1);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xc3cad6, flatShading: true, roughness: 1, metalness: 0, emissive: 0x5d6678, emissiveIntensity: 0.55 });
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.sc = new THREE.Vector3();
    this.enabled = false; this.mist = true;
    this.setBoard(48, 32);
  }
  // (re)build the fog texture and the mist puffs for a w x h board
  setBoard(w, h) {
    if (this.W === w && this.H === h) return;
    this.W = w; this.H = h;
    FOG.size.value.set(w, h);
    this.tex?.dispose();
    this.data = new Uint8Array(w * h * 4);
    this.cur = new Float32Array(w * h * 2).fill(1);
    this.tex = new THREE.DataTexture(this.data, w, h, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    FOG.map.value = this.tex;
    // mist puffs: one every 2" (2.5" on big tables), jittered faceted blobs
    const step = w * h > 2600 ? 2.5 : 2;
    this.puffs = [];
    let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let z = step / 2; z < h; z += step) for (let x = step / 2; x < w; x += step) {
      const px = x + (R() - 0.5) * 1.2, pz = z + (R() - 0.5) * 1.2;
      const edge = Math.min(px, pz, w - px, h - pz);
      this.puffs.push({ x: px, z: pz, s: Math.min((1.25 + R() * 0.7) * step / 2, edge + 0.4), h: 0.5 + R() * 0.45, y: 0.15 + R() * 0.55, ph: R() * 6.28, rot: R() * 6.28, k: 1 });
    }
    if (this.mesh) { this.view.scene.remove(this.mesh); this.mesh.dispose(); }
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.puffs.length);
    this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = this.enabled && this.mist;
    this.view.scene.add(this.mesh);
  }
  // Settings: mist puffs on or off (the ground haze always stays), and puff detail
  setMist(on) { this.mist = on; this.mesh.visible = this.enabled && on; }
  setDetail(d) { const g = new THREE.IcosahedronGeometry(1, d); this.mesh.geometry = g; this.geo.dispose(); this.geo = g; }
  enable(on, fogMap = null) {
    this.enabled = on;
    FOG.on.value = on ? 1 : 0;
    this.mesh.visible = on && this.mist;
    if (fogMap) { this.fm = fogMap; this.setBoard(fogMap.w, fogMap.h); this.snap(); }
  }
  setMap(fogMap) { this.fm = fogMap; }
  // jump to the current state (no easing), e.g. at the start of a game
  snap() {
    if (!this.fm) return;
    for (let k = 0; k < this.W * this.H; k++) { this.cur[k * 2] = this.fm.visible[k]; this.cur[k * 2 + 1] = this.fm.explored[k]; }
    for (const p of this.puffs) p.k = this.fm.isExplored(p.x, p.z) ? 0 : 1;
    this.write();
  }
  write() {
    for (let k = 0; k < this.W * this.H; k++) { this.data[k * 4] = this.cur[k * 2] * 255; this.data[k * 4 + 1] = this.cur[k * 2 + 1] * 255; this.data[k * 4 + 3] = 255; }
    this.tex.needsUpdate = true;
  }
  update(dt, time) {
    if (!this.enabled || !this.fm) return;
    const a = Math.min(1, dt * 3);
    let moved = false;
    for (let k = 0; k < this.W * this.H; k++) {
      const tv = this.fm.visible[k], te = this.fm.explored[k];
      const v = this.cur[k * 2], e = this.cur[k * 2 + 1];
      if (Math.abs(v - tv) > 0.004) { this.cur[k * 2] = v + (tv - v) * a; moved = true; } else this.cur[k * 2] = tv;
      if (Math.abs(e - te) > 0.004) { this.cur[k * 2 + 1] = e + (te - e) * a; moved = true; } else this.cur[k * 2 + 1] = te;
    }
    if (moved) this.write();
    let i = 0;
    for (const p of this.puffs) {
      const t = this.fm.isExplored(p.x, p.z) ? 0 : 1;
      p.k += (t - p.k) * Math.min(1, dt * 2.2);
      const s = p.k < 0.02 ? 0 : p.k;
      const bob = Math.sin(time * 0.6 + p.ph) * 0.12;
      const drift = Math.sin(time * 0.15 + p.ph) * 0.3;
      this.e.set(0, p.rot + time * 0.05, 0);
      this.q.setFromEuler(this.e);
      this.v.set(p.x + drift, (p.y + bob) * s, p.z);
      this.sc.set(p.s * s, p.h * s, p.s * s);
      this.m4.compose(this.v, this.q, this.sc);
      this.mesh.setMatrixAt(i++, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
