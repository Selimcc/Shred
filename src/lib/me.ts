// Ma fiche de membre (identifiant et version de la photo), gardée sur le téléphone : la photo s'affiche
// tout de suite dans les Réglages, puis se met à jour après une lecture de la liste des membres.
import { useEffect, useState } from 'react';
import { DEMO } from './api';
import { club } from './club';
import { signedIn } from './session';

export interface Me {
  id: string;
  avatar: string | null;
}

const KEY = 'shred:me';
const listeners = new Set<(m: Me | null) => void>();
let current: Me | null = read();
let fetched = false;

function read(): Me | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.id === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function setMe(m: Me | null) {
  current = m;
  try {
    if (m) localStorage.setItem(KEY, JSON.stringify(m));
    else localStorage.removeItem(KEY);
  } catch {
    // Stockage indisponible : la photo sera relue au prochain lancement.
  }
  listeners.forEach((l) => l(m));
}

/** Ma fiche, et une relecture discrète une fois par lancement de l'app. */
export function useMe(): Me | null {
  const [m, setM] = useState(current);
  useEffect(() => {
    listeners.add(setM);
    if (!fetched && (DEMO || signedIn())) {
      fetched = true;
      club.members().then(
        (r) => {
          const mine = r.members.find((x) => x.me);
          if (mine && (mine.id !== current?.id || mine.avatar !== current?.avatar)) setMe({ id: mine.id, avatar: mine.avatar });
        },
        () => (fetched = false),
      );
    }
    return () => void listeners.delete(setM);
  }, []);
  return m;
}
