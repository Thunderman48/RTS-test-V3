// Round resolution.
//  1. Stance changes and plans (stances build plans from planning-time knowledge)
//  2. Speed tiers act fastest -> slowest. Inside a tier every unit from both sides acts at the
//     same time on a shared timeline where an action's AP cost is also its duration.
//  3. Buildings act last (turrets fire, production spawns).
//  4. Economy tick.
// Produces the new state plus a log used for playback.
import { CONFIG } from '../config.js';
import { dist, norm, segRect, segCircle, pointSegDist, clamp, rot, ANG } from './geom.js';
import {
  clone, findEntity, isUnit, entRadius, moveSpeed, visibleEnemies, visionSources, seen, skillDef,
} from './state.js';
import { Nav } from './nav.js';
import { validateOrders, actionCost } from './orders.js';
import { buildStancePlan } from './stances.js';
import { economyTick } from './economy.js';

const R = CONFIG.unitRadius;
const r3 = v => Math.round(v * 1000) / 1000;

export function damageAfter(dmg, armor, defended) {
  const am = CONFIG.armorK / (CONFIG.armorK + armor);
  let m = 1;
  if (defended) m = clamp(CONFIG.defendBase + (dmg - armor) / CONFIG.defendSlope, CONFIG.defendMin, CONFIG.defendMax);
  return Math.max(1, Math.round(dmg * am * m));
}

export function resolveRound(state0, ordersIn) {
  const s = clone(state0);
  const round = s.round;
  const log = { round, segments: [], stanceReveals: [], econ: null };
  const orders = [0, 1].map(p => validateOrders(s, p, ordersIn[p]));

  // ---- stance changes (revealed during resolution) -------------------------
  for (const p of [0, 1]) {
    for (const [id, st] of Object.entries(orders[p].stances)) {
      const u = s.units.find(x => x.id === id);
      u.stance = st.stance;
      u.anchor = st.anchor ? { ...st.anchor } : { x: u.x, z: u.z };
      log.stanceReveals.push({ id, stance: st.stance });
    }
    for (const [bid, st] of Object.entries(orders[p].rally)) {
      const b = s.buildings.find(x => x.id === bid); if (b) b.rally = st;
    }
  }

  let nav = new Nav(s);
  const views = [0, 1].map(p => visibleEnemies(s, p));

  // ---- runtime records ----------------------------------------------------
  const rts = [];
  const rtById = new Map();
  for (const u of s.units) {
    if (u.hp <= 0) continue;
    const def = CONFIG.units[u.type];
    const direct = orders[u.owner].units[u.id];
    const plan = direct || buildStancePlan(s, u, views[u.owner], nav);
    const hq = s.buildings.find(b => b.owner === u.owner && b.type === 'hq' && b.hp > 0);
    const nearHQ = hq && dist(hq.x, hq.z, u.x, u.z) <= CONFIG.defenderBonus.radius;
    let defends = def.defends + plan.defends + (nearHQ ? CONFIG.defenderBonus.defends : 0);
    if (plan.parry) defends = Math.max(0, defends - 1); // parry replaces the first defend
    const fort = (plan.buffs || []).includes('fortify') ? skillDef(u.type, 'fortify') : null;
    if (fort) defends += fort.defends;
    const r = {
      u, def, plan, direct: !!direct,
      actions: plan.actions.map(a => ({ ...a, cost: actionCost(u, a) })),
      tier: Math.max(CONFIG.minTier, def.tier + plan.upgrades - u.tierDebuff),
      idx: 0, el: 0, st: null,
      defends, armor: def.armor + (fort ? fort.armor : 0),
      parry: plan.parry, ow: plan.overwatch,
      zoneOn: !!def.melee, acted: false,
      owFired: new Set(),
    };
    u.tierDebuff = 0;
    rts.push(r); rtById.set(u.id, r);
  }
  rts.sort((a, b) => (a.u.id < b.u.id ? -1 : 1));

  // ---- helpers ---------------------------------------------------------------
  let seg = null, T = 0;
  const ev = e => { seg.events.push({ t: r3(T), ...e }); };
  const rec = (u, t) => {
    const tr = seg.tracks[u.id] || (seg.tracks[u.id] = []);
    const last = tr[tr.length - 1];
    if (last && last[0] === r3(t)) { last[1] = r3(u.x); last[2] = r3(u.z); return; }
    tr.push([r3(t), r3(u.x), r3(u.z)]);
  };
  const markCombat = (...us) => { for (const x of us) if (x && x.hp !== undefined) x.lastCombat = round; };
  const zoneOff = r => { if (r.zoneOn) { r.zoneOn = false; ev({ type: 'zoneoff', id: r.u.id }); } };
  let visCache = { t: -1, src: null };
  const visSrc = p => {
    if (visCache.t !== T) visCache = { t: T, src: [visionSources(s, 0), visionSources(s, 1)] };
    return visCache.src[p];
  };
  const canSee = (p, e) => seen(visSrc(p), e.x, e.z, isUnit(e) ? 0 : entRadius(e));
  const inEnemyZone = u => {
    for (const r of rts) {
      if (r.u.owner === u.owner || r.u.hp <= 0 || !r.zoneOn) continue;
      if (dist(r.u.x, r.u.z, u.x, u.z) <= r.def.zone) return true;
    }
    return false;
  };
  const reachDist = (u, t) => R + entRadius(t) + CONFIG.meleeReach;
  const inReach = (u, t, slack = 0) => dist(u.x, u.z, t.x, t.z) <= reachDist(u, t) + slack;
  const alive = e => e && e.hp > 0;
  const enemyUnits = p => s.units.filter(x => x.owner !== p && x.hp > 0);
  const enemyBuildings = p => s.buildings.filter(x => x.owner !== p && x.hp > 0);

  function blockedAt(u, x, z, others) {
    if (!nav.free(x, z)) return 'wall';
    for (const o of others) {
      if (o === u || o.hp <= 0) continue;
      if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < (2 * R - 0.02) * (2 * R - 0.02)) return o;
    }
    return null;
  }

  // Closest enemy the unit can reach with the given remaining movement AP.
  function retarget(r, moveApLeft, wantBuilding) {
    const u = r.u;
    const list = wantBuilding ? enemyBuildings(u.owner) : enemyUnits(u.owner);
    const sp = moveSpeed(u.type);
    let best = null, bd = 1e9;
    for (const e of list) {
      if (!canSee(u.owner, e)) continue;
      const d = dist(u.x, u.z, e.x, e.z);
      if (d - reachDist(u, e) > moveApLeft * sp) continue;
      const key = d * 1000 + (e.hp / 1000);
      if (key < bd) { bd = key; best = e; }
    }
    return best;
  }

  // ---- hits ------------------------------------------------------------------
  let hits = [];
  function coverFor(hit, dst) {
    if (!hit.line) return false;
    for (const b of s.buildings) {
      if (b.hp <= 0 || !b.built || !CONFIG.buildings[b.type].cover) continue;
      if (dist(b.x, b.z, dst.x, dst.z) > CONFIG.coverRadius) continue;
      const { ax, az, bx, bz } = hit.line;
      if (pointSegDist(b.x, b.z, ax, az, bx, bz) <= CONFIG.buildings[b.type].r + 0.1
        && dist(ax, az, b.x, b.z) < dist(ax, az, dst.x, dst.z)) return true;
    }
    return false;
  }
  function applyHits(batch, allowCounter = true) {
    const counters = [];
    const byDst = new Map();
    batch.forEach(h => { if (!byDst.has(h.dst.id)) byDst.set(h.dst.id, []); byDst.get(h.dst.id).push(h); });
    for (const [, list] of byDst) {
      list.sort((a, b) => b.dmg - a.dmg); // strongest uses the defend first
      for (const h of list) {
        const dst = h.dst;
        if (!isUnit(dst)) {
          dst.hp -= h.dmg;
          ev({ type: 'hit', src: h.srcId, dst: dst.id, dmg: h.dmg, raw: h.dmg, blocked: 0, kind: h.kind, hp: Math.max(0, dst.hp) });
          markCombat(h.srcUnit);
          continue;
        }
        const r = rtById.get(dst.id);
        const parryable = !h.unparryable && h.dmg <= CONFIG.parryThreshold;
        if (r && r.parry && parryable) {
          r.parry = false; h.parried = true;
          ev({ type: 'parry', id: dst.id, src: h.srcId });
          markCombat(dst, h.srcUnit);
          if (h.melee && allowCounter && h.srcUnit && h.srcUnit.hp > 0 && !h.counter) {
            zoneOff(r);
            counters.push({ srcId: dst.id, srcUnit: dst, dst: h.srcUnit, dmg: r.def.strike.dmg, melee: true, kind: 'counter', counter: true });
          }
          continue;
        }
        let defended = false, cover = false;
        if (h.ranged && !h.place && coverFor(h, dst)) { defended = true; cover = true; }
        else if (r && r.defends > 0) { r.defends--; defended = true; }
        const armor = r ? r.armor : CONFIG.units[dst.type].armor;
        const dmg = damageAfter(h.dmg, armor, defended);
        dst.hp -= dmg;
        markCombat(dst, h.srcUnit);
        // blocked = what the defend/cover saved compared with an undefended hit
        const blocked = defended ? Math.max(0, damageAfter(h.dmg, armor, false) - dmg) : 0;
        ev({ type: 'hit', src: h.srcId, dst: dst.id, dmg, raw: h.dmg, blocked, defended, cover, kind: h.kind, hp: Math.max(0, dst.hp), defLeft: r ? r.defends : 0 });
      }
    }
    if (counters.length) applyHits(counters, false);
  }
  function checkDeaths() {
    for (const u of s.units) {
      if (u.hp <= 0 && !u.dead) {
        u.dead = true; u.hp = 0;
        ev({ type: 'death', id: u.id });
        const r = rtById.get(u.id);
        if (r) { r.idx = r.actions.length; r.ow = 0; r.zoneOn = false; }
        if (u.type === 'commander') {
          s.players[u.owner].revive = { x: u.x, z: u.z, progress: 0 };
          ev({ type: 'revivezone', owner: u.owner, x: r3(u.x), z: r3(u.z) });
        }
      }
    }
    let rebuilt = false;
    for (const b of s.buildings) {
      if (b.hp <= 0 && !b.dead) {
        b.dead = true; b.hp = 0;
        ev({ type: 'bdestroy', id: b.id });
        rebuilt = true;
      }
    }
    if (rebuilt) nav = new Nav(s);
  }

  // first entity hit along a line (allies never block). Returns {e, t, end}
  function traceLine(owner, ax, az, bx, bz) {
    let tWall = 1;
    for (const w of s.map.walls) { const t = segRect(ax, az, bx, bz, w, 0); if (t >= 0 && t < tWall) tWall = t; }
    let best = null, bt = tWall;
    for (const e of enemyUnits(owner)) { const t = segCircle(ax, az, bx, bz, e.x, e.z, R); if (t >= 0 && t < bt) { bt = t; best = e; } }
    for (const e of enemyBuildings(owner)) {
      if (CONFIG.buildings[e.type].cover) continue; // barricades are low cover, not walls
      const t = segCircle(ax, az, bx, bz, e.x, e.z, CONFIG.buildings[e.type].r);
      if (t >= 0 && t < bt) { bt = t; best = e; }
    }
    return { e: best, t: bt, end: { x: ax + (bx - ax) * bt, z: az + (bz - az) * bt }, wall: !best && tWall < 1 };
  }

  // A skill only goes on cooldown when it is actually used.
  function useSkill(r, id) {
    const k = skillDef(r.u.type, id);
    r.u.cds = r.u.cds || {}; r.u.revealed = r.u.revealed || {};
    r.u.cds[id] = k.cd + 1; // decremented at the end of every round
    r.u.revealed[id] = true;
    ev({ type: 'skill', id: r.u.id, skill: id, name: k.name });
  }

  // AP drain removes actions from the end of the plan. In-progress action always finishes.
  function drainAP(r, amount) {
    let rem = amount;
    const first = r.acted ? r.idx + 1 : 0;
    for (let i = r.actions.length - 1; i >= first && rem > 0; i--) {
      const a = r.actions[i];
      if (a.cost <= rem) { rem -= a.cost; r.actions.splice(i, 1); continue; }
      if (a.kind === 'move' || a.kind === 'wait') { a.ap -= rem; a.cost -= rem; rem = 0; }
      else if ((a.kind === 'attack' || a.kind === 'shove') && a.moveAp >= rem) { a.moveAp -= rem; a.cost -= rem; rem = 0; }
      else { rem -= a.cost; r.actions.splice(i, 1); }
    }
    return amount - Math.max(0, rem);
  }

  // ---- single action step -------------------------------------------------------
  // Returns a movement desire {x,z,d,mode} or null. Completions push to `hits`.
  function stepAction(r, moves) {
    const u = r.u, a = r.actions[r.idx];
    const sp = moveSpeed(u.type);
    const n0 = moves.length, myIdx = r.idx;
    if (r.el === 0) {
      r.st = { phase: 'go' };
      ev({ type: 'act', id: u.id, kind: a.kind, cost: a.cost, target: a.target || a.follow || null, ...(a.x !== undefined ? { x: r3(a.x), z: r3(a.z) } : {}) });
      if (a.kind === 'move') {
        const tgt = a.follow ? findEntity(s, a.follow) : null;
        const tx = tgt ? tgt.x : a.x, tz = tgt ? tgt.z : a.z;
        r.st.path = nav.path(u.x, u.z, tx, tz); r.st.repath = 0; r.st.dest = { x: tx, z: tz };
      } else if (a.kind === 'attack' || a.kind === 'shove') {
        r.st.phase = 'approach'; r.st.app = 0; r.st.target = a.target; r.st.repath = 0;
      } else if (a.kind === 'dash') {
        const d = norm(a.x - u.x, a.z - u.z);
        r.st.dir = d.l > 0 ? d : { x: 1, z: 0 };
        r.st.left = skillDef(u.type, 'dash').length;
        if (inEnemyZone(u)) { r.st.phase = 'cancel'; ev({ type: 'cancel', id: u.id, code: 'zone', action: 'dash', reason: 'Dash blocked: it started inside an enemy control zone' }); }
        else { useSkill(r, 'dash'); zoneOff(r); ev({ type: 'dash', id: u.id }); }
      }
    }
    r.el += 1;
    const st = r.st;
    const zf = inEnemyZone(u) ? CONFIG.zoneMoveFactor : 1;
    if (zf < 1 && st && !st.slowedLogged && (a.kind === 'move' || ((a.kind === 'attack' || a.kind === 'shove') && st.phase === 'approach'))) {
      st.slowedLogged = true;
      ev({ type: 'slowed', id: u.id });
    }
    switch (a.kind) {
      case 'wait': break;
      case 'move': {
        if (st.phase !== 'go') break;
        if (a.follow) {
          const tgt = findEntity(s, a.follow);
          if (!alive(tgt)) { st.phase = 'done'; break; }
          if (++st.repath >= 8 || dist(tgt.x, tgt.z, st.dest.x, st.dest.z) > 1) {
            st.repath = 0; st.dest = { x: tgt.x, z: tgt.z }; st.path = nav.path(u.x, u.z, tgt.x, tgt.z);
          }
          if (dist(u.x, u.z, tgt.x, tgt.z) <= 2 * R + entRadius(tgt) + 0.05) break;
        }
        moves.push({ r, mode: 'path', d: sp * zf, leash: a.leash });
        break;
      }
      case 'attack': case 'shove': {
        if (st.phase === 'cancel' || st.phase === 'done') break;
        let tgt = findEntity(s, st.target);
        const wantB = tgt ? !isUnit(tgt) : false;
        const strikeAp = a.kind === 'shove' ? skillDef(u.type, 'shove').ap : r.def.strike.ap;
        if (!alive(tgt)) {
          // target died before the attack landed: redirect to the closest reachable enemy
          const left = st.phase === 'approach' ? Math.max(0, a.moveAp - st.app) : 0;
          tgt = retarget(r, left, wantB);
          const lost = st.target;
          if (!tgt) { st.phase = 'cancel'; ev({ type: 'cancel', id: u.id, code: 'deadtarget', action: a.kind, target: lost, reason: 'Target died first and no other enemy was in reach' }); break; }
          st.target = tgt.id; ev({ type: 'retarget', id: u.id, target: tgt.id, from: lost, code: 'deadtarget' });
        }
        if (st.phase === 'approach') {
          if (inReach(u, tgt)) { st.phase = 'strike'; st.sel = 0; zoneOff(r); }
          else if (st.app >= a.moveAp) {
            const nt = retarget(r, 0, wantB);
            const gap = Math.max(0, dist(u.x, u.z, tgt.x, tgt.z) - reachDist(u, tgt));
            const needAp = a.moveAp + Math.ceil(gap / sp);
            if (nt) { const from = tgt.id; st.target = nt.id; tgt = nt; st.phase = 'strike'; st.sel = 0; zoneOff(r); ev({ type: 'retarget', id: u.id, target: nt.id, from, code: 'outofreach' }); }
            else { st.phase = 'cancel'; ev({ type: 'cancel', id: u.id, code: 'outofreach', action: a.kind, target: tgt.id, needAp, hadAp: a.moveAp, zone: zf < 1, reason: `Target out of reach (needed ~${needAp} AP of approach, had ${a.moveAp})` }); break; }
          } else {
            st.app++;
            if (!st.path || ++st.repath >= 6) { st.repath = 0; st.path = nav.path(u.x, u.z, tgt.x, tgt.z); }
            zoneOff(r);
            moves.push({ r, mode: 'path', d: sp * zf, leash: a.leash, stopAt: tgt, stopDist: reachDist(u, tgt) - 0.05 });
            break;
          }
        }
        if (st.phase === 'strike') {
          st.sel++;
          if (st.sel >= strikeAp) {
            st.phase = 'done';
            if (inReach(u, tgt, 0.45)) {
              if (a.kind === 'shove') {
                useSkill(r, 'shove');
                const sk = skillDef(u.type, 'shove');
                hits.push({ srcId: u.id, srcUnit: u, dst: tgt, dmg: sk.dmg, melee: true, kind: 'shove', push: sk.push });
              } else {
                hits.push({ srcId: u.id, srcUnit: u, dst: tgt, dmg: r.def.strike.dmg, melee: true, kind: 'melee' });
              }
              ev({ type: 'strike', id: u.id, target: tgt.id });
            } else ev({ type: 'miss', id: u.id, target: tgt.id, code: 'moved', reason: 'Target moved out of reach during the swing' });
            st.early = true; // the swing is over: unused approach AP goes to the next action
          }
        }
        break;
      }
      case 'shoot': {
        if (r.el >= a.cost && st.phase === 'go') {
          st.phase = 'done';
          const d = norm(a.x - u.x, a.z - u.z);
          if (d.l < 0.01) break;
          const rg = r.def.shot.range;
          const bx = u.x + d.x * rg, bz = u.z + d.z * rg;
          const tr = traceLine(u.owner, u.x, u.z, bx, bz);
          ev({ type: 'shot', id: u.id, ax: r3(u.x), az: r3(u.z), bx: r3(tr.end.x), bz: r3(tr.end.z) });
          if (tr.e) hits.push({ srcId: u.id, srcUnit: u, dst: tr.e, dmg: r.def.shot.dmg, ranged: true, kind: 'shot', line: { ax: u.x, az: u.z, bx: tr.end.x, bz: tr.end.z } });
        }
        break;
      }
      case 'frag': {
        if (r.el >= a.cost && st.phase === 'go') {
          st.phase = 'done';
          const sk = skillDef(u.type, 'frag');
          let tx = a.x, tz = a.z;
          const d = norm(tx - u.x, tz - u.z);
          if (d.l > sk.range) { tx = u.x + d.x * sk.range; tz = u.z + d.z * sk.range; }
          useSkill(r, 'frag');
          ev({ type: 'frag', id: u.id, ax: r3(u.x), az: r3(u.z), x: r3(tx), z: r3(tz), r: sk.radius });
          for (const e of s.units) {
            if (e.hp <= 0) continue;
            if (e.owner === u.owner && !sk.hitsAllies) continue;
            if (dist(e.x, e.z, tx, tz) <= sk.radius + R) hits.push({ srcId: u.id, srcUnit: u, dst: e, dmg: sk.dmg, ranged: true, place: true, unparryable: true, kind: 'frag' });
          }
          for (const e of enemyBuildings(u.owner)) {
            if (dist(e.x, e.z, tx, tz) <= sk.radius + CONFIG.buildings[e.type].r) hits.push({ srcId: u.id, srcUnit: u, dst: e, dmg: sk.dmg, ranged: true, place: true, kind: 'frag' });
          }
        }
        break;
      }
      case 'disrupt': {
        if (r.el >= a.cost && st.phase === 'go') {
          st.phase = 'done';
          const sk = skillDef(u.type, 'disrupt');
          let tgt = findEntity(s, a.target);
          const ok = t => alive(t) && isUnit(t) && t.owner !== u.owner && dist(u.x, u.z, t.x, t.z) <= sk.range + R;
          if (!ok(tgt)) {
            tgt = null; let bd = 1e9;
            for (const e of enemyUnits(u.owner)) { const d = dist(u.x, u.z, e.x, e.z); if (ok(e) && canSee(u.owner, e) && d < bd) { bd = d; tgt = e; } }
          }
          if (!tgt) { ev({ type: 'cancel', id: u.id, code: 'range', action: 'disrupt', target: a.target, reason: `Disrupt: no enemy within range ${sk.range}` }); break; }
          useSkill(r, 'disrupt'); zoneOff(r);
          const tr = rtById.get(tgt.id);
          let drained = 0, tierNow = false;
          if (tr) {
            drained = drainAP(tr, sk.drain);
            if (!tr.acted) { tr.tier = Math.max(CONFIG.minTier, tr.tier - sk.tierDown); tierNow = true; }
            else tgt.tierDebuff += sk.tierDown;
          }
          markCombat(u, tgt);
          ev({ type: 'disrupt', id: u.id, target: tgt.id, drained, tierNow, ax: r3(u.x), az: r3(u.z), bx: r3(tgt.x), bz: r3(tgt.z) });
        }
        break;
      }
      case 'sweep': {
        if (r.el >= a.cost && st.phase === 'go') {
          st.phase = 'done';
          const sk = skillDef(u.type, 'sweep');
          useSkill(r, 'sweep'); zoneOff(r);
          ev({ type: 'sweep', id: u.id, x: r3(u.x), z: r3(u.z), r: sk.radius });
          for (const e of enemyUnits(u.owner)) {
            if (dist(e.x, e.z, u.x, u.z) <= sk.radius + R) hits.push({ srcId: u.id, srcUnit: u, dst: e, dmg: sk.dmg, melee: true, unparryable: true, kind: 'sweep' });
          }
          for (const e of enemyBuildings(u.owner)) {
            if (dist(e.x, e.z, u.x, u.z) <= sk.radius + CONFIG.buildings[e.type].r) hits.push({ srcId: u.id, srcUnit: u, dst: e, dmg: sk.dmg, melee: true, kind: 'sweep' });
          }
        }
        break;
      }
      case 'dash': {
        if (st.phase !== 'go') break;
        moves.push({ r, mode: 'dash', d: skillDef(u.type, 'dash').length / a.cost });
        break;
      }
    }
    for (let i = n0; i < moves.length; i++) { moves[i].actIdx = myIdx; moves[i].st = st; moves[i].kind = a.kind; }
    if (st && st.early && r.el < a.cost) {
      // Early hit: end the attack now and give the unused approach AP to the next action.
      const saved = a.cost - r.el;
      const nx = r.actions[r.idx + 1];
      if (nx) {
        if (nx.kind === 'move' || nx.kind === 'wait') { nx.ap += saved; nx.cost += saved; }
        else if (nx.kind === 'attack' || nx.kind === 'shove') { nx.moveAp = (nx.moveAp || 0) + saved; nx.cost += saved; }
      }
      ev({ type: 'apreturn', id: u.id, ap: saved, to: nx ? nx.kind : null });
      r.idx++; r.el = 0; r.st = null;
      return;
    }
    if (r.el >= a.cost) { r.idx++; r.el = 0; r.st = null; }
  }

  // ---- movement (simultaneous) ------------------------------------------------
  function resolveMoves(moves) {
    const moved = [];
    const cand = new Map();
    for (const m of moves) {
      const u = m.r.u; const st = m.st;
      let cx = u.x, cz = u.z;
      if (m.mode === 'dash') {
        cx = u.x + st.dir.x * m.d; cz = u.z + st.dir.z * m.d;
      } else {
        let left = m.d;
        while (left > 1e-6 && st.path && st.path.length) {
          const wp = st.path[0];
          const dd = dist(cx, cz, wp.x, wp.z);
          if (dd <= left) { cx = wp.x; cz = wp.z; left -= dd; st.path.shift(); }
          else { cx += (wp.x - cx) / dd * left; cz += (wp.z - cz) / dd * left; left = 0; }
        }
        if (m.stopAt) {
          // don't walk past melee reach
          const dd = dist(cx, cz, m.stopAt.x, m.stopAt.z);
          if (dd < m.stopDist && dist(u.x, u.z, m.stopAt.x, m.stopAt.z) >= m.stopDist) {
            const k = norm(cx - m.stopAt.x, cz - m.stopAt.z);
            cx = m.stopAt.x + k.x * m.stopDist; cz = m.stopAt.z + k.z * m.stopDist;
          }
        }
        if (m.leash) {
          const k = norm(cx - m.leash.x, cz - m.leash.z);
          if (k.l > m.leash.r) { cx = m.leash.x + k.x * m.leash.r; cz = m.leash.z + k.z * m.leash.r; }
        }
      }
      if (Math.abs(cx - u.x) < 1e-9 && Math.abs(cz - u.z) < 1e-9) continue;
      cand.set(u.id, { m, x: cx, z: cz });
    }
    // same moment, same spot: both stop
    const list = [...cand.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (dist(A.x, A.z, B.x, B.z) >= 2 * R) continue;
      const nearA = destNear(A), nearB = destNear(B);
      if (nearA && nearB) { A.stop = true; B.stop = true; }
    }
    function destNear(c) {
      const st = c.m.st;
      if (c.m.mode === 'dash' || !st.path) return false;
      const end = st.path.length ? st.path[st.path.length - 1] : { x: c.x, z: c.z };
      return dist(c.x, c.z, end.x, end.z) < 1.2;
    }
    const all = s.units.filter(x => x.hp > 0);
    for (const c of list) {
      const u = c.m.r.u, st = c.m.st;
      if (c.stop) { if (c.m.mode === 'path' && c.m.kind === 'move') st.phase = 'arrived'; continue; }
      const ox = u.x, oz = u.z;
      let blk = blockedAt(u, c.x, c.z, all);
      let nx = c.x, nz = c.z;
      if (blk && c.m.mode === 'dash') {
        st.phase = 'done'; ev({ type: 'dashstop', id: u.id, code: blk === 'wall' ? 'wall' : 'unit' }); continue; // stops on contact; rest is lost
      }
      if (blk && blk !== 'wall') {
        // stop on contact if the blocker is at/near the destination
        const end = st.path && st.path.length ? st.path[st.path.length - 1] : null;
        if (end && dist(blk.x, blk.z, end.x, end.z) < 2 * R + 0.3 && c.m.kind === 'move') { st.phase = 'arrived'; continue; }
        const vx = c.x - ox, vz = c.z - oz;
        const vl = Math.sqrt(vx * vx + vz * vz);
        // steer around the blocker: slide along its tangent (side closest to where we want to go)
        const n = norm(ox - blk.x, oz - blk.z);
        const t1 = { x: -n.z, z: n.x }, t2 = { x: n.z, z: -n.x };
        const tA = (t1.x * vx + t1.z * vz) >= (t2.x * vx + t2.z * vz) ? t1 : t2;
        const tB = tA === t1 ? t2 : t1;
        const opts = [
          { x: tA.x * vl + n.x * vl * 0.15, z: tA.z * vl + n.z * vl * 0.15 },
          rot(vx, vz, ...ANG['35']), rot(vx, vz, ...ANG['-35']),
          rot(vx, vz, ...ANG['70']), rot(vx, vz, ...ANG['-70']),
          { x: tB.x * vl + n.x * vl * 0.15, z: tB.z * vl + n.z * vl * 0.15 },
        ];
        let ok = false;
        for (const v of opts) {
          if (!blockedAt(u, ox + v.x, oz + v.z, all)) { nx = ox + v.x; nz = oz + v.z; ok = true; break; }
        }
        if (!ok) continue;
        blk = null;
      } else if (blk === 'wall') continue;
      rec(u, T);
      u.x = nx; u.z = nz;
      rec(u, T + 1);
      moved.push(c.m);
      if (c.m.mode === 'dash') {
        st.left -= c.m.d;
        if (inEnemyZone(u)) { st.phase = 'cancel'; ev({ type: 'cancel', id: u.id, code: 'zone', action: 'dash', reason: 'Dash stopped: it ran into an enemy control zone' }); }
        else if (st.left <= 1e-6) st.phase = 'done';
      } else if (c.m.kind === 'move' && st.path && !st.path.length) st.phase = 'arrived';
    }
    return moved;
  }

  // Overwatch: fires once per enemy action at the closest enemy entering/moving in range.
  function overwatch(moved, tierLabel) {
    if (!moved.length) return;
    for (const w of rts) {
      if (w.ow <= 0 || w.u.hp <= 0) continue;
      let best = null, bd = 1e9;
      for (const mv of moved) {
        const m = mv.r;
        if (m.u.owner === w.u.owner || m.u.hp <= 0) continue;
        const key = m.u.id + ':' + tierLabel + ':' + mv.actIdx;
        if (w.owFired.has(key)) continue;
        const d = dist(w.u.x, w.u.z, m.u.x, m.u.z);
        if (d > CONFIG.overwatchRange || !canSee(w.u.owner, m.u)) continue;
        if (d < bd) { bd = d; best = { m, key }; }
      }
      if (!best) continue;
      const tr = traceLine(w.u.owner, w.u.x, w.u.z, best.m.u.x, best.m.u.z);
      if (!tr.e) continue; // wall in the way
      w.owFired.add(best.key);
      w.ow--;
      zoneOff(w);
      ev({ type: 'shot', id: w.u.id, ow: true, ax: r3(w.u.x), az: r3(w.u.z), bx: r3(tr.end.x), bz: r3(tr.end.z) });
      hits.push({ srcId: w.u.id, srcUnit: w.u, dst: tr.e, dmg: CONFIG.overwatchDamage, ranged: true, kind: 'overwatch', line: { ax: w.u.x, az: w.u.z, bx: tr.end.x, bz: tr.end.z } });
    }
  }

  function applyPush(h) {
    const u = h.dst; if (!isUnit(u) || u.hp <= 0) return;
    const d = norm(u.x - h.srcUnit.x, u.z - h.srcUnit.z);
    const dir = d.l > 0 ? d : { x: 1, z: 0 };
    const all = s.units.filter(x => x.hp > 0);
    rec(u, T);
    let moved = 0;
    while (moved < h.push) {
      const nx = u.x + dir.x * 0.1, nz = u.z + dir.z * 0.1;
      if (blockedAt(u, nx, nz, all)) break;
      u.x = nx; u.z = nz; moved += 0.1;
    }
    rec(u, T + 0.6);
    const r = rtById.get(u.id);
    if (r) zoneOff(r); // being pushed counts as moving
    ev({ type: 'push', id: u.id, x: r3(u.x), z: r3(u.z) });
  }

  // ---- prepaid reveals (tier upgrades, fortify, etc. revealed at start) --------
  const startSeg = { kind: 'start', len: 0, tracks: {}, events: [] };
  seg = startSeg; T = 0;
  for (const r of rts) {
    for (const id of r.plan.buffs || []) useSkill(r, id);
  }
  // Rally: the commander and allies within range act one tier earlier this round
  for (const r of rts) {
    if (!(r.plan.buffs || []).includes('rally')) continue;
    const k = skillDef(r.u.type, 'rally');
    const ids = [];
    for (const o of rts) {
      if (o.u.owner !== r.u.owner || o.u.hp <= 0 || o.rallied) continue;
      if (dist(o.u.x, o.u.z, r.u.x, r.u.z) <= k.radius) { o.tier += k.tierUp; o.rallied = true; ids.push(o.u.id); }
    }
    ev({ type: 'rally', id: r.u.id, ids, x: r3(r.u.x), z: r3(r.u.z), r: k.radius });
  }
  for (const r of rts) {
    ev({ type: 'tier', id: r.u.id, tier: r.tier, upgrades: r.plan.upgrades });
    // what each unit has ready this round (for the status icons)
    ev({ type: 'prep', id: r.u.id, defends: r.defends, parry: !!r.parry, ow: r.ow, buffs: [...(r.plan.buffs || [])], upgrades: r.plan.upgrades, rallied: !!r.rallied });
  }
  log.segments.push(startSeg);

  // ---- tiers fastest -> slowest ----------------------------------------------
  const maxTier = Math.max(...Object.values(CONFIG.units).map(d => d.tier)) + CONFIG.maxTierUpgrades + 1; // +1 for Rally
  for (let tier = maxTier; tier >= CONFIG.minTier; tier--) {
    const group = rts.filter(r => !r.acted && r.u.hp > 0 && r.tier === tier);
    if (!group.length) continue;
    for (const r of group) r.acted = true;
    seg = { kind: 'tier', tier, len: 0, tracks: {}, events: [], units: group.map(r => r.u.id) };
    T = 0;
    let guard = 0;
    while (guard++ < 600) {
      const act = group.filter(r => r.u.hp > 0 && r.idx < r.actions.length);
      if (!act.length) break;
      hits = [];
      const moves = [];
      for (const r of act) stepAction(r, moves);
      const moved = resolveMoves(moves);
      overwatch(moved, tier);
      const batch = hits; hits = [];
      applyHits(batch);
      for (const h of batch) if (h.push && !h.parried && h.dst.hp > 0) applyPush(h);
      checkDeaths();
      T += 1;
    }
    seg.len = T;
    if (seg.len > 0 || seg.events.length) log.segments.push(seg);
  }

  // ---- buildings act last ---------------------------------------------------------
  seg = { kind: 'buildings', len: 0, tracks: {}, events: [] };
  T = 0;
  const shooters = s.buildings.filter(b => b.hp > 0 && b.built && CONFIG.buildings[b.type].attack);
  const maxShots = Math.max(0, ...shooters.map(b => Math.floor(CONFIG.buildingAP / CONFIG.buildings[b.type].attack.ap)));
  for (let k = 0; k < maxShots; k++) {
    T = k * 30;
    hits = [];
    for (const b of shooters) {
      if (b.hp <= 0) continue;
      const at = CONFIG.buildings[b.type].attack;
      if (k >= Math.floor(CONFIG.buildingAP / at.ap)) continue;
      let best = null, bd = 1e9;
      for (const e of enemyUnits(b.owner)) {
        const d = dist(b.x, b.z, e.x, e.z);
        if (d > at.range + R || !canSee(b.owner, e)) continue;
        const tr = traceLine(b.owner, b.x, b.z, e.x, e.z);
        if (!tr.e) continue;
        if (d < bd) { bd = d; best = tr; }
      }
      if (!best) continue;
      ev({ type: 'shot', id: b.id, ax: r3(b.x), az: r3(b.z), bx: r3(best.end.x), bz: r3(best.end.z), turret: true });
      hits.push({ srcId: b.id, srcUnit: null, dst: best.e, dmg: at.dmg, ranged: true, kind: 'turret', line: { ax: b.x, az: b.z, bx: best.end.x, bz: best.end.z } });
    }
    applyHits(hits);
    checkDeaths();
  }
  T = maxShots * 30 + 10;
  // ---- economy tick (spawns are logged in the buildings segment) -----------------
  log.econ = economyTick(s, orders, ev);
  seg.len = T + 10;
  log.segments.push(seg);

  // cleanup
  s.units = s.units.filter(u => u.hp > 0);
  for (const u of s.units) delete u.dead;
  s.buildings = s.buildings.filter(b => b.hp > 0);
  for (const b of s.buildings) delete b.dead;
  return { state: s, log };
}
