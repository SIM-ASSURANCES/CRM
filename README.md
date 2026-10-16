# CRM Commercial — SIM Assurances

Application web du CRM B2B (Next.js + PostgreSQL). Ce dépôt contient le **socle technique** (phase 2 du plan
de développement) : authentification, rôles et permissions, journal d'audit, gabarit d'interface et
infrastructure de test. Les modules métier (prospects, comptes, opportunités…) arrivent aux phases 3 et 4.

Le plan complet est dans `docs/PLAN_DEVELOPPEMENT_CRM.md`.

## Prérequis

- Node.js 24 et npm
- Docker (pour la base PostgreSQL locale)

## Démarrage

```bash
npm install
cp .env.example .env      # puis remplacer les valeurs (secrets, mots de passe)
npm run db:up             # démarre PostgreSQL (conteneur crm_postgres, port 5435)
npm run db:migrate        # applique les migrations Prisma et génère le client
npm run db:seed           # crée l'administrateur initial (et les comptes de démo en développement)
npm run dev               # http://localhost:3100
```

Le mot de passe de l'administrateur initial est celui de `SEED_ADMIN_PASSWORD` dans `.env`. **Il doit être changé
à la première connexion.** Les comptes de démonstration (`direction@`, `manager@`, `commercial@`, `audit@crm.local`)
n'existent qu'en développement et utilisent `SEED_DEMO_PASSWORD`.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` / `build` / `start` | Serveur de développement, build et serveur de production (port 3100) |
| `npm run lint` / `typecheck` | ESLint et vérification TypeScript |
| `npm test` | Tests unitaires et d'intégration (Vitest) |
| `npm run db:up` / `db:down` | Démarre / arrête la base locale |
| `npm run db:migrate` | Crée et applique une migration (développement) |
| `npm run db:deploy` | Applique les migrations existantes (recette, production) |
| `npm run db:seed` | Compte administrateur initial et comptes de démonstration |
| `npm run db:studio` | Interface Prisma Studio |

### Tests d'intégration

Le journal d'audit est en ajout seul : il ne peut pas être nettoyé après un test. Les tests d'intégration
tournent donc sur une base dédiée, jamais sur la base de développement.

```bash
docker exec crm_postgres psql -U crm -d postgres -c "CREATE DATABASE crm_test"
# renseigner TEST_DATABASE_URL dans .env (voir .env.example), puis appliquer les migrations sur cette base :
DATABASE_URL=<TEST_DATABASE_URL> npx prisma migrate deploy
```

Sans `TEST_DATABASE_URL`, ces tests sont simplement ignorés.

## Architecture

```
src/
  app/
    (auth)/       pages publiques : login, forgot-password
    (crm)/        pages connectées (gabarit barre latérale + en-tête) : tableau de bord, change-password
    api/          auth (Better Auth) et health
    actions/      Server Actions partagées (déconnexion)
  components/     brand, auth, layout (sidebar, header, user-menu), ui (button, field)
  lib/            env, db, logger, errors, rate-limit, audit, utils
    auth/         auth (Better Auth), session (DAL), roles, permissions, password-policy
  proxy.ts        vérification optimiste du cookie de session
prisma/           schema.prisma, migrations, seed.ts
tests/            unit, integration
```

Règles de conception (cahier des charges, annexe A) :

- Les composants d'interface **n'appellent jamais Prisma**. Tout passe par une Server Action ou une route qui
  valide les entrées (Zod), vérifie l'identité et la permission, puis exécute le service métier.
- Le contrôle d'accès est **toujours** fait côté serveur (`requireUser`, `requirePermission`). Le proxy et la
  navigation filtrée par rôle ne sont que des confort.
- Les mutations sensibles écrivent dans `audit_logs`, table en ajout seul (trigger PostgreSQL interdisant
  `UPDATE`, `DELETE` et `TRUNCATE`).
- Les secrets ne sont jamais envoyés au navigateur ni écrits dans les logs (`logger` masque les champs sensibles).

### Particularités de Next.js 16

Ce projet utilise `cacheComponents` : toute lecture de la session (donnée de requête) doit se faire derrière un
`<Suspense>`, jamais au premier niveau d'un layout. `(crm)/layout.tsx` et `(crm)/loading.tsx` fournissent ces
frontières. `middleware` s'appelle désormais `proxy` (`src/proxy.ts`). Consulter `node_modules/next/dist/docs/`
avant de modifier ces mécanismes.

## Module prospects (phase 3)

Code métier dans `src/features/leads/` : `config` (étapes, seuils, motifs de perte), `schemas` (validation Zod),
`rules` (règles de qualification, pures), `scope` (périmètre de visibilité), `views` (les 5 écrans),
`service` (création, modification, perte, doublons, liste), `kpi` et `kpi-math` (tableau de bord).

- Les 5 écrans de reporting de l'Excel sont des **vues** d'un même enregistrement, filtrées sur le pourcentage
  d'avancement et le statut. Les seuils (40 / 60 / 80 %) sont des paramètres (table `settings`, clé `leads.thresholds`).
- Les KPI comparent la semaine courante à la précédente ; leurs définitions sont documentées dans `kpi.ts`.
- `npm run db:seed` crée 7 produits et, en développement, 12 prospects de démonstration pour `commercial@crm.local`
  avec un historique sur 5 semaines.

## Comptes et contacts (phase 4, sprint 4.2)

Code dans `src/features/accounts/` (`config`, `schemas`, `rules` pures, `scope`, `service`) et `src/features/contacts/`,
écrans dans `src/app/(crm)/comptes/` et `contacts/`.

- Hiérarchie groupe / filiale sans boucle ; vue groupe qui respecte les droits de chaque compte.
- Doublons détectés avant validation ; fusion de comptes réservée à la direction et à l'administrateur (compte
  fusionné archivé avec renvoi, jamais supprimé).
- Contacts rattachables à plusieurs comptes, avec rôle d'achat par compte et par produit.
- La table des comptes s'appelle `accounts_crm` (le nom `accounts` est pris par les identifiants de Better Auth).
- `npm run db:seed` crée en développement un groupe avec filiales, des clients et des contacts avec leurs rôles.

## Opportunités et Kanban (phase 4, sprint 4.3)

Code dans `src/features/opportunities/` (`config`, `schemas`, `rules` pures, `scope`, `service`, `conversion`),
écrans dans `src/app/(crm)/opportunites/` et `src/app/(crm)/prospects/[id]/convertir/`.

- Kanban par étape (10 à 90 %), glisser-déposer ou sélecteur au clavier ; chaque changement d'étape passe par une
  confirmation (critère de sortie, contrat signé et premier paiement pour « gagnée », motif pour « perdue »).
- Montants brut, pondéré et signé **calculés côté serveur** ; jamais acceptés du navigateur.
- « Convertir » sur un prospect crée compte, contact et opportunité dans une seule transaction (doublons signalés,
  rattachement possible à un compte existant) ; le prospect et son historique sont conservés.
- `npm run db:seed` crée en développement 8 opportunités (une par étape ouverte, une gagnée, une perdue).

## Activités et tâches (phase 4, sprint 4.4)

Code dans `src/features/activities/` (`config`, `schemas`, `service` avec le fil unifié) et `src/features/tasks/`
(`config`, `rules` pures, `schemas`, `scope`, `service`), écrans dans `src/app/(crm)/activites/` et `taches/`.

- Fil unifié (activités, tâches, changements d'étape) avec l'origine de chaque événement et des filtres ; il est
  intégré aux fiches compte et opportunité.
- Une activité liée à une opportunité ouverte met à jour sa prochaine action.
- Toute tâche ouverte a un responsable ; les retards se calculent côté serveur à partir de l'échéance (un jour, UTC).
- Les relances automatiques et le centre de notifications arrivent au sprint 4.5.
- `npm run db:seed` crée en développement 6 activités et 4 tâches (dont une en retard) pour `commercial@crm.local`.

## Automatisations et notifications (phase 4, sprint 4.5)

Code dans `src/features/automations/` (`config` des règles, `rules` pures, `engine`, `service` d'administration) et
`src/features/notifications/`, écrans `/notifications` et `/admin/automatisations`.

- Cinq règles de relance (compte sans activité, prochaine action dépassée, clôture dépassée, rendez-vous imminent,
  tâche en retard), activables et paramétrables par l'administrateur, avec journal d'exécution.
- **Idempotent** : une tâche par règle, compte et période ; une notification par destinataire, règle et période
  (clés uniques en base). Relancer le moteur ne crée jamais de doublon.
- Déclenchement : bouton « Exécuter maintenant », `npm run jobs:run`, ou `POST /api/jobs/automations` avec
  `Authorization: Bearer <CRON_SECRET>` (la route est désactivée si `CRON_SECRET` est absent). Exemple de cron :
  `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://votre-crm/api/jobs/automations` chaque heure.

## Audit et import (phase 4, sprint 4.6)

Code dans `src/features/audit/` (consultation, export) et `src/features/imports/` (`config`, `parse`, `rules`,
`analysis` pures, `service`), écrans `/admin/audit` et `/admin/import`, routes `/api/audit/export`,
`/api/import/[id]/rejects` et `/api/import/template`. Utilitaire CSV partagé : `src/lib/csv.ts`.

- **Journal d'audit** : filtrable, en ajout seul ; son export CSV (plafonné, limité en fréquence) est lui-même tracé.
- **Import CSV/XLSX** (comptes, contacts, prospects), réservé à l'administrateur : dépôt → association des colonnes →
  analyse (rapport de qualité : rejets, doublons, champs manquants) → import après confirmation. Rien n'est écrit avant.
- L'import est **reprenable** et sans double création ; les cellules d'origine sont conservées jusqu'à la validation
  du rapprochement (voir « Migration de données », phase 7).
- Limites : 2 000 lignes et 5 Mo par fichier. Dans Excel, enregistrez les téléphones en texte pour garder le 0 initial.

## Stabilisation (phase 4, sprint 4.7)

- `npm test` : suite complète (unitaires + intégration sur la base de test `crm_test`).
- `npm run test:perf` : tests de performance sur un jeu de 80 000 lignes (5 000 comptes, 15 000 contacts, 10 000
  opportunités, 40 000 activités, 10 000 tâches), avec un budget de temps par écran. **Base de test uniquement** : le
  jeu est créé puis supprimé.
- Essai de bout en bout dans le navigateur, sans toucher à la base de développement :

  ```bash
  node scripts/e2e-env.mjs npx tsx --conditions=react-server prisma/seed.ts          # données de démonstration
  node scripts/e2e-env.mjs npx tsx --conditions=react-server scripts/e2e-user.ts      # comptes d'essai (mots de passe générés)
  npm run dev:e2e                                                                      # http://localhost:3101
  ```

  Les identifiants générés sont écrits dans `.e2e-credentials` (ignoré par git).

## Migration de données (phase 7)

Code dans `src/features/imports/` (`values`, `profile`, `analysis` purs ; `service` ; `migration`) et `src/lib/phone.ts`,
écran `/admin/import/[id]`.

- **Inventaire de la source** dès le dépôt : volumes, doublons, taux de remplissage, types et valeurs fréquentes par colonne.
- **Téléphones : format unique +225** (10 chiffres commençant par 0), à l'import comme à la saisie manuelle. Un numéro à
  8 chiffres (avant 2021) est signalé et jamais converti ; un autre indicatif international est conservé tel quel.
- **Valeurs à rapprocher** : secteurs et produits inconnus listés, l'administrateur choisit la valeur du CRM (conservée
  dans le lot), sinon la ligne est rejetée.
- **Prospects** importables ; 100 % = gagné présumé ; l'historique est daté de la date du fichier.
- **Import pilote** (50 premières lignes) puis import du reste ; rapport d'anomalies téléchargeable (CSV).
- **Rapprochement** : lignes du fichier = importées + rejetées + doublons ; chaque ligne importée retrouvée en base ;
  chiffre d'affaires du fichier égal à celui de la base. La **validation** (auditée) efface la source ; sans validation,
  elle est effacée d'office après 90 jours (`POST /api/jobs/automations`).
- **Téléphones déjà enregistrés** : simulation puis normalisation depuis `/admin/import` (à lancer sur demande).

## Reporting avancé (phase 6)

Code dans `src/features/reporting/` (`config` : dictionnaire des KPI ; `rules` et `schemas` purs ; `service` ; `export`),
écrans `/rapports/previsions`, `/rapports/pertes` et `/admin/objectifs`, route `/api/reports/export`.

- **Prévisions** : pipeline brut, pipeline pondéré, gagnées, revenu signé et forecast (signé + pondéré), par mois, trimestre
  ou année, segmentés par produit, équipe, commercial, secteur ou groupe de comptes. **Montants annualisés** (mensuel × 12).
- **Objectifs** : un montant par commercial et par mois (`/admin/objectifs`) ; trimestre, année et équipe en sont la somme.
  Écart et taux d'atteinte affichés, « non calculable » quand l'objectif est absent.
- **Motifs de perte** croisés avec le produit, le secteur, le commercial, la taille du compte ou l'équipe.
- **Exports CSV / XLSX** (manager et au-dessus) : mêmes chiffres que l'écran (testé), filtres et date de génération en
  en-tête, définitions des KPI incluses, limités en fréquence et en volume, chaque export tracé dans le journal d'audit.
- Chacun ne voit que son périmètre (commercial : les siennes ; manager : son équipe ; direction, administrateur et audit : tout).

## Intégration Microsoft 365 — messagerie (phase 5)

Code dans `src/features/integrations/` (`rules` pures, `connection`, `sync`, `subscriptions`, `webhook`, `exclusions`,
`microsoft/oauth` et `microsoft/graph`), écran `/integrations` (« Messagerie »), routes `/api/integrations/microsoft/callback`
et `/webhook`, `/api/jobs/integrations`. Chiffrement des jetons : `src/lib/crypto.ts`. Guide complet :
[`docs/INTEGRATION_MICROSOFT.md`](docs/INTEGRATION_MICROSOFT.md).

- **Lecture seule** : chaque utilisateur connecte sa boîte ; le CRM lit les **en-têtes** (objet, expéditeur, destinataires, date)
  et crée une activité « e-mail » sur les comptes dont un contact est interlocuteur. Jamais le contenu ni les pièces jointes.
- Désactivée tant que `MS_CLIENT_ID`, `MS_CLIENT_SECRET` et `TOKEN_ENCRYPTION_KEY` sont absents (voir `.env.example`).
- Planificateur : `POST /api/jobs/integrations` toutes les 1 à 2 minutes, avec `Authorization: Bearer $CRON_SECRET`.
- Tests : un faux fournisseur Microsoft remplace le réseau ; le comportement réel de Graph reste à confirmer avec une
  application Azure (essai pilote).

## Base de données locale

Le projet peut utiliser le PostgreSQL installé sur la machine (bases `crm` et `crm_test`) ou le conteneur Docker (`npm run db:up`).
Pour changer de base : modifier `DATABASE_URL` et `TEST_DATABASE_URL` dans `.env`, puis `npm run db:deploy` (développement)
et appliquer les migrations à la base de test avant `npm test`.

## Administration des utilisateurs (phase 4, sprint 4.1)

Code dans `src/features/users/` (`service`, `teams`, `schemas`) et `src/app/(crm)/admin/`. Réservée au rôle
Administrateur (permission `user:manage`, vérifiée dans les pages, les actions et les services).

- `/admin/utilisateurs` : liste, création, rôle, équipe, désactivation, **réinitialisation du mot de passe**.
- `/admin/demandes` : demandes saisies depuis « Mot de passe oublié » (compteur sur la cloche de l'en-tête).
- `/admin/equipes` : équipes et responsables (le manager voit les prospects de son équipe).
- Un mot de passe temporaire n'est affiché qu'une fois à l'administrateur ; il n'est ni stocké en clair ni journalisé.
- En développement, `npm run db:seed` crée `admin.demo@crm.local` (mot de passe : `SEED_DEMO_PASSWORD`) et une équipe de démo.

## Authentification

- Better Auth : sessions en base, cookies `HttpOnly`, hachage des mots de passe, inscription publique désactivée.
- Les comptes sont créés **uniquement par un administrateur**.
- **Mot de passe oublié** : réinitialisation par l'administrateur (pas d'envoi d'e-mail). La page publique enregistre
  une demande ; l'administrateur génère un mot de passe temporaire et l'utilisateur doit en choisir un nouveau à
  la connexion suivante (`must_change_password`).
- Un seul chemin de connexion : l'action serveur de `/login` (limitation de débit, audit des échecs).
  L'endpoint HTTP `/api/auth/sign-in/email` est désactivé.

## À faire (suite de la phase 2 et phase 4.1)

- Page d'administration des utilisateurs : création, rôle, désactivation, **réinitialisation du mot de passe**,
  file des demandes (`password_reset_requests`).
- Remplacer le logo provisoire (`components/brand/brand-logo.tsx`) par le fichier vectoriel officiel.
- Limiteur de débit partagé (PostgreSQL ou Redis) avant tout déploiement multi-instances.
- Politique CSP complète (script-src avec nonce) lors de la revue de sécurité.
- Pipeline CI (lint, types, tests, build).
