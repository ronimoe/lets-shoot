import * as THREE from 'three';

const geoCache = new Map<string, THREE.BoxGeometry>();
function box(w: number, h: number, d: number) {
  const k = `${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}

export const TEAM_COLORS = {
  att: { body: '#b5652b', dark: '#5a3a22', accent: '#f0a040' },
  def: { body: '#3b5f8f', dark: '#22324a', accent: '#7fb7ff' },
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.8) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough }); matCache.set(color, m); }
  return m;
}

export interface CharModel {
  root: THREE.Group;
  body: THREE.Group;     // pivots for crouch / death
  legL: THREE.Object3D; legR: THREE.Object3D;
  armL: THREE.Object3D; armR: THREE.Object3D;
  head: THREE.Object3D;
  gun: THREE.Group;
  muzzle: THREE.Object3D;
  bomb: THREE.Object3D;
  side: 'att' | 'def';
  setSide(side: 'att' | 'def'): void;
}

export function makeChar(side: 'att' | 'def'): CharModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const parts: THREE.Mesh[] = [];
  const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, tag: string) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.userData.tag = tag;
    parent.add(mesh);
    parts.push(mesh);
    return mesh;
  };
  const legL = new THREE.Group(); legL.position.set(-0.13, 0.9, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.13, 0.9, 0); body.add(legR);
  add(legL, box(0.2, 0.9, 0.22), mat('#2d2d2d'), 0, -0.45, 0, 'dark');
  add(legR, box(0.2, 0.9, 0.22), mat('#2d2d2d'), 0, -0.45, 0, 'dark');
  add(legL, box(0.22, 0.12, 0.3), mat('#1a1a1a'), 0, -0.86, -0.04, 'boot');
  add(legR, box(0.22, 0.12, 0.3), mat('#1a1a1a'), 0, -0.86, -0.04, 'boot');
  add(body, box(0.52, 0.62, 0.3), mat(TEAM_COLORS[side].body), 0, 1.22, 0, 'body');
  add(body, box(0.56, 0.36, 0.34), mat(TEAM_COLORS[side].dark), 0, 1.3, 0, 'dark'); // vest
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); body.add(head);
  add(head, box(0.26, 0.28, 0.27), mat('#c9a27e'), 0, 0, 0, 'skin');
  add(head, box(0.3, 0.12, 0.3), mat(TEAM_COLORS[side].dark), 0, 0.13, 0, 'dark'); // helmet
  add(head, box(0.22, 0.06, 0.04), mat(TEAM_COLORS[side].accent, 0.3), 0, 0.02, -0.14, 'accent'); // visor
  const armL = new THREE.Group(); armL.position.set(-0.32, 1.45, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.32, 1.45, 0); body.add(armR);
  add(armL, box(0.14, 0.55, 0.14), mat(TEAM_COLORS[side].body), 0, -0.25, 0, 'body');
  add(armR, box(0.14, 0.55, 0.14), mat(TEAM_COLORS[side].body), 0, -0.25, 0, 'body');
  armL.rotation.x = -1.2; armL.rotation.z = -0.5;
  armR.rotation.x = -1.3;
  const gun = new THREE.Group();
  gun.position.set(0.12, 1.32, -0.38);
  body.add(gun);
  add(gun, box(0.07, 0.11, 0.6), mat('#222'), 0, 0, 0, 'gun');
  add(gun, box(0.05, 0.14, 0.08), mat('#222'), 0, -0.1, 0.12, 'gun');
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.32); gun.add(muzzle);
  const bomb = add(body, box(0.3, 0.32, 0.14), mat('#4a4a3a'), 0, 1.25, 0.22, 'bomb');
  bomb.visible = false;
  const model: CharModel = {
    root, body, legL, legR, armL, armR, head, gun, muzzle, bomb, side,
    setSide(s) {
      if (s === model.side) return;
      model.side = s;
      for (const p of parts) {
        const tag = p.userData.tag;
        if (tag === 'body') p.material = mat(TEAM_COLORS[s].body);
        else if (tag === 'dark' && p.parent !== legL && p.parent !== legR) p.material = mat(TEAM_COLORS[s].dark);
        else if (tag === 'accent') p.material = mat(TEAM_COLORS[s].accent, 0.3);
      }
    },
  };
  return model;
}

// ---------- First-person viewmodel ----------
export interface ViewModel {
  root: THREE.Group;
  guns: Record<string, THREE.Group>;
  muzzleFlash: THREE.Mesh;
  flashLight: THREE.PointLight;
}

export function makeViewModel(): ViewModel {
  const root = new THREE.Group();
  const guns: Record<string, THREE.Group> = {};
  const dark = new THREE.MeshStandardMaterial({ color: '#4b4f56', roughness: 0.5, metalness: 0.1 });
  const mid = new THREE.MeshStandardMaterial({ color: '#6c7078', roughness: 0.5, metalness: 0.1 });
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4426', roughness: 0.7 });
  const tan = new THREE.MeshStandardMaterial({ color: '#a08a64', roughness: 0.7 });
  const glove = new THREE.MeshStandardMaterial({ color: '#3b342b', roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: '#5b4a36', roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.3, metalness: 0.35 });
  const mk = (parts: [number, number, number, number, number, number, THREE.Material][]) => {
    const g = new THREE.Group();
    for (const [w, h, d, x, y, z, m] of parts) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
    }
    // hand + forearm
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.1), glove);
    hand.position.set(0, -0.08, 0.06);
    g.add(hand);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.24), sleeve);
    arm.position.set(0.035, -0.15, 0.17);
    arm.rotation.x = 0.55;
    g.add(arm);
    const holder = new THREE.Group();
    holder.add(g);
    g.scale.setScalar(0.8);
    root.add(holder);
    holder.visible = false;
    return holder;
  };
  guns.warden = mk([[0.045, 0.07, 0.24, 0, 0, -0.06, dark], [0.04, 0.11, 0.06, 0, -0.07, 0.03, mid]]);
  guns.hammer = mk([[0.055, 0.085, 0.3, 0, 0, -0.08, steel], [0.045, 0.12, 0.07, 0, -0.08, 0.03, wood]]);
  guns.wasp = mk([[0.06, 0.09, 0.42, 0, 0, -0.12, dark], [0.04, 0.16, 0.05, 0, -0.1, -0.1, mid], [0.04, 0.1, 0.05, 0, -0.08, 0.04, dark], [0.03, 0.03, 0.12, 0, 0.0, -0.38, mid]]);
  guns.thresher = mk([[0.07, 0.08, 0.7, 0, 0, -0.25, dark], [0.06, 0.06, 0.25, 0, -0.06, -0.3, wood], [0.06, 0.12, 0.2, 0, -0.06, 0.12, wood]]);
  guns.ranger = mk([[0.06, 0.09, 0.62, 0, 0, -0.2, tan], [0.04, 0.17, 0.06, 0, -0.11, -0.12, dark], [0.05, 0.1, 0.18, 0, -0.03, 0.16, tan], [0.025, 0.025, 0.2, 0, 0.01, -0.58, dark], [0.03, 0.04, 0.08, 0, 0.065, -0.1, dark]]);
  guns.falcon = mk([[0.055, 0.085, 0.58, 0, 0, -0.18, dark], [0.04, 0.15, 0.06, 0, -0.1, -0.1, mid], [0.045, 0.09, 0.2, 0, -0.02, 0.16, dark], [0.03, 0.03, 0.16, 0, 0.01, -0.52, mid], [0.035, 0.05, 0.12, 0, 0.07, -0.12, mid]]);
  const olive = new THREE.MeshStandardMaterial({ color: '#3b4a3a', roughness: 0.6 });
  guns.longbow = mk([[0.06, 0.09, 0.85, 0, 0, -0.3, olive], [0.05, 0.05, 0.3, 0, 0.09, -0.15, dark], [0.06, 0.12, 0.22, 0, -0.04, 0.18, mid]]);
  guns.blade = mk([[0.015, 0.035, 0.24, 0, 0.02, -0.17, steel], [0.03, 0.04, 0.12, 0, 0, 0.0, dark]]);
  guns.frag = mk([[0.07, 0.09, 0.07, 0, 0.0, -0.04, new THREE.MeshStandardMaterial({ color: '#3d4a2b', roughness: 0.7 })], [0.02, 0.03, 0.04, 0, 0.06, -0.04, steel]]);
  guns.smoke = mk([[0.06, 0.12, 0.06, 0, 0.01, -0.04, new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.6 })], [0.065, 0.02, 0.065, 0, 0.07, -0.04, dark]]);
  guns.bomb = mk([[0.16, 0.12, 0.2, 0, -0.02, -0.08, new THREE.MeshStandardMaterial({ color: '#4a4a3a', roughness: 0.7 })], [0.1, 0.02, 0.08, 0, 0.05, -0.1, new THREE.MeshStandardMaterial({ color: '#40ff60', emissive: '#20a030' })]]);

  const flashMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  const muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
  muzzleFlash.visible = false;
  root.add(muzzleFlash);
  const flashLight = new THREE.PointLight('#ffc36a', 0, 6);
  root.add(flashLight);
  return { root, guns, muzzleFlash, flashLight };
}

// muzzle position in viewmodel space, per weapon
export const VM_MUZZLE: Record<string, [number, number, number]> = {
  warden: [0, 0.01, -0.2], hammer: [0, 0.01, -0.25], wasp: [0, 0.0, -0.45], thresher: [0, 0.0, -0.62],
  ranger: [0, 0.01, -0.7], falcon: [0, 0.01, -0.62], longbow: [0, 0.0, -0.75],
};
