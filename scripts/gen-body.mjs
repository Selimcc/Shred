// Fabrique le maillage du corps en 3D (src/assets/body3d.bin) à partir de la silhouette de
// src/lib/body3d/figure.ts : « surface nets » sur une grille de distances signées, sommets ramenés sur la surface,
// normales et occlusion ambiante calculées sur la même distance. À relancer après avoir changé la silhouette :
//   node scripts/gen-body.mjs
import { build } from 'esbuild';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STEP = Number(process.argv[2] ?? 0.0085);
/** Part des triangles gardés après simplification (les zones plates en perdent le plus). */
const KEEP = Number(process.argv[3] ?? 0.22);
const OUT = new URL('../src/assets/body3d.bin', import.meta.url).pathname;

const dir = mkdtempSync(join(tmpdir(), 'shred-body-'));
await build({
  entryPoints: ['src/lib/body3d/figure.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'f.mjs'),
  logLevel: 'error',
});
const { PRIMS, primDist, BLEND } = await import(pathToFileURL(join(dir, 'f.mjs')).href);

// Pour aller vite : chaque volume a une sphère englobante, on saute ceux qui sont trop loin pour compter.
const bound = PRIMS.map((p) => {
  if (p.kind === 1) {
    const c = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    const h = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2;
    return { c, r: h + Math.max(p.r1, p.r2) };
  }
  return { c: p.c, r: Math.max(...p.r) };
});

function dist(x, y, z) {
  let d = Infinity;
  for (let i = 0; i < PRIMS.length; i++) {
    const b = bound[i];
    const lower = Math.hypot(x - b.c[0], y - b.c[1], z - b.c[2]) - b.r;
    if (lower > d + BLEND) continue;
    const e = primDist(PRIMS[i], x, y, z);
    if (d === Infinity) d = e;
    else {
      const h = Math.max(BLEND - Math.abs(d - e), 0) / BLEND;
      d = Math.min(d, e) - h * h * BLEND * 0.25;
    }
  }
  return d;
}

function grad(x, y, z, h = 0.0006) {
  const gx = dist(x + h, y, z) - dist(x - h, y, z);
  const gy = dist(x, y + h, z) - dist(x, y - h, z);
  const gz = dist(x, y, z + h) - dist(x, y, z - h);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l, l / (2 * h)];
}

/* ---------- Grille ---------- */
const MIN = [-0.36, -0.01, -0.19];
const MAX = [0.36, 1.81, 0.2];
const nx = Math.ceil((MAX[0] - MIN[0]) / STEP) + 1;
const ny = Math.ceil((MAX[1] - MIN[1]) / STEP) + 1;
const nz = Math.ceil((MAX[2] - MIN[2]) / STEP) + 1;
const t0 = Date.now();
const f = new Float32Array(nx * ny * nz);
const at = (i, j, k) => i + nx * (j + ny * k);
for (let k = 0; k < nz; k++)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[at(i, j, k)] = dist(MIN[0] + i * STEP, MIN[1] + j * STEP, MIN[2] + k * STEP);
console.log(`grille ${nx}×${ny}×${nz} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

/* ---------- Surface nets : un sommet par cellule traversée ---------- */
const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
const cell = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
const pos = [];
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
for (let k = 0; k < nz - 1; k++)
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const v = CORNERS.map(([a, b, c]) => f[at(i + a, j + b, k + c)]);
      let inside = 0;
      for (const x of v) if (x < 0) inside++;
      if (inside === 0 || inside === 8) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let n = 0;
      for (const [a, b] of EDGES) {
        if (v[a] < 0 === v[b] < 0) continue;
        const t = v[a] / (v[a] - v[b]);
        const A = CORNERS[a];
        const B = CORNERS[b];
        sx += A[0] + (B[0] - A[0]) * t;
        sy += A[1] + (B[1] - A[1]) * t;
        sz += A[2] + (B[2] - A[2]) * t;
        n++;
      }
      cellVert[cell(i, j, k)] = pos.length / 3;
      pos.push(MIN[0] + (i + sx / n) * STEP, MIN[1] + (j + sy / n) * STEP, MIN[2] + (k + sz / n) * STEP);
    }

const tris = [];
const quad = (a, b, c, d) => {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  tris.push(a, b, c, a, c, d);
};
for (let k = 1; k < nz - 1; k++)
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const s0 = f[at(i, j, k)] < 0;
      // Arête vers +x : les quatre cellules autour (j-1..j, k-1..k).
      if (s0 !== f[at(i + 1, j, k)] < 0)
        quad(cellVert[cell(i, j - 1, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i, j - 1, k)]);
      if (s0 !== f[at(i, j + 1, k)] < 0)
        quad(cellVert[cell(i - 1, j, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)]);
      if (s0 !== f[at(i, j, k + 1)] < 0)
        quad(cellVert[cell(i - 1, j - 1, k)], cellVert[cell(i, j - 1, k)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)]);
    }

/* ---------- Sommets sur la surface, normales, occlusion ---------- */
const V = pos.length / 3;
const nrm = new Float32Array(V * 3);
const ao = new Float32Array(V);
for (let v = 0; v < V; v++) {
  let x = pos[v * 3];
  let y = pos[v * 3 + 1];
  let z = pos[v * 3 + 2];
  for (let it = 0; it < 3; it++) {
    const d = dist(x, y, z);
    const [gx, gy, gz, gl] = grad(x, y, z);
    const s = d / Math.max(gl, 0.2);
    x -= gx * s;
    y -= gy * s;
    z -= gz * s;
  }
  pos[v * 3] = x;
  pos[v * 3 + 1] = y;
  pos[v * 3 + 2] = z;
  const [gx, gy, gz] = grad(x, y, z);
  nrm.set([gx, gy, gz], v * 3);
  // Occlusion : à quel point le volume revient vite quand on s'éloigne le long de la normale.
  let occ = 0;
  for (let i = 1; i <= 6; i++) {
    const h = 0.007 * i;
    occ += (h - dist(x + gx * h, y + gy * h, z + gz * h)) * Math.pow(0.82, i);
  }
  ao[v] = Math.max(0, Math.min(1, 1 - occ * 7.5));
}

// Triangles tournés vers l'extérieur : on compare leur normale à celle de la surface.
for (let t = 0; t < tris.length; t += 3) {
  const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
  const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
  const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const s =
    n[0] * (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) +
    n[1] * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) +
    n[2] * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]);
  if (s < 0) {
    tris[t + 1] = c;
    tris[t + 2] = b;
  }
}

/* ---------- Simplification ---------- */
// Les sommets restent ceux de la surface exacte : la simplification ne fait que fusionner des arêtes. Les normales
// pèsent dans le choix, pour garder les creux entre muscles.
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;
const full = new Uint32Array(tris);
const target = Math.round((full.length * KEEP) / 3) * 3;
const [kept] = MeshoptSimplifier.simplifyWithAttributes(full, new Float32Array(pos), 3, nrm, 3, [0.35, 0.35, 0.35], null, target, 0.0012, []);
const [remap, unique] = MeshoptSimplifier.compactMesh(kept);
const posC = new Float32Array(unique * 3);
const nrmC = new Float32Array(unique * 3);
const aoC = new Float32Array(unique);
for (let v = 0; v < remap.length; v++) {
  const n = remap[v];
  if (n === 0xffffffff || n >= unique) continue;
  posC.set(pos.slice(v * 3, v * 3 + 3), n * 3);
  nrmC.set(nrm.subarray(v * 3, v * 3 + 3), n * 3);
  aoC[n] = ao[v];
}
console.log(`simplifié : ${full.length / 3} → ${kept.length / 3} triangles, ${V} → ${unique} sommets`);
pos.length = 0;
pos.push(...posC);
nrm.set(nrmC);
ao.set(aoC);
tris.length = 0;
for (const i of kept) tris.push(i);
const VC = unique;

/* ---------- Fichier ---------- */
// En-tête : « SHB1 », nombre de sommets, d'indices, boîte englobante (min, max). Puis positions sur 16 bits dans la
// boîte, normales sur 8 bits (la 4e composante porte l'occlusion), indices sur 16 ou 32 bits.
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < VC; v++)
  for (let c = 0; c < 3; c++) {
    lo[c] = Math.min(lo[c], pos[v * 3 + c]);
    hi[c] = Math.max(hi[c], pos[v * 3 + c]);
  }
const wide = VC > 65535;
const head = 4 + 4 + 4 + 24;
const size = head + VC * 6 + VC * 4 + tris.length * (wide ? 4 : 2);
const buf = new ArrayBuffer(size + ((4 - (size % 4)) % 4));
const dv = new DataView(buf);
[83, 72, 66, 49].forEach((b, i) => dv.setUint8(i, b));
dv.setUint32(4, VC, true);
dv.setUint32(8, tris.length, true);
[...lo, ...hi].forEach((x, i) => dv.setFloat32(12 + i * 4, x, true));
let o = head;
for (let v = 0; v < VC; v++) for (let c = 0; c < 3; c++, o += 2) dv.setUint16(o, Math.round(((pos[v * 3 + c] - lo[c]) / (hi[c] - lo[c])) * 65535), true);
for (let v = 0; v < VC; v++) {
  for (let c = 0; c < 3; c++, o++) dv.setInt8(o, Math.round(nrm[v * 3 + c] * 127));
  dv.setInt8(o++, Math.round(ao[v] * 127));
}
for (const t of tris) {
  if (wide) dv.setUint32(o, t, true);
  else dv.setUint16(o, t, true);
  o += wide ? 4 : 2;
}
writeFileSync(OUT, new Uint8Array(buf));
console.log(`${VC} sommets, ${tris.length / 3} triangles, ${(buf.byteLength / 1024).toFixed(0)} Ko → ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
