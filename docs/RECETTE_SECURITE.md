# Revue de sécurité — phase 8

Audit réalisé le 16/10/2026 sur le code de la branche `main` (après la phase 7). Il suit l'OWASP Top 10 (2021) et la section 7 du plan. Chaque ligne indique ce qui a été **vérifié dans le code** et ce qui reste **à la charge de l'hébergement**. Rien ici ne remplace un test d'intrusion par un tiers.

## 1. Synthèse

| Résultat | Détail |
|---|---|
| Dépendances de production | **0 vulnérabilité connue** (`npm audit --omit=dev`) après montée de `prisma` en 7.10.1 |
| Dépendances de développement | 5 alertes hautes dans `eslint-config-next` (outil de lint, non embarqué) : acceptées, voir A-04 |
| Injection SQL | Aucune concaténation : les 5 requêtes brutes sont des gabarits paramétrés |
| Contrôle d'accès | Appliqué côté serveur à chaque opération ; hors périmètre = « introuvable » |
| Corrigé pendant l'audit | Webhook Microsoft public sans limitation de débit (A-02) |
| Écart par rapport à la demande | CSP sans `unsafe-inline` pour les scripts : **impossible** avec cette architecture (A-01) |
| Reste à la charge de la production | HTTPS, proxy qui impose `X-Forwarded-For`, limiteur de débit partagé, sauvegardes, supervision |

## 2. En-têtes et CSP

Servis sur toutes les pages (`next.config.ts`), figés par `tests/unit/security-headers.test.ts` :

| En-tête | Valeur |
|---|---|
| `Content-Security-Policy` | `default-src 'self'` ; `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` en développement seulement) ; `style-src 'self' 'unsafe-inline'` ; `img-src 'self' data: blob:` ; `font-src 'self'` ; `connect-src 'self'` ; `frame-ancestors 'none'` ; `base-uri 'self'` ; `object-src 'none'` ; `form-action 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | caméra, micro et géolocalisation désactivés |
| `Strict-Transport-Security` | 2 ans, sous-domaines inclus — **production seulement** |
| `X-Powered-By` | supprimé |

**Pourquoi `'unsafe-inline'` pour les scripts (A-01).** La politique « stricte avec nonce » demandée a été essayée avant d'être écartée :

1. Selon la documentation de Next.js 16, un nonce impose que **toutes** les pages soient rendues dynamiquement et est **incompatible avec le rendu partiel** (`cacheComponents`), sur lequel repose l'application.
2. L'alternative documentée, l'intégrité de sous-ressources (SRI), protège les fichiers du build mais **pas les scripts en ligne** que Next injecte pour transmettre les données du rendu. Essai en production dans le navigateur : ces scripts sont bloqués et la page ne s'hydrate plus.

Conséquence : la CSP ne bloque pas un script injecté **en ligne**. Elle bloque en revanche tout script, connexion, cadre, objet ou formulaire **vers un autre hôte** (pas d'exfiltration ni de chargement distant), le détournement de `<base>` et l'intégration dans un cadre. La défense principale contre l'injection de script reste l'échappement automatique de React : **aucun** `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function` dans `src/`. Un durcissement futur passerait par un rendu dynamique complet avec nonce, au prix des performances et de l'architecture.

## 3. OWASP Top 10

| Risque | Constat | Preuve |
|---|---|---|
| A01 Contrôle d'accès défaillant | Chaque service reçoit l'utilisateur et applique `can(rôle, permission)` puis le périmètre (propriétaire, équipe, tous). Un objet hors périmètre répond « introuvable » (pas de fuite d'existence). Un doublon hors périmètre ne révèle pas l'identifiant du compte | Tests REC-09 : comptes, prospects, opportunités, administration ; `permissions.test.ts` |
| A02 Défaillances cryptographiques | Mots de passe hachés par Better Auth ; jetons Microsoft chiffrés AES-256-GCM, jamais renvoyés au navigateur ni écrits dans les journaux ; comparaisons de secrets en temps constant (`constantTimeEqual`) ; cookies `Secure` en production | `auth.ts`, `lib/crypto.ts`, `lib/cron.ts`, tests d'intégration des jetons |
| A03 Injection | Prisma paramétré partout ; 5 requêtes brutes, toutes en gabarit étiqueté (`leads/scope.ts`, `leads/kpi.ts`, `imports/migration.ts`, `api/health`). Formules CSV/XLSX neutralisées à l'export | grep `$queryRaw`/`$executeRaw` ; tests d'export |
| A04 Conception non sécurisée | Authentification centralisée (un seul chemin de connexion, `/sign-in/email` fermé en HTTP) ; création de comptes réservée à l'administrateur ; journal d'audit **en ajout seul** imposé par la base | `auth.ts`, `audit-append-only.test.ts` |
| A05 Mauvaise configuration | En-têtes ci-dessus ; `poweredByHeader` coupé ; tâches planifiées protégées par secret, **404 sans secret configuré** ; sonde `/api/health` sans détail interne | `cron.ts`, `health/route.ts` |
| A06 Composants vulnérables | Audit npm : voir synthèse ; versions épinglées par `package-lock.json` | `npm audit` |
| A07 Authentification | Mot de passe alphanumérique (10 caractères au minimum), changement forcé après réinitialisation, sessions révoquées au changement de mot de passe, au changement de rôle et à la désactivation (immédiate), session de 12 h. Limitation : 5 tentatives/min par IP + compte, 20/min par IP. **Pas d'authentification multifacteur** | `users-service.test.ts`, `login/actions.ts` |
| A08 Intégrité des données | Concurrence optimiste (`version`) ; transactions atomiques (conversion, import) ; état OAuth lié à la session, à usage unique et expirant ; webhook authentifié par `clientState` | tests d'intégration correspondants |
| A09 Journalisation | Journal d'audit par action (noms de champs, jamais les valeurs) ; journaux techniques structurés avec masquage des mots de passe, jetons, e-mails et cookies | `audit.ts`, `logger.ts` |
| A10 SSRF | Le seul appel sortant est vers Microsoft ; le curseur de synchronisation renvoyé par Graph est refusé s'il ne pointe pas vers `https://graph.microsoft.com`. Aucun appel vers une adresse saisie par un utilisateur | `graph.ts` |

## 4. Limitation de débit

| Point d'entrée | Plafond | Statut |
|---|---|---|
| Connexion | 5/min par IP + compte, 20/min par IP | en place |
| Mot de passe oublié | 5 / 15 min par IP | en place |
| Changement de mot de passe | 5 / 15 min par utilisateur | en place |
| Administration des identifiants | 20 / 15 min par administrateur | en place |
| Export du journal d'audit | 5/min par utilisateur | en place |
| Exports de rapports | 10/min par utilisateur | en place |
| Synchronisation manuelle | délai minimal entre deux demandes | en place |
| Authentification Better Auth | 100/min | en place |
| **Webhook Microsoft** | **600/min par IP** | **ajouté pendant l'audit (A-02)** |
| Recherche | listes authentifiées, paginées, filtrées par périmètre ; pas de limite dédiée | à surveiller |

**Limites** : le limiteur est **en mémoire**, donc par instance ; avec plusieurs instances, remplacer son stockage par PostgreSQL ou Redis (même signature). Il lit l'adresse IP dans `X-Forwarded-For` : en production, le proxy ou l'équilibreur **doit écraser** cet en-tête, sinon un client peut le falsifier pour contourner les plafonds par IP.

## 5. Fichiers

- Import : 5 Mo au maximum (contrôlé par le serveur, 6 Mo de corps de requête), extensions `.csv`/`.txt`/`.xlsx` uniquement, signature ZIP (`PK`) exigée pour `.xlsx`, rejet des octets nuls dans un CSV, nom de fichier nettoyé, 2 000 lignes au maximum.
- Les cellules d'origine sont conservées jusqu'à la validation du rapprochement, puis effacées ; effacement d'office après 90 jours.
- **Risque résiduel** : un classeur `.xlsx` de 5 Mo compressé peut se décompresser en un volume bien supérieur. La borne de 5 Mo s'applique au fichier déposé, pas au contenu décompressé. À éprouver avant la production (essai avec un classeur très compressible) et, si besoin, à borner côté lecture.
- Aucun antivirus : aucun fichier déposé n'est ouvert comme document ni servi à d'autres utilisateurs (lu puis effacé), ce qui limite l'exposition.

## 6. À la charge de la production (phase 9)

HTTPS et certificat ; proxy qui impose `X-Forwarded-For` ; secrets hors dépôt (`BETTER_AUTH_SECRET`, clé de chiffrement des jetons, `CRON_SECRET`) et leur rotation ; sauvegardes automatiques et test de restauration sur l'hébergement cible ; limiteur de débit partagé si plusieurs instances ; supervision et alertes (santé, tâches planifiées, échecs de connexion) ; authentification multifacteur ou SSO si le métier l'exige ; vérification de conformité avec la loi ivoirienne sur la protection des données (ARTCI) : durées de conservation, finalités, droits d'accès et de suppression.

## 7. Tests automatisés ajoutés

| Test | Rôle |
|---|---|
| `tests/unit/security-headers.test.ts` | CSP et en-têtes figés, en production et en développement ; une régression (hôte tiers, `unsafe-eval` en production, iframe autorisée) échoue |
| `tests/unit/recette-traceability.test.ts` | Chaque scénario REC renvoie à des tests existants |
| Tests existants | Accès horizontal et vertical (REC-09), audit en ajout seul, limiteur de débit, redirections sûres, politique de mot de passe |
