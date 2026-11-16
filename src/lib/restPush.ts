// Notification de fin de repos envoyée par le serveur : elle arrive même téléphone verrouillé.
// Si l'app est à l'écran à la fin du repos, on l'annule (le minuteur à l'écran suffit).
import { api, DEMO } from './api';
import { signedIn } from './session';
import { getState } from './store';

const enabled = () => !DEMO && signedIn() && getState().settings.pushEnabled;

export function scheduleRestPush(seconds: number, next?: string) {
  if (!enabled() || seconds < 10) return;
  void api('/api/push/rest', { body: { seconds: Math.round(seconds), next } }).catch(() => undefined);
}

export function cancelRestPush() {
  if (!enabled()) return;
  void api('/api/push/rest', { method: 'DELETE' }).catch(() => undefined);
}
