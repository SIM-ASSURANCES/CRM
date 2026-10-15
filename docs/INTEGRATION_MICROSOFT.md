# Intégration Microsoft 365 — messagerie (phase 5)

Le CRM lit les **en-têtes** des e-mails d'un utilisateur (objet, expéditeur, destinataires, date) et crée une activité
« e-mail » dans le fil des comptes dont un contact figure parmi les interlocuteurs. **Lecture seule** : rien n'est envoyé,
modifié ni supprimé dans la boîte. Le contenu des messages et les pièces jointes ne sont jamais lus.

## 1. Ce que le CRM demande à Microsoft (moindre privilège)

| Droit délégué | Pourquoi |
|---|---|
| `offline_access` | Obtenir un jeton d'actualisation : synchroniser sans que l'utilisateur soit présent |
| `User.Read` | Lire son propre profil (adresse du compte connecté) |
| `Mail.ReadBasic` | Lire les en-têtes des messages (pas le corps, pas les pièces jointes) |

Aucun droit d'application : chaque utilisateur consent pour **sa** boîte, et peut retirer son accès à tout moment depuis le CRM
(« Déconnecter ») ou depuis <https://myaccount.microsoft.com> (« Applications autorisées »).

## 2. Inscrire l'application dans Microsoft Entra ID (Azure)

À faire une fois, par un administrateur du locataire Microsoft de SIM Assurances.

1. <https://entra.microsoft.com> → **Applications** → **Inscriptions d'applications** → **Nouvelle inscription**.
2. Nom : `CRM SIM Assurances`. Types de comptes pris en charge : **Comptes de cet annuaire d'organisation uniquement** (un seul locataire).
3. URI de redirection, type **Web** : `{BETTER_AUTH_URL}/api/integrations/microsoft/callback`
   (en production : `https://<domaine du CRM>/api/integrations/microsoft/callback`).
4. **Autorisations de l'API** → **Ajouter une autorisation** → **Microsoft Graph** → **Autorisations déléguées** :
   `offline_access`, `User.Read`, `Mail.ReadBasic`. Ces droits ne demandent pas de consentement administrateur, mais si la
   politique du locataire l'impose, cliquez sur **Accorder le consentement administrateur**.
5. **Certificats et secrets** → **Nouveau secret client** : copiez la **valeur** (affichée une seule fois) et notez sa date d'expiration.
6. Depuis **Vue d'ensemble**, relevez l'**ID d'application (client)** et l'**ID de l'annuaire (locataire)**.

## 3. Variables d'environnement

| Variable | Valeur |
|---|---|
| `MS_CLIENT_ID` | ID d'application (client) |
| `MS_CLIENT_SECRET` | Valeur du secret client |
| `MS_TENANT_ID` | ID de l'annuaire (locataire). Par défaut `organizations` : tout compte professionnel Microsoft |
| `TOKEN_ENCRYPTION_KEY` | Clé AES-256 en base64 : `openssl rand -base64 32` |

- Sans `MS_CLIENT_ID`, l'intégration est désactivée et la page **Messagerie** l'indique.
- `MS_CLIENT_ID` exige `MS_CLIENT_SECRET` **et** `TOKEN_ENCRYPTION_KEY` : l'application refuse de démarrer sinon.
- **Perdre `TOKEN_ENCRYPTION_KEY` oblige chaque utilisateur à se reconnecter** (les jetons stockés deviennent illisibles ; la
  connexion passe à « À reconnecter » et l'utilisateur est prévenu). Conservez-la dans le coffre de secrets de l'organisation, avec les sauvegardes.
- Le secret client Azure expire : planifiez son renouvellement avant l'échéance (nouveau secret, mise à jour de `MS_CLIENT_SECRET`, redémarrage).

## 4. Planificateur

Une seule tâche suffit, à lancer **toutes les 1 à 2 minutes** :

```bash
curl -fsS -X POST "$BETTER_AUTH_URL/api/jobs/integrations" -H "Authorization: Bearer $CRON_SECRET"
```

Elle (1) crée ou renouvelle les abonnements aux notifications Microsoft, puis (2) synchronise les boîtes dont la dernière
lecture date de plus de 15 minutes **ou** qu'une notification a signalées. Un appel qui ne trouve rien à faire est quasi gratuit.
`CRON_SECRET` (32 caractères au moins) est le même que pour `/api/jobs/automations`. Sans lui, la route répond 404.

## 5. Notifications Microsoft (webhooks) — optionnel, accélérateur

- Microsoft appelle `POST /api/integrations/microsoft/webhook` quand un message arrive : la boîte est relue dans la minute qui suit
  au lieu de 15 minutes.
- Nécessite une adresse **HTTPS publique** (`BETTER_AUTH_URL` en `https://`). En local (`http://localhost`), l'abonnement est
  simplement ignoré et la lecture régulière suffit.
- Chaque notification est authentifiée par un secret propre à la connexion (`clientState`, comparé en temps constant). Son contenu
  n'est jamais cru : elle ne fait que marquer la connexion « à synchroniser ». La réponse est immédiate (202).
- Un abonnement dure ~70 h et est renouvelé automatiquement 12 h avant son expiration.

## 6. Comportement et garanties

- **Dédoublonnage** : clé technique `Message-ID` (stable si le message change de dossier). Relire un message ne crée rien de plus.
  Un message vu par deux comptes donne une activité par compte.
- **Périmètre** : une activité n'est créée que sur un compte que l'utilisateur **voit** (commercial : ses comptes ; manager : son équipe).
- **Exclusions** : brouillons, messages marqués personnel/privé/confidentiel dans Outlook, interlocuteurs inconnus, et domaines de la
  liste d'exclusion (page **Messagerie**, section administrateur ; sous-domaines inclus).
- **Première synchronisation** : 30 derniers jours. Ensuite, lecture incrémentale par curseur (« delta »), enregistré après chaque page.
- **Curseur perdu** (410) : relecture depuis la date de départ ; les doublons sont écartés.
- **Limitation de débit** (429) : synchronisation « partielle », reprise à l'exécution suivante.
- **Accès révoqué** : la connexion passe à « À reconnecter », l'utilisateur reçoit une notification (une seule par période de consentement)
  et un encadré guidé sur la page. Reconnecter le **même** compte reprend là où la lecture s'était arrêtée.
- **Journal** : chaque opération (synchronisation, connexion, renouvellement, abonnement) est inscrite dans `sync_events` avec ses
  compteurs ; la vue d'ensemble (administrateur et audit) montre l'état de toutes les connexions, les « À reconnecter » en tête.
- **Sécurité** : jetons chiffrés AES-256-GCM liés à leur ligne et à leur colonne ; PKCE + état anti-CSRF à usage unique (10 min) ;
  adresses de curseur vérifiées avant tout envoi de jeton ; aucun jeton ni contenu de message dans les journaux ou l'audit.

## 7. Activation progressive (groupe pilote)

1. Renseigner les variables sur un environnement de recette, inscrire l'application Azure avec l'URI de redirection de la recette.
2. Renseigner la liste d'exclusion (webmails grand public, domaines personnels connus).
3. Faire connecter 3 à 5 commerciaux pilotes ; vérifier au bout de 2 jours le journal et la pertinence des activités importées
   (aucun message personnel, rapprochements corrects).
4. Étendre par équipe. Aucun changement de code : chaque utilisateur se connecte lui-même depuis **Messagerie**.

## 8. Dépannage

| Symptôme | Cause probable |
|---|---|
| « L'intégration n'est pas encore activée » | Variables `MS_*` / `TOKEN_ENCRYPTION_KEY` absentes |
| Retour Microsoft : erreur de redirection (`AADSTS50011`) | L'URI de redirection Azure ne correspond pas exactement à `{BETTER_AUTH_URL}/api/integrations/microsoft/callback` |
| « La connexion à Microsoft a échoué » | Secret client expiré ou erroné, ou consentement non accordé |
| Beaucoup de connexions « À reconnecter » d'un coup | `TOKEN_ENCRYPTION_KEY` modifiée, ou secret client Azure renouvelé de façon incorrecte |
| Aucune activité importée | Les interlocuteurs ne sont pas des contacts rattachés à un compte visible par l'utilisateur, ou leur domaine est exclu |
| Notifications jamais reçues | `BETTER_AUTH_URL` non public/HTTPS ; la lecture régulière (15 min) prend le relais |

## 9. Hors périmètre de cette livraison

Synchronisation du **calendrier** (règle retenue pour plus tard : le calendrier de l'utilisateur fait foi en cas de conflit),
liens Teams, regroupement par fils de conversation, autres fournisseurs (Google Workspace). Les droits correspondants ne sont pas
demandés tant que ces fonctions n'existent pas.
