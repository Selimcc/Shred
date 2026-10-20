// Sauvegarde du téléphone, chiffrée par l'app avant l'envoi : le serveur ne garde qu'un bloc illisible.
import { type Env, HttpError, json, readJson } from './env';
import type { User } from './users';

const MAX = 4_000_000;

interface Box {
  v: 1;
  iv: string;
  data: string;
  gz?: boolean;
  savedAt: number;
}

const key = (user: User) => `u:${user.id}:backup`;

export async function putBackup(req: Request, env: Env, user: User): Promise<Response> {
  const b = await readJson<Partial<Box>>(req, MAX + 10_000);
  if (typeof b.iv !== 'string' || b.iv.length > 40 || typeof b.data !== 'string' || !b.data || b.data.length > MAX) {
    throw new HttpError(400, 'Sauvegarde invalide ou trop lourde');
  }
  const savedAt = Date.now();
  const box: Box = { v: 1, iv: b.iv, data: b.data, gz: Boolean(b.gz), savedAt };
  await env.KV.put(key(user), JSON.stringify(box), { metadata: { savedAt, size: b.data.length } });
  return json({ ok: true, savedAt });
}

/** Avec ?meta=1, renvoie seulement la date de la dernière sauvegarde. */
export async function getBackup(env: Env, user: User, metaOnly: boolean): Promise<Response> {
  const res = await env.KV.getWithMetadata<{ savedAt: number; size: number }>(key(user));
  if (!res.value) return json({ savedAt: null });
  if (metaOnly) return json({ savedAt: res.metadata?.savedAt ?? null, size: res.metadata?.size ?? null });
  return new Response(res.value, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
