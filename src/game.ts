import * as THREE from 'three';
import {
  CELL, W, H, heightAt, raycastWorld, hasLOS, zoneAtWorld, Z_ATT_SPAWN, Z_DEF_SPAWN, ATT_SPAWNS, DEF_SPAWNS, SITES, SiteKey, TALL_H, RayHit,
} from './map';
import { WEAPONS, WeaponDef, GEAR, recoilYaw, SCOPED_SPREAD } from './weapons';
import { makeChar, CharModel } from './models';
import { Effects } from './effects';
import { audio } from './audio';
import { Bot, Difficulty } from './bot';

export const TICK = 1 / 64;
export const GRAV = 18;
const JUMP_V = 6.6;
export const RADIUS = 0.35;
const STAND_H = 1.8, CROUCH_H = 1.25;
export const EYE_STAND = 1.64, EYE_CROUCH = 1.15;
const FREEZE_TIME = 6, ROUND_TIME = 115, BOMB_TIME = 40, END_TIME = 5.5, BUY_WINDOW = 25;
const PLANT_TIME = 3.0, DEFUSE_TIME = 7.0, DEFUSE_KIT_TIME = 3.5;
export const ROUNDS_TO_WIN = 7, HALF = 6;
const START_MONEY = 800, MAX_MONEY = 16000;

export type Side = 'att' | 'def';
export type SlotName = 'primary' | 'secondary' | 'melee' | 'grenade' | 'bomb';

export interface Input {
  fwd: number; side: number;
  jump: boolean; crouch: boolean; walk: boolean;
  fire: boolean; alt: boolean; reload: boolean; use: boolean;
}
export const emptyInput = (): Input => ({ fwd: 0, side: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, use: false });

export interface GunState { id: string; ammo: number; reserve: number }

export class Player {
  id: number; name: string; team: 0 | 1; isBot: boolean;
  pos = new THREE.Vector3(); prevPos = new THREE.Vector3(); vel = new THREE.Vector3();
  yaw = 0; pitch = 0; crouch = 0; grounded = true; prevYaw = 0;
  health = 100; armor = 0; helmet = false; kit = false; money = START_MONEY;
  alive = true;
  primary: GunState | null = null;
  secondary: GunState | null = { id: 'warden', ammo: 13, reserve: 52 };
  nades: string[] = [];
  slot: SlotName = 'secondary'; lastSlot: SlotName = 'melee';
  hasBomb = false;
  nextFire = 0; reloadEnd = 0; switchEnd = 0; shots = 0; lastFire = -10;
  recoilP = 0; recoilY = 0;
  scoped = false; prevFire = false; prevAlt = false; prevJump = false;
  kills = 0; deaths = 0; score = 0; roundDamage = 0; roundKills = 0;
  model: CharModel;
  brain: Bot | null = null;
  stepAcc = 0;
  spottedUntil = 0;
  deathTime = 0;
  plantProg = 0; defuseProg = 0;
  input: Input = emptyInput();
  wasAirborne = false;
  lastHurt = -10;
  rescope = false;
  prevUse = false;
  autoReloadAt = 0;
  constructor(id: number, name: string, team: 0 | 1, isBot: boolean, side: Side) {
    this.id = id; this.name = name; this.team = team; this.isBot = isBot;
    this.model = makeChar(side);
  }
  get eye() { return EYE_STAND - (EYE_STAND - EYE_CROUCH) * this.crouch; }
  get height() { return STAND_H - (STAND_H - CROUCH_H) * this.crouch; }
  weaponId(): string {
    switch (this.slot) {
      case 'primary': return this.primary?.id ?? 'blade';
      case 'secondary': return this.secondary?.id ?? 'blade';
      case 'grenade': return this.nades[0] ?? 'blade';
      case 'bomb': return 'bomb';
      default: return 'blade';
    }
  }
  gun(): GunState | null {
    return this.slot === 'primary' ? this.primary : this.slot === 'secondary' ? this.secondary : null;
  }
  def(): WeaponDef { return WEAPONS[this.weaponId()] ?? WEAPONS.blade; }
}

export interface KillEvent { killer: string; victim: string; weapon: string; head: boolean; ks: Side; vs: Side; t: number; wall: boolean }
interface Drop { id: string; ammo: number; reserve: number; pos: THREE.Vector3; mesh: THREE.Object3D; t: number }
const DROP_GEO = new THREE.BoxGeometry(0.08, 0.1, 0.7);
const DROP_MAT = new THREE.MeshStandardMaterial({ color: '#3c3f44', roughness: 0.5 });
interface Grenade { type: 'frag' | 'smoke'; pos: THREE.Vector3; vel: THREE.Vector3; owner: Player; at: number; mesh: THREE.Mesh; still: number }
export interface Smoke { pos: THREE.Vector3; until: number; born: number; r: number }
export type Phase = 'freeze' | 'live' | 'planted' | 'end' | 'over';

export interface GameOptions { side: Side | 'auto'; difficulty: Difficulty; spectator: boolean; teamSize: number }

const BOT_NAMES = ['Rook', 'Vex', 'Mako', 'Juno', 'Kite', 'Brick', 'Nova', 'Echo', 'Talon', 'Grit', 'Sable', 'Onyx', 'Pike', 'Wren'];

export class Game {
  scene: THREE.Scene;
  fx: Effects;
  players: Player[] = [];
  local: Player | null = null;
  opts: GameOptions;
  time = 0;
  phase: Phase = 'freeze';
  phaseEnd = 0;
  roundStart = 0;
  round = 1;
  score: [number, number] = [0, 0];
  attTeam: 0 | 1 = 0;
  lossStreak: [number, number] = [0, 0];
  bomb = { state: 'carried' as 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded', pos: new THREE.Vector3(), carrier: null as Player | null, explodeAt: 0, site: 'A' as SiteKey, nextBeep: 0, defuser: null as Player | null };
  bombMesh: THREE.Group;
  bombLight: THREE.Mesh;
  grenades: Grenade[] = [];
  drops: Drop[] = [];
  deathInfo: { killer: string; weapon: string; hpLeft: number; head: boolean; t: number } | null = null;
  smokes: Smoke[] = [];
  killfeed: KillEvent[] = [];
  messages: { text: string; sub?: string; until: number; color?: string }[] = [];
  roundWinner: 0 | 1 | -1 = -1;
  roundReason = '';
  matchWinner: 0 | 1 | -1 = -1;
  plan = { site: 'A' as SiteKey, execAt: 0 };
  sounds: { pos: THREE.Vector3; t: number; by: Player; loud: number }[] = [];
  events: { type: string; [k: string]: any }[] = [];
  log: string[] = [];
  hitMarker = 0; hitHead = false; hurtDir: { yaw: number; t: number }[] = [];
  private rng = Math.random;

  constructor(scene: THREE.Scene, opts: GameOptions) {
    this.scene = scene;
    this.opts = opts;
    this.fx = new Effects(scene);
    // bomb mesh
    this.bombMesh = new THREE.Group();
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.26), new THREE.MeshStandardMaterial({ color: '#4a4a3a', roughness: 0.7 }));
    bm.position.y = 0.11; bm.castShadow = true;
    this.bombLight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), new THREE.MeshBasicMaterial({ color: '#ff3020' }));
    this.bombLight.position.set(0.08, 0.24, 0);
    this.bombMesh.add(bm, this.bombLight);
    this.bombMesh.visible = false;
    scene.add(this.bombMesh);

    const size = opts.teamSize;
    let localTeam: 0 | 1 = 0;
    const side = opts.side === 'auto' ? (Math.random() < 0.5 ? 'att' : 'def') : opts.side;
    this.attTeam = side === 'att' ? 0 : 1;
    let id = 0;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (const team of [0, 1] as const) {
      for (let i = 0; i < size; i++) {
        const isLocal = !opts.spectator && team === localTeam && i === 0;
        const p = new Player(id++, isLocal ? 'You' : names.pop() ?? `Bot${id}`, team, !isLocal, this.sideOf(team));
        if (!isLocal) p.brain = new Bot(this, p, opts.difficulty);
        else this.local = p;
        scene.add(p.model.root);
        this.players.push(p);
      }
    }
    this.startRound();
  }

  sideOf(team: 0 | 1): Side { return team === this.attTeam ? 'att' : 'def'; }
  side(p: Player): Side { return this.sideOf(p.team); }
  enemiesOf(p: Player) { return this.players.filter(o => o.team !== p.team); }
  aliveOf(team: 0 | 1) { return this.players.filter(p => p.team === team && p.alive); }

  msg(text: string, sub = '', dur = 3, color?: string) {
    this.messages.push({ text, sub, until: this.time + dur, color });
  }

  // ---------------- Round flow ----------------
  startRound() {
    this.fx.clearRound();
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.grenades = []; this.smokes = [];
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops = [];
    this.deathInfo = null;
    this.phase = 'freeze';
    this.phaseEnd = this.time + FREEZE_TIME;
    this.roundStart = this.time;
    this.roundWinner = -1;
    this.bomb.state = 'carried'; this.bomb.defuser = null;
    this.bombMesh.visible = false;
    const attSpawns = [...ATT_SPAWNS].sort(() => this.rng() - 0.5);
    const defSpawns = [...DEF_SPAWNS].sort(() => this.rng() - 0.5);
    let ai = 0, di = 0;
    for (const p of this.players) {
      const s = this.side(p);
      p.model.setSide(s);
      if (!p.alive) {
        // dead players lose their gear
        p.primary = null; p.secondary = { id: 'warden', ammo: 13, reserve: 52 };
        p.nades = []; p.armor = 0; p.helmet = false; p.kit = false;
      }
      if (s === 'att') p.kit = false;
      p.alive = true; p.health = 100;
      const sp = s === 'att' ? attSpawns[ai++ % attSpawns.length] : defSpawns[di++ % defSpawns.length];
      p.pos.set(sp.x + (this.rng() - 0.5) * 0.4, 0, sp.z + (this.rng() - 0.5) * 0.4);
      p.prevPos.copy(p.pos); p.vel.set(0, 0, 0);
      // face the nearest way out of spawn
      const exit = s === 'att' ? { x: 44, z: 54 } : { x: 44, z: 14 };
      p.yaw = Math.atan2(-(exit.x - p.pos.x), -(exit.z - p.pos.z)); p.pitch = 0; p.prevYaw = p.yaw;
      p.crouch = 0; p.grounded = true;
      p.hasBomb = false; p.plantProg = 0; p.defuseProg = 0;
      p.recoilP = p.recoilY = 0; p.shots = 0; p.reloadEnd = 0; p.scoped = false;
      p.slot = p.primary ? 'primary' : 'secondary';
      p.roundDamage = 0; p.roundKills = 0;
      p.model.root.visible = p !== this.local;
      p.model.body.rotation.set(0, 0, 0);
      p.model.body.position.set(0, 0, 0);
      // refill ammo for survivors
      for (const g of [p.primary, p.secondary]) if (g) { const d = WEAPONS[g.id]; g.ammo = d.mag; g.reserve = d.reserve; }
    }
    const atts = this.players.filter(p => this.side(p) === 'att');
    const carrier = atts[Math.floor(this.rng() * atts.length)];
    if (carrier) { carrier.hasBomb = true; this.bomb.carrier = carrier; }
    this.plan.site = this.rng() < 0.5 ? 'A' : 'B';
    this.plan.execAt = this.time + FREEZE_TIME + 12 + this.rng() * 18;
    for (const p of this.players) p.brain?.onRoundStart();
    this.events.push({ type: 'roundStart' });
    const lt = this.local ? this.side(this.local) : 'att';
    this.msg(`Round ${this.round}`, lt === 'att' ? 'Vanguard — plant the charge at A or B' : 'Sentinel — defend both sites', 3.5);
  }

  endRound(winner: 0 | 1, reason: string) {
    if (this.phase === 'end' || this.phase === 'over') return;
    this.phase = 'end';
    this.phaseEnd = this.time + END_TIME;
    this.roundWinner = winner;
    this.roundReason = reason;
    this.score[winner]++;
    const loser = (1 - winner) as 0 | 1;
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] = Math.min(4, this.lossStreak[loser] + 1);
    const winBonus = reason === 'Charge detonated' || reason === 'Charge defused' ? 3500 : 3250;
    const lossBonus = 1400 + 500 * (this.lossStreak[loser] - 1);
    const planted = this.bomb.state === 'planted' || this.bomb.state === 'exploded' || this.bomb.state === 'defused';
    for (const p of this.players) {
      if (p.team === winner) this.addMoney(p, winBonus);
      else {
        // survivors on the losing side of a timeout don't get loss bonus (prevents saving exploits)
        const timeoutSurvivor = reason === 'Time ran out' && p.alive && this.side(p) === 'att';
        this.addMoney(p, timeoutSurvivor ? 0 : lossBonus + (planted && this.side(p) === 'att' ? 800 : 0));
      }
    }
    const ws = this.sideOf(winner);
    const lt = this.local?.team ?? 0;
    this.msg(ws === 'att' ? 'Vanguard win the round' : 'Sentinel win the round', reason, END_TIME - 0.5, winner === lt ? '#7dff9a' : '#ff7a6a');
    this.events.push({ type: 'roundEnd', winner, reason });
    this.log.push(`R${this.round}: ${ws} win (${reason}) ${this.score[0]}-${this.score[1]}`);
    if (this.local) audio.sting(winner === lt);
    if (this.score[winner] >= ROUNDS_TO_WIN) {
      this.matchWinner = winner;
    }
  }

  nextRound() {
    if (this.matchWinner !== -1) {
      this.phase = 'over';
      this.events.push({ type: 'matchOver', winner: this.matchWinner });
      this.log.push(`MATCH OVER: team ${this.matchWinner} wins ${this.score[0]}-${this.score[1]}`);
      return;
    }
    this.round++;
    if (this.round === HALF + 1) {
      // halftime: swap sides, reset economy
      this.attTeam = (1 - this.attTeam) as 0 | 1;
      this.lossStreak = [0, 0];
      for (const p of this.players) {
        p.money = START_MONEY; p.primary = null; p.secondary = { id: 'warden', ammo: 13, reserve: 52 };
        p.nades = []; p.armor = 0; p.helmet = false; p.kit = false; p.alive = false;
      }
      this.msg('Halftime — switching sides', '', 3);
    }
    this.startRound();
  }

  addMoney(p: Player, v: number) { p.money = Math.max(0, Math.min(MAX_MONEY, p.money + v)); }

  roundTimeLeft() {
    if (this.phase === 'freeze') return ROUND_TIME;
    if (this.phase === 'live') return Math.max(0, this.phaseEnd - this.time);
    if (this.phase === 'planted') return Math.max(0, this.bomb.explodeAt - this.time);
    return 0;
  }

  // ---------------- Buying ----------------
  canBuy(p: Player) {
    if (!p.alive) return false;
    const inWindow = this.phase === 'freeze' || (this.phase === 'live' && this.time - (this.roundStart + FREEZE_TIME) < BUY_WINDOW);
    if (!inWindow) return false;
    const z = zoneAtWorld(p.pos.x, p.pos.z);
    return z === (this.side(p) === 'att' ? Z_ATT_SPAWN : Z_DEF_SPAWN);
  }

  buy(p: Player, item: string): boolean {
    if (!this.canBuy(p)) return false;
    const w = WEAPONS[item];
    const gear = GEAR[item];
    const price = w ? w.price : gear?.price ?? 0;
    if (p.money < price) return false;
    if (w) {
      if (w.slot === 'primary') {
        if (p.primary?.id === item) return false;
        p.primary = { id: item, ammo: w.mag, reserve: w.reserve };
        this.switchTo(p, 'primary', true);
      } else if (w.slot === 'secondary') {
        if (p.secondary?.id === item) return false;
        p.secondary = { id: item, ammo: w.mag, reserve: w.reserve };
        if (!p.primary) this.switchTo(p, 'secondary', true);
      } else if (w.slot === 'grenade') {
        if (p.nades.includes(item) || p.nades.length >= 2) return false;
        p.nades.push(item);
      }
    } else if (item === 'vest') {
      if (p.armor >= 100) return false;
      p.armor = 100;
    } else if (item === 'vesthelm') {
      if (p.armor >= 100 && p.helmet) return false;
      const cost = p.armor >= 100 ? 350 : 1000;
      if (p.money < cost) return false;
      p.armor = 100; p.helmet = true;
      p.money -= cost;
      return true;
    } else if (item === 'kit') {
      if (this.side(p) !== 'def' || p.kit) return false;
      p.kit = true;
    } else return false;
    p.money -= price;
    return true;
  }

  // ---------------- Weapons ----------------
  switchTo(p: Player, slot: SlotName, force = false) {
    if (!force && p.slot === slot) return;
    if (slot === 'primary' && !p.primary) return;
    if (slot === 'secondary' && !p.secondary) return;
    if (slot === 'grenade' && !p.nades.length) return;
    if (slot === 'bomb' && !p.hasBomb) return;
    if (p.slot !== slot) p.lastSlot = p.slot;
    p.slot = slot;
    p.switchEnd = this.time + (slot === 'melee' ? 0.3 : 0.5);
    p.reloadEnd = 0; p.scoped = false; p.shots = 0;
    p.plantProg = 0;
    if (p === this.local) audio.swap();
  }

  cycleNade(p: Player) {
    if (p.slot === 'grenade' && p.nades.length > 1) { p.nades.push(p.nades.shift()!); p.switchEnd = this.time + 0.3; }
    else this.switchTo(p, 'grenade');
  }

  startReload(p: Player) {
    const g = p.gun(); if (!g) return;
    const d = WEAPONS[g.id];
    if (p.reloadEnd || g.ammo >= d.mag || g.reserve <= 0) return;
    p.reloadEnd = this.time + d.reload;
    p.scoped = false;
    audio.reload(p === this.local ? undefined : p.pos);
  }

  spreadFor(p: Player, d: WeaponDef) {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const maxS = d.speed;
    const moveK = Math.max(0, Math.min(1, (speed - maxS * 0.3) / (maxS * 0.65)));
    let s = (d.scope && p.scoped) ? SCOPED_SPREAD : d.spread;
    s += d.moveSpread * moveK;
    if (!p.grounded) s += d.airSpread;
    if (p.crouch > 0.9 && p.grounded) s *= d.crouchMul;
    if (d.auto) s += Math.min(p.shots, 12) * d.spread * 0.35;
    return s;
  }

  eyePos(p: Player, out = new THREE.Vector3()) { return out.set(p.pos.x, p.pos.y + p.eye, p.pos.z); }

  viewDir(yaw: number, pitch: number, out = new THREE.Vector3()) {
    const cp = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  }

  private updateWeapon(p: Player, inp: Input, dt: number) {
    const d = p.def();
    // recoil recovery
    if (this.time - p.lastFire > 60 / Math.max(d.rpm, 60) + 0.04) {
      const k = Math.min(1, (d.recover || 8) * dt);
      p.recoilP -= p.recoilP * k; p.recoilY -= p.recoilY * k;
      if (this.time - p.lastFire > 0.28) p.shots = 0;
    }
    if (p.reloadEnd && this.time >= p.reloadEnd) {
      const g = p.gun();
      if (g) { const need = WEAPONS[g.id].mag - g.ammo; const take = Math.min(need, g.reserve); g.ammo += take; g.reserve -= take; }
      p.reloadEnd = 0;
    }
    if (inp.reload) this.startReload(p);
    // scope toggle
    if (inp.alt && !p.prevAlt && d.scope && this.time >= p.switchEnd && !p.reloadEnd) {
      p.scoped = !p.scoped;
      if (p === this.local) audio.swap();
    }
    p.prevAlt = inp.alt;
    const firing = inp.fire;
    const edge = firing && !p.prevFire;
    p.prevFire = firing;
    if (!firing || this.time < p.switchEnd || this.time < p.nextFire || p.reloadEnd) return;
    if (!d.auto && !edge) return;
    if (this.phase === 'freeze' || this.phase === 'over') return;
    if (p.slot === 'bomb') return;
    if (d.slot === 'melee') { this.swing(p, d); return; }
    if (d.slot === 'grenade') { this.throwNade(p, d.id as 'frag' | 'smoke'); return; }
    const g = p.gun()!;
    if (g.ammo <= 0) {
      if (edge && p === this.local) audio.empty();
      p.nextFire = this.time + 0.2;
      this.startReload(p);
      return;
    }
    g.ammo--;
    p.nextFire = this.time + 60 / d.rpm;
    p.lastFire = this.time;
    this.fireBullet(p, d);
    p.recoilP = Math.min(d.kickMax, p.recoilP + d.kick * (p.shots < 3 ? 1.15 : 1));
    p.recoilY += recoilYaw(d, p.shots);
    p.shots++;
    if (d.scope && p.scoped) { p.scoped = false; p.switchEnd = this.time + 60 / d.rpm * 0.9; p.rescope = true; }
    if (g.ammo === 0 && g.reserve > 0) p.autoReloadAt = this.time + 0.25;
  }

  private swing(p: Player, d: WeaponDef) {
    p.nextFire = this.time + 60 / d.rpm;
    const o = this.eyePos(p);
    const dir = this.viewDir(p.yaw, p.pitch);
    audio.slash(p === this.local ? undefined : p.pos);
    const hit = this.traceShot(p, o, dir, d.range ?? 1.9, d, d.damage, true);
    if (hit && p === this.local) this.events.push({ type: 'swingHit' });
  }

  private fireBullet(p: Player, d: WeaponDef) {
    const o = this.eyePos(p);
    const spread = this.spreadFor(p, d);
    const pellets = d.pellets ?? 1;
    const isLocal = p === this.local;
    audio.shot(d.id, isLocal ? undefined : o.clone());
    this.noise(p, p.pos, 1);
    const base = this.viewDir(p.yaw + p.recoilY, p.pitch + p.recoilP);
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const up = new THREE.Vector3().crossVectors(right, base).normalize();
    for (let i = 0; i < pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const dir = base.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      this.traceShot(p, o, dir, 150, d, d.damage, false, i === 0);
    }
    this.events.push({ type: 'shot', by: p.id, weapon: d.id });
  }

  // returns true if a player was hit
  traceShot(p: Player, origin: THREE.Vector3, dir: THREE.Vector3, range: number, d: WeaponDef, dmg: number, melee: boolean, tracer = true): boolean {
    let start = origin.clone();
    let travelled = 0;
    let power = d.pen;
    let throughWall = false;
    for (let iter = 0; iter < 5; iter++) {
      const maxT = range - travelled;
      const wh = raycastWorld(start.x, start.y, start.z, dir.x, dir.y, dir.z, maxT);
      const worldT = wh ? wh.t : maxT;
      const ph = this.rayPlayers(start, dir, worldT, p);
      if (ph) {
        const dist = travelled + ph.t;
        let amount = dmg * Math.pow(d.falloff, dist / 10);
        if (melee) {
          const fwd = this.viewDir(ph.player.yaw, 0);
          const behind = fwd.x * dir.x + fwd.z * dir.z > 0.5;
          amount = behind ? 120 : d.damage;
        }
        const hitPos = start.clone().addScaledVector(dir, ph.t);
        this.damage(ph.player, p, amount, ph.group, d.id, dir, throughWall, d.armorPen);
        this.fx.blood(hitPos, dir, ph.group === 'head');
        if (tracer && !melee && iter === 0 && p !== this.local) this.fx.tracer(this.muzzleWorld(p), hitPos);
        return true;
      }
      if (!wh) {
        if (tracer && !melee && iter === 0) this.fx.tracer(p === this.local ? this.localMuzzle(origin, dir) : this.muzzleWorld(p), start.clone().addScaledVector(dir, Math.min(maxT, 60)));
        return false;
      }
      const hp = start.clone().addScaledVector(dir, wh.t);
      if (tracer && !melee && iter === 0) this.fx.tracer(p === this.local ? this.localMuzzle(origin, dir) : this.muzzleWorld(p), hp);
      if (!melee) {
        this.fx.decal(hp, new THREE.Vector3(wh.nx, wh.ny, wh.nz));
        if (Math.random() < 0.3) audio.impact(hp);
      }
      // penetration through crates (not walls / floor)
      if (melee || power <= 0 || wh.h <= 0 || wh.h > TALL_H) return false;
      const thick = Math.max(0.05, wh.exitT - wh.t);
      if (thick > 2.5) return false;
      power--;
      dmg *= 0.5 - Math.min(0.2, thick * 0.08);
      throughWall = true;
      travelled += wh.exitT + 0.02;
      start = start.clone().addScaledVector(dir, wh.exitT + 0.02);
      if (travelled >= range) return false;
    }
    return false;
  }

  private localMuzzle(origin: THREE.Vector3, dir: THREE.Vector3) {
    const p = this.local!;
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    return origin.clone().addScaledVector(dir, 0.6).addScaledVector(right, 0.12).add(new THREE.Vector3(0, -0.12, 0));
  }

  muzzleWorld(p: Player) {
    const v = new THREE.Vector3();
    p.model.muzzle.getWorldPosition(v);
    return v;
  }

  // ray against player hitboxes
  rayPlayers(o: THREE.Vector3, d: THREE.Vector3, maxT: number, skip: Player | null) {
    let best: { player: Player; t: number; group: 'head' | 'body' | 'legs' } | null = null;
    for (const q of this.players) {
      if (!q.alive || q === skip) continue;
      // quick reject: distance from ray to player's center
      const cx = q.pos.x - o.x, cy = q.pos.y + 1 - o.y, cz = q.pos.z - o.z;
      const tc = cx * d.x + cy * d.y + cz * d.z;
      if (tc < -1 || tc > maxT + 1) continue;
      const px = cx - d.x * tc, py = cy - d.y * tc, pz = cz - d.z * tc;
      if (px * px + py * py + pz * pz > 2.0) continue;
      const s = q.height / STAND_H;
      const headY = q.pos.y + (EYE_STAND - 0.02) * s + 0.04;
      const boxes: [string, number, number, number, number, number, number][] = [
        ['head', q.pos.x - 0.15, headY - 0.15, q.pos.z - 0.15, q.pos.x + 0.15, headY + 0.16, q.pos.z + 0.15],
        ['body', q.pos.x - 0.3, q.pos.y + 0.88 * s, q.pos.z - 0.3, q.pos.x + 0.3, headY - 0.15, q.pos.z + 0.3],
        ['legs', q.pos.x - 0.24, q.pos.y, q.pos.z - 0.24, q.pos.x + 0.24, q.pos.y + 0.88 * s, q.pos.z + 0.24],
      ];
      for (const [g, x0, y0, z0, x1, y1, z1] of boxes) {
        const t = rayAABB(o, d, x0, y0, z0, x1, y1, z1);
        if (t !== null && t <= maxT && (!best || t < best.t)) best = { player: q, t, group: g as any };
      }
    }
    return best;
  }

  damage(v: Player, a: Player | null, amount: number, group: 'head' | 'body' | 'legs', weapon: string, dir: THREE.Vector3 | null, wall = false, armorPen = 0.5) {
    if (!v.alive || this.phase === 'over') return;
    if (a && a !== v && a.team === v.team) return; // no friendly fire
    if (group === 'head') amount *= 4; else if (group === 'legs') amount *= 0.75;
    const armored = v.armor > 0 && group !== 'legs' && (group !== 'head' || v.helmet);
    if (armored) {
      const reduced = amount * armorPen;
      v.armor = Math.max(0, v.armor - (amount - reduced) * 0.5);
      amount = reduced;
    }
    const dealt = Math.min(v.health, Math.round(amount));
    v.health -= dealt;
    v.lastHurt = this.time;
    if (a && a !== v) a.roundDamage += dealt;
    // aim punch / slowdown (tagging)
    v.vel.x *= 0.45; v.vel.z *= 0.45;
    if (v === this.local) {
      audio.hurt();
      if (a) this.hurtDir.push({ yaw: Math.atan2(-(a.pos.x - v.pos.x), -(a.pos.z - v.pos.z)), t: this.time });
      v.recoilP += 0.02;
    }
    if (a === this.local && v !== a) { this.hitMarker = this.time; this.hitHead = group === 'head'; audio.hit(group === 'head'); }
    v.brain?.onDamaged(a);
    if (v.health <= 0) this.kill(v, a, weapon, group === 'head', wall);
  }

  kill(v: Player, a: Player | null, weapon: string, head: boolean, wall = false) {
    v.alive = false; v.health = 0; v.deaths++;
    v.deathTime = this.time;
    v.plantProg = 0; v.defuseProg = 0; v.scoped = false;
    if (v.hasBomb) this.dropBomb(v);
    if (v.primary) { this.dropGun(v, v.primary); v.primary = null; }
    else if (v.secondary && v.secondary.id !== 'warden') { this.dropGun(v, v.secondary); v.secondary = { id: 'warden', ammo: 13, reserve: 52 }; }
    if (this.bomb.defuser === v) this.bomb.defuser = null;
    if (a && a !== v && a.team !== v.team) {
      a.kills++; a.roundKills++; a.score += 2;
      this.addMoney(a, WEAPONS[weapon]?.reward ?? 300);
    }
    this.killfeed.push({ killer: a ? a.name : 'World', victim: v.name, weapon, head, ks: a ? this.side(a) : 'att', vs: this.side(v), t: this.time, wall });
    if (this.killfeed.length > 6) this.killfeed.shift();
    this.events.push({ type: 'kill', victim: v.id, killer: a?.id });
    if (v === this.local) {
      this.events.push({ type: 'localDied', by: a?.name ?? '' });
      this.deathInfo = { killer: a?.name ?? 'the blast', weapon, hpLeft: a?.health ?? 0, head, t: this.time };
    }
  }

  // ---------------- Dropped weapons ----------------
  dropGun(p: Player, gun: GunState) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(DROP_GEO, DROP_MAT);
    body.castShadow = true;
    const len = WEAPONS[gun.id].slot === 'primary' ? 1 : 0.45;
    body.scale.set(1, 1, len);
    mesh.add(body);
    const pos = new THREE.Vector3(p.pos.x, supportHeight(p.pos.x, p.pos.z, 0.1, p.pos.y + 0.1) + 0.05, p.pos.z);
    mesh.position.copy(pos);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);
    this.drops.push({ id: gun.id, ammo: gun.ammo, reserve: gun.reserve, pos, mesh, t: this.time });
  }

  private updateDrops() {
    for (const p of this.players) {
      if (!p.alive) { p.prevUse = false; continue; }
      const useEdge = p.input.use && !p.prevUse;
      p.prevUse = p.input.use;
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        if (this.time - d.t < 0.6) continue;
        if (Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z) > 1.1 || Math.abs(p.pos.y - d.pos.y) > 1.3) continue;
        const def = WEAPONS[d.id];
        const slot = def.slot as 'primary' | 'secondary';
        const cur = p[slot];
        const free = slot === 'primary' ? !cur : (!cur || cur.id === 'warden');
        if (!free && !(useEdge && p.plantProg === 0 && p.defuseProg === 0)) continue;
        if (cur && (slot === 'primary' || cur.id !== 'warden' || !free)) this.dropGun(p, cur);
        p[slot] = { id: d.id, ammo: d.ammo, reserve: d.reserve };
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
        if (slot === 'primary' || !p.primary) this.switchTo(p, slot, true);
        if (p === this.local) audio.buy();
        break;
      }
    }
  }

  nearestDrop(p: Player, maxD: number, slot: 'primary' | 'secondary') {
    let best: Drop | null = null, bd = maxD;
    for (const d of this.drops) {
      if (WEAPONS[d.id].slot !== slot) continue;
      const dd = Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  // ---------------- Grenades ----------------
  private throwNade(p: Player, type: 'frag' | 'smoke') {
    p.nextFire = this.time + 0.8;
    const idx = p.nades.indexOf(type);
    if (idx < 0) return;
    p.nades.splice(idx, 1);
    const o = this.eyePos(p);
    const dir = this.viewDir(p.yaw, p.pitch + 0.12);
    const vel = dir.multiplyScalar(19).add(new THREE.Vector3(p.vel.x * 0.6, p.vel.y * 0.3, p.vel.z * 0.6));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: type === 'frag' ? '#3d4a2b' : '#8a929c' }));
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.grenades.push({ type, pos: o.addScaledVector(this.viewDir(p.yaw, p.pitch), 0.4), vel, owner: p, at: this.time + (type === 'frag' ? 1.7 : 3.5), mesh, still: 0 });
    audio.slash(p === this.local ? undefined : p.pos);
    // switch back
    const back = p.lastSlot !== 'grenade' ? p.lastSlot : (p.primary ? 'primary' : 'secondary');
    if (p.nades.length) p.switchEnd = this.time + 0.6;
    else this.switchTo(p, back, true);
  }

  private updateGrenades(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.vel.y -= GRAV * dt;
      const sp = g.vel.length();
      const step = sp * dt;
      if (step > 1e-5) {
        const dx = g.vel.x / sp, dy = g.vel.y / sp, dz = g.vel.z / sp;
        const hit = raycastWorld(g.pos.x, g.pos.y, g.pos.z, dx, dy, dz, step + 0.07);
        if (hit && hit.t <= step + 0.07) {
          g.pos.addScaledVector(new THREE.Vector3(dx, dy, dz), Math.max(0, hit.t - 0.07));
          const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
          const vn = g.vel.dot(n);
          g.vel.addScaledVector(n, -1.45 * vn);
          g.vel.multiplyScalar(n.y > 0.5 ? 0.55 : 0.6);
          if (Math.abs(vn) > 2) audio.bounce(g.pos);
        } else g.pos.addScaledVector(g.vel, dt);
      }
      if (g.pos.y < 0.07) { g.pos.y = 0.07; if (g.vel.y < 0) g.vel.y = 0; }
      if (g.vel.lengthSq() < 0.4 && g.pos.y < 2.1) g.still += dt; else g.still = 0;
      g.mesh.position.copy(g.pos);
      const due = this.time >= g.at || (g.type === 'smoke' && g.still > 0.5);
      if (due) {
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        if (g.type === 'frag') this.explodeFrag(g);
        else {
          const pos = g.pos.clone();
          this.smokes.push({ pos, until: this.time + 17, born: this.time, r: 3.6 });
          this.fx.smokeCloud(pos, 17, 3.6);
          audio.smokePop(pos);
        }
      }
    }
    this.smokes = this.smokes.filter(s => s.until > this.time);
  }

  private explodeFrag(g: Grenade) {
    audio.explosion(g.pos);
    this.fx.explosion(g.pos);
    this.noise(g.owner, g.pos, 1.5);
    const R = 8.5;
    for (const q of this.players) {
      if (!q.alive) continue;
      const c = new THREE.Vector3(q.pos.x, q.pos.y + 1.0, q.pos.z);
      const d = c.distanceTo(g.pos);
      if (d > R) continue;
      if (!hasLOS(g.pos.x, g.pos.y + 0.2, g.pos.z, c.x, c.y, c.z) && !hasLOS(g.pos.x, g.pos.y + 0.2, g.pos.z, c.x, c.y + 0.6, c.z)) continue;
      const amt = 98 * Math.pow(1 - d / R, 1.3);
      if (q !== g.owner && q.team === g.owner.team) continue;
      this.damage(q, g.owner, amt, 'body', 'frag', null, false, 0.6);
    }
    if (this.local && this.local.alive) {
      const d = this.local.pos.distanceTo(g.pos);
      if (d < 15) this.events.push({ type: 'shake', amount: 1 - d / 15 });
    }
  }

  // segment blocked by smoke?
  smokeBlocks(a: THREE.Vector3, b: THREE.Vector3) {
    for (const s of this.smokes) {
      const age = this.time - s.born;
      const r = s.r * Math.min(1, age / 1.0) * Math.min(1, (s.until - this.time) / 1.5);
      if (r < 0.5) continue;
      const c = new THREE.Vector3(s.pos.x, 1.3, s.pos.z);
      const ab = b.clone().sub(a);
      const len2 = ab.lengthSq();
      const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / len2));
      const closest = a.clone().addScaledVector(ab, t);
      const dy = (closest.y - c.y) / 1.6;
      const dx = closest.x - c.x, dz = closest.z - c.z;
      if (Math.sqrt(dx * dx + dz * dz + dy * dy * r * r) < r * 0.92) return true;
    }
    return false;
  }

  // ---------------- Bomb ----------------
  dropBomb(p: Player) {
    p.hasBomb = false;
    if (p.slot === 'bomb') p.slot = p.primary ? 'primary' : 'secondary';
    this.bomb.state = 'dropped';
    this.bomb.carrier = null;
    this.bomb.pos.set(p.pos.x, p.pos.y, p.pos.z);
    // settle on support below
    this.bomb.pos.y = supportHeight(p.pos.x, p.pos.z, 0.15, p.pos.y + 0.1);
    this.bombMesh.visible = true;
    this.bombMesh.position.copy(this.bomb.pos);
    this.events.push({ type: 'bombDropped' });
  }

  private updateBomb(dt: number) {
    const b = this.bomb;
    if (b.state === 'dropped') {
      for (const p of this.players) {
        if (!p.alive || this.side(p) !== 'att') continue;
        if (Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) < 1.0 && Math.abs(p.pos.y - b.pos.y) < 1.2) {
          p.hasBomb = true; b.state = 'carried'; b.carrier = p; this.bombMesh.visible = false;
          if (p === this.local) this.msg('You picked up the charge', 'Hold E inside a site to plant', 2.5);
          break;
        }
      }
    }
    if (b.state === 'carried' && b.carrier) {
      const p = b.carrier;
      const zone = zoneAtWorld(p.pos.x, p.pos.z);
      const inSite = zone === SITES.A.zone || zone === SITES.B.zone;
      if (p.input.use && inSite && p.grounded && (this.phase === 'live')) {
        if (p.plantProg === 0 && p.slot !== 'bomb') { p.lastSlot = p.slot; p.slot = 'bomb'; }
        p.plantProg += dt;
        if (p === this.local && Math.floor(p.plantProg * 3) !== Math.floor((p.plantProg - dt) * 3)) audio.plantTick();
        if (p.plantProg >= PLANT_TIME) {
          b.state = 'planted';
          b.site = zone === SITES.A.zone ? 'A' : 'B';
          b.pos.set(p.pos.x, p.pos.y, p.pos.z);
          b.explodeAt = this.time + BOMB_TIME;
          b.nextBeep = this.time;
          b.carrier = null;
          p.hasBomb = false; p.plantProg = 0;
          p.slot = p.primary ? 'primary' : 'secondary'; p.switchEnd = this.time + 0.5;
          p.score += 2;
          this.addMoney(p, 300);
          this.phase = 'planted';
          this.bombMesh.visible = true;
          this.bombMesh.position.copy(b.pos);
          this.msg('Charge planted', `Site ${b.site} — 40 seconds`, 3, '#ffb070');
          this.events.push({ type: 'planted', site: b.site });
          this.noise(p, p.pos, 2.5);
        }
      } else {
        if (p.plantProg > 0 && p.slot === 'bomb') { p.slot = p.lastSlot === 'bomb' ? 'secondary' : p.lastSlot; }
        p.plantProg = 0;
      }
    }
    if (b.state === 'planted') {
      const left = b.explodeAt - this.time;
      if (this.time >= b.nextBeep) {
        audio.beep(b.pos, left < 10);
        const interval = left > 20 ? 1 : left > 10 ? 0.6 : left > 4 ? 0.3 : 0.12;
        b.nextBeep = this.time + interval;
        (this.bombLight.material as THREE.MeshBasicMaterial).color.set('#ff3020');
      } else if (this.time > b.nextBeep - 0.6 * (b.nextBeep - this.time + 0.05)) {
        (this.bombLight.material as THREE.MeshBasicMaterial).color.set('#401010');
      }
      // defusing
      let defuser: Player | null = null;
      for (const p of this.players) {
        if (!p.alive || this.side(p) !== 'def') continue;
        const close = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) < 1.6 && Math.abs(p.pos.y - b.pos.y) < 1.5;
        if (close && p.input.use && (!defuser || p.defuseProg > defuser.defuseProg)) defuser = p;
        else if (!(close && p.input.use)) p.defuseProg = 0;
      }
      b.defuser = defuser;
      if (defuser) {
        if (defuser.defuseProg === 0) this.noise(defuser, defuser.pos, 2);
        defuser.defuseProg += dt;
        const need = defuser.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
        if (defuser.defuseProg >= need) {
          b.state = 'defused';
          defuser.score += 2;
          this.addMoney(defuser, 300);
          this.bombMesh.visible = true;
          this.endRound(defuser.team, 'Charge defused');
          return;
        }
      }
      if (left <= 0) {
        b.state = 'exploded';
        this.bombMesh.visible = false;
        audio.explosion(b.pos);
        this.fx.explosion(b.pos);
        this.fx.explosion(b.pos.clone().add(new THREE.Vector3(1.5, 1, 0)));
        this.fx.explosion(b.pos.clone().add(new THREE.Vector3(-1, 2, 1)));
        this.events.push({ type: 'shake', amount: 1.5 });
        for (const p of this.players) {
          if (!p.alive) continue;
          const d = p.pos.distanceTo(b.pos);
          const R = 22;
          if (d < R) {
            p.health -= Math.round(500 * Math.pow(1 - d / R, 2));
            if (p.health <= 0) { p.health = 0; this.kill(p, null, 'charge', false); }
          }
        }
        this.endRound(this.attTeam, 'Charge detonated');
      }
    }
  }

  // ---------------- Noise (for bot hearing) ----------------
  noise(by: Player, pos: THREE.Vector3, loud: number) {
    this.sounds.push({ pos: pos.clone(), t: this.time, by, loud });
    if (this.sounds.length > 40) this.sounds.shift();
  }

  // ---------------- Movement ----------------
  private move(p: Player, inp: Input, dt: number) {
    const d = p.def();
    const frozen = this.phase === 'freeze' || p.plantProg > 0 || p.defuseProg > 0 || this.phase === 'over';
    // crouch
    const target = inp.crouch ? 1 : 0;
    const prevCrouch = p.crouch;
    p.crouch += Math.sign(target - p.crouch) * Math.min(Math.abs(target - p.crouch), dt * 7);
    // crouch in air lifts the feet (crouch-jump)
    if (!p.grounded && p.crouch > prevCrouch) p.pos.y += (p.crouch - prevCrouch) * 0.45;
    if (!p.grounded && p.crouch < prevCrouch) p.pos.y -= (prevCrouch - p.crouch) * 0.45;
    let maxSpeed = d.speed * (p.scoped ? 0.55 : 1) * (p.hasBomb ? 0.97 : 1);
    if (p.crouch > 0.5) maxSpeed *= 0.36;
    else if (inp.walk) maxSpeed *= 0.52;
    let fwd = inp.fwd, side = inp.side;
    if (frozen) { fwd = 0; side = 0; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let wx = -sy * fwd + cy * side, wz = -cy * fwd - sy * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const wishSpeed = wl > 0 ? maxSpeed : 0;
    if (p.grounded) {
      // friction
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (sp > 0) {
        const drop = Math.max(sp, 1.8) * 6.0 * dt;
        const ns = Math.max(0, sp - drop) / sp;
        p.vel.x *= ns; p.vel.z *= ns;
      }
      accelerate(p.vel, wx, wz, wishSpeed, 10, dt);
      if (inp.jump && !p.prevJump && !frozen && p.crouch < 0.95) {
        p.vel.y = JUMP_V; p.grounded = false;
        this.noise(p, p.pos, 0.6);
      }
    } else {
      accelerate(p.vel, wx, wz, Math.min(wishSpeed, 0.9), 40, dt);
      p.vel.y -= GRAV * dt;
    }
    p.prevJump = inp.jump;
    // integrate with collision, axis separated
    const r = RADIUS;
    const hgt = p.height;
    let nx = p.pos.x + p.vel.x * dt;
    if (blocked(nx, p.pos.z, p.pos.y, hgt, r)) {
      nx = p.vel.x > 0 ? Math.floor((nx + r) / CELL) * CELL - r - 1e-3 : (Math.floor((nx - r) / CELL) + 1) * CELL + r + 1e-3;
      if (blocked(nx, p.pos.z, p.pos.y, hgt, r)) nx = p.pos.x;
      p.vel.x = 0;
    }
    p.pos.x = nx;
    let nz = p.pos.z + p.vel.z * dt;
    if (blocked(p.pos.x, nz, p.pos.y, hgt, r)) {
      nz = p.vel.z > 0 ? Math.floor((nz + r) / CELL) * CELL - r - 1e-3 : (Math.floor((nz - r) / CELL) + 1) * CELL + r + 1e-3;
      if (blocked(p.pos.x, nz, p.pos.y, hgt, r)) nz = p.pos.z;
      p.vel.z = 0;
    }
    p.pos.z = nz;
    const support = supportHeight(p.pos.x, p.pos.z, r, p.pos.y + 0.05);
    if (p.grounded) {
      if (support < p.pos.y - 0.02) { p.grounded = false; if (p.vel.y > 0) p.vel.y = 0; }
      else { p.pos.y = support; p.vel.y = 0; }
    }
    if (!p.grounded) {
      const ny = p.pos.y + p.vel.y * dt;
      if (ny <= support && p.vel.y <= 0) {
        p.pos.y = support;
        if (p.vel.y < -7) { audio.land(p === this.local ? undefined : p.pos); this.noise(p, p.pos, 0.8); }
        p.vel.y = 0; p.grounded = true;
      } else p.pos.y = ny;
    }
    // footsteps
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (p.grounded && sp > 3.4 && p.crouch < 0.5) {
      p.stepAcc += sp * dt;
      if (p.stepAcc > 2.3) {
        p.stepAcc = 0;
        audio.step(p === this.local ? undefined : p.pos.clone(), p === this.local ? 0.35 : 1);
        this.noise(p, p.pos, 0.5);
      }
    }
  }

  private separate() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]; if (!a.alive) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]; if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const min = RADIUS * 2;
        if (d2 < min * min && Math.abs(a.pos.y - b.pos.y) < 1.6) {
          const d = Math.sqrt(d2) || 0.01;
          const push = (min - d) * 0.5;
          const ux = dx / d, uz = dz / d;
          tryShift(a, -ux * push, -uz * push);
          tryShift(b, ux * push, uz * push);
        }
      }
    }
  }

  // ---------------- Main tick ----------------
  tick(dt: number, localInput: Input | null) {
    this.time += dt;
    for (const p of this.players) { p.prevPos.copy(p.pos); p.prevYaw = p.yaw; }
    if (this.phase === 'freeze' && this.time >= this.phaseEnd) {
      this.phase = 'live';
      this.phaseEnd = this.time + ROUND_TIME;
      this.events.push({ type: 'live' });
      this.msg('GO', '', 1);
    } else if (this.phase === 'end' && this.time >= this.phaseEnd) {
      this.nextRound();
      return;
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      let inp: Input;
      if (p === this.local) inp = localInput ?? emptyInput();
      else inp = p.brain ? p.brain.think(dt) : emptyInput();
      p.input = inp;
      this.move(p, inp, dt);
      if (p.autoReloadAt && this.time >= p.autoReloadAt) { p.autoReloadAt = 0; this.startReload(p); }
      if (p.rescope && this.time >= p.switchEnd) { p.rescope = false; p.scoped = true; }
      this.updateWeapon(p, inp, dt);
    }
    this.separate();
    this.updateDrops();
    this.updateGrenades(dt);
    this.updateBomb(dt);
    this.checkWin();
  }

  private checkWin() {
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    const att = this.attTeam, def = (1 - att) as 0 | 1;
    const attAlive = this.aliveOf(att).length, defAlive = this.aliveOf(def).length;
    if (defAlive === 0) { this.endRound(att, 'Sentinel eliminated'); return; }
    if (this.phase === 'live') {
      if (attAlive === 0) { this.endRound(def, 'Vanguard eliminated'); return; }
      if (this.time >= this.phaseEnd) { this.endRound(def, 'Time ran out'); return; }
    }
  }

  // ---------------- Visual sync ----------------
  syncModels(alpha: number, frameDt: number) {
    for (const p of this.players) {
      const m = p.model;
      if (p === this.local) { m.root.visible = false; continue; }
      m.root.visible = true;
      const x = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha;
      const y = p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha;
      const z = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
      m.root.position.set(x, y, z);
      if (!p.alive) {
        const k = Math.min(1, (this.time - p.deathTime) / 0.45);
        m.body.rotation.x = -k * Math.PI / 2 * 0.98;
        m.body.position.y = 0.12 * k;
        m.body.scale.y = 1;
        m.legL.rotation.x = 0; m.legR.rotation.x = 0;
        m.bomb.visible = false;
        continue;
      }
      m.root.rotation.y = lerpAngle(p.prevYaw, p.yaw, alpha);
      const sp = Math.hypot(p.vel.x, p.vel.z);
      const phase = (m.root.userData.walk = (m.root.userData.walk ?? 0) + sp * frameDt * 2.2);
      const swing = Math.sin(phase) * Math.min(1, sp / 4) * 0.7;
      m.legL.rotation.x = swing; m.legR.rotation.x = -swing;
      m.body.scale.y = 1 - p.crouch * 0.3;
      m.head.rotation.x = p.pitch * 0.6;
      m.gun.rotation.x = p.pitch;
      m.armR.rotation.x = -1.3 + p.pitch; m.armL.rotation.x = -1.2 + p.pitch;
      m.bomb.visible = p.hasBomb;
      m.gun.visible = p.slot !== 'bomb';
    }
  }

  // ---------------- Misc helpers for bots / HUD ----------------
  canSee(a: Player, b: Player, checkFov = true): boolean {
    const eye = this.eyePos(a);
    if (checkFov) {
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2) {
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
        if ((dx * fx + dz * fz) / d < Math.cos(1.05)) return false;
      }
    }
    const pts = [b.pos.y + b.eye + 0.02, b.pos.y + b.height * 0.62, b.pos.y + 0.5];
    for (const y of pts) {
      if (hasLOS(eye.x, eye.y, eye.z, b.pos.x, y, b.pos.z)) {
        if (!this.smokeBlocks(eye, new THREE.Vector3(b.pos.x, y, b.pos.z))) return true;
      }
    }
    return false;
  }
}

// ---------------- helpers ----------------
function accelerate(vel: THREE.Vector3, wx: number, wz: number, wishSpeed: number, accel: number, dt: number) {
  if (wishSpeed <= 0) return;
  const cur = vel.x * wx + vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(add, accel * wishSpeed * dt);
  vel.x += a * wx; vel.z += a * wz;
}

export function blocked(x: number, z: number, feet: number, hgt: number, r: number) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    const h = heightAt(ix, iz);
    if (h > feet + 0.001 && feet + hgt > 0) return true;
  }
  return false;
}

// highest surface under the hull that is at or below `maxY`
export function supportHeight(x: number, z: number, r: number, maxY: number) {
  let best = 0;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    const h = heightAt(ix, iz);
    if (h <= maxY && h > best) best = h;
  }
  return best;
}

function tryShift(p: Player, dx: number, dz: number) {
  if (!blocked(p.pos.x + dx, p.pos.z, p.pos.y, p.height, RADIUS)) p.pos.x += dx;
  if (!blocked(p.pos.x, p.pos.z + dz, p.pos.y, p.height, RADIUS)) p.pos.z += dz;
}

function rayAABB(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = -Infinity, tmax = Infinity;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z], mins = [x0, y0, z0], maxs = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) { if (os[i] < mins[i] || os[i] > maxs[i]) return null; continue; }
    let t1 = (mins[i] - os[i]) / ds[i], t2 = (maxs[i] - os[i]) / ds[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return Math.max(0, tmin);
}

export function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export { W, H };
export type { RayHit };
