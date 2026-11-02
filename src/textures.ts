import * as THREE from 'three';

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!] as const;
}

function noise(g: CanvasRenderingContext2D, size: number, amt: number, count = 6000) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() * amt;
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${v})` : `rgba(255,255,255,${v * 0.6})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function tex(c: HTMLCanvasElement, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function concreteTex() {
  const [c, g] = canvas(256);
  g.fillStyle = '#b7ab96'; g.fillRect(0, 0, 256, 256);
  noise(g, 256, 0.12, 9000);
  // panel seams
  g.strokeStyle = 'rgba(60,50,40,0.35)'; g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 128); g.strokeRect(0, 128, 256, 128);
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 128); g.moveTo(64, 128); g.lineTo(64, 256); g.moveTo(192, 128); g.lineTo(192, 256); g.stroke();
  // grime at bottom
  const grd = g.createLinearGradient(0, 180, 0, 256);
  grd.addColorStop(0, 'rgba(70,55,40,0)'); grd.addColorStop(1, 'rgba(70,55,40,0.35)');
  g.fillStyle = grd; g.fillRect(0, 128, 256, 128);
  return tex(c);
}

export function floorTex() {
  const [c, g] = canvas(256);
  g.fillStyle = '#8d8478'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const s = 0.85 + Math.random() * 0.2;
    g.fillStyle = `rgb(${141 * s | 0},${132 * s | 0},${120 * s | 0})`;
    g.fillRect(x * 64 + 1, y * 64 + 1, 62, 62);
  }
  noise(g, 256, 0.1, 7000);
  return tex(c);
}

export function crateTex() {
  const [c, g] = canvas(128);
  g.fillStyle = '#8a5f32'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,220,160,0.06)';
    g.fillRect(0, i * 16, 128, 16);
    g.fillStyle = 'rgba(40,20,5,0.4)'; g.fillRect(0, i * 16, 128, 1);
  }
  noise(g, 128, 0.12, 2500);
  g.strokeStyle = '#4b3015'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
  g.lineWidth = 8; g.beginPath(); g.moveTo(8, 8); g.lineTo(120, 120); g.stroke();
  return tex(c);
}

export function metalTex() {
  const [c, g] = canvas(128);
  g.fillStyle = '#4f6a5c'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(i * 16, 0, 3, 128);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(i * 16 + 3, 0, 2, 128);
  }
  noise(g, 128, 0.15, 2000);
  g.fillStyle = 'rgba(120,60,20,0.25)';
  for (let i = 0; i < 20; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 1 + Math.random() * 10);
  return tex(c);
}

export function siteLetterTex(letter: string) {
  const [c, g] = canvas(256);
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(230,80,40,0.85)'; g.lineWidth = 14;
  g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(230,80,40,0.9)';
  g.font = 'bold 170px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function softDotTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function smokeTex() {
  const [c, g] = canvas(128);
  for (let i = 0; i < 18; i++) {
    const x = 34 + Math.random() * 60, y = 34 + Math.random() * 60, r = 20 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(225,225,225,0.35)'); grd.addColorStop(1, 'rgba(225,225,225,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export function decalTex() {
  const [c, g] = canvas(32);
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(10,10,10,0.95)'); grd.addColorStop(0.35, 'rgba(30,25,20,0.7)'); grd.addColorStop(1, 'rgba(30,25,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
