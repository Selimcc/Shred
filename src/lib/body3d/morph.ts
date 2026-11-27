// Le corps qui change de forme : chaque sommet de la peau sait à quel muscle il appartient (et à quel point il est
// au milieu du muscle, là où il bombe) et combien de gras s'y dépose. Une forme (muscles plus ou moins développés,
// plus ou moins de gras) pousse chaque sommet le long de sa normale. Le maillage reste le même : seule la position
// des sommets bouge, la couleur et les séparations restent calculées sur le corps de départ.
import { PARTS, PRIMS, primDist, type Part } from './figure';
import { type BodyShape, CHANNELS, type Channel } from './shape';
import type { BodyMesh } from './viewer';

const CHANNEL_OF: Partial<Record<Part, Channel>> = {
  chest: 'chest',
  delts: 'delts',
  reardelts: 'delts',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  lats: 'back',
  lowerback: 'back',
  traps: 'traps',
  neck: 'traps',
  quads: 'quads',
  glutes: 'posterior',
  hamstrings: 'posterior',
  calves: 'calves',
};

/** Les muscles non suivis grossissent avec leurs voisins : adducteurs avec les cuisses, jambier avec les mollets. */
const OTHER_CHANNEL = (y: number): Channel => (y > 0.5 ? 'quads' : 'calves');

export interface MorphWeights {
  /** 8 poids par sommet (un par zone). */
  muscle: Float32Array;
  /**
   * Chemin de chaque sommet jusqu'à la peau lissée (3 nombres par sommet) : le gras comble les creux (entre les
   * abdos, sous les pecs) avant de faire du volume.
   */
  hollow: Float32Array;
  /** Part de ce chemin que fait chaque sommet quand le gras est au maximum. */
  reach: Float32Array;
  /** Normales de la peau lissée : le gras pousse dans ce sens, sans plier la peau au fond des creux. */
  outward: Float32Array;
  fatM: Float32Array;
  fatF: Float32Array;
  /** Forme féminine : déplacement relatif (−1 à 1) par sommet. */
  fem: Float32Array;
  rest: Float32Array;
  normals: Float32Array;
  ao: Float32Array;
  /** Normales des faces du corps de départ, moyennées par sommet : on n'ajoute que leur changement. */
  faceRest: Float32Array;
  /** Sens des triangles (1 ou −1) pour que les normales des faces pointent vers l'extérieur. */
  sign: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number) => Math.exp(-x * x);

/** Position du sommet le long des fibres d'un volume (0 au milieu, 1 aux extrémités). */
function along(p: (typeof PRIMS)[number], x: number, y: number, z: number): number {
  if (p.kind === 1) return 0;
  const dx = x - p.c[0];
  const dy = y - p.c[1];
  const dz = z - p.c[2];
  const ly = (dx * p.m[1][0] + dy * p.m[1][1] + dz * p.m[1][2]) / p.r[1];
  return Math.min(1, Math.abs(ly));
}

/** Les poids de chaque sommet. Une vingtaine de millisecondes, une seule fois. */
export function morphWeights(mesh: BodyMesh): MorphWeights {
  const n = mesh.positions.length / 3;
  const rest = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      rest[i * 3 + c] = mesh.lo[c] + (mesh.positions[i * 3 + c] / 65535) * (mesh.hi[c] - mesh.lo[c]);
      normals[i * 3 + c] = mesh.normals[i * 4 + c] / 127;
    }
    ao[i] = mesh.normals[i * 4 + 3] / 127;
  }

  const muscle = new Float32Array(n * 8);
  const fatM = new Float32Array(n);
  const fatF = new Float32Array(n);
  const fem = new Float32Array(n);
  /** Devant du tronc, là où les reliefs s'effacent avec le gras (abdos, obliques, bas des pecs). */
  const soft = new Float32Array(n);
  const bound = PRIMS.map((p) => {
    if (p.kind === 1) {
      const h = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2;
      return { c: [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2], r: h + Math.max(p.r1, p.r2) };
    }
    return { c: p.c, r: Math.max(...p.r) };
  });

  for (let i = 0; i < n; i++) {
    const x = rest[i * 3];
    const y = rest[i * 3 + 1];
    const z = rest[i * 3 + 2];
    const nz = normals[i * 3 + 2];
    const ax = Math.abs(x);
    const w = new Float32Array(8);
    for (let k = 0; k < PRIMS.length; k++) {
      const b = bound[k];
      if (Math.hypot(x - b.c[0], y - b.c[1], z - b.c[2]) - b.r > 0.03) continue;
      const p = PRIMS[k];
      const d = primDist(p, x, y, z);
      const part = PARTS[p.part];
      const ch = part === 'other' ? OTHER_CHANNEL(y) : CHANNEL_OF[part];
      if (!ch) continue;
      // Près du volume, au milieu des fibres : c'est là que le muscle bombe.
      const near = 1 - smooth(0.003, 0.024, d);
      if (near <= 0) continue;
      const belly = Math.pow(Math.max(0, 1 - along(p, x, y, z) ** 2), 0.6);
      const v = near * (0.35 + 0.65 * belly);
      const c = CHANNELS.indexOf(ch);
      if (v > w[c]) w[c] = v;
    }
    // Deux muscles côte à côte se partagent la peau entre eux : pas de bourrelet à la jonction.
    const sum = w.reduce((a, b) => a + b, 0);
    for (let c = 0; c < 8; c++) muscle[i * 8 + c] = sum > 1 ? w[c] / sum : w[c];

    // Où se dépose le gras. Tronc, bras, jambes et tête se mélangent en douceur : pas de marche à la frontière.
    const armness = Math.max(smooth(0.19, 0.225, ax) * smooth(0.7, 0.76, y) * (1 - smooth(1.38, 1.46, y)), Math.min(1, w[2] * 1.3));
    const headness = smooth(1.5, 1.56, y);
    const legness = (1 - armness) * (1 - smooth(0.86, 0.94, y));
    const torsoness = Math.max(0, 1 - armness - legness - headness);
    const front = smooth(-0.25, 0.65, nz);
    const back = smooth(-0.25, 0.65, -nz);

    // Tronc. Homme : le ventre surtout, puis la taille tout autour (poignées d'amour, bas du dos), un peu la
    // poitrine. Femme : bas du ventre, hanches, poitrine.
    const belly = gauss((y - 1.0) / 0.12) * gauss(x / 0.14) * front;
    const ring = gauss((y - 1.03) / 0.1);
    const pecFat = gauss((y - 1.29) / 0.06) * gauss((ax - 0.09) / 0.07) * front;
    const dy = y - 1.25;
    const breast = gauss(dy / (dy > 0 ? 0.045 : 0.06)) * gauss((ax - 0.085) / 0.055) * front;
    const hips = gauss((y - 0.9) / 0.07) * smooth(0.08, 0.16, ax);
    const mT = 0.22 + 1.0 * belly + 0.5 * ring + 0.35 * pecFat + 0.1 * back;
    const fT = 0.24 + 0.55 * gauss((y - 0.95) / 0.1) * front + 0.45 * ring + 0.55 * hips + 0.9 * breast;
    // Bras : l'arrière, plus haut que le coude.
    const upper = smooth(1.1, 1.2, y) * (0.5 + 0.5 * back);
    const mA = 0.08 + 0.2 * upper;
    const fA = 0.1 + 0.38 * upper;
    // Jambes : haut des cuisses et hanches.
    const thigh = smooth(0.5, 0.62, y);
    const hip = gauss((y - 0.86) / 0.07);
    const mL = 0.06 + 0.2 * thigh + 0.25 * hip;
    const fL = 0.1 + 0.45 * thigh + 0.5 * hip * (0.6 + 0.4 * smooth(0.06, 0.15, ax));
    // Tête : joues et cou, pas le crâne.
    const jaw = gauss((y - 1.6) / 0.05) * (0.4 + 0.6 * front);
    fatM[i] = torsoness * mT + armness * mA + legness * mL + headness * (0.05 + 0.3 * jaw);
    fatF[i] = torsoness * fT + armness * fA + legness * fL + headness * (0.05 + 0.25 * jaw);

    soft[i] = torsoness * front * (1 - smooth(1.3, 1.38, y));

    // Silhouette féminine : poitrine, hanches plus larges, taille plus fine ; épaules, dos et cou moins larges.
    fem[i] =
      torsoness * (1.4 * breast - 0.5 * gauss((y - 1.1) / 0.06) * smooth(0.06, 0.13, ax) + 0.8 * gauss((y - 0.9) / 0.06) * smooth(0.09, 0.15, ax)) +
      legness * 0.5 * gauss((y - 0.82) / 0.08) * smooth(0.08, 0.16, ax) -
      0.4 * w[1] -
      0.3 * w[3] * smooth(0.05, 0.1, ax) -
      0.25 * w[4];
  }

  // Le sens des triangles décide du sens des normales des faces : on l'aligne sur celui des normales de la peau.
  let agree = 0;
  const probe = faceNormals(rest, mesh.indices, n, 1);
  for (let i = 0; i < n; i++) agree += probe[i * 3] * normals[i * 3] + probe[i * 3 + 1] * normals[i * 3 + 1] + probe[i * 3 + 2] * normals[i * 3 + 2];
  const sign = agree < 0 ? -1 : 1;
  // Vers la peau lissée : les creux se comblent partout ; les bosses ne s'aplatissent que sur le devant du tronc
  // (les abdos disparaissent sous le gras, pas les épaules).
  const hollow = reliefs(rest, mesh.indices, n);
  const reach = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = hollow[i * 3] * normals[i * 3] + hollow[i * 3 + 1] * normals[i * 3 + 1] + hollow[i * 3 + 2] * normals[i * 3 + 2];
    const len = Math.hypot(hollow[i * 3], hollow[i * 3 + 1], hollow[i * 3 + 2]);
    // Pas plus de 2,5 cm de chemin.
    const cap = len > 0.025 ? 0.025 / len : 1;
    reach[i] = (d > 0 ? 1 : 0.7 * soft[i]) * cap;
  }
  const smoothPos = rest.map((v, i) => v + hollow[i]);
  const outward = faceNormals(smoothPos, mesh.indices, n, sign);
  return { muscle, hollow, reach, outward, fatM, fatF, fem, rest, normals, ao, faceRest: sign < 0 ? probe.map((v) => -v) : probe, sign };
}

/**
 * Pour chaque sommet, le chemin jusqu'à la peau lissée (moyenne des voisins, plusieurs fois, sur 4 à 6 cm) : vers
 * l'extérieur dans les creux (entre les abdos, sous les pecs), vers l'intérieur sur les bosses.
 */
function reliefs(rest: Float32Array, idx: Uint16Array | Uint32Array, n: number): Float32Array {
  const next: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    for (const [a, b] of [
      [idx[t], idx[t + 1]],
      [idx[t + 1], idx[t + 2]],
      [idx[t + 2], idx[t]],
    ]) {
      if (!next[a].includes(b)) next[a].push(b);
      if (!next[b].includes(a)) next[b].push(a);
    }
  }
  let p = rest.slice();
  let q = new Float32Array(n * 3);
  for (let k = 0; k < 30; k++) {
    for (let i = 0; i < n; i++) {
      const nb = next[i];
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of nb) {
        x += p[j * 3];
        y += p[j * 3 + 1];
        z += p[j * 3 + 2];
      }
      const m = nb.length || 1;
      q[i * 3] = p[i * 3] * 0.5 + (x / m) * 0.5;
      q[i * 3 + 1] = p[i * 3 + 1] * 0.5 + (y / m) * 0.5;
      q[i * 3 + 2] = p[i * 3 + 2] * 0.5 + (z / m) * 0.5;
    }
    [p, q] = [q, p];
  }
  for (let i = 0; i < n * 3; i++) p[i] -= rest[i];
  return p;
}

/** Normales moyennes des faces autour de chaque sommet (pondérées par la surface). */
function faceNormals(pos: Float32Array, idx: Uint16Array | Uint32Array, n: number, sign: number): Float32Array {
  const out = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a];
    const e1y = pos[b + 1] - pos[a + 1];
    const e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a];
    const e2y = pos[c + 1] - pos[a + 1];
    const e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      out[v] += nx;
      out[v + 1] += ny;
      out[v + 2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = (Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) || 1) * sign;
    out[i * 3] /= l;
    out[i * 3 + 1] /= l;
    out[i * 3 + 2] /= l;
  }
  return out;
}

/** Gras à partir duquel les creux sont complètement comblés (m). */
const FILL = 0.035;

/** Épaisseur de muscle ajoutée à un sommet (m), le long de sa normale. */
function muscleOffset(wt: MorphWeights, shape: BodyShape, i: number): number {
  let d = 0;
  for (let c = 0; c < 8; c++) d += wt.muscle[i * 8 + c] * shape.muscle[c];
  return d;
}

/** Épaisseur de gras (et forme féminine) ajoutée à un sommet (m), le long de la normale de la peau lissée. */
function fatOffset(wt: MorphWeights, shape: BodyShape, i: number): number {
  const fat = shape.female ? wt.fatF[i] : wt.fatM[i];
  // Le gras ne fait pas descendre sous la peau : plus sec, on retire au plus 40 % de ce qu'on ajouterait.
  return fat * (shape.fat >= 0 ? shape.fat : shape.fat * 0.4) + wt.fem[i] * 0.03 * shape.female;
}

/** Part des reliefs effacés par le gras à ce sommet (0 à 0,85). */
function fill(wt: MorphWeights, shape: BodyShape, i: number): number {
  if (shape.fat <= 0) return 0;
  const fat = shape.female ? wt.fatF[i] : wt.fatM[i];
  return Math.min(0.85, (shape.fat / FILL) * Math.min(1, fat * 1.4));
}

/**
 * Positions et normales du corps pour une forme : chaque sommet poussé le long de sa normale, et les normales
 * corrigées du changement de pente (calculé sur les faces) pour que la lumière suive les nouvelles rondeurs.
 */
export function morph(wt: MorphWeights, shape: BodyShape, idx: Uint16Array | Uint32Array): { positions: Float32Array; normals: Float32Array } {
  const n = wt.ao.length;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const m = muscleOffset(wt, shape, i);
    const f = fatOffset(wt, shape, i);
    const k = wt.reach[i] * fill(wt, shape, i);
    for (let c = 0; c < 3; c++) positions[i * 3 + c] = wt.rest[i * 3 + c] + wt.hollow[i * 3 + c] * k + wt.normals[i * 3 + c] * m + wt.outward[i * 3 + c] * f;
  }
  const face = faceNormals(positions, idx, n, wt.sign);
  const normals = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let x = wt.normals[i * 3] + face[i * 3] - wt.faceRest[i * 3];
    let y = wt.normals[i * 3 + 1] + face[i * 3 + 1] - wt.faceRest[i * 3 + 1];
    let z = wt.normals[i * 3 + 2] + face[i * 3 + 2] - wt.faceRest[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    normals.set([x, y, z, wt.ao[i]], i * 4);
  }
  return { positions, normals };
}
