// Envoi du bilan de la semaine par mail, via Resend (https://resend.com), si le serveur est configuré.
// Le bilan est calculé sur le téléphone (les données sont chiffrées ici) : la personne l'envoie elle-même.
import { type Env, HttpError, json, readJson } from './env';
import type { User } from './users';
import { requestLang, tx } from './i18n';

export const emailReady = (env: Env) => Boolean(env.RESEND_API_KEY);

interface Body {
  week?: string;
  subject?: string;
  html?: string;
  text?: string;
}

export async function sendReport(req: Request, env: Env, user: User): Promise<Response> {
  if (!emailReady(env)) throw new HttpError(503, 'L’envoi de mails n’est pas configuré sur ce serveur.');
  const b = await readJson<Body>(req, 120_000);
  const week = String(b.week ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new HttpError(400, 'Semaine invalide');
  if (typeof b.html !== 'string' || b.html.length > 100_000 || typeof b.text !== 'string') throw new HttpError(400, 'Bilan invalide');
  const subject = String(b.subject ?? tx(requestLang(req), 'Ton bilan de la semaine')).slice(0, 120);

  // Un mail par semaine, plus 2 renvois manuels maximum par jour.
  const sentKey = `mail:${week}`;
  const already = await user.store.get(sentKey);
  const dayKey = `mail-day:${new Date().toISOString().slice(0, 10)}`;
  const today = Number((await user.store.get(dayKey)) ?? 0);
  if (already && today >= 2) throw new HttpError(429, 'Bilan déjà envoyé aujourd’hui');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'idempotency-key': `${user.id}-${week}-${today}`,
    },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Shred <onboarding@resend.dev>', to: [user.email], subject, html: b.html, text: b.text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Resend', res.status, detail.slice(0, 300));
    throw res.status === 403 ? new HttpError(502, 'Mail refusé : sans domaine vérifié, Resend n’envoie qu’à l’adresse de ton compte Resend.') : new HttpError(502, 'Envoi refusé ({status})', { status: res.status });
  }
  await Promise.all([
    user.store.put(sentKey, new Date().toISOString(), { expirationTtl: 60 * 86400 }),
    user.store.put(dayKey, String(today + 1), { expirationTtl: 2 * 86400 }),
  ]);
  return json({ ok: true });
}
