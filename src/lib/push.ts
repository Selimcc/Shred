import { findSession, scheduleFor } from '../../shared/program';
import { dayKey } from './date';
import { ruleOf } from './logic';
import { api, ApiError, DEMO } from './api';
import { type AppState, getState, setState } from './store';
import { lang, tr } from '../../shared/i18n';

export function pushSupport() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let reason: string | undefined;
  if (DEMO) reason = tr('Les notifications fonctionnent une fois l’app déployée.');
  else if (ios && !standalone)
    reason = tr('Sur iPhone : touche Partager, puis « Sur l’écran d’accueil », et ouvre l’app depuis l’icône.');
  else if (!supported) reason = tr('Ce navigateur ne gère pas les notifications push.');
  return { ios, standalone, supported: supported && !DEMO, reason };
}

export function buildConfig(s: AppState = getState()) {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
    reminders: s.settings.reminders,
    // Les noms dans la langue de l'app : les rappels les reprennent tels quels.
    plan: scheduleFor(s.program, dayKey()).map((id) => tr(findSession(s.program, id).name)),
    lifting: scheduleFor(s.program, dayKey()).map((id) => findSession(s.program, id).type !== 'rest'),
    rest: scheduleFor(s.program, dayKey()).map((id) => findSession(s.program, id).type === 'rest'),
    meals: ruleOf(s).minMeals,
    lang: lang(),
  };
}

function urlB64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + '==='.slice((b64.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  const support = pushSupport();
  if (!support.supported) throw new ApiError(0, support.reason ?? tr('Notifications indisponibles'));
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new ApiError(0, tr('Notifications refusées. Autorise-les dans les réglages du téléphone pour cette app.'));
  }
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Si les clés serveur ont changé, on réabonne.
    const current = sub.options.applicationServerKey;
    const expected = urlB64ToUint8Array(publicKey);
    const same =
      current &&
      new Uint8Array(current).length === expected.length &&
      new Uint8Array(current).every((b, i) => b === expected[i]);
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
  await api('/api/push/subscribe', { body: { subscription: sub.toJSON(), config: buildConfig() } });
  setState((d) => {
    d.settings.pushEnabled = true;
  });
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } finally {
    setState((d) => {
      d.settings.pushEnabled = false;
    });
    await api('/api/push/unsubscribe', { body: {} }).catch(() => undefined);
  }
}

export async function pushConfig(): Promise<void> {
  if (!getState().settings.pushEnabled) return;
  await api('/api/config', { method: 'PUT', body: { config: buildConfig() } });
}

export async function testPush(): Promise<void> {
  await api('/api/push/test', { body: {} });
}
