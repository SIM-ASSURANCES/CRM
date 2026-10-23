# Déploiement du CRM (Docker + Dokploy)

Image : `ghcr.io/sim-assurances/crm:v3` · Domaine : **`https://crm.mysimassurances.com`** · Port du conteneur : **3000**
Fichier de déploiement : [`docker-compose.raw.yml`](../docker-compose.raw.yml) (Dokploy → Compose → Provider **Raw**)

**Au déploiement, tout se fait automatiquement :**

| Étape | Qui s'en charge |
|---|---|
| Base PostgreSQL | service `db` du compose (volume persistant) |
| Migrations de la base | le conteneur `app` au démarrage (`prisma migrate deploy`) |
| Premier administrateur | le conteneur `app` au démarrage, **s'il n'existe pas** (voir §3) |
| Domaine, HTTPS (Let's Encrypt), redirection HTTP→HTTPS | étiquettes Traefik du compose |
| Tâches planifiées (relances, nettoyage, synchronisations) | service `scheduler` du compose |

Le conteneur `app` tourne sous l'utilisateur non-root `node` et expose une sonde de santé : `GET /api/health` (200 si
l'application et sa base répondent, 503 sinon).

## 1. Prérequis

| Élément | Détail |
|---|---|
| Serveur Dokploy | avec le réseau Traefik standard `dokploy-network` et le résolveur de certificats `letsencrypt` (installation par défaut). |
| Nom de domaine | enregistrement DNS `crm.mysimassurances.com` → adresse IP du serveur Dokploy. |
| Accès à l'image | le paquet GHCR est **privé** : exécuter une fois sur le serveur `docker login ghcr.io` (utilisateur GitHub + jeton `read:packages`), ou rendre le paquet public. |

## 2. Variables d'environnement (Dokploy → Compose → Environment)

| Variable | Obligatoire | Valeur |
|---|---|---|
| `POSTGRES_PASSWORD` | oui | lettres et chiffres uniquement : `openssl rand -hex 24`. Ne pas la changer après le premier démarrage (la base garde l'ancienne valeur). |
| `BETTER_AUTH_SECRET` | oui | au moins 32 caractères : `openssl rand -base64 32`. **Ne jamais le changer sans prévenir** : il invalide les sessions. |
| `BETTER_AUTH_URL` | oui | `https://crm.mysimassurances.com` (sans slash final) |
| `CRON_SECRET` | recommandée | `openssl rand -base64 32` ; sans elle, le planificateur reste inactif (relances et nettoyage désactivés). |
| `SEED_ADMIN_PASSWORD` | non | mot de passe temporaire de l'administrateur. **Vide = généré automatiquement** et affiché une seule fois dans les journaux. |
| `LOG_LEVEL`, `RUN_MIGRATIONS`, `BOOTSTRAP_ADMIN` | non | `info`, `true`, `true` par défaut. `false` désactive respectivement les migrations ou la création de l'administrateur. |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `TOKEN_ENCRYPTION_KEY` | non | intégration Microsoft 365 (voir `docs/INTEGRATION_MICROSOFT.md`). `TOKEN_ENCRYPTION_KEY` : `openssl rand -base64 32`, **à sauvegarder** : sa perte rend les jetons illisibles. |

Ne jamais laisser une variable vide dans Environment (sauf `SEED_ADMIN_PASSWORD`) : supprimer la ligne. Les secrets ne sont
jamais dans l'image.

## 3. Déployer

1. Dokploy → **Create Compose** → Provider **Raw** → coller le contenu de `docker-compose.raw.yml`.
2. Onglet **Environment** : renseigner les variables du §2.
3. **Deploy**. Dans les journaux du service `app`, on lit successivement : « All migrations have been successfully applied. »,
   « Administrateur créé… », puis « Ready ».
4. **Premier administrateur** : `admin@crm.local` (modifiable dans le compose, variable `SEED_ADMIN_EMAIL`).
   - Si `SEED_ADMIN_PASSWORD` est vide, relever le mot de passe dans le bloc encadré « PREMIER ADMINISTRATEUR CRÉÉ » des
     journaux du service `app` (affiché **une seule fois**, au tout premier démarrage).
   - Dans tous les cas, le changement du mot de passe est exigé à la première connexion.
   - Aux démarrages suivants, le compte existant n'est jamais modifié et aucun mot de passe n'est réaffiché.
   - Un échec de cette étape (mot de passe trop faible, par exemple) n'empêche pas l'application de démarrer : il est
     signalé par « ATTENTION » dans les journaux.

> **Une seule réplique.** Le limiteur de débit (connexion, exports, webhooks) est en mémoire : avec plusieurs répliques,
> chacune compte séparément. Ne pas dépasser une instance de `app` tant qu'il n'est pas déplacé en base ou dans Redis.

## 4. Tâches planifiées

Le service `scheduler` du compose appelle l'application **à l'intérieur du réseau du compose** (aucune configuration dans
Dokploy) : relances automatiques et purge des sources d'import de plus de 90 jours **toutes les heures**, synchronisations
Microsoft **toutes les 15 minutes** (si `MS_CLIENT_ID` est défini). Sans `CRON_SECRET`, il l'indique dans ses journaux et
reste inactif.

Microsoft 365 : URI de redirection Azure `https://crm.mysimassurances.com/api/integrations/microsoft/callback`.

## 5. Mise à jour, sauvegarde et retour arrière

1. **Sauvegarder la base avant toute mise à jour** : `pg_dump -Fc crm > crm-AAAAMMJJ.dump` (voir aussi `npm run recette:restore-test`
   qui prouve qu'une sauvegarde se restaure, avec les objectifs RPO 24 h / RTO 4 h de `docs/RECETTE.md`).
2. Changer le tag de l'image dans le compose (`v3`, `v4`…), jamais réutiliser un tag, puis **Redeploy**.
3. Les migrations sont **en avant uniquement** : un retour à l'image précédente ne défait pas une migration. Si une migration
   pose problème : remettre l'image précédente **et** restaurer la sauvegarde de l'étape 1.
4. Pour contrôler soi-même les migrations : `RUN_MIGRATIONS=false`, puis dans le terminal du conteneur
   `./node_modules/.bin/prisma migrate deploy`.
5. **Repartir d'une base vide** (uniquement si elle ne contient aucune donnée utile) : changer le nom du volume dans le
   compose (`crm_pgdata_v2` → `crm_pgdata_v3`, aux deux endroits) puis **Redeploy**.

## 6. Construire et publier l'image (poste de développement)

```bash
docker build -t ghcr.io/sim-assurances/crm:v3 .
docker login ghcr.io            # utilisateur GitHub + jeton (PAT) avec le droit write:packages
docker push ghcr.io/sim-assurances/crm:v3
```

Le Dockerfile utilise des valeurs factices uniquement pendant la compilation ; aucune variable réelle n'entre dans l'image.
Taille actuelle : environ 2 Go décompressés (toutes les dépendances sont embarquées pour disposer du CLI de migration) :
une optimisation en mode `standalone` est possible plus tard.

## 7. Vérifier après déploiement

- `https://crm.mysimassurances.com/api/health` → `{"status":"ok"}`
- `https://crm.mysimassurances.com/login` s'affiche (certificat Let's Encrypt), connexion avec le premier administrateur,
  changement du mot de passe.
- En-têtes de sécurité (CSP, HSTS, `X-Frame-Options`) présents : `curl -sI https://crm.mysimassurances.com/login`.
- Journaux du service `scheduler` : « Planificateur actif… ».

## 8. Dépannage

| Symptôme | Cause probable |
|---|---|
| « 404 page not found » et certificat « TRAEFIK DEFAULT CERT » | le conteneur `app` n'est pas démarré ou pas « healthy » (image non téléchargée : `docker login ghcr.io` ; variable manquante), ou domaine mal orthographié dans le compose |
| `P1000: Authentication failed` dans les journaux | `POSTGRES_PASSWORD` modifié après le premier démarrage : changer le nom du volume (§5.5) ou aligner le mot de passe avec `ALTER USER` |
| « Identifiants incorrects » | mot de passe de l'administrateur : relire le bloc des journaux du premier démarrage ; si le compte existe déjà, il n'est jamais réinitialisé par le démarrage |
