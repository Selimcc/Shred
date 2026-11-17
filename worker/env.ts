export interface Env {
  ASSETS: Fetcher;
  KV: KVNamespace;
  /** Minuteurs de repos (Durable Object) : notification à la fin du repos. */
  TIMERS?: DurableObjectNamespace;
  /** Le club : fil, étincelles, commentaires, abonnements (Durable Object unique). */
  CLUB?: DurableObjectNamespace;
  /** Compteurs d'utilisation du plan gratuit et petits compteurs (IA du jour, essais, rappels envoyés). */
  USAGE?: DurableObjectNamespace;

  // Secrets (wrangler secret put …, ou .dev.vars en local)
  ANTHROPIC_API_KEY?: string;
  /** Code qui crée un compte administrateur à l'inscription (généré par npm run setup). */
  ADMIN_CODE?: string;
  /** Clé Resend pour envoyer le bilan de la semaine par mail (facultatif). */
  RESEND_API_KEY?: string;
  /** Expéditeur des mails, sur un domaine vérifié chez Resend (« Shred <bilan@ton-domaine.fr> »). */
  EMAIL_FROM?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Racine du chiffrement au repos (emails, jetons Strava). À défaut, la clé privée VAPID sert. */
  DATA_KEY?: string;
  /** Application Strava (strava.com/settings/api) : import des sorties. */
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;

  // Variables (wrangler.jsonc → vars)
  VAPID_SUBJECT?: string;
  MODEL_VISION?: string;
  MODEL_COACH?: string;
  DAILY_AI_LIMIT?: string;
  /** Requêtes IA par jour pour les personnes invitées (0 = API réservée à l'administrateur). */
  GUEST_AI_LIMIT?: string;
  MOCK_AI?: string;
}

/** Erreur renvoyée à l'app : le message (en français, traduit à l'envoi) et ses variables. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public vars?: Record<string, string | number>,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function readJson<T>(req: Request, maxBytes = 6_000_000): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'Requête trop lourde');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Requête trop lourde');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

/** Date et minutes locales dans un fuseau donné. */
export function localTime(now: Date, timeZone: string): { date: string; minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: weekdays.indexOf(get('weekday')),
  };
}
