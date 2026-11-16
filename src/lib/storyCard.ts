// Carte « story » de fin de séance, comme Strava ou Hevy : une image 1080 × 1920 dessinée sur le téléphone
// (rien ne part au serveur), prête pour une story Instagram ou un message.
import type { SessionSummary } from './club';

export interface StoryExtras {
  name: string;
  streak: number;
  dateLabel: string;
}

const W = 1080;
const H = 1920;
const PAD = 88;
const FONT = '"Archivo Variable", "Archivo", system-ui, -apple-system, sans-serif';

type Ctx = CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string };

function setFont(ctx: Ctx, weight: number, size: number, stretch: 'condensed' | 'normal' = 'normal') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  if ('fontStretch' in ctx) ctx.fontStretch = stretch === 'condensed' ? 'condensed' : 'normal';
}

/** Taille la plus grande (jusqu'à max) pour que le texte tienne dans la largeur. */
function fit(ctx: Ctx, text: string, weight: number, max: number, width: number, stretch: 'condensed' | 'normal') {
  let size = max;
  for (; size > 40; size -= 6) {
    setFont(ctx, weight, size, stretch);
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Petite flamme dessinée (pas d'emoji : même rendu partout). */
function flame(ctx: Ctx, x: number, y: number, s: number) {
  const g = ctx.createLinearGradient(x, y - s, x, y + s);
  g.addColorStop(0, '#ffd27a');
  g.addColorStop(1, '#ff8a1f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.bezierCurveTo(x + s * 0.9, y - s * 0.2, x + s * 0.8, y + s * 0.9, x, y + s);
  ctx.bezierCurveTo(x - s * 0.8, y + s * 0.9, x - s * 0.9, y + s * 0.1, x - s * 0.25, y - s * 0.35);
  ctx.bezierCurveTo(x - s * 0.1, y - s * 0.05, x + s * 0.05, y - s * 0.5, x, y - s);
  ctx.fill();
}

export async function drawStory(sum: SessionSummary, extra: StoryExtras): Promise<HTMLCanvasElement> {
  try {
    await Promise.all([document.fonts.load(`800 120px ${FONT}`), document.fonts.load(`500 40px ${FONT}`)]);
  } catch {
    // police système à la place
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d') as Ctx;

  // Fond graphite, lueurs ambre et glacier.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16191e');
  bg.addColorStop(1, '#0c0e11');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W * 0.95, H * 0.02, 900, sum.kind === 'cardio' ? 'rgba(95,211,160,0.22)' : 'rgba(255,181,71,0.24)');
  glow(ctx, W * 0.0, H * 0.75, 800, 'rgba(134,185,255,0.12)');
  // Fines lignes diagonales, très discrètes.
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 2;
  for (let i = -H; i < W; i += 56) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }

  // En-tête : marque et date.
  ctx.fillStyle = '#f2f3f5';
  setFont(ctx, 800, 46, 'condensed');
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.fillText('SHRED', PAD, PAD + 50);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = '#a0a5ad';
  setFont(ctx, 500, 38);
  ctx.textAlign = 'right';
  ctx.fillText(extra.dateLabel, W - PAD, PAD + 48);
  ctx.textAlign = 'left';

  // Titre de la séance, le plus grand possible.
  const title = sum.title.toUpperCase();
  let y = 520;
  const size = fit(ctx, title, 820, 260, W - PAD * 2, 'condensed');
  const tg = ctx.createLinearGradient(0, y - size, 0, y);
  tg.addColorStop(0, '#ffffff');
  tg.addColorStop(1, '#c4c8cf');
  ctx.fillStyle = tg;
  ctx.fillText(title, PAD - 6, y);
  y += 70;
  ctx.fillStyle = '#a0a5ad';
  setFont(ctx, 500, 42);
  ctx.fillText(sum.kind === 'cardio' ? 'Séance d’endurance terminée' : sum.kind === 'rest' ? 'Récupération active' : 'Séance de musculation terminée', PAD, y);

  // Chiffres : grille de 2 × 2 cartes.
  const stats = sum.stats.slice(0, 4);
  const top = 720;
  const gap = 28;
  const cw = (W - PAD * 2 - gap) / 2;
  const ch = 250;
  stats.forEach((st, i) => {
    const x = PAD + (i % 2) * (cw + gap);
    const yy = top + Math.floor(i / 2) * (ch + gap);
    roundRect(ctx, x, yy, cw, ch, 44);
    const cg = ctx.createLinearGradient(0, yy, 0, yy + ch);
    cg.addColorStop(0, 'rgba(255,255,255,0.075)');
    cg.addColorStop(1, 'rgba(255,255,255,0.03)');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#f2f3f5';
    const vs = fit(ctx, st.value, 780, 120, cw - 80, 'condensed');
    setFont(ctx, 780, vs, 'condensed');
    ctx.fillText(st.value, x + 40, yy + 150);
    ctx.fillStyle = '#a0a5ad';
    setFont(ctx, 500, 36);
    ctx.fillText(st.label, x + 40, yy + 205);
  });

  // Records : jusqu'à trois lignes.
  let ry = top + (stats.length > 2 ? 2 : stats.length ? 1 : 0) * (ch + gap) + 60;
  const records = (sum.records ?? []).slice(0, 3);
  if (records.length) {
    ctx.fillStyle = '#ffb547';
    setFont(ctx, 760, 40);
    ctx.fillText(records.length > 1 ? `${records.length} records battus` : 'Record battu', PAD, ry);
    ry += 30;
    for (const r of records) {
      ry += 74;
      roundRect(ctx, PAD, ry - 52, 64, 64, 20);
      ctx.fillStyle = 'rgba(255,181,71,0.16)';
      ctx.fill();
      ctx.fillStyle = '#ffb547';
      setFont(ctx, 800, 30, 'condensed');
      ctx.textAlign = 'center';
      ctx.fillText('PR', PAD + 32, ry - 9);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f2f3f5';
      const rs = fit(ctx, r, 600, 42, W - PAD * 2 - 96, 'normal');
      setFont(ctx, 600, rs);
      ctx.fillText(r, PAD + 92, ry - 6);
    }
  }

  // Bas : la série de jours, et la signature.
  const by = H - PAD - 150;
  if (extra.streak > 1) {
    const label = `${extra.streak} jours de série`;
    setFont(ctx, 760, 48);
    const tw = ctx.measureText(label).width;
    roundRect(ctx, PAD, by - 70, tw + 150, 104, 52);
    ctx.fillStyle = 'rgba(255,181,71,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,71,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    flame(ctx, PAD + 60, by - 18, 30);
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(label, PAD + 108, by + 0);
  }
  ctx.fillStyle = '#6c717a';
  setFont(ctx, 500, 36);
  ctx.fillText(`${extra.name ? `${extra.name}, ` : ''}suivi avec Shred`, PAD, H - PAD);
  return canvas;
}

export function storyBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image impossible à créer'))), 'image/png'));
}

/** Partager l'image (feuille de partage du téléphone, Instagram compris), sinon la télécharger. */
export async function shareStory(blob: Blob, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], `shred-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `Séance ${title}` });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}
