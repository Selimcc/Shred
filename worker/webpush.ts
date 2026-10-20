// Web Push sans dépendance : VAPID (RFC 8292) + chiffrement aes128gcm (RFC 8291 / RFC 8188).
// Fonctionne avec WebCrypto, donc dans un Worker Cloudflare comme dans Node 20+.

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  publicKey: string; // base64url, point non compressé (65 octets)
  privateKey: string; // base64url, scalaire d (32 octets)
  subject: string; // mailto:… ou https://…
}

export interface PushOptions {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
}

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** JWT VAPID signé ES256. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowSec = Math.floor(Date.now() / 1000)) {
  const pub = b64urlDecode(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY invalide (65 octets attendus)');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: vapid.privateKey,
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSec + 12 * 3600,
        sub: vapid.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned) as BufferSource),
  );
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

/** Chiffre la charge utile pour un abonnement (aes128gcm, un seul enregistrement). */
export async function encryptPayload(sub: PushSubscriptionData, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  if (uaPublic.length !== 65) throw new Error('Clé p256dh invalide');
  if (authSecret.length !== 16) throw new Error('Secret auth invalide');

  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], local.privateKey, 256),
  );

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Délimiteur 0x02 = dernier (et unique) enregistrement, sans padding supplémentaire.
  const plaintext = concat(payload, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, plaintext as BufferSource),
  );

  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export async function buildPushRequest(
  sub: PushSubscriptionData,
  data: unknown,
  vapid: VapidKeys,
  opts: PushOptions = {},
): Promise<{ url: string; init: RequestInit }> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(data)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 6 * 3600),
    Urgency: opts.urgency ?? 'normal',
  };
  if (opts.topic) headers.Topic = opts.topic;
  return { url: sub.endpoint, init: { method: 'POST', headers, body: body as BodyInit } };
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** Abonnement expiré ou révoqué : à supprimer. */
  gone: boolean;
  detail?: string;
}

export async function sendPush(
  sub: PushSubscriptionData,
  data: unknown,
  vapid: VapidKeys,
  opts: PushOptions = {},
): Promise<PushResult> {
  const { url, init } = await buildPushRequest(sub, data, vapid, opts);
  const res = await fetch(url, init);
  const ok = res.status >= 200 && res.status < 300;
  return {
    ok,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
    detail: ok ? undefined : (await res.text()).slice(0, 300),
  };
}
