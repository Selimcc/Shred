// Minuteur de repos côté serveur : une alarme Durable Object par personne envoie la notification
// à la seconde près, même si le téléphone est verrouillé et l'app en veille.
import { type Env, HttpError, json, readJson } from './env';
import { vapidFromEnv } from './reminders';
import { loadJson, type User, userStore } from './users';
import { type PushSubscriptionData, sendPush } from './webpush';

interface Job {
  userId: string;
  at: number;
  title: string;
  body: string;
}

/** Bornes du repos programmable : de 10 secondes à 15 minutes. */
export const REST_MIN = 10;
export const REST_MAX = 900;

export class RestTimer {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/start') {
      const job = (await req.json()) as Job;
      await this.state.storage.put('job', job);
      await this.state.storage.setAlarm(job.at);
      return new Response('ok');
    }
    if (pathname === '/cancel') {
      await this.state.storage.deleteAlarm();
      await this.state.storage.delete('job');
      return new Response('ok');
    }
    return new Response('route inconnue', { status: 404 });
  }

  async alarm(): Promise<void> {
    const job = await this.state.storage.get<Job>('job');
    await this.state.storage.delete('job');
    if (!job) return;
    const vapid = vapidFromEnv(this.env);
    const store = userStore(this.env.KV, job.userId);
    const sub = await loadJson<PushSubscriptionData>(store, 'sub');
    if (!vapid || !sub) return;
    const res = await sendPush(sub, { title: job.title, body: job.body, tag: 'rest', url: '/?tab=workout' }, vapid, { urgency: 'high', ttl: 120 });
    if (res.gone) await store.delete('sub');
  }
}

function stubFor(env: Env, user: User) {
  if (!env.TIMERS) throw new HttpError(503, 'Minuteur serveur non configuré');
  return env.TIMERS.get(env.TIMERS.idFromName(user.id));
}

/** POST : programme la fin du repos ; DELETE : l'annule (repos passé, ou app ouverte à la fin). */
export async function restRoute(req: Request, env: Env, user: User): Promise<Response> {
  const stub = stubFor(env, user);
  if (req.method === 'DELETE') {
    await stub.fetch('https://timer/cancel', { method: 'POST' });
    return json({ ok: true });
  }
  const body = await readJson<{ seconds?: number; next?: string }>(req, 2_000);
  const seconds = Math.round(Number(body.seconds));
  if (!Number.isFinite(seconds) || seconds < REST_MIN || seconds > REST_MAX) throw new HttpError(400, `Repos entre ${REST_MIN} s et ${REST_MAX / 60} min`);
  const next = typeof body.next === 'string' ? body.next.slice(0, 80) : '';
  const job: Job = {
    userId: user.id,
    at: Date.now() + seconds * 1000,
    title: 'Repos terminé',
    body: next ? `À toi : ${next}` : 'Série suivante, c’est parti.',
  };
  await stub.fetch('https://timer/start', { method: 'POST', body: JSON.stringify(job) });
  return json({ ok: true, at: job.at });
}
