import * as THREE from 'three';
import { CELL, W, H, WALL_H, CRATE_H, TALL_H, heightAt, SITES } from './map';
import { concreteTex, floorTex, crateTex, metalTex, siteLetterTex } from './textures';

class GeoBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  // quad with 4 corners (counter-clockwise seen from normal side)
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][]) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nor.push(n[0], n[1], n[2]);
    for (const u of uvs) this.uv.push(u[0], u[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Emits the visible faces of a cell-column box; side faces are clipped to what sticks out above the neighbour.
function emitCell(b: GeoBuilder, ix: number, iz: number, h: number, uvScale: number, boxUV: boolean) {
  const x0 = ix * CELL, x1 = x0 + CELL, z0 = iz * CELL, z1 = z0 + CELL;
  const s = 1 / uvScale;
  // top
  if (h < WALL_H) b.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0],
    boxUV ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]]);
  const sides: [number, number, number[], number[], number[]][] = [
    [ix + 1, iz, [x1, 0, z1], [x1, 0, z0], [1, 0, 0]],
    [ix - 1, iz, [x0, 0, z0], [x0, 0, z1], [-1, 0, 0]],
    [ix, iz + 1, [x0, 0, z1], [x1, 0, z1], [0, 0, 1]],
    [ix, iz - 1, [x1, 0, z0], [x0, 0, z0], [0, 0, -1]],
  ];
  for (const [nx, nz, p0, p1, n] of sides) {
    const nh = nx < 0 || nz < 0 || nx >= W || nz >= H ? WALL_H : heightAt(nx, nz);
    if (nh >= h) continue;
    const y0 = nh, y1 = h;
    const u0 = boxUV ? 0 : (n[0] !== 0 ? p0[2] : p0[0]) * s;
    const u1 = boxUV ? 1 : (n[0] !== 0 ? p1[2] : p1[0]) * s;
    const v0 = boxUV ? y0 / h : y0 * s, v1 = boxUV ? 1 : y1 * s;
    b.quad([p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], n, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
}

export function buildWorld(scene: THREE.Scene) {
  const walls = new GeoBuilder(), crates = new GeoBuilder(), tall = new GeoBuilder();
  for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) {
    const h = heightAt(ix, iz);
    if (h === WALL_H) emitCell(walls, ix, iz, h, 4, false);
    else if (h === CRATE_H) emitCell(crates, ix, iz, h, 2, true);
    else if (h === TALL_H) emitCell(tall, ix, iz, h, 2, false);
  }
  const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.92 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex(), roughness: 0.85 });
  const tallMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.6, metalness: 0.3 });
  for (const [geo, mat] of [[walls, wallMat], [crates, crateMat], [tall, tallMat]] as const) {
    const m = new THREE.Mesh(geo.build(), mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }
  // floor
  const ft = floorTex();
  ft.repeat.set(W * CELL / 4, H * CELL / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * CELL, H * CELL), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W * CELL / 2, 0, H * CELL / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // site markings
  for (const key of ['A', 'B'] as const) {
    const s = SITES[key];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: siteLetterTex(key), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.center.x, 0.02, s.center.z + 3);
    scene.add(m);
    // wall sign near entrances
    for (const e of s.entrances) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: siteLetterTex(key), transparent: true, side: THREE.DoubleSide }));
      sign.position.set(e.x, 3.2, e.z);
      sign.userData.billboard = true;
      scene.add(sign);
    }
  }

  // lighting
  scene.background = new THREE.Color('#9fc3e6');
  scene.fog = new THREE.Fog('#b8cde0', 60, 160);
  const hemi = new THREE.HemisphereLight('#dfefff', '#6b5a45', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.position.set(W * CELL / 2 - 30, 60, H * CELL / 2 - 20);
  sun.target.position.set(W * CELL / 2, 0, H * CELL / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
}
