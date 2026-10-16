# Déploiement du CRM (Docker + Dokploy)

Image : `ghcr.io/sim-assurances/crm:v0` · Domaine : **`https://crm.mysimssurances.com`** · Port du conteneur : **3000**

Le conteneur applique les migrations de base de données au démarrage (`prisma migrate deploy`), puis lance le serveur
Next.js. Il tourne sous l'utilisateur non-root `node` et expose une sonde de santé : `GET /api/health` (200 si
l'application et sa base répondent, 503 sinon).

## 1. Prérequis

| Élément | Détail |
|---|---|
| PostgreSQL 16 ou plus | Service de base de données Dokploy ou serveur externe. Créer une base vide `crm` et un utilisateur dédié. |
| Nom de domaine | Enregistrement DNS `crm.mysimssurances.com` → adresse IP du serveur Dokploy. HTTPS par Let's Encrypt (Traefik de Dokploy). |
| Accès à l'image | Le paquet GHCR est **privé** par défaut : dans Dokploy, enregistrer `ghcr.io` avec un nom d'utilisateur GitHub et un jeton (PAT) ayant le droit `read:packages`. |

## 2. Variables d'environnement (application Dokploy → Environment)

| Variable | Obligatoire | Valeur |
|---|---|---|
| `DATABASE_URL` | oui | `postgresql://<utilisateur>:<mot de passe>@<hôte>:5432/crm` |
| `BETTER_AUTH_SECRET` | oui | Au moins 32 caractères : `openssl rand -base64 32`. **Ne jamais le changer sans prévenir** : il invalide les sessions. |
| `BETTER_AUTH_URL` | oui | `https://crm.mysimssurances.com` (sans slash final) |
| `CRON_SECRET` | recommandée | `openssl rand -base64 32` ; sans elle les routes planifiées répondent 404 (relances et nettoyage désactivés). |
| `LOG_LEVEL` | non | `info` (défaut) |
| `RUN_MIGRATIONS` | non | `true` (défaut). Mettre `false` pour lancer les migrations à la main (voir §6). |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `TOKEN_ENCRYPTION_KEY` | non | Intégration Microsoft 365 (voir `docs/INTEGRATION_MICROSOFT.md`). `TOKEN_ENCRYPTION_KEY` : `openssl rand -base64 32`, **à sauvegarder** : sa perte rend les jetons illisibles. |

Les secrets ne sont jamais dans l'image : ils vivent uniquement dans l'environnement du conteneur.

## 3. Créer l'application dans Dokploy

1. **Create Application** → source **Docker** → image `ghcr.io/sim-assurances/crm:v0`, avec le registre GHCR enregistré (§1).
2. Onglet **Environment** : renseigner les variables du §2.
3. Onglet **Domains** : domaine `crm.mysimssurances.com`, **port 3000**, HTTPS activé (certificat Let's Encrypt).
4. Onglet **Advanced → Health check** (si proposé) : chemin `/api/health`, port 3000.
5. **Deploy**. Les journaux doivent afficher « All migrations have been successfully applied. » puis « Ready ».

> **Une seule réplique.** Le limiteur de débit (connexion, exports, webhooks) est en mémoire : avec plusieurs répliques,
> chacune compte séparément. Ne pas dépasser une instance tant qu'il n'est pas déplacé en base ou dans Redis.

## 4. Premier administrateur

La base est vide après les migrations : aucun compte n'existe. Dans le terminal du conteneur (Dokploy → application →
**Terminal**), exécuter :

```bash
SEED_ADMIN_EMAIL=prenom.nom@exemple.ci SEED_ADMIN_NAME="Nom Prénom" SEED_ADMIN_PASSWORD='<mot de passe temporaire robuste>' \
  ./node_modules/.bin/tsx --conditions=react-server prisma/seed.ts
```

Le mot de passe est temporaire : le changement est exigé à la première connexion. En production (`NODE_ENV=production`),
**aucun compte de démonstration n'est créé**. Les produits de référence sont vérifiés et créés si besoin.

## 5. Tâches planifiées (relances, nettoyage, synchronisations)

Dokploy → **Schedules** (ou cron du serveur), avec le même secret que `CRON_SECRET` :

```bash
# toutes les heures : relances automatiques + purge des sources d'import de plus de 90 jours
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.mysimssurances.com/api/jobs/automations

# toutes les 15 minutes (seulement si l'intégration Microsoft est activée)
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.mysimssurances.com/api/jobs/integrations
```

Microsoft 365 : URI de redirection Azure `https://crm.mysimssurances.com/api/integrations/microsoft/callback`.

## 6. Mise à jour, sauvegarde et retour arrière

1. **Sauvegarder la base avant toute mise à jour** : `pg_dump -Fc crm > crm-AAAAMMJJ.dump` (voir aussi `npm run recette:restore-test`
   qui prouve qu'une sauvegarde se restaure, avec les objectifs RPO 24 h / RTO 4 h de `docs/RECETTE.md`).
2. Déployer le nouveau tag d'image (`v1`, `v2`…), jamais un tag réutilisé.
3. Les migrations sont **en avant uniquement** : un retour à l'image précédente ne défait pas une migration. Si une migration
   pose problème : remettre l'image précédente **et** restaurer la sauvegarde de l'étape 1.
4. Pour contrôler soi-même les migrations : `RUN_MIGRATIONS=false`, puis dans le terminal du conteneur
   `./node_modules/.bin/prisma migrate deploy`.

## 7. Construire et publier l'image (poste de développement)

```bash
docker build -t ghcr.io/sim-assurances/crm:v0 .
docker login ghcr.io            # utilisateur GitHub + jeton (PAT) avec le droit write:packages
docker push ghcr.io/sim-assurances/crm:v0
```

Le Dockerfile utilise des valeurs factices uniquement pendant la compilation ; aucune variable réelle n'entre dans l'image.
Taille actuelle : environ 2 Go décompressés (toutes les dépendances sont embarquées pour disposer du CLI de migration) :
une optimisation en mode `standalone` est possible plus tard.

## 8. Vérifier après déploiement

- `https://crm.mysimssurances.com/api/health` → `{"status":"ok"}`
- `https://crm.mysimssurances.com/login` s'affiche, connexion avec le premier administrateur, changement du mot de passe.
- En-têtes de sécurité (CSP, HSTS, `X-Frame-Options`) présents : `curl -sI https://crm.mysimssurances.com/login`.
