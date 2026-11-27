// Le corps en 3D : on le fait tourner au doigt, on touche un muscle pour voir où il en est. Chargé à la demande
// (le maillage et le rendu ne servent qu'ici) ; sans WebGL 2, l'écran garde la silhouette 2D.
// Avec une forme (ton corps estimé), les sommets sont poussés selon tes muscles et ton gras, et le passage d'une
// forme à l'autre se fait en douceur.
import { useEffect, useRef, useState } from 'react';
import meshUrl from '../assets/body3d.bin?url';
import { type Part, partAt, PARTS } from '../lib/body3d/figure';
import { morph, morphWeights, type MorphWeights } from '../lib/body3d/morph';
import { type BodyShape, mixShape, NEUTRAL } from '../lib/body3d/shape';
import { BodyViewer, type BodyMesh, parseMesh } from '../lib/body3d/viewer';
import { reducedMotion } from '../lib/motion';
import { tr } from '../../shared/i18n';

let meshOnce: Promise<BodyMesh> | null = null;
let weightsOnce: MorphWeights | null = null;
const loadMesh = () =>
  (meshOnce ??= fetch(meshUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then(parseMesh)
    .catch((e) => {
      meshOnce = null;
      throw e;
    }));

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/** Trois quarts face : on voit tout de suite que c'est en volume. */
const REST_YAW = -0.38;

export default function Body3D({
  colors,
  labelOf,
  onFail,
  shape,
  lines = 0.75,
  line = '#120f0e',
  glow,
  label: ariaLabel,
}: {
  /** Couleur de chaque partie, en #rrggbb. */
  colors: Record<Part, string>;
  /** Ce qu'on affiche quand on touche une partie, ou null pour rien. */
  labelOf: (part: Part) => string | null;
  onFail: () => void;
  /** Forme du corps (ton corps estimé) ; sans forme, le corps de départ. */
  shape?: BodyShape;
  /** Netteté des séparations entre muscles, de 0 à 1. */
  lines?: number;
  /** Couleur des séparations. */
  line?: string;
  /** Éclat des parties à faire ressortir (0 à 1) : elles s'éclairent elles-mêmes au lieu de plonger dans l'ombre. */
  glow?: Partial<Record<Part, number>>;
  /** Ce que lit un lecteur d'écran. */
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<BodyViewer | null>(null);
  const mesh = useRef<BodyMesh | null>(null);
  const anim = useRef(0);
  const morphing = useRef(0);
  const current = useRef<BodyShape | null>(null);
  const [ready, setReady] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const palette = PARTS.map((p) => rgb(colors[p]));
  const shine = PARTS.map((p) => glow?.[p] ?? 0);
  const key = [...palette.flat(), ...shine].join(',');
  const shapeKey = shape ? [...shape.muscle, shape.fat, shape.female].map((v) => v.toFixed(4)).join(',') : '';

  useEffect(() => {
    let alive = true;
    let v: BodyViewer | null = null;
    let ro: ResizeObserver | null = null;
    loadMesh()
      .then((m) => {
        if (!alive || !canvas.current) return;
        mesh.current = m;
        v = new BodyViewer(canvas.current, m);
        viewer.current = v;
        v.yaw = reducedMotion() ? REST_YAW : REST_YAW - 0.55;
        setReady(true);
        ro = new ResizeObserver(() => v?.draw());
        ro.observe(canvas.current);
        if (!reducedMotion()) turnTo(REST_YAW, 900);
      })
      .catch(() => alive && onFail());
    return () => {
      alive = false;
      cancelAnimationFrame(anim.current);
      cancelAnimationFrame(morphing.current);
      ro?.disconnect();
      v?.dispose();
      viewer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.lines = lines;
    v.setPalette(palette, rgb(line), shine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, lines, line]);

  // Nouvelle forme : on passe de l'ancienne à la nouvelle en 0,7 s ; la première fois, depuis le corps de départ,
  // une fois le corps affiché (le calcul des poids prend un instant). Tout de suite si les animations sont coupées.
  useEffect(() => {
    const v = viewer.current;
    const m = mesh.current;
    if (!v || !m || !shape) return;
    let live = true;
    const run = () => {
      if (!live) return;
      weightsOnce ??= morphWeights(m);
      const wt = weightsOnce;
      const apply = (sh: BodyShape) => {
        current.current = sh;
        v.setGeometry(morph(wt, sh, m.indices));
      };
      const from = current.current ?? NEUTRAL;
      cancelAnimationFrame(morphing.current);
      if (reducedMotion()) return apply(shape);
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 700);
        apply(mixShape(from, shape, 1 - Math.pow(1 - t, 3)));
        if (t < 1 && live) morphing.current = requestAnimationFrame(step);
      };
      morphing.current = requestAnimationFrame(step);
    };
    const wait = weightsOnce ? 0 : window.setTimeout(run, 80);
    if (!wait) run();
    return () => {
      live = false;
      clearTimeout(wait);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, ready]);

  /** Tourne jusqu'à un angle (par le plus court chemin), en ralentissant à la fin. */
  function turnTo(target: number, ms = 600) {
    const v = viewer.current;
    if (!v) return;
    cancelAnimationFrame(anim.current);
    const from = v.yaw;
    let to = target;
    while (to - from > Math.PI) to -= 2 * Math.PI;
    while (from - to > Math.PI) to += 2 * Math.PI;
    if (reducedMotion()) {
      v.yaw = to;
      v.draw();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      v.yaw = from + (to - from) * (1 - Math.pow(1 - t, 3));
      v.render();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }

  // Glisser pour tourner (avec un peu d'élan au lâcher), toucher pour nommer le muscle.
  const drag = useRef<{
    x: number;
    y: number;
    moved: number;
    vx: number;
    t: number;
  } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    cancelAnimationFrame(anim.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      moved: 0,
      vx: 0,
      t: performance.now(),
    };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const v = viewer.current;
    if (!d || !v) return;
    const dx = e.clientX - d.x;
    const now = performance.now();
    d.moved += Math.abs(dx) + Math.abs(e.clientY - d.y);
    d.vx = (dx * 0.011) / Math.max(8, now - d.t);
    d.x = e.clientX;
    d.y = e.clientY;
    d.t = now;
    v.yaw += dx * 0.011;
    v.draw();
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const v = viewer.current;
    drag.current = null;
    if (!d || !v) return;
    if (d.moved < 8) {
      const r = e.currentTarget.getBoundingClientRect();
      const hit = v.pick(e.clientX - r.left, e.clientY - r.top);
      setLabel(hit ? labelOf(PARTS[partAt(hit[0], hit[1], hit[2])]) : null);
      return;
    }
    if (reducedMotion() || Math.abs(d.vx) < 0.0004) return;
    let vx = d.vx;
    let last = performance.now();
    const coast = (now: number) => {
      const dt = now - last;
      last = now;
      v.yaw += vx * dt;
      vx *= Math.pow(0.93, dt / 16);
      v.render();
      if (Math.abs(vx) > 0.00008) anim.current = requestAnimationFrame(coast);
    };
    anim.current = requestAnimationFrame(coast);
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="body3d">
        <canvas
          ref={canvas}
          className={ready ? 'on' : ''}
          // Glisser de côté fait tourner le corps ; vers le bas, la page défile au lieu de fermer la feuille.
          data-no-drag
          role="img"
          aria-label={ariaLabel ?? tr('Tes muscles en 3D. Glisse pour faire tourner, touche un muscle pour voir où il en est.')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (drag.current = null)}
        />
        {label && (
          <div className="body3d-label" role="status">
            {label}
          </div>
        )}
      </div>
      <div className="body3d-bar">
        <button type="button" className="chip" onClick={() => turnTo(0)}>
          {tr('Face')}
        </button>
        <button type="button" className="chip" onClick={() => turnTo(Math.PI)}>
          {tr('Dos')}
        </button>
        <span className="small faint">{tr('Glisse pour tourner')}</span>
      </div>
    </div>
  );
}
