// Le décor des fêtes, en profondeur. Derrière le contenu : le ciel (étoiles, lune, soleil, bokeh), un paysage
// en silhouette au bas de l'écran (cimetière et maison hantée, sapins et chalet sous la neige, ville illuminée,
// collines fleuries), et ce qui flotte (neige, braises, cœurs, pétales, feux d'artifice). Devant, mais sous la
// barre d'onglets : quelques éléments proches (guirlande, gros flocons, chauves-souris, papillons, pétales).
// Rien de cliquable. Tout bouge en transform / opacity ; moins d'éléments sur un téléphone modeste, un peu
// plus le jour J ; figé si l'utilisateur réduit les animations, en pause sous une feuille ouverte.
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import type { SeasonId } from '../lib/season';

/** Pseudo-hasard stable : le décor ne saute pas d'un rendu à l'autre. */
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 91.7 + salt * 47.3) * 24634.6345;
  return x - Math.floor(x);
};
const css = (o: Record<string, string | number | undefined>) => o as CSSProperties;
const range = (n: number) => Array.from({ length: Math.max(0, Math.round(n)) }, (_, i) => i);

/** Combien d'éléments ce téléphone (et ce jour) mérite : 0,6 sur un appareil modeste, ×1,35 le jour J. */
function useDensity(peak: boolean): number {
  return useMemo(() => {
    let low = false;
    try {
      const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
      low = (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 3 || n.connection?.saveData === true;
    } catch {
      // Pas d'information : on garde la densité normale.
    }
    return (low ? 0.6 : 1) * (peak ? 1.35 : 1);
  }, [peak]);
}

/* ---------- Pièces communes ---------- */

function Stars({ n, top = 42, warm }: { n: number; top?: number; warm?: boolean }) {
  return (
    <div className={`sl-stars${warm ? ' warm' : ''}`}>
      {range(n).map((i) => (
        <i
          key={i}
          style={css({
            left: `${(rnd(i, 31) * 100).toFixed(2)}%`,
            top: `${(rnd(i, 32) * top).toFixed(2)}%`,
            '--s': (0.6 + rnd(i, 33) * 1.1).toFixed(2),
            animationDuration: `${(3 + rnd(i, 35) * 4).toFixed(2)}s`,
            animationDelay: `${(-rnd(i, 34) * 6).toFixed(2)}s`,
          })}
        />
      ))}
    </div>
  );
}

/**
 * Ce qui tombe (ou monte) : chaque élément part d'un point au hasard, dérive (--sway) et tourne (--spin).
 * `kind` donne la forme et le sens dans le CSS.
 */
function Drift({ kind, n, seed, dur: [d0, d1], size: [s0, s1], fade = [0.4, 0.85] }: { kind: string; n: number; seed: number; dur: [number, number]; size: [number, number]; fade?: [number, number] }) {
  return (
    <div className={`sl-drift ${kind}`}>
      {range(n).map((i) => {
        const size = s0 + rnd(i, seed + 1) * (s1 - s0);
        return (
          <i
            key={i}
            style={css({
              left: `${(rnd(i, seed + 2) * 100).toFixed(2)}%`,
              '--size': `${size.toFixed(1)}px`,
              '--o': (fade[0] + rnd(i, seed + 3) * (fade[1] - fade[0])).toFixed(2),
              '--sway': `${Math.round((rnd(i, seed + 4) - 0.5) * 90)}px`,
              '--spin': `${Math.round(120 + rnd(i, seed + 5) * 600) * (rnd(i, seed + 6) > 0.5 ? 1 : -1)}deg`,
              '--y': Math.round(rnd(i, seed + 7) * 86),
              animationDuration: `${(d0 + rnd(i, seed + 8) * (d1 - d0)).toFixed(2)}s`,
              animationDelay: `${(-rnd(i, seed + 9) * d1).toFixed(2)}s`,
            })}
          />
        );
      })}
    </div>
  );
}

/**
 * Paysage en silhouette au bas de l'écran : large dessin centré, rogné sur les côtés selon l'écran.
 * `lights` : des lumières (fenêtres, lanternes) sur deux calques calés au pixel près sur le paysage, qui
 * vacillent chacun à son rythme ; seul leur calque change d'opacité, le paysage n'est jamais redessiné.
 */
function Ground({ cls, children, lights = [] }: { cls: string; children: ReactNode; lights?: ReactNode[] }) {
  const box = { viewBox: '0 0 1200 160', preserveAspectRatio: 'xMidYMax slice', 'aria-hidden': true } as const;
  return (
    <>
      <svg className={`sl-ground ${cls}`} {...box}>
        {children}
      </svg>
      {lights.map((l, i) => (
        <svg key={i} className={`sl-ground lights l${i}`} {...box}>
          {l}
        </svg>
      ))}
    </>
  );
}

/* ---------- Halloween ---------- */

function Tombstone({ x, y, s = 1, cross }: { x: number; y: number; s?: number; cross?: boolean }) {
  return cross ? (
    <path transform={`translate(${x} ${y}) scale(${s})`} d="M-2.5-30h5v8h8v5h-8v17h-5v-17h-8v-5h8Z" />
  ) : (
    <path transform={`translate(${x} ${y}) scale(${s}) rotate(${(x % 7) - 3})`} d="M-10 0v-18c0-8 4.5-12 10-12s10 4 10 12V0Z" />
  );
}

function HalloweenBack({ k }: { k: number }) {
  return (
    <>
      <Stars n={14 * k} top={38} warm />
      <div className="sl-moon2">
        <i className="halo" />
        <i className="disc" />
        <svg className="cloud" viewBox="0 0 200 40" aria-hidden="true">
          <path d="M8 30c4-10 16-12 24-8 4-10 18-14 28-6 6-8 22-10 30 0 8-6 22-4 26 6 10-2 18 4 18 8Z" fill="#1c1224" opacity="0.85" />
        </svg>
      </div>
      <svg className="sl-web2" viewBox="0 0 150 150" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="0.8">
          {[0, 13, 26, 40, 54, 68, 81, 90].map((a) => (
            <path key={a} d={`M0 0L${(150 * Math.cos((a * Math.PI) / 180)).toFixed(1)} ${(150 * Math.sin((a * Math.PI) / 180)).toFixed(1)}`} />
          ))}
          {[20, 38, 57, 78, 100, 124].map((r, j) => {
            // Chaque tour de spirale pend un peu entre deux fils.
            const pts = [0, 13, 26, 40, 54, 68, 81, 90].map((a) => [r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180)]);
            let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
            for (let i = 1; i < pts.length; i++) {
              const [x0, y0] = pts[i - 1];
              const [x1, y1] = pts[i];
              const mx = (x0 + x1) / 2;
              const my = (y0 + y1) / 2;
              const sag = 0.1 + j * 0.012;
              d += ` Q${(mx * (1 - sag)).toFixed(1)} ${(my * (1 - sag)).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
            }
            return <path key={r} d={d} />;
          })}
        </g>
        <circle cx="54" cy="38" r="1.6" fill="#fff" opacity="0.55" />
        <circle cx="30" cy="84" r="1.2" fill="#fff" opacity="0.45" />
      </svg>
      <div className="sl-spider2">
        <i />
        <svg viewBox="0 0 28 26" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none">
            <path d="M10 11 4 5 1 8M9.5 13.5 2 12l-2 3M10 16l-6 4-1 4M18 11l6-6 3 3M18.5 13.5 26 12l2 3M18 16l6 4 1 4" />
          </g>
          <ellipse cx="14" cy="17" rx="5" ry="6" fill="currentColor" />
          <circle cx="14" cy="10.5" r="3.6" fill="currentColor" />
          <circle cx="12.6" cy="10" r="0.9" fill="#ff8a1f" />
          <circle cx="15.4" cy="10" r="0.9" fill="#ff8a1f" />
        </svg>
      </div>
      <Ground
        cls="g-halloween"
        lights={[
          <>
            <rect x="755" y="69" width="8" height="10" rx="1.5" fill="#ffd27a" />
            <path transform="translate(610 132)" d="M-7-2l3-4 3 4zM1-2l3-4 3 4zM-7 3q7 5 14 0l-2 1-2-1-3 2-3-2-2 1z" fill="#ffe7a8" />
          </>,
          <rect x="793" y="79" width="8" height="9" rx="1.5" fill="#ffd27a" />,
        ]}
      >
        <path d="M0 108c90-26 180-30 280-12s170 10 260-10 180-26 280-6 220 22 380 4v76H0Z" fill="#1f1228" />
        {/* Maison hantée au loin, deux fenêtres éclairées. */}
        <g fill="#1f1228">
          <path d="M748 100V62l-8 2 22-24 10 10V36h6v20l14 14-6-1v31Z" />
          <path d="M786 100V74l14-14 14 14v26Z" />
        </g>
        <rect x="756" y="70" width="6" height="8" rx="1" fill="#ffb347" opacity="0.7" />
        <rect x="794" y="80" width="6" height="7" rx="1" fill="#ffb347" opacity="0.7" />
        <path d="M0 130c120-22 240-24 360-8 100 12 190 10 270-6 120-24 260-18 360 0 80 14 150 14 210 4V600H0Z" fill="#140b1a" />
        {/* Arbre tordu, tombes, grille. */}
        <path
          d="M402 132c4-22 2-40-6-58-6-12-16-20-28-26 12 2 22 8 30 16-2-12-8-22-18-30 12 6 20 16 24 30 4-10 12-18 22-22-8 8-14 18-14 30 8-6 18-8 26-6-12 4-20 12-24 22 2 16 4 30 2 44Z"
          fill="#140b1a"
        />
        <g fill="#140b1a">
          <Tombstone x={470} y={134} s={1} />
          <Tombstone x={506} y={132} s={0.8} cross />
          <Tombstone x={668} y={128} s={0.9} />
          <Tombstone x={700} y={130} s={0.7} cross />
          <Tombstone x={230} y={138} s={0.8} />
          <Tombstone x={980} y={132} s={0.85} />
        </g>
        <g stroke="#140b1a" strokeWidth="2.4">
          {range(12).map((i) => (
            <path key={i} d={`M${540 + i * 9} 136v-16`} />
          ))}
          <path d="M538 124h104" />
        </g>
        {/* Citrouille posée devant, qui luit. */}
        <g transform="translate(610 132)">
          <ellipse cx="0" cy="0" rx="13" ry="10" fill="#e2620c" />
          <path d="M-4-9c-4 4-4 14 0 18M4-9c4 4 4 14 0 18" stroke="#8a3404" strokeWidth="1.2" fill="none" />
          <path d="M-1-10c0-3 1-5 3-6" stroke="#4d6b24" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M-7-2l3-4 3 4zM1-2l3-4 3 4zM-7 3q7 5 14 0l-2 1-2-1-3 2-3-2-2 1z" fill="#ffb347" />
        </g>
      </Ground>
      <div className="sl-fog2 a" />
      <div className="sl-fog2 b" />
      <Drift kind="ember" n={10 * k} seed={40} dur={[10, 18]} size={[2, 4]} fade={[0.4, 0.9]} />
    </>
  );
}

function Bat() {
  const vb = '0 0 64 30';
  return (
    <div className="bat-body">
      <svg className="bat-wing l" viewBox={vb} aria-hidden="true">
        <path d="M30 12C25 7 18 4 9 5c4 2 6 5 6 8-3-1.5-7-1.5-10 .5 4 .5 7 3 8 6 4-3 10-4 15-1.5" fill="#09060c" stroke="rgba(180,140,255,0.4)" strokeWidth="0.6" />
      </svg>
      <svg className="bat-wing r" viewBox={vb} aria-hidden="true">
        <path d="M34 12c5-5 12-8 21-7-4 2-6 5-6 8 3-1.5 7-1.5 10 .5-4 .5-7 3-8 6-4-3-10-4-15-1.5" fill="#09060c" stroke="rgba(180,140,255,0.4)" strokeWidth="0.6" />
      </svg>
      <svg viewBox={vb} aria-hidden="true">
        <ellipse cx="32" cy="14.5" rx="4.2" ry="5.4" fill="#09060c" />
        <path d="M29 10l.8-3.4 1.8 2.6M35 10l-.8-3.4-1.8 2.6" fill="#09060c" />
        <circle cx="30.6" cy="12.6" r="0.9" fill="#ff8a1f" />
        <circle cx="33.4" cy="12.6" r="0.9" fill="#ff8a1f" />
      </svg>
    </div>
  );
}

function HalloweenFront({ k }: { k: number }) {
  const n = k < 1 ? 2 : 3;
  return (
    <>
      {range(n).map((i) => (
        <div key={i} className="sl-bat2" style={css({ top: `${14 + i * 17 + rnd(i, 1) * 8}%`, animationDelay: `${3 + i * 1.3 + rnd(i, 2) * 2}s`, '--s': (0.6 + i * 0.22).toFixed(2) })}>
          <div className="bob" style={css({ animationDelay: `${-i * 0.4}s` })}>
            <Bat />
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------- Noël ---------- */

function Pine({ x, y, h }: { x: number; y: number; h: number }) {
  const w = h * 0.46;
  const tiers = [0, 0.3, 0.56];
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-h * 0.03} y={-h * 0.08} width={h * 0.06} height={h * 0.1} fill="#0b1513" />
      {tiers.map((t, i) => {
        const top = -h + t * h * 0.9;
        const bw = w * (0.62 + i * 0.2);
        const base = top + h * (0.42 + i * 0.06);
        return (
          <g key={i}>
            <path d={`M0 ${top}L${bw} ${base}H${-bw}Z`} fill="#0f2421" />
            <path d={`M0 ${top}L${bw * 0.5} ${top + (base - top) * 0.5}q${-bw * 0.25} ${h * 0.04} ${-bw * 0.5} 0 ${-bw * 0.25} ${-h * 0.04} ${-bw * 0.5} 0Z`} fill="#dfeef5" opacity="0.75" />
            <path d={`M${-bw} ${base}q${bw * 0.5} ${-h * 0.06} ${bw} 0q${bw * 0.5} ${-h * 0.06} ${bw} 0`} fill="none" stroke="#dfeef5" strokeOpacity="0.55" strokeWidth={h * 0.025} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
}

function NoelBack({ k }: { k: number }) {
  return (
    <>
      <Stars n={12 * k} top={36} />
      <div className="sl-shooting" />
      <Ground
        cls="g-noel"
        lights={[
          <rect x="741" y="81" width="14" height="13" rx="2" fill="#ffe2a0" opacity="0.9" />,
          <rect x="765" y="81" width="14" height="13" rx="2" fill="#ffe2a0" opacity="0.9" />,
        ]}
      >
        <path d="M0 104c110-22 230-26 360-8s220 10 330-8 230-22 340-2 110 12 170 8v66H0Z" fill="#16292b" />
        <path d="M0 104c110-22 230-26 360-8s220 10 330-8 230-22 340-2 110 12 170 8" fill="none" stroke="#dfeef5" strokeOpacity="0.35" strokeWidth="3" />
        {/* Chalet, fenêtre chaude, fumée. */}
        <g transform="translate(760 100)">
          <path d="M-30 0v-26h60V0Z" fill="#132224" />
          <path d="M-36-24 0-48l36 24Z" fill="#0f1d1f" />
          <path d="M-38-23 0-50l38 27-4 3L0-45-34-20Z" fill="#e6f1f6" opacity="0.85" />
          <rect x="14" y="-58" width="8" height="14" fill="#132224" />
          <rect x="-18" y="-18" width="12" height="11" rx="1.5" fill="#ffcf6b" opacity="0.75" />
          <rect x="6" y="-18" width="12" height="11" rx="1.5" fill="#ffcf6b" opacity="0.75" />
        </g>
        <path d="M0 132c140-18 270-20 400-6 120 12 230 12 330-2 130-18 280-16 380 0 40 6 70 8 90 8V600H0Z" fill="#1d3336" />
        <path d="M0 132c140-18 270-20 400-6 120 12 230 12 330-2 130-18 280-16 380 0 40 6 70 8 90 8" fill="none" stroke="#e6f1f6" strokeOpacity="0.5" strokeWidth="3.4" />
        <Pine x={420} y={136} h={70} />
        <Pine x={462} y={132} h={52} />
        <Pine x={520} y={136} h={40} />
        <Pine x={668} y={130} h={58} />
        <Pine x={850} y={134} h={64} />
        <Pine x={892} y={136} h={44} />
        <Pine x={250} y={138} h={56} />
        <Pine x={1010} y={136} h={60} />
        <Pine x={130} y={140} h={48} />
      </Ground>
      <Drift kind="snow far" n={30 * k} seed={60} dur={[18, 28]} size={[1.4, 2.6]} fade={[0.25, 0.55]} />
      <Drift kind="snow" n={20 * k} seed={70} dur={[12, 18]} size={[2.8, 4.4]} fade={[0.5, 0.85]} />
    </>
  );
}

function Garland() {
  // Un feston de fil, cinq ampoules de verre, répété sur la largeur ; trois calques de lueurs s'allument tour
  // à tour, comme une guirlande qui court.
  const bulbs = [
    [16, 10, '#ff4d5e'],
    [42, 18, '#ffd166'],
    [70, 21, '#4fd18b'],
    [98, 18, '#9fd4ff'],
    [124, 10, '#ff9ad5'],
  ] as const;
  const enc = (c: string) => c.replace('#', '%23');
  const wire = `<path d='M0 3 Q70 34 140 3' fill='none' stroke='%232c3a33' stroke-width='1.6'/>`;
  const bulb = ([x, y, c]: readonly [number, number, string], i: number) => {
    const tilt = (x - 70) / 5;
    return `<g transform='rotate(${tilt.toFixed(1)} ${x} ${y})'><rect x='${x - 1.8}' y='${y - 2.4}' width='3.6' height='3.4' rx='0.8' fill='%23687a70'/><ellipse cx='${x}' cy='${y + 4.6}' rx='3.2' ry='4.6' fill='${enc(c)}'/><ellipse cx='${x - 1}' cy='${y + 3.2}' rx='0.9' ry='1.6' fill='white' opacity='${0.55 + (i % 2) * 0.1}'/></g>`;
  };
  const glow = (pick: number[]) =>
    `<filter id='b'><feGaussianBlur stdDeviation='3.2'/></filter>` +
    bulbs
      .filter((_, i) => pick.includes(i))
      .map(([x, y, c]) => `<circle cx='${x}' cy='${y + 5}' r='7.5' fill='${enc(c)}' filter='url(%23b)'/>`)
      .join('');
  const svg = (body: string) => `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='42' viewBox='0 0 140 42'>${body}</svg>")`;
  return (
    <div className="sl-garland2" aria-hidden="true">
      <div className="g-glow a" style={{ backgroundImage: svg(glow([0, 3])) }} />
      <div className="g-glow b" style={{ backgroundImage: svg(glow([1, 4])) }} />
      <div className="g-glow c" style={{ backgroundImage: svg(glow([2])) }} />
      <div className="g-wire" style={{ backgroundImage: svg(wire + bulbs.map(bulb).join('')) }} />
    </div>
  );
}

/* ---------- Nouvel an ---------- */

function Skyline() {
  // Immeubles de hauteurs variées, et une tour à horloge au centre, presque minuit.
  const blocks: [number, number, number][] = [];
  let x = 0;
  for (let i = 0; x < 1200; i++) {
    const w = 34 + Math.round(rnd(i, 81) * 40);
    const h = 38 + Math.round(rnd(i, 82) * 70);
    if (x > 560 && x < 640) {
      x = 640;
      continue;
    }
    blocks.push([x, w, h]);
    x += w + 4;
  }
  // Chaque fenêtre allumée : posée sur la ville, ou (une sur cinq) sur l'un des deux calques qui scintillent.
  const lit: ReactNode[] = [];
  const twinkle: ReactNode[][] = [[], []];
  blocks.forEach(([bx, w, h], i) => {
    for (let r = 0; r < Math.floor(h / 14); r++) {
      for (let c = 0; c < Math.floor(w / 12); c++) {
        if (rnd(i * 31 + r * 7 + c, 83) <= 0.62) continue;
        const props = { x: bx + 5 + c * 12, y: 160 - h + 7 + r * 14, width: 5, height: 6, fill: rnd(i + c, 85) > 0.5 ? '#ffd88a' : '#f3b65a' };
        const key = `${i}-${r}-${c}`;
        if (rnd(i + r + c, 84) > 0.8) twinkle[(i + r) % 2].push(<rect key={key} {...props} />);
        else lit.push(<rect key={key} {...props} opacity={(0.45 + rnd(i * 3 + r, 86) * 0.45).toFixed(2)} />);
      }
    }
  });
  return (
    <Ground cls="g-ny" lights={twinkle.map((t) => <>{t}</>)}>
      <rect x="0" y="158" width="1200" height="442" fill="#16121f" />
      {blocks.map(([bx, w, h], i) => (
        <rect key={i} x={bx} y={160 - h} width={w} height={h} fill={i % 3 ? '#16121f' : '#1b1626'} />
      ))}
      {lit}
      <g transform="translate(600 160)">
        <path d="M-22 0v-104h44V0Z" fill="#1d1829" />
        <path d="M-26-104h52l-26-30Z" fill="#1d1829" />
        <path d="M0-134v-12" stroke="#1d1829" strokeWidth="3" />
        <circle cx="0" cy="-80" r="15" fill="#fff3c4" opacity="0.9" />
        <circle cx="0" cy="-80" r="15" fill="none" stroke="#1d1829" strokeWidth="2.4" />
        <path d="M0-80v-11M0-80l1.6-9.6" stroke="#1d1829" strokeWidth="2" strokeLinecap="round" />
      </g>
    </Ground>
  );
}

function SkyBursts({ k }: { k: number }) {
  const sites = [
    [20, 16, '#ffd166', 0],
    [78, 10, '#c9a7ff', 2.1],
    [52, 24, '#6fdcb0', 4.2],
    [88, 30, '#ff6b8b', 5.6],
  ] as const;
  const n = Math.round(18 * Math.min(1, k));
  return (
    <>
      {sites.slice(0, k < 1 ? 3 : 4).map(([x, y, c, d], s) => (
        <div key={s} className="sl-fw" style={css({ left: `${x}%`, top: `${y}%`, color: c, '--d': `${d}s` })}>
          <b className="shell" />
          <b className="flash" />
          {range(n).map((i) => (
            <i key={i} style={css({ '--a': `${((i * 360) / n + s * 9).toFixed(1)}deg`, '--r': `${(i % 3 ? 52 : 34) + s * 4}px` })} />
          ))}
        </div>
      ))}
    </>
  );
}

/* ---------- Saint-Valentin ---------- */

function Bokeh({ n }: { n: number }) {
  const colors = ['rgba(255,77,125,0.5)', 'rgba(255,143,171,0.45)', 'rgba(195,162,255,0.4)', 'rgba(255,200,150,0.35)'];
  return (
    <div className="sl-bokeh">
      {range(n).map((i) => (
        <i
          key={i}
          style={css({
            left: `${(rnd(i, 91) * 100).toFixed(1)}%`,
            top: `${(rnd(i, 92) * 80).toFixed(1)}%`,
            '--size': `${Math.round(50 + rnd(i, 93) * 90)}px`,
            '--c': colors[i % colors.length],
            '--dx': `${Math.round((rnd(i, 94) - 0.5) * 80)}px`,
            '--dy': `${Math.round((rnd(i, 95) - 0.5) * 60)}px`,
            animationDuration: `${(26 + rnd(i, 96) * 22).toFixed(1)}s`,
            animationDelay: `${(-rnd(i, 97) * 30).toFixed(1)}s`,
          })}
        />
      ))}
    </div>
  );
}

const HEART = 'M12 21s-8.5-5.4-10.6-10.3C-.1 5.8 3.5 1 7.8 1c2 0 3.4 1 4.2 2.4C12.8 2 14.2 1 16.2 1c4.3 0 7.9 4.8 6.4 9.7C20.5 15.6 12 21 12 21Z';

function Hearts({ n, near, seed }: { n: number; near?: boolean; seed: number }) {
  const colors = ['#ff4d7d', '#ff8fab', '#ffc2d1', '#e8384f'];
  return (
    <div className={`sl-hearts${near ? ' near' : ''}`}>
      {range(n).map((i) => (
        <i
          key={i}
          style={css({
            left: `${(4 + rnd(i, seed) * 92).toFixed(1)}%`,
            '--size': `${Math.round((near ? 16 : 8) + rnd(i, seed + 1) * (near ? 12 : 7))}px`,
            '--sway': `${Math.round((rnd(i, seed + 2) - 0.5) * 80)}px`,
            '--y': Math.round(rnd(i, seed + 3) * 86),
            color: colors[i % colors.length],
            animationDuration: `${((near ? 15 : 22) + rnd(i, seed + 4) * 9).toFixed(1)}s`,
            animationDelay: `${(-rnd(i, seed + 5) * 30).toFixed(1)}s`,
          })}
        >
          <svg viewBox="0 0 24 22" aria-hidden="true">
            <path d={HEART} fill="currentColor" />
            {near && <path d="M5.2 6.4q1.4-3 4.6-3" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.6" fill="none" strokeLinecap="round" />}
          </svg>
        </i>
      ))}
    </div>
  );
}

/* ---------- Pâques ---------- */

function Flower({ x, y, c, s = 1, kind }: { x: number; y: number; c: string; s?: number; kind: 'tulip' | 'daisy' }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 0V-22" stroke="#2f6b45" strokeWidth="2" />
      <path d="M0-6c-6-2-9-7-9-12 5 1 8 5 9 10" fill="#2f6b45" />
      {kind === 'tulip' ? (
        <path d="M-6-22c0-6 2-10 6-12 4 2 6 6 6 12-2 3-4 4-6 4s-4-1-6-4Z" fill={c} />
      ) : (
        <g>
          {range(6).map((i) => (
            <ellipse key={i} cx="0" cy="-28" rx="2.6" ry="5.4" fill={c} transform={`rotate(${i * 60} 0 -22)`} />
          ))}
          <circle cx="0" cy="-22" r="2.6" fill="#ffd36e" />
        </g>
      )}
    </g>
  );
}

function PaquesBack({ k }: { k: number }) {
  return (
    <>
      <div className="sl-sun">
        <i className="rays" />
        <i className="core" />
      </div>
      <Ground cls="g-paques">
        <path d="M0 110c120-24 250-26 380-8s240 12 360-6 240-20 340-2 80 10 120 8v58H0Z" fill="#163024" />
        <path d="M0 134c130-16 260-18 390-4 130 12 250 12 370-4 140-18 300-12 440 4V600H0Z" fill="#1b3a2b" />
        {range(70).map((i) => (
          <path key={i} d={`M${i * 17 + 4} 140q${2 + (i % 3)} ${-6 - (i % 4) * 2} ${4 + (i % 2) * 2} ${-12 - (i % 5) * 2}`} stroke="#2a5a3e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        ))}
        <Flower x={430} y={138} c="#ffb3c7" kind="tulip" />
        <Flower x={452} y={140} c="#fff1b0" kind="daisy" s={0.8} />
        <Flower x={700} y={136} c="#cdb4ff" kind="tulip" s={1.1} />
        <Flower x={724} y={138} c="#ffffff" kind="daisy" s={0.9} />
        <Flower x={300} y={140} c="#ffd36e" kind="tulip" s={0.9} />
        <Flower x={880} y={140} c="#ffb3c7" kind="daisy" />
        <Flower x={560} y={142} c="#a7d8ff" kind="tulip" s={0.85} />
        {/* Trois œufs cachés dans l'herbe. */}
        {(
          [
            [520, 146, '#cdb4ff', '#fff1b0'],
            [770, 144, '#ffb3c7', '#7fe0a8'],
            [360, 148, '#a7d8ff', '#ffd36e'],
          ] as const
        ).map(([x, y, a, b], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${(i - 1) * 12})`}>
            <ellipse cx="0" cy="-9" rx="8" ry="10" fill={a} />
            <path d="M-7.6-10l2.6 2.4 2.5-2.4 2.5 2.4 2.5-2.4 2.5 2.4 2.6-2.4" stroke={b} strokeWidth="1.8" fill="none" />
            <ellipse cx="-3" cy="-13" rx="1.6" ry="3" fill="#fff" opacity="0.45" />
          </g>
        ))}
      </Ground>
      <Drift kind="petal" n={16 * k} seed={110} dur={[13, 22]} size={[8, 13]} fade={[0.45, 0.8]} />
    </>
  );
}

function Butterfly({ hue }: { hue: [string, string] }) {
  return (
    <div className="fly-body">
      <svg className="wing l" viewBox="0 0 20 30" aria-hidden="true">
        <path d="M20 14C14 2 2 0 1 8c-1 6 6 9 19 8Z" fill={hue[0]} />
        <path d="M20 16C12 17 5 22 7 27c2 4 9 1 13-9Z" fill={hue[1]} />
        <circle cx="8" cy="8" r="2" fill="#fff" opacity="0.6" />
      </svg>
      <svg className="wing r" viewBox="0 0 20 30" aria-hidden="true">
        <path d="M0 14C6 2 18 0 19 8c1 6-6 9-19 8Z" fill={hue[0]} />
        <path d="M0 16c8 1 15 6 13 11-2 4-9 1-13-9Z" fill={hue[1]} />
        <circle cx="12" cy="8" r="2" fill="#fff" opacity="0.6" />
      </svg>
      <i />
    </div>
  );
}

/* ---------- Le décor ---------- */

export function SeasonLayer({ season, peak = false }: { season: SeasonId | null; peak?: boolean }) {
  const k = useDensity(peak);
  if (!season) return null;
  return (
    <>
      <div className={`season-layer sl-${season}`} aria-hidden="true">
        {season === 'halloween' && <HalloweenBack k={k} />}
        {season === 'noel' && <NoelBack k={k} />}
        {season === 'nouvel-an' && (
          <>
            <Stars n={16 * k} top={40} />
            <SkyBursts k={k} />
            <Skyline />
            <Drift kind="spark" n={12 * k} seed={120} dur={[9, 16]} size={[2, 3.6]} fade={[0.35, 0.75]} />
          </>
        )}
        {season === 'saint-valentin' && (
          <>
            <Bokeh n={Math.round(7 * Math.min(1, k))} />
            <Hearts n={10 * k} seed={130} />
            <Hearts n={6 * k} seed={140} near />
            <Stars n={10 * k} top={70} warm />
          </>
        )}
        {season === 'paques' && <PaquesBack k={k} />}
      </div>
      {season === 'noel' && <Garland />}
      <div className={`season-front sf-${season}`} aria-hidden="true">
        {season === 'halloween' && <HalloweenFront k={k} />}
        {season === 'noel' && <Drift kind="snow near" n={8 * k} seed={80} dur={[8, 12]} size={[5, 7.5]} fade={[0.55, 0.85]} />}
        {season === 'saint-valentin' && <Drift kind="rose" n={5 * k} seed={150} dur={[14, 20]} size={[11, 15]} fade={[0.5, 0.8]} />}
        {season === 'paques' &&
          range(k < 1 ? 1 : 2).map((i) => (
            <div key={i} className="sl-fly" style={css({ top: `${30 + i * 26}%`, animationDelay: `${4 + i * 9}s`, '--s': (0.9 + i * 0.25).toFixed(2) })}>
              <div className="bob">
                <Butterfly hue={i ? ['#ffd36e', '#ffb3c7'] : ['#a7d8ff', '#cdb4ff']} />
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
