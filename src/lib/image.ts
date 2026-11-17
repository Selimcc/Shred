import { tr } from '../../shared/i18n';
/** Redimensionne une photo côté téléphone avant envoi : moins de données, moins de tokens. */
export async function prepareImage(file: File, maxSide = 1024, quality = 0.8) {
  const bitmap = await loadBitmap(file);
  const full = await draw(bitmap, maxSide, quality);
  const thumb = await draw(bitmap, 320, 0.75);
  if ('close' in bitmap) bitmap.close();
  const base64 = await blobToBase64(full);
  return { base64, mediaType: 'image/jpeg' as const, blob: full, thumb };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Repli pour les navigateurs qui ne décodent pas le fichier via createImageBitmap.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function draw(src: ImageBitmap | HTMLImageElement, maxSide: number, quality: number): Promise<Blob> {
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(tr('Canvas indisponible'));
  // En réduisant, Safari peut laisser le dernier pixel du bord à moitié transparent, et le JPEG le rend noir :
  // l'image est d'abord peinte un pixel plus grande dessous, le bord s'appuie alors sur ses vraies couleurs.
  ctx.drawImage(src, -1, -1, canvas.width + 2, canvas.height + 2);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr('Compression impossible')))), 'image/jpeg', quality),
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
