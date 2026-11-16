// Salles autour de soi (OpenStreetMap, partout dans le monde) et proposition de séance en arrivant.
import type { GymPlace } from '../../shared/athlete';
import { api, DEMO } from './api';

export interface Place extends GymPlace {
  brand?: string;
  distance: number;
}

const DEMO_PLACES: Place[] = [
  { id: 'osm:n1', name: 'Fitness Park Sartrouville', lat: 48.94, lon: 2.16, address: 'Avenue Jean Jaurès, Sartrouville', distance: 650 },
  { id: 'osm:n2', name: 'Basic-Fit Maisons-Laffitte', lat: 48.95, lon: 2.15, address: 'Rue de Paris, Maisons-Laffitte', distance: 1200 },
  { id: 'osm:n3', name: 'Iron Club', lat: 48.93, lon: 2.17, distance: 2100 },
];

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);

/** Position du téléphone (la permission est demandée la première fois). */
export function locate(timeout = 12_000): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Ce téléphone ne donne pas sa position. Cherche ta ville à la place.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Localisation refusée. Autorise-la dans les réglages du téléphone, ou cherche ta ville.'
              : 'Position introuvable pour l’instant. Réessaie, ou cherche ta ville.',
          ),
        ),
      { enableHighAccuracy: false, timeout, maximumAge: 5 * 60_000 },
    );
  });
}

export async function gymsAround(p: { lat: number; lon: number }, q = ''): Promise<Place[]> {
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 300));
    return DEMO_PLACES.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
  }
  const r = await api<{ places: Place[] }>(`/api/places/gyms?lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return r.places;
}

export async function geocode(q: string): Promise<{ lat: number; lon: number; label: string }> {
  if (DEMO) return { lat: 48.947, lon: 2.147, label: q };
  return api('/api/places/geocode?q=' + encodeURIComponent(q));
}

/** La permission de localisation est-elle déjà accordée ? (pour ne jamais la demander sans action de la personne) */
export async function locationGranted(): Promise<boolean> {
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return st?.state === 'granted';
  } catch {
    return false;
  }
}

const ARRIVAL_KEY = 'shred:arrival-asked';

/**
 * À l'ouverture de l'app : si la localisation est déjà autorisée et qu'on est à moins de 150 m de sa salle,
 * on propose la séance (une fois par jour au plus).
 */
export async function atGym(place: GymPlace | undefined, today: string): Promise<boolean> {
  if (!place) return false;
  try {
    if (localStorage.getItem(ARRIVAL_KEY) === today) return false;
  } catch {
    return false;
  }
  if (!(await locationGranted())) return false;
  const here = await locate(8000).catch(() => null);
  if (!here || distanceM(here, place) > 150) return false;
  try {
    localStorage.setItem(ARRIVAL_KEY, today);
  } catch {
    // Pas de stockage : la proposition pourra revenir, sans gravité.
  }
  return true;
}
