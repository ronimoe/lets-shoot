import type { Game, Player } from './game';
import { WEAPONS, BUY_MENU, GEAR } from './weapons';
import { W, H, CELL, heightAt, WALL_H, SITES } from './map';

const $ = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export const ITEM_NAME = (id: string) => WEAPONS[id]?.name ?? GEAR[id]?.name ?? (id === 'charge' ? 'Charge' : id === 'bomb' ? 'Charge' : id);
const fmtTime = (s: number) => { s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export class Hud {
  root: HTMLElement;
  el: Record<string, HTMLElement> = {};
  radarCtx: CanvasRenderingContext2D;
  radarBg: HTMLCanvasElement;
  buyOpen = false;
  onBuy: (item: string) => void = () => {};
  private last: Record<string, string> = {};
  private moneyShown = -1; private moneyDeltaT = 0;
  crosshairColor = '#6dff8a';

  constructor(parent: HTMLElement) {
    this.root = $(`<div id="hud">
      <canvas id="radar" width="400" height="400"></canvas>
      <div id="bombicon" class="hud-panel hidden">◆ You carry the charge</div>
      <div id="topbar" class="hud-panel">
        <div class="team" id="scoreL"><small>YOU</small><span>0</span></div>
        <div class="clock" id="clock"><small id="roundlbl">ROUND 1</small><span>1:55</span></div>
        <div class="team" id="scoreR"><small>ENEMY</small><span>0</span></div>
      </div>
      <div id="alive"><div class="pips" id="pipsL"></div><div class="pips" id="pipsR"></div></div>
      <div id="killfeed"></div>
      <div id="vignette"></div>
      <div id="hurt"></div>
      <div id="scope" class="hidden"></div>
      <div id="crosshair"><i class="dot"></i><i id="xl"></i><i id="xr"></i><i id="xt"></i><i id="xb"></i></div>
      <div id="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div id="center"><div class="big"></div><div class="sub"></div></div>
      <div id="progress" class="hidden"><span></span><div class="bar"><div class="fill"></div></div></div>
      <div id="prompt" class="hud-panel hidden"></div>
      <div id="spectate" class="hud-panel hidden"></div>
      <div id="money" class="hud-panel">$800</div>
      <div id="buyhint"></div>
      <div id="vitals">
        <div class="box hud-panel"><span class="num" id="hp">100</span><span class="lbl">HEALTH</span></div>
        <div class="box hud-panel"><span class="num" id="ap">0</span><span class="lbl" id="aplbl">ARMOR</span></div>
      </div>
      <div id="inventory"></div>
      <div id="ammo" class="hud-panel"><div class="wname"></div><div class="count"></div></div>
      <div id="fps"></div>
    </div>`);
    parent.appendChild(this.root);
    for (const n of this.root.querySelectorAll<HTMLElement>('[id]')) this.el[n.id] = n;
    this.el.scoreboard = $(`<div id="scoreboard" class="hud-panel hidden"></div>`);
    this.el.buymenu = $(`<div id="buymenu" class="hud-panel hidden"></div>`);
    parent.appendChild(this.el.scoreboard);
    parent.appendChild(this.el.buymenu);
    const rc = this.el.radar as HTMLCanvasElement;
    this.radarCtx = rc.getContext('2d')!;
    this.radarBg = this.renderRadarBg();
  }

  private set(key: string, el: HTMLElement, text: string, html = false) {
    if (this.last[key] === text) return;
    this.last[key] = text;
    if (html) el.innerHTML = text; else el.textContent = text;
  }

  private renderRadarBg() {
    const c = document.createElement('canvas');
    const S = 8;
    c.width = W * S; c.height = H * S;
    const g = c.getContext('2d')!;
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const h = heightAt(x, z);
      g.fillStyle = h >= WALL_H ? 'rgba(0,0,0,0)' : h > 0 ? 'rgba(120,110,95,0.85)' : 'rgba(80,88,98,0.9)';
      g.fillRect(x * S, z * S, S, S);
    }
    g.font = 'bold 28px sans-serif'; g.fillStyle = 'rgba(255,120,60,0.85)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const k of ['A', 'B'] as const) g.fillText(k, SITES[k].center.x / CELL * S, SITES[k].center.z / CELL * S);
    return c;
  }

  drawRadar(game: Game, viewer: Player | null, yaw: number) {
    const g = this.radarCtx;
    const size = 400;
    g.clearRect(0, 0, size, size);
    const S = 8;
    const scale = (size / (W * S)) * 1.0;
    // map scaled to fit; rotate around viewer
    const vx = viewer ? viewer.pos.x / CELL * S : W * S / 2;
    const vz = viewer ? viewer.pos.z / CELL * S : H * S / 2;
    const zoom = 1.7;
    g.save();
    g.beginPath(); g.rect(0, 0, size, size); g.clip();
    g.translate(size / 2, size / 2);
    g.rotate(yaw);
    g.scale(scale * zoom, scale * zoom);
    g.translate(-vx, -vz);
    g.drawImage(this.radarBg, 0, 0);
    const toR = (x: number, z: number) => [x / CELL * S, z / CELL * S] as const;
    const myTeam = viewer?.team ?? game.local?.team ?? 0;
    // bomb
    const b = game.bomb;
    const myside = game.sideOf(myTeam);
    if ((b.state === 'dropped' && myside === 'att') || b.state === 'planted') {
      const [x, z] = toR(b.pos.x, b.pos.z);
      g.fillStyle = b.state === 'planted' ? '#ff3020' : '#ffb070';
      g.fillRect(x - 6, z - 6, 12, 12);
    }
    for (const p of game.players) {
      const friendly = p.team === myTeam;
      if (!friendly && !(p.alive && p.spottedUntil > game.time)) continue;
      const [x, z] = toR(p.pos.x, p.pos.z);
      if (!p.alive) {
        g.strokeStyle = friendly ? 'rgba(200,200,200,0.6)' : 'rgba(255,90,70,0.6)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x - 6, z - 6); g.lineTo(x + 6, z + 6); g.moveTo(x + 6, z - 6); g.lineTo(x - 6, z + 6); g.stroke();
        continue;
      }
      const col = p === viewer ? '#ffffff' : friendly ? (game.side(p) === 'att' ? '#f0903a' : '#6fb0ff') : '#ff4a3a';
      g.fillStyle = col;
      g.beginPath(); g.arc(x, z, p === viewer ? 8 : 7, 0, Math.PI * 2); g.fill();
      // facing tick
      g.strokeStyle = col; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, z); g.lineTo(x - Math.sin(p.yaw) * 16, z - Math.cos(p.yaw) * 16); g.stroke();
      if (p.hasBomb && friendly) { g.fillStyle = '#ffb070'; g.fillRect(x - 3, z - 3, 6, 6); }
    }
    g.restore();
    // view cone marker
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.moveTo(size / 2, size / 2); g.arc(size / 2, size / 2, 120, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.fill();
  }

  update(game: Game, view: { player: Player | null; spectating: Player | null; yaw: number; spread: number; scoped: boolean; fps: number; showFps: boolean }) {
    const e = this.el;
    const me = game.local;
    const p = view.player; // whose info to display (local or spectated)
    const myTeam = me?.team ?? 0;
    const mySide = game.sideOf(myTeam as 0 | 1);
    const enemySide = mySide === 'att' ? 'def' : 'att';
    const colL = mySide === 'att' ? 'var(--att)' : 'var(--def)';
    const colR = enemySide === 'att' ? 'var(--att)' : 'var(--def)';
    this.set('sl', e.scoreL, `<small>${mySide === 'att' ? 'VANGUARD' : 'SENTINEL'}</small><span style="color:${colL}">${game.score[myTeam]}</span>`, true);
    this.set('sr', e.scoreR, `<small>${enemySide === 'att' ? 'VANGUARD' : 'SENTINEL'}</small><span style="color:${colR}">${game.score[1 - myTeam]}</span>`, true);
    const planted = game.phase === 'planted';
    const t = game.phase === 'freeze' ? Math.max(0, game.phaseEnd - game.time) : game.roundTimeLeft();
    const lbl = game.phase === 'freeze' ? 'BUY PHASE' : planted ? 'CHARGE' : game.phase === 'end' ? 'ROUND OVER' : `ROUND ${game.round}`;
    this.set('clock', e.clock, `<small>${lbl}</small><span>${game.phase === 'end' ? '—' : fmtTime(t)}</span>`, true);
    e.clock.classList.toggle('planted', planted);
    // alive pips
    const pips = (team: number, col: string) => game.players.filter(q => q.team === team).map(q => `<div class="pip${q.alive ? '' : ' dead'}" style="color:${col}"></div>`).join('');
    this.set('pl', e.pipsL, pips(myTeam, colL), true);
    this.set('pr', e.pipsR, pips(1 - myTeam, colR), true);
    // killfeed
    const kf = game.killfeed.filter(k => game.time - k.t < 6).map(k =>
      `<div class="kf${k.killer === 'You' || k.victim === 'You' ? ' me' : ''}"><span class="${k.ks}">${k.killer}</span><span class="w">${ITEM_NAME(k.weapon)}${k.wall ? ' ⟂' : ''}</span>${k.head ? '<span class="hs">HEADSHOT</span>' : ''}<span class="${k.vs}">${k.victim}</span></div>`).join('');
    this.set('kf', e.killfeed, kf, true);
    // center messages
    const m = game.messages.filter(x => x.until > game.time).pop();
    (e.center.children[0] as HTMLElement).style.color = m?.color ?? '';
    this.set('cb', e.center.children[0] as HTMLElement, m?.text ?? '');
    this.set('cs', e.center.children[1] as HTMLElement, m?.sub ?? '');

    // vitals
    const showP = p && p.alive ? p : null;
    e.vitals.classList.toggle('hidden', !showP);
    e.ammo.classList.toggle('hidden', !showP);
    e.inventory.classList.toggle('hidden', !showP || !!view.spectating);
    if (showP) {
      this.set('hp', e.hp, String(Math.max(0, Math.ceil(showP.health))));
      e.hp.classList.toggle('low', showP.health <= 25);
      this.set('ap', e.ap, String(Math.ceil(showP.armor)));
      this.set('apl', e.aplbl, showP.helmet ? 'ARMOR+H' : 'ARMOR');
      const d = WEAPONS[showP.weaponId()];
      const gun = showP.gun();
      this.set('wn', e.ammo.children[0] as HTMLElement, showP.slot === 'bomb' ? 'Charge' : d?.name ?? '');
      const ammoTxt = gun ? `<span class="${gun.ammo <= Math.ceil(WEAPONS[gun.id].mag * 0.2) ? 'low' : ''}">${gun.ammo}</span> <small>/ ${gun.reserve}</small>` : showP.slot === 'grenade' ? `${showP.nades.length}` : '—';
      this.set('am', e.ammo.children[1] as HTMLElement, showP.reloadEnd ? `<small>RELOADING…</small>` : ammoTxt, true);
      const inv: string[] = [];
      const row = (k: string, slot: string, name: string) => inv.push(`<div class="${showP.slot === slot ? 'active' : ''}">${k} ${name}</div>`);
      if (showP.primary) row('1', 'primary', ITEM_NAME(showP.primary.id));
      if (showP.secondary) row('2', 'secondary', ITEM_NAME(showP.secondary.id));
      row('3', 'melee', 'Field Blade');
      if (showP.nades.length) row('4', 'grenade', showP.nades.map(ITEM_NAME).join(' · '));
      if (showP.hasBomb) row('5', 'bomb', 'Charge');
      if (showP.kit) inv.push(`<div>Defuse kit</div>`);
      this.set('inv', e.inventory, inv.join(''), true);
    }
    // money
    if (me) {
      if (this.moneyShown !== me.money) {
        const delta = me.money - this.moneyShown;
        if (this.moneyShown >= 0 && delta > 0) this.moneyDeltaT = performance.now();
        this.set('md', e.money, `$${me.money}${delta > 0 && this.moneyShown >= 0 ? `<span class="delta">+${delta}</span>` : ''}`, true);
        this.moneyShown = me.money;
      } else if (this.moneyDeltaT && performance.now() - this.moneyDeltaT > 2500) {
        this.moneyDeltaT = 0;
        this.set('md', e.money, `$${me.money}`, true);
      }
      const canBuy = game.canBuy(me);
      this.set('bh', e.buyhint, canBuy ? 'Press B to open the buy menu' : '');
      if (!canBuy && this.buyOpen) this.toggleBuy(game, false);
      if (this.buyOpen) this.renderBuy(game);
    }
    e.money.classList.toggle('hidden', !me);
    e.bombicon.classList.toggle('hidden', !(me && me.alive && me.hasBomb));

    // crosshair
    const showX = !!(p && p.alive && !view.spectating && !view.scoped && p.slot !== 'bomb');
    e.crosshair.classList.toggle('hidden', !showX);
    if (showX) {
      const gap = Math.round(3 + view.spread * 900);
      const len = 6, th = 2;
      const set = (el: HTMLElement, x: number, y: number, w: number, h: number) => { el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${this.crosshairColor}`; };
      set(e.xl, -gap - len, -th / 2, len, th);
      set(e.xr, gap, -th / 2, len, th);
      set(e.xt, -th / 2, -gap - len, th, len);
      set(e.xb, -th / 2, gap, th, len);
    }
    e.scope.classList.toggle('hidden', !view.scoped);
    // hitmarker
    const hm = performance.now() / 1000;
    const age = game.time - game.hitMarker;
    e.hitmarker.style.opacity = age < 0.25 ? String(1 - age / 0.25) : '0';
    e.hitmarker.classList.toggle('head', game.hitHead);
    void hm;
    // hurt indicators
    game.hurtDir = game.hurtDir.filter(h => game.time - h.t < 1.2);
    if (me) {
      const arcs = !me.alive ? '' : game.hurtDir.map(h => {
        const rel = h.yaw - view.yaw;
        return `<div class="hurtarc" style="transform:rotate(${-rel}rad);opacity:${1 - (game.time - h.t) / 1.2}"></div>`;
      }).join('');
      this.set('hurt', e.hurt, arcs, true);
      const recentHurt = me.alive && game.time - me.lastHurt < 0.35;
      e.vignette.style.opacity = me.alive ? String(recentHurt ? 0.8 : me.health < 30 ? 0.45 : 0) : '0';
    }
    // plant / defuse progress
    let prog = '', frac = 0;
    if (me && me.alive && me.plantProg > 0) { prog = 'Planting charge…'; frac = me.plantProg / 3; }
    else if (me && me.alive && me.defuseProg > 0) { prog = me.kit ? 'Defusing (kit)…' : 'Defusing…'; frac = me.defuseProg / (me.kit ? 3.5 : 7); }
    e.progress.classList.toggle('hidden', !prog);
    if (prog) { this.set('pg', e.progress.children[0] as HTMLElement, prog); (e.progress.querySelector('.fill') as HTMLElement).style.width = `${Math.min(100, frac * 100)}%`; }
    // prompts
    let prompt = '';
    if (me && me.alive) {
      const zone = (game as any).localZone as number;
      if (me.hasBomb && (zone === 1 || zone === 2) && game.phase === 'live' && !me.plantProg) prompt = 'Hold <b>E</b> to plant the charge';
      else if (game.phase === 'planted' && game.side(me) === 'def' && !me.defuseProg && Math.hypot(me.pos.x - game.bomb.pos.x, me.pos.z - game.bomb.pos.z) < 1.6) prompt = `Hold <b>E</b> to defuse${me.kit ? '' : ' (no kit: 7s)'}`;
    }
    e.prompt.classList.toggle('hidden', !prompt);
    if (prompt) this.set('pr2', e.prompt, prompt, true);
    // spectate
    const sp = view.spectating;
    e.spectate.classList.toggle('hidden', !sp && !(me && !me.alive));
    const di = game.deathInfo;
    const recap = me && !me.alive && di ? `<div style="color:var(--bad);margin-bottom:4px">Killed by <b>${di.killer}</b> · ${ITEM_NAME(di.weapon)}${di.head ? ' · headshot' : ''}${di.hpLeft > 0 ? ` · they had ${di.hpLeft} HP` : ''}</div>` : '';
    if (me && !me.alive) this.set('spc', e.spectate, recap + (sp ? `Spectating <b style="color:${game.side(sp) === 'att' ? 'var(--att)' : 'var(--def)'}">${sp.name}</b> — ${sp.health} HP<small>Click to switch player · you respawn next round</small>` : 'You are dead<small>Waiting for next round</small>'), true);
    else if (sp) this.set('spc', e.spectate, `Spectating <b>${sp.name}</b><small>Click to switch player</small>`, true);
    this.set('fps', e.fps, view.showFps ? `${view.fps} fps` : '');
    this.drawRadar(game, sp ?? me, view.yaw);
  }

  scoreboard(game: Game, show: boolean) {
    const sb = this.el.scoreboard;
    sb.classList.toggle('hidden', !show);
    if (!show) return;
    const myTeam = game.local?.team ?? 0;
    const table = (team: number) => {
      const side = game.sideOf(team as 0 | 1);
      const rows = game.players.filter(p => p.team === team).sort((a, b) => b.score + b.kills - (a.score + a.kills))
        .map(p => `<tr class="${p.alive ? '' : 'dead'}${p === game.local ? ' me' : ''}"><td>${p.name}${p.hasBomb && team === myTeam ? ' ◆' : ''}</td><td class="n">$${team === myTeam ? p.money : '—'}</td><td class="n">${p.kills}</td><td class="n">${p.deaths}</td><td class="n">${p.score}</td><td class="n">${p.alive ? p.health : 'DEAD'}</td></tr>`).join('');
      return `<h3 style="color:${side === 'att' ? 'var(--att)' : 'var(--def)'}">${side === 'att' ? 'VANGUARD' : 'SENTINEL'} — ${game.score[team]}</h3>
        <table><tr><th>Player</th><th class="n">Money</th><th class="n">K</th><th class="n">D</th><th class="n">Score</th><th class="n">HP</th></tr>${rows}</table>`;
    };
    sb.innerHTML = table(myTeam) + table(1 - myTeam) + `<div style="color:var(--muted);font-size:12px">Round ${game.round} · First to 7 · Sides swap after round 6</div>`;
  }

  toggleBuy(game: Game, open?: boolean) {
    this.buyOpen = open ?? !this.buyOpen;
    this.el.buymenu.classList.toggle('hidden', !this.buyOpen);
    if (this.buyOpen) { this.last.buy = ''; this.renderBuy(game); }
  }

  private renderBuy(game: Game) {
    const me = game.local!;
    const side = game.side(me);
    let k = 0;
    const cats = BUY_MENU.map(c => {
      const items = c.items.filter(id => id !== 'kit' || side === 'def').map(id => {
        k++;
        const price = WEAPONS[id]?.price ?? GEAR[id]?.price ?? 0;
        const owned = me.primary?.id === id || me.secondary?.id === id || me.nades.includes(id) || (id === 'vest' && me.armor >= 100) || (id === 'vesthelm' && me.helmet && me.armor >= 100) || (id === 'kit' && me.kit);
        const eff = id === 'vesthelm' && me.armor >= 100 && !me.helmet ? 350 : price;
        const dis = owned || me.money < eff;
        return `<button class="item${owned ? ' owned' : ''}" data-id="${id}" ${dis ? 'disabled' : ''}><span><span class="k">${k <= 9 ? k : ''}</span>${ITEM_NAME(id)}</span><span class="price">$${eff}</span></button>`;
      }).join('');
      return `<div class="cat"><h4>${c.cat}</h4>${items}</div>`;
    }).join('');
    const html = `<div class="head"><b style="font-size:20px">BUY</b><span class="cash">$${me.money}</span></div><div class="cols">${cats}</div><div class="foot">Click an item or press its number · B / Esc to close · Buying is open for 25s after the round starts while you are in spawn</div>`;
    if (this.last.buy === html) return;
    this.last.buy = html;
    this.el.buymenu.innerHTML = html;
    this.el.buymenu.querySelectorAll<HTMLButtonElement>('button.item').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); this.onBuy(b.dataset.id!); }));
  }

  buyIndexItem(game: Game, n: number): string | null {
    const side = game.side(game.local!);
    const list = BUY_MENU.flatMap(c => c.items.filter(id => id !== 'kit' || side === 'def'));
    return list[n - 1] ?? null;
  }
}
