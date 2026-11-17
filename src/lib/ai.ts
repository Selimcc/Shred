// Les trois façons d'utiliser l'IA : API Claude (automatique), app Claude (gratuit avec un abonnement), aucune.
import { athleteSummary, WEIGHT_GOALS } from '../../shared/athlete';
import { formatLong, formatNumber } from './date';
import { type Hit, programText } from './knowledge';
import { mealsCount, sessionFor, setProgress, streakInfo, totals, weeklyChange } from './logic';
import { type AppState, readDay } from './store';
import { strengthProfile } from './strength';

export { programText };

/** Contexte court, qui tient dans un lien vers l'app Claude. */
export function compactContext(s: AppState, today: string): string {
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const prog = setProgress(session, day);
  const st = streakInfo(s, today);
  const p = s.settings;
  const lines: string[] = [];
  const profile = [p.name, p.age ? `${p.age} ans` : '', p.height ? `${p.height} cm` : ''].filter(Boolean).join(', ');
  if (profile) lines.push(`Moi : ${profile}.`);
  if (p.coachNotes.trim()) lines.push(p.coachNotes.trim().slice(0, 400));
  lines.push(`Objectif : ${WEIGHT_GOALS[p.weightGoal].label.toLowerCase()}. ${athleteSummary(p.athlete, p.gym)}`.slice(0, 500));
  lines.push(`Aujourd'hui (${formatLong(today)}) : séance ${session.name} (${session.focus}), ${prog.done}/${prog.total} séries faites.`);
  if (p.modules.nutrition) {
    const t = totals(day);
    lines.push(`Mangé : ${t.kcal}/${p.targets.kcal} kcal, ${t.protein}/${p.targets.protein} g de protéines, ${mealsCount(day)} repas.`);
  }
  const h = s.health[today];
  if (h?.steps !== undefined) lines.push(`Pas : ${h.steps}.`);
  const kg = Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a))[0];
  if (kg) {
    const wc = weeklyChange(s, today);
    lines.push(`Poids : ${formatNumber(kg[1], 1)} kg${wc !== null ? ` (${wc > 0 ? '+' : ''}${formatNumber(wc, 2)} kg/sem)` : ''}.`);
  }
  if (p.modules.strength) {
    const sp = strengthProfile(s, today);
    if (sp.weakest) lines.push(`Point faible : ${sp.weakest.name.toLowerCase()} (${sp.weakest.grade}).`);
  }
  lines.push(`Série : ${st.current} jours.`);
  return lines.join('\n');
}

/** Longueur maximale d'un lien vers l'app Claude, une fois encodé. */
export const LINK_BUDGET = 6000;
const linkLength = (text: string) => `https://claude.ai/new?q=${encodeURIComponent(text)}`.length;

/**
 * La question pour l'app Claude : contexte du jour, puis autant d'extraits d'historique
 * (choisis par la recherche locale) que le lien peut en porter.
 */
export function claudePrompt(s: AppState, today: string, question: string, memory: Hit[] = []): string {
  const head = `Tu es mon coach muscu et nutrition. Réponds en français, court et concret.\n\n${compactContext(s, today)}`;
  const tail = `\n\nMa question : ${question}`;
  const blocks: string[] = [];
  for (const h of memory) {
    const block = `[${h.doc.title}]\n${h.doc.text}`;
    const candidate = `${head}\n\nExtraits de mon historique :\n${[...blocks, block].join('\n\n')}${tail}`;
    if (linkLength(candidate) <= LINK_BUDGET) blocks.push(block);
  }
  return blocks.length ? `${head}\n\nExtraits de mon historique :\n${blocks.join('\n\n')}${tail}` : `${head}${tail}`;
}

export function mealPhotoPrompt(slotName: string, note?: string): string {
  return `Estime les calories et les macros du repas sur la photo que je t'envoie (${slotName.toLowerCase()}${note ? `, ${note}` : ''}). Donne une ligne par aliment avec le poids estimé, puis le total au format : kcal / protéines g / glucides g / lipides g.`;
}

/**
 * Ouvre l'app Claude avec la question déjà écrite. Si le texte est trop long pour un lien,
 * il est copié et il suffit de le coller.
 */
export async function openInClaude(prompt: string): Promise<'link' | 'copied'> {
  const url = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  if (url.length <= LINK_BUDGET) {
    window.open(url, '_blank', 'noopener');
    return 'link';
  }
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    // Copie refusée : on ouvre quand même Claude.
  }
  window.open('https://claude.ai/new', '_blank', 'noopener');
  return 'copied';
}
