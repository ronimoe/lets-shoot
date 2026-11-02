import * as THREE from 'three';
import { decalTex, softDotTex, smokeTex } from './textures';

interface Timed { obj: THREE.Object3D; life: number; max: number; update?: (k: number, dt: number) => void }

export class Effects {
  scene: THREE.Scene;
  timed: Timed[] = [];
  decals: THREE.Mesh[] = [];
  decalIdx = 0;
  private tracerMat = new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.8 });
  private decalMat: THREE.MeshBasicMaterial;
  private bloodMat: THREE.SpriteMaterial;
  private sparkMat: THREE.SpriteMaterial;
  private smokeMat: THREE.SpriteMaterial;
  private fireMat: THREE.SpriteMaterial;
  private flashMat: THREE.SpriteMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.decalMat = new THREE.MeshBasicMaterial({ map: decalTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.bloodMat = new THREE.SpriteMaterial({ map: softDotTex('rgba(150,10,10,0.95)', 'rgba(120,0,0,0)'), depthWrite: false });
    this.sparkMat = new THREE.SpriteMaterial({ map: softDotTex('rgba(255,230,160,1)', 'rgba(255,160,40,0)'), depthWrite: false, blending: THREE.AdditiveBlending });
    this.smokeMat = new THREE.SpriteMaterial({ map: smokeTex(), depthWrite: false, color: '#d8d8d8' });
    this.fireMat = new THREE.SpriteMaterial({ map: softDotTex('rgba(255,210,120,1)', 'rgba(255,80,0,0)'), depthWrite: false, blending: THREE.AdditiveBlending });
    this.flashMat = new THREE.SpriteMaterial({ map: softDotTex('rgba(255,220,140,1)', 'rgba(255,170,60,0)'), depthWrite: false, blending: THREE.AdditiveBlending });
    const geo = new THREE.PlaneGeometry(0.13, 0.13);
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(geo, this.decalMat);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.scene.add(line);
    this.timed.push({ obj: line, life: 0.06, max: 0.06, update: k => ((line.material as THREE.LineBasicMaterial).opacity = 0.8 * k) });
  }

  decal(p: THREE.Vector3, n: THREE.Vector3) {
    const m = this.decals[this.decalIdx++ % this.decals.length];
    m.visible = true;
    m.position.copy(p).addScaledVector(n, 0.01);
    m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    m.rotateZ(Math.random() * 6.28);
    this.spark(p, n);
  }

  private sprite(mat: THREE.SpriteMaterial, p: THREE.Vector3, size: number, life: number, vel?: THREE.Vector3, grow = 1) {
    const s = new THREE.Sprite(mat.clone());
    s.position.copy(p);
    s.scale.setScalar(size);
    this.scene.add(s);
    const v = vel?.clone();
    this.timed.push({
      obj: s, life, max: life,
      update: (k, dt) => {
        (s.material as THREE.SpriteMaterial).opacity = k;
        s.scale.setScalar(size * (1 + (1 - k) * grow));
        if (v) { s.position.addScaledVector(v, dt); v.y -= 4 * dt; }
      },
    });
    return s;
  }

  spark(p: THREE.Vector3, n: THREE.Vector3) {
    this.sprite(this.sparkMat, p.clone().addScaledVector(n, 0.03), 0.18, 0.08);
    this.sprite(this.smokeMat, p.clone().addScaledVector(n, 0.1), 0.25, 0.5, n.clone().multiplyScalar(0.6), 2);
  }

  blood(p: THREE.Vector3, dir: THREE.Vector3, head: boolean) {
    const n = head ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(1.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5));
      this.sprite(this.bloodMat, p, head ? 0.35 : 0.25, 0.35, v, 1.5);
    }
  }

  muzzle(p: THREE.Vector3) {
    this.sprite(this.flashMat, p, 0.45, 0.05);
  }

  explosion(p: THREE.Vector3) {
    this.sprite(this.fireMat, p.clone().setY(p.y + 0.5), 3, 0.35, undefined, 1.5);
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6);
      this.sprite(this.fireMat, p.clone().setY(p.y + 0.4), 1, 0.4, v, 1);
      this.sprite(this.smokeMat, p.clone().setY(p.y + 0.6), 2, 2.2, v.multiplyScalar(0.3), 1.5);
    }
    const light = new THREE.PointLight('#ffb050', 40, 18);
    light.position.copy(p).setY(p.y + 1);
    this.scene.add(light);
    this.timed.push({ obj: light, life: 0.35, max: 0.35, update: k => (light.intensity = 40 * k) });
  }

  // a smoke cloud: returns object that can be removed when expired
  smokeCloud(p: THREE.Vector3, duration: number, radius: number) {
    const g = new THREE.Group();
    const puffs: THREE.Sprite[] = [];
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(this.smokeMat.clone());
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.75;
      s.position.set(Math.cos(a) * r, 0.4 + Math.random() * 2.4, Math.sin(a) * r);
      s.userData.size = radius * (1.1 + Math.random() * 0.7);
      s.scale.setScalar(0.1);
      (s.material as THREE.SpriteMaterial).opacity = 0.95;
      (s.material as THREE.SpriteMaterial).rotation = Math.random() * 6;
      g.add(s);
      puffs.push(s);
    }
    g.position.copy(p).setY(0);
    this.scene.add(g);
    this.timed.push({
      obj: g, life: duration, max: duration,
      update: k => {
        const age = (1 - k) * duration;
        const grow = Math.min(1, age / 1.2);
        const fade = Math.min(1, (duration - age) / 2.5);
        for (const s of puffs) {
          s.scale.setScalar(s.userData.size * grow);
          (s.material as THREE.SpriteMaterial).opacity = 0.97 * fade;
        }
      },
    });
  }

  update(dt: number) {
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.obj);
        t.obj.traverse(o => {
          const any = o as any;
          if (any.geometry && !(o instanceof THREE.Sprite)) any.geometry.dispose?.();
          if (any.material && any.material !== this.decalMat) any.material.dispose?.();
        });
        this.timed.splice(i, 1);
        continue;
      }
      t.update?.(t.life / t.max, dt);
    }
  }

  clearRound() {
    for (const t of this.timed) this.scene.remove(t.obj);
    this.timed.length = 0;
    for (const d of this.decals) d.visible = false;
  }
}
