// Trouver sa salle sur la carte, où qu'on soit : autour de soi (localisation), ou autour d'une ville tapée.
// Les résultats viennent d'OpenStreetMap ; une salle absente de la carte peut toujours être nommée à la main.
import { useEffect, useRef, useState } from 'react';
import type { GymPlace } from '../../shared/athlete';
import { errorText } from './ui';
import { Icon } from './Icon';
import { fmtDistance, geocode, gymsAround, locate, type Place } from '../lib/places';
import { DEMO } from '../lib/api';
import { signedIn } from '../lib/session';

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'list'; around: string } | { kind: 'error'; text: string };

export function GymFinder({ onPick }: { onPick: (p: GymPlace & { brand?: string }) => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [places, setPlaces] = useState<Place[]>([]);
  const [filter, setFilter] = useState('');
  const [city, setCity] = useState('');
  const center = useRef<{ lat: number; lon: number } | null>(null);
  const online = DEMO || signedIn();

  const search = async (p: { lat: number; lon: number }, around: string, q = '') => {
    center.current = p;
    setStatus({ kind: 'busy', text: q ? `Recherche de « ${q} »…` : 'Recherche des salles autour…' });
    try {
      const list = await gymsAround(p, q);
      setPlaces(list);
      setStatus({ kind: 'list', around });
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) });
    }
  };

  const nearMe = async () => {
    setStatus({ kind: 'busy', text: 'Localisation…' });
    try {
      await search(await locate(), 'autour de toi');
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) });
    }
  };

  const byCity = async () => {
    if (city.trim().length < 2) return;
    setStatus({ kind: 'busy', text: 'Recherche de la ville…' });
    try {
      const g = await geocode(city.trim());
      await search(g, `autour de ${g.label.split(',')[0]}`);
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) });
    }
  };

  // Un nom tapé dans le filtre : recherche plus large (25 km) sur la carte si la liste ne le contient pas.
  useEffect(() => {
    const q = filter.trim();
    if (status.kind !== 'list' || q.length < 3 || !center.current) return;
    if (places.some((p) => p.name.toLowerCase().includes(q.toLowerCase()))) return;
    const t = setTimeout(() => void search(center.current!, status.around, q), 600);
    return () => clearTimeout(t);
  }, [filter]);

  if (!online) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        La recherche de salle sur la carte demande un compte. Tu peux écrire le nom de ta salle ci-dessous.
      </p>
    );
  }

  const shown = places.filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="stack gym-finder" style={{ gap: 12 }}>
      <button className="btn primary block" onClick={nearMe} disabled={status.kind === 'busy'}>
        <Icon name="pin" size={18} /> Trouver ma salle autour de moi
      </button>
      <form
        className="row-form"
        onSubmit={(e) => {
          e.preventDefault();
          void byCity();
        }}
      >
        <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ou tape une ville" aria-label="Ville" />
        <button className="btn" disabled={city.trim().length < 2 || status.kind === 'busy'}>
          Chercher
        </button>
      </form>

      {status.kind === 'busy' && (
        <p className="small muted" style={{ margin: 0 }}>
          {status.text}
        </p>
      )}
      {status.kind === 'error' && (
        <p className="small" style={{ margin: 0, color: 'var(--red)' }}>
          {status.text}
        </p>
      )}

      {status.kind === 'list' && (
        <>
          <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer par nom" aria-label="Filtrer les salles" />
          {shown.length ? (
            <div className="group gym-results">
              {shown.slice(0, 12).map((p) => (
                <button key={p.id} className="row settings-row" onClick={() => onPick(p)}>
                  <span className="settings-icon">
                    <Icon name="dumbbell" size={17} />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="title ellipsis">{p.name}</div>
                    <div className="small muted ellipsis">{[fmtDistance(p.distance), p.address].filter(Boolean).join(', ')}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Aucune salle trouvée {status.around}
              {filter.trim() ? ` avec « ${filter.trim()} »` : ''}.
            </p>
          )}
          <p className="small faint" style={{ margin: 0 }}>
            Carte : © contributeurs OpenStreetMap.
          </p>
        </>
      )}
    </div>
  );
}
