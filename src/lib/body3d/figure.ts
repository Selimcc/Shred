// Le corps en 3D, décrit muscle par muscle : chaque muscle est un volume simple (ellipsoïde orienté ou cône
// arrondi), et la peau est leur union adoucie. Le même fichier sert au script qui fabrique le maillage
// (scripts/gen-body.mjs) et à l'app, qui retrouve sur chaque point de la surface le muscle le plus proche pour le
// colorer et tracer les séparations entre muscles.
// Repère : en mètres, y vers le haut (pieds à 0), le corps regarde vers +z, x = 0 au milieu.
import type { Region } from '../readiness';

/** Ce que peut être un volume : un muscle suivi par l'app, un muscle non suivi, ou la peau (tête, mains, articulations). */
export type Part = Region | 'other' | 'skin';

/** Les parties dans l'ordre des couleurs envoyées au rendu. */
export const PARTS: Part[] = [
  'skin',
  'other',
  'chest',
  'delts',
  'reardelts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'traps',
  'lats',
  'lowerback',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
  'neck',
];

type V3 = [number, number, number];

export interface Prim {
  /** 0 : ellipsoïde ; 1 : cône arrondi. */
  kind: 0 | 1;
  part: number;
  /** Les séparations se tracent entre deux volumes de groupes différents. 0 : volumes de remplissage. */
  group: number;
  /** Ellipsoïde : centre, demi-axes, rotation (colonnes : axes du volume dans le repère du corps). */
  c: V3;
  r: V3;
  m: [V3, V3, V3];
  /** Cône arrondi : extrémités et rayons. */
  a: V3;
  b: V3;
  r1: number;
  r2: number;
}

const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const len = (p: V3) => Math.sqrt(dot(p, p));
const norm = (p: V3): V3 => {
  const l = len(p) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const ID: [V3, V3, V3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

let groups = 0;
const out: Prim[] = [];
const partOf = (p: Part) => PARTS.indexOf(p);

/** Ellipsoïde posé dans les axes du corps. */
function E(part: Part, c: V3, r: V3, opts: { mirror?: boolean; group?: number } = {}) {
  add(
    {
      kind: 0,
      part: partOf(part),
      group: opts.group ?? (part === 'skin' ? 0 : ++groups),
      c,
      r,
      m: ID,
      a: c,
      b: c,
      r1: 0,
      r2: 0,
    },
    opts.mirror ?? c[0] !== 0,
  );
}

/**
 * Ellipsoïde tendu d'un point à un autre (le sens des fibres) : `w` de large et `d` d'épaisseur. `fwd` donne la
 * direction de l'épaisseur (vers l'avant par défaut).
 */
function S(part: Part, a: V3, b: V3, w: number, d: number, opts: { fwd?: V3; mirror?: boolean; group?: number } = {}) {
  const y = norm(sub(b, a));
  const f = norm(opts.fwd ?? [0, 0, 1]);
  const z = norm(sub(f, [y[0] * dot(f, y), y[1] * dot(f, y), y[2] * dot(f, y)]));
  const x = cross(y, z);
  const c: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  add(
    {
      kind: 0,
      part: partOf(part),
      group: opts.group ?? (part === 'skin' ? 0 : ++groups),
      c,
      r: [w, len(sub(b, a)) / 2, d],
      m: [x, y, z],
      a,
      b,
      r1: 0,
      r2: 0,
    },
    opts.mirror ?? true,
  );
}

/** Cône arrondi entre deux points (os, cœur des membres). */
function C(part: Part, a: V3, b: V3, r1: number, r2: number, opts: { mirror?: boolean } = {}) {
  add(
    {
      kind: 1,
      part: partOf(part),
      group: 0,
      c: a,
      r: [0, 0, 0],
      m: ID,
      a,
      b,
      r1,
      r2,
    },
    opts.mirror ?? (a[0] !== 0 || b[0] !== 0),
  );
}

const flip = (v: V3): V3 => [-v[0], v[1], v[2]];

function add(p: Prim, mirror: boolean) {
  out.push(p);
  if (!mirror) return;
  // Le côté droit : symétrie par rapport au plan x = 0. Les axes du volume se reflètent, le premier change de sens
  // pour que la rotation reste directe.
  out.push({
    ...p,
    group: p.group ? ++groups : 0,
    c: flip(p.c),
    a: flip(p.a),
    b: flip(p.b),
    m: [flip(p.m[0]).map((x) => -x) as V3, flip(p.m[1]), flip(p.m[2])],
  });
}

/* ---------- Le corps ---------- */

// Tête : crâne, visage, mâchoire ; cou et sterno-cléido-mastoïdiens.
E('skin', [0, 1.7, -0.004], [0.079, 0.094, 0.092]);
E('skin', [0, 1.655, 0.03], [0.062, 0.07, 0.064]);
E('skin', [0, 1.608, 0.03], [0.05, 0.036, 0.055]);
C('neck', [0, 1.49, -0.014], [0, 1.635, -0.008], 0.07, 0.056);
S('neck', [0.05, 1.615, -0.004], [0.016, 1.49, 0.058], 0.02, 0.02, {
  fwd: [0.4, 0, 1],
});

// Tronc (remplissage) : thorax, épaules, taille, bassin.
E('skin', [0, 1.31, -0.004], [0.155, 0.19, 0.105]);
E('skin', [0, 1.41, -0.006], [0.17, 0.1, 0.1]);
E('skin', [0, 1.08, -0.002], [0.122, 0.17, 0.088]);
E('skin', [0, 0.93, -0.01], [0.152, 0.105, 0.098]);

// Pectoraux : une grande plaque en éventail (bas) et le faisceau du haut.
S('chest', [0.01, 1.3, 0.083], [0.18, 1.39, 0.052], 0.082, 0.03);
S('chest', [0.012, 1.42, 0.078], [0.175, 1.432, 0.05], 0.04, 0.026);

// Épaules : deltoïde avant, de côté, arrière.
S('delts', [0.16, 1.478, 0.05], [0.218, 1.345, 0.05], 0.046, 0.034, {
  fwd: [0.5, 0, 1],
});
S('delts', [0.196, 1.492, 0.0], [0.244, 1.33, 0.0], 0.05, 0.042, {
  fwd: [1, 0, 0],
});
S('reardelts', [0.168, 1.474, -0.052], [0.222, 1.345, -0.048], 0.046, 0.034, {
  fwd: [0.5, 0, -1],
});

// Trapèzes : le haut (du cou à l'épaule), le milieu et le bas en losange.
S('traps', [0.03, 1.58, -0.028], [0.185, 1.475, -0.022], 0.046, 0.03, {
  fwd: [0, 1, -0.6],
});
S('traps', [0, 1.545, -0.058], [0, 1.18, -0.088], 0.078, 0.022, {
  fwd: [0, 0, -1],
  mirror: false,
});
S('traps', [0.03, 1.455, -0.078], [0.165, 1.43, -0.058], 0.045, 0.022, {
  fwd: [0, 0.25, -1],
});

// Dos : grands dorsaux (jusque sous les bras), grand rond, sous-épineux (coiffe), lombaires.
S('lats', [0.05, 1.08, -0.085], [0.17, 1.37, -0.05], 0.11, 0.034, {
  fwd: [0.55, 0, -1],
});
S('lats', [0.125, 1.375, -0.07], [0.195, 1.39, -0.038], 0.03, 0.026, {
  fwd: [0.3, 0, -1],
});
E('reardelts', [0.1, 1.392, -0.094], [0.062, 0.05, 0.02]);
S('lowerback', [0.036, 0.94, -0.1], [0.042, 1.25, -0.092], 0.038, 0.024, {
  fwd: [0, 0, -1],
});

// Abdos : quatre étages de chaque côté (les lignes entre eux se dessinent), obliques, dentelés.
for (const [y, h, z] of [
  [1.208, 0.046, 0.082],
  [1.122, 0.046, 0.086],
  [1.036, 0.046, 0.087],
  [0.934, 0.064, 0.082],
] as const)
  E('abs', [0.036, y, z], [0.04, h, 0.022]);
S('obliques', [0.1, 0.915, 0.03], [0.136, 1.225, 0.034], 0.058, 0.036, {
  fwd: [1, 0, 0.55],
});
for (const y of [1.28, 1.228, 1.176]) E('obliques', [0.148, y, 0.05 - (1.28 - y) * 0.12], [0.034, 0.027, 0.03]);

// Fessiers : grand et moyen.
E('glutes', [0.078, 0.89, -0.08], [0.09, 0.104, 0.064]);
E('glutes', [0.136, 0.962, -0.03], [0.056, 0.06, 0.048]);

// Bras : humérus, biceps et brachial, triceps (long et latéral), coude.
C('skin', [0.205, 1.43, -0.005], [0.258, 1.15, -0.015], 0.05, 0.042);
S('biceps', [0.218, 1.372, 0.02], [0.252, 1.168, 0.026], 0.044, 0.04);
S('biceps', [0.248, 1.255, 0.002], [0.264, 1.15, 0.004], 0.032, 0.026, {
  fwd: [1, 0, 0.6],
});
S('triceps', [0.204, 1.384, -0.042], [0.25, 1.168, -0.048], 0.044, 0.038, {
  fwd: [0, 0, -1],
});
S('triceps', [0.232, 1.372, -0.02], [0.266, 1.218, -0.03], 0.034, 0.03, {
  fwd: [1, 0, -0.5],
});
E('skin', [0.258, 1.14, -0.018], [0.04, 0.04, 0.04]);

// Avant-bras : fléchisseurs (devant), brachio-radial et extenseurs (côté), poignet, main.
C('skin', [0.258, 1.13, -0.01], [0.288, 0.895, 0.016], 0.042, 0.027);
S('forearms', [0.25, 1.12, 0.006], [0.282, 0.905, 0.02], 0.039, 0.034, {
  fwd: [-0.3, 0, 1],
});
S('forearms', [0.272, 1.135, -0.008], [0.295, 0.92, 0.008], 0.035, 0.032, {
  fwd: [1, 0, 0.3],
});
S('skin', [0.29, 0.885, 0.02], [0.303, 0.762, 0.026], 0.044, 0.018, {
  fwd: [1, 0, 0],
});

// Cuisses : fémur, droit fémoral, vaste externe, vaste interne, adducteurs (non suivis), ischios.
C('skin', [0.09, 0.9, -0.004], [0.106, 0.52, 0.01], 0.07, 0.046);
S('quads', [0.094, 0.905, 0.056], [0.108, 0.552, 0.058], 0.056, 0.04);
S('quads', [0.152, 0.88, 0.004], [0.138, 0.555, 0.02], 0.054, 0.054, {
  fwd: [1, 0, 0.45],
});
S('quads', [0.066, 0.69, 0.04], [0.088, 0.54, 0.048], 0.048, 0.04, {
  fwd: [-0.5, 0, 1],
});
S('other', [0.034, 0.885, -0.004], [0.08, 0.615, 0.006], 0.05, 0.052, {
  fwd: [-1, 0, 0.35],
});
S('hamstrings', [0.128, 0.86, -0.056], [0.122, 0.57, -0.044], 0.05, 0.042, {
  fwd: [0.3, 0, -1],
});
S('hamstrings', [0.07, 0.852, -0.06], [0.09, 0.57, -0.044], 0.046, 0.04, {
  fwd: [-0.3, 0, -1],
});

// Genou, tibia, mollets (jumeaux et soléaire), jambier antérieur (non suivi), cheville, pied.
E('skin', [0.106, 0.5, 0.026], [0.05, 0.048, 0.044]);
E('skin', [0.106, 0.505, 0.062], [0.026, 0.03, 0.014]);
C('skin', [0.106, 0.48, 0.004], [0.1, 0.09, -0.006], 0.052, 0.032);
S('calves', [0.078, 0.465, -0.032], [0.09, 0.27, -0.04], 0.044, 0.042, {
  fwd: [-0.45, 0, -1],
});
S('calves', [0.134, 0.465, -0.024], [0.125, 0.295, -0.034], 0.04, 0.038, {
  fwd: [0.55, 0, -1],
});
S('calves', [0.1, 0.33, -0.026], [0.1, 0.13, -0.02], 0.046, 0.03, {
  fwd: [0, 0, -1],
});
S('other', [0.122, 0.462, 0.034], [0.108, 0.16, 0.03], 0.026, 0.022, {
  fwd: [0.3, 0, 1],
});
E('skin', [0.1, 0.085, -0.01], [0.034, 0.034, 0.034]);
S('skin', [0.1, 0.045, -0.045], [0.11, 0.03, 0.135], 0.043, 0.03, {
  fwd: [0, 1, 0],
});

export const PRIMS: Prim[] = out;

/** Largeur des raccords entre volumes (union adoucie). */
export const BLEND = 0.024;

/** Distance signée approchée d'un point à un volume (négative dedans). */
export function primDist(p: Prim, x: number, y: number, z: number): number {
  if (p.kind === 1) {
    // Cône arrondi (formule d'Inigo Quilez).
    const ba: V3 = sub(p.b, p.a);
    const pa: V3 = [x - p.a[0], y - p.a[1], z - p.a[2]];
    const l2 = dot(ba, ba);
    const rr = p.r1 - p.r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const yy = dot(pa, ba);
    const zz = yy - l2;
    const xv: V3 = [pa[0] * l2 - ba[0] * yy, pa[1] * l2 - ba[1] * yy, pa[2] * l2 - ba[2] * yy];
    const x2 = dot(xv, xv);
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - p.r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - p.r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - p.r1;
  }
  // Ellipsoïde dans ses axes (approximation de Quilez, bonne près de la surface).
  const dx = x - p.c[0];
  const dy = y - p.c[1];
  const dz = z - p.c[2];
  const lx = (dx * p.m[0][0] + dy * p.m[0][1] + dz * p.m[0][2]) / p.r[0];
  const ly = (dx * p.m[1][0] + dy * p.m[1][1] + dz * p.m[1][2]) / p.r[1];
  const lz = (dx * p.m[2][0] + dy * p.m[2][1] + dz * p.m[2][2]) / p.r[2];
  const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const k1 = Math.sqrt((lx / p.r[0]) ** 2 + (ly / p.r[1]) ** 2 + (lz / p.r[2]) ** 2);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(p.r[0], p.r[1], p.r[2]);
}

/** La peau : union adoucie de tous les volumes. */
export function bodyDist(x: number, y: number, z: number): number {
  let d = Infinity;
  for (const p of PRIMS) {
    const e = primDist(p, x, y, z);
    if (d === Infinity) d = e;
    else {
      const h = Math.max(BLEND - Math.abs(d - e), 0) / BLEND;
      d = Math.min(d, e) - h * h * BLEND * 0.25;
    }
  }
  return d;
}

/** Le volume le plus proche d'un point de la surface : sa partie (index dans PARTS). */
export function partAt(x: number, y: number, z: number): number {
  let best = Infinity;
  let part = 0;
  for (const p of PRIMS) {
    const e = primDist(p, x, y, z);
    if (e < best) {
      best = e;
      part = p.part;
    }
  }
  return part;
}
