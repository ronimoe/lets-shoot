// "Foundry" — an original three-lane bomb-defusal map, defined as a cell grid.
// The same grid drives rendering, collision, bullet raycasts and bot navigation.

export const CELL = 2;
export const W = 44;
export const H = 36;
export const WALL_H = 4.5;
export const CRATE_H = 1.0;
export const TALL_H = 2.0;

export const Z_NONE = 0, Z_SITE_A = 1, Z_SITE_B = 2, Z_ATT_SPAWN = 3, Z_DEF_SPAWN = 4;

export const heights = new Float32Array(W * H).fill(WALL_H);
export const zones = new Uint8Array(W * H);

type Rect = [number, number, number, number];

function fill(r: Rect, h: number) {
  for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) heights[z * W + x] = h;
}
function zone(r: Rect, zn: number) {
  for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) zones[z * W + x] = zn;
}

const FLOORS: Rect[] = [
  [2, 2, 13, 10],   // A site
  [30, 2, 41, 10],  // B site
  [17, 1, 26, 5],   // defender spawn
  [14, 3, 16, 5],   // A short
  [27, 3, 29, 5],   // B short
  [19, 6, 24, 28],  // mid
  [2, 11, 5, 30],   // A long
  [6, 29, 12, 30],  // spawn -> A long
  [6, 16, 18, 17],  // catwalk mid -> A long
  [9, 11, 10, 15],  // A ramp from catwalk
  [37, 11, 41, 30], // B lane
  [31, 29, 36, 30], // spawn -> B lane
  [25, 20, 36, 21], // connector mid -> B lane
  [32, 11, 33, 19], // B window from connector
  [13, 29, 30, 33], // attacker spawn
];
for (const r of FLOORS) fill(r, 0);

// mid choke "doors"
fill([19, 12, 20, 13], WALL_H);
fill([23, 12, 24, 13], WALL_H);
// doglegs that break the long sightlines down A long and the B lane
fill([2, 22, 3, 23], WALL_H);
fill([40, 22, 41, 23], WALL_H);

const CRATES: [number, number, number][] = [
  // A site
  [6, 5, TALL_H], [7, 5, TALL_H], [6, 6, CRATE_H], [11, 8, CRATE_H], [3, 4, TALL_H], [12, 3, CRATE_H],
  // B site
  [35, 5, TALL_H], [36, 5, TALL_H], [35, 6, CRATE_H], [32, 8, CRATE_H], [40, 4, TALL_H], [31, 3, CRATE_H],
  // mid
  [20, 18, CRATE_H], [23, 9, CRATE_H], [22, 23, TALL_H],
  // lanes
  [3, 20, CRATE_H], [4, 24, TALL_H], [39, 17, CRATE_H], [38, 24, TALL_H], [15, 17, CRATE_H], [29, 20, CRATE_H],
  [5, 13, TALL_H], [37, 13, TALL_H], [39, 14, TALL_H], [21, 26, TALL_H], [22, 7, TALL_H],
  // spawns
  [16, 31, CRATE_H], [27, 31, CRATE_H], [18, 4, CRATE_H], [25, 4, CRATE_H],
];
for (const [x, z, h] of CRATES) heights[z * W + x] = h;

zone([2, 2, 13, 10], Z_SITE_A);
zone([30, 2, 41, 10], Z_SITE_B);
zone([13, 29, 30, 33], Z_ATT_SPAWN);
zone([17, 1, 26, 5], Z_DEF_SPAWN);

export function cellCenter(ix: number, iz: number) {
  return { x: (ix + 0.5) * CELL, z: (iz + 0.5) * CELL };
}

export function heightAt(ix: number, iz: number): number {
  if (ix < 0 || iz < 0 || ix >= W || iz >= H) return WALL_H;
  return heights[iz * W + ix];
}

export function zoneAtWorld(x: number, z: number): number {
  const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
  if (ix < 0 || iz < 0 || ix >= W || iz >= H) return Z_NONE;
  return zones[iz * W + ix];
}

export function walkable(ix: number, iz: number) {
  return heightAt(ix, iz) === 0;
}

function cellsWhere(pred: (ix: number, iz: number) => boolean) {
  const out: { x: number; z: number; ix: number; iz: number }[] = [];
  for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) if (pred(ix, iz)) out.push({ ...cellCenter(ix, iz), ix, iz });
  return out;
}

export const ATT_SPAWNS = cellsWhere((x, z) => z >= 31 && z <= 32 && x >= 15 && x <= 28 && x % 2 === 1 && walkable(x, z));
export const DEF_SPAWNS = cellsWhere((x, z) => z >= 1 && z <= 2 && x >= 18 && x <= 25 && walkable(x, z));

export const SITES = {
  A: {
    zone: Z_SITE_A,
    name: 'A',
    cells: cellsWhere((x, z) => zones[z * W + x] === Z_SITE_A && walkable(x, z)),
    // cells where attackers enter the site; defenders watch these
    entrances: [cellCenter(3, 11), cellCenter(9, 11), cellCenter(14, 4)],
    center: cellCenter(8, 6),
  },
  B: {
    zone: Z_SITE_B,
    name: 'B',
    cells: cellsWhere((x, z) => zones[z * W + x] === Z_SITE_B && walkable(x, z)),
    entrances: [cellCenter(39, 11), cellCenter(32, 11), cellCenter(29, 4)],
    center: cellCenter(36, 7),
  },
};
export type SiteKey = 'A' | 'B';

// ---------- Ray casting against the cell grid ----------
export interface RayHit { t: number; nx: number; ny: number; nz: number; h: number; ix: number; iz: number; exitT: number }

// Casts a ray from (ox,oy,oz) along normalized (dx,dy,dz). Returns first hit with geometry or floor.
export function raycastWorld(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, skipBelowH = -1): RayHit | null {
  let best: RayHit | null = null;
  // floor
  if (dy < -1e-6) {
    const tf = -oy / dy;
    if (tf >= 0 && tf <= maxT) best = { t: tf, nx: 0, ny: 1, nz: 0, h: 0, ix: -1, iz: -1, exitT: tf };
  }
  let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : CELL / Math.abs(dx);
  const tDeltaZ = Math.abs(dz) < 1e-9 ? Infinity : CELL / Math.abs(dz);
  let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx));
  let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / Math.abs(dz));
  let tEnter = 0;
  let enterAxis = -1; // 0 = x face, 1 = z face
  const limit = best ? best.t : maxT;
  for (let i = 0; i < 200; i++) {
    const tExit = Math.min(tMaxX, tMaxZ, limit);
    const h = heightAt(ix, iz);
    if (h > 0 && h > skipBelowH) {
      const yEnter = oy + dy * tEnter;
      const yExit = oy + dy * tExit;
      if (yEnter < h && yEnter >= 0) {
        // side face (or origin inside)
        let nx = 0, nz = 0;
        if (enterAxis === 0) nx = -stepX; else if (enterAxis === 1) nz = -stepZ;
        // compute exit t for penetration (where ray leaves this cell's box)
        let exitT = tExit;
        if (dy > 0 && yExit > h) exitT = (h - oy) / dy;
        return { t: tEnter, nx, ny: enterAxis === -1 ? 1 : 0, nz, h, ix, iz, exitT };
      }
      if (yEnter >= h && yExit < h && dy < 0) {
        const tt = (h - oy) / dy;
        return { t: tt, nx: 0, ny: 1, nz: 0, h, ix, iz, exitT: tExit };
      }
    }
    if (tExit >= limit) break;
    if (tMaxX < tMaxZ) { ix += stepX; tEnter = tMaxX; tMaxX += tDeltaX; enterAxis = 0; }
    else { iz += stepZ; tEnter = tMaxZ; tMaxZ += tDeltaZ; enterAxis = 1; }
  }
  return best;
}

// Line of sight between two points (no smoke check here).
export function hasLOS(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) return true;
  const hit = raycastWorld(ax, ay, az, dx / d, dy / d, dz / d, d);
  return !hit || hit.t >= d - 0.05;
}

// ---------- Navigation (A* on walkable cells) ----------
export function findPath(sx: number, sz: number, gx: number, gz: number): { x: number; z: number }[] | null {
  let six = Math.floor(sx / CELL), siz = Math.floor(sz / CELL);
  const gix = Math.floor(gx / CELL), giz = Math.floor(gz / CELL);
  if (!walkable(gix, giz)) return null;
  if (!walkable(six, siz)) {
    // standing on a crate or clipped: pick nearest walkable neighbour
    let found = false;
    for (let r = 1; r < 3 && !found; r++) for (let oz = -r; oz <= r && !found; oz++) for (let ox = -r; ox <= r && !found; ox++) {
      if (walkable(six + ox, siz + oz)) { six += ox; siz += oz; found = true; }
    }
    if (!found) return null;
  }
  const N = W * H;
  const g = new Float32Array(N).fill(Infinity);
  const f = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open: number[] = [];
  const start = siz * W + six, goal = giz * W + gix;
  const hfn = (i: number) => {
    const x = i % W, z = (i / W) | 0;
    const ddx = Math.abs(x - gix), ddz = Math.abs(z - giz);
    return Math.max(ddx, ddz) + 0.414 * Math.min(ddx, ddz);
  };
  g[start] = 0; f[start] = hfn(start); open.push(start);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W, cz = (cur / W) | 0;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue;
      const nx = cx + ox, nz = cz + oz;
      if (!walkable(nx, nz)) continue;
      if (ox && oz && (!walkable(cx + ox, cz) || !walkable(cx, cz + oz))) continue;
      const ni = nz * W + nx;
      if (closed[ni]) continue;
      // prefer cells away from walls slightly
      const cost = (ox && oz ? 1.414 : 1);
      const ng = g[cur] + cost;
      if (ng < g[ni]) { g[ni] = ng; f[ni] = ng + hfn(ni); came[ni] = cur; open.push(ni); }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) { cells.push(c); if (c === start) break; }
  cells.reverse();
  // string-pull: drop waypoints that have clear walkable line from previous kept point
  const pts = cells.map(c => cellCenter(c % W, (c / W) | 0));
  const out: { x: number; z: number }[] = [];
  let anchor = { x: sx, z: sz };
  let i = 1;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && clearWalk(anchor.x, anchor.z, pts[j + 1].x, pts[j + 1].z)) j++;
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  if (out.length === 0) out.push({ x: gx, z: gz });
  else out[out.length - 1] = { x: gx, z: gz };
  return out;
}

// checks that a capsule of radius ~0.5 can walk straight between points
export function clearWalk(ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / 0.5);
  for (let s = 0; s <= steps; s++) {
    const t = s / Math.max(1, steps);
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    for (const [ox, oz] of [[0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]]) {
      if (!walkable(Math.floor((x + ox) / CELL), Math.floor((z + oz) / CELL))) return false;
    }
  }
  return true;
}

export function randomCellIn(cells: { x: number; z: number }[], rand = Math.random) {
  return cells[Math.floor(rand() * cells.length)];
}
