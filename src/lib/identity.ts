// Mon identité dans le club : prénom, @pseudo, surnom, bio. Gérée par le serveur (unicité du pseudo).
import { api, DEMO } from './api';
import { setState } from './store';

export interface Identity {
  name: string;
  handle: string;
  nick: string;
  bio: string;
  email: string;
  handleChangesLeft: number;
  nextHandleChange: string | null;
}

export interface HandleCheck {
  handle: string;
  ok: boolean;
  mine?: boolean;
  reason?: string;
  suggestions?: string[];
}

// Démo : rien ne part au serveur, tout reste dans la page.
let demoIdentity: Identity = {
  name: 'Toi',
  handle: 'toi',
  nick: '',
  bio: '',
  email: 'demo@exemple.com',
  handleChangesLeft: 2,
  nextHandleChange: null,
};
const DEMO_TAKEN = ['camille.run', 'yanis_ppl', 'ines.swim', 'leo.velo', 'selim'];

export function getIdentity(): Promise<Identity> {
  if (DEMO) return Promise.resolve({ ...demoIdentity });
  return api<Identity>('/api/account/identity');
}

export async function checkHandle(h: string): Promise<HandleCheck> {
  if (DEMO) {
    const taken = DEMO_TAKEN.includes(h);
    return taken
      ? {
          handle: h,
          ok: false,
          reason: 'Ce pseudo est déjà pris',
          suggestions: [`${h}.fit`, `${h}_26`, `${h}.shred`],
        }
      : { handle: h, ok: true, mine: h === demoIdentity.handle };
  }
  return api<HandleCheck>(`/api/account/handle?h=${encodeURIComponent(h)}`);
}

export async function saveIdentity(patch: Partial<Pick<Identity, 'name' | 'handle' | 'nick' | 'bio'>>): Promise<Identity> {
  const next = DEMO
    ? (demoIdentity = { ...demoIdentity, ...patch })
    : await api<Identity>('/api/account/identity', {
        method: 'PUT',
        body: patch,
      });
  // Le prénom affiché dans l'app suit celui du compte.
  setState((d) => void (d.settings.name = next.name));
  return { ...next };
}
