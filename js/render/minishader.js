// "Painted miniature" shading, patched into MeshStandardMaterial:
//  - wash: recesses and undersides darker (baked per-vertex `ao` attribute from Kit)
//  - drybrush: upward-facing facets and silhouette edges catch a warm highlight
//  - cool shadows: unlit areas drift toward blue-violet instead of plain dark
// Programs are shared per preset through customProgramCacheKey.
import * as THREE from 'three';
import { fogPatch } from './fog.js';

export const PRESETS = {
  mini:    { edge: 0.22, rim: 0.32, wash: 1.0, cool: 0.55, rough: 0.56, metal: 0.06 },
  terrain: { edge: 0.12, rim: 0.10, wash: 0.8, cool: 0.45, rough: 0.9, metal: 0.0 },
  board:   { edge: 0.06, rim: 0.05, wash: 0.6, cool: 0.4, rough: 0.95, metal: 0.0 },
};
const f = v => v.toFixed(3);

export function miniMaterial(preset = 'mini', extra = {}) {
  const P = PRESETS[preset];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: P.rough, metalness: P.metal, ...extra });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nvarying float vAo;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAo = ao;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAo;\nvarying vec3 vWN;')
      .replace('#include <opaque_fragment>', `
        {
          vec3 Vd = normalize(vViewPosition);
          float rimT = pow(1.0 - clamp(abs(dot(normal, Vd)), 0.0, 1.0), 3.0);
          float upT = pow(clamp(normalize(vWN).y, 0.0, 1.0), 4.0);
          outgoingLight *= mix(1.0, vAo, ${f(P.wash)});
          float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
          float dk = 1.0 - smoothstep(0.03, 0.42, lum);
          outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.8, 0.9, 1.22) + diffuseColor.rgb * vec3(0.02, 0.025, 0.05), dk * ${f(P.cool)});
          outgoingLight += diffuseColor.rgb * (upT * ${f(P.edge)} + rimT * ${f(P.rim)}) * vec3(1.0, 0.94, 0.82);
        }
        #include <opaque_fragment>`);
    fogPatch(sh);
  };
  m.customProgramCacheKey = () => 'mini-' + preset;
  return m;
}
