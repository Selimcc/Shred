import { tr } from '../../shared/i18n';
// Courtes vidéos du club : 15 secondes au plus, ramenées à 720p et environ 3 Mo avant l'envoi.
//
// Sur le téléphone, la vidéo est rejouée dans une image hors écran et réenregistrée (MediaRecorder) : on garde
// les 15 premières secondes, on réduit la taille, et on retire la piste son si la personne l'a coupée. Une vidéo
// déjà légère, courte, au bon format et avec son est envoyée telle quelle.

export const VIDEO_SECONDS = 15;
export const VIDEO_BYTES = 6_000_000;
const LONG_SIDE = 1280;
const SHORT_SIDE = 720;

export interface PickedVideo {
  file: File;
  el: HTMLVideoElement;
  url: string;
  w: number;
  h: number;
  dur: number;
  poster: string;
}

export interface PreparedVideo {
  blob: Blob;
  type: string;
  poster: string;
  w: number;
  h: number;
  dur: number;
  sound: boolean;
}

const wait = <T,>(el: HTMLVideoElement, event: string, ms: number) =>
  new Promise<T | void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(tr('La vidéo met trop de temps à s’ouvrir'))), ms);
    el.addEventListener(event, () => (clearTimeout(t), resolve()), { once: true });
    el.addEventListener('error', () => (clearTimeout(t), reject(new Error(tr('Ce téléphone ne sait pas lire cette vidéo')))), { once: true });
  });

/** Taille réduite qui garde les proportions, en nombres pairs (exigé par les encodeurs). */
function fit(w: number, h: number) {
  const scale = Math.min(1, LONG_SIDE / Math.max(w, h), SHORT_SIDE / Math.min(w, h));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { w: even(w), h: even(h) };
}

async function grabPoster(el: HTMLVideoElement): Promise<string> {
  try {
    el.currentTime = Math.min(0.3, (el.duration || 1) / 2);
    await wait(el, 'seeked', 4000);
  } catch {
    // première image affichée, tant pis
  }
  const { w, h } = fit(el.videoWidth || 720, el.videoHeight || 1280);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(el, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.78);
}

/** Ouvrir la vidéo choisie : format, durée, image d'aperçu. */
export async function pickVideo(file: File): Promise<PickedVideo> {
  if (!file.type.startsWith('video/')) throw new Error(tr('Choisis une vidéo'));
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.src = url;
  try {
    await wait(el, 'loadeddata', 20_000);
    let dur = el.duration;
    if (!Number.isFinite(dur)) {
      // WebM sans durée écrite : on va chercher la fin pour la connaître.
      el.currentTime = 1e7;
      await wait(el, 'seeked', 4000).catch(() => undefined);
      dur = Number.isFinite(el.duration) ? el.duration : VIDEO_SECONDS;
    }
    const poster = await grabPoster(el);
    el.currentTime = 0;
    return { file, el, url, w: el.videoWidth, h: el.videoHeight, dur, poster };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function recorderType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

const direct = (v: PickedVideo, sound: boolean) => sound && v.file.size <= VIDEO_BYTES && v.dur <= VIDEO_SECONDS + 0.5 && /^video\/(mp4|webm)$/.test(v.file.type);

/**
 * Préparer l'envoi. À appeler dans le geste (appui sur « Publier ») : l'iPhone ne laisse jouer le son de la
 * vidéo pendant le réenregistrement que si la lecture démarre suite à un toucher.
 */
export function prepareVideo(v: PickedVideo, sound: boolean, onProgress: (ratio: number) => void): Promise<PreparedVideo> {
  const base = { poster: v.poster, w: v.w, h: v.h, dur: Math.min(v.dur, VIDEO_SECONDS), sound };
  if (direct(v, sound)) return Promise.resolve({ ...base, blob: v.file, type: v.file.type });
  const type = recorderType();
  const canvasStream = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  if (!type || !canvasStream) {
    // Pas de réenregistrement possible : la vidéo d'origine si elle passe, le son coupé à la lecture.
    if (v.file.size <= VIDEO_BYTES && v.dur <= VIDEO_SECONDS + 0.5) return Promise.resolve({ ...base, blob: v.file, type: v.file.type || 'video/mp4' });
    return Promise.reject(new Error(tr('Vidéo trop longue ou trop lourde pour ce navigateur : 15 secondes et 6 Mo au plus')));
  }

  // Un lecteur neuf à chaque essai (Web Audio ne peut brancher un même lecteur qu'une fois).
  const el = document.createElement('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.src = v.url;
  const { w, h } = fit(v.w || 720, v.h || 1280);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);

  // Le son passe par Web Audio vers l'enregistreur seulement : rien ne sort du haut-parleur.
  let audio: AudioContext | null = null;
  if (sound) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio = new AC();
      const src = audio.createMediaElementSource(el);
      const dest = audio.createMediaStreamDestination();
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      void audio.resume();
    } catch {
      audio = null;
    }
  }
  el.muted = !audio;
  const playing = el.play();

  return new Promise<PreparedVideo>((resolve, reject) => {
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_600_000, audioBitsPerSecond: 96_000 });
    const limit = Math.min(v.dur, VIDEO_SECONDS);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.pause();
      if (rec.state !== 'inactive') rec.stop();
    };
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onerror = () => reject(new Error(tr('La vidéo n’a pas pu être préparée')));
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void audio?.close();
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      if (!blob.size) return reject(new Error(tr('La vidéo n’a pas pu être préparée')));
      if (blob.size > VIDEO_BYTES) return reject(new Error(tr('Vidéo trop lourde même compressée : raccourcis-la')));
      resolve({ ...base, blob, type: type.split(';')[0], w, h });
    };
    const draw = () => {
      if (done) return;
      ctx.drawImage(el, 0, 0, w, h);
      onProgress(Math.min(1, el.currentTime / limit));
      if (el.currentTime >= limit || el.ended) return finish();
      if ('requestVideoFrameCallback' in el) (el as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };
    el.addEventListener('ended', finish, { once: true });
    // Filet de sécurité : une lecture qui cale ne bloque pas la publication.
    setTimeout(finish, (limit + 8) * 1000);
    playing.then(
      () => {
        rec.start(500);
        draw();
      },
      () => {
        done = true;
        reject(new Error(tr('Touche « Publier » à nouveau pour préparer la vidéo')));
      },
    );
  });
}
