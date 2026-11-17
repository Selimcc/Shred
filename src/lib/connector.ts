// Le connecteur Shred dans Claude, côté app : les applications autorisées (Réglages, IA), la demande d'accès
// qu'une application ouvre en renvoyant ici (/?connect=…), l'accord ou le refus.
import { useEffect, useState } from 'react';
import { api, DEMO } from './api';
import { uploadBackup } from './backup';
import { getSession, signedIn } from './session';

export interface ConnectedClient {
  id: string;
  name: string;
  /** Domaine vérifié du client (document d'identité publié), sinon null. */
  domain: string | null;
  since: number;
}

export interface ConnectorStatus {
  /** L'adresse à coller dans Claude. */
  url: string;
  clients: ConnectedClient[];
}

/** Ce que l'app montre sur une demande d'accès : qui demande et où partent les accès. */
export interface ConsentInfo {
  name: string;
  domain?: string;
  host: string;
  loopback: boolean;
}

let cached: ConnectorStatus | null = null;
let fetchedAt = 0;
const listeners = new Set<(s: ConnectorStatus | null) => void>();
const publish = (s: ConnectorStatus | null) => {
  cached = s;
  for (const l of listeners) l(s);
};

/** Relit la liste des applications autorisées ; au plus une fois toutes les 5 minutes sans `force` (lecture de KV comptée). */
export async function refreshConnector(force = false): Promise<ConnectorStatus | null> {
  if (DEMO || !signedIn()) return null;
  if (!force && cached && Date.now() - fetchedAt < 5 * 60_000) return cached;
  try {
    const s = await api<ConnectorStatus>('/api/connector');
    fetchedAt = Date.now();
    publish(s);
    return s;
  } catch {
    return cached;
  }
}

/** L'état du connecteur, relu à l'ouverture de l'écran. `null` tant qu'il n'est pas connu (ou sans compte). */
export function useConnector(): ConnectorStatus | null {
  const [s, set] = useState(cached);
  useEffect(() => {
    listeners.add(set);
    void refreshConnector();
    return () => void listeners.delete(set);
  }, []);
  return s;
}

export async function disconnectClient(id: string): Promise<void> {
  await api(`/api/connector/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await refreshConnector(true);
}

export const consentInfo = (handle: string) => api<ConsentInfo>(`/api/oauth/consent?h=${encodeURIComponent(handle)}`, { auth: false });

/**
 * Accepte ou refuse la demande. En acceptant, la dernière version des données part d'abord (Claude lit la
 * sauvegarde), puis la clé de la sauvegarde est confiée pour ce seul accès. Renvoie l'adresse de retour.
 */
export async function decideConsent(handle: string, approve: boolean): Promise<string> {
  const account = getSession().account;
  if (approve) {
    if (!account) throw new Error('Connecte-toi à ton compte Shred pour autoriser l’accès.');
    // Sans écraser une autre version en attente de décision (uploadBackup s'abstient alors).
    await uploadBackup().catch(() => undefined);
  }
  const res = await api<{ redirectTo: string }>('/api/oauth/authorize', {
    body: approve ? { handle, approve: true, key: account!.dataKey } : { handle, approve: false },
  });
  void refreshConnector(true);
  return res.redirectTo;
}
