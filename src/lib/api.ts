import { authToken, COOKIE, markExpired, type Role } from './session';
import type { MealItem } from './store';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
export const DEMO = import.meta.env.MODE === 'demo';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Health {
  ok: boolean;
  version: string;
  ai: 'live' | 'mock' | 'missing';
  /** Requêtes IA intégrées autorisées par jour pour ce compte (0 = réservé à l'administrateur). */
  aiLimit: number;
  push: boolean;
  /** Le serveur sait envoyer des mails (bilan de la semaine). */
  email?: boolean;
  subscribed: boolean;
  user: { id: string; name: string; email: string; role: Role };
  /** Liens iCloud des raccourcis partagés par l'administrateur. */
  shortcuts?: Partial<Record<'health' | 'gymIn' | 'gymOut', string>>;
}

export interface MealAnalysis {
  is_food: boolean;
  title: string;
  items: MealItem[];
  confidence: 'low' | 'medium' | 'high';
  advice: string;
}

/** « version;mode » pour le panneau admin : quelle version tourne, en app installée, dans le navigateur ou l'app iPhone. */
function clientTag(): string {
  if (typeof window === 'undefined') return '';
  const native = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const version = typeof __BUILD__ === 'undefined' ? '' : __BUILD__.split('+')[0];
  return `${version};${native ? 'ios' : standalone ? 'pwa' : 'web'}`;
}
const CLIENT = clientTag();

/** En-têtes d'une requête : le jeton pour l'app iPhone, le cookie (et X-Shred) pour l'app web. */
export function authHeaders(token: string | undefined, json = true): Record<string, string> {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-shred': '1',
    ...(CLIENT ? { 'x-shred-client': CLIENT } : {}),
    ...(token && token !== COOKIE ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  if (DEMO) return demoApi<T>(path, init.body);
  const needsAuth = init.auth !== false;
  const token = authToken();
  if (needsAuth && !token) throw new ApiError(0, 'Connecte-toi à ton compte (Réglages, Compte) pour utiliser cette fonction.');
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: authHeaders(needsAuth ? token : undefined),
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifie ta connexion.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && needsAuth) markExpired();
  if (!res.ok) throw new ApiError(res.status, data.error ?? (res.status === 404 && !res.headers.get('content-type')?.includes('json') ? 'Serveur introuvable' : `Erreur ${res.status}`));
  return data as T;
}

/* ---------- Mode démo : aucune requête réseau ---------- */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function demoApi<T>(path: string, body: unknown): Promise<T> {
  await wait(path.includes('meal') ? 1400 : 700);
  if (path === '/api/health') {
    return {
      ok: true,
      version: 'démo',
      ai: 'mock',
      aiLimit: 10,
      push: false,
      subscribed: false,
      user: { id: 'demo', name: 'Démo', email: 'demo@exemple.com', role: 'admin' },
    } as T;
  }
  if (path === '/api/meal/analyze') {
    const analysis: MealAnalysis = {
      is_food: true,
      title: 'Poulet, riz, haricots verts',
      items: [
        { name: 'Blanc de poulet grillé', grams: 140, kcal: 230, protein: 43, carbs: 0, fat: 5 },
        { name: 'Riz basmati cuit', grams: 220, kcal: 285, protein: 6, carbs: 62, fat: 1 },
        { name: 'Haricots verts', grams: 150, kcal: 45, protein: 3, carbs: 7, fat: 0 },
        { name: 'Huile d’olive', grams: 8, kcal: 72, protein: 0, carbs: 0, fat: 8 },
      ],
      confidence: 'medium',
      advice: 'Mode démo : estimation fictive. Une fois déployée, l’app analyse vraiment ta photo.',
    };
    return analysis as T;
  }
  if (path === '/api/coach') {
    const msgs = (body as { messages: { content: string }[] }).messages;
    const q = msgs[msgs.length - 1]?.content ?? '';
    return {
      reply: `Mode démo : je ne suis pas encore branché. Tu m’as demandé « ${q.slice(0, 70)} ». Une fois l’app déployée avec ta clé API, je te réponds avec ton programme et tes données du jour.`,
    } as T;
  }
  throw new ApiError(0, 'Indisponible en mode démo. Déploie l’app pour activer cette fonction.');
}
