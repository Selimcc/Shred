# Shred

App mobile pour tenir le programme : séance du jour avec suivi des charges, repas notés en un tap ou en photo (calories estimées par Claude), série quotidienne façon Duolingo, rappels push et coach IA qui connaît ton programme.

C'est une PWA : elle s'installe sur l'écran d'accueil comme une app native, fonctionne hors ligne et reçoit des notifications, sans passer par l'App Store ni le Play Store.

Tout est personnalisable depuis l'app : le split (séances, exercices, séries, planning), les repas prévus, les habitudes, les objectifs, les modules actifs et la façon d'utiliser l'IA. Plusieurs personnes peuvent partager le même serveur : chacune a son compte (email et mot de passe, sur invitation), son espace et sa sauvegarde chiffrée.

## Architecture

```
Téléphone (PWA installée)            Cloudflare Workers (gratuit)            Anthropic
┌────────────────────────┐  HTTPS   ┌─────────────────────────────┐  HTTPS  ┌─────────────┐
│ React + service worker │ ───────► │ /api/*  +  fichiers de l'app │ ──────► │ API Claude  │
│ données : localStorage │ ◄─────── │ KV : comptes, sauvegardes    │         │ photo, coach│
│ recherche (RAG) locale │          │ chiffrées, rappels, Santé    │         └─────────────┘
│ photos : IndexedDB     │   push   │ Cron toutes les 15 min       │
└────────────────────────┘ ◄─────── └─────────────────────────────┘
```

- **Front** : React 19, Vite, TypeScript. Données « local-first » sur le téléphone, rien ne dépend du réseau sauf l'IA et les rappels.
- **Back** : un seul Cloudflare Worker sert l'app et l'API sur le même domaine. KV garde les comptes, les sessions, les sauvegardes (chiffrées par le téléphone) et ce qu'il faut pour les rappels (abonnement push, horaires, résumé du jour).
- **Notifications** : Web Push standard (VAPID + chiffrement aes128gcm), codé sans dépendance et testé contre l'implémentation de référence. Le cron vérifie toutes les 15 minutes s'il faut envoyer un rappel, et se tait dès que ta journée est validée.
- **IA** : photo de repas → Claude Sonnet 5.5 (vision, réponse structurée). Coach → Claude Haiku 5.5, avec ton programme, ta journée et les extraits de ton historique qui répondent à la question (recherche locale, voir « Mémoire du coach »). Modèles modifiables dans `wrangler.jsonc`.
- **Comptes** : inscription sur invitation, mot de passe jamais envoyé ni stocké (dérivé en clé sur le téléphone), sessions de 180 jours, essais limités, sauvegarde chiffrée de bout en bout. Détails dans « Comptes et testeurs ».
- **Sécurité** : toutes les routes demandent une session, la clé API ne quitte jamais le serveur, une limite quotidienne plafonne l'IA (`DAILY_AI_LIMIT` pour l'admin, `GUEST_AI_LIMIT` pour chaque invité), et l'app demande aux moteurs de recherche de ne pas l'indexer.

## Coûts

- **Cloudflare** : 0 €. Le plan gratuit donne 100 000 requêtes par jour, 5 crons et, pour KV, 100 000 lectures et 1 000 écritures par jour. Une personne active écrit 20 à 40 fois par jour (sauvegarde au plus tous les quarts d'heure, rappels, Santé) : le gratuit tient une vingtaine de testeurs actifs. Au-delà, le plan Workers payant (5 $ par mois) lève ces limites.
- **API Claude** : facturée à l'usage, à créditer sur [console.anthropic.com](https://console.anthropic.com). Avec les tarifs actuels ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)), une analyse photo coûte moins d'un centime et un message au coach une fraction de centime. Compte 1 à 2 € par mois avec 4 photos et 5 messages par jour.
- **Invités** : en mode « App Claude », chacun utilise son propre compte Claude, gratuit pour toi. En mode intégré, leurs requêtes passent par ta clé, plafonnées par `GUEST_AI_LIMIT` (10 par jour par défaut, `0` pour réserver l'API à toi).
- **Pour tester sans rien payer** : `MOCK_AI=1` simule les réponses de l'IA.

## Mise en ligne

Prérequis : Node 20 ou plus, un compte Cloudflare gratuit, et si possible une clé API Claude ([console](https://platform.claude.com/settings/keys)).

```bash
npm install
npm run setup
```

Le script se connecte à Cloudflare (ton navigateur s'ouvre), crée la base KV, te demande ton email (exigé par Apple pour les notifications) et ta clé API, génère les clés VAPID et le **code administrateur**, construit l'app, la met en ligne avec ses secrets, puis affiche l'adresse et un QR code qui ouvre l'app avec ton code admin déjà rempli. Il est relançable sans risque : tout est gardé dans `.shred-secrets.json` (ne le partage pas, ne le supprime pas).

Sur ton téléphone : scanne le QR code, « Créer mon compte » (prénom, email, mot de passe), réponds aux questions d'accueil. Sur iPhone, ajoute ensuite l'app à l'écran d'accueil (Safari, Partager, « Sur l'écran d'accueil »), ouvre-la depuis l'icône et active les rappels : les notifications web n'existent sur iPhone que pour une app ajoutée à l'écran d'accueil (iOS 16.4 minimum). Pour tes amis : Réglages, Testeurs, « Créer » une invitation.

Pour publier une nouvelle version : décompresse-la par-dessus en gardant `.shred-secrets.json`, puis `npm install && npm run setup`.

<details>
<summary>Mise en ligne manuelle, sans le script</summary>

```bash
npx wrangler login
npx wrangler kv namespace create shred-kv   # colle l'id dans wrangler.jsonc
# remplace VAPID_SUBJECT par mailto:ton-email dans wrangler.jsonc
npm run deploy
npm run vapid
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_CODE   # un code long et secret, il crée des comptes administrateur
```

</details>

## Développement local

```bash
cp .dev.vars.example .dev.vars    # MOCK_AI=1 par défaut : IA simulée
npm run vapid                     # colle les deux clés dans .dev.vars

npm run build && npm run dev:api  # app + API sur http://localhost:8787
# ou, avec rechargement à chaud du front :
npm run dev:api                   # terminal 1
npm run dev                       # terminal 2 → http://localhost:5173
```

Premier compte en local : ouvre `http://localhost:8787/?invite=<ADMIN_CODE de .dev.vars>`.

Déclencher le cron à la main : `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"`.
Simuler une heure précise : `POST /api/debug/reminders` avec `{"at": "2026-10-13T19:30:00Z"}` et `Authorization: Bearer <jeton>` (le jeton de session est dans `localStorage['shred:account']`).

## Tests

```bash
npm test          # chiffrement push, VAPID, rappels, Santé et salle, comptes, sauvegarde chiffrée, profils, recherche RAG, flammes, besoins, plans, repas, bilan
npm run typecheck # front et back
```

Les tests de rappels simulent le cron sur plusieurs jours, envoient de vraies notifications chiffrées à un faux téléphone et vérifient qu'elles se déchiffrent, qu'il n'y a pas de doublon, que rien ne part quand la journée est validée et qu'un abonnement expiré est supprimé.

## Dépannage

| Symptôme | Cause probable |
| --- | --- |
| « Code d'invitation invalide ou expiré » | Invitation déjà utilisée ou de plus de 7 jours : recrée-en une dans Réglages, Testeurs. |
| « Session expirée » | Mot de passe changé ailleurs, compte retiré, ou 180 jours écoulés : reconnecte-toi, les données du téléphone sont gardées. |
| « Trop d'essais » | 10 mauvais mots de passe en un quart d'heure : attends ou demande un code de réinitialisation. |
| Mot de passe oublié | L'admin crée un code dans Réglages, Testeurs (ou `npm run admin -- reset email`), à saisir dans « Mot de passe oublié ? ». |
| IA intégrée indisponible | Secret `ANTHROPIC_API_KEY` non défini, ou `GUEST_AI_LIMIT` à 0 pour les invités. |
| Pas de notification sur iPhone | App ouverte depuis Safari au lieu de l'icône, notifications refusées dans Réglages iOS, ou `VAPID_SUBJECT` fictif. |
| Les rappels ont 10 min de retard | Normal : le cron passe toutes les 15 minutes. |
| Erreurs serveur | `npx wrangler tail` affiche les logs en direct. |

Avec un compte, les données sont sauvegardées toutes seules, chiffrées. L'export (Réglages, Données) reste disponible pour garder une copie en fichier.

## Personnaliser l'app

Tout se fait dans les réglages, sans toucher au code :

- **Mon programme** : partir d'un modèle (PPL + Upper/Lower, Upper/Lower 4 j, Full body 3 j, PPL 6 j, page blanche), choisir la séance de chaque jour, créer ou supprimer des séances, ajouter des exercices depuis la bibliothèque (près de 80, presque tous avec démo) ou en créer, régler séries, reps, repos et notes, réordonner.
- **Modules** : nutrition, habitudes, poids, fiche de force, Apple Santé, passages à la salle. Un module coupé disparaît de l'interface, des onglets, des rappels et du calcul de la série.
- **Objectifs** : ce qui valide une journée (séance obligatoire, nombre de repas), sèche, maintien ou prise de masse, calories et macros.
- **Repas prévus** et **habitudes** : entièrement éditables.
- **Intelligence artificielle** : API Claude (automatique, payée à l'usage), app Claude (l'app ouvre Claude avec ta question, le contexte du jour et les extraits utiles de ton historique, sans frais d'API ; compte Claude gratuit ou payant), ou sans IA.
- **Profil et coach** : ce que le coach doit savoir sur toi (objectif, sport, goûts, budget, blessures).

## Comptes et testeurs

L'app est privée : on ne peut créer un compte qu'avec une invitation. Le premier compte se crée avec le code administrateur généré par `npm run setup`.

**Inviter** : Réglages, Testeurs, « Créer ». Chaque invitation sert une fois et expire au bout de 7 jours ; le bouton « Envoyer » ouvre le partage du téléphone avec un message prêt (lien qui pré-remplit le code, et comment installer l'app sur iPhone et Android). La même page liste les comptes, crée les codes de réinitialisation et retire un compte avec toutes ses données. En ligne de commande, en secours :

```bash
npm run admin -- invite Yanis           # invitation + message à envoyer
npm run admin -- reset ami@exemple.com  # code pour un mot de passe oublié (le tien compris)
npm run admin -- users                  # liste des comptes
```

**Où sont les informations** (base KV de ton compte Cloudflare) :

| Clé | Contenu |
| --- | --- |
| `acct:<id>` | email, prénom, rôle, sel et empreinte HMAC de la clé de connexion |
| `email:<sha256>` | email → identifiant (l'email n'apparaît pas en clair dans les clés) |
| `idx:users` | liste des comptes, pour les rappels et la page Testeurs |
| `sess:<sha256>` | sessions ouvertes, 180 jours ; seule l'empreinte du jeton est gardée |
| `dkey:<sha256>` | clé des Raccourcis iPhone, limitée à Santé et à la salle |
| `inv:…`, `rst:…` | invitations (7 j) et codes de réinitialisation (48 h) |
| `u:<id>:…` | données de la personne : sauvegarde chiffrée, abonnement push, horaires des rappels, résumé du jour, Santé, salle, quota IA |

**Mot de passe** : le téléphone le transforme avec PBKDF2-SHA256 (600 000 tours, recommandation OWASP) puis HKDF en deux clés. La clé de connexion part au serveur, qui n'en garde qu'une empreinte HMAC salée ; la clé de données ne quitte jamais le téléphone et chiffre la sauvegarde (AES-GCM, après compression). Le serveur, et donc l'administrateur, ne peut lire ni les mots de passe ni les séances et repas sauvegardés. Il voit en clair ce qu'il faut pour les rappels : résumé du jour, horaires, pas et calories envoyés par Santé.

Conséquence assumée : après un mot de passe oublié, l'ancienne sauvegarde ne peut pas être déchiffrée. Elle est effacée et repart des données encore présentes sur le téléphone. Changer son mot de passe depuis l'app, lui, rechiffre la sauvegarde sans rien perdre.

**Déconnexion** : dernière sauvegarde, arrêt des notifications de ce téléphone, puis le téléphone est vidé, pour qu'un téléphone prêté ne garde rien. Se reconnecter récupère tout. Si deux appareils ont modifié les données, l'app demande lesquelles garder.

## Mémoire du coach (RAG)

Le RAG consiste à chercher, avant chaque question, les morceaux de données qui y répondent et à ne donner qu'eux au modèle. Il rend le coach plus précis et réduit les tokens envoyés, mais il ne remplace pas le modèle : il faut toujours Claude pour répondre, donc soit la clé API, soit l'app Claude.

- **Recherche locale** (`src/lib/knowledge.ts`) : l'historique est découpé en documents (une journée, une semaine, l'historique d'un exercice, le poids, le profil, les anciens échanges), puis indexé sur le téléphone (BM25, récence, synonymes du type « pecs » → développé, dips, écarté ; « hier », « lundi », « 12/10 »). Gratuit, hors ligne, rien n'est envoyé ailleurs.
- **Mode API** : les extraits partent avec la question (`memory`), et la réponse affiche sur quoi elle s'appuie.
- **Mode app Claude** : les extraits sont ajoutés au lien tant qu'il reste sous la limite de longueur.
- **Mémoire longue sans clé API** : « Exporter mon dossier » (onglet Coach, ou Réglages, IA) produit un fichier Markdown à ajouter aux connaissances d'un Projet Claude, avec les instructions à coller. Les projets existent aussi sur le plan gratuit (5 maximum) ; au-delà de la fenêtre de contexte, la recherche automatique dans les connaissances est réservée aux plans payants. Un dossier de trois mois fait une dizaine de milliers de tokens.
- **Plus tard** : quand il y aura beaucoup de texte libre (des mois de conversations), une recherche par embeddings pourra remplacer la recherche locale sans toucher au reste : implémenter l'interface `Retriever`, par exemple avec Workers AI (`@cf/baai/bge-m3`, multilingue) et Vectorize côté Worker. Pour des données de séances et de repas, la recherche locale suffit.

## Étendre le code

Le programme est de la **donnée**, le code ne fait que l'interpréter. Les points d'extension :

| Pour ajouter… | Où |
| --- | --- |
| un exercice | une ligne dans `shared/catalog.ts` (+ `src/assets/exercises/<clé>-0.jpg` et `-1.jpg` pour la démo) |
| un modèle de programme | un objet dans `TEMPLATES`, `shared/templates.ts` |
| un repère de la fiche de force | `STANDARDS` et `GROUPS`, `src/lib/strength.ts` |
| un module activable | un champ dans `Modules` (`src/lib/store.ts`), une ligne dans `MODULES` (`src/screens/Settings.tsx`), puis la condition là où il s'affiche |
| un onglet | une entrée dans `TABS` (`src/App.tsx`), avec sa condition `enabled` |
| une route API | `worker/index.ts` ; `user.store` donne le stockage de la personne connectée, `user.role` son rôle |
| un type de document pour le coach | `buildDocs` dans `src/lib/knowledge.ts` |
| une recherche par embeddings | une classe qui implémente `Retriever` (`src/lib/knowledge.ts`) |
| une étape d'accueil | `src/screens/Onboarding.tsx` |
| un rappel | `ReminderType`, `DEFAULT_CFG` et `buildReminder` dans `worker/reminders.ts` |

La sauvegarde locale passe par `migrate()` (`src/lib/store.ts`) : une ancienne sauvegarde reçoit les nouveaux champs avec leurs valeurs par défaut, donc ajouter un réglage ne casse rien.

## Apple Santé et passages à la salle

Une PWA ne peut pas lire Apple Santé directement : seules les apps natives y ont accès. Le pont passe par l'app Raccourcis de l'iPhone, gratuite et sans compte développeur.

- **Clé Raccourcis** : Réglages, Apple Santé et salle, « Créer ». Elle va dans l'en-tête `Authorization` des raccourcis et ne permet que d'envoyer Santé et les passages à la salle.
- **Installation en deux touches** : l'admin crée une fois les trois raccourcis (Shred Santé, Shred Arrivée, Shred Départ) avec une question d'importation sur un bloc Texte qui porte la clé, les partage par lien iCloud et colle les liens dans Réglages, Apple Santé et salle (stockés dans KV, `cfg:shortcuts`). Chacun touche ensuite « Installer » : l'app copie sa clé et ouvre le lien, Raccourcis demande de la coller. On ne peut pas aller plus loin : iOS refuse les fichiers `.shortcut` non signés (la signature demande un Mac) et les automatisations ne se partagent pas.
- **Synchro automatique** : la meilleure automatisation est « App » (WhatsApp, Instagram… « est ouverte », exécuter immédiatement) : Santé n'est lisible que quand l'iPhone est déverrouillé, et c'est justement le cas quand tu ouvres une app. Le serveur n'écrit que si les chiffres bougent, au plus une fois par quart d'heure pour de petits écarts, pour rester dans la limite d'écritures gratuite. Sur l'accueil, un bouton « Synchroniser » apparaît si Santé n'a rien envoyé depuis deux heures.
- **Raccourci « Shred Santé »** : lit les totaux du jour (pas, énergie active, énergie au repos, regroupés par jour pour ne pas compter deux fois iPhone et Apple Watch) et les envoie en POST à `/api/health/ingest`. Trois automatisations « Heure de la journée » le lancent à 13 h, 18 h 30 et 21 h. Le serveur garde le total le plus haut de la journée, donc un envoi vide (iPhone verrouillé) n'efface rien.
- **Automatisations Arrivée / Départ** sur l'adresse de la salle : POST sur `/api/gym/checkin` et `/api/gym/checkout`. À l'arrivée, une notification ouvre la séance du jour ; le rappel de séance est sauté si tu es déjà sur place.
- **Dans l'app** : anneau des pas, habitude « 8 000 pas » cochée automatiquement, bilan mangé contre dépensé, graphique des pas sur 14 jours, passages à la salle, et ces données dans le contexte du coach.
- Fitness Park ne propose ni API publique ni export : la géolocalisation est le seul moyen propre de savoir que tu es à la salle.

Le pas-à-pas pour créer le raccourci est dans le guide « Mettre Shred en ligne ».

Format accepté par `/api/health/ingest` (nombres ou texte à la française, « 8 432 » ou « 412,5 kcal ») :

```json
{ "steps": 8432, "active_kcal": 412.5, "resting_kcal": 1715, "date": "2026-10-13" }
```

`date` est optionnel (jour courant par défaut, 7 jours en arrière au maximum).

## Fiche de force

Chaque groupe musculaire (pecs, épaules, bras, ischios, quadriceps, dos) reçoit une note de E à A. L'app prend ta meilleure série des 8 dernières semaines sur les exercices de référence, estime ton 1RM (formule d'Epley, reps plafonnées à 15), le rapporte à ton dernier poids de corps et le compare à des repères de force d'un homme débutant à avancé. Les seuils sont dans `src/lib/strength.ts`. C'est un ordre de grandeur pour repérer un point faible, pas un test officiel. Le coach reçoit cette fiche et peut en tenir compte.

## Démos d'exercices

Les images viennent de [Free Exercise DB](https://github.com/yuhonas/free-exercise-db), domaine public (licence Unlicense) : deux positions par exercice, alternées pour former une mini-animation. Elles sont intégrées à l'app, donc visibles hors ligne à la salle. Le bouton « Voir des vidéos » ouvre une recherche YouTube sur l'exercice.

## Règles de la série

- **Journée validée** : par défaut la séance du jour (ou le repos actif) et au moins 3 repas notés. Réglable dans Objectifs.
- **Gels** : 1 au départ, +1 tous les 7 jours de série, 2 maximum. Un jour raté consomme un gel au lieu de casser la série.
- **Flammes** : chacun choisit à l'accueil (ou dans Objectifs) combien de jours tenir pour sa première flamme : 3, 7, 14 ou 30. Les suivantes s'espacent de plus en plus (7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, puis tous les 100 jours). Chaque flamme gagnée change la couleur de la tienne : étincelle, ardente, or, bleue, violette, légendaire. Les flammes se gardent même si la série casse ; la suivante se gagne en battant ton record.
- **Kilo** : la mascotte (un kettlebell à bandeau, personnage original) apporte la flamme à la première journée validée et revient à chaque palier. Les autres jours, la fête est une flamme animée et le compteur qui passe au jour suivant. Tout est en SVG et CSS, sans vidéo, et s'arrête si le téléphone demande moins d'animations.
- **XP** : 2 par série, 10 par repas, 5 par habitude, 5 par pesée, 50 par séance terminée, 50 par journée validée.
- **Progression** : quand toutes les séries atteignent le haut de la fourchette, l'app propose la charge suivante (+2,5 kg, +5 kg sur squat et soulevés).
- **Saisie rapide** : une charge ou des reps tapées sur une série se recopient sur les séries suivantes pas encore faites, sauf celles déjà changées à la main. Si tu restes à la même charge, il ne reste qu'à valider.

## Profil sportif, programmes et nutrition

L'accueil pose sept questions (toi, objectif, sport, salle, assiette, plan, coach) et en tire tout le reste. Tout se change dans Réglages, Profil sportif et Ma salle.

- **Besoins** (`shared/athlete.ts`) : métabolisme de base Mifflin-St Jeor, activité quotidienne, séances de la semaine. Sèche, recompo, maintien ou prise de masse, avec protéines rapportées à la masse maigre si on connaît la masse grasse. Avec une masse grasse visée, l'app projette le poids et le nombre de semaines, en supposant le muscle conservé.
- **Course** (`shared/plans.ts`) : 10 km, semi-marathon, marathon. Plan daté jusqu'au jour de la course (8, 12 ou 16 semaines, raccourci si la date est proche), phases fondamental, développement, spécifique et affûtage, semaine allégée toutes les 4 semaines. Allures calculées depuis un chrono récent (formule de Riegel) ou le niveau : endurance, seuil, fractionné, allure course.
- **Hyrox** : 12 semaines, force du bas du corps et traîneau, haut du corps et ergos, kilomètres à l'allure Hyrox, course et stations enchaînées, simulation, affûtage.
- **Salles** : Fitness Park, Basic-Fit, On Air, autre, maison. Le matériel se coche (l'équipement Hyrox varie d'un club à l'autre) ; chaque exercice impossible est remplacé par le meilleur équivalent disponible, avec une note.
- **Meal plan** (`shared/meals.ts`) : une trentaine de recettes calculées à partir d'aliments courants, portions ajustées aux macros, deux plats à préparer le dimanche et deux le mercredi, liste de courses par rayon. Respecte végétarien, sans porc, sans lactose, petit budget, cuisine rapide et aliments refusés.
- **Proposer un plat** (onglet Repas) : trois idées pour les calories et protéines qui restent, dehors, au supermarché ou à cuisiner, notables en un tap, ou « Demander à Claude » pour d'autres idées.

## Bilan de la semaine

Chaque lundi, l'app calcule le bilan de la semaine passée (`src/lib/report.ts`) : séances faites contre prévues, journées validées, moyennes de calories et de protéines, variation de poids contre le rythme visé, pas, records et exercices qui stagnent. Il propose des ajustements applicables en un tap : ±150 kcal selon la courbe de poids, un exercice pour le point faible de la fiche de force, une variante pour un exercice qui stagne depuis 4 semaines, du cardio sans impact au-dessus de 30 d'IMC.

**Par mail** : le bilan est calculé sur le téléphone (les données sont chiffrées côté serveur), puis envoyé par le serveur via [Resend](https://resend.com) si deux secrets sont définis :

```bash
npx wrangler secret put RESEND_API_KEY      # clé « re_… » du compte Resend (gratuit : 100 mails par jour)
npx wrangler secret put EMAIL_FROM          # « Shred <bilan@ton-domaine.fr> », domaine vérifié chez Resend
```

Sans domaine vérifié, Resend n'accepte d'envoyer qu'à l'adresse de ton propre compte Resend : pratique pour tester sur toi, pas pour tes amis. Chacun active l'envoi dans Réglages, Bilan de la semaine ; l'app l'envoie au premier lancement du lundi, une fois par semaine.

## Profils

Fiche, onglet Testeurs : la liste des autres comptes qui ont rendu leur profil visible, avec leur série, leur record, leurs flammes, leur niveau, leur programme et leur fiche de force (points forts et faibles). Chacun choisit dans Réglages, Profil public s'il se montre et quels champs. Par défaut, le profil est privé.

La sauvegarde étant chiffrée, le serveur ne peut rien calculer : c'est l'app qui envoie un petit résumé (`PUT /api/profile`), seulement avec les champs cochés, quand il change. Le serveur ne garde que les champs connus, bornés (`worker/profiles.ts`), et `GET /api/profiles` ne renvoie que les profils visibles, aux seuls comptes connectés.

## Structure

```
shared/types.ts     types partagés (programme, séance, exercice, repas)
shared/catalog.ts   bibliothèque d'exercices
shared/templates.ts modèles de programmes
shared/program.ts   résolution d'un programme, repas et habitudes par défaut, résumé pour le coach
src/screens/        Aujourd'hui, Séance, Repas, Coach, Fiche, Réglages, éditeur de programme
src/screens/Welcome.tsx     connexion, inscription, mot de passe oublié
src/screens/Onboarding.tsx  premier lancement (profil, objectif, programme, coach, rappels)
src/screens/Account.tsx     pages Compte et Testeurs
src/lib/crypto.ts   dérivation des clés, chiffrement de la sauvegarde
src/lib/account.ts  inscription, connexion, déconnexion, mot de passe
src/lib/backup.ts   sauvegarde chiffrée et synchronisation entre appareils
src/lib/session.ts  compte connecté sur ce téléphone
src/lib/knowledge.ts mémoire du coach : documents, recherche locale, dossier pour Claude
src/lib/flames.ts   paliers de série, couleurs des flammes, fête du jour
shared/athlete.ts   profil sportif, salles et matériel, calcul des besoins
shared/plans.ts     plans course et Hyrox, allures, adaptation au matériel
shared/meals.ts     aliments, recettes, meal plan, propositions de plats
src/lib/report.ts   bilan de la semaine, conseils, mail
src/lib/coaching.ts applique profil, programme, meal plan et conseils
src/lib/profile.ts  profil public : résumé envoyé, profils des autres
src/components/Celebration.tsx, Flame.tsx, Kilo.tsx  la fête, la flamme animée, la mascotte
src/screens/Community.tsx   profils des testeurs
src/lib/program-edit.ts toutes les modifications du programme, des repas et des habitudes
src/lib/ai.ts       modes IA (API, app Claude, aucun)
src/lib/logic.ts    série, gels, XP, progression des charges, poids
src/lib/push.ts     abonnement aux notifications
src/lib/sync.ts     envoi du résumé du jour au serveur
public/sw.js        hors ligne + affichage des notifications
worker/index.ts     routes de l'API
worker/claude.ts    analyse photo et coach
worker/webpush.ts   Web Push (VAPID + chiffrement)
worker/reminders.ts logique des rappels
worker/health.ts    réception Apple Santé et passages à la salle
worker/auth.ts      inscription, connexion, sessions, invitations, administration
worker/backup.ts    stockage de la sauvegarde chiffrée
worker/profiles.ts  profils publics
worker/report.ts    envoi du bilan par mail (Resend)
worker/users.ts     comptes, authentification, stockage par personne
src/lib/strength.ts fiche de force (notes A à E)
src/assets/exercises/ images des démos
scripts/setup.mjs   mise en ligne en une commande
scripts/admin.mjs   invitations et réinitialisations en ligne de commande
scripts/            génération des clés VAPID, tests
```

Le programme par défaut est dans `shared/templates.ts` ; chaque utilisateur le modifie ensuite dans l'app.
