# Recette utilisateur — CRM SIM Assurances CI

Document de la phase 8. Il décrit l'environnement de recette, ce qui est vérifié automatiquement, ce que le métier doit exécuter à la main, le registre des anomalies et le modèle de **procès-verbal** à signer. La matrice « scénario → tests » est contrôlée par `tests/unit/recette-traceability.test.ts` : si un test cité disparaît, la suite échoue.

## 1. Environnement de recette

| Élément | Valeur |
|---|---|
| Base de données | `crm_recette` (PostgreSQL local), distincte de `crm` (développement) et `crm_test` (tests) |
| Données | 100 % fictives et reproductibles (graine fixe) : adresses en `@recette.example`, numéros `+225 0X 00 …` ; aucune donnée client réelle |
| Volume | 11 utilisateurs, 190 comptes (dont 14 groupes avec filiales), 380 contacts, 280 opportunités, 160 prospects, 662 activités, 170 tâches, objectifs mensuels |
| Serveur | `http://localhost:3200`, build de production (mêmes en-têtes de sécurité que la production) |
| Comptes d'essai | 1 administrateur, 1 direction, 1 audit, 2 managers, 6 commerciaux ; mots de passe générés, dans `.recette-credentials` (ignoré par git, jamais affiché) |

Commandes :

```bash
npm run recette:init       # crée la base si besoin, applique les migrations, charge le jeu de données
npm run recette:reset      # repart de zéro (supprime puis recrée la base de recette uniquement)
npm run build              # une fois, avant de démarrer
npm run recette:start      # démarre le serveur de recette sur le port 3200
npm run recette:restore-test   # REC-12 : sauvegarde, restauration, contrôles, rapport daté dans docs/recette/
```

Le jeu de données contient volontairement des cas à éprouver : des grands comptes (≥ 500 salariés) sans activité récente (REC-06), des prochaines actions et clôtures dépassées (relances), des contacts rattachés à deux comptes (REC-03), des commerciaux de deux équipes distinctes (REC-09).

## 2. Scénarios du cahier des charges (CDC §15)

Légende : **Auto** = couvert par des tests automatisés sur PostgreSQL ; **À la main** = à dérouler par le métier dans l'application ; **Non couvert** = hors du périmètre livré.

| ID | Scénario | Résultat attendu | Statut | Vérification automatisée | À exécuter à la main (recette 3200) |
|---|---|---|---|---|---|
| REC-01 | Créer un compte avec les champs obligatoires | Compte enregistré, propriétaire défini, visible selon les droits | Auto | `accounts-service` : création et périmètre | Se connecter en commercial, créer un compte ; vérifier qu'un autre commercial ne le voit pas |
| REC-02 | Créer un doublon de compte | Alerte avant validation | Auto | `accounts-service` : doublons ; `leads-service` : doublon de prospect | Recréer un compte existant (même raison sociale) : l'alerte doit apparaître avant l'enregistrement |
| REC-03 | Associer plusieurs contacts à un compte | Contacts visibles avec rôles et périmètres | Auto | `accounts-service` : contacts multi-comptes et rôles d'achat | Ouvrir un compte, ajouter deux contacts avec des rôles d'achat différents |
| REC-04 | Déplacer une opportunité dans le pipeline | Étape, probabilité et pondéré mis à jour et historisés | Auto | `opportunities-service` : changement d'étape ; `leads-service` | Faire glisser une opportunité d'une étape à l'autre ; consulter l'historique |
| REC-05 | Clôturer en perte sans motif | Clôture bloquée, message explicite | Auto | `opportunities-service` : perte ; `leads-schemas` : motif exigé | Tenter de clôturer en perte sans motif |
| REC-06 | Grand compte sans activité au-delà du seuil | Tâche / alerte créée selon le paramétrage | Auto | `automations-service` : seuil par segment, idempotence | Administration → Automatisations → exécuter ; vérifier les tâches des grands comptes inactifs |
| REC-07 | Synchroniser un e-mail correspondant à un contact | E-mail indexé une seule fois dans le bon historique | Auto | `integrations-service` : synchronisation des e-mails (faux fournisseur) | **À faire avec un vrai compte Microsoft 365** (jamais exercé contre Graph réel) |
| REC-08 | Créer / modifier un rendez-vous dans le calendrier | Synchronisation conforme, sans doublon | **Non couvert** | — | Non couvert : la synchronisation du calendrier n'a pas été livrée (décision de la phase 5 : e-mails seulement, en lecture seule) |
| REC-09 | Consulter un compte non autorisé | Accès refusé côté serveur | Auto | comptes, prospects, opportunités, administration : « introuvable » hors périmètre | Ouvrir par son adresse la fiche d'un compte d'un autre commercial : « introuvable » |
| REC-10 | Comparer KPI et export | Mêmes définitions et mêmes résultats | Auto | `reporting-service` : cohérence écran / export (CSV et XLSX relus) | Exporter les prévisions et comparer les totaux à l'écran |
| REC-11 | Déconnecter une intégration | Erreur visible, jeton protégé, reconnexion possible | Auto | `integrations-service` : déconnexion, révocation, vue d'ensemble | Connexions → déconnecter ; vérifier le message et la reconnexion guidée |
| REC-12 | Restaurer une sauvegarde en recette | Données restaurées selon le RPO/RTO validé | À la main (scripté) | Procédure scriptée : npm run recette:restore-test (rapport daté dans docs/recette/). Objectifs RPO 24 h, RTO 4 h | Lancer la commande et lire le rapport ; à refaire sur l'hébergement cible |

**Objectifs de reprise validés** : RPO 24 h (une sauvegarde complète par jour), RTO 4 h.

## 3. Parcours du classeur Excel

| Parcours | Règle vérifiée | Statut | Tests |
|---|---|---|---|
| Parcours 1 — Connexion | Login = e-mail ; mot de passe alphanumérique | Auto | `password-policy`, `users-service` (création et connexion) |
| Parcours 2 — Tableau de bord | 5 KPI, variation vs semaine passée, « non calculable » si base nulle | Auto | `kpi-math`, `leads-service` (KPI) |
| Parcours 3 — Saisie d'un prospect | Date ≤ aujourd'hui ; seuil de qualification | Auto | `leads-schemas`, `leads-rules` |
| Parcours 4 — Prospect qualifié | Produit et chiffre d'affaires exigés au-delà du seuil | Auto | `leads-views`, `leads-rules` |
| Parcours 5 — Proposition envoyée | Écran des offres, comptage hebdomadaire | Auto | `leads-service`, `leads-views` |
| Parcours 6 — Taux de transformation | Gagnées / clôturées | Auto | `leads-service`, `leads-views` |
| Parcours 7 — Valeur du pipeline | Valeur reconstituée à une date donnée | Auto | `leads-service` |

Les feuilles 6 et 7 du classeur sont inachevées (copier-coller) : leurs règles sont celles retenues en phase 1, à faire confirmer par le métier.

## 4. Registre des anomalies et écarts

| N° | Date | Origine | Description | Gravité | Statut | Suite donnée |
|---|---|---|---|---|---|---|
| A-01 | 16/10/2026 | Audit de sécurité | CSP « stricte avec nonce » demandée : **inapplicable** (la doc de Next l'indique incompatible avec le rendu partiel, et l'option SRI laisse bloqués les scripts en ligne : la page ne s'hydrate plus, essai en navigateur) | Moyenne | Écart accepté | `script-src 'self' 'unsafe-inline'` ; le reste de la politique est strict (voir `docs/RECETTE_SECURITE.md`) |
| A-02 | 16/10/2026 | Audit de sécurité | Webhook Microsoft public sans limitation de débit | Moyenne | Corrigé | 600 requêtes par minute et par adresse IP, réponse 429 au-delà |
| A-03 | 16/10/2026 | Audit des dépendances | 4 alertes hautes dans la chaîne `prisma` → `mysql2` (outillage Prisma) | Haute | Corrigé | `prisma` 7.10.1, `mysql2` 3.24.x ; `npm audit --omit=dev` : 0 vulnérabilité |
| A-04 | 16/10/2026 | Audit des dépendances | 5 alertes hautes dans `eslint-config-next` (`braces`, `micromatch`, `fast-glob`) : outillage de lint, jamais embarqué en production | Faible | Ouvert (accepté) | Le « correctif » proposé est un retour à la version 14 : refusé. À reprendre à la prochaine version d'`eslint-config-next` |
| A-05 | 16/10/2026 | Recette | REC-08 (calendrier) non couvert | À arbitrer | Ouvert | Décision métier : livrer la synchronisation du calendrier ou retirer REC-08 |
| A-06 | 16/10/2026 | Recette | Graphiques des rapports non vérifiés visuellement sous la nouvelle CSP (connexion non réalisée par l'assistant) | Faible | Ouvert | À vérifier à la main sur `/rapports/previsions` (serveur de recette) |
| A-07 | 16/10/2026 | Recette | REC-07 et intégration Microsoft jamais éprouvés contre Graph réel | Moyenne | Ouvert | Essai pilote avec une application Azure et un locataire (voir `docs/INTEGRATION_MICROSOFT.md`) |

Gravité : Haute = bloque la mise en production ; Moyenne = à traiter avant ou avec la mise en production ; Faible = peut suivre.

## 5. Ce que cette recette ne prouve pas

- Les tests automatisés valident les règles de gestion sur PostgreSQL, **pas** le ressenti d'un utilisateur : la colonne « À la main » existe pour cela.
- La restauration est éprouvée sur la machine de recette ; la durée sur l'hébergement cible reste à mesurer (phase 9).
- Les alias de secteurs, les seuils de relance et la définition du revenu signé sont des valeurs de départ à faire valider par le métier.
- Aucun test d'accessibilité automatisé n'a été exécuté (objectif WCAG 2.2 AA du plan, section 8).

## 6. Procès-verbal de recette

> À compléter et signer par les deux parties. Ce modèle est laissé **vierge** : seules les personnes habilitées peuvent l'accepter.

**Procès-verbal de recette — CRM SIM Assurances CI**

Version de l'application recettée : ………………  Date : ………………  Environnement : crm_recette (port 3200)

| Scénario | Résultat (conforme / réserve / non conforme) | Observations |
|---|---|---|
| REC-01 … REC-12 | | |
| Parcours Excel 1 … 7 | | |
| Restauration (REC-12) : durée mesurée ………… (objectif RTO 4 h) | | |

Réserves (référence du registre d'anomalies) : ………………………………………………………

Décision : ☐ Recette acceptée   ☐ Acceptée avec réserves   ☐ Refusée

| | Nom | Fonction | Date | Signature |
|---|---|---|---|---|
| **Représentant métier** | | | | |
| **Responsable technique** | | | | |
