// "Miniature lens": the scene renders to a linear HDR target; a half-resolution copy is
// blurred (horizontal then vertical), and a final full-resolution pass mixes sharp and
// blurred by a tilt-shift mask (sharp band in the middle of the screen), then applies a
// colour grade, a soft vignette, tone mapping and sRGB output.
// The blur eases to 0 while the player drags or aims, so aiming always stays crisp.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLUR = dir => `
  uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;
  void main() {
    vec2 s = ${dir} * texel;
    vec4 c = texture2D(tDiffuse, vUv) * 0.2270270270;
    c += (texture2D(tDiffuse, vUv + s * 1.3846153846) + texture2D(tDiffuse, vUv - s * 1.3846153846)) * 0.3162162162;
    c += (texture2D(tDiffuse, vUv + s * 3.2307692308) + texture2D(tDiffuse, vUv - s * 3.2307692308)) * 0.0702702703;
    gl_FragColor = c;
  }`;
const COMPOSITE = `
  uniform sampler2D tSharp; uniform sampler2D tBlur; uniform float focus; uniform float band; uniform float amount;
  uniform float vignette; uniform float grade; varying vec2 vUv;
  void main() {
    vec3 col = texture2D(tSharp, vUv).rgb;
    float m = amount * smoothstep(band, band + 0.3, abs(vUv.y - focus));
    if (m > 0.001) col = mix(col, texture2D(tBlur, vUv).rgb, clamp(m, 0.0, 1.0));
    // grade: cool lift in the shadows, warm highlights, a touch more saturation
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * vec3(0.92, 0.97, 1.1) + vec3(0.004, 0.006, 0.012), (1.0 - smoothstep(0.0, 0.35, l)) * grade);
    col = mix(col, col * vec3(1.05, 1.0, 0.93), smoothstep(0.45, 1.2, l) * grade);
    col = mix(vec3(l), col, 1.0 + 0.1 * grade);
    vec2 q = vUv - 0.5;
    col *= 1.0 - vignette * smoothstep(0.35, 0.85, length(q * vec2(1.0, 0.85)));
    gl_FragColor = vec4(max(col, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class MiniLens {
  constructor(renderer) {
    this.r = renderer;
    this.enabled = true;
    this.strength = 1;
    this.focus = 0.5;
    this.k = 1; this.target = 1;
    const small = Math.min(innerWidth, innerHeight) < 600;
    this.rtA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: small ? 2 : 4 });
    this.rtH = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtV = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    const mk = (fs, u, tm) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: tm });
    this.mH = mk(BLUR('vec2(1.0, 0.0)'), { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } }, false);
    this.mV = mk(BLUR('vec2(0.0, 1.0)'), { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } }, false);
    this.mC = mk(COMPOSITE, { tSharp: { value: null }, tBlur: { value: null }, focus: { value: 0.5 }, band: { value: 0.15 }, amount: { value: 0 }, vignette: { value: 0.3 }, grade: { value: 1 } }, true);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mC);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h, pr) {
    const W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
    this.rtA.setSize(W, H);
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    this.rtH.setSize(hw, hh); this.rtV.setSize(hw, hh);
    // blur step in half-res texels, scaled so the look is the same at any pixel ratio
    const spread = 1.3 * Math.max(1, pr / 1.5);
    this.mH.uniforms.texel.value.set(spread / hw, 0);
    this.mV.uniforms.texel.value.set(0, spread / hh);
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
  render(scene, camera, dt) {
    const r = this.r;
    this.k += (this.target - this.k) * Math.min(1, dt * 6);
    const amount = this.enabled ? this.strength * this.k : 0;
    r.setRenderTarget(this.rtA); r.clear(); r.render(scene, camera);
    if (amount > 0.01) {
      this.mH.uniforms.tDiffuse.value = this.rtA.texture; this.pass(this.mH, this.rtH);
      this.mV.uniforms.tDiffuse.value = this.rtH.texture; this.pass(this.mV, this.rtV);
    }
    const u = this.mC.uniforms;
    u.tSharp.value = this.rtA.texture; u.tBlur.value = this.rtV.texture; u.amount.value = amount; u.focus.value = this.focus;
    this.pass(this.mC, null);
  }
}
