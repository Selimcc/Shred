// Meal plan généré : repas du jour type, préparation du dimanche et du mercredi, liste de courses.
import { useState } from 'react';
import type { MealPrep } from '../../shared/meals';
import { SLOTS } from '../../shared/program';
import { copyText } from '../components/form';
import { Icon } from '../components/Icon';
import { ask, toast } from '../components/ui';
import { applyMealPlan, buildMealPlan } from '../lib/coaching';
import { formatNumber } from '../lib/date';
import { useApp } from '../lib/store';

export function shoppingText(prep: MealPrep): string {
  return [`Courses Shred (${prep.days} jours)`, ...prep.shopping.flatMap((s) => [`\n${s.section}`, ...s.items.map((i) => `- ${i}`)])].join('\n');
}

export function PrepView({ prep }: { prep: MealPrep }) {
  return (
    <div className="stack" style={{ gap: 18 }}>
      {prep.batches.map((b) => (
        <section className="stack" key={b.when}>
          <h2>Préparation du {b.when.toLowerCase()}</h2>
          <div className="group">
            {b.recipes.map((rc) => (
              <div className="row" key={rc.name} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="title">
                    {rc.name} <span className="tag num">× {rc.portions}</span>
                  </div>
                  <div className="small muted">Par boîte : {rc.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.5 }}>
            {b.steps.map((st) => (
              <li key={st}>{st}</li>
            ))}
          </ol>
        </section>
      ))}
      <section className="stack">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2>Liste de courses</h2>
          <button className="link small" onClick={async () => (await copyText(shoppingText(prep))) && toast('Liste copiée')}>
            Copier
          </button>
        </div>
        {prep.shopping.map((sec) => (
          <div key={sec.section}>
            <div className="small faint" style={{ fontWeight: 800, marginBottom: 4 }}>
              {sec.section}
            </div>
            <div className="small" style={{ lineHeight: 1.6 }}>
              {sec.items.map((i) => (
                <div key={i}>{i}</div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export function MealPlanner() {
  const s = useApp();
  const [seed, setSeed] = useState(0);
  const [draft, setDraft] = useState<ReturnType<typeof buildMealPlan> | null>(null);
  const t = s.settings.targets;

  if (!draft) {
    return (
      <div className="stack" style={{ gap: 18 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Un plan de repas calé sur tes {formatNumber(t.kcal)} kcal et {t.protein} g de protéines, selon tes préférences (Réglages, Profil sportif) : deux
          plats à préparer le dimanche, deux le mercredi, petit-déjeuner et collation simples. Les repas deviennent tes repas prévus, cochables en un tap.
        </p>
        <button className="btn primary block" onClick={() => setDraft(buildMealPlan(seed))}>
          <Icon name="utensils" size={18} /> {s.prep ? 'Générer un nouveau plan' : 'Générer mon meal plan'}
        </button>
        {s.prep && (
          <>
            <p className="small faint" style={{ margin: 0 }}>
              Plan en cours depuis le {new Date(`${s.prep.createdAt}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.
            </p>
            <PrepView prep={s.prep} />
          </>
        )}
      </div>
    );
  }

  const day = draft.prep.day;
  const gap = Math.round(((day.kcal - t.kcal) / t.kcal) * 100);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card stack" style={{ gap: 4 }}>
        <div style={{ fontWeight: 850 }}>
          Journée type : {formatNumber(day.kcal)} kcal · {day.protein} g de protéines
        </div>
        <div className="small muted">
          Objectif {formatNumber(t.kcal)} kcal et {t.protein} g ({gap > 0 ? '+' : ''}
          {gap} %). Glucides {day.carbs} g, lipides {day.fat} g.
        </div>
      </div>
      {SLOTS.filter((sl) => draft.meals.some((m) => m.slot === sl.id)).map((sl) => (
        <section key={sl.id} className="stack">
          <h2>
            {sl.name}
            {draft.meals.filter((m) => m.slot === sl.id).length > 1 ? ' (au choix)' : ''}
          </h2>
          <div className="group">
            {draft.meals
              .filter((m) => m.slot === sl.id)
              .map((m) => (
                <div className="row" key={m.id} style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="title">{m.label}</div>
                    <div className="small muted">{m.detail}</div>
                    <div className="small faint num">
                      {m.kcal} kcal, {m.protein} g P, {m.carbs} g G, {m.fat} g L
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
      <PrepView prep={draft.prep} />
      <div style={{ display: 'flex', gap: 10, position: 'sticky', bottom: 0, paddingTop: 8, background: 'var(--bg)' }}>
        <button
          className="btn"
          onClick={() => {
            setSeed(seed + 1);
            setDraft(buildMealPlan(seed + 1));
          }}
        >
          Autre plan
        </button>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          onClick={async () => {
            if (s.mealPlan.some((m) => !m.id.startsWith('gen-') && m.slot !== 'extra') && !(await ask('Remplacer tes repas prévus par ce plan ?', 'Remplacer'))) return;
            applyMealPlan(draft);
            setDraft(null);
            toast('Meal plan enregistré : tes repas prévus sont à jour');
          }}
        >
          Utiliser ce plan
        </button>
      </div>
    </div>
  );
}
