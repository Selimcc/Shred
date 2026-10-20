// Profils publics : ce que chacun choisit de montrer aux autres testeurs (série, record, flammes, niveau, fiche de force).
// La sauvegarde est chiffrée et illisible pour le serveur : c'est l'app qui envoie ce résumé, et seulement les champs cochés.
import { type Env, HttpError, json, readJson } from './env';
import { listAccounts, loadJson, type User } from './users';

const GRADES = ['A', 'B', 'C', 'D', 'E'];

export interface RadarPoint {
  id: string;
  name: string;
  short: string;
  grade: string | null;
  score: number | null;
}

export interface PublicData {
  streak?: number;
  best?: number;
  flames?: number;
  tier?: number;
  level?: number;
  radar?: RadarPoint[];
  program?: string;
}

interface StoredProfile {
  visible: boolean;
  data?: PublicData;
  updatedAt?: string;
}

const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : undefined);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Ne garde que les champs connus, bornés : rien d'autre ne peut être publié. */
export function sanitizeProfile(input: unknown): PublicData {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: PublicData = {};
  const set = <K extends keyof PublicData>(k: K, v: PublicData[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('streak', int(src.streak, 100_000));
  set('best', int(src.best, 100_000));
  set('flames', int(src.flames, 1_000));
  set('tier', int(src.tier, 10));
  set('level', int(src.level, 10_000));
  set('program', str(src.program, 40));
  if (Array.isArray(src.radar)) {
    out.radar = src.radar.slice(0, 8).map((p: Record<string, unknown>) => ({
      id: String(p?.id ?? '').replace(/[^a-z]/g, '').slice(0, 16),
      name: str(p?.name, 20) ?? '',
      short: str(p?.short, 8) ?? '',
      grade: typeof p?.grade === 'string' && GRADES.includes(p.grade) ? p.grade : null,
      score: typeof p?.score === 'number' && p.score >= 0 && p.score <= 5 ? Math.round(p.score * 100) / 100 : null,
    }));
  }
  return out;
}

export async function profileRoutes(req: Request, env: Env, user: User, pathname: string): Promise<Response | null> {
  if (pathname === '/api/profile' && req.method === 'PUT') {
    const b = await readJson<{ visible?: boolean; data?: unknown }>(req, 10_000);
    const stored: StoredProfile = b.visible
      ? { visible: true, data: sanitizeProfile(b.data), updatedAt: new Date().toISOString() }
      : { visible: false };
    await user.store.put('profile', JSON.stringify(stored));
    return json({ ok: true, profile: stored });
  }

  if (pathname === '/api/profiles' && req.method === 'GET') {
    const accounts = await listAccounts(env);
    const rows = await Promise.all(accounts.map(async (a) => ({ a, p: await loadJson<StoredProfile>(env.KV, `u:${a.id}:profile`) })));
    const profiles = rows
      .filter(({ p }) => p?.visible)
      .map(({ a, p }) => ({ id: a.id, name: a.name, me: a.id === user.id, updatedAt: p!.updatedAt ?? null, ...p!.data }))
      .sort((x, y) => (y.streak ?? -1) - (x.streak ?? -1));
    return json({ profiles });
  }

  if (pathname.startsWith('/api/profile')) throw new HttpError(404, 'Route inconnue');
  return null;
}
