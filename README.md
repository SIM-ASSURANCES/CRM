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
