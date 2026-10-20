// Bibliothèque d'exercices. Pour en ajouter un : une ligne ici (+ deux images
// src/assets/exercises/<key>-0.jpg et -1.jpg si tu veux une démo). Rien d'autre à toucher.
import type { CatalogEntry, ExerciseKind, MuscleGroup } from './types';

const c = (
  key: string,
  name: string,
  kind: ExerciseKind,
  group: MuscleGroup,
  muscles: string[],
  cue: string,
  [sets, reps, rest]: [number, string, number],
  extra: Partial<CatalogEntry> = {},
): CatalogEntry => ({
  key,
  name,
  kind,
  group,
  muscles,
  cue,
  defaults: { sets, reps, rest },
  step: 2.5,
  noLoad: kind === 'core' || kind === 'power' || kind === 'cardio' || kind === 'task',
  ...extra,
});

export const CATALOG: CatalogEntry[] = [
  // Pectoraux
  c('bench', 'Développé couché barre', 'compound', 'chest', ['Pecs', 'Triceps', 'Épaules avant'], 'Omoplates serrées, pieds ancrés, barre au bas des pecs.', [4, '5–8', 180]),
  c('incline-db-press', 'Développé incliné haltères (30°)', 'compound', 'chest', ['Haut des pecs', 'Épaules avant', 'Triceps'], 'Banc à 30°, omoplates serrées. Descends les haltères au niveau du haut des pecs.', [4, '6–8', 150]),
  c('db-bench', 'Développé couché haltères', 'compound', 'chest', ['Pecs', 'Triceps'], 'Descends les haltères au niveau de la poitrine, coudes à 45°.', [3, '8–10', 120]),
  c('machine-chest-press', 'Presse pectorale machine', 'compound', 'chest', ['Pecs', 'Triceps'], 'Poignées à hauteur du milieu des pecs, pousse sans décoller le dos.', [3, '8–12', 90]),
  c('dips', 'Dips', 'compound', 'chest', ['Pecs', 'Triceps'], 'Buste un peu penché en avant. Descends jusqu’à l’épaule au niveau du coude.', [3, '8–12', 120], { note: 'Charge = lest ajouté.' }),
  c('pushup', 'Pompes', 'compound', 'chest', ['Pecs', 'Triceps'], 'Corps gainé, poitrine jusqu’au sol.', [3, '10–20', 60], { noLoad: true }),
  c('low-high-fly', 'Écarté poulie du bas vers le haut', 'isolation', 'chest', ['Haut des pecs'], 'Poulies basses, ramène les mains vers le haut et le centre.', [3, '12–15', 60]),
  c('cable-fly', 'Écarté à la poulie vis-à-vis', 'isolation', 'chest', ['Pecs'], 'Bras légèrement fléchis, serre les mains devant la poitrine.', [3, '12–15', 60]),
  c('pec-deck', 'Pec deck', 'isolation', 'chest', ['Pecs'], 'Coudes à hauteur d’épaules, contracte en fermant.', [3, '12–15', 60]),

  // Dos
  c('pullup', 'Tractions pronation', 'compound', 'back', ['Dos', 'Biceps'], 'Pars bras tendus, tire les coudes vers les hanches, menton au-dessus de la barre.', [4, '6–10', 150], { note: 'Charge = lest ajouté. Leste dès que tu passes 10 reps.' }),
  c('chin-up', 'Tractions supination', 'compound', 'back', ['Dos', 'Biceps'], 'Paumes vers toi, poitrine vers la barre.', [3, '6–10', 150], { note: 'Charge = lest ajouté.' }),
  c('barbell-row', 'Rowing barre buste penché', 'compound', 'back', ['Dos', 'Arrière d’épaules'], 'Buste à 45°, dos plat. Tire la barre vers le nombril.', [3, '6–10', 150]),
  c('db-row', 'Rowing haltère un bras', 'compound', 'back', ['Dos'], 'Tire l’haltère vers la hanche, pas vers l’épaule.', [3, '8–10', 120]),
  c('t-bar-row', 'Rowing T-bar', 'compound', 'back', ['Dos'], 'Poitrine haute, tire vers le bas des pecs.', [3, '8–10', 120]),
  c('seated-cable-row', 'Tirage horizontal à la poulie', 'compound', 'back', ['Dos'], 'Buste fixe, tire la poignée vers le nombril en serrant les omoplates.', [3, '10–12', 90]),
  c('neutral-pulldown', 'Tirage vertical prise neutre serrée', 'compound', 'back', ['Dos', 'Biceps'], 'Poitrine sortie, tire la poignée vers le haut des pecs.', [3, '10–12', 90]),
  c('wide-pulldown', 'Tirage vertical prise large', 'compound', 'back', ['Dos (largeur)'], 'Prise large, tire vers le haut des pecs en sortant la poitrine.', [3, '8–12', 90]),
  c('straight-arm-pulldown', 'Pull-over à la poulie', 'isolation', 'back', ['Grand dorsal'], 'Bras tendus, ramène la barre vers les cuisses.', [3, '12–15', 60]),
  c('shrug', 'Shrugs haltères', 'isolation', 'back', ['Trapèzes'], 'Monte les épaules vers les oreilles, pause en haut.', [3, '10–15', 60]),

  // Épaules
  c('db-shoulder-press', 'Développé militaire haltères assis', 'compound', 'shoulders', ['Épaules', 'Triceps'], 'Dos collé au dossier. Pousse à la verticale sans cambrer.', [3, '6–10', 150]),
  c('military-press', 'Développé militaire barre debout', 'compound', 'shoulders', ['Épaules', 'Triceps'], 'Fessiers serrés, barre qui passe près du visage.', [3, '5–8', 150]),
  c('arnold-press', 'Développé Arnold', 'compound', 'shoulders', ['Épaules'], 'Pars paumes vers toi, tourne les poignets en poussant.', [3, '8–12', 90]),
  c('machine-shoulder-press', 'Développé épaules machine', 'compound', 'shoulders', ['Épaules', 'Triceps'], 'Poignées à hauteur des oreilles, pousse sans cambrer.', [3, '8–12', 90]),
  c('db-lateral-raise', 'Élévations latérales haltères', 'isolation', 'shoulders', ['Épaules (côté)'], 'Monte jusqu’à la hauteur des épaules, coudes légèrement fléchis, sans élan.', [4, '12–15', 75], { step: 1 }),
  c('cable-lateral-raise', 'Élévations latérales poulie', 'isolation', 'shoulders', ['Épaules (côté)'], 'Poulie basse, monte jusqu’à l’épaule. La tension reste constante.', [3, '15–20', 60], { step: 1 }),
  c('rear-delt', 'Oiseau poulie ou reverse pec deck', 'isolation', 'shoulders', ['Arrière d’épaules', 'Haut du dos'], 'Bras presque tendus, ouvre vers l’arrière en serrant les omoplates.', [3, '15–20', 60]),
  c('face-pull', 'Face pull', 'isolation', 'shoulders', ['Arrière d’épaules', 'Coiffe des rotateurs'], 'Corde à hauteur des yeux, tire vers le front en écartant les mains.', [3, '15', 60]),

  // Bras
  c('barbell-curl', 'Curl barre', 'isolation', 'arms', ['Biceps'], 'Coudes collés au corps, pas d’élan.', [3, '8–12', 75]),
  c('incline-curl', 'Curl incliné haltères', 'isolation', 'arms', ['Biceps'], 'Bras ballants derrière le buste, monte sans avancer les coudes.', [3, '8–12', 75], { step: 1 }),
  c('hammer-curl', 'Curl marteau', 'isolation', 'arms', ['Biceps', 'Avant-bras'], 'Pouces vers le haut, coudes fixes.', [2, '10–12', 75], { step: 1 }),
  c('preacher-curl', 'Curl pupitre', 'isolation', 'arms', ['Biceps'], 'Bras plaqués sur le pupitre, descends presque tendu.', [3, '10–12', 75]),
  c('cable-curl', 'Curl à la poulie', 'isolation', 'arms', ['Biceps'], 'Coudes fixes, contracte en haut.', [3, '12–15', 60]),
  c('rope-pushdown', 'Extension triceps poulie, corde', 'isolation', 'arms', ['Triceps'], 'Coudes collés au corps. Écarte la corde en bas du mouvement.', [3, '10–12', 75]),
  c('overhead-triceps', 'Extension triceps au-dessus de la tête', 'isolation', 'arms', ['Triceps'], 'Coudes pointés vers l’avant, descends lentement derrière la tête.', [2, '10–12', 75]),
  c('skullcrusher', 'Barre au front', 'isolation', 'arms', ['Triceps'], 'Coudes fixes, descends la barre vers le front.', [3, '8–12', 75]),
  c('close-grip-bench', 'Développé couché prise serrée', 'compound', 'arms', ['Triceps', 'Pecs'], 'Mains largeur d’épaules, coudes près du corps.', [3, '6–10', 120]),
  c('arms-superset', 'Superset curl EZ + barre au front', 'isolation', 'arms', ['Biceps', 'Triceps'], 'Enchaîne curl puis barre au front, sans repos entre les deux.', [3, '10–12', 75]),

  // Jambes
  c('squat', 'Squat barre', 'compound', 'legs', ['Quadriceps', 'Fessiers'], 'Pieds largeur d’épaules, genoux dans l’axe des pieds, descends sous la parallèle.', [4, '5–8', 180], { step: 5 }),
  c('front-squat', 'Squat avant', 'compound', 'legs', ['Quadriceps'], 'Coudes hauts, buste droit.', [3, '5–8', 180], { step: 5 }),
  c('smith-squat', 'Squat à la Smith machine', 'compound', 'legs', ['Quadriceps', 'Fessiers'], 'Pieds légèrement devant la barre.', [3, '8–10', 120], { step: 5 }),
  c('goblet-squat', 'Goblet squat', 'compound', 'legs', ['Quadriceps', 'Fessiers'], 'Haltère contre la poitrine, coudes entre les genoux.', [3, '10–12', 90]),
  c('leg-press', 'Presse à cuisses', 'compound', 'legs', ['Quadriceps', 'Fessiers'], 'Descends jusqu’à 90°, bas du dos collé au dossier.', [3, '10–12', 120], { step: 5 }),
  c('hack-squat', 'Hack squat', 'compound', 'legs', ['Quadriceps'], 'Descends profond et pousse dans les talons.', [3, '10–12', 120], { step: 5 }),
  c('bulgarian', 'Fente bulgare haltères (par jambe)', 'compound', 'legs', ['Quadriceps', 'Fessiers'], 'Pied arrière sur le banc, descends à la verticale, genou avant stable.', [3, '8–10', 90]),
  c('lunge', 'Fentes haltères', 'compound', 'legs', ['Quadriceps', 'Fessiers'], 'Grand pas, genou arrière proche du sol.', [3, '10–12', 90]),
  c('walking-lunge', 'Fentes marchées', 'compound', 'legs', ['Quadriceps', 'Fessiers'], 'Pas réguliers, buste droit.', [3, '12–16', 90]),
  c('leg-extension', 'Leg extension', 'isolation', 'legs', ['Quadriceps'], 'Tends complètement et marque une pause en haut.', [2, '12–15', 75]),
  c('deadlift', 'Soulevé de terre', 'compound', 'legs', ['Ischios', 'Fessiers', 'Dos'], 'Dos plat, poitrine haute, pousse le sol avec les jambes.', [3, '4–6', 180], { step: 5 }),
  c('sumo-deadlift', 'Soulevé de terre sumo', 'compound', 'legs', ['Fessiers', 'Ischios', 'Adducteurs'], 'Pieds larges, genoux vers l’extérieur.', [3, '4–6', 180], { step: 5 }),
  c('rdl', 'Soulevé de terre roumain', 'compound', 'legs', ['Ischios', 'Fessiers', 'Bas du dos'], 'Jambes presque tendues, fesses vers l’arrière, barre collée aux cuisses.', [3, '8–10', 150], { step: 5 }),
  c('good-morning', 'Good morning', 'compound', 'legs', ['Ischios', 'Bas du dos'], 'Dos plat, bascule le buste en reculant les hanches.', [3, '8–10', 120]),
  c('hip-thrust', 'Hip thrust', 'compound', 'legs', ['Fessiers'], 'Menton rentré, pousse les hanches et serre les fessiers en haut.', [3, '8–12', 120], { step: 5 }),
  c('leg-curl', 'Leg curl', 'isolation', 'legs', ['Ischios'], 'Hanches plaquées sur le banc. Contrôle la descente.', [3, '10–12', 75]),
  c('hip-abduction', 'Abducteurs machine', 'isolation', 'legs', ['Fessiers (côté)'], 'Écarte en contrôlant le retour.', [3, '15–20', 60]),
  c('standing-calf', 'Mollets debout', 'isolation', 'legs', ['Mollets'], 'Amplitude complète, une seconde de pause en haut.', [4, '10–15', 60], { step: 5 }),
  c('seated-calf', 'Mollets assis', 'isolation', 'legs', ['Mollets'], 'Amplitude complète, pause en haut.', [3, '12–15', 60], { step: 5 }),
  c('box-jump', 'Sauts sur box', 'power', 'legs', ['Jambes', 'Explosivité'], 'Lance les bras, réception souple, redescends en marchant.', [3, '5', 90], { note: 'Explosif, repos complet.' }),

  // Abdos et gainage
  c('hanging-leg-raise', 'Relevés de jambes suspendu', 'core', 'core', ['Abdos'], 'Enroule le bassin vers le haut, sans te balancer.', [3, '10–15', 60]),
  c('cable-crunch', 'Crunch à la poulie', 'isolation', 'core', ['Abdos'], 'Enroule la colonne : ce sont les abdos qui tirent, pas les bras.', [3, '12–15', 60]),
  c('ab-wheel', 'Roue abdominale', 'core', 'core', ['Abdos', 'Gainage'], 'Va aussi loin que possible sans creuser le bas du dos.', [3, '8–12', 60]),
  c('crunch', 'Crunchs', 'core', 'core', ['Abdos'], 'Décolle les épaules, bas du dos au sol.', [3, '15–20', 45]),
  c('plank', 'Gainage', 'core', 'core', ['Gainage'], 'Corps aligné, fessiers et abdos serrés.', [3, '30–60 s', 45]),
  c('side-plank', 'Gainage latéral (par côté)', 'core', 'core', ['Obliques', 'Gainage'], 'Corps aligné de la tête aux pieds, hanches hautes.', [3, '30–45 s', 45]),
  c('pallof', 'Pallof press (par côté)', 'core', 'core', ['Obliques', 'Gainage'], 'Pousse la poignée devant toi et résiste à la rotation.', [3, '12', 45]),
  c('russian-twist', 'Russian twist', 'core', 'core', ['Obliques'], 'Pieds décollés, tourne les épaules, pas seulement les bras.', [3, '20', 45]),

  // Cou
  c('neck-flexion', 'Flexion de nuque (disque sur le front)', 'neck', 'neck', ['Cou (avant)'], 'Disque léger posé sur une serviette. Rentre le menton vers la poitrine, lentement.', [2, '15–20', 60], { note: 'Très léger, lent, jamais d’à-coups.', step: 1.25 }),
  c('neck-extension', 'Extension de nuque (disque ou harnais)', 'neck', 'neck', ['Cou (arrière)'], 'Tête dans le vide, monte et descends lentement. Jamais d’à-coups.', [2, '15–20', 60], { step: 1.25 }),

  // Cardio et conditionnement
  c('rope-shadow', 'Corde à sauter + shadow boxing', 'cardio', 'cardio', ['Cardio', 'Coordination'], 'Rounds de 3 minutes. En shadow, garde la garde haute.', [6, '3 min', 60], { note: 'Un round = 3 min, 1 min de repos.' }),
  c('intervals', 'Intervalles vélo ou rameur', 'cardio', 'cardio', ['Cardio'], '30 secondes à fond, 90 secondes tranquille.', [10, '30 s fort / 90 s', 0], { note: 'Alternative au bloc corde + shadow.' }),
  c('running', 'Course à pied', 'cardio', 'cardio', ['Cardio'], 'Allure où tu peux parler en phrases courtes.', [1, '30 min', 0]),
  c('rowing-erg', 'Rameur', 'cardio', 'cardio', ['Cardio', 'Dos'], 'Jambes, puis buste, puis bras.', [1, '20 min', 0]),
  c('bike', 'Vélo d’appartement', 'cardio', 'cardio', ['Cardio'], 'Résistance moyenne, cadence régulière.', [1, '30 min', 0]),
  c('kettlebell-swing', 'Kettlebell swing', 'power', 'cardio', ['Fessiers', 'Cardio'], 'Le mouvement vient des hanches, pas des bras.', [5, '20', 60]),
  c('mountain-climber', 'Mountain climbers', 'cardio', 'cardio', ['Cardio', 'Gainage'], 'Hanches basses, genoux vers la poitrine en rythme.', [4, '30 s', 30]),
  c('farmer-walk', 'Marche du fermier', 'power', 'cardio', ['Grip', 'Trapèzes', 'Gainage'], 'Épaules basses, pas courts et rapides.', [3, '30 m', 90]),

  // Course à pied
  c('run-easy', 'Footing en endurance', 'cardio', 'cardio', ['Endurance'], 'Allure où tu peux parler en phrases entières. C’est la base de tout.', [1, '40 min', 0]),
  c('run-long', 'Sortie longue', 'cardio', 'cardio', ['Endurance'], 'Lente et régulière : finir en ayant pu accélérer.', [1, '1 h', 0], { note: 'Bois toutes les 20 minutes au-delà d’une heure.' }),
  c('run-tempo', 'Allure seuil (tempo)', 'cardio', 'cardio', ['Seuil'], '« Confortablement dur » : tu peux dire trois mots, pas une phrase.', [1, '20 min', 0], { note: '15 min d’échauffement et 10 min de retour au calme en footing.' }),
  c('run-intervals', 'Fractionné', 'cardio', 'cardio', ['VMA', 'Vitesse'], 'Chaque répétition à la même allure : la dernière doit ressembler à la première.', [6, '800 m', 90], { note: '15 min d’échauffement, récupération en trottinant.' }),
  c('run-race', 'Blocs à allure course', 'cardio', 'cardio', ['Allure spécifique'], 'L’allure exacte que tu viseras le jour J. Ni plus vite, ni plus lent.', [2, '3 km', 120]),
  c('strides', 'Lignes droites', 'cardio', 'cardio', ['Foulée'], 'Accélère progressivement jusqu’à 90 % puis relâche. Récupère en marchant.', [6, '80 m', 60]),
  c('race-day', 'Jour de course', 'task', 'cardio', ['Course'], 'Pars prudemment, accélère dans la deuxième moitié.', [1, '1', 0]),

  // Hyrox
  c('ski-erg', 'SkiErg', 'cardio', 'cardio', ['Dos', 'Triceps', 'Cardio'], 'Bras tendus, la force vient des hanches et du gainage.', [4, '500 m', 90]),
  c('sled-push', 'Sled push', 'power', 'legs', ['Quadriceps', 'Fessiers', 'Mollets'], 'Bras tendus, corps penché à 45°, petits pas rapides.', [4, '25 m', 120]),
  c('sled-pull', 'Sled pull', 'power', 'back', ['Dos', 'Biceps', 'Grip'], 'Recule en position athlétique, tire main sur main sans à-coups.', [4, '25 m', 120]),
  c('burpee-broad-jump', 'Burpees sautés en longueur', 'cardio', 'cardio', ['Cardio', 'Jambes'], 'Poitrine au sol, puis saut pieds joints vers l’avant. Régulier plutôt que rapide.', [4, '20 m', 90]),
  c('wall-ball', 'Wall balls', 'power', 'legs', ['Quadriceps', 'Épaules', 'Cardio'], 'Squat complet, lance au moment où tu remontes, rattrape en redescendant.', [4, '20', 90]),
  c('sandbag-lunge', 'Fentes avec sandbag', 'power', 'legs', ['Quadriceps', 'Fessiers'], 'Sac sur les épaules, genou arrière qui frôle le sol.', [3, '20 m', 90]),
  c('hyrox-sim', 'Simulation Hyrox', 'task', 'cardio', ['Course', 'Stations'], 'Enchaîne course et stations à l’allure de course, sans t’arrêter.', [1, '1', 0]),

  // Récupération
  c('walk', 'Marche, 8 000 pas ou plus', 'task', 'other', ['Cardio léger'], 'Répartis tes pas sur la journée : trajets, pauses, appels.', [1, '1', 0]),
  c('mobility', 'Mobilité 10 min (hanches, épaules, dos)', 'task', 'other', ['Mobilité'], 'Hanches, épaules et haut du dos, 10 minutes au calme.', [1, '1', 0]),
  c('zone2', 'Zone 2, 30 min', 'task', 'cardio', ['Cardio'], 'Un rythme où tu peux encore parler.', [1, '1', 0]),
];

export const GROUP_NAMES: Record<MuscleGroup, string> = {
  chest: 'Pecs',
  back: 'Dos',
  shoulders: 'Épaules',
  arms: 'Bras',
  legs: 'Jambes',
  core: 'Abdos',
  neck: 'Cou',
  cardio: 'Cardio',
  other: 'Récup',
};

const BY_KEY = new Map(CATALOG.map((e) => [e.key, e]));

export function catalogEntry(key: string, custom: Record<string, CatalogEntry> = {}): CatalogEntry | undefined {
  return custom[key] ?? BY_KEY.get(key);
}
