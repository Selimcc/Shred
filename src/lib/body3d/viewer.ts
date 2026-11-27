// Affichage du corps en 3D avec WebGL 2, sans bibliothèque : un maillage, une lumière de studio, et dans le
// fragment shader, pour chaque point, le muscle le plus proche (sa couleur) et la distance au muscle voisin (les
// lignes de séparation). On ne redessine que quand quelque chose bouge.
import { PRIMS, type Prim } from './figure';

export interface BodyMesh {
  count: number;
  indices: Uint16Array | Uint32Array;
  positions: Uint16Array;
  normals: Int8Array;
  lo: [number, number, number];
  hi: [number, number, number];
}

/** Lit le fichier fabriqué par scripts/gen-body.mjs. */
export function parseMesh(buf: ArrayBuffer): BodyMesh {
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x53484231) throw new Error('body3d: format inconnu');
  const v = dv.getUint32(4, true);
  const n = dv.getUint32(8, true);
  const box = Array.from({ length: 6 }, (_, i) => dv.getFloat32(12 + i * 4, true));
  let o = 36;
  const positions = new Uint16Array(buf, o, v * 3);
  o += v * 6;
  const normals = new Int8Array(buf, o, v * 4);
  o += v * 4;
  const indices = v > 65535 ? new Uint32Array(buf.slice(o, o + n * 4)) : new Uint16Array(buf.slice(o, o + n * 2));
  return {
    count: n,
    indices,
    positions,
    normals,
    lo: [box[0], box[1], box[2]],
    hi: [box[3], box[4], box[5]],
  };
}

const VS = `#version 300 es
in vec3 aPos;
in vec4 aNrm;
uniform mat4 uProj;
uniform mat3 uRot;
uniform vec3 uLo;
uniform vec3 uHi;
uniform float uLift;
out vec3 vModel;
out vec3 vNormal;
out float vAo;
void main() {
  vec3 p = mix(uLo, uHi, aPos);
  vModel = p;
  vNormal = uRot * aNrm.xyz;
  vAo = aNrm.w;
  vec3 w = uRot * (p - vec3(0.0, uLift, 0.0));
  gl_Position = uProj * vec4(w, 1.0);
}`;

// Volumes : 5 texels par volume. Ellipsoïde : centre + type, demi-axes + partie, axe x + groupe, axe y + rayon
// englobant, axe z. Cône : a + type, b + partie, (r1, r2) + groupe, rayon englobant.
const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec3 vModel;
in vec3 vNormal;
in float vAo;
uniform sampler2D uPrims;
uniform int uCount;
uniform vec3 uColors[20];
uniform vec3 uLineColor;
out vec4 outColor;

float ellipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}
float roundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec3 p = vModel;
  float d1 = 1e9;
  float d2 = 1e9;
  int part = 0;
  float g1 = -1.0;
  for (int i = 0; i < 160; i++) {
    if (i >= uCount) break;
    vec4 t0 = texelFetch(uPrims, ivec2(0, i), 0);
    vec4 t1 = texelFetch(uPrims, ivec2(1, i), 0);
    vec4 t2 = texelFetch(uPrims, ivec2(2, i), 0);
    vec4 t3 = texelFetch(uPrims, ivec2(3, i), 0);
    // Trop loin pour être le plus proche ou le voisin : on passe.
    vec3 center = t0.w < 0.5 ? t0.xyz : (t0.xyz + t1.xyz) * 0.5;
    if (length(p - center) - t3.w > d2) continue;
    float d;
    if (t0.w < 0.5) {
      vec4 t4 = texelFetch(uPrims, ivec2(4, i), 0);
      vec3 q = p - t0.xyz;
      d = ellipsoid(vec3(dot(q, t2.xyz), dot(q, t3.xyz), dot(q, t4.xyz)), t1.xyz);
    } else {
      d = roundCone(p, t0.xyz, t1.xyz, t2.x, t2.y);
    }
    float g = t2.w;
    if (d < d1) {
      // L'ancien plus proche devient le voisin s'il est d'un autre groupe.
      if (g1 != g && !(g1 == 0.0 && g == 0.0)) d2 = d1;
      d1 = d;
      part = int(t1.w + 0.5);
      g1 = g;
    } else if (d < d2 && g != g1 && !(g == 0.0 && g1 == 0.0)) {
      d2 = d;
    }
  }

  vec3 base = toLinear(uColors[part]);
  // Séparation entre deux muscles : une ligne fine, de largeur constante à l'écran.
  float gap = d2 - d1;
  // Largeur bornée : la dérivée saute là où le muscle voisin change, ce qui ferait des points noirs.
  float w = clamp(fwidth(gap) * 1.2, 0.0004, 0.0022) + 0.0004;
  float line = 1.0 - smoothstep(0.0, w, gap);
  base = mix(base, toLinear(uLineColor), line * 0.75);

  vec3 n = normalize(vNormal);
  vec3 v = vec3(0.0, 0.0, 1.0);
  vec3 key = normalize(vec3(-0.55, 0.7, 0.75));
  vec3 fill = normalize(vec3(0.75, 0.15, 0.45));
  vec3 rimDir = normalize(vec3(0.2, 0.35, -1.0));
  float diff = 0.72 * max(dot(n, key), 0.0) + 0.2 * max(dot(n, fill), 0.0) + 0.16;
  float ao = mix(0.35, 1.0, clamp(vAo, 0.0, 1.0));
  float spec = pow(max(dot(n, normalize(key + v)), 0.0), 36.0) * 0.08;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * (0.25 + 0.5 * max(dot(n, rimDir), 0.0));
  vec3 col = base * diff * ao + vec3(spec) + vec3(1.0, 0.9, 0.78) * rim * 0.16 * ao;
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
  return sh;
}

function primTexels(list: Prim[]): Float32Array {
  const data = new Float32Array(list.length * 5 * 4);
  list.forEach((p, i) => {
    const o = i * 20;
    if (p.kind === 0) {
      data.set([...p.c, 0, ...p.r, p.part, ...p.m[0], p.group, ...p.m[1], Math.max(...p.r) + 0.002, ...p.m[2], 0], o);
    } else {
      const half = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2;
      data.set([...p.a, 1, ...p.b, p.part, p.r1, p.r2, 0, p.group, 0, 0, 0, half + Math.max(p.r1, p.r2) + 0.002, 0, 0, 0, 0], o);
    }
  });
  return data;
}

/** Couleurs sRGB 0–1, une par partie (dans l'ordre de PARTS). */
export type Palette = [number, number, number][];

export class BodyViewer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private mesh: BodyMesh;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private colors = new Float32Array(20 * 3);
  private line = new Float32Array([0.08, 0.07, 0.06]);
  yaw = 0;
  pitch = 0;
  private frame = 0;
  private lost = false;

  constructor(
    private canvas: HTMLCanvasElement,
    mesh: BodyMesh,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.mesh = mesh;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aNrm');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    for (const u of ['uProj', 'uRot', 'uLo', 'uHi', 'uLift', 'uPrims', 'uCount', 'uColors', 'uLineColor']) this.loc[u] = gl.getUniformLocation(prog, u);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 0, 0);
    const nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.BYTE, true, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 5, PRIMS.length, 0, gl.RGBA, gl.FLOAT, primTexels(PRIMS));

    gl.useProgram(prog);
    gl.uniform1i(this.loc.uPrims, 0);
    gl.uniform1i(this.loc.uCount, PRIMS.length);
    gl.uniform3fv(this.loc.uLo, mesh.lo);
    gl.uniform3fv(this.loc.uHi, mesh.hi);
    gl.uniform1f(this.loc.uLift, 0.9);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    canvas.addEventListener('webglcontextlost', this.onLost);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  setPalette(p: Palette, line: [number, number, number]) {
    p.forEach((c, i) => this.colors.set(c, i * 3));
    this.line.set(line);
    this.draw();
  }

  /** Redessine à la prochaine image (une seule fois même si on le demande plusieurs fois). */
  draw() {
    if (this.frame || this.lost) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private matrices() {
    const { canvas } = this;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const fov = (24 * Math.PI) / 180;
    const f = 1 / Math.tan(fov / 2);
    const near = 2.5;
    const far = 7;
    const dist = 4.55;
    // Perspective et caméra en (0, 0, dist) qui regarde le centre du corps, en une matrice (colonnes).
    const A = (far + near) / (near - far);
    const B = (2 * far * near) / (near - far);
    const proj = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, A, -1, 0, 0, B - A * dist, dist]);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    // Rotation autour de y (le corps tourne sur lui-même), puis légère inclinaison autour de x. Colonnes.
    const rot = new Float32Array([cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
    return { proj, rot };
  }

  render() {
    const { gl, canvas } = this;
    if (this.lost) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    const { proj, rot } = this.matrices();
    gl.uniformMatrix4fv(this.loc.uProj, false, proj);
    gl.uniformMatrix3fv(this.loc.uRot, false, rot);
    gl.uniform3fv(this.loc.uColors, this.colors);
    gl.uniform3fv(this.loc.uLineColor, this.line);
    gl.drawElements(gl.TRIANGLES, this.mesh.count, this.mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  }

  /** Le point du corps sous un point de l'écran (coordonnées CSS dans le canvas), dans le repère du corps. */
  pick(px: number, py: number): [number, number, number] | null {
    const { canvas, mesh } = this;
    const { proj, rot } = this.matrices();
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const nx = (px / canvas.clientWidth) * 2 - 1;
    const ny = 1 - (py / canvas.clientHeight) * 2;
    const dist = proj[15];
    // Rayon dans le repère de la caméra, puis dans celui du corps (rotation inverse = transposée).
    const dirCam = [(nx * aspect) / proj[5], ny / proj[5], -1];
    const toBody = (v: number[]) => [
      rot[0] * v[0] + rot[1] * v[1] + rot[2] * v[2],
      rot[3] * v[0] + rot[4] * v[1] + rot[5] * v[2],
      rot[6] * v[0] + rot[7] * v[1] + rot[8] * v[2],
    ];
    const o = toBody([0, 0, dist]);
    const d = toBody(dirCam);
    o[1] += 0.9;
    let best = Infinity;
    const P = (i: number, c: number) => mesh.lo[c] + (mesh.positions[i * 3 + c] / 65535) * (mesh.hi[c] - mesh.lo[c]);
    const idx = mesh.indices;
    for (let t = 0; t < mesh.count; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const ax = P(a, 0);
      const ay = P(a, 1);
      const az = P(a, 2);
      const e1 = [P(b, 0) - ax, P(b, 1) - ay, P(b, 2) - az];
      const e2 = [P(c, 0) - ax, P(c, 1) - ay, P(c, 2) - az];
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tv = [o[0] - ax, o[1] - ay, o[2] - az];
      const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
      if (u < 0 || u > 1) continue;
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
      if (v < 0 || u + v > 1) continue;
      const dt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
      if (dt > 0 && dt < best) best = dt;
    }
    return best === Infinity ? null : [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
