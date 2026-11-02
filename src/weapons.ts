export type Slot = 'primary' | 'secondary' | 'melee' | 'grenade';

export interface WeaponDef {
  id: string;
  name: string;
  slot: Slot;
  price: number;
  damage: number;
  rpm: number;
  mag: number;
  reserve: number;
  reload: number;      // seconds
  auto: boolean;
  armorPen: number;    // fraction of damage kept vs armor
  falloff: number;     // damage multiplier per 10m
  spread: number;      // base inaccuracy (radians) standing still
  moveSpread: number;  // added at full run speed
  airSpread: number;
  crouchMul: number;
  kick: number;        // vertical recoil per shot (radians)
  kickSide: number;    // horizontal sway amplitude
  kickMax: number;     // cap on accumulated vertical recoil
  recover: number;     // recoil recovery rate (1/s)
  speed: number;       // max run speed (m/s)
  reward: number;      // kill reward
  pellets?: number;
  scope?: number;      // zoom fov factor
  range?: number;      // melee range
  pen: number;         // wall penetration power (0 = none)
  team?: 'att' | 'def';
}

export const WEAPONS: Record<string, WeaponDef> = {
  blade: {
    id: 'blade', name: 'Field Blade', slot: 'melee', price: 0, damage: 40, rpm: 120, mag: 0, reserve: 0, reload: 0, auto: true,
    armorPen: 0.85, falloff: 1, spread: 0, moveSpread: 0, airSpread: 0, crouchMul: 1, kick: 0, kickSide: 0, kickMax: 0, recover: 10,
    speed: 6.4, reward: 1500, range: 1.9, pen: 0,
  },
  warden: {
    id: 'warden', name: 'Warden P9', slot: 'secondary', price: 200, damage: 30, rpm: 360, mag: 13, reserve: 52, reload: 2.1, auto: false,
    armorPen: 0.5, falloff: 0.86, spread: 0.0045, moveSpread: 0.035, airSpread: 0.12, crouchMul: 0.8, kick: 0.018, kickSide: 0.004, kickMax: 0.12, recover: 9,
    speed: 6.0, reward: 300, pen: 1,
  },
  hammer: {
    id: 'hammer', name: 'Hammer .50', slot: 'secondary', price: 700, damage: 58, rpm: 220, mag: 7, reserve: 35, reload: 2.2, auto: false,
    armorPen: 0.85, falloff: 0.82, spread: 0.004, moveSpread: 0.07, airSpread: 0.2, crouchMul: 0.8, kick: 0.055, kickSide: 0.01, kickMax: 0.2, recover: 6,
    speed: 5.8, reward: 300, pen: 2,
  },
  wasp: {
    id: 'wasp', name: 'Wasp SMG', slot: 'primary', price: 1250, damage: 25, rpm: 860, mag: 30, reserve: 120, reload: 2.3, auto: true,
    armorPen: 0.6, falloff: 0.8, spread: 0.008, moveSpread: 0.022, airSpread: 0.12, crouchMul: 0.85, kick: 0.0085, kickSide: 0.006, kickMax: 0.12, recover: 8,
    speed: 6.1, reward: 600, pen: 1,
  },
  thresher: {
    id: 'thresher', name: 'Thresher 12', slot: 'primary', price: 1300, damage: 19, rpm: 70, mag: 7, reserve: 32, reload: 3.0, auto: false,
    armorPen: 0.5, falloff: 0.55, spread: 0.06, moveSpread: 0.02, airSpread: 0.1, crouchMul: 1, kick: 0.07, kickSide: 0.01, kickMax: 0.2, recover: 5,
    speed: 5.6, reward: 900, pellets: 9, pen: 0,
  },
  ranger: {
    id: 'ranger', name: 'Ranger AR', slot: 'primary', price: 2800, damage: 34, rpm: 620, mag: 30, reserve: 90, reload: 2.5, auto: true,
    armorPen: 0.78, falloff: 0.97, spread: 0.0035, moveSpread: 0.09, airSpread: 0.25, crouchMul: 0.75, kick: 0.0135, kickSide: 0.0075, kickMax: 0.17, recover: 7,
    speed: 5.4, reward: 300, pen: 2,
  },
  falcon: {
    id: 'falcon', name: 'Falcon Carbine', slot: 'primary', price: 3100, damage: 31, rpm: 690, mag: 25, reserve: 75, reload: 2.2, auto: true,
    armorPen: 0.72, falloff: 0.97, spread: 0.003, moveSpread: 0.08, airSpread: 0.25, crouchMul: 0.75, kick: 0.0105, kickSide: 0.0055, kickMax: 0.14, recover: 8,
    speed: 5.5, reward: 300, pen: 2,
  },
  longbow: {
    id: 'longbow', name: 'Longbow', slot: 'primary', price: 4600, damage: 118, rpm: 42, mag: 5, reserve: 25, reload: 3.4, auto: false,
    armorPen: 0.97, falloff: 0.99, spread: 0.06, moveSpread: 0.16, airSpread: 0.4, crouchMul: 1, kick: 0.07, kickSide: 0.01, kickMax: 0.2, recover: 4,
    speed: 4.8, reward: 100, scope: 0.25, pen: 3,
  },
  frag: {
    id: 'frag', name: 'Frag Grenade', slot: 'grenade', price: 300, damage: 98, rpm: 60, mag: 1, reserve: 0, reload: 0, auto: false,
    armorPen: 0.6, falloff: 1, spread: 0, moveSpread: 0, airSpread: 0, crouchMul: 1, kick: 0, kickSide: 0, kickMax: 0, recover: 10,
    speed: 6.2, reward: 300, pen: 0,
  },
  smoke: {
    id: 'smoke', name: 'Smoke Canister', slot: 'grenade', price: 300, damage: 0, rpm: 60, mag: 1, reserve: 0, reload: 0, auto: false,
    armorPen: 1, falloff: 1, spread: 0, moveSpread: 0, airSpread: 0, crouchMul: 1, kick: 0, kickSide: 0, kickMax: 0, recover: 10,
    speed: 6.2, reward: 300, pen: 0,
  },
};

export const SCOPED_SPREAD = 0.0012;

// Deterministic horizontal recoil sway so spray patterns are learnable.
export function recoilYaw(def: WeaponDef, shot: number): number {
  if (shot < 4) return (shot % 2 ? 0.25 : -0.15) * def.kickSide;
  const phase = def.id.length * 0.9;
  return Math.sin(shot * 0.42 + phase) * def.kickSide * 1.6;
}

export const BUY_MENU: { cat: string; items: string[] }[] = [
  { cat: 'Pistols', items: ['warden', 'hammer'] },
  { cat: 'SMG / Shotgun', items: ['wasp', 'thresher'] },
  { cat: 'Rifles', items: ['ranger', 'falcon', 'longbow'] },
  { cat: 'Gear', items: ['vest', 'vesthelm', 'kit', 'frag', 'smoke'] },
];

export const GEAR: Record<string, { name: string; price: number }> = {
  vest: { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Vest + Helmet', price: 1000 },
  kit: { name: 'Defuse Kit', price: 400 },
};
