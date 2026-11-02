import * as THREE from 'three';
import './style.css';
import { buildWorld } from './world';
import { Game, TICK, Input, emptyInput, Player, GameOptions, lerpAngle } from './game';
import { Hud } from './hud';
import { audio } from './audio';
import { makeViewModel, VM_MUZZLE } from './models';
import { WEAPONS } from './weapons';
import { zoneAtWorld } from './map';
import type { Difficulty } from './bot';

// ---------------- settings ----------------
interface Settings { sens: number; fov: number; volume: number; xh: string; difficulty: Difficulty; side: 'att' | 'def' | 'auto'; teamSize: number; showFps: boolean; quality: 'high' | 'low' }
const DEFAULTS: Settings = { sens: 1.0, fov: 90, volume: 0.7, xh: '#6dff8a', difficulty: 'normal', side: 'auto', teamSize: 5, showFps: true, quality: 'high' };
function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('bp-settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem('bp-settings', JSON.stringify(settings)); } catch { /* storage unavailable */ } }
const settings = loadSettings();
const params = new URLSearchParams(location.search);
const AUTOTEST = params.has('autotest');
const SIM_SPEED = Number(params.get('speed') ?? (AUTOTEST ? 1 : 1));

// ---------------- renderer ----------------
const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'view';
app.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality === 'high', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality === 'high' ? 2 : 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;

const scene = new THREE.Scene();
buildWorld(scene);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight('#e8f0ff', '#504030', 1.6));
const vmSun = new THREE.DirectionalLight('#fff1d6', 1.6); vmSun.position.set(1, 2, 1); vmScene.add(vmSun);
const vm = makeViewModel();
vmScene.add(vm.root);

function hfovToV(h: number, aspect: number) { return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h) / 2) / aspect)); }
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; vmCamera.aspect = w / h;
  camera.updateProjectionMatrix(); vmCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const hud = new Hud(app);
hud.crosshairColor = settings.xh;
audio.volume = settings.volume;

// ---------------- input ----------------
const keys = new Set<string>();
const mouse = { left: false, right: false };
let locked = false;
let dragLook = false; // fallback when pointer lock is unavailable
let lookYaw = 0, lookPitch = 0;
let game: Game | null = null;
let state: 'menu' | 'playing' | 'paused' | 'over' = 'menu';
let showScores = false;
let spectateIdx = 0;
let shake = 0;
const pendingSlot: string[] = [];

// A refused lock (e.g. right after Esc) just leaves us unlocked: the "Click to aim" hint shows and the next canvas click retries.
function requestLock() {
  audio.init();
  try {
    const r = canvas.requestPointerLock() as any;
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* retried on next click */ }
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && state === 'playing' && !hud.buyOpen && !dragLook) pause();
});

document.addEventListener('mousemove', e => {
  if (state !== 'playing' || hud.buyOpen) return;
  if (!locked && !(dragLook && mouse.left)) return;
  const zoom = game?.local?.scoped ? 0.32 : 1;
  const k = 0.0022 * settings.sens * zoom;
  lookYaw -= e.movementX * k;
  lookPitch -= e.movementY * k;
  lookPitch = Math.max(-1.5, Math.min(1.5, lookPitch));
});
canvas.addEventListener('mousedown', e => {
  audio.init();
  if (state !== 'playing') return;
  if (hud.buyOpen && game) { hud.toggleBuy(game, false); requestLock(); return; }
  if (!locked && !dragLook) { requestLock(); return; }
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) mouse.right = true;
  if (game?.local && !game.local.alive && e.button === 0) spectateIdx++;
});
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('wheel', e => {
  if (state !== 'playing' || !game?.local) return;
  const order = ['primary', 'secondary', 'melee', 'grenade', 'bomb'];
  const p = game.local;
  const have = order.filter(s => s === 'melee' || (s === 'primary' && p.primary) || (s === 'secondary' && p.secondary) || (s === 'grenade' && p.nades.length) || (s === 'bomb' && p.hasBomb));
  const i = have.indexOf(p.slot);
  const n = have[(i + (e.deltaY > 0 ? 1 : -1) + have.length) % have.length];
  pendingSlot.push(n);
}, { passive: true });

window.addEventListener('keydown', e => {
  if (e.code === 'Tab') e.preventDefault();
  if (state === 'playing' && ['Space', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyC'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (state !== 'playing' || !game) {
    if (e.code === 'Escape' && state === 'paused') resume(false);
    return;
  }
  const p = game.local;
  if (e.code === 'Tab') showScores = true;
  if (!p) return;
  if (hud.buyOpen) {
    const m = /^Digit(\d)$/.exec(e.code);
    if (m) { const item = hud.buyIndexItem(game, Number(m[1])); if (item) doBuy(item); return; }
    if (e.code === 'KeyB' || e.code === 'Escape') { hud.toggleBuy(game, false); if (e.code === 'KeyB') requestLock(); }
    return;
  }
  if (e.repeat) return;
  switch (e.code) {
    case 'Digit1': pendingSlot.push('primary'); break;
    case 'Digit2': pendingSlot.push('secondary'); break;
    case 'Digit3': pendingSlot.push('melee'); break;
    case 'Digit4': pendingSlot.push('nade'); break;
    case 'Digit5': pendingSlot.push('bomb'); break;
    case 'KeyQ': pendingSlot.push('last'); break;
    case 'KeyB':
      if (game.canBuy(p)) { hud.toggleBuy(game, true); if (document.pointerLockElement) document.exitPointerLock(); }
      break;
    case 'KeyG':
      if (p.hasBomb && p.alive) game.dropBomb(p);
      break;
    case 'Escape': if (dragLook) pause(); break;
  }
});
window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') showScores = false; });
window.addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; });

function doBuy(item: string) {
  if (!game?.local) return;
  if (game.buy(game.local, item)) audio.buy(); else audio.empty();
}
hud.onBuy = doBuy;

function readInput(): Input {
  const i = emptyInput();
  if (hud.buyOpen) return i;
  i.fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  i.side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  i.jump = keys.has('Space');
  // C only: Ctrl+W (crouch-walk) is a reserved browser shortcut that closes the tab on Windows/Linux
  i.crouch = keys.has('KeyC');
  i.walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
  i.fire = mouse.left && (locked || dragLook);
  i.alt = mouse.right;
  i.reload = keys.has('KeyR');
  i.use = keys.has('KeyE');
  return i;
}

// ---------------- menus ----------------
const menu = document.createElement('div');
menu.className = 'screen';
app.appendChild(menu);
const lockHint = document.createElement('div');
lockHint.id = 'lockhint'; lockHint.className = 'hud-panel hidden';
lockHint.textContent = 'Click to aim';
app.appendChild(lockHint);

function seg(name: keyof Settings, opts: [string, string][]) {
  return `<div class="seg" data-k="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(settings[name]) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function settingsRows() {
  return `
    <div class="row"><label>Mouse sensitivity</label><input type="range" min="0.2" max="4" step="0.05" data-r="sens" value="${settings.sens}"><span class="val">${settings.sens.toFixed(2)}</span></div>
    <div class="row"><label>Field of view</label><input type="range" min="70" max="110" step="1" data-r="fov" value="${settings.fov}"><span class="val">${settings.fov}</span></div>
    <div class="row"><label>Volume</label><input type="range" min="0" max="1" step="0.05" data-r="volume" value="${settings.volume}"><span class="val">${Math.round(settings.volume * 100)}</span></div>
    <div class="row"><label>Crosshair</label>${seg('xh', [['#6dff8a', 'Green'], ['#ffffff', 'White'], ['#ffe14a', 'Yellow'], ['#ff4adf', 'Pink'], ['#4ae3ff', 'Cyan']])}</div>
    <div class="row"><label>Show FPS</label>${seg('showFps', [['true', 'On'], ['false', 'Off']])}</div>`;
}
const CONTROLS = `<div class="keys">
  <b>WASD</b><span>Move · <b>Shift</b> walk quietly · <b>C</b> crouch · <b>Space</b> jump</span>
  <b>Mouse</b><span>Aim · <b>LMB</b> fire · <b>RMB</b> scope (Longbow)</span>
  <b>1-5 / Wheel</b><span>Primary · Pistol · Blade · Grenades · Charge · <b>Q</b> last weapon</span>
  <b>R</b><span>Reload</span><b>E</b><span>Hold to plant / defuse the charge</span>
  <b>B</b><span>Buy menu (in spawn during buy time)</span><b>G</b><span>Drop the charge</span>
  <b>Tab</b><span>Scoreboard</span><b>Esc</b><span>Pause / settings</span></div>`;

function bindMenu() {
  menu.querySelectorAll<HTMLElement>('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const k = s.dataset.k as keyof Settings;
    const v = b.dataset.v!;
    (settings as any)[k] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v;
    s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    hud.crosshairColor = settings.xh;
    saveSettings();
    audio.init(); audio.ui();
  })));
  menu.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(r => r.addEventListener('input', () => {
    const k = r.dataset.r as keyof Settings;
    (settings as any)[k] = Number(r.value);
    const v = r.nextElementSibling as HTMLElement;
    v.textContent = k === 'volume' ? String(Math.round(settings.volume * 100)) : k === 'sens' ? settings.sens.toFixed(2) : r.value;
    if (k === 'volume') audio.setVolume(settings.volume);
    saveSettings();
  }));
}

function showMainMenu() {
  state = 'menu';
  menu.classList.remove('hidden');
  menu.innerHTML = `<div class="card">
    <h1 class="logo">BREACH<span>POINT</span></h1>
    <p class="tag">Tactical 5v5 bomb defusal. Plant or defuse on the map Foundry, against bots that buy, rotate, and spray-control.</p>
    <div class="row"><label>Side</label>${seg('side', [['att', 'Vanguard (attack)'], ['def', 'Sentinel (defend)'], ['auto', 'Random']])}</div>
    <div class="row"><label>Bot skill</label>${seg('difficulty', [['easy', 'Recruit'], ['normal', 'Regular'], ['hard', 'Veteran'], ['elite', 'Elite']])}</div>
    <div class="row"><label>Team size</label>${seg('teamSize', [['2', '2v2'], ['3', '3v3'], ['5', '5v5']])}</div>
    <details><summary>Settings</summary>${settingsRows()}<div class="row"><label>Graphics</label>${seg('quality', [['high', 'High'], ['low', 'Performance']])}</div></details>
    <details><summary>Controls</summary>${CONTROLS}</details>
    <div class="actions"><button class="btn" id="play">DEPLOY</button></div>
  </div>`;
  bindMenu();
  menu.querySelector('#play')!.addEventListener('click', () => startMatch());
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  hud.toggleBuy(game!, false);
  menu.classList.remove('hidden');
  menu.innerHTML = `<div class="card"><h2 class="logo" style="font-size:30px">PAUSED</h2>
    <p class="tag">The match is paused (single-player).</p>${settingsRows()}${CONTROLS}
    <div class="actions"><button class="btn" id="resume">RESUME</button><button class="btn ghost" id="quit">QUIT TO MENU</button></div></div>`;
  bindMenu();
  menu.querySelector('#resume')!.addEventListener('click', () => resume());
  menu.querySelector('#quit')!.addEventListener('click', quitToMenu);
}
function resume(lock = true) {
  state = 'playing';
  menu.classList.add('hidden');
  if (lock && !dragLook) requestLock();
}
function quitToMenu() {
  if (game) { for (const p of game.players) scene.remove(p.model.root); scene.remove(game.bombMesh); game.fx.clearRound(); }
  game = null;
  showMainMenu();
}

function showMatchOver() {
  if (!game) return;
  state = 'over';
  if (document.pointerLockElement) document.exitPointerLock();
  const me = game.local;
  const myTeam = me?.team ?? 0;
  const won = game.matchWinner === myTeam;
  const best = [...game.players].sort((a, b) => b.kills - a.kills)[0];
  menu.classList.remove('hidden');
  menu.innerHTML = `<div class="card"><h2 class="logo" style="font-size:34px;color:${won ? 'var(--good)' : 'var(--bad)'}">${won ? 'VICTORY' : 'DEFEAT'}</h2>
    <p class="tag">Final score ${game.score[myTeam]} – ${game.score[1 - myTeam]}${me ? ` · You: ${me.kills} kills / ${me.deaths} deaths` : ''} · MVP: ${best.name} (${best.kills} kills)</p>
    <div class="actions"><button class="btn" id="again">PLAY AGAIN</button><button class="btn ghost" id="menu">MAIN MENU</button></div></div>`;
  menu.querySelector('#again')!.addEventListener('click', () => { quitToMenu(); startMatch(); });
  menu.querySelector('#menu')!.addEventListener('click', quitToMenu);
}

function startMatch(opts?: Partial<GameOptions>) {
  audio.init();
  audio.setVolume(settings.volume);
  if (game) quitToMenu();
  const o: GameOptions = { side: settings.side, difficulty: settings.difficulty, spectator: false, teamSize: Number(settings.teamSize), ...opts };
  game = new Game(scene, o);
  (window as any).__game.g = game;
  const p = game.local;
  lookYaw = p ? p.yaw : 0; lookPitch = 0;
  menu.classList.add('hidden');
  state = 'playing';
  if (!o.spectator) requestLock();
}

// ---------------- viewmodel animation ----------------
let bobT = 0, swayX = 0, swayY = 0, lastYaw = 0, lastPitch = 0, kick = 0;
let lastWeapon = '';
const tmpV = new THREE.Vector3();

function updateViewModel(p: Player, dt: number) {
  const g = game!;
  const id = p.weaponId();
  for (const [k, m] of Object.entries(vm.guns)) m.visible = k === id && !p.scoped;
  if (id !== lastWeapon) { lastWeapon = id; }
  const gun = vm.guns[id];
  if (!gun) return;
  const sp = Math.hypot(p.vel.x, p.vel.z);
  bobT += dt * sp * 1.6 * (p.grounded ? 1 : 0.2);
  const bobAmt = Math.min(1, sp / 6) * 0.012;
  const dYaw = lookYaw - lastYaw, dPitch = lookPitch - lastPitch;
  lastYaw = lookYaw; lastPitch = lookPitch;
  swayX += (-dYaw * 0.6 - swayX) * Math.min(1, dt * 10);
  swayY += (dPitch * 0.6 - swayY) * Math.min(1, dt * 10);
  swayX = Math.max(-0.05, Math.min(0.05, swayX)); swayY = Math.max(-0.05, Math.min(0.05, swayY));
  kick *= Math.exp(-dt * 18);
  let drop = 0, rot = 0;
  if (g.time < p.switchEnd) drop = (p.switchEnd - g.time) / 0.5 * 0.25;
  if (p.reloadEnd) {
    const d = WEAPONS[id]?.reload ?? 2;
    const k = 1 - (p.reloadEnd - g.time) / d;
    const s = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI);
    drop += s * 0.12; rot = s * 0.7;
  }
  if (p.slot === 'melee' && g.time < p.nextFire) rot -= Math.sin((p.nextFire - g.time) / 0.5 * Math.PI) * 0.9;
  gun.position.set(0.13 + swayX + Math.cos(bobT) * bobAmt, -0.125 + swayY - Math.abs(Math.sin(bobT)) * bobAmt - drop - p.crouch * 0.01, -0.4 + kick * 0.05);
  gun.rotation.set(kick * 0.12 + rot * 0.3, swayX * 2, rot);
  // muzzle flash
  const flashOn = g.time - p.lastFire < 0.04 && WEAPONS[id]?.slot !== 'melee';
  vm.muzzleFlash.visible = flashOn && !!VM_MUZZLE[id];
  vm.flashLight.intensity = flashOn ? 3 : 0;
  if (flashOn && VM_MUZZLE[id]) {
    const m = VM_MUZZLE[id];
    tmpV.set(m[0], m[1], m[2]);
    gun.children[0].localToWorld(tmpV);
    vm.muzzleFlash.position.copy(tmpV);
    vm.muzzleFlash.rotation.z = Math.random() * 6;
    vm.flashLight.position.copy(tmpV);
  }
}

// ---------------- game events ----------------
function handleEvents() {
  const g = game!;
  for (const ev of g.events) {
    if (ev.type === 'shot' && ev.by === g.local?.id) kick = 1;
    if (ev.type === 'shot' && ev.by !== g.local?.id) {
      const sh = g.players[ev.by];
      if (sh) g.fx.muzzle(g.muzzleWorld(sh));
    }
    if (ev.type === 'shake') shake = Math.max(shake, ev.amount);
    if (ev.type === 'roundStart' && g.local) { lookYaw = g.local.yaw; lookPitch = 0; spectateIdx = 0; }
    if (ev.type === 'matchOver' && !AUTOTEST) setTimeout(showMatchOver, 1500);
  }
  g.events.length = 0;
}

// ---------------- main loop ----------------
let acc = 0;
let lastT = performance.now();
let fps = 60, fpsAcc = 0, fpsFrames = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  runFrame(now);
}

function runFrame(now: number) {
  let dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
  renderer.clear();
  hud.root.classList.toggle('hidden', !game);
  if (!game) {
    // menu backdrop: slow orbit over the map
    const t = now / 1000;
    camera.position.set(44 + Math.cos(t * 0.05) * 50, 38, 36 + Math.sin(t * 0.05) * 42);
    camera.lookAt(44, 0, 36);
    camera.fov = 60; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return;
  }
  const g = game;
  const p = g.local;
  if (state === 'playing' || state === 'over') {
    acc += dt * SIM_SPEED;
    let steps = 0;
    while (acc >= TICK && steps < 20 * SIM_SPEED) {
      if (p && p.alive) { p.yaw = lookYaw; p.pitch = lookPitch; }
      // weapon switch requests
      while (p && pendingSlot.length) {
        const s = pendingSlot.shift()!;
        if (s === 'last') g.switchTo(p, p.lastSlot);
        else if (s === 'nade') g.cycleNade(p);
        else g.switchTo(p, s as any);
      }
      g.tick(TICK, state === 'playing' ? readInput() : emptyInput());
      acc -= TICK;
      steps++;
    }
    if (acc > TICK * 4) acc = 0;
  }
  handleEvents();
  const alpha = Math.min(1, acc / TICK);
  g.syncModels(alpha, dt);
  g.fx.update(dt);
  (g as any).localZone = p ? zoneAtWorld(p.pos.x, p.pos.z) : 0;

  // camera
  let viewP: Player | null = p && p.alive ? p : null;
  let spectating: Player | null = null;
  let camYaw = lookYaw;
  shake *= Math.exp(-dt * 4);
  if (viewP) {
    const ix = viewP.prevPos.x + (viewP.pos.x - viewP.prevPos.x) * alpha;
    const iy = viewP.prevPos.y + (viewP.pos.y - viewP.prevPos.y) * alpha;
    const iz = viewP.prevPos.z + (viewP.pos.z - viewP.prevPos.z) * alpha;
    camera.position.set(ix, iy + viewP.eye, iz);
    camera.rotation.set(lookPitch + viewP.recoilP + (Math.random() - 0.5) * shake * 0.03, lookYaw + viewP.recoilY + (Math.random() - 0.5) * shake * 0.03, 0);
  } else {
    // spectate a living teammate (or anyone in spectator mode)
    const pool = g.players.filter(q => q.alive && (!p || q.team === p.team));
    const pool2 = pool.length ? pool : g.players.filter(q => q.alive);
    if (pool2.length) {
      const t = pool2[spectateIdx % pool2.length];
      spectating = t;
      const ix = t.prevPos.x + (t.pos.x - t.prevPos.x) * alpha;
      const iy = t.prevPos.y + (t.pos.y - t.prevPos.y) * alpha;
      const iz = t.prevPos.z + (t.pos.z - t.prevPos.z) * alpha;
      const yaw = lerpAngle(t.prevYaw, t.yaw, alpha);
      camYaw = yaw;
      const back = 3.2;
      const cx = ix + Math.sin(yaw) * back, cz = iz + Math.cos(yaw) * back;
      camera.position.set(cx, iy + 2.3, cz);
      camera.lookAt(ix - Math.sin(yaw) * 4, iy + 1.3 + Math.sin(t.pitch) * 2, iz - Math.cos(yaw) * 4);
    }
  }
  const zoomed = !!(viewP && viewP.scoped);
  const fovH = zoomed ? settings.fov * (WEAPONS[viewP!.weaponId()]?.scope ?? 1) : settings.fov;
  const vf = hfovToV(fovH, camera.aspect);
  if (Math.abs(camera.fov - vf) > 0.01) { camera.fov = vf; camera.updateProjectionMatrix(); }
  // billboards (site signs)
  scene.traverse(o => { if (o.userData.billboard) o.lookAt(camera.position); });
  // audio listener
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  audio.setListener(camera.position, fwd.x, fwd.y, fwd.z);

  renderer.render(scene, camera);
  if (viewP) {
    updateViewModel(viewP, dt);
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
  const spread = viewP ? g.spreadFor(viewP, viewP.def()) : 0;
  hud.update(g, { player: viewP ?? spectating, spectating, yaw: camYaw, spread, scoped: zoomed, fps, showFps: settings.showFps });
  hud.scoreboard(g, showScores || g.phase === 'over');
  lockHint.classList.toggle('hidden', !(state === 'playing' && !locked && !dragLook && !hud.buyOpen && !!p));
}

// ---------------- test hooks ----------------
(window as any).__game = {
  g: null as Game | null,
  vm, camera, renderer,
  start: (o?: Partial<GameOptions>) => startMatch(o),
  state: () => {
    const g = game; if (!g) return null;
    return {
      phase: g.phase, round: g.round, score: g.score, time: +g.time.toFixed(2), bomb: g.bomb.state, attTeam: g.attTeam,
      players: g.players.map(p => ({ n: p.name, t: p.team, side: g.side(p), alive: p.alive, hp: p.health, $: p.money, w: p.weaponId(), x: +p.pos.x.toFixed(1), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(1), task: p.brain?.task })),
      log: g.log,
    };
  },
  step: (n = 64) => { for (let i = 0; i < n && game; i++) game.tick(TICK, emptyInput()); },
  look: (yaw: number, pitch: number) => { lookYaw = yaw; lookPitch = pitch; },
  input: (inp: Partial<Input>, n = 1) => { for (let i = 0; i < n && game; i++) { if (game.local) { game.local.yaw = lookYaw; game.local.pitch = lookPitch; } game.tick(TICK, { ...emptyInput(), ...inp }); } },
  setDrag: (v: boolean) => { dragLook = v; },
  // drive the real frame loop manually (for testing while the tab is hidden)
  pump: (frames = 60, fpsRate = 60) => { for (let i = 0; i < frames; i++) runFrame(lastT + 1000 / fpsRate); },
  key: (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })),
  mouse: (button: number, down: boolean) => {
    if (down) canvas.dispatchEvent(new MouseEvent('mousedown', { button }));
    else window.dispatchEvent(new MouseEvent('mouseup', { button }));
  },
  move: (dx: number, dy: number) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy } as any)),
  // headless bot-vs-bot balance run: plays n full matches and aggregates round outcomes
  sim: (n = 4, difficulty: Difficulty = 'normal', teamSize = 5) => {
    const agg = { att: 0, def: 0, rounds: 0, plants: 0, kills: 0, avgRoundSec: 0, reasons: {} as Record<string, number>, ms: 0 };
    const t0 = performance.now();
    let tot = 0;
    for (let m = 0; m < n; m++) {
      startMatch({ spectator: true, difficulty, teamSize });
      const g = game!;
      let rs = g.time;
      for (let i = 0; i < 64 * 60 * 25 && g.phase !== 'over'; i++) {
        g.tick(TICK, null);
        for (const e of g.events) {
          if (e.type === 'planted') agg.plants++;
          if (e.type === 'kill') agg.kills++;
          if (e.type === 'roundStart') rs = g.time;
          if (e.type === 'roundEnd') { agg.rounds++; tot += g.time - rs; agg[g.sideOf(e.winner)]++; agg.reasons[e.reason] = (agg.reasons[e.reason] ?? 0) + 1; }
        }
        g.events.length = 0;
      }
    }
    agg.avgRoundSec = Math.round(tot / Math.max(1, agg.rounds));
    agg.ms = Math.round(performance.now() - t0);
    return agg;
  },
};

showMainMenu();
if (AUTOTEST) {
  startMatch({ spectator: true, difficulty: (params.get('diff') as Difficulty) ?? 'normal' });
}
requestAnimationFrame(frame);
