// Le corps en 3D : on le fait tourner au doigt, on touche un muscle pour voir où il en est. Chargé à la demande
// (le maillage et le rendu ne servent qu'ici) ; sans WebGL 2, l'écran garde la silhouette 2D.
import { useEffect, useRef, useState } from 'react';
import meshUrl from '../assets/body3d.bin?url';
import { type Part, partAt, PARTS } from '../lib/body3d/figure';
import { BodyViewer, type BodyMesh, parseMesh } from '../lib/body3d/viewer';
import { reducedMotion } from '../lib/motion';
import { tr } from '../../shared/i18n';

let meshOnce: Promise<BodyMesh> | null = null;
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
}: {
  /** Couleur de chaque partie, en #rrggbb. */
  colors: Record<Part, string>;
  /** Ce qu'on affiche quand on touche une partie, ou null pour rien. */
  labelOf: (part: Part) => string | null;
  onFail: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<BodyViewer | null>(null);
  const anim = useRef(0);
  const [ready, setReady] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const palette = PARTS.map((p) => rgb(colors[p]));
  const key = palette.flat().join(',');

  useEffect(() => {
    let alive = true;
    let v: BodyViewer | null = null;
    let ro: ResizeObserver | null = null;
    loadMesh()
      .then((mesh) => {
        if (!alive || !canvas.current) return;
        v = new BodyViewer(canvas.current, mesh);
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
      ro?.disconnect();
      v?.dispose();
      viewer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewer.current?.setPalette(palette, [0.07, 0.06, 0.055]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

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
          aria-label={tr('Tes muscles en 3D. Glisse pour faire tourner, touche un muscle pour voir où il en est.')}
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
