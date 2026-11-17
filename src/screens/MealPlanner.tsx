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
import { loc, tr } from '../../shared/i18n';

export function shoppingText(prep: MealPrep): string {
  return [tr('Courses Shred ({days} jours)', { days: prep.days }), ...prep.shopping.flatMap((s) => [`\n${s.section}`, ...s.items.map((i) => `- ${i}`)])].join('\n');
}

export function PrepView({ prep }: { prep: MealPrep }) {
  return (
    <div className="stack" style={{ gap: 18 }}>
      {prep.batches.map((b) => (
        <section className="stack" key={b.when}>
          <h2>{b.when}</h2>
          <div className="group">
            {b.recipes.map((rc) => (
              <div className="row" key={rc.name} style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="title">
                    {rc.name} <span className="tag num">× {rc.portions}</span>
                  </div>
                  <div className="small muted">{tr('Par boîte : {detail}', { detail: rc.detail })}</div>
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
          <h2>{tr('Liste de courses')}</h2>
          <button className="link small" onClick={async () => (await copyText(shoppingText(prep))) && toast(tr('Liste copiée'))}>
            {tr('Copier')}
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
          {tr('Un plan de repas calé sur tes {n} kcal et {protein} g de protéines, selon tes préférences (Réglages, Profil sportif) : deux plats à préparer le dimanche, deux le mercredi, petit-déjeuner et collation simples. Les repas deviennent tes repas prévus, cochables en un tap.', { n: formatNumber(t.kcal), protein: t.protein })}
        </p>
        <button className="btn primary block" onClick={() => setDraft(buildMealPlan(seed))}>
          <Icon name="utensils" size={18} /> {s.prep ? tr('Générer un nouveau plan') : tr('Générer mon meal plan')}
        </button>
        {s.prep && (
          <>
            <p className="small faint" style={{ margin: 0 }}>
              {tr('Plan en cours depuis le {toLocaleDateString}.', { toLocaleDateString: new Date(`${s.prep.createdAt}T12:00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) })}
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
          {tr('Journée type : {n} kcal · {protein} g de protéines', { n: formatNumber(day.kcal), protein: day.protein })}
        </div>
        <div className="small muted">
          {tr('Objectif {n} kcal et {protein} g ({gap} %). Glucides {carbs} g, lipides {fat} g.', { n: formatNumber(t.kcal), protein: t.protein, gap: `${gap > 0 ? '+' : ''}${gap}`, carbs: day.carbs, fat: day.fat })}
        </div>
      </div>
      {SLOTS.filter((sl) => draft.meals.some((m) => m.slot === sl.id)).map((sl) => (
        <section key={sl.id} className="stack">
          <h2>
            {sl.name}
            {draft.meals.filter((m) => m.slot === sl.id).length > 1 ? tr(' (au choix)') : ''}
          </h2>
          <div className="group">
            {draft.meals
              .filter((m) => m.slot === sl.id)
              .map((m) => (
                <div className="row" key={m.id} style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="title">{tr(m.label)}</div>
                    <div className="small muted">{tr(m.detail)}</div>
                    <div className="small faint num">
                      {tr('{kcal} kcal, {protein} g P, {carbs} g G, {fat} g L', { kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat })}
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
          {tr('Autre plan')}
        </button>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          onClick={async () => {
            if (s.mealPlan.some((m) => !m.id.startsWith('gen-') && m.slot !== 'extra') && !(await ask(tr('Remplacer tes repas prévus par ce plan ?'), tr('Remplacer')))) return;
            applyMealPlan(draft);
            setDraft(null);
            toast(tr('Meal plan enregistré : tes repas prévus sont à jour'));
          }}
        >
          {tr('Utiliser ce plan')}
        </button>
      </div>
    </div>
  );
}
