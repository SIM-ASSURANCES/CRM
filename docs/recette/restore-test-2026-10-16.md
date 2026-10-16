# Test de restauration — 2026-10-16

Scénario **REC-12** : restaurer une sauvegarde en recette. Résultat : **CONFORME**.

## Objectifs validés

- **RPO 24 h** : une sauvegarde complète par jour ; en cas de sinistre, au plus 24 h de saisies sont perdues.
- **RTO 4 h** : service rétabli en moins de 4 h après décision de restaurer.

## Mesures

| Étape | Durée |
|---|---|
| Sauvegarde (pg_dump, format custom) | 0.7 s |
| Restauration (pg_restore) | 1.2 s |
| Contrôles d'intégrité | 0.4 s |
| **Restauration + contrôles (à comparer au RTO)** | **1.5 s** sur 4 h autorisées — conforme |

Base source : `crm_recette`, 11.9 Mo ; sauvegarde : 0.3 Mo.
Projection indicative pour une base de 10 Go : environ 17 min de restauration (à confirmer sur l'hébergement de production).

## Contrôles

| Contrôle | Résultat | Détail |
|---|---|---|
| Mêmes tables | OK | 30 table(s) à la source, 30 restaurée(s) |
| Mêmes nombres de lignes, table par table | OK | 4694 ligne(s) au total |
| Mêmes empreintes d'identifiants (aucune ligne remplacée) | OK | toutes les tables concordent |
| Contraintes identiques et toutes valides | OK | c:54 f:45 n:219 p:30 |
| Déclencheurs identiques | OK | 2 déclencheur(s) |
| Migrations toutes appliquées après restauration | OK | 12 migration(s) |
| Journal d'audit toujours en ajout seul | OK | modification refusée par la base |
| Chaque utilisateur conserve son identifiant de connexion | OK | aucun utilisateur orphelin |

## Limites de ce test

- Il valide la **procédure** (sauvegarde puis restauration complète, contrôles) sur la base de recette, pas les sauvegardes de production, qui n'existent pas encore (phase 9).
- La durée mesurée exclut le temps d'approvisionnement d'un serveur neuf, de reconfiguration des secrets et de bascule du domaine : à ajouter dans le plan de reprise.
- Le test se fait sur la même machine que la base source ; un test sur l'hébergement cible est à refaire avant la mise en production.

