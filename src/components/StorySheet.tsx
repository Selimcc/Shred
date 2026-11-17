// Après la séance : l'image story prête à partager (Instagram, messages), ou la publication au club.
import { useEffect, useState } from 'react';
import { DEMO } from '../lib/api';
import { sessionSummary } from '../lib/club';
import { parseKey } from '../lib/date';
import { streakInfo } from '../lib/logic';
import { useApp } from '../lib/store';
import { drawStory, shareStory, storyBlob } from '../lib/storyCard';
import { Icon } from './Icon';
import { errorText, Sheet, toast } from './ui';
import { loc, tr } from '../../shared/i18n';

export function StorySheet({ date, onClose }: { date: string; onClose: () => void }) {
  const s = useApp();
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const sum = sessionSummary(s, date);

  useEffect(() => {
    if (!sum) return;
    let url = '';
    let live = true;
    const dateLabel = parseKey(date).toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
    drawStory(sum, { name: s.settings.name, streak: streakInfo(s, date).current, dateLabel: dateLabel[0].toUpperCase() + dateLabel.slice(1) })
      .then(storyBlob)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setImg({ url, blob });
      })
      .catch((e) => toast(errorText(e), true));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // L'image se dessine une fois à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <Sheet title={tr('Partager ta séance')} onClose={onClose}>
      {!sum ? (
        <p className="muted">{tr('Termine au moins une série pour créer ta carte.')}</p>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="story-preview">{img ? <img src={img.url} alt={tr('Carte de la séance {title}', { title: sum.title })} /> : <span className="sk-block" />}</div>
          <button
            className="btn primary block"
            disabled={!img || busy}
            onClick={async () => {
              if (!img) return;
              setBusy(true);
              const r = await shareStory(img.blob, sum.title).catch(() => 'cancelled' as const);
              setBusy(false);
              if (r === 'saved') toast(tr('Image enregistrée'));
            }}
          >
            <Icon name="share" size={18} />{' '}{tr('Partager en story')}
          </button>
          {!DEMO && (
            <button
              className="btn block"
              onClick={() => {
                onClose();
                window.dispatchEvent(new CustomEvent('shred:share', { detail: { date } }));
              }}
            >
              <Icon name="users" size={18} />{' '}{tr('Publier au club')}
            </button>
          )}
          <p className="small faint" style={{ margin: 0, textAlign: 'center' }}>
            {tr('L’image est créée sur ton téléphone. Dans le menu de partage, choisis Instagram puis « Story ».')}
          </p>
        </div>
      )}
    </Sheet>
  );
}
