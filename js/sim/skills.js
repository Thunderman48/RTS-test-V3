// Automatic skill use: the rules the AI uses for its ordered squads, shared with stance squads that
// have "auto skills" on (q.auto !== false). Adds skill actions to `plan` and returns
// { left: AP left, charged: the squad charged into (its swings are already added) or null }.
//  t: the squad's current target (a squad, or a target-like object { x, z, isHq? }); lead: aim offset
import { RULES, isShooter, skillOf, cdOf, isMage } from '../data/units.js';
import { defOf, radiusOf } from './state.js';
import { losCut, engagedWith } from './resolve.js';
import { dist } from './geom.js';

const rad = e => e.r ?? radiusOf(e);

export function autoSkills(s, q, t, enemies, mine, plan, left, lead = null) {
  const def = defOf(q), p = q.owner;
  if (!def.skills || !def.skills.length || !t) return { left, charged: null };
  const tx = t.x + (lead ? lead.x : 0), tz = t.z + (lead ? lead.z : 0);
  const gap = dist(q.x, q.z, t.x, t.z) - rad(t) - radiusOf(q);
  const engaged = engagedWith(q, enemies);
  let mana = q.mana || 0;
  // skills already in the plan this round (non-mages: once per round)
  const used = new Set(plan.actions.map(a => a.kind));
  const ready = kind => {
    const k = skillOf(def, kind);
    if (!k || left < k.ap) return null;
    return (isMage(def) ? mana >= k.mana : cdOf(q, kind) === 0 && !used.has(kind)) ? k : null;
  };
  const cast = (kind, x, z) => { const k = skillOf(def, kind); plan.actions.push({ kind, x, z }); left -= k.ap; used.add(kind); if (isMage(def)) mana -= k.mana; };
  const real = enemies.filter(e => !e.isHq && !e.building);
  let sk;
  // shield wall when shooters or a melee squad face us
  if ((sk = ready('wall')) && (engaged.length || real.some(e => isShooter(defOf(e)) && dist(e.x, e.z, q.x, q.z) < defOf(e).attack.range + 2))) cast('wall', q.x, q.z);
  // step out of a losing melee
  if ((sk = ready('step')) && engaged.length && q.hp < def.hpPer * 0.5) cast('step', q.x + (p === 0 ? -1 : 1) * sk.range, q.z);
  // raise fallen models nearby
  if ((sk = ready('raise')) && mine.some(o => defOf(o).models > 1 && o.models < defOf(o).models && dist(o.x, o.z, q.x, q.z) <= sk.radius + radiusOf(o))) cast('raise', q.x, q.z);
  // rally when friends are close
  if ((sk = ready('rally')) && mine.filter(o => o !== q && dist(o.x, o.z, q.x, q.z) <= sk.radius + radiusOf(o)).length >= 2) cast('rally', q.x, q.z);
  // leap into a target just out of reach
  if ((sk = ready('leap')) && !engaged.length && gap > 1 && gap < sk.range) {
    const d = Math.max(0.1, gap - 0.4), l = Math.max(0.1, dist(q.x, q.z, t.x, t.z));
    cast('leap', q.x + (t.x - q.x) / l * d, q.z + (t.z - q.z) / l * d);
  }
  // Mighty Swing (stuns) when the target stands in its wide arc
  if ((sk = ready('mighty')) && !t.isHq && !t.building && dist(q.x, q.z, t.x, t.z) - rad(t) - radiusOf(q) <= sk.reach - 0.2) cast('mighty', t.x, t.z);
  // necromancer: burst summoned skeletons that stand among enemies (or are about to crumble)
  if (ready('explode')) {
    const k = skillOf(def, 'explode');
    for (const o of s.squads.filter(o => o.owner === p && o.ttl && o.hp > 0 && dist(o.x, o.z, q.x, q.z) <= k.range)) {
      const n = real.filter(e => dist(e.x, e.z, o.x, o.z) <= k.radius + radiusOf(e) * 0.6).length;
      if ((n >= 2 || (n >= 1 && o.ttl <= 1)) && ready('explode')) cast('explode', o.x, o.z);
    }
  }
  // necromancer: summon skeletons toward the enemy when it is close
  if ((sk = ready('summon')) && !t.isHq && gap < 12 && s.squads.filter(o => o.owner === p && o.ttl).length < 4 && mana >= sk.mana + 25) {
    const l = Math.max(0.1, dist(q.x, q.z, t.x, t.z)), d = Math.min(sk.range, Math.max(1.5, gap - 1));
    cast('summon', q.x + (t.x - q.x) / l * d, q.z + (t.z - q.z) / l * d);
  }
  // necromancer: Dark Thunder at the target, as often as mana allows (keeping AP for a bolt or two)
  for (let i = 0; i < 2 && (sk = ready('thunder')) && !t.isHq && !t.building && dist(q.x, q.z, t.x, t.z) - rad(t) <= sk.range && losCut(s.terrain, q.x, q.z, t.x, t.z) >= 1; i++) cast('thunder', t.x, t.z);
  if ((sk = ready('sweep')) && real.filter(e => dist(e.x, e.z, q.x, q.z) <= radiusOf(q) + sk.reach + radiusOf(e)).length >= 2) cast('sweep', q.x, q.z);
  // archers: Arrow Storm when two squads fit under it, or the target hides behind a wall
  if ((sk = ready('storm')) && dist(q.x, q.z, tx, tz) <= sk.range + 1) {
    const packed = real.filter(e => dist(e.x, e.z, tx, tz) <= sk.radius + radiusOf(e) * 0.6).length;
    if (packed >= 2 || losCut(s.terrain, q.x, q.z, t.x, t.z) < 1) cast('storm', tx, tz);
  }
  // crossbows: piercing bolt at the target in range with a clear line
  if ((sk = ready('pierce')) && dist(q.x, q.z, tx, tz) - rad(t) <= sk.range && losCut(s.terrain, q.x, q.z, t.x, t.z) >= 1) cast('pierce', tx, tz);
  if ((sk = ready('blast')) && dist(q.x, q.z, tx, tz) <= sk.range + 1) cast('blast', tx, tz);
  // charge: a slower enemy (it still stands there when we act) down a clear lane, then swing
  let charged = null;
  sk = ready('charge');
  if (sk && !engaged.length) {
    charged = real.filter(e => {
      const g = dist(q.x, q.z, e.x, e.z) - radiusOf(e) - radiusOf(q);
      return defOf(e).tier < def.tier && g > 0.5 && g < sk.len - 1 && losCut(s.terrain, q.x, q.z, e.x, e.z) >= 1;
    }).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0] || null;
    if (charged) {
      cast('charge', charged.x, charged.z);
      while (left >= def.attack.ap) { plan.actions.push({ kind: 'swing', x: charged.x, z: charged.z }); left -= def.attack.ap; }
    }
  }
  void RULES;
  return { left, charged };
}
