// Chiffrement au repos des données sensibles rangées dans KV (emails des comptes, jetons Strava) : quelqu'un
// qui lirait la base sans les secrets du Worker n'y verrait que du bruit.
//
// La clé dérive de DATA_KEY (secret dédié, conseillé) ou, à défaut, de la clé privée VAPID déjà présente.
// Sans l'un ni l'autre (tests, développement), les valeurs restent en clair. Une valeur déjà en clair reste
// lisible : elle sera chiffrée à sa prochaine écriture.
import type { Env } from './env';

const PREFIX = 'sealed:v1:';
const cache = new Map<string, Promise<CryptoKey>>();

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function derive(root: string): Promise<CryptoKey> {
  let k = cache.get(root);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(root), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('shred:seal'), info: new TextEncoder().encode('v1') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    cache.set(root, k);
  }
  return k;
}

/** Clés possibles, la première sert à chiffrer. Ajouter DATA_KEY plus tard reste sans risque : l'ancienne lit encore. */
function roots(env: Env): string[] {
  return [env.DATA_KEY, env.VAPID_PRIVATE_KEY].filter((x): x is string => Boolean(x));
}

export async function seal(env: Env, text: string): Promise<string> {
  const [root] = roots(env);
  if (!root || !text || text.startsWith(PREFIX)) return text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(root), new TextEncoder().encode(text)));
  return `${PREFIX}${b64(iv)}:${b64(ct)}`;
}

/** Valeur lisible, ou chaîne vide si la clé a changé (la donnée est alors perdue, pas exposée). */
export async function unseal(env: Env, value: string): Promise<string> {
  if (!value?.startsWith(PREFIX)) return value;
  const [iv, ct] = value.slice(PREFIX.length).split(':');
  for (const root of roots(env)) {
    try {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await derive(root), unb64(ct)));
    } catch {
      // clé suivante
    }
  }
  return '';
}

export const isSealed = (v: unknown) => typeof v === 'string' && v.startsWith(PREFIX);
