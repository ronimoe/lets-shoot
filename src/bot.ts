import * as THREE from 'three';
import type { Game, Player, Input } from './game';
import { findPath, SITES, SiteKey, randomCellIn, zoneAtWorld, clearWalk, CELL, hasLOS, heightAt } from './map';
import { WEAPONS } from './weapons';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'elite';

const DIFF: Record<Difficulty, { react: number; turn: number; noise: number; comp: number; fov: number; burstPause: number }> = {
  easy: { react: 0.62, turn: 3.2, noise: 0.11, comp: 0.25, fov: 0.9, burstPause: 0.5 },
  normal: { react: 0.42, turn: 5.5, noise: 0.065, comp: 0.5, fov: 1.0, burstPause: 0.35 },
  hard: { react: 0.28, turn: 8.5, noise: 0.04, comp: 0.75, fov: 1.05, burstPause: 0.25 },
  elite: { react: 0.2, turn: 12, noise: 0.025, comp: 0.9, fov: 1.1, burstPause: 0.18 },
};

type Task = 'idle' | 'goSite' | 'hold' | 'plant' | 'defuse' | 'getBomb' | 'guardBomb' | 'investigate' | 'stage' | 'retake';

function angDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Bot {
  g: Game; p: Player; d: typeof DIFF.normal;
  task: Task = 'idle';
  path: { x: number; z: number }[] = [];
  pathI = 0;
  goal: { x: number; z: number } | null = null;
  lookAt: { x: number; z: number } | null = null;
  holdLooks: { x: number; z: number }[] = [];
  nextLookSwap = 0;
  site: SiteKey = 'A';
  target: Player | null = null;
  reactAt = 0;
  aimErrP = 0; aimErrY = 0;
  lastSeenPos: THREE.Vector3 | null = null;
  lastSeenT = -10;
  strafe = 0; strafeUntil = 0;
  burstLeft = 0; burstPauseUntil = 0;
  stuckT = 0; lastProgPos = new THREE.Vector3(); jumpNext = false;
  thinkTimer = 0;
  repathAt = 0;
  startDelay = 0;
  wantCrouch = false;
  nadeThrown = false;
  hasPurchased = false;
  altHeld = false;
  watch: { x: number; z: number } | null = null;
  nade: { type: 'frag' | 'smoke'; x: number; z: number; until: number } | null = null;

  constructor(g: Game, p: Player, diff: Difficulty) {
    this.g = g; this.p = p; this.d = DIFF[diff];
  }

  get side() { return this.g.side(this.p); }

  onRoundStart() {
    this.task = 'idle'; this.path = []; this.goal = null; this.target = null; this.lastSeenPos = null; this.lastSeenT = -10;
    this.lookAt = null; this.startDelay = this.g.time + 6 + Math.random() * 2.5; this.nadeThrown = false;
    this.hasPurchased = false;
    this.wantCrouch = false;
    this.nade = null;
  }

  private buy() {
    const g = this.g, p = this.p;
    this.hasPurchased = true;
    const side = this.side;
    const teammates = g.players.filter(q => q.team === p.team);
    const avg = teammates.reduce((s, q) => s + q.money, 0) / teammates.length;
    const pistolRound = g.round === 1 || g.round === 7;
    const lastOfHalf = g.round === 6 || g.score[0] === 6 || g.score[1] === 6;
    if (pistolRound) {
      const r = Math.random();
      if (r < 0.45) g.buy(p, 'vest');
      else if (r < 0.75) { g.buy(p, 'hammer'); }
      else { g.buy(p, side === 'att' ? 'frag' : 'kit'); g.buy(p, 'smoke'); }
      return;
    }
    const eco = avg < 2900 && !lastOfHalf && p.money < 3600;
    if (eco) {
      if (p.money > 1800 && Math.random() < 0.3) g.buy(p, 'hammer');
      return;
    }
    const sniperOwned = teammates.some(q => q.primary?.id === 'longbow');
    if (!p.primary) {
      if (p.money >= 5800 && !sniperOwned && Math.random() < 0.35) g.buy(p, 'longbow');
      else if (p.money >= 3900) g.buy(p, side === 'def' ? (Math.random() < 0.6 ? 'falcon' : 'ranger') : (Math.random() < 0.75 ? 'ranger' : 'falcon'));
      else if (p.money >= 2300) g.buy(p, Math.random() < 0.7 ? 'wasp' : 'thresher');
    }
    if (p.money >= 1000 && !p.helmet) g.buy(p, 'vesthelm');
    else if (p.money >= 650 && p.armor < 100) g.buy(p, 'vest');
    if (side === 'def' && p.money >= 400) g.buy(p, 'kit');
    if (p.money >= 300) g.buy(p, Math.random() < 0.5 ? 'smoke' : 'frag');
    if (p.money >= 300) g.buy(p, 'frag');
    if (p.primary) g.switchTo(p, 'primary');
  }

  onDamaged(a: Player | null) {
    if (!a || !this.p.alive) return;
    if (!this.target) {
      this.lastSeenPos = a.pos.clone();
      this.lastSeenT = this.g.time;
      this.lookAt = { x: a.pos.x, z: a.pos.z };
    }
  }

  // ---------- planning ----------
  private plan() {
    const g = this.g, p = this.p;
    const side = this.side;
    const b = g.bomb;
    if (side === 'att') {
      if (b.state === 'planted') {
        if (this.task !== 'guardBomb') {
          this.task = 'guardBomb';
          const site = SITES[b.site];
          this.setGoal(guardSpot(b.pos.x, b.pos.z));
          // watch the charge itself (defusers) plus the nearest ways in
          this.holdLooks = [{ x: b.pos.x, z: b.pos.z }, { x: b.pos.x, z: b.pos.z }, ...site.entrances];
        }
        return;
      }
      if (b.state === 'dropped') {
        // closest living attacker bot goes for it
        const atts = g.players.filter(q => q.alive && g.side(q) === 'att' && q.brain);
        atts.sort((x, y) => x.pos.distanceTo(b.pos) - y.pos.distanceTo(b.pos));
        if (atts[0] === p) {
          if (this.task !== 'getBomb' || !this.goal || Math.hypot(this.goal.x - b.pos.x, this.goal.z - b.pos.z) > 0.5) {
            this.task = 'getBomb';
            this.setGoal({ x: b.pos.x, z: b.pos.z });
          }
          return;
        }
      }
      if (p.hasBomb) {
        const site = SITES[g.plan.site];
        const zone = zoneAtWorld(p.pos.x, p.pos.z);
        if (zone === site.zone || zone === SITES.A.zone || zone === SITES.B.zone) {
          // inside a site: plant if no threat visible
          if (!this.target || g.time - this.lastSeenT > 2.5) { this.task = 'plant'; return; }
        }
        if (this.task !== 'goSite' || !this.goal) {
          this.task = 'goSite';
          const spot = this.plantSpot(g.plan.site);
          this.setGoal(spot);
        }
        // wait for team execute (unless late)
        if (g.time < g.plan.execAt && g.roundTimeLeft() > 45) {
          this.task = 'stage';
        }
        return;
      }
      // escorts
      if (this.task !== 'goSite' && this.task !== 'stage' && this.task !== 'hold' && this.task !== 'investigate') {
        this.site = g.plan.site;
        this.task = 'stage';
        const st = this.stagingPoint(this.site);
        this.setGoal(st);
      }
      if (this.task === 'stage' && (g.time >= g.plan.execAt || g.roundTimeLeft() < 45)) {
        this.task = 'goSite';

        const site = SITES[g.plan.site];
        this.setGoal(randomCellIn(site.cells));
      }
      if (this.task === 'goSite' && this.arrived()) {
        this.task = 'hold';
        this.holdLooks = SITES[g.plan.site].entrances.slice();
      }
      return;
    }
    // ---- defenders ----
    if (b.state === 'planted') {
      const left = b.explodeAt - g.time;
      const toBomb = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (this.task !== 'defuse' && this.task !== 'retake') {
        if (toBomb < 9) { this.task = 'defuse'; this.setGoal({ x: b.pos.x, z: b.pos.z }); return; }
        this.task = 'retake';
        const ents = SITES[b.site].entrances.slice().sort((x, y) => Math.hypot(x.x - p.pos.x, x.z - p.pos.z) - Math.hypot(y.x - p.pos.x, y.z - p.pos.z));
        this.setGoal(ents[0]);
        this.holdLooks = [{ x: b.pos.x, z: b.pos.z }];
      }
      if (this.task === 'retake') {
        const mates = g.players.filter(q => q !== p && q.alive && q.team === p.team);
        const near = mates.filter(q => q.pos.distanceTo(p.pos) < 12).length;
        const need = Math.min(2, mates.length);
        const timeNeeded = (p.kit ? 3.5 : 7) + toBomb / 5 + 4;
        if (left < timeNeeded || (this.arrived() && near >= need) || toBomb < 6) {
          this.task = 'defuse';
          this.setGoal({ x: b.pos.x, z: b.pos.z });
        }
      }
      return;
    }
    if (this.task === 'idle') {
      const defs = g.players.filter(q => g.side(q) === 'def');
      const idx = defs.indexOf(p);
      this.site = idx % 2 === 0 ? 'A' : 'B';
      if (idx === 4) this.site = Math.random() < 0.5 ? 'A' : 'B';
      this.task = 'goSite';
      const site = SITES[this.site];
      const ent = site.entrances[(idx >> 1) % site.entrances.length + (Math.random() < 0.3 ? 1 : 0)] ?? site.entrances[0];
      this.watch = ent;
      this.setGoal(angleSpot(ent));
    }
    if (this.task === 'goSite' && this.arrived()) {
      this.task = 'hold';
      this.holdLooks = this.watch ? [this.watch] : SITES[this.site].entrances.slice();
    }
    // rotate if enemies seen at the other site by teammates
    if (this.task === 'hold' || this.task === 'goSite') {
      const other: SiteKey = this.site === 'A' ? 'B' : 'A';
      const contested = g.players.some(q => q.alive && g.side(q) === 'att' && q.spottedUntil > g.time && zoneAtWorld(q.pos.x, q.pos.z) === SITES[other].zone);
      if (contested && Math.random() < 0.02) {
        this.site = other;
        this.task = 'goSite';
        this.watch = null;
        this.setGoal(randomCellIn(SITES[other].cells));
      }
    }
  }

  private plantSpot(site: SiteKey) {
    const s = SITES[site];
    // prefer cells near a crate (cover)
    return this.coverSpotNear(s.center.x, s.center.z, 0, 6);
  }

  private coverSpotNear(x: number, z: number, minD: number, maxD: number) {
    const cells = [...SITES.A.cells, ...SITES.B.cells].filter(c => {
      const d = Math.hypot(c.x - x, c.z - z);
      return d >= minD && d <= maxD;
    });
    if (!cells.length) return { x, z };
    return cells[Math.floor(Math.random() * cells.length)];
  }

  private stagingPoint(site: SiteKey) {
    // a point a bit outside the site along one of the attacker routes
    const pts = site === 'A'
      ? [{ x: 9, z: 46 }, { x: 20, z: 34 }, { x: 7, z: 56 }]
      : [{ x: 79, z: 46 }, { x: 66, z: 41 }, { x: 79, z: 56 }];
    const pick = pts[Math.floor(Math.random() * pts.length)];
    return { x: pick.x + (Math.random() - 0.5) * 2, z: pick.z + (Math.random() - 0.5) * 2 };
  }

  private setGoal(pt: { x: number; z: number }) {
    this.goal = { x: pt.x, z: pt.z };
    this.path = findPath(this.p.pos.x, this.p.pos.z, pt.x, pt.z) ?? [];
    this.pathI = 0;
    this.repathAt = this.g.time + 4;
  }

  private arrived() {
    if (!this.goal) return true;
    return Math.hypot(this.goal.x - this.p.pos.x, this.goal.z - this.p.pos.z) < 1.0;
  }

  // ---------- perception ----------
  private perceive() {
    const g = this.g, p = this.p;
    let best: Player | null = null, bestD = Infinity;
    for (const e of g.players) {
      if (!e.alive || e.team === p.team) continue;
      const d = e.pos.distanceTo(p.pos);
      if (d > 80) continue;
      // wider awareness for the current target
      const fovCheck = e !== this.target;
      if (!g.canSee(p, e, fovCheck)) continue;
      // further enemies are noticed slower; prefer closest
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      best.spottedUntil = g.time + 1.2;
      if (best !== this.target) {
        const already = this.target && g.time - this.lastSeenT < 0.4;
        this.target = best;
        const dist = bestD;
        const ang = Math.abs(angDiff(p.yaw, Math.atan2(-(best.pos.x - p.pos.x), -(best.pos.z - p.pos.z))));
        const preAim = ang < 0.2 ? 0.55 : ang < 0.6 ? 0.8 : 1.15;
        const moving = Math.hypot(p.vel.x, p.vel.z) > 3 ? 1.2 : 1;
        this.reactAt = g.time + (already ? this.d.react * 0.4 : this.d.react * preAim * moving * (0.8 + Math.random() * 0.4) + dist * 0.003);
        const err = this.d.noise * (1 + dist / 30);
        this.aimErrP = (Math.random() - 0.5) * err * 2;
        this.aimErrY = (Math.random() - 0.5) * err * 3;
        this.burstLeft = 0;
      }
      this.lastSeenPos = best.pos.clone();
      this.lastSeenT = g.time;
    } else if (this.target && (g.time - this.lastSeenT > 0.35 || !this.target.alive)) {
      this.target = null;
    }
    // hearing
    if (!this.target) {
      for (let i = g.sounds.length - 1; i >= 0; i--) {
        const s = g.sounds[i];
        if (g.time - s.t > 0.2) break;
        if (s.by.team === p.team || !s.by.alive) continue;
        const d = s.pos.distanceTo(p.pos);
        if (d < 22 * s.loud) {
          this.lastSeenPos = s.pos.clone();
          this.lastSeenT = g.time - 0.5;
          this.lookAt = { x: s.pos.x, z: s.pos.z };
          break;
        }
      }
    }
  }

  // ---------- main ----------
  think(dt: number): Input {
    const g = this.g, p = this.p;
    const inp: Input = { fwd: 0, side: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, use: false };
    if (g.phase === 'freeze') {
      if (!this.hasPurchased && g.time - g.roundStart > 0.5 + Math.random() * 2) this.buy();
      return inp;
    }
    if (g.phase === 'over') return inp;
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.1;
      this.perceive();
      if (g.phase !== 'end') this.plan();
    }
    // grenade throws (stand still, aim a lob, release)
    if (this.nade && g.phase !== 'end') {
      const n = this.nade;
      if (this.target || !p.nades.includes(n.type) || g.time > n.until) {
        this.nade = null;
        if (p.slot === 'grenade') g.switchTo(p, p.primary ? 'primary' : 'secondary');
      } else {
        if (p.slot !== 'grenade') g.switchTo(p, 'grenade');
        else if (p.nades[0] !== n.type && g.time >= p.switchEnd) g.cycleNade(p);
        const dx = n.x - p.pos.x, dz = n.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        const yaw = Math.atan2(-dx, -dz);
        const v = 19;
        const pitch = 0.5 * Math.asin(Math.min(1, d * 18 / (v * v))) - 0.12;
        p.yaw += angDiff(p.yaw, yaw) * Math.min(1, dt * 12);
        p.pitch += (pitch - p.pitch) * Math.min(1, dt * 12);
        if (Math.abs(angDiff(p.yaw, yaw)) < 0.03 && Math.abs(pitch - p.pitch) < 0.03 && g.time >= p.switchEnd && p.nades[0] === n.type) inp.fire = true;
        return inp;
      }
    }
    // weapon choice
    if (p.slot === 'grenade' && !this.target) g.switchTo(p, p.primary ? 'primary' : 'secondary');
    else if (p.slot !== 'primary' && p.primary && p.slot !== 'bomb') g.switchTo(p, 'primary');
    else if (!p.primary && p.slot !== 'secondary' && p.secondary && p.slot !== 'bomb') g.switchTo(p, 'secondary');
    const gun = p.gun();
    const def = p.def();

    let moveTo: { x: number; z: number } | null = null;
    let faceYaw: number | null = null, facePitch = 0;

    if (this.target && this.target.alive && g.phase !== 'end') {
      const t = this.target;
      const eye = g.eyePos(p);
      const dist = t.pos.distanceTo(p.pos);
      // aim point: between chest and head depending on skill
      const headY = t.pos.y + t.eye + 0.02;
      const chestY = t.pos.y + t.height * 0.62;
      const aimY = this.d.comp > 0.7 ? headY - 0.08 : chestY + (headY - chestY) * 0.3;
      // lead slightly
      const tx = t.pos.x + t.vel.x * 0.05, tz = t.pos.z + t.vel.z * 0.05;
      const dx = tx - eye.x, dy = aimY - eye.y, dz = tz - eye.z;
      const hd = Math.hypot(dx, dz);
      faceYaw = Math.atan2(-dx, -dz) + this.aimErrY;
      facePitch = Math.atan2(dy, hd) + this.aimErrP - p.recoilP * this.d.comp;
      faceYaw -= p.recoilY * this.d.comp;
      // error decays as we track
      const decay = Math.exp(-dt * 3.2);
      this.aimErrP *= decay; this.aimErrY *= decay;
      const yawErr = Math.abs(angDiff(p.yaw + p.recoilY, faceYaw + p.recoilY * this.d.comp));
      const pitchErr = Math.abs(p.pitch + p.recoilP - (facePitch + p.recoilP * this.d.comp));
      const tol = Math.atan2(0.32, Math.max(1, dist)) + 0.012;
      if (gun && gun.ammo === 0) inp.reload = true;
      const canShoot = g.time >= this.reactAt && yawErr < tol * 1.6 && pitchErr < tol * 1.6;
      // burst control at range
      const longRange = dist > 18 && def.auto;
      if (canShoot && g.time >= this.burstPauseUntil) {
        inp.fire = !def.auto ? (Math.random() < 0.5) : true;
        if (def.slot === 'melee') inp.fire = dist < 2;
        if (longRange) {
          if (this.burstLeft <= 0) this.burstLeft = 3 + Math.floor(Math.random() * 3);
          if (p.lastFire === g.time - dt || g.time - p.lastFire < dt * 1.5) this.burstLeft--;
          if (this.burstLeft <= 1 && p.shots >= 3) { this.burstPauseUntil = g.time + this.d.burstPause + Math.random() * 0.2; this.burstLeft = 0; }
        } else if (p.shots > 10 && dist > 10) {
          this.burstPauseUntil = g.time + this.d.burstPause;
        }
        if (def.scope && !p.scoped) inp.fire = false;
      }
      if (def.scope && !p.scoped && dist > 6 && !this.altHeld) inp.alt = true;
      this.altHeld = inp.alt;
      // movement while fighting: counter-strafe to shoot accurately at range, strafe at close range
      if (def.slot === 'melee') moveTo = { x: t.pos.x, z: t.pos.z };
      else if (dist < 9 || !canShoot) {
        if (g.time > this.strafeUntil) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeUntil = g.time + 0.25 + Math.random() * 0.45; }
        inp.side = this.strafe;
        if (dist < 9 && canShoot && def.auto && Math.random() < 0.4) inp.side = 0;
      }
      if (dist > 14 && Math.random() < 0.002) this.wantCrouch = true;
      inp.crouch = this.wantCrouch && dist > 12;
      inp.walk = false;
    } else {
      this.wantCrouch = false;
      // smoke off the entrance we are about to cross during an execute
      if (this.side === 'att' && this.task === 'goSite' && !this.nadeThrown && p.nades.includes('smoke') && !p.hasBomb) {
        const eye = g.eyePos(p);
        const ent = SITES[g.plan.site].entrances
          .map(e => ({ e, d: Math.hypot(e.x - p.pos.x, e.z - p.pos.z) }))
          .filter(o => o.d > 6 && o.d < 18 && hasLOS(eye.x, eye.y, eye.z, o.e.x, 1.2, o.e.z))
          .sort((a, c) => a.d - c.d)[0];
        if (ent) { this.nade = { type: 'smoke', x: ent.e.x, z: ent.e.z, until: g.time + 3 }; this.nadeThrown = true; }
      }
      if (p.nades.includes('frag') && this.lastSeenPos && g.time - this.lastSeenT > 0.4 && g.time - this.lastSeenT < 3 && Math.random() < 0.03) {
        const d = this.lastSeenPos.distanceTo(p.pos);
        const eye = g.eyePos(p);
        if (d > 7 && d < 20 && hasLOS(eye.x, eye.y, eye.z, this.lastSeenPos.x, 1.0, this.lastSeenPos.z)) {
          this.nade = { type: 'frag', x: this.lastSeenPos.x, z: this.lastSeenPos.z, until: g.time + 2 };
        }
      }
      if (gun && gun.ammo < WEAPONS[gun.id].mag * 0.4 && !p.reloadEnd && g.time - this.lastSeenT > 1.5) inp.reload = true;
      switch (this.task) {
        case 'plant': {
          inp.use = true;
          if (!p.hasBomb) this.task = 'idle';
          break;
        }
        case 'defuse': {
          const b = g.bomb;
          const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
          if (d < 1.2) {
            inp.use = true; inp.crouch = true;
          } else moveTo = this.nextWaypoint();
          if (this.goal && Math.hypot(this.goal.x - b.pos.x, this.goal.z - b.pos.z) > 1) this.setGoal({ x: b.pos.x, z: b.pos.z });
          break;
        }
        case 'hold':
        case 'guardBomb': {
          if (!this.arrived()) moveTo = this.nextWaypoint();
          if (g.time > this.nextLookSwap && this.holdLooks.length) {
            this.lookAt = this.holdLooks[Math.floor(Math.random() * this.holdLooks.length)];
            this.nextLookSwap = g.time + 2 + Math.random() * 3;
          }
          inp.walk = true;
          break;
        }
        case 'retake':
          if (!this.arrived()) moveTo = this.nextWaypoint();
          else { this.lookAt = { x: g.bomb.pos.x, z: g.bomb.pos.z }; inp.walk = true; }
          break;
        case 'stage':
        case 'goSite':
        case 'getBomb':
        case 'investigate': {
          if (g.time < this.startDelay) break;
          if (this.task === 'stage' && this.arrived()) {
            if (g.time > this.nextLookSwap) {
              const site = SITES[g.plan.site];
              this.lookAt = site.entrances[Math.floor(Math.random() * site.entrances.length)];
              this.nextLookSwap = g.time + 2 + Math.random() * 2;
            }
            inp.walk = true;
          } else moveTo = this.nextWaypoint();
          // carrier waits a bit at staging; if goal reached and nothing to do, hold
          if (this.task === 'goSite' && this.arrived() && p.hasBomb) {
            const zone = zoneAtWorld(p.pos.x, p.pos.z);
            if (zone === SITES.A.zone || zone === SITES.B.zone) this.task = 'plant';
            else this.setGoal(this.plantSpot(g.plan.site));
          }
          // walk quietly when close to the site during execute
          break;
        }
      }
      // grab a better gun lying nearby
      if (!p.primary && this.task !== 'plant' && this.task !== 'defuse') {
        const drop = g.nearestDrop(p, 12, 'primary');
        if (drop && clearWalk(p.pos.x, p.pos.z, drop.pos.x, drop.pos.z)) moveTo = { x: drop.pos.x, z: drop.pos.z };
      }
      // investigate recent sounds by turning
      if (this.lastSeenPos && g.time - this.lastSeenT < 3) {
        this.lookAt = { x: this.lastSeenPos.x, z: this.lastSeenPos.z };
      }
    }

    // ---- steering ----
    if (moveTo) {
      const dx = moveTo.x - p.pos.x, dz = moveTo.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const wantYaw = Math.atan2(-dx, -dz);
        // convert world dir into fwd/side relative to current yaw
        const rel = angDiff(p.yaw, wantYaw);
        inp.fwd = Math.cos(rel);
        inp.side = this.target ? inp.side + -Math.sin(rel) : -Math.sin(rel);
        if (!this.target) faceYaw = faceYaw ?? (this.lookAt && this.task !== 'goSite' && this.task !== 'getBomb' && this.task !== 'stage' ? null : wantYaw);
      }
      // stuck detection
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        if (p.pos.distanceTo(this.lastProgPos) < 0.4) {
          inp.jump = true;
          if (this.goal) this.setGoal(this.goal);
        }
        this.lastProgPos.copy(p.pos);
        this.stuckT = 0;
      }
      if (g.time > this.repathAt && this.goal) this.setGoal(this.goal);
    }
    if (faceYaw === null && this.lookAt) {
      faceYaw = Math.atan2(-(this.lookAt.x - p.pos.x), -(this.lookAt.z - p.pos.z));
      const hd = Math.hypot(this.lookAt.x - p.pos.x, this.lookAt.z - p.pos.z);
      facePitch = Math.atan2(1.55 - (p.pos.y + p.eye), Math.max(1, hd));
    }
    if (faceYaw !== null) {
      const turn = this.d.turn * (this.target ? 1 : 0.6) * dt;
      const dyaw = angDiff(p.yaw, faceYaw);
      // ease: faster when far away, precise when close
      const step = Math.sign(dyaw) * Math.min(Math.abs(dyaw), Math.max(turn * Math.min(1, Math.abs(dyaw) * 3), Math.abs(dyaw) * 0.18));
      p.yaw += step;
      const dp = facePitch - p.pitch;
      p.pitch += Math.sign(dp) * Math.min(Math.abs(dp), Math.max(turn * 0.8 * Math.min(1, Math.abs(dp) * 3), Math.abs(dp) * 0.18));
      p.pitch = Math.max(-1.4, Math.min(1.4, p.pitch));
    }
    const l = Math.hypot(inp.fwd, inp.side);
    if (l > 1) { inp.fwd /= l; inp.side /= l; }
    return inp;
  }

  private nextWaypoint(): { x: number; z: number } | null {
    if (!this.goal) return null;
    while (this.pathI < this.path.length) {
      const w = this.path[this.pathI];
      const d = Math.hypot(w.x - this.p.pos.x, w.z - this.p.pos.z);
      const last = this.pathI === this.path.length - 1;
      if (d < (last ? 0.35 : 0.8)) { this.pathI++; continue; }
      // skip ahead if a later waypoint is directly reachable
      if (!last && this.pathI + 1 < this.path.length) {
        const n = this.path[this.pathI + 1];
        if (Math.random() < 0.1 && clearWalk(this.p.pos.x, this.p.pos.z, n.x, n.z)) { this.pathI++; continue; }
      }
      return w;
    }
    // path used up (or never built) but not there yet: walk straight back if it's close and clear
    const gd = Math.hypot(this.goal.x - this.p.pos.x, this.goal.z - this.p.pos.z);
    if (gd > 0.5 && gd < 6 && clearWalk(this.p.pos.x, this.p.pos.z, this.goal.x, this.goal.z)) return this.goal;
    return null;
  }
}

// A post-plant spot 4-13m from the charge with sight of it, preferring cells beside cover.
function guardSpot(bx: number, bz: number) {
  const opts: { x: number; z: number }[] = [];
  for (const c of [...SITES.A.cells, ...SITES.B.cells]) {
    const d = Math.hypot(c.x - bx, c.z - bz);
    if (d < 4 || d > 13 || !hasLOS(c.x, 1.6, c.z, bx, 0.9, bz)) continue;
    const ix = Math.floor(c.x / CELL), iz = Math.floor(c.z / CELL);
    let cover = 0;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (heightAt(ix + ox, iz + oz) > 0) cover++;
    for (let k = 0; k <= cover * 2; k++) opts.push(c);
  }
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : { x: bx, z: bz };
}

// How many far-away approach cells (outside sites and defender spawn) can see this spot.
let approach: { x: number; z: number }[] | null = null;
function exposure(c: { x: number; z: number }) {
  if (!approach) {
    approach = [];
    for (let iz = 0; iz < 36; iz++) for (let ix = 0; ix < 44; ix++) {
      const cc = { x: (ix + 0.5) * CELL, z: (iz + 0.5) * CELL };
      const zn = zoneAtWorld(cc.x, cc.z);
      if (heightAt(ix, iz) === 0 && zn !== SITES.A.zone && zn !== SITES.B.zone && zn !== 4 && (ix + iz) % 2 === 0) approach.push(cc);
    }
  }
  let n = 0;
  for (const a of approach) {
    const d = Math.hypot(a.x - c.x, a.z - c.z);
    if (d > 16 && hasLOS(c.x, 1.6, c.z, a.x, 1.6, a.z)) n++;
  }
  return n;
}

// Picks a cell inside the site with clear sight to `ent`, 7-18m away, preferring cells next to crates.
const spotCache = new Map<string, { x: number; z: number }[]>();
function angleSpot(ent: { x: number; z: number }) {
  const key = `${ent.x},${ent.z}`;
  let list = spotCache.get(key);
  if (!list) {
    const scored: { c: { x: number; z: number }; score: number }[] = [];
    for (const c of [...SITES.A.cells, ...SITES.B.cells]) {
      const d = Math.hypot(c.x - ent.x, c.z - ent.z);
      if (d < 7 || d > 18) continue;
      if (!hasLOS(c.x, 1.6, c.z, ent.x, 1.5, ent.z)) continue;
      const ix = Math.floor(c.x / CELL), iz = Math.floor(c.z / CELL);
      let cover = 0;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (heightAt(ix + ox, iz + oz) > 0) cover++;
      scored.push({ c, score: exposure(c) - cover * 2 });
    }
    scored.sort((a, b) => a.score - b.score);
    list = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.5))).map(s => s.c);
    spotCache.set(key, list);
  }
  if (!list.length) return ent;
  return list[Math.floor(Math.random() * list.length)];
}

export { CELL };
