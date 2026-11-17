// Carte « story » de fin de séance, comme Strava ou Hevy : une image 1080 × 1920 dessinée sur le téléphone
// (rien ne part au serveur), prête pour une story Instagram ou un message.
import type { SessionSummary } from './club';
import { tr } from '../../shared/i18n';

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

/** Fond graphite, lueur d'accent en haut, glacier en bas, fines diagonales ; marque et date en tête. */
function backdrop(ctx: Ctx, accent: string, rightLabel: string) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#16191e');
  bg.addColorStop(1, '#0c0e11');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W * 0.95, H * 0.02, 900, accent);
  glow(ctx, W * 0.0, H * 0.75, 800, 'rgba(134,185,255,0.12)');
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 2;
  for (let i = -H; i < W; i += 56) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.fillStyle = '#f2f3f5';
  setFont(ctx, 800, 46, 'condensed');
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.fillText('SHRED', PAD, PAD + 50);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = '#a0a5ad';
  setFont(ctx, 500, 38);
  ctx.textAlign = 'right';
  ctx.fillText(rightLabel, W - PAD, PAD + 48);
  ctx.textAlign = 'left';
}

/** Les 4 chiffres en grille de 2 × 2 cartes. Renvoie le bas de la grille. */
function statGrid(ctx: Ctx, stats: { label: string; value: string }[], top: number): number {
  const gap = 28;
  const cw = (W - PAD * 2 - gap) / 2;
  const ch = 250;
  stats.slice(0, 4).forEach((st, i) => {
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
  const rows = Math.ceil(Math.min(4, stats.length) / 2);
  return top + rows * (ch + gap) - gap;
}

async function canvasReady(): Promise<{ canvas: HTMLCanvasElement; ctx: Ctx }> {
  try {
    await Promise.all([document.fonts.load(`800 120px ${FONT}`), document.fonts.load(`500 40px ${FONT}`)]);
  } catch {
    // police système à la place
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  return { canvas, ctx: canvas.getContext('2d') as Ctx };
}

export interface MonthStory {
  month: string;
  year: number;
  stats: { label: string; value: string }[];
  /** « Le poids de 7 éléphants d’Afrique. » */
  like: string | null;
  top: string | null;
  records: string[];
  run: number;
  name: string;
  /** Le profil du mois, révélé à la fin de la story. */
  profile: { title: string; line: string; color: string };
  /** Le mois en calendrier (décalage du 1er, lundi = 0). */
  cal: { offset: number; days: { trained: boolean; record: boolean; future: boolean }[] };
}

/** Coupe un texte en lignes qui tiennent dans la largeur (les dernières lignes sont fondues avec « … »). */
function wrap(ctx: Ctx, text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= width || !cur) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = `${kept[lines - 1].replace(/[ ,.;:]+$/, '')}…`;
    return kept;
  }
  return out;
}

/** Une couleur « #rrggbb » avec une opacité. */
function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Petite étoile (jours de record dans le calendrier). */
function starAt(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Carte story du récap : le mois en très grand, le profil du mois dans une carte à sa couleur, le calendrier des
 * séances à gauche et les chiffres à droite, puis l'exercice du mois, les records et la série.
 */
export async function drawMonthStory(m: MonthStory): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = await canvasReady();
  const pc = m.profile.color;
  backdrop(ctx, alpha(pc, 0.3), `${m.month[0].toUpperCase()}${m.month.slice(1)} ${m.year}`);
  glow(ctx, W * 0.1, H * 0.42, 700, alpha(pc, 0.1));

  // Le mois.
  ctx.fillStyle = '#a0a5ad';
  setFont(ctx, 600, 46);
  ctx.fillText(tr('Mon mois'), PAD, 236);
  const title = m.month.toUpperCase();
  const size = fit(ctx, title, 820, 250, W - PAD * 2, 'condensed');
  const tg = ctx.createLinearGradient(0, 420 - size, 0, 420);
  tg.addColorStop(0, '#ffffff');
  tg.addColorStop(1, '#c4c8cf');
  ctx.fillStyle = tg;
  ctx.fillText(title, PAD - 6, 420);

  // Le profil du mois, dans une carte à sa couleur.
  const cy = 476;
  const ch = 300;
  roundRect(ctx, PAD, cy, W - PAD * 2, ch, 48);
  const cg = ctx.createLinearGradient(PAD, cy, W - PAD, cy + ch);
  cg.addColorStop(0, alpha(pc, 0.26));
  cg.addColorStop(1, alpha(pc, 0.06));
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = alpha(pc, 0.55);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = pc;
  setFont(ctx, 700, 38);
  ctx.fillText(tr('Mon profil du mois'), PAD + 52, cy + 84);
  ctx.fillStyle = '#ffffff';
  const ps = fit(ctx, m.profile.title, 820, 104, W - PAD * 2 - 104, 'condensed');
  setFont(ctx, 820, ps, 'condensed');
  ctx.fillText(m.profile.title, PAD + 50, cy + 84 + ps * 0.95);
  ctx.fillStyle = '#c9ccd2';
  setFont(ctx, 500, 38);
  wrap(ctx, m.profile.line, W - PAD * 2 - 104, 2).forEach((l, k) => ctx.fillText(l, PAD + 52, cy + 84 + ps * 0.95 + 64 + k * 50));

  // Le calendrier, à gauche.
  const top = cy + ch + 74;
  const cell = 70;
  const gap = 12;
  ctx.textAlign = 'center';
  setFont(ctx, 700, 28);
  ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach((l, k) => {
    ctx.fillStyle = '#7d828b';
    ctx.fillText(l, PAD + k * (cell + gap) + cell / 2, top);
  });
  m.cal.days.forEach((d, k) => {
    const pos = m.cal.offset + k;
    const x = PAD + (pos % 7) * (cell + gap);
    const y = top + 26 + Math.floor(pos / 7) * (cell + gap);
    roundRect(ctx, x, y, cell, cell, 18);
    if (d.trained) {
      ctx.fillStyle = pc;
      ctx.fill();
    } else if (d.future) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
    }
    ctx.fillStyle = d.trained ? '#14161a' : '#6c717a';
    setFont(ctx, d.trained ? 760 : 500, 28);
    ctx.fillText(String(k + 1), x + cell / 2, y + cell / 2 + 10);
    if (d.record) {
      // Sur une case allumée, l'étoile se détache en sombre (la case peut être dorée elle aussi).
      ctx.fillStyle = d.trained ? '#14161a' : '#ffd166';
      starAt(ctx, x + cell - 10, y + 10, 13);
    }
  });
  ctx.textAlign = 'left';
  const rows = Math.ceil((m.cal.offset + m.cal.days.length) / 7);
  const calBottom = top + 26 + rows * (cell + gap) - gap;

  // Les chiffres, à droite du calendrier.
  const sx = PAD + 7 * (cell + gap) + 40;
  const sw = W - PAD - sx;
  // Trois chiffres au plus, répartis sur la hauteur du calendrier (des lettres des jours à la dernière ligne).
  const stats = m.stats.slice(0, 3);
  const step = (calBottom - (top - 28)) / Math.max(1, stats.length);
  stats.forEach((st, k) => {
    const y = top - 28 + k * step;
    ctx.fillStyle = '#f2f3f5';
    const vs = Math.min(fit(ctx, st.value, 800, 96, sw, 'condensed'), (step - 62) / 0.82);
    setFont(ctx, 800, vs, 'condensed');
    ctx.fillText(st.value, sx, y + vs * 0.82);
    ctx.fillStyle = '#a0a5ad';
    setFont(ctx, 500, 32);
    ctx.fillText(st.label, sx, y + vs * 0.82 + 42);
  });

  // L'exercice du mois et les records.
  let by = calBottom + 96;
  if (m.top) {
    ctx.fillStyle = '#a0a5ad';
    setFont(ctx, 500, 36);
    ctx.fillText(tr('Exercice du mois'), PAD, by);
    by += 62;
    ctx.fillStyle = '#f2f3f5';
    const ts = fit(ctx, m.top, 720, 54, W - PAD * 2, 'normal');
    setFont(ctx, 720, ts);
    ctx.fillText(m.top, PAD, by);
  }
  const fy = H - PAD - 140;
  const records = m.records.slice(0, by + 2 * 86 < fy - 110 ? 2 : 1);
  for (const r of records) {
    by += 84;
    roundRect(ctx, PAD, by - 52, 64, 64, 20);
    ctx.fillStyle = 'rgba(255,181,71,0.16)';
    ctx.fill();
    ctx.fillStyle = '#ffb547';
    setFont(ctx, 800, 30, 'condensed');
    ctx.textAlign = 'center';
    ctx.fillText('PR', PAD + 32, by - 9);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2f3f5';
    const rs = fit(ctx, r, 600, 40, W - PAD * 2 - 96, 'normal');
    setFont(ctx, 600, rs);
    ctx.fillText(r, PAD + 92, by - 6);
  }

  if (m.run > 1) {
    const label = tr('{run} jours validés d’affilée', { run: m.run });
    setFont(ctx, 760, 44);
    const tw = ctx.measureText(label).width;
    roundRect(ctx, PAD, fy - 68, tw + 150, 100, 50);
    ctx.fillStyle = 'rgba(255,181,71,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,71,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    flame(ctx, PAD + 60, fy - 18, 28);
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(label, PAD + 108, fy);
  }
  ctx.fillStyle = '#6c717a';
  setFont(ctx, 500, 36);
  ctx.fillText(tr('{v}suivi avec Shred', { v: m.name ? `${m.name}, ` : '' }), PAD, H - PAD);
  return canvas;
}

export async function drawStory(sum: SessionSummary, extra: StoryExtras): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = await canvasReady();

  backdrop(ctx, sum.kind === 'cardio' ? 'rgba(95,211,160,0.22)' : 'rgba(255,181,71,0.24)', extra.dateLabel);

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
  ctx.fillText(sum.kind === 'cardio' ? tr('Séance d’endurance terminée') : sum.kind === 'rest' ? tr('Récupération active') : tr('Séance de musculation terminée'), PAD, y);

  // Chiffres : grille de 2 × 2 cartes.
  const stats = sum.stats.slice(0, 4);
  const top = 720;
  const gap = 28;
  const ch = 250;
  statGrid(ctx, stats, top);

  // Records : jusqu'à trois lignes.
  let ry = top + (stats.length > 2 ? 2 : stats.length ? 1 : 0) * (ch + gap) + 60;
  const records = (sum.records ?? []).slice(0, 3);
  if (records.length) {
    ctx.fillStyle = '#ffb547';
    setFont(ctx, 760, 40);
    ctx.fillText(records.length > 1 ? tr('{length} records battus', { length: records.length }) : tr('Record battu'), PAD, ry);
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
    const label = tr('{streak} jours de série', { streak: extra.streak });
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
  ctx.fillText(tr('{v}suivi avec Shred', { v: extra.name ? `${extra.name}, ` : '' }), PAD, H - PAD);
  return canvas;
}

export function storyBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr('Image impossible à créer')))), 'image/png'));
}

/** Partager l'image (feuille de partage du téléphone, Instagram compris), sinon la télécharger. */
export async function shareStory(blob: Blob, title: string, shareTitle = tr('Séance {title}', { title })): Promise<'shared' | 'saved' | 'cancelled'> {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const file = new File([blob], `shred-${slug || 'story'}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: shareTitle });
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
