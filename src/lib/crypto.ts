// Tout ce qui touche au mot de passe se passe sur le téléphone.
//
// Le mot de passe donne, via PBKDF2 (600 000 tours, recommandation OWASP) puis HKDF, deux clés :
//  - « auth » : envoyée au serveur pour se connecter. Le serveur n'en garde qu'une empreinte.
//  - « data » : reste sur le téléphone et chiffre la sauvegarde (AES-GCM). Le serveur ne la voit jamais.
// Le mot de passe lui-même n'est ni envoyé ni stocké.

export const KDF_ITERATIONS = 600_000;
const enc = new TextEncoder();

export function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function cryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export async function deriveKeys(email: string, password: string): Promise<{ auth: string; data: string }> {
  if (!cryptoAvailable()) throw new Error('Connexion sécurisée requise : ouvre l’app en https.');
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`shred:v1:${normEmail(email)}`), iterations: KDF_ITERATIONS },
    base,
    256,
  );
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const part = async (info: string) =>
    toB64url(new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, hk, 256)));
  return { auth: await part('shred-auth'), data: await part('shred-data') };
}

export interface Sealed {
  iv: string;
  data: string;
  gz: boolean;
}

async function gzip(bytes: Uint8Array<ArrayBuffer>, mode: 'compress' | 'decompress'): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const aesKey = (keyB64: string, use: KeyUsage) => crypto.subtle.importKey('raw', fromB64url(keyB64), 'AES-GCM', false, [use]);

/** Compresse puis chiffre un objet JSON avec la clé « data ». */
export async function seal(keyB64: string, text: string): Promise<Sealed> {
  const plain = enc.encode(text) as Uint8Array<ArrayBuffer>;
  const canZip = typeof CompressionStream !== 'undefined';
  const body = canZip ? await gzip(plain, 'compress') : plain;
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64, 'encrypt'), body);
  return { iv: toB64url(iv), data: toB64url(new Uint8Array(cipher)), gz: canZip };
}

/** Déchiffre une sauvegarde. Échoue si la clé ne correspond pas (mot de passe changé ailleurs). */
export async function unseal(keyB64: string, box: Sealed): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(box.iv) }, await aesKey(keyB64, 'decrypt'), fromB64url(box.data));
  const bytes = box.gz ? await gzip(new Uint8Array(plain), 'decompress') : new Uint8Array(plain);
  return new TextDecoder().decode(bytes);
}

export async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return toB64url(d);
}
