// Photos de physique : face, profil, dos, une fois par semaine, et la comparaison côte à côte.
// En recompo la balance bouge peu ; les photos et le tour de taille montrent ce qui change vraiment.
// Les images restent sur ce téléphone (IndexedDB) : elles ne partent jamais sur le serveur.
import { useEffect, useRef, useState } from 'react';
import { addDays, dayKey, diffDays, formatNumber, formatShort } from '../lib/date';
import { prepareImage } from '../lib/image';
import { deletePhoto, loadPhoto, savePhoto } from '../lib/photos';
import { type AppState, type BodyPhoto, type Pose, setState, useApp } from '../lib/store';
import { Icon } from './Icon';
import { ask, toast } from './ui';

export const POSES: { id: Pose; label: string }[] = [
  { id: 'front', label: 'Face' },
  { id: 'side', label: 'Profil' },
  { id: 'back', label: 'Dos' },
];

/** Une photo de physique est-elle attendue cette semaine ? */
export function photoDue(s: AppState, today: string): boolean {
  const last = (s.body.photos ?? []).map((p) => p.date).sort().pop();
  return !last || diffDays(today, last) >= 7;
}

function nearest<T>(map: Record<string, T>, date: string, within = 4): T | undefined {
  let best: [number, T] | undefined;
  for (const [d, v] of Object.entries(map)) {
    const gap = Math.abs(diffDays(d, date));
    if (gap <= within && (!best || gap < best[0])) best = [gap, v];
  }
  return best?.[1];
}

function PhotoImg({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState<string>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let objectUrl: string | undefined;
    let dead = false;
    loadPhoto(id)
      .then((b) => {
        if (dead) return;
        if (!b) return setMissing(true);
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => setMissing(true));
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (missing) return <div className="body-photo empty-photo small faint">Photo sur un autre appareil</div>;
  return url ? <img className="body-photo" src={url} alt={alt} /> : <div className="body-photo" />;
}

export function BodyPhotos({ today }: { today: string }) {
  const s = useApp();
  const photos = s.body.photos ?? [];
  const [pose, setPose] = useState<Pose>('front');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const dates = [...new Set(photos.filter((p) => p.pose === pose).map((p) => p.date))].sort();
  const [pick, setPick] = useState<{ a?: string; b?: string }>({});
  const a = pick.a && dates.includes(pick.a) ? pick.a : dates[0];
  const b = pick.b && dates.includes(pick.b) ? pick.b : dates[dates.length - 1];
  const photoAt = (d?: string) => photos.find((p) => p.pose === pose && p.date === d);

  const add = async (file: File) => {
    setBusy(true);
    try {
      const { blob } = await prepareImage(file, 1280, 0.82);
      // Photo importée de la galerie : on garde sa date si elle est plausible.
      const taken = file.lastModified ? dayKey(new Date(file.lastModified)) : today;
      const date = taken <= today && diffDays(today, taken) <= 365 ? taken : today;
      const id = `body-${date}-${pose}`;
      await savePhoto(id, blob);
      setState((d) => {
        const list = (d.body.photos ??= []).filter((p) => !(p.date === date && p.pose === pose));
        list.push({ id, date, pose });
        list.sort((x, y) => x.date.localeCompare(y.date));
        d.body.photos = list;
      });
      toast(`Photo du ${formatShort(date)} enregistrée`);
    } catch {
      toast('Impossible de lire cette photo', true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: BodyPhoto) => {
    if (!(await ask(`Supprimer la photo du ${formatShort(p.date)} ?`, 'Supprimer', true))) return;
    await deletePhoto(p.id);
    setState((d) => void (d.body.photos = (d.body.photos ?? []).filter((x) => x.id !== p.id)));
  };

  const stat = (d?: string) => {
    if (!d) return '';
    const kg = nearest(s.body.weight, d);
    const cm = nearest(s.body.waist, d);
    return [kg !== undefined ? `${formatNumber(kg, 1)} kg` : '', cm !== undefined ? `${formatNumber(cm, 1)} cm de taille` : ''].filter(Boolean).join(', ');
  };

  const pa = photoAt(a);
  const pb = photoAt(b);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Physique</h2>
        <span className="small muted">Reste sur ce téléphone</span>
      </div>
      <div className="seg" role="tablist" aria-label="Pose" style={{ marginBottom: 12 }}>
        {POSES.map((p) => (
          <button key={p.id} type="button" className={pose === p.id ? 'on' : ''} onClick={() => setPose(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {dates.length >= 2 && pa && pb ? (
        <>
          <div className="compare">
            {[
              [a, pa],
              [b, pb],
            ].map(([d, p]) => (
              <figure key={(p as BodyPhoto).id}>
                <PhotoImg id={(p as BodyPhoto).id} alt={`Physique, ${formatShort(d as string)}`} />
                <figcaption>
                  <b>{formatShort(d as string)}</b>
                  <span>{stat(d as string)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="small muted" style={{ margin: '10px 2px 0' }}>
            {diffDays(b!, a!)} jours d’écart.
            {(() => {
              const ca = nearest(s.body.waist, a!);
              const cb = nearest(s.body.waist, b!);
              return ca !== undefined && cb !== undefined ? ` Tour de taille : ${cb - ca > 0 ? '+' : ''}${formatNumber(cb - ca, 1)} cm.` : '';
            })()}
          </p>
          <div className="photo-strip" aria-label="Choisir les dates à comparer">
            {dates.map((d) => (
              <button
                key={d}
                type="button"
                className={`chip ${d === a || d === b ? 'on' : ''}`}
                onClick={() => setPick(d < (b ?? d) ? { a: d, b } : { a, b: d })}
              >
                {formatShort(d)}
              </button>
            ))}
          </div>
        </>
      ) : dates.length === 1 && pa ? (
        <div className="compare">
          <figure>
            <PhotoImg id={pa.id} alt={`Physique, ${formatShort(dates[0])}`} />
            <figcaption>
              <b>{formatShort(dates[0])}</b>
              <span>{stat(dates[0])}</span>
            </figcaption>
          </figure>
          <figure className="compare-next">
            <span className="small muted">Ta prochaine photo le {formatShort(addDays(dates[0], 7))} apparaîtra ici, à côté.</span>
          </figure>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Une photo par semaine, même lumière, même heure (le matin à jeun), même distance. C’est le meilleur juge de ta recompo, bien plus que la balance.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
          <Icon name="camera" size={18} /> {busy ? 'Enregistrement…' : `Ajouter une photo de ${POSES.find((p) => p.id === pose)!.label.toLowerCase()}`}
        </button>
        {photoAt(today) && (
          <button className="btn small danger" onClick={() => remove(photoAt(today)!)}>
            Supprimer celle du jour
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void add(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}
