// Export du « dossier » pour un Projet Claude : la mémoire longue du coach, sans clé API.
import { copyText } from './form';
import { Icon } from './Icon';
import { toast } from './ui';
import { dossierMarkdown, PROJECT_INSTRUCTIONS } from '../lib/knowledge';
import { getState } from '../lib/store';

async function exportDossier(today: string) {
  const text = dossierMarkdown(getState(), today);
  const name = `dossier-shred-${today}.md`;
  const file = new File([text], name, { type: 'text/markdown' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Dossier Shred' });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Dossier téléchargé');
  } catch {
    if (await copyText(text)) toast('Dossier copié');
  }
}

export function DossierCard({ today }: { today: string }) {
  const size = dossierMarkdown(getState(), today).length;
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 850 }}>
        <Icon name="book" size={20} /> Mémoire longue dans Claude
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Crée un Projet « Coach Shred » dans Claude (aussi sur le plan gratuit), colle les instructions et ajoute ton dossier à ses connaissances.
        Claude a alors tout ton historique sous la main, sans clé API. Réexporte-le de temps en temps.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn small primary" onClick={() => exportDossier(today)}>
          <Icon name="share" size={16} /> Exporter mon dossier
        </button>
        <button className="btn small" onClick={async () => (await copyText(PROJECT_INSTRUCTIONS)) && toast('Instructions copiées')}>
          Copier les instructions
        </button>
        <button className="btn small" onClick={async () => (await copyText(dossierMarkdown(getState(), today))) && toast('Dossier copié')}>
          Copier le dossier
        </button>
      </div>
      <p className="small faint" style={{ margin: 0 }}>
        Environ {Math.max(1, Math.round(size / 3500))} k tokens : ça tient dans un projet, même gratuit.
      </p>
    </div>
  );
}
