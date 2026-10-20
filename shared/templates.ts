// Modèles de programmes. Pour en ajouter un : un objet de plus dans TEMPLATES.
import type { ExerciseSlot, Program, SessionDef } from './types';

const s = (key: string, sets?: number, reps?: string, extra: Partial<ExerciseSlot> = {}): ExerciseSlot => ({
  key,
  ...(sets !== undefined ? { sets } : {}),
  ...(reps !== undefined ? { reps } : {}),
  ...extra,
});

const REST: SessionDef = {
  id: 'rest',
  name: 'Repos actif',
  focus: 'Récupération, pas, mobilité',
  type: 'rest',
  exercises: [s('walk'), s('mobility'), s('zone2', undefined, undefined, { note: 'Optionnel.' })],
};

const CONDITIONING: SessionDef = {
  id: 'conditioning',
  name: 'Conditionnement',
  focus: 'Cardio orienté sports de combat, 30 à 40 min',
  type: 'cardio',
  exercises: [s('rope-shadow'), s('intervals')],
};

const PPL_UL: Program = {
  name: 'PPL + Upper/Lower',
  template: 'ppl-ul',
  schedule: ['conditioning', 'push', 'pull', 'legs', 'rest', 'upper', 'lower'],
  sessions: [
    {
      id: 'push',
      name: 'Push',
      focus: 'Pecs, épaules, triceps',
      type: 'lifting',
      exercises: [
        s('incline-db-press', 4, '6–8'),
        s('db-shoulder-press', 3, '6–10'),
        s('dips', 3, '8–12'),
        s('db-lateral-raise', 4, '12–15'),
        s('rope-pushdown', 3, '10–12'),
        s('overhead-triceps', 2, '10–12'),
        s('hanging-leg-raise', 3, '10–15'),
        s('cable-crunch', 3, '12–15'),
      ],
    },
    {
      id: 'pull',
      name: 'Pull',
      focus: 'Dos, arrière d’épaules, biceps, cou',
      type: 'lifting',
      exercises: [
        s('pullup', 4, '6–10'),
        s('barbell-row', 3, '6–10'),
        s('neutral-pulldown', 3, '10–12'),
        s('rear-delt', 3, '15–20'),
        s('cable-lateral-raise', 3, '15–20'),
        s('incline-curl', 3, '8–12'),
        s('hammer-curl', 2, '10–12'),
        s('neck-flexion', 2, '15–20'),
        s('neck-extension', 2, '15–20'),
      ],
    },
    {
      id: 'legs',
      name: 'Legs',
      focus: 'Quadriceps, ischios, mollets, abdos',
      type: 'lifting',
      exercises: [
        s('squat', 4, '5–8'),
        s('rdl', 3, '8–10'),
        s('leg-press', 3, '10–12'),
        s('leg-curl', 3, '10–12'),
        s('leg-extension', 2, '12–15'),
        s('standing-calf', 4, '10–15'),
        s('ab-wheel', 3, '8–12'),
        s('pallof', 3, '12'),
      ],
    },
    {
      id: 'upper',
      name: 'Upper',
      focus: 'Haut du corps, priorité épaules',
      type: 'lifting',
      exercises: [
        s('bench', 4, '5–8'),
        s('db-row', 3, '8–10'),
        s('wide-pulldown', 3, '8–12'),
        s('low-high-fly', 3, '12–15'),
        s('db-lateral-raise', 4, '12–20', { rest: 60, note: 'Dernière série en dégressive.' }),
        s('face-pull', 3, '15'),
        s('arms-superset', 3, '10–12'),
        s('neck-flexion', 2, '15–20'),
        s('neck-extension', 2, '15–20'),
      ],
    },
    {
      id: 'lower',
      name: 'Lower',
      focus: 'Force, explosivité, jambes, abdos',
      type: 'lifting',
      exercises: [
        s('box-jump', 3, '5'),
        s('deadlift', 3, '4–6', { note: 'Trap bar ou classique.' }),
        s('bulgarian', 3, '8–10'),
        s('hack-squat', 3, '10–12'),
        s('leg-curl', 3, '10–12'),
        s('seated-calf', 3, '12–15'),
        s('hanging-leg-raise', 3, 'max', { note: 'Proche de l’échec.' }),
        s('side-plank', 3, '30–45 s'),
      ],
    },
    CONDITIONING,
    REST,
  ],
};

const UPPER_LOWER: Program = {
  name: 'Upper / Lower',
  template: 'upper-lower',
  schedule: ['rest', 'upper-a', 'lower-a', 'rest', 'upper-b', 'lower-b', 'rest'],
  sessions: [
    {
      id: 'upper-a',
      name: 'Upper A',
      focus: 'Haut du corps, force',
      type: 'lifting',
      exercises: [s('bench', 4, '5–8'), s('barbell-row', 4, '6–8'), s('db-shoulder-press', 3, '8–10'), s('wide-pulldown', 3, '8–12'), s('db-lateral-raise', 3, '12–15'), s('barbell-curl', 2, '8–12'), s('skullcrusher', 2, '8–12')],
    },
    {
      id: 'lower-a',
      name: 'Lower A',
      focus: 'Jambes, quadriceps',
      type: 'lifting',
      exercises: [s('squat', 4, '5–8'), s('rdl', 3, '8–10'), s('leg-press', 3, '10–12'), s('leg-curl', 3, '10–12'), s('standing-calf', 4, '10–15'), s('plank', 3, '30–60 s')],
    },
    {
      id: 'upper-b',
      name: 'Upper B',
      focus: 'Haut du corps, volume',
      type: 'lifting',
      exercises: [s('incline-db-press', 4, '8–10'), s('pullup', 4, '6–10'), s('arnold-press', 3, '8–12'), s('seated-cable-row', 3, '10–12'), s('cable-lateral-raise', 3, '15–20'), s('face-pull', 3, '15'), s('hammer-curl', 2, '10–12'), s('rope-pushdown', 2, '10–12')],
    },
    {
      id: 'lower-b',
      name: 'Lower B',
      focus: 'Jambes, chaîne postérieure',
      type: 'lifting',
      exercises: [s('deadlift', 3, '4–6'), s('bulgarian', 3, '8–10'), s('hip-thrust', 3, '8–12'), s('leg-extension', 3, '12–15'), s('seated-calf', 3, '12–15'), s('hanging-leg-raise', 3, '10–15')],
    },
    REST,
  ],
};

const FULL_BODY: Program = {
  name: 'Full body 3 jours',
  template: 'full-body',
  schedule: ['rest', 'fb-a', 'rest', 'fb-b', 'rest', 'fb-c', 'rest'],
  sessions: [
    {
      id: 'fb-a',
      name: 'Full body A',
      focus: 'Tout le corps, squat et développé couché',
      type: 'lifting',
      exercises: [s('squat', 3, '5–8'), s('bench', 3, '5–8'), s('barbell-row', 3, '8–10'), s('db-lateral-raise', 3, '12–15'), s('plank', 3, '30–60 s')],
    },
    {
      id: 'fb-b',
      name: 'Full body B',
      focus: 'Tout le corps, soulevé de terre et épaules',
      type: 'lifting',
      exercises: [s('deadlift', 3, '4–6'), s('military-press', 3, '6–8'), s('pullup', 3, '6–10'), s('lunge', 3, '10–12'), s('barbell-curl', 2, '10–12')],
    },
    {
      id: 'fb-c',
      name: 'Full body C',
      focus: 'Tout le corps, volume',
      type: 'lifting',
      exercises: [s('leg-press', 3, '10–12'), s('incline-db-press', 3, '8–10'), s('seated-cable-row', 3, '10–12'), s('hip-thrust', 3, '8–12'), s('rope-pushdown', 2, '10–12'), s('hanging-leg-raise', 3, '10–15')],
    },
    REST,
  ],
};

const PPL6: Program = {
  name: 'PPL 6 jours',
  template: 'ppl6',
  schedule: ['rest', 'push', 'pull', 'legs', 'push', 'pull', 'legs'],
  sessions: PPL_UL.sessions.filter((x) => ['push', 'pull', 'legs', 'rest'].includes(x.id)),
};

const BLANK: Program = {
  name: 'Mon programme',
  template: 'blank',
  schedule: ['rest', 'session-1', 'rest', 'session-1', 'rest', 'session-1', 'rest'],
  sessions: [{ id: 'session-1', name: 'Séance 1', focus: 'À composer', type: 'lifting', exercises: [] }, REST],
};

export const TEMPLATES: { id: string; name: string; days: string; description: string; program: Program }[] = [
  { id: 'ppl-ul', name: 'PPL + Upper/Lower', days: '5 j', description: 'Chaque muscle 2 fois par semaine, priorité épaules, cou et abdos. Conditionnement le dimanche.', program: PPL_UL },
  { id: 'upper-lower', name: 'Upper / Lower', days: '4 j', description: 'Haut et bas du corps en alternance, force puis volume.', program: UPPER_LOWER },
  { id: 'full-body', name: 'Full body', days: '3 j', description: 'Tout le corps à chaque séance. Idéal avec un emploi du temps chargé.', program: FULL_BODY },
  { id: 'ppl6', name: 'PPL', days: '6 j', description: 'Push, Pull, Legs deux fois par semaine. Gros volume.', program: PPL6 },
  { id: 'blank', name: 'Page blanche', days: 'libre', description: 'Une séance vide à composer toi-même.', program: BLANK },
];

export const DEFAULT_PROGRAM = PPL_UL;
