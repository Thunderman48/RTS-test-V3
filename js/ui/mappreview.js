// A small top-down picture of a map (for the Battle setup screen and the online lobby).
import { mapDef, buildMapTerrain, mapSites, mirrorOn, HQ_X } from '../data/maps.js';

export function drawMapPreview(canvas, mapId) {
  const def = mapDef(mapId);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth || 160, ch = Math.round(cw * def.h / def.w);
  canvas.width = cw * dpr; canvas.height = ch * dpr; canvas.style.height = ch + 'px';
  const g = canvas.getContext('2d');
  g.setTransform(dpr * cw / def.w, 0, 0, dpr * ch / def.h, 0, 0);
  // ground with a little team tint at both ends
  g.fillStyle = '#6f9150'; g.fillRect(0, 0, def.w, def.h);
  g.fillStyle = 'rgba(93,134,200,.18)'; g.fillRect(0, 0, def.w / 3, def.h);
  g.fillStyle = 'rgba(155,111,196,.18)'; g.fillRect(def.w * 2 / 3, 0, def.w / 3, def.h);
  // road
  const P = def.road;
  g.strokeStyle = '#a58a5c'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(P[0][0], P[0][1]); g.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]); g.stroke();
  for (const t of buildMapTerrain(def)) {
    if (t.kind === 'river') {
      g.fillStyle = '#4f9fc4'; g.fillRect(t.x - t.w / 2, 0, t.w, def.h);
      g.fillStyle = '#b8ad94'; for (const f of t.fords) g.fillRect(t.x - t.w / 2 - 0.1, f.z - f.d / 2, t.w + 0.2, f.d);
    } else if (t.kind === 'lake') { g.fillStyle = '#4f9fc4'; g.beginPath(); g.arc(t.x, t.z, t.r, 0, Math.PI * 2); g.fill(); }
    else if (t.kind === 'forest') { g.fillStyle = '#3f6a33'; g.beginPath(); g.arc(t.x, t.z, t.r, 0, Math.PI * 2); g.fill(); }
    else if (t.kind === 'rock') { g.fillStyle = '#8a8072'; g.beginPath(); g.arc(t.x, t.z, t.r, 0, Math.PI * 2); g.fill(); }
    else if (t.kind === 'ruin') { g.fillStyle = '#b3ad9f'; g.fillRect(t.x - t.w / 2, t.z - t.d / 2, t.w, t.d); }
  }
  // resource sites (gold diamonds) and the possible HQ spots of each side
  g.fillStyle = '#ffd34d';
  for (const s of mapSites(def)) { g.beginPath(); g.moveTo(s.x, s.z - 1.1); g.lineTo(s.x + 1.1, s.z); g.lineTo(s.x, s.z + 1.1); g.lineTo(s.x - 1.1, s.z); g.closePath(); g.fill(); }
  const m = mirrorOn(def.w, def.h);
  for (const z of def.hqSpots) {
    g.fillStyle = 'rgba(58,120,216,.9)'; g.fillRect(HQ_X - 1.6, z - 1.6, 3.2, 3.2);
    const o = m({ x: HQ_X, z }); g.fillStyle = 'rgba(155,89,208,.9)'; g.fillRect(o.x - 1.6, o.z - 1.6, 3.2, 3.2);
  }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.4; g.strokeRect(0.2, 0.2, def.w - 0.4, def.h - 0.4);
}
