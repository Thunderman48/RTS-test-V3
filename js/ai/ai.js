// AI: advances as a battle line, directly controls its hero and the 3 squads
// closest to the enemy, and aims a little ahead of enemies that moved last round.
import { RULES, FACTIONS, isMelee, isShooter, skillOf, cdOf, isMage, maxBuildersOf, trainsOf, pairOf } from '../data/units.js';
import { losCut, engagedWith } from '../sim/resolve.js';
import { emptyOrders, emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { nearestEnemy, meleePlan, trimPath } from '../sim/stances.js';
import { obstacles, navKey, placeError, bonusCp, armySize, armyValue, BUILDINGS, trainCost, footprint, nearestFreeSite, builderCount, trainsRole, edgeDist, bdef, buildQueue, siteTaken, seenBy, graveCircles } from '../sim/base.js';
import { builderPlan } from '../sim/builders.js';
import { autoSkills } from '../sim/skills.js';
import { Nav, pointBlocked } from '../sim/nav.js';
import { dist } from '../sim/geom.js';
import { visibleTo, knownEnemyHq, observers, canSee } from '../sim/vision.js';
import { HQ_X, mirrorOn } from '../data/maps.js';

// memory (per side, updated in place): seen = last-seen enemy squads, prev = positions seen last round
// opts.level: 'easy' (one less command point, no aiming ahead) | 'normal' | 'hard' (one more command point)
export function aiOrders(s, p, memory = aiMemory(), opts = {}) {
  const level = opts.level || 'normal';
  const o = emptyOrders();
  memory.seen = memory.seen || {}; memory.prev = memory.prev || {};
  // builders work on their own; summoned skeletons march on their own (stance advance)
  const mine = s.squads.filter(q => q.owner === p && q.hp > 0 && q.role !== 'builder' && !q.ttl);
  // fog: the AI only knows what its side sees, plus where it last saw the others (up to 3 rounds)
  const vis = visibleTo(s, p);
  const alive = new Set(s.squads.map(q => q.id));
  for (const e of s.squads) if (vis.has(e.id)) memory.seen[e.id] = { ...e, round: s.round };
  for (const id of Object.keys(memory.seen)) if (!alive.has(id) || s.round - memory.seen[id].round > 3) delete memory.seen[id];
  let enemies = Object.values(memory.seen).map(e => vis.has(e.id) ? s.squads.find(q => q.id === e.id) : e);
  // the enemy HQ is only known once scouted (fog intel); until then scout its possible spots
  const hqE = knownEnemyHq(s, p);
  const hqTarget = hqE ? { id: hqE.id, owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: hqE.x, z: hqE.z, fx: 1, fz: 0, models: 4, hp: hqE.hp, cd: {}, isHq: true } : null;
  memory.cleared = memory.cleared || {};
  const mirror = mirrorOn(s.board.w, s.board.h);
  const spots = s.hqSpots.map(z => p === 0 ? mirror({ x: HQ_X, z }) : { x: HQ_X, z });
  const obsv = observers(s, p);
  for (const sp of spots) if (obsv.some(o => canSee(s.terrain, o.x, o.z, o.range, sp.x, sp.z))) memory.cleared[sp.x + ',' + sp.z] = true;
  const scoutSpot = q => spots.filter(sp => !memory.cleared[sp.x + ',' + sp.z]).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0] || null;
  if (!enemies.length) {
    if (hqTarget) enemies = [hqTarget];
    else {
      const sp = scoutSpot({ x: s.board.w / 2, z: s.board.h / 2 }) || spots[1];
      enemies = [{ id: '?', owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: sp.x, z: sp.z, fx: 1, fz: 0, models: 4, hp: 80, cd: {} }];
    }
  } else if (hqTarget) enemies.push(hqTarget);
  if (s.buildings) Object.assign(o, economy(s, p, enemies.filter(e => !e.isHq), o));

  // ---- waves: gather the army at a rally point, attack together, fall back to regroup ----
  const wave = memory.wave || (memory.wave = { phase: 'gather', since: s.round, size: 0, hqHp: 0 });
  const myHq = s.buildings.find(b => b.owner === p && b.type === 'hq');
  const goal = hqTarget || scoutSpot(myHq || { x: s.board.w / 2, z: s.board.h / 2 }) || spots[1];
  // regroup in front (where the last wave stalled) unless it was broken; else just outside our base
  const rally = wave.forward && wave.phase === 'gather' ? wave.forward : rallyPoint(s, p, myHq, goal);
  const army = mine.filter(q => q.role !== 'fast' || hqTarget);
  const atRally = army.filter(q => dist(q.x, q.z, rally.x, rally.z) < 6).length;
  const frac = { easy: 0.75, normal: 0.6, hard: 0.5 }[level] || 0.6;
  const atCap = armySize(s, p) >= s.board.cap;
  if (wave.phase === 'gather') {
    const enough = army.length >= 4 && atRally >= Math.ceil(army.length * frac);
    if (s.round >= 3 && army.length >= 3 && (enough || atCap || s.round - wave.since >= (level === 'hard' ? 3 : 4))) {
      Object.assign(wave, { phase: 'attack', since: s.round, size: army.length, hqHp: hqTarget ? hqTarget.hp : 1e9 });
    }
  } else {
    const broken = army.length < wave.size * (level === 'easy' ? 0.5 : 0.4);
    const stalled = s.round - wave.since >= 10 && !(hqTarget && hqTarget.hp < wave.hqHp);
    if (hqTarget) wave.hqHp = Math.min(wave.hqHp, hqTarget.hp);
    if (broken || stalled) {
      let forward = null;
      if (!broken && army.length) {
        // the army's centre, pulled back a little toward home, clear of terrain
        const cx = army.reduce((n, q) => n + q.x, 0) / army.length - (p === 0 ? 3 : -3), cz = army.reduce((n, q) => n + q.z, 0) / army.length;
        forward = clearSpot(s, cx, cz);
      }
      Object.assign(wave, { phase: 'gather', since: s.round, size: 0, forward });
    }
  }
  // waves pay off on the bigger tables; on a small one the AI keeps up the pressure instead
  const useWaves = s.board.w >= 60;
  const myVal0 = mine.reduce((n, q) => n + q.hp, 0), theirVal0 = enemies.filter(e => !e.isHq).reduce((n, e) => n + (e.hp || 0), 0);
  const attacking = useWaves ? wave.phase === 'attack' : s.round >= 6 && (myVal0 >= theirVal0 * 1.15 || s.round >= 12);
  memory.rally = rally;
  // stances: everyone advances in a wave; while gathering, squads hold their ground (guard)
  // small starting armies: hold at home (guard) until there are at least 4 squads to attack with
  const ready = army.length >= 4;
  for (const q of mine) { const st = (attacking || !useWaves) && ready ? 'advance' : 'guard'; if (q.stance !== st) o.stances[q.id] = st; }
  // home defence: enemies close to our HQ get answered first, whatever the phase
  const threatHome = myHq ? enemies.filter(e => !e.isHq && dist(e.x, e.z, myHq.x, myHq.z) < 12) : [];
  // lead targets by their last movement (only for squads seen both rounds)
  const prev = memory.prev;
  memory.prev = {};
  for (const e of s.squads) if (vis.has(e.id)) memory.prev[e.id] = { x: e.x, z: e.z };
  const lead = e => {
    if (level === 'easy') return null;
    const m = prev[e.id];
    if (!m || !vis.has(e.id)) return null;
    const vx = (e.x - m.x) * 0.5, vz = (e.z - m.z) * 0.5;
    return { x: vx, z: vz };
  };
  const near = q => Math.min(...enemies.filter(e => !e.isHq).map(e => dist(q.x, q.z, e.x, e.z)), 1e9);
  const ranked = mine.slice().sort((a, b) => {
    // gathering: squads in a fight first, then the ones furthest from the rally point
    const score = q => q.role === 'hero' ? -1e9
      : threatHome.length && myHq && dist(q.x, q.z, myHq.x, myHq.z) < 16 ? -1e8 + near(q)
      : useWaves && !attacking ? (near(q) < 8 ? -1e7 + near(q) : -dist(q.x, q.z, rally.x, rally.z))
      : near(q);
    return score(a) - score(b);
  });
  let cp = RULES.cp + bonusCp(s, p) + (level === 'easy' ? -1 : level === 'hard' ? 1 : 0);
  const myVal = mine.reduce((n, q) => n + q.hp, 0), theirVal = enemies.filter(e => !e.isHq).reduce((n, e) => n + (e.hp || 0), 0);
  const assault = s.round >= 6 && (myVal >= theirVal * 1.15 || s.round >= 12);
  // a fallen hero: the 2 nearest squads not in a fight go and hold its revive zone
  const rz = s.revive && s.revive[p];
  const holders = rz ? mine.filter(q => !enemies.some(e => !e.isHq && dist(e.x, e.z, q.x, q.z) < 6)).sort((a, b) => dist(a.x, a.z, rz.x, rz.z) - dist(b.x, b.z, rz.x, rz.z)).slice(0, 2) : [];
  if (holders.length) ranked.sort((a, b) => (holders.includes(b) ? 1 : 0) - (holders.includes(a) ? 1 : 0));
  for (const q of ranked) {
    if (q.role !== 'hero') { if (cp <= 0) break; cp--; }
    const def = defOf(q);
    const plan = emptyPlan();
    if (holders.includes(q)) {
      if (dist(q.x, q.z, rz.x, rz.z) > RULES.reviveRadius * 0.6) {
        const pts = Nav.for(obstacles(s), radiusOf(q), navKey(s)).path(q.x, q.z, rz.x, rz.z);
        if (pts.length) { plan.actions.push({ kind: 'move', pts: trimPath(q.x, q.z, pts, 0.5), ap: apFor(q) }); o.squads[q.id] = plan; continue; }
      }
      plan.defends = RULES.maxDefends; o.squads[q.id] = plan; continue;
    }
    let left = apFor(q);
    // squads go for the HQ only when it is the closest thing (or nothing else is known)
    const squadsOnly = enemies.filter(e => !e.isHq);
    let t = nearestEnemy(s, q, enemies);
    if (t.isHq && squadsOnly.length && dist(q.x, q.z, t.x, t.z) > 9) t = nearestEnemy(s, q, squadsOnly);
    const allIn = attacking;
    // waves: attacking squads head for the HQ (or search for it) unless they are in a fight
    const inFight = engagedWith(q, squadsOnly).length || squadsOnly.some(e => dist(e.x, e.z, q.x, q.z) - radiusOf(e) - radiusOf(q) < 3);
    const defending = threatHome.length && myHq && dist(q.x, q.z, myHq.x, myHq.z) < 16;
    // siege: in a wave, shooters near the known HQ shoot it from beyond its own range
    if (attacking && hqTarget && isShooter(def) && !engagedWith(q, squadsOnly).length && !squadsOnly.some(e => dist(e.x, e.z, q.x, q.z) - radiusOf(e) - radiusOf(q) < 2)
      && dist(q.x, q.z, hqTarget.x, hqTarget.z) - 2 <= def.attack.range + 8) t = hqTarget;
    else if (attacking && !inFight && !defending) {
      if (hqTarget) t = hqTarget;
      else { const sp = scoutSpot(q); if (sp) t = { id: '?', owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: sp.x, z: sp.z, fx: 1, fz: 0, models: 4, hp: 80, cd: {} }; }
    }
    // gathering: walk to the rally point unless there is a fight close by
    if (useWaves && !attacking && !defending && q.role !== 'fast' && near(q) >= 8 && dist(q.x, q.z, rally.x, rally.z) > 4) {
      const nav = Nav.for(obstacles(s), radiusOf(q), navKey(s));
      const pts = nav.path(q.x, q.z, rally.x, rally.z);
      if (pts.length) {
        const gp = emptyPlan(); gp.actions.push({ kind: 'move', pts, ap: apFor(q) });
        o.squads[q.id] = gp; continue;
      }
    }
    // the enemy HQ still unknown after a while: ordered squads go looking for it
    if (!hqTarget && s.round >= 8 && !engagedWith(q, squadsOnly).length && (allIn || !squadsOnly.some(e => dist(e.x, e.z, q.x, q.z) < 8))) {
      const sp = scoutSpot(q);
      if (sp) t = { id: '?', owner: 1 - p, faction: s.players[1 - p].faction, role: 'fighter', x: sp.x, z: sp.z, fx: 1, fz: 0, models: 4, hp: 80, cd: {} };
    }
    // fast squads without a fight nearby scout for the enemy HQ, then raid enemy mines / wells
    const raid = () => {
      if (!hqTarget) return scoutSpot(q);
      const k = Object.values(s.intel?.[p]?.known || {}).filter(b => BUILDINGS[b.type].site).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0];
      return k && dist(q.x, q.z, k.x, k.z) > 3 ? k : null;
    };
    if (q.role === 'fast' && !engagedWith(q, squadsOnly).length && (!hqTarget || !squadsOnly.some(e => dist(e.x, e.z, q.x, q.z) < 8)) && raid()) {
      const sh = raid();
      if (sh && dist(q.x, q.z, sh.x, sh.z) > 1.5) {
        const nav = Nav.for(obstacles(s), radiusOf(q), navKey(s));
        const pts = nav.path(q.x, q.z, sh.x, sh.z);
        if (pts.length) { const plan = emptyPlan(); plan.actions.push({ kind: 'move', pts, ap: apFor(q) }); o.squads[q.id] = plan; continue; }
      }
    }
    const L = lead(t);
    const tx = t.x + (L ? L.x : 0), tz = t.z + (L ? L.z : 0);
    const gap = dist(q.x, q.z, t.x, t.z) - radiusOf(t) - radiusOf(q);
    const engaged = engagedWith(q, enemies);
    // already locked in melee: prepare a parry
    if (def.parry && engaged.length) { plan.parry = true; left -= RULES.parryCost; }
    // skills (shared with stance squads on auto skills)
    const auto = autoSkills(s, q, t, enemies, mine, plan, left, L);
    left = auto.left;
    const ct = auto.charged;
    if (ct) {
      // charged: autoSkills already added the swings after the impact
    } else if (def.attack.kind === 'volley' || def.attack.kind === 'lob') {
      const rgap = dist(q.x, q.z, t.x, t.z) - radiusOf(t);
      const blocked = def.attack.kind === 'volley' && losCut(s.terrain, q.x, q.z, t.x, t.z) < 1;
      if (rgap > def.attack.range * 0.9 || blocked) {
        const nav = Nav.for(obstacles(s), radiusOf(q), navKey(s));
        const pts = trimPath(q.x, q.z, nav.path(q.x, q.z, t.x, t.z), def.attack.range * (blocked ? 0.45 : 0.75));
        const ap = Math.min(left, 45);
        if (pts.length) { plan.actions.push({ kind: 'move', pts, ap }); left -= ap; }
        if (left >= RULES.overwatchCost) { plan.overwatch = { x: t.x, z: t.z }; left -= RULES.overwatchCost; }
      } else {
        while (left >= def.attack.ap) { plan.actions.push({ kind: def.attack.kind, x: tx, z: tz }); left -= def.attack.ap; }
      }
    } else {
      left = meleePlan(s, q, t, plan, left, L);
    }
    if (left >= RULES.defendCost) plan.defends = Math.min(RULES.maxDefends, Math.floor(left / RULES.defendCost));
    o.squads[q.id] = plan;
  }
  // Raise Monolith picked by the economy: first in the caster's plan (the Lich is free to order;
  // a Necromancer squad only if it already has orders this round)
  if (o.cast) {
    const c = o.cast, q = s.squads.find(x => x.id === c.id);
    if (q && (q.role === 'hero' || o.squads[q.id])) (o.squads[q.id] ||= emptyPlan()).actions.unshift({ kind: 'monolith', x: c.x, z: c.z });
    delete o.cast;
  }
  return o;
}

// the rally point: just in front of our build zone, on the way to the target, clear of terrain
function rallyPoint(s, p, myHq, goal) {
  const W = s.board.w, H = s.board.h;
  const hx = myHq ? myHq.x : (p === 0 ? HQ_X : W - HQ_X), hz = myHq ? myHq.z : H / 2;
  const rx = p === 0 ? s.board.zone + 3 : W - s.board.zone - 3;
  const k = Math.abs(goal.x - hx) > 1 ? (rx - hx) / (goal.x - hx) : 0.5;
  const rz = Math.max(4, Math.min(H - 4, hz + (goal.z - hz) * k));
  return clearSpot(s, rx, rz);
}
function clearSpot(s, x0, z0) {
  const O = obstacles(s);
  for (let r = 0; r < 8; r += 0.75) for (let i = 0; i < Math.max(1, Math.round(r * 4)); i++) {
    const a = i / Math.max(1, Math.round(r * 4)) * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
    if (!pointBlocked(O, x, z, 1.4)) return { x, z };
  }
  return { x: x0, z: z0 };
}

export function aiMemory() { return { seen: {}, prev: {} }; }

// ---- economy: builders put up a per-faction build order; keep training ----------------
function economy(s, p, known, orders) {
  const out = { builds: [], trains: [] };
  let supply = s.supply[p];
  const fac = s.players[p].faction, gold = fac === 'kingdom';
  const mine = s.buildings.filter(b => b.owner === p);
  const hq = mine.find(b => b.type === 'hq');
  if (!hq) return out;
  const fwd = p === 0 ? 1 : -1;
  // items already waiting in the base queue count as placed (they start when a builder is free)
  const queued = buildQueue(s, p).map(it => ({ ...it, owner: p, ...footprint(it.type, it.x, it.z, it.rot) }));
  const builders = s.squads.filter(q => q.owner === p && q.hp > 0 && q.role === 'builder');
  const count = t => mine.filter(b => b.type === t).length + queued.filter(b => b.type === t).length;
  const busy = new Set();
  // 1. unfinished sites / damaged buildings first: send the nearest free builder
  // (builders with no orders keep at their task, finish nearby sites, or gather on their own)
  const tasked = id => builders.some(q => q.task && q.task.bid === id && q.task.kind !== 'gather');
  for (const b of mine.filter(b => (b.build > 0 || b.hp < bdef(b).hp * 0.7) && !tasked(b.id)).sort((a, b) => a.build ? -1 : 1)) {
    const q = builders.filter(x => !busy.has(x.id)).sort((a, c) => dist(a.x, a.z, b.x, b.z) - dist(c.x, c.z, b.x, b.z))[0];
    if (!q) break;
    const bp = builderPlan(s, q, b, apFor(q));
    if (!bp.actions.length) continue;
    const plan = emptyPlan(); plan.actions = bp.actions; orders.squads[q.id] = plan; busy.add(q.id);
  }
  const rising = !!FACTIONS[fac].rises;
  const place = (type, prefer) => {
    const free = builders.filter(x => !busy.has(x.id));
    if (rising && mine.filter(b => b.build > 0 && !BUILDINGS[b.type].skill).length + queued.filter(b => b.type !== 'monolith').length >= RULES.maxRising) return false;   // undead: at most 2 rising (Monoliths don't count)
    // once there is a barracks, keep enough back to train a squad (except for its own site)
    // (except for the first farm: the kingdom's economy comes first)
    const reserve = count('barracks') && mine.some(b => b.type === 'barracks' && !b.build) && type !== 'barracks' && !(type === 'farm' && !count('farm')) ? 24 : 0;
    if ((!free.length && !rising) || supply - reserve < BUILDINGS[type].cost) return false;
    const cand = [];
    if (BUILDINGS[type].site) {
      // free sites the side has seen, nearest first (placeError checks seen ground and, for the undead, graves)
      const sites = (s.shrines || []).filter(sh => !siteTaken(s, sh, queued) && seenBy(s, p, sh.x, sh.z)).sort((a, b) => dist(a.x, a.z, hq.x, hq.z) - dist(b.x, b.z, hq.x, hq.z));
      for (const sh of sites) cand.push({ x: sh.x, z: sh.z, score: -dist(sh.x, sh.z, hq.x, hq.z) });
      // undead: the nearest seen site isn't on graves yet -> spread graves toward it with a cheap Bone Fence
      if (rising && sites.length && !sites.some(sh => !placeError(s, p, type, sh.x, sh.z, 0, queued)) && type !== 'wall') return expandToward(sites[0]);
    } else for (const b of mine) for (let r = 2.5; r <= 8; r += 1.5) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      cand.push({ x, z, score: prefer(x, z) });
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand) for (const rot of [0, 1]) {
      if (placeError(s, p, type, c.x, c.z, rot, queued)) continue;
      const f = { type, x: c.x, z: c.z, rot, owner: p, ...footprint(type, c.x, c.z, rot) };
      if (rising) { queued.push(f); out.builds.push({ type, x: c.x, z: c.z, rot }); supply -= BUILDINGS[type].cost; return true; }
      const q = free.sort((a, b) => dist(a.x, a.z, c.x, c.z) - dist(b.x, b.z, c.x, c.z))[0];
      const bp = builderPlan(s, q, f, apFor(q));
      if (!bp.actions.length) continue;
      queued.push(f);
      out.builds.push({ type, x: c.x, z: c.z, rot });
      supply -= BUILDINGS[type].cost;
      const plan = emptyPlan(); plan.actions = bp.actions; orders.squads[q.id] = plan; busy.add(q.id);
      return true;
    }
    return false;
  };
  // undead: the Lich (free to order) or a Necromancer squad already ordered this round casts Raise
  // Monolith toward `target` (it needs no graves and spreads its own), else a Bone Fence on the edge of
  // its graves closest to `target`. The cast goes first in that squad's plan, from where it stands now.
  let cast = false;
  const monolith = target => {
    const md = BUILDINGS.monolith;
    if (cast || !md || supply < md.cost || mine.some(b => b.type === 'monolith' && b.build > 0)) return false;
    const casters = s.squads.filter(q => q.owner === p && q.hp > 0 && !q.stun && (q.role === 'hero' || q.role === 'mage')
      && skillOf(defOf(q), 'monolith') && (q.mana || 0) >= skillOf(defOf(q), 'monolith').mana);
    const cand = [];
    for (const q of casters) { const sk = skillOf(defOf(q), 'monolith'); for (const r of [2, 3.5, sk.range - 0.6]) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, x = q.x + Math.cos(a) * r, z = q.z + Math.sin(a) * r;
      cand.push({ q, x, z, score: -dist(x, z, target.x, target.z) - (q.role === 'mage' ? 1.5 : 0) });   // the Lich first (free to order)
    } }
    cand.sort((a, b) => b.score - a.score);
    const now = Math.min(...graveCircles(s, p).map(g => dist(g.x, g.z, target.x, target.z) - g.r));
    for (const c of cand.slice(0, 40)) {
      if (placeError(s, p, 'monolith', c.x, c.z, 0, queued, true, true)) continue;
      // only worth it when it brings the graves closer to the target than they already are
      if (dist(c.x, c.z, target.x, target.z) - md.grave >= now - 1) return false;
      out.cast = { id: c.q.id, x: c.x, z: c.z };
      queued.push({ type: 'monolith', x: c.x, z: c.z, rot: 0, owner: p, ...footprint('monolith', c.x, c.z, 0) });
      supply -= md.cost; cast = true;
      return true;
    }
    return false;
  };
  let expanded = false;
  const expandToward = target => {
    // one step at a time: wait for the last fence's graves before the next
    if (expanded) return false;
    if (monolith(target)) { expanded = true; return true; }   // a Monolith takes no rising slot
    if (mine.filter(b => b.build > 0 && !BUILDINGS[b.type].skill).length + queued.filter(b => b.type !== 'monolith').length >= RULES.maxRising) return false;
    if (supply < BUILDINGS.wall.cost || mine.some(b => b.type === 'wall' && b.build > 0)) return false;
    expanded = true;
    const pts = [];
    for (const c of graveCircles(s, p)) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, rr = Math.max(0.5, c.r - 0.25);
      pts.push({ x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr });
    }
    pts.sort((a, b) => dist(a.x, a.z, target.x, target.z) - dist(b.x, b.z, target.x, target.z));
    for (const c of pts.slice(0, 12)) for (const rot of [0, 1]) {
      if (placeError(s, p, 'wall', c.x, c.z, rot, queued)) continue;
      queued.push({ type: 'wall', x: c.x, z: c.z, rot, owner: p, ...footprint('wall', c.x, c.z, rot) });
      out.builds.push({ type: 'wall', x: c.x, z: c.z, rot }); supply -= BUILDINGS.wall.cost;
      return true;
    }
    return false;
  };
  const forward = (x, z) => fwd * (x - hq.x) - Math.abs(z - hq.z) * 0.3;
  const side = (x, z) => -Math.abs(fwd * (x - hq.x) - 1) - Math.abs(Math.abs(z - hq.z) - 5) * 0.5;
  const threat = known.filter(e => dist(e.x, e.z, hq.x, hq.z) < 14);
  const site = gold ? 'mine' : 'well';
  // where the horde is heading: the known enemy HQ, else the middle of the table
  const ehq = knownEnemyHq(s, p);
  const rangeTarget = ehq ? { x: ehq.x, z: ehq.z } : { x: s.board.w / 2, z: s.board.h / 2 };
  // a short per-faction build order, one new building per free builder
  for (let i = 0; i < 3; i++) {
    const ok =
      (threat.length && count('wall') < 2 && place('wall', (x, z) => forward(x, z) - Math.min(...threat.map(e => dist(e.x, e.z, x, z))) * 0.5)) ||
      (!gold && !count(site) && place(site)) ||
      // a Barracks first (small starting armies); the undead only once they have a Soul Well
      (!count('barracks') && (gold || count(site)) && place('barracks', (x, z) => -Math.abs(z - hq.z - 3) - Math.abs(fwd * (x - hq.x) - 2))) ||
      (gold && !count('farm') && place('farm', side)) ||
      (!count(site) && place(site)) ||
      (count('barracks') && !count('tower') && s.round >= 3 && place('tower', forward)) ||
      (count(site) < 2 && s.round >= 4 && place(site)) ||
      // kingdom late game: one big farm per ~3 peasants (4 can work one)
      (gold && count('farm') < Math.min(6, Math.ceil(builderCount(s, p) / 3)) && s.round >= 3 && place('farm', side)) ||
      // rich with a bigger army cap: more barracks so the money turns into squads
      (count('barracks') && count('barracks') < Math.min(4, 1 + Math.floor(supply / 60)) && s.round >= 5 && place('barracks', (x, z) => -Math.abs(z - hq.z) * 0.4 - Math.abs(fwd * (x - hq.x) - 3))) ||
      (FACTIONS[fac].buildings.includes('banner') && count('banner') < RULES.maxBannerCp && s.round >= 5 && supply >= BUILDINGS.banner.cost + 20 && place('banner', (x, z) => -dist(x, z, hq.x, hq.z))) ||
      (rising && s.round >= 5 && count('monolith') < 1 + Math.floor(s.round / 8) && supply >= BUILDINGS.monolith.cost + 25 && rangeTarget && monolith(rangeTarget)) ||
      (count('tower') < 2 && s.round >= 6 && supply >= BUILDINGS.tower.cost + 30 && place('tower', forward));
    if (!ok) break;
  }
  // idle builders stay home (hold), next to the HQ
  // training: kingdom peasants grow with the game (farmers), then soldiers from every training building
  let army = armySize(s, p), nb = builderCount(s, p);
  // few peasants until a Barracks stands (soldiers first), then more for the farms
  const hasBarracks = mine.some(b => b.type === 'barracks' && !b.build);
  // peasants only as needed: 1 to build, plus farmers for the farms (3 each) and miners (2 each)
  const jobs = 1 + 3 * mine.filter(b => b.type === 'farm' && !b.build).length + 2 * mine.filter(b => b.type === 'mine' && !b.build).length;
  const wantB = Math.min(maxBuildersOf(fac), hasBarracks ? Math.max(2, jobs) : 2, 8);
  if (trainsOf('hq', fac).includes('builder') && nb < wantB && s.round >= 2 && !hq.train && !(hq.queue || []).length && supply >= trainCost(fac, 'builder') + 10) {
    out.trains.push({ bid: hq.id, role: 'builder' }); supply -= trainCost(fac, 'builder');
  }
  const shooters = known.filter(e => isShooter(defOf(e))).length;
  // undead without a Soul Well: keep enough souls to spread graves to a site and raise a well there
  if (rising && !count(site)) supply -= BUILDINGS.well.cost + 2 * BUILDINGS.wall.cost;
  for (const b of mine.filter(b => !b.build && !b.train && !(b.queue || []).length && trainsOf(b.type, fac).some(r => r !== 'builder'))) {
    if (army >= s.board.cap) break;
    const myRoles = s.squads.filter(q => q.owner === p).map(q => q.role);
    const n = r => myRoles.filter(x => x === r).length;
    // undead: half the time a cheap swarm pair (the horde), else the usual mix
    const swarm = trainsOf(b.type, fac).includes('swarm') && (b.type === 'hq' || n('swarm') <= n('fighter') + n('ranged'));
    const mage = trainsOf(b.type, fac).includes('mage') && n('mage') < Math.floor(army / 6);
    let role = mage ? 'mage' : swarm ? 'swarm' : shooters >= 2 && n('fast') < 2 ? 'fast' : n('tank') < 1 ? 'tank' : n('ranged') < n('fighter') ? 'ranged' : 'fighter';
    if (!trainsOf(b.type, fac).includes(role)) role = trainsOf(b.type, fac).find(r => r !== 'builder');
    if (supply < trainCost(fac, role)) continue;
    if (army + pairOf(fac, role) > s.board.cap) continue;
    out.trains.push({ bid: b.id, role }); supply -= trainCost(fac, role); army += pairOf(fac, role);
  }
  return out;
}
