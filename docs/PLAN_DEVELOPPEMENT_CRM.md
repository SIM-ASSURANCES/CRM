# Plan de développement — CRM B2B SIM Assurances CI

> Sources analysées (dossier `input/`) :
> 1. `CAHIER_DES_CHARGES_CRM_B2B_NEXTJS_POSTGRESQL_COMPLET (2).docx` — cadrage fonctionnel et technique (21 sections + annexe technique A.1 à A.16)
> 2. `PARCOURS CRM.xlsx` — 7 feuilles : parcours utilisateur, tableau de bord, reporting prospect, prospect qualifié, proposition envoyée, taux de transformation, valeur du pipeline
> 3. `CHARTE GRAPHIQUE SIM ASSURANCE CI (1) (1).pdf` — 26 pages : logotype, typographies, couleurs, papeterie, éditions, réseaux sociaux
>
> Date du plan : 13/10/2026 — Statut : **brouillon à valider**

---

## 0. Synthèse et lecture croisée des trois sources

### 0.1 Ce que dit chaque source

| Source | Apport principal | Niveau de détail |
|---|---|---|
| Cahier des charges | Vision complète : comptes, hiérarchie groupe/filiale, contacts multi-rôles, opportunités, activités, automatisations, intégrations Google/Microsoft, reporting, sécurité, stack Next.js + PostgreSQL | Large, non priorisé (le MVP est suggéré en section 20) |
| Parcours Excel | Parcours **concrets** du commercial : connexion, tableau de bord à 5 KPI, saisie d'un prospect, bascule automatique entre 5 écrans de reporting selon le « process de vente » (%) | Précis mais **réduit** et partiellement inachevé (feuilles 6 et 7 en copier-coller) |
| Charte graphique | Identité visuelle SIM Assurances (Société Ivoirienne de Micro-Assurances) : logo, couleurs, typographies | Charte de marque, pas de charte UI |

### 0.2 Décision structurante proposée

Le périmètre est livré en **deux niveaux** :

- **MVP-A « Parcours Excel »** : exactement ce que décrit `PARCOURS CRM.xlsx` (login, tableau de bord, 5 écrans de reporting, saisie/modification de prospect). C'est le premier jalon démontrable.
- **MVP-B « Socle CRM »** : le MVP recommandé en section 20 du cahier (comptes, hiérarchie, contacts multi-rôles, opportunités, activités, tâches, alertes, audit, import).
- **Lots ultérieurs** : intégrations Google/Microsoft, forecast avancé, exports, modules assurance (contrats, sinistres).

Le modèle de données est conçu **dès le départ** pour le périmètre complet du cahier. Seul le périmètre d'écrans est phasé. Cela évite une refonte quand on passera du prospect à l'opportunité.

### 0.3 Incohérences et zones d'ombre détectées (à arbitrer — voir section 12)

| # | Constat | Source | Impact |
|---|---|---|---|
| I1 | **Seuil de qualification** : l'Excel bascule en « prospect qualifié » quand le process > 40 %. Le cahier place « Qualification » à 20 % (critère : besoin, interlocuteur, potentiel évalués). | Excel f.3 vs CDC 5.2 | Règle métier centrale |
| I2 | **Seuil « proposition envoyée »** : Excel = > 60 %. Cahier = « Présentation de l'offre » à 60 % (≥ 60 %). Strict ou inclusif ? Dans l'exemple Excel, la valeur saisie est 0,6 et déclenche bien le transfert, ce qui suggère « ≥ ». | Excel f.4 vs CDC 5.2 | Comptage des propositions |
| I3 | **Formule du delta hebdomadaire** : l'Excel écrit « (total semaine − total semaine précédente) / total **semaine** ». La formule standard divise par la semaine **précédente**. Avec l'exemple 25 / +15 %, la formule Excel donne une semaine précédente ≈ 21,25, ce qui n'est pas entier : la formule est probablement erronée. | Excel f.2 H6 | Fiabilité des KPI |
| I4 | **Valeur du pipeline** : l'Excel (f.7) n'affiche que les offres à 80 % et 90 %. Le cahier (5.3) définit le pipeline comme **toutes** les opportunités ouvertes, pondérées. | Excel f.7 vs CDC 5.3 | Définition du KPI phare |
| I5 | **Transformation** : l'Excel fait passer à 100 % depuis « proposition envoyée » **et** depuis « valeur du pipeline ». Le cahier exige « contrat signé + premier paiement validé » pour « Gagné ». | Excel f.5/f.7 vs CDC 14 | Règle de clôture |
| I6 | **RDV obtenus** : « calculé à chaque fois qu'un prospect change d'onglet ou qu'un nouveau prospect est ajouté » — définition floue, source de sur-comptage. Le cahier demande une définition métier à valider. | Excel f.2 D14 vs CDC 8.1 | Fiabilité du KPI |
| I7 | **Modèle de données** : l'Excel ne parle que de « prospect » (entreprise + un contact + un CA). Le cahier sépare compte, contact, prospect, opportunité. | Excel vs CDC 12 | Modèle de conversion |
| I8 | **Authentification** : l'Excel prévoit login e-mail + mot de passe alphanumérique ; le cahier privilégie SSO/MFA. | Excel f.1 vs CDC 2.1 / A.9 | Choix du fournisseur d'auth |
| I9 | **Positionnement client** : le cahier cible « grands comptes, assurances, courtage corporate » ; la charte et les produits (SECUR/RELAX Moto, Maison, Auto, Santé) relèvent de la **micro-assurance** grand public. | CDC vs Charte | Vocabulaire, KPI, segmentation |
| I10 | **Couleurs sémantiques de la charte** : « Dommage » (rouge), « Santé » (jaune), « Accident » (orange) sont affichées avec le **même code CMYK/RGB** que le bleu clair (copier-coller manifeste dans le PDF). Les valeurs réelles sont à échantillonner ou à obtenir. | Charte p.14 | Palette UI |
| I11 | Devise **FCFA** (XOF) dans l'Excel ; formats téléphone ivoiriens (07…), domaine `.ci`. Le cahier laisse le pays ouvert. | Excel vs CDC 19 | Localisation |
| I12 | **Champ obligatoire excessif** : tous les champs du prospect sont « obligatoires », y compris téléphone **et** e-mail. Peut bloquer la saisie terrain. | Excel f.3 | Ergonomie |
| I13 | **Date d'insertion** « ne peut être postérieure à la date du jour » mais exemple saisi sous forme de nombre Excel (46303). | Excel f.3 | Validation, formats |

---

## 1. Périmètre et objectifs

### 1.1 Objectifs métier (CDC 1.1)
Centraliser la relation client ; réduire la double saisie ; standardiser étapes, qualification et motifs de perte ; prioriser par tâches/alertes ; calculer un pipeline pondéré fiable ; garantir traçabilité, confidentialité et contrôle d'accès.

### 1.2 Indicateurs de succès (CDC 1.2) — cibles à fixer en atelier
Adoption, complétude des comptes, activités journalisées, délai de relance, taux de conversion, précision du forecast.

### 1.3 Périmètre par lot

| Lot | Contenu | Source |
|---|---|---|
| **MVP-A** | Login, tableau de bord (5 KPI + 2 graphiques), saisie/modification de prospect, 5 écrans de reporting avec bascule automatique par étape, déconnexion | Excel |
| **MVP-B** | Rôles et périmètres, comptes + hiérarchie, contacts multi-rôles, prospects → conversion, opportunités + Kanban, activités, tâches, alertes d'inactivité, audit, import initial | CDC 20 |
| **Lot 2** | Intégration e-mail/calendrier (Google **ou** Microsoft), Meet/Teams, centre de notifications avancé | CDC 7 |
| **Lot 3** | Forecast mensuel/trimestriel/annuel, objectifs, exports CSV/XLSX, motifs de perte croisés | CDC 8.2–8.3, 5.4 |
| **Lot 4** | Second fournisseur de suite bureautique, vue synthétique contrats/sinistres | CDC 7, 9 |
| **Hors périmètre** | Gestion complète des polices/primes/sinistres, e-signature, facturation, portail client, app native, ERP, scoring IA, multi-entité avancée | CDC 18 |

---

## 2. Stack technique (CDC annexe A)

| Couche | Choix | Statut |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Ferme (CDC A.16) |
| Base de données | **PostgreSQL** (service managé, accès privé) | Ferme |
| ORM / migrations | Prisma | À valider |
| Validation | Zod | À valider |
| Authentification | **Better Auth** (retenu en phase 2) : sessions en base, plugin admin ; SSO Google/Microsoft en option | Retenu ; SSO à valider (I8) |
| UI | Tailwind CSS + composants accessibles (shadcn/ui, Radix) | Proposé |
| Kanban | dnd-kit | Proposé |
| Graphiques | Recharts (camembert, histogramme) | Proposé |
| Jobs asynchrones | **pg-boss** (file de tâches sur PostgreSQL, évite Redis) ; worker séparé | À valider |
| Fichiers | Stockage objet privé (S3 compatible), uniquement si documents activés | Optionnel |
| Tests | Vitest (unitaires), tests d'intégration sur PostgreSQL réel, Playwright (E2E) | Proposé |
| API doc | OpenAPI généré depuis les schémas Zod | Proposé |
| CI/CD | GitHub Actions : lint, `tsc`, tests, build avant fusion | Proposé |
| Observabilité | Logs structurés (pino), Sentry, health checks | Proposé |

### 2.1 Architecture logique (CDC A.2–A.4)
Navigateur → Pages Next.js (Server Components par défaut) → Server Actions / Route Handlers → **services métier** → Prisma → PostgreSQL. Les adaptateurs d'intégration et les jobs sont isolés côté serveur.

Règles non négociables :
- Les composants UI **n'appellent jamais Prisma**.
- Chaque lecture/écriture sensible passe par : validation Zod → identité → permission → service → audit.
- DTO explicites en sortie (jamais un modèle Prisma brut).
- Montant pondéré **calculé côté serveur** uniquement.
- Codes d'erreur centralisés : 400, 401, 403, 404, 409, 429, 500.

### 2.2 Structure du dépôt
Reprise de l'arborescence du CDC A.3 : `src/app/(auth)`, `src/app/(crm)`, `src/app/api/v1`, `src/components`, `src/features/<domaine>/{schemas,service,repository,permissions}.ts`, `src/lib`, `src/server/{jobs,integrations,notifications}`, `prisma/`, `tests/{unit,integration,e2e}`.

---

## 3. Identité visuelle et design system (charte SIM Assurances)

### 3.1 Éléments extraits de la charte

| Élément | Valeur |
|---|---|
| Logo | « SIM ASSURANCES — Société Ivoirienne de Micro-Assurances » ; déclinaisons horizontale et verticale (SIM) ; versions blanc sur fond noir / bleu clair / bleu foncé |
| Bleu foncé (corporate) | Pantone 004B9C — CMJN 100/75/6/1 — RVB 0/75/156 → **`#004B9C`** |
| Bleu clair (corporate) | Pantone 51AEE2 — CMJN 62/16/0/0 — RVB 81/174/226 → **`#51AEE2`** |
| Dégradé de couverture | Bleu nuit (≈ `#1B2F7E`, à échantillonner) vers cyan (≈ `#1AAFD9`), forme en courbe + losange translucide |
| Couleurs sémantiques | Rouge = Dommage, Jaune = Santé, Orange = Accident (**valeurs à confirmer, voir I10**) |
| Typographies | **Montserrat** : communication institutionnelle et titres ; **Arial** : bureautique par défaut ; **Calibri** : e-mails |
| Zone de protection | Hauteur du « S » du logo autour du logo ; taille minimale 40 mm (≈ 150 px en usage écran, à définir) |
| Interdits | Logo couleur sur fond visuel, fond perturbant, déformation, rotation, taille sous le minimum, non-respect de l'espace protégé |

### 3.2 Traduction en design system UI
- **Tokens** : `--brand-900` (bleu nuit), `--brand-700` `#004B9C`, `--brand-400` `#51AEE2`, neutres, états succès/alerte/erreur.
- **Sémantique produit** : rouge/jaune/orange réservés aux **familles de produits** (badges), pas aux alertes système, pour éviter la confusion.
- **Typographie** : Montserrat pour titres/navigation/chiffres clés ; Arial (ou pile système) pour tableaux et formulaires denses.
- **Éléments de marque** : en-tête avec dégradé charte, motif losange en filigrane sur la page de connexion, logo avec espace protégé respecté.
- **Accessibilité** : vérifier le contraste du bleu clair `#51AEE2` sur blanc (insuffisant pour du texte courant : à réserver aux fonds, pastilles et graphiques) ; navigation clavier ; libellés explicites (CDC 10).
- **Thème sombre** : non prévu par la charte → hors périmètre initial.

### 3.3 Référence UI : back-office SIM Assurances existant (capture fournie)

Le CRM doit reprendre le **même gabarit d'application** que les tableaux de bord déjà en service, pour que les utilisateurs ne changent pas de repères.

| Zone | Constat sur la capture | Implémentation prévue |
|---|---|---|
| **Coin supérieur gauche** | Bloc logo sur fond bleu `#004B9C`, logo blanc, aligné sur la largeur de la barre latérale | Composant `BrandBlock` ; version réduite (pictogramme seul) quand la barre est repliée |
| **Barre latérale** | Fond blanc, bordure droite fine ; carte bleue « sélecteur d'espace » en tête (ici « Assurances Accidents et Dommages », chevron) ; groupes en capitales grises (GESTION, SOUSCRIPTIONS, PILOTAGE) ; entrée active = pastille bleue pleine, texte blanc, coins arrondis ; entrées inactives = texte gris foncé ; défilement vertical interne | `Sidebar` pilotée par une config de navigation filtrée par rôle ; groupes : **Pilotage** (tableau de bord, reportings), **Ventes** (prospects, comptes, contacts, opportunités), **Suivi** (tâches, notifications), **Administration** |
| **Icônes** | Icônes filaires (trait fin, style Lucide), 20 px, alignées à gauche du libellé | `lucide-react`, même taille et même trait dans la barre latérale, l'en-tête et les boutons |
| **Bas de barre** | Bouton « Réduire » (chevrons `«`) puis « Déconnexion » en **rouge** avec icône de sortie, séparés du menu | Collapse persistant (préférence utilisateur) ; déconnexion avec invalidation de session côté serveur |
| **En-tête** | Blanc, bordure basse fine ; à droite : cloche avec **pastille rouge** de compteur, avatar rond bleu avec initiales, nom en gras, e-mail en gris | `Header` avec centre de notifications (compteur de non-lus) et menu utilisateur |
**Périmètre de cette référence** : on reprend **uniquement** ces cinq éléments de style : la **barre latérale**, les **icônes**, l'**en-tête avec cloche et avatar**, le bouton **« Réduire »** et le bouton **« Déconnexion » en rouge**. Tout le reste de la capture (cartes, filtres de période, cartes KPI, format des montants, contenu de la page) n'est **pas** repris : le contenu des pages suit les parcours de l'Excel et la charte SIM Assurances. Le CRM est une application indépendante : aucune donnée, aucun menu ni aucune fonctionnalité du back-office existant n'est repris.

**Points de vigilance**
- Le bloc bleu en tête de barre (sélecteur d'espace) est repris comme élément de style ; son contenu sera propre au CRM (par exemple « CRM Commercial »).
- La barre latérale tronque les libellés longs : prévoir des libellés courts et une infobulle.
- Contraste : le gris des libellés secondaires et des capitales de groupe doit respecter WCAG AA.

### 3.4 Référence UI : page de connexion du CRM (capture fournie)

La page de connexion est **le design cible du CRM** (pas seulement une inspiration) ; elle reprend la logique de l'Excel (login = e-mail, mot de passe, tous deux obligatoires).

| Élément | Constat sur la capture | Implémentation prévue |
|---|---|---|
| **Fond** | Blanc avec **grand losange/triangle en filigrane** gris très pâle (motif du logo, débordant à gauche) | Fond SVG ou CSS, `aria-hidden`, sans impact sur le contraste ; masqué ou réduit sur mobile |
| **Bande basse** | Fine barre en **dégradé bleu clair → bleu foncé** en bas de page, pleine largeur | Élément fixe de 4 px ; reprend le dégradé de la charte |
| **Carte** | Centrée verticalement et horizontalement, ≈ 450 px de large, **coins très arrondis**, bordure fine, ombre douce bleutée | Composant `AuthCard`, largeur max 28 rem |
| **Logo** | Logo horizontal SIM Assurances (couleur) en haut à gauche de la carte, avec espace protégé | `BrandLogo` en SVG, version couleur sur fond blanc (conforme aux règles d'usage de la charte) |
| **Titre** | « **Connexion** » en gras, puis sous-titre gris. **Décision : « CRM Commercial »** (remplace « Portail interne SIM Assurances ») | Montserrat ; sous-titre en gris AA |
| **Champs** | « Email * » et « Mot de passe * », **astérisque rouge** pour l'obligatoire ; champs hauts (≈ 38 px), bordure fine, coins arrondis | Composants `TextField` accessibles (label lié, `aria-required`, messages d'erreur sous le champ) |
| **Options** | Case « Se souvenir de moi » à gauche ; lien « Mot de passe oublié ? » en bleu à droite | Session prolongée **sans** stocker le mot de passe ; le lien « Mot de passe oublié ? » ouvre une page d'information et de demande de réinitialisation **traitée par l'administrateur** (voir ci-dessous) |
| **Bouton** | « Se connecter » : **bleu foncé `#004B9C`**, texte blanc gras, pleine largeur, coins arrondis | Bouton principal du design system ; état chargement et désactivé |

**À prévoir autour de cette page** (absent de la capture, exigé par le cahier des charges et la sécurité) :
- Œil d'affichage du mot de passe, avec libellé accessible.
- Messages d'erreur génériques (« Identifiants incorrects ») qui ne révèlent pas si l'e-mail existe.
- Limitation de débit et verrouillage progressif après échecs répétés ; journalisation des connexions.
- **Réinitialisation du mot de passe par l'administrateur (décision validée)** :
  - Le lien « Mot de passe oublié ? » affiche un message : « Contactez votre administrateur CRM pour réinitialiser votre mot de passe », avec un formulaire de demande optionnel (e-mail uniquement) qui crée une notification pour les administrateurs. Réponse **identique** que l'e-mail existe ou non.
  - Dans l'administration, l'administrateur dispose d'une action « Réinitialiser le mot de passe » sur la fiche utilisateur : génération d'un **mot de passe temporaire aléatoire** (affiché une seule fois, jamais stocké en clair, jamais journalisé), transmis à l'utilisateur hors de l'application.
  - À la première connexion suivante : **changement de mot de passe obligatoire** (indicateur `must_change_password`), invalidation de toutes les sessions existantes de l'utilisateur.
  - Action réservée au rôle Administrateur CRM, **tracée dans le journal d'audit** (qui, pour qui, quand), avec limitation de débit et interdiction de réinitialiser son propre compte par ce biais.
  - Page « Changer mon mot de passe » dans le menu utilisateur de l'en-tête.
  - Conséquence : **aucun service d'envoi d'e-mails n'est requis pour l'authentification** au lancement ; il ne sera nécessaire que pour les notifications par e-mail, si elles sont retenues (CDC 6.3).
- Politique de mot de passe (l'Excel impose « lettres et chiffres » ; on recommande une longueur minimale en plus).
- Option SSO Google/Microsoft si retenue (question 14).
- Contrôle du contraste du lien « Mot de passe oublié ? » et du texte gris secondaire.

### 3.5 Livrables design
Jeu de tokens, bibliothèque de composants (bouton, champ, tableau, badge d'étape, carte KPI, Kanban, modale), maquettes responsive (desktop, tablette, mobile), kit logo (SVG blanc / couleur).
**Point d'attention** : le logo doit être fourni en **vectoriel** (SVG/AI) ; le PDF est probablement raster.

---

## 4. Modèle de données

### 4.1 Tables socle (CDC A.5) + ajouts issus de l'Excel

| Domaine | Tables |
|---|---|
| Identité et accès | `users`, `roles`, `teams`, `sessions`, `audit_logs` |
| Référentiel client | `accounts` (parent_account_id), `contacts`, `account_contacts`, `contact_roles` |
| Vente | `leads`, `opportunities`, `pipeline_stages`, `opportunity_stage_history`, `opportunity_contacts`, `loss_reasons`, `products` |
| Suivi | `activities`, `tasks`, `notifications`, `automation_rules`, `automation_runs` |
| Intégrations | `integration_connections`, `sync_events` |
| Documents | `documents` (optionnel) |
| Paramétrage | `settings`, `kpi_definitions`, `sales_targets` |

### 4.2 Adaptation de l'Excel au modèle
- **Prospect (`leads`)** reprend les champs de l'Excel : raison sociale, secteur, nom, prénom, téléphone, e-mail, fonction, date d'insertion, process de vente (%) + étape, produit proposé, chiffre d'affaires attendu (FCFA), source, propriétaire.
- **Le « process de vente » est dérivé de l'étape** (`pipeline_stages.default_probability`). On stocke l'étape ; la probabilité est calculée, avec dérogation explicite et historisée (CDC A.7).
- **Conversion** (`POST /leads/{id}/convert`) : transaction atomique qui crée compte + contact + opportunité sans perte d'historique.
- **Historique** : `opportunity_stage_history` conserve étape, montant, probabilité, date de clôture, auteur, horodatage (indispensable pour les KPI « vs semaine dernière » et le forecast).

### 4.3 Règles de schéma (CDC A.5)
UUID, `timestamptz`, `NUMERIC(18,2)` pour les montants (FCFA sans décimale, mais conserver la généricité), devise stockée avec le montant, clés étrangères, contraintes `CHECK` (probabilité 0–100, date d'insertion ≤ aujourd'hui), index sur propriétaire/statut/étape/date, `audit_logs` en append-only, suppression logique, version/`updated_at` pour la concurrence optimiste, détection de cycles sur la hiérarchie des comptes.

### 4.4 Étapes par défaut (configurables)

| Étape | Prob. | Vue Excel correspondante |
|---|---|---|
| Identification / prospection | 10 % | Reporting prospect |
| Qualification | 20 % | Reporting prospect (cahier) ou qualifié (selon I1) |
| Découverte approfondie | 40 % | Seuil Excel « > 40 % → prospect qualifié » |
| Présentation de l'offre | 60 % | Proposition envoyée |
| Négociation / finalisation | 80 % | Valeur du pipeline |
| Closing / signature | 90 % | Valeur du pipeline |
| Gagné | 100 % | Taux de transformation |
| Perdu | 0 % | Motif obligatoire |

Les seuils de bascule entre vues sont stockés dans `settings` et non codés en dur.

---

## 5. Règles métier à implémenter

1. **Prospect** : cycle Nouveau → À contacter → Contacté → Qualifié / Non qualifié (CDC 4.1). Motif obligatoire si « Non qualifié ».
2. **Doublons** : détection sur raison sociale normalisée, identifiant légal, domaine e-mail, téléphone, avec alerte **avant** validation (REC-02) ; fusion réservée aux profils autorisés, tracée.
3. **Qualification** : passer le seuil ouvre une fenêtre qui exige **produit proposé** et **chiffre d'affaires attendu** (Excel f.3, étape 6).
4. **Bascule automatique** des vues selon l'étape (section 4.4), **immédiate** après validation.
5. **Pipeline pondéré** = montant × probabilité de l'étape ; uniquement opportunités **ouvertes** ; brut / pondéré / signé séparés.
6. **Opportunité ouverte** : compte, propriétaire, étape, date de clôture prévisionnelle et prochaine action obligatoires (CDC 14).
7. **Gagné** : critères métier (contrat signé + premier paiement) — case de validation obligatoire (I5).
8. **Perdu** : motif obligatoire ; commentaire exigé si « autre » (REC-05).
9. **Date d'insertion** ≤ date du jour (Excel f.3).
10. **Historisation** de tout changement de montant, probabilité, étape, date de clôture, propriétaire.
11. **Concurrence** : si deux utilisateurs modifient la même fiche, renvoyer 409 plutôt qu'écraser.
12. **Suppression** : logique par défaut ; définitive soumise à autorisation.

---

## 6. Plan de développement par phases

Durées indicatives pour une équipe de 3 à 4 personnes (1 lead full-stack, 1–2 développeurs, 1 UX/UI à temps partiel, 1 QA partagé). **Hypothèses à confirmer** avec le budget et la date cible (CDC 19).

### Phase 0 — Cadrage et arbitrages (≈ 2 semaines)
- [ ] Atelier de cadrage avec sponsor, responsable commercial, DSI, sécurité.
- [ ] Trancher les questions de la section 12 (seuils, KPI, périmètre, hébergement, auth, SSO).
- [ ] Rédiger le dictionnaire des KPI (définitions identiques écrans/exports).
- [ ] Fixer cibles chiffrées : performance, disponibilité, RPO/RTO, rétention.
- [ ] Obtenir : logo vectoriel, valeurs exactes des couleurs sémantiques, jeux de données existants.
- [ ] Valider le périmètre MVP-A / MVP-B et le planning.
- **Sortie** : spécifications validées (signature des 4 parties prenantes, CDC 21).

### Phase 1 — Conception (≈ 3 semaines)
- [ ] Cartographie des parcours (reprise des 7 feuilles Excel + parcours CDC 13.1 à 13.3).
- [ ] Wireframes puis maquettes haute fidélité (connexion, tableau de bord, 5 reportings, fiche prospect, modale de qualification, Kanban, fiche compte 360°).
- [ ] Design system selon la charte (section 3).
- [ ] Schéma Prisma complet, diagramme entité-relation, stratégie d'indexation.
- [ ] Matrice de permissions (rôle × action × périmètre).
- [ ] Stratégie sécurité (menaces, chiffrement, secrets, rate limiting).
- [ ] Contrats API (OpenAPI v1).
- **Sortie** : revue métier/technique approuvée.

### Phase 2 — Socle technique (≈ 2 semaines)
- [ ] Initialisation Next.js + TypeScript strict, ESLint, Prettier, Husky.
- [ ] Environnements local / dev / recette / production, secrets séparés.
- [ ] PostgreSQL managé, première migration Prisma, jeux de données de seed.
- [ ] CI/CD : lint, `tsc`, tests unitaires et d'intégration, build, déploiement automatisé en dev.
- [ ] Modules transverses : `env.ts` (validation des variables), `logger`, `errors`, `audit`, `rate-limit`.
- [ ] Authentification (e-mail + mot de passe, hachage robuste, sessions Secure/HttpOnly/SameSite), page de connexion conforme à la capture de référence (section 3.4), avec « Mot de passe oublié » (page d'information + demande à l'administrateur) et « Se souvenir de moi ». Sous-titre : « CRM Commercial ». Champ `must_change_password` et page de changement de mot de passe obligatoire.
- [ ] Moteur de permissions côté serveur (`permissions.ts` par domaine).
- [ ] Layout CRM : navigation, en-tête, gestion d'erreurs, états de chargement.
- **Sortie** : un utilisateur se connecte, voit un tableau de bord vide, tout est tracé et déployé.

### Phase 3 — MVP-A : parcours Excel (≈ 4 semaines)

**Sprint 3.1 — Prospects**
- [ ] Liste des prospects (pagination serveur, tri, filtres, recherche).
- [ ] Formulaire « Enregistrer un nouveau prospect » (champs Excel, validation Zod, contrôle de la date, détection de doublons).
- [ ] Modification d'un prospect, historique des changements d'étape.
- [ ] Sélecteur d'étape (10/20/40/60/80/90/100 %).

**Sprint 3.2 — Qualification et bascule automatique**
- [ ] Modale « produit proposé + chiffre d'affaires » au franchissement du seuil.
- [ ] Moteur de règles de bascule piloté par `settings`.
- [ ] Écrans : *Reporting prospect*, *Prospects qualifiés*, *Propositions envoyées*, *Valeur du pipeline*, *Taux de transformation* (vues filtrées sur un seul enregistrement).
- [ ] Transition vers 100 % avec contrôle des critères de gain.

**Sprint 3.3 — Tableau de bord**
- [ ] Cartes KPI : nouveaux prospects, RDV obtenus, propositions envoyées, taux de transformation, valeur du pipeline (FCFA).
- [ ] Delta vs semaine précédente (absolu et %), « non calculable » si base nulle.
- [ ] Camembert du taux de transformation ; histogramme du pipeline sur les 4 dernières semaines.
- [ ] Déconnexion et expiration de session.

**Sprint 3.4 — Stabilisation MVP-A**
- [ ] Tests E2E des 7 parcours Excel.
- [ ] Revue de sécurité, accessibilité, responsive.
- [ ] **Démo et recette MVP-A**.

### Phase 4 — MVP-B : socle CRM (≈ 8 semaines)

**Sprint 4.1 — Rôles et équipes**
- [ ] Administration des utilisateurs, équipes, rôles (5 rôles CDC 2), **création de compte par l'administrateur et réinitialisation de mot de passe** (mot de passe temporaire, changement forcé, invalidation des sessions, audit).
- [ ] File des demandes de réinitialisation reçues depuis la page de connexion (notification aux administrateurs).
- [ ] Périmètres (propriétaire / équipe / direction), désactivation immédiate d'un compte.
- [ ] Tests d'accès horizontal et vertical (REC-09).

**Sprint 4.2 — Comptes et contacts**
- [ ] Fiche entreprise complète (CDC 3.1), hiérarchie parent/filiale avec prévention des cycles.
- [ ] Vue groupe agrégée en respectant les droits de chaque compte.
- [ ] Contacts multi-comptes, matrice des rôles d'achat par opportunité/famille de produit.
- [ ] Détection et fusion de doublons avec audit.

**Sprint 4.3 — Opportunités**
- [ ] Conversion prospect → compte + contact + opportunité (transaction atomique).
- [ ] Fiche opportunité (CDC 5.1), Kanban par étape, changement d'étape avec critères de sortie.
- [ ] Clôture gagnée/perdue, motifs de perte, historique des étapes.
- [ ] Calcul pondéré serveur ; distinction brut / pondéré / signé.

**Sprint 4.4 — Activités et tâches**
- [ ] Types d'activités (appel, e-mail, RDV, visio, note, proposition…), fil unifié filtrable, origine visible.
- [ ] Tâches, prochaine action obligatoire, échéances.

**Sprint 4.5 — Automatisations et notifications**
- [ ] Jobs : inactivité 15 jours (seuil par segment), opportunité sans prochaine action, date de clôture dépassée, RDV imminent, tâche en retard.
- [ ] Idempotence (une tâche par règle et par période), activation/désactivation, journal d'exécution.
- [ ] Centre de notifications (lu/non lu, lien direct, regroupement anti-spam).

**Sprint 4.6 — Audit et import**
- [ ] Journal d'audit consultable (connexions, changements de propriétaire, suppressions, exports, permissions).
- [ ] Import initial CSV/XLSX : mapping, déduplication, rapport de qualité (rejets, doublons, champs manquants).

**Sprint 4.7 — Stabilisation MVP-B**
- [ ] Tests unitaires (forecast, transitions, permissions), intégration DB, E2E.
- [ ] Tests de performance sur jeu de données réaliste.
- **Sortie** : tests fonctionnels réussis (CDC 16.1).

### Phase 5 — Intégrations (≈ 6 semaines, après choix du fournisseur prioritaire)
- [x] OAuth 2.0 (scopes minimaux), consentement, stockage chiffré des jetons. *(Microsoft 365, lot e-mails ; voir journal 5.1)*
- [x] Synchronisation e-mail : indexation, déduplication par identifiant technique, exclusion de domaines/messages personnels. *(fils de conversation : reporté)*
- [ ] Synchronisation calendrier bidirectionnelle, règle de conflit (retenue : le calendrier de l'utilisateur fait foi), création de liens Meet ou Teams. *(lot suivant)*
- [x] Webhooks authentifiés et idempotents, réponse rapide puis traitement différé, resynchronisation après perte de curseur.
- [x] État de connexion visible, reconnexion guidée, journal `sync_events` (REC-07, 08, 11).
- [ ] Activation progressive avec un groupe pilote. *(procédure rédigée dans `docs/INTEGRATION_MICROSOFT.md` ; à mener avec une vraie application Azure)*

### Phase 6 — Reporting avancé (≈ 4 semaines)
- [x] Forecast mensuel / trimestriel / annuel, segmentation produit, équipe, commercial, secteur, groupe.
- [x] Objectifs et comparaison forecast vs objectif.
- [x] Croisement motifs de perte × produit × secteur × commercial (+ taille du compte et équipe).
- [x] Exports CSV/XLSX journalisés, limités par rôle ; cohérence KPI écran / export (REC-10). *(immédiats et plafonnés, pas de job asynchrone : décision du 15/10/2026 ; voir journal)*

### Phase 7 — Migration de données (≈ 3 semaines, en parallèle de la phase 5)
- [x] Inventaire des sources, volumes, qualité. *(profil de la source calculé au dépôt : volumes, doublons, taux de remplissage, types, valeurs fréquentes)*
- [x] Mapping source → cible, règles de normalisation (téléphones ivoiriens, secteurs, produits). *(comptes, contacts et prospects ; format unique +225 ; correspondances de valeurs par lot ; voir journal)*
- [x] Import pilote, rapport d'anomalies, conservation de la source jusqu'à validation.
- **Sortie** : rapprochement accepté. *(rapprochement fichier ↔ base, validation explicite par l'administrateur, puis effacement de la source)*

### Phase 8 — Recette utilisateur (≈ 3 semaines)
- [x] Environnement dédié et données de test anonymisées. *(base `crm_recette`, jeu fictif reproductible, serveur sur le port 3200)*
- [ ] Exécution des scénarios REC-01 à REC-12 + scénarios issus de l'Excel. *(partie automatisée faite et tracée ; **exécution manuelle par le métier à faire** ; REC-08 non couvert, REC-07 à éprouver sur Graph réel)*
- [ ] Suivi des anomalies, correctifs, retests. *(registre ouvert dans `docs/RECETTE.md`, 3 corrigées, 4 ouvertes ; retests à faire avec le métier)*
- [x] Test de restauration de sauvegarde (REC-12). *(scripté, RPO 24 h / RTO 4 h ; à refaire sur l'hébergement cible)*
- [x] Audit de sécurité (dépendances, OWASP Top 10, rate limiting, fichiers). *(audit interne : `docs/RECETTE_SECURITE.md` ; pas de test d'intrusion par un tiers)*
- **Sortie** : procès-verbal signé par un représentant métier et un responsable technique. *(modèle vierge dans `docs/RECETTE.md` ; à signer par les personnes habilitées)*

### Phase 9 — Mise en production (≈ 1 semaine)
- [ ] Provisionnement, HTTPS, domaine, secrets, sauvegardes automatiques.
- [ ] Migrations contrôlées avec sauvegarde préalable et plan de retour arrière.
- [ ] Tests de fumée (connexion, droits, création compte, opportunité, forecast, audit).
- [ ] Supervision : health checks, alertes, surveillance des jobs.
- [ ] **Go / no-go formel**.

### Phase 10 — Stabilisation et adoption (≈ 4 semaines)
- [ ] Support renforcé, collecte des irritants, correctifs.
- [ ] Mesure des indicateurs de succès (adoption, complétude, délais de relance).
- [ ] Formation par rôle sur les parcours réels : commerciaux, managers, administrateurs ; utilisateurs référents.

### Calendrier indicatif

| Phase | Durée | Cumul approximatif |
|---|---|---|
| 0 Cadrage | 2 sem. | S2 |
| 1 Conception | 3 sem. | S5 |
| 2 Socle | 2 sem. | S7 |
| 3 MVP-A | 4 sem. | **S11 (première démo)** |
| 4 MVP-B | 8 sem. | **S19** |
| 5 Intégrations ‖ 7 Migration | 6 sem. | S25 |
| 6 Reporting avancé | 4 sem. | S29 |
| 8 Recette | 3 sem. | S32 |
| 9 Production | 1 sem. | S33 |
| 10 Stabilisation | 4 sem. | S37 |

---

## 7. Sécurité et conformité (transversal)

- Autorisation **serveur** sur chaque opération (jamais seulement l'UI) ; moindre privilège ; permissions par action : lire, créer, modifier, réaffecter, clôturer, exporter, administrer.
- Mots de passe hachés (argon2id ou bcrypt), politique de complexité alphanumérique (Excel) renforcée ; verrouillage progressif, MFA/SSO si disponible.
- Cookies Secure, HttpOnly, SameSite ; protection CSRF, XSS, injections, SSRF ; CSP et CORS restrictifs.
- Rate limiting : authentification, recherche, exports, webhooks.
- Jetons OAuth chiffrés au repos, jamais exposés au navigateur ni aux logs.
- Aucune donnée personnelle inutile dans les logs ; journal d'audit append-only.
- Fichiers : validation MIME/taille, renommage, antivirus, liens temporaires.
- **Conformité** : loi ivoirienne sur la protection des données à caractère personnel (ARTCI) à vérifier avec le responsable conformité ; durées de conservation, finalités, droit d'accès/suppression.
- Audit de dépendances automatisé, revue de code obligatoire pour permissions, schéma DB, auth et intégrations.

---

## 8. Stratégie de tests (CDC A.12)

| Niveau | Cible | Critère de sortie |
|---|---|---|
| Unitaires | Calcul pondéré, delta hebdomadaire, transitions d'étape, permissions, règles de qualification | Règles critiques couvertes (objectif ≥ 80 %) |
| Intégration | Services + PostgreSQL, contraintes, transactions (conversion, clôture, fusion), audit | Données cohérentes |
| API | Codes HTTP, validation, pagination, permissions, idempotence | Contrats conformes à OpenAPI |
| E2E (Playwright) | Les 7 parcours Excel + parcours CDC 13.1 à 13.3 | Parcours principaux validés |
| Sécurité | Accès horizontal/vertical, injection, rate limiting, secrets | Aucune faille critique ouverte |
| Performance | Listes, recherche, pipeline, rapports sur jeu réaliste | Seuils fixés en phase 0 |
| Restauration | Récupération de sauvegarde, contrôle d'intégrité | RPO/RTO validés |
| Accessibilité | Contrastes, clavier, libellés | Conformité WCAG 2.2 AA visée |

**Traçabilité recette** : REC-01 → comptes ; REC-02 → doublons ; REC-03 → contacts ; REC-04 → pipeline ; REC-05 → motif de perte ; REC-06 → inactivité ; REC-07/08 → synchronisations ; REC-09 → accès ; REC-10 → KPI/export ; REC-11 → déconnexion d'intégration ; REC-12 → restauration.

---

## 9. Exploitation, sauvegarde et continuité (CDC A.13–A.15)

- Environnements séparés ; aucune donnée de production en recette sans anonymisation.
- Migrations : validées, précédées d'une sauvegarde, stratégie *expand/contract* pour les changements sensibles ; jamais de migration destructive automatique.
- Sauvegardes PostgreSQL automatiques, tests de restauration périodiques documentés, valeurs RPO/RTO à fixer.
- Supervision : health checks, alertes d'erreur, tableau d'état des intégrations et des jobs.
- Documentation : incident, restauration, rotation des secrets, retour à la version précédente.

---

## 10. Livrables (CDC 17)

1. Spécifications fonctionnelles détaillées et règles métier validées
2. Maquettes UX/UI (desktop, tablette, mobile) et design system
3. Architecture technique et modèle de données
4. Code source, documentation d'installation, procédure de déploiement
5. Documentation API (OpenAPI) et configuration des intégrations
6. Plan de tests, jeux de données de recette, procès-verbal
7. Procédures de sauvegarde, restauration, supervision, incidents
8. Guides utilisateur et supports de formation (administrateur, manager, commercial)
9. Plan de migration et rapport de qualité des données
10. Dictionnaire des KPI

---

## 11. Risques et parades

| Risque | Probabilité | Impact | Parade |
|---|---|---|---|
| Règles de bascule floues (I1, I2, I4, I5) | Élevée | Élevé | Atelier phase 0, seuils paramétrables, validation écrite |
| KPI calculés différemment à l'écran et à l'export | Moyenne | Élevé | Dictionnaire unique, fonctions de calcul partagées, test REC-10 |
| Périmètre qui glisse vers la gestion de contrats/sinistres | Moyenne | Élevé | Vue synthétique uniquement ; analyse d'impact pour tout ajout (CDC 21) |
| Intégrations Google/Microsoft plus longues (OAuth, validation d'application, quotas) | Élevée | Moyen | Un seul fournisseur en lot 2, lancer les demandes de validation tôt |
| Qualité des données à migrer | Élevée | Moyen | Import pilote, rapport de rejets, source conservée |
| Jobs peu fiables sur l'hébergeur | Moyenne | Moyen | Worker dédié + pg-boss, mécanisme de reprise |
| Adoption faible | Moyenne | Élevé | Formation sur parcours réels, référents, saisie allégée (I12) |
| Identité visuelle incomplète (logo raster, couleurs I10) | Élevée | Faible | Demander les sources vectorielles dès la phase 0 |
| Conformité données personnelles | Moyenne | Élevé | Revue avec la conformité, minimisation, rétention définie |

---

## 12. Questions à arbitrer avant le démarrage

**Règles métier (bloquantes pour la phase 3)**
1. Seuil de qualification : > 40 % (Excel) ou ≥ 20 % (cahier) ? Strict ou inclusif ? (I1, I2)
2. Quelle formule exacte pour les variations hebdomadaires ? Division par la semaine précédente ? (I3)
3. La « valeur du pipeline » inclut-elle toutes les opportunités ouvertes ou seulement celles à 80–90 % ? Brute ou pondérée ? (I4)
4. Qu'est-ce qu'un « RDV obtenu » exactement ? Un changement d'étape suffit-il ? (I6)
5. Qui valide le passage à « Gagné » et sur quelles preuves (contrat, paiement) ? (I5)
6. Le « chiffre d'affaires » du prospect est-il une prime, une commission, des honoraires ? (CDC 5.3)
7. Faut-il vraiment rendre tous les champs du prospect obligatoires (téléphone **et** e-mail) ? (I12)

**Périmètre et organisation**
8. Pays et identifiants légaux (Côte d'Ivoire : RCCM, numéro CC ?) ; devise unique FCFA ? (I11)
9. Nombre d'utilisateurs au lancement et à 3 ans ; rôles réellement utilisés.
10. Cible : grands comptes/courtage corporate (cahier) ou micro-assurance grand public (charte) ? (I9)
11. Objectifs et quotas commerciaux à intégrer ?
12. Quelles données de contrats/sinistres doivent apparaître dans le CRM ?
13. Quel fournisseur prioritaire : Google Workspace ou Microsoft 365 ? Quelle règle de conflit CRM/calendrier ? Quels e-mails synchroniser ?

**Technique et exploitation**
14. Authentification : e-mail + mot de passe seul, ou SSO/MFA ? (I8)
15. Hébergement, région, SLA, RPO/RTO, rétention.
16. Budget, date cible, priorités du MVP.
17. Sources de données à importer et volumes.

**Identité visuelle**
18. Fournir le logo en vectoriel et les valeurs exactes des couleurs Dommage / Santé / Accident. (I10)

---

## 13. Prochaines actions immédiates

1. Valider ce plan et le découpage MVP-A / MVP-B.
2. Planifier l'atelier de cadrage (phase 0) avec la liste de la section 12.
3. Collecter les assets manquants : logo vectoriel, données existantes, accès hébergement.
4. Dès validation, démarrer la phase 2 (socle technique) en parallèle de la finalisation de la conception.

---

## 14. Journal d'avancement

### Phase 2 — Socle technique : réalisée à 13/10/2026 (code dans `crm/`)

| Élément du plan | État | Détail |
|---|---|---|
| Next.js + TypeScript strict, ESLint, Prettier | Fait | Next.js 16.4 (`cacheComponents` + `partialPrefetching`), Tailwind 4 |
| PostgreSQL + Prisma + première migration | Fait | Prisma **7.10.0** (la version `latest` 8.0 est une version candidate, écartée) ; conteneur dédié `crm_postgres`, port 5435 |
| Modules transverses | Fait | `env` (Zod), `db`, `logger` (pino, champs sensibles masqués), `errors`, `rate-limit`, `audit` |
| Journal d'audit en ajout seul | Fait | Trigger PostgreSQL interdisant `UPDATE`, `DELETE`, `TRUNCATE` ; vérifié par test d'intégration |
| Authentification | Fait | **Better Auth** retenu (sessions en base, plugin admin) ; inscription publique désactivée ; un seul chemin de connexion (action serveur, endpoint HTTP désactivé) |
| Moteur de permissions serveur | Fait | `roles.ts`, `permissions.ts`, `requireUser`, `requirePermission` ; rôle inconnu = moindre privilège |
| Page de connexion (section 3.4) | Fait | Conforme à la capture ; sous-titre « CRM Commercial » ; « Se souvenir de moi » ; œil d'affichage du mot de passe |
| Mot de passe oublié par l'administrateur | Partiel | Demande publique + `must_change_password` + changement forcé faits ; **écran administrateur de réinitialisation : sprint 4.1** |
| Layout CRM (section 3.3) | Fait | Barre latérale repliable, icônes Lucide, en-tête (cloche, avatar, menu), « Déconnexion » en rouge, filtrage du menu par rôle |
| Tests | Fait | 37 tests Vitest (unitaires + intégration sur base `crm_test`) |
| Contrôles | Fait | `eslint` propre, `tsc` propre, `next build` réussi |
| CI/CD | **À faire** | Pipeline lint + types + tests + build |
| Environnements dev / recette / prod, secrets | **À faire** | Seul l'environnement local existe |

**Vérifications manuelles réalisées** : redirection d'un visiteur anonyme vers `/login` ; connexion refusée avec message générique ; connexion réussie puis tableau de bord ; changement de mot de passe forcé après seed administrateur ; repli de la barre latérale ; déconnexion (session supprimée en base + trace d'audit) ; demande de réinitialisation (réponse identique pour un compte inconnu, aucune demande créée).

**Décisions techniques prises pendant la phase** : Better Auth plutôt qu'Auth.js ; comptes de démonstration (un par rôle) créés par le seed en développement uniquement ; limiteur de débit en mémoire (à remplacer par un stockage partagé avant tout déploiement multi-instances) ; base de test séparée car l'audit ne peut pas être nettoyé.

**Écarts constatés par rapport à la capture de référence** : logo provisoire (tracé approché, en attente du fichier vectoriel officiel) ; le gris du texte secondaire a été légèrement assombri pour respecter le contraste WCAG AA.

**Points ouverts** : politique de mot de passe (règles de composition à compléter par le métier, voir `src/lib/auth/password-policy.ts`) ; valeur exacte du bleu nuit du dégradé de la charte ; questions de règles métier de la section 12 (bloquantes pour la phase 3).

### Phase 3 — MVP-A prospects : réalisée à 13/10/2026 (code dans `crm/src/features/leads/`)

| Élément du plan | État | Détail |
|---|---|---|
| Modèle de données | Fait | `leads`, `lead_events` (historique daté), `products` ; contraintes `CHECK` en base (étapes autorisées, gagné ⇔ 100 %, perdu ⇒ motif, date d'insertion ≤ aujourd'hui, montant ≥ 0) |
| Saisie d'un prospect | Fait | Tous les champs de l'Excel ; normalisation du téléphone ; détection de doublons (e-mail, téléphone, raison sociale) avec confirmation (REC-02) |
| Fenêtre de qualification | Fait | Produit proposé + chiffre d'affaires exigés au-delà du seuil ; affichés dans un panneau du formulaire (et non une fenêtre séparée) |
| Bascule automatique entre écrans | Fait | 5 écrans = 5 **vues** d'un même enregistrement (aucune copie) : Reporting prospect, Prospects qualifiés, Propositions envoyées, Valeur du pipeline, Taux de transformation |
| Passage à « gagné » | Fait | Case obligatoire « contrat signé + premier paiement validé » (CDC 14), puis fiche verrouillée |
| Perte d'un prospect | Fait (ajout) | Motif obligatoire (liste du CDC 5.4), commentaire exigé pour « Autre » ; écran « Prospects perdus » |
| Tableau de bord | Fait | 5 KPI avec variation vs semaine précédente, camembert (taux de transformation), histogramme (pipeline sur 4 semaines) |
| Périmètre et permissions | Fait | Le commercial ne voit que ses prospects ; un prospect hors périmètre est « introuvable » (404) |
| Concurrence | Fait | Verrou optimiste (`version`) : une fiche modifiée entre-temps est refusée |
| Audit | Fait | Création, modification (noms de champs uniquement, jamais les valeurs), gain, perte |
| Tests | Fait | 108 tests (unitaires + 20 d'intégration sur PostgreSQL), lint propre, build de production réussi |
| Tests E2E Playwright des parcours | **À faire** | Les parcours ont été vérifiés à la main dans le navigateur |

**Hypothèses retenues provisoirement** (paramétrables dans la table `settings`, clé `leads.thresholds`, à faire valider en phase 0 rétroactive) :

| Question du plan | Hypothèse implémentée |
|---|---|
| I1 / I2 — seuils de bascule | Reprise de l'Excel : « qualifié » au-dessus de 40 %, « proposition envoyée » au-dessus de 60 % (comparaisons strictes). Conséquence : une offre à exactement 60 % (« devis envoyé » selon le CDC) reste dans « Prospects qualifiés » |
| I3 — variation hebdomadaire | (semaine − semaine précédente) / semaine **précédente** ; « non calculable » si la précédente vaut 0. La formule écrite dans l'Excel (division par la semaine courante) a été écartée |
| I4 — valeur du pipeline | Offres ouvertes entre 80 % inclus et 100 % exclu (feuille de l'Excel), en brut et en pondéré. **Constat** : « Propositions envoyées » et « Valeur du pipeline » affichent donc les mêmes prospects avec les seuils par défaut |
| I5 — gain | Confirmation explicite « contrat signé + premier paiement » |
| I6 — « RDV obtenus » | Prospects ayant atteint pour la première fois 40 % (« Découverte approfondie » = réunion de cadrage effectuée) dans la semaine |
| Taux de transformation | Gagnées / (gagnées + perdues) clôturées dans la semaine (CDC 1.2) ; d'où l'ajout du statut « perdu » absent de l'Excel |
| Produits | Liste initiale : « Individuelle Accident » (exemple de l'Excel) et la gamme SECUR / RELAX de la charte, à valider |
| Secteurs | Liste contrôlée de 15 secteurs, à valider |

**Limites connues** : pas encore d'écran d'administration des seuils, des produits ni de réaffectation d'un propriétaire ; pas de réouverture d'un prospect clôturé ; pas d'export (lot 3) ; la gestion des équipes (périmètre « manager ») est prête côté code mais sans écran pour affecter les utilisateurs à une équipe ; la recherche n'est pas insensible aux accents.

### Phase 4, sprint 4.1 — Administration des utilisateurs : réalisée à 13/10/2026 (code dans `crm/src/features/users/`)

| Élément du plan | État | Détail |
|---|---|---|
| Création de compte par l'administrateur | Fait | Mot de passe temporaire généré (16 caractères, aléa cryptographique, caractères ambigus exclus), changement forcé à la première connexion, e-mail unique |
| Réinitialisation du mot de passe (décision validée) | Fait | Mot de passe temporaire affiché **une seule fois** à l'administrateur (jamais dans l'URL, jamais stocké ni journalisé) ; toutes les sessions de l'utilisateur sont fermées ; les demandes en attente sont clôturées ; impossible sur son propre compte ou sur un compte désactivé |
| File des demandes (page « Mot de passe oublié ») | Fait | Écran dédié, bouton « Ignorer » tracé ; **la cloche de l'en-tête** affiche le nombre de demandes en attente pour les administrateurs |
| Désactivation immédiate (CDC 2.1) | Fait | Connexion refusée (message dédié), sessions supprimées, réversible |
| Rôles et équipes | Fait | Changement de rôle ou d'équipe depuis la fiche (sessions révoquées au changement de rôle) ; écran Équipes (création, responsable, suppression si vide) |
| Garde-fous | Fait | Pas de modification de son propre rôle ni désactivation de son propre compte ; **le CRM garde toujours au moins un administrateur actif** |
| Contrôle d'accès | Fait | Permission `user:manage` vérifiée dans chaque page, action et service ; un non-administrateur reçoit l'écran « introuvable » et le menu ne montre pas la section |
| Audit | Fait | `user.created`, `user.updated`, `user.deactivated`, `user.reactivated`, `user.password_reset`, `team.*`, `auth.reset_request_dismissed` (aucun secret, uniquement des identifiants) |
| Seed de développement | Fait | Compte `admin.demo@crm.local` et « Équipe démo » (manager + commercial) pour tester le périmètre manager |
| Tests | Fait | 140 tests (dont des connexions réelles Better Auth avec le mot de passe temporaire), lint propre, build réussi |

**Limites connues** : les pages d'administration d'un non-administrateur renvoient le contenu « introuvable » mais avec le statut HTTP 200 (le statut est déjà envoyé lorsque le contenu est diffusé en flux) — aucune donnée n'est exposée ; pas de consultation du journal d'audit (permission `audit:read` prévue, écran au sprint 4.6) ; pas d'écran pour les seuils de qualification ni les produits ; la transmission du mot de passe temporaire reste manuelle (aucun e-mail envoyé, par décision) ; le limiteur de débit reste en mémoire (une seule instance).

### Phase 4, sprint 4.2 — Comptes et contacts : réalisée à 13/10/2026 (code dans `crm/src/features/accounts/` et `contacts/`)

| Élément du plan | État | Détail |
|---|---|---|
| Fiche entreprise (CDC 3.1) | Fait | Raison sociale, nom commercial, identifiant légal, secteur, effectif, chiffre d'affaires (montant + devise + année + source), convention collective, statut, source d'acquisition, adresse, pays, téléphone, domaine e-mail |
| Propriétaire commercial | Fait | Le créateur par défaut ; changement réservé aux managers, à la direction et à l'administrateur, **tracé** (`account.owner_changed`) |
| Hiérarchie groupe / filiale (CDC 3.2) | Fait | Compte parent, filiales, **prévention des boucles** (refus à tout niveau de profondeur) ; « Ajouter une filiale » depuis le groupe |
| Vue groupe avec droits propres | Fait | Une filiale hors périmètre n'est pas montrée, seulement comptée ; un parent hors périmètre est masqué ; totaux limités aux comptes visibles |
| Détection de doublons (REC-02) | Fait | Raison sociale, identifiant légal, domaine e-mail, téléphone (comptes) ; e-mail, nom + téléphone (contacts) ; alerte avant validation, lien vers le compte existant s'il est visible |
| Unicité de l'identifiant légal | Fait | Index unique par pays parmi les comptes non archivés ; même en cliquant « créer quand même », la base refuse |
| Fusion de doublons (CDC 3.2) | Fait | Réservée à la direction et à l'administrateur ; atomique ; filiales, contacts et rôles transférés ; champs vides complétés ; compte fusionné **archivé avec renvoi** (jamais supprimé) ; refus si le compte conservé est une filiale du compte fusionné |
| Contacts multi-comptes (CDC 3.3) | Fait | Un contact peut être rattaché à plusieurs comptes (fonction, dates, **contact principal unique** par compte) ; statut, canal privilégié, restrictions de contact |
| Rôles d'achat (REC-03) | Fait | Décideur, validateur, acheteur, prescripteur, utilisateur, autre ; par compte et **par produit** ; niveau d'influence ; pas de doublon ; supprimés avec le rattachement |
| Complétude de la fiche (CDC 13.1) | Fait | Champs obligatoires manquants (raison sociale, secteur, propriétaire) distingués des champs recommandés ; pourcentage dans la liste |
| Périmètre et permissions (REC-09) | Fait | Un compte hors périmètre est « introuvable » ; contacts visibles via un compte visible ; l'audit lit sans écrire |
| Audit | Fait | `account.created/updated/owner_changed/merged`, `contact.created/updated/linked/link_updated/unlinked/role_added/role_removed` (noms de champs uniquement, jamais les valeurs) |
| Tests | Fait | 202 tests au total (dont 34 d'intégration sur PostgreSQL pour les comptes et contacts), lint propre, build réussi |

**Défaut trouvé par les tests** : sans e-mail ni téléphone, la recherche de doublons de contacts utilisait un filtre `OR` vide, **ignoré par Prisma**, et signalait tous les contacts comme doublons. Corrigé (retour anticipé) et couvert par un test.

**Limites connues** : l'identifiant légal n'est pas validé par format de pays (liste « Pays et identifiants » à arbitrer, section 12, question 8) ; la détection de doublons sur la raison sociale est insensible à la casse mais pas aux accents (extension PostgreSQL `unaccent` à prévoir) ; la fusion des contacts en double n'est pas implémentée (seulement celle des comptes) ; les listes de choix (compte parent, contact à associer) sont limitées à 500 et 300 entrées ; les opportunités, activités et documents du compte arriveront aux sprints 4.3 et 4.4 (la vue groupe les agrégera alors) ; la conversion d'un prospect en compte + contact (CDC A.8) est prévue au sprint 4.3.

### Phase 4, sprint 4.3 — Opportunités et Kanban : réalisée à 13/10/2026 (code dans `crm/src/features/opportunities/` et `crm/src/app/(crm)/opportunites/`)

| Élément du plan | État | Détail |
|---|---|---|
| Modèle d'opportunité (CDC 5.1) | Fait | Compte, propriétaire, produit, montant, période de revenu, méthode d'estimation, étape, statut, clôture prévisionnelle, prochaine action et sa date, concurrent, solution actuelle, motif de perte ; contacts impliqués avec rôle et contact principal unique ; historique `opportunity_events` |
| Kanban (CDC 5.2) | Fait | Une colonne par étape ouverte (10, 20, 40, 60, 80, 90 %), totaux brut et pondéré par colonne, cartes avec alerte de retard ; glisser-déposer **et** sélecteur accessible au clavier ; zones « gagnée » et « perdue » ; vue liste paginée ; filtres recherche, produit, propriétaire |
| Changement d'étape | Fait | Boîte de confirmation avec critère de sortie de l'étape visée ; produit et montant obligatoires au-delà du seuil de qualification ; reculer permis (tracé) ; **le serveur refuse sans confirmation** (vérifié dans le navigateur) |
| Clôture gagnée / perdue | Fait | Gagnée : contrat signé + premier paiement confirmés ; perdue : motif obligatoire (commentaire exigé pour « Autre ») ; une opportunité clôturée est en lecture seule |
| Montants (CDC 5.3) | Fait | Brut, pondéré (montant × probabilité de l'étape) et signé (gagnées de l'année) **calculés côté serveur** ; vérifiés sur les données de démonstration (43,7 M brut, 31,32 M pondéré) |
| Conversion prospect → compte + contact + opportunité (CDC A.8) | Fait | Transaction atomique ; alerte de doublon avant création, rattachement possible à un compte existant ; contact réutilisé s'il existe ; le prospect est conservé et renvoie vers l'opportunité ; double conversion refusée |
| Contraintes en base | Fait | Étapes autorisées, gagnée ⇔ étape 100, perdue ⇒ motif, montant ≥ 0, ouverte ⇒ clôture prévue + prochaine action + date, un seul contact principal |
| Périmètre et permissions | Fait | `opportunity:read` / `opportunity:write` ; audit en lecture seule ; hors périmètre ⇒ « introuvable » ; réaffectation réservée à `account:assign` |
| Audit | Fait | `opportunity.created/updated/stage_changed/won/lost/contact_added/contact_removed`, `lead.converted` |
| Tests | Fait | 261 tests (dont 28 d'intégration pour les opportunités), lint et `tsc` propres, build réussi |

**Défaut trouvé par les tests** : un montant laissé vide était accepté comme 0 (`z.coerce.number` convertit `""` en 0) ; il est désormais refusé comme absent.

**Limites connues** : les étapes sont des constantes (pas de table `pipeline_stages` configurable) ; les contacts d'opportunité ne sont pas reliés aux rôles d'achat par produit (`contact_roles`) ; la définition comptable du revenu (prime, commission, honoraires) n'est pas tranchée (section 12, question 6) ; la conversion et le glisser-déposer n'ont pas de test de bout en bout (Playwright) : la conversion est couverte par les tests d'intégration, le Kanban a été vérifié à la main via le sélecteur ; la fusion de contacts en double n'est pas implémentée ; le Kanban est limité à 500 opportunités ouvertes.

### Phase 4, sprint 4.4 — Activités et tâches : réalisée à 13/10/2026 (code dans `crm/src/features/activities/`, `tasks/` et `crm/src/app/(crm)/activites/`, `taches/`)

| Élément du plan | État | Détail |
|---|---|---|
| Types d'activités (CDC 6.1) | Fait | Appel entrant/sortant, e-mail, rendez-vous, visioconférence, note interne, envoi de proposition, étape contractuelle ; objet, date et heure, auteur, compte, contact et opportunité éventuels, résultat, prochaine action |
| Fil unifié (CDC 3.4) | Fait | Activités, tâches et changements d'étape fusionnés du plus récent au plus ancien ; **origine visible** (saisie utilisateur, synchronisation, automatisation) ; filtres type, période, contact, opportunité, compte et auteur ; intégré aux fiches compte et opportunité, et page `/activites` |
| Prochaine action | Fait | Une activité liée à une opportunité **ouverte** met à jour sa prochaine action (version incrémentée, audit) ; ni l'opportunité clôturée ni l'activité sans prochaine action ne sont touchées |
| Tâches (CDC 6) | Fait | Titre, description, échéance (un jour), priorité, **responsable obligatoire**, lien compte / contact / opportunité ; terminer, annuler, rouvrir ; date de réalisation posée par le serveur ; vues « à faire », « en retard », « aujourd'hui », « terminées » avec compteurs |
| Règles des tâches | Fait | Échéance dans le passé refusée à la création ; retard = ouverte et échéance antérieure à aujourd'hui (UTC) ; réaffectation réservée aux profils pouvant réaffecter (`account:assign`) ; l'audit ne peut pas être responsable ; une tâche terminée ne se modifie plus |
| Cohérence des liens | Fait | Le contact doit être rattaché au compte ; l'opportunité impose son compte ; une activité ne change pas de compte |
| Périmètre et permissions | Fait | `activity:read/write`, `task:read/write` ; une activité n'est visible que par ceux qui voient son compte ; une tâche par son responsable, son créateur, l'équipe (manager) ou le compte lié ; l'audit lit sans écrire |
| Correction | Fait | Une activité se corrige par son auteur ou un profil pouvant réaffecter ; une activité synchronisée ou automatique est en lecture seule ; verrou optimiste (409) |
| Contraintes en base | Fait | Types, origines, statuts et priorités autorisés ; tâche terminée ⇔ date de réalisation ; date de prochaine action ⇒ action |
| Audit | Fait | `activity.created/updated`, `task.created/updated/reassigned/completed/cancelled/reopened` (identifiants et noms de champs, jamais les contenus) |
| Tests | Fait | 302 tests au total (dont 24 d'intégration et 17 unitaires pour ce sprint), lint, `tsc` et build réussis |

**Limites connues** : pas d'enregistrement de pièces jointes ni de synchronisation e-mail/calendrier (lot 2) : l'origine « synchronisation » est prête mais aucune activité n'en provient encore ; les relances et alertes automatiques (inactivité, retard, rendez-vous imminent) et le centre de notifications restent au sprint 4.5 ; une tâche créée depuis une fiche ne propose pas de choix de contact dans le formulaire (le contact vient d'un lien préparé) ; le fil est limité aux 100 événements les plus récents par source ; l'interface n'a pas encore été parcourue de bout en bout dans le navigateur par une session authentifiée (vérifications faites sur les services et les tests d'intégration) ; un test d'intégration a échoué une fois, sans pouvoir être reproduit lors de quatre exécutions complètes ultérieures.

### Phase 4, sprint 4.5 — Automatisations et notifications : réalisée à 14/10/2026 (code dans `crm/src/features/automations/`, `notifications/`, `crm/src/app/(crm)/notifications/`, `admin/automatisations/`)

| Élément du plan | État | Détail |
|---|---|---|
| Compte sans activité (CDC 6.2) | Fait | Seuil **par segment** : grand compte (effectif ≥ 250) 15 jours, autres comptes 30 jours ; crée une tâche de relance au propriétaire et le notifie ; un rendez-vous futur ne compte pas comme un échange ; comptes archivés, partenaires et propriétaires désactivés ignorés |
| Opportunité sans prochaine action | Fait, **à interpréter** | La base interdit déjà une opportunité ouverte sans prochaine action : la règle alerte donc quand la **date** de la prochaine action est dépassée (aucune action à venir) |
| Clôture prévisionnelle dépassée | Fait | Demande au propriétaire de mettre à jour le dossier ; **escalade au manager** de son équipe après un délai paramétrable (7 jours) |
| Rendez-vous imminent | Fait | Rappel à l'auteur d'un rendez-vous ou d'une visioconférence dans un délai paramétrable (24 h) ; un seul rappel par rendez-vous |
| Tâche en retard | Fait | Notifie le responsable, puis le manager de son équipe après un délai paramétrable (3 jours) ; un manager n'est jamais prévenu de ses propres retards |
| Idempotence | Fait | Clés **uniques en base** : tâche = règle + compte + période (`tasks.automation_key`), notification = destinataire + règle + période ; deux passages ou deux exécutions simultanées ne créent rien de plus ; la nouvelle période en recrée |
| Activation, désactivation, paramètres | Fait | Page `/admin/automatisations` (administrateur) : activation, seuils, fréquences, escalades, bornes validées côté serveur ; changements tracés (`automation.rule_updated`) |
| Journal d'exécution | Fait | Table `automation_runs` : règle, déclenchement (manuel ou planifié), statut, éléments évalués, tâches et notifications créées, éléments déjà traités, erreur ; une règle en erreur n'empêche pas les suivantes |
| Centre de notifications (CDC 6.3) | Fait | Page `/notifications` : toutes ou non lues, lues/non lues, **accès direct au dossier**, tout marquer comme lu ; cloche de l'en-tête avec compteur ; chacun ne voit et ne modifie que les siennes |
| Anti-spam | Fait | **Regroupement** : une notification par destinataire et par règle regroupe tous les éléments (« 3 tâches en retard ») ; **fréquence maximale** par règle (période) |
| Changements de propriétaire | Fait | Le nouveau responsable d'un compte, d'une opportunité ou d'une tâche est notifié (jamais quand on se l'attribue) |
| Déclenchement | Fait | Bouton « Exécuter maintenant », script `npm run jobs:run`, et route `POST /api/jobs/automations` protégée par `CRON_SECRET` (404 si le secret est absent, comparaison en temps constant) |
| Tests | Fait | 346 tests au total (29 d'intégration et 15 unitaires pour ce sprint), lint, `tsc` et build réussis |

**Décision d'architecture** : le plan prévoyait **pg-boss** (file de tâches sur PostgreSQL, processus séparé). Le moteur est à la place une fonction idempotente appelable aussi souvent que voulu (cron, bouton, script) : aucune dépendance ni processus supplémentaire, et les doublons sont impossibles grâce aux clés uniques. pg-boss deviendra utile avec les synchronisations e-mail et calendrier (lot 2), qui ont besoin de reprises et de files.

**Limites connues** : aucun ordonnanceur n'est fourni : il faut programmer l'appel (cron système, tâche planifiée de l'hébergeur) ; pas de notification par e-mail (aucun service d'envoi par décision) ; une notification groupée n'est pas mise à jour si de nouveaux éléments arrivent dans la même période (ils sont signalés à la période suivante) ; les notifications de synchronisation en échec attendent le lot 2 ; une tâche de relance est créée « au nom » de son responsable (pas d'utilisateur système) ; le fuseau est unique (UTC, soit Abidjan) ; l'interface n'a pas été parcourue de bout en bout avec une session authentifiée (vérifications faites sur les services, le script et la route).

### Phase 4, sprint 4.6 — Audit et import : réalisée à 14/10/2026 (code dans `crm/src/features/audit/`, `imports/`, `crm/src/app/(crm)/admin/audit/`, `admin/import/`, `crm/src/app/api/audit/`, `api/import/`)

| Élément du plan | État | Détail |
|---|---|---|
| Journal d'audit consultable (CDC 2.1 et 14) | Fait | Page `/admin/audit` : filtres par action (exacte ou famille), objet, auteur (dont « Système »), période ; détail des métadonnées ; pagination ; réservée à `audit:read` (administrateur et audit). Le journal reste **en ajout seul** (trigger PostgreSQL, vérifié par les tests) |
| Couverture du journal | Fait | Connexions et déconnexions, changements de mot de passe, changements de responsable, fusions, utilisateurs et équipes (rôles, permissions), automatisations, imports, exports. Aucun compte n'étant supprimé (archivage), les suppressions concernent les équipes et les lignes d'import annulées |
| Exports journalisés (CDC 8.3) | Fait | Export CSV du journal (`audit:export`) : plafonné à 5 000 lignes (les plus récentes), limité à 5 par minute, filtres invalides refusés (jamais d'export « complet » par erreur), formules neutralisées, et **chaque export est lui-même tracé** avec ses filtres |
| Import CSV et XLSX (CDC 11 et 16) | Fait | Comptes puis contacts ; en quatre étapes : dépôt, association des colonnes, analyse, import. Réservé à l'administrateur (`import:run`) |
| Association des colonnes | Fait | Proposée automatiquement (intitulés exacts puis synonymes, sans tenir compte des accents ni de la casse) et corrigeable ; valeurs par défaut (responsable, secteur, statut, pays) ; fichier modèle téléchargeable |
| Validation | Fait | Les **mêmes schémas** que les formulaires ; reconnaissance des libellés saisis librement (« client », « Côte d'Ivoire ») ; nombres au format français ; domaine nettoyé (URL, adresse e-mail) ; responsable désigné par e-mail |
| Déduplication | Fait | Comptes : identifiant légal et raison sociale (sans accents, à pays égal) ; contacts : e-mail et nom dans le même compte ; **en base et dans le fichier**, avec renvoi à la ligne d'origine |
| Rapport de qualité (CDC 16) | Fait | Lignes valides, rejetées, doublons (en base / dans le fichier), motifs de rejet les plus fréquents, champs recommandés manquants, colonnes ignorées ; liste des lignes à corriger et **rapport des rejets téléchargeable** (CSV, journalisé) |
| Sûreté de l'import | Fait | Rien n'est écrit avant l'analyse puis la **confirmation explicite** ; chaque ligne est importée dans sa propre transaction (réclamation + création) : pas de double création même si deux imports se chevauchent ; **reprenable** après interruption ; un conflit à l'insertion ne rejette que sa ligne ; chaque ligne garde l'identifiant de ce qu'elle a créé |
| Données personnelles | Fait | Les cellules d'origine des lignes importées sont **effacées** ; un lot annulé supprime immédiatement toutes ses lignes |
| Contrôles du fichier | Fait | Format vérifié sur le contenu (signature ZIP d'un .xlsx, absence d'octets nuls dans un .csv), 5 Mo et 2 000 lignes au maximum, .xls refusé, CSV en UTF-8 ou Windows-1252, séparateur deviné, cellules tronquées à 2 000 caractères |
| Tests | Fait | 445 tests au total (24 d'intégration pour l'import, 16 pour l'audit, 57 unitaires pour le CSV et l'import), lint, `tsc` et build réussis |

**Dépendances ajoutées** : `read-excel-file` (lecture XLSX) et `write-excel-file` (développement : fabrication de classeurs de test). `npm audit` signale 4 vulnérabilités élevées, **toutes dans l'outil `prisma`** (`deepmerge-ts`, `mysql2`, non utilisés à l'exécution) et antérieures à ce sprint ; aucune ne vient des paquets ajoutés.

**Limites connues** : l'import est synchrone (2 000 lignes par fichier) : le cahier des charges demande un traitement asynchrone pour les volumes importants, à prévoir avec le worker du lot 2 ; seuls les comptes et les contacts s'importent (pas les opportunités, activités ni documents) ; pas de mise à jour des fiches existantes (les doublons sont ignorés) ni de retour arrière d'un import (les identifiants créés sont conservés dans le lot, une suppression ou une fusion se fait fiche par fiche) ; les créations importées sont tracées par un enregistrement par lot et non un par fiche ; les numéros de téléphone enregistrés comme nombres dans Excel perdent leur 0 initial (consigne affichée) ; la liste des secteurs est stricte (un secteur inconnu rejette la ligne, avec la valeur en cause dans le rapport) ; le journal d'audit n'a pas d'archivage ni de purge (ajout seul) ; l'interface n'a pas été parcourue de bout en bout avec une session authentifiée (fait au sprint 4.7).

### Phase 4, sprint 4.7 — Stabilisation MVP-B : réalisée à 15/10/2026

| Élément du plan | État | Détail |
|---|---|---|
| Tests unitaires (forecast, transitions, permissions) | Fait | Couverts au fil des sprints : montants pondérés et transitions d'étape (`opportunities-rules`), permissions de chaque rôle (`permissions`), règles des tâches, des automatisations, de l'import et du CSV |
| Tests d'intégration base de données | Fait | Fichiers sur PostgreSQL pour les comptes, contacts, prospects, opportunités et conversion, activités et tâches, automatisations et notifications, import, audit et utilisateurs : périmètres, permissions, verrou optimiste, contraintes, idempotence, intégrité du journal |
| Tests de performance sur jeu réaliste | Fait | `npm run test:perf` : 5 000 comptes, 15 000 contacts, 10 000 opportunités, 40 000 activités, 10 000 tâches. **Tous les écrans répondent en moins de 45 ms** (budgets : 1 à 2 s) ; automatisations des 5 règles : 0,9 s ; analyse de 2 000 lignes d'import : 4,2 s ; import de 1 938 comptes : 23 s (~12 ms par ligne). Aucun correctif nécessaire |
| Parcours de bout en bout | Fait (manuel) | Environnement isolé (`npm run dev:e2e`, base de test, port 3101, comptes générés par `scripts/e2e-user.ts`) piloté dans le navigateur : connexion, Kanban, changement d'étape avec confirmation, conversion de prospect avec alerte de doublon, saisie d'activité et validation, règles d'automatisation (exécution manuelle, erreur de réglage), import (association, analyse, refus sans confirmation, import), journal d'audit, notifications, fiche compte et fil |
| Défaut trouvé et corrigé | Fait | Un test d'intégration (`users-service`) échouait par dépassement du délai du `beforeAll` à froid (import de toute la pile Better Auth après un redémarrage, disque non mis en cache) ; délais des hooks relevés à 60 s dans `vitest.config.mts` |
| Tests | Fait | 445 tests, lint, `tsc` et build réussis |

**Limites connues** : pas de suite E2E automatisée (Playwright) : le parcours ci-dessus est manuel et son environnement est scripté, mais pas encore rejouable en un clic ; le glisser-déposer du Kanban n'a pas été exercé à la souris (le sélecteur, qui passe par la même boîte de confirmation, l'a été) ; le dépôt d'un fichier par le navigateur n'a pas été exercé (le lot d'essai a été créé par le service, puis analysé et importé depuis l'interface) ; les mesures de performance portent sur les services et la base, pas sur le rendu du navigateur ni sur le réseau ; le jeu de données est synthétique (répartition plausible, mais pas celle des données réelles de SIM) ; avec des centaines d'utilisateurs, la liste déroulante des responsables de l'import deviendrait longue (hors périmètre pour une équipe commerciale).

**Sortie de phase** : tests fonctionnels réussis (CDC 16.1). La phase 4 (MVP-B « Socle CRM ») est complète côté code ; restent, avant une mise en production, la revue de sécurité (CSP, sauvegardes, restauration) prévue aux phases suivantes et la validation métier des listes et seuils.

### Phase 5 — Intégrations Microsoft 365 (lot e-mails, lecture seule) : réalisée à 15/10/2026 (code dans `crm/src/features/integrations/`, `crm/src/app/(crm)/integrations/`, `crm/src/app/api/integrations/`, `api/jobs/integrations/`)

**Décisions prises avec l'utilisateur** : fournisseur **Microsoft 365** ; périmètre **e-mails en lecture seule** d'abord ; règle de conflit du futur lot calendrier : **le calendrier de l'utilisateur gagne**. Guide d'installation et d'exploitation : `docs/INTEGRATION_MICROSOFT.md`.

| Élément du plan | État | Détail |
|---|---|---|
| OAuth 2.0, consentement, jetons chiffrés | Fait | Code d'autorisation + PKCE S256, état anti-CSRF lié à l'utilisateur, à usage unique, expirant en 10 min. Droits minimaux : `offline_access`, `User.Read`, `Mail.ReadBasic` (en-têtes seulement, jamais le corps ni les pièces jointes). Jetons AES-256-GCM, liés à leur ligne et colonne (`src/lib/crypto.ts`), clé `TOKEN_ENCRYPTION_KEY` hors base. Jeton d'actualisation tourné et réenregistré avant usage |
| Synchronisation e-mail | Fait | Lecture incrémentale « delta » de la boîte de réception et des éléments envoyés, curseur enregistré après chaque page, 30 jours à la première lecture. Une activité « e-mail » par compte visible de l'utilisateur dont un contact est interlocuteur ; dédoublonnage par `Message-ID` (index unique partiel sur `activities`) ; brouillons, messages personnels/privés/confidentiels et domaines exclus écartés ; lien « Ouvrir dans Outlook » validé (https seulement) |
| Webhooks | Fait | Abonnement `me/messages` créé et renouvelé automatiquement, secret `clientState` par connexion comparé en temps constant, poignée de main `validationToken`, corps borné, réponse 202 immédiate ; le webhook ne fait que marquer la connexion, la lecture est différée (route planifiée). Perte de curseur (410) → relecture complète sans doublon ; 429 → synchronisation partielle ; 401 → un renouvellement forcé puis reconnexion |
| État visible, reconnexion guidée, journal | Fait | Page `/integrations` (statut, dernière réussite, incident, connecter/reconnecter/synchroniser/déconnecter), journal `sync_events`, vue d'ensemble administrateur et audit (REC-11), notification unique par période de consentement quand l'accès est révoqué |
| Verrou et idempotence | Fait | Verrou par connexion en base (repris au bout de 10 min), délai minimal de 30 s entre deux synchronisations manuelles, exécution planifiée bornée (25 connexions, 20 pages par dossier) |
| Synchronisation calendrier, liens Teams | Reporté | Lot suivant ; les droits correspondants ne sont pas demandés tant que la fonction n'existe pas |
| Activation avec un groupe pilote | À faire | Procédure rédigée ; nécessite une application Azure réelle |
| Tests | Fait | 499 tests (54 de plus), `tsc`, lint et build réussis. Un faux fournisseur Microsoft remplace le réseau : connexion, états rejoués/expirés, jetons chiffrés, reconnexion même compte/autre compte, périmètre, exclusions, idempotence, curseurs, 410/429/401, révocation, verrou, webhook, abonnements, vue d'ensemble |
| Défaut trouvé et corrigé | Fait | Le filtre OData de la première lecture était encodé avec des `+` pour les espaces ; remplacé par `%20`, seule forme garantie |

**Changement d'infrastructure en cours de phase** : à la demande de l'utilisateur, le projet pointe désormais sur le **PostgreSQL local** (service Windows, PostgreSQL 18, port 5432) : bases dédiées `crm` (développement) et `crm_test` (tests), migrations appliquées, données de démonstration créées. L'ancienne base du conteneur Docker `crm_postgres` n'a pas été migrée ; ses URL sont conservées en commentaire dans `.env` (`DATABASE_URL_DOCKER`, `TEST_DATABASE_URL_DOCKER`).

**Limites connues** : **le comportement réel de Microsoft n'a pas pu être vérifié ici** (il faut une application Azure, un locataire et, pour les webhooks, une adresse HTTPS publique) : le moteur est validé contre un faux fournisseur et des réponses simulées, pas contre Graph ; les formats de réponse retenus suivent la documentation Graph et devront être confirmés lors du premier essai pilote. Pas de regroupement par fils de conversation. Un message sans `Message-ID` est dédoublonné par son identifiant Graph, qui change si le message est déplacé (cas rare). Le rapprochement se fait sur l'adresse exacte du contact : un contact sans e-mail ou avec une autre adresse n'est pas reconnu. Le nom d'un utilisateur désactivé n'est pas retiré de la liste des connexions (sa lecture s'arrête, son statut reste visible).

### Phase 6 — Reporting avancé : réalisée à 15/10/2026 (code dans `crm/src/features/reporting/`, `crm/src/app/(crm)/rapports/`, `admin/objectifs/`, `crm/src/app/api/reports/`)

**Décisions prises avec l'utilisateur** : montants **annualisés** (mensuel × 12, annuel et unique tels quels) ; objectifs **par commercial et par mois** (un objectif trimestriel, annuel ou d'équipe est la somme des mois) ; exports **immédiats et plafonnés**, sans job asynchrone.

| Élément du plan | État | Détail |
|---|---|---|
| Forecast mensuel / trimestriel / annuel | Fait | `/rapports/previsions` : pipeline brut, pipeline pondéré, gagnées, revenu signé et forecast (= signé + pondéré), par période, avec graphique ; une plage qui coupe un trimestre le lit en entier. Segmentation par produit, équipe, commercial, secteur et groupe de comptes (compte parent) ; chaque segmentation additionne au même total. Filtres produit et commercial |
| Objectifs et comparaison | Fait | Table `sales_targets` (contraintes : montant ≥ 0, premier jour du mois) ; saisie `/admin/objectifs` (manager : son équipe ; direction et administrateur : tous). Écart et taux d'atteinte par période, par commercial et par équipe ; « non calculable » quand l'objectif est nul ou absent ; un commercial ayant un objectif mais aucun pipeline apparaît à zéro ; comparaison masquée avec un filtre produit |
| Motifs de perte croisés | Fait | `/rapports/pertes` : matrice motif × produit, secteur, commercial, taille du compte (effectif) ou équipe, nombre et montant annualisé, répartition par motif |
| Exports CSV / XLSX | Fait | `/api/reports/export` : forecast, motifs de perte et détail des opportunités. Réservé à `report:export` (manager et au-dessus), 10 exports par minute, détail plafonné à 5 000 lignes (annoncé dans le fichier), chaque export tracé (`report.exported`, critères seulement). Filtres appliqués, date de génération et définitions des KPI dans le fichier ; CSV avec virgule décimale pour l'Excel français, formules neutralisées ; XLSX avec onglet « Définitions » |
| Cohérence écran / export (REC-10) | Fait | Un seul rapport en mémoire alimente l'écran et les deux formats ; un test relit le CSV et le XLSX exportés et compare chaque total à celui de l'écran. Dictionnaire des KPI unique (`reporting/config.ts`) |
| Permissions | Fait | `report:read` (tous), `report:export` et `target:manage` (manager, direction, administrateur). Chaque lecture applique le périmètre de l'utilisateur ; un manager ne voit ni ne fixe les objectifs d'un commercial hors de son équipe |
| Job asynchrone, pagination des exports | Non retenu | Décision : exports immédiats et plafonnés (pas de stockage de fichiers à exploiter). À reconsidérer si les volumes dépassent le plafond |
| Tests | Fait | 546 tests (47 de plus), `tsc`, lint et build réussis : règles pures, filtres, périmètres, objectifs, motifs de perte, parité écran / export |
| Défaut trouvé et corrigé | Fait | Le calcul prévoyait des opportunités ouvertes « sans date de clôture » ; la base l'interdit (contrainte `opportunities_open_requirements_check`) : concept supprimé plutôt que de défendre un état impossible |

**Limites connues** : « revenu signé » = montant annualisé des opportunités gagnées ; la définition comptable (prime, commission, honoraires, premier paiement) reste à confirmer par le métier (CDC 5.3). Le groupe de comptes est le compte parent direct (un seul niveau). La taille d'un compte vient de son effectif (`employeeCount`), souvent non renseigné : la tranche « Taille inconnue » peut dominer tant que les comptes ne sont pas complétés. Les objectifs ne sont pas historisés (seule la dernière valeur est conservée, la trace d'audit garde le total annuel). Le détail mensuel d'un segment figure dans l'export, pas à l'écran. Aucun e-mail ni envoi planifié de rapport.

### Phase 7 — Migration de données : réalisée à 16/10/2026 (code dans `crm/src/features/imports/`, `crm/src/lib/phone.ts`, `crm/src/app/(crm)/admin/import/`)

**Décisions prises avec l'utilisateur** : la migration porte aussi sur les **prospects** (en plus des comptes et contacts) ; **format de téléphone unique +225** partout, à l'import comme à la saisie manuelle.

| Élément du plan | État | Détail |
|---|---|---|
| Inventaire des sources | Fait | À la création du lot, `profileSource` calcule volumes, lignes en double, et par colonne : taux de remplissage, nombre de valeurs distinctes, type deviné (téléphone, e-mail, date, nombre, texte) et valeurs les plus fréquentes. Affiché sur la page du lot (« Inventaire de la source ») |
| Téléphones ivoiriens | Fait | `lib/phone.ts` : `+225` + 10 chiffres commençant par 0 (formats `07 07 35 36 73`, `+225 07…`, `00225…` acceptés) ; autre indicatif international conservé (`+` et 8 à 15 chiffres). Un numéro à 8 chiffres (avant 2021) est signalé `legacy` et **jamais converti** (le préfixe d'opérateur ne se devine pas). Même règle dans les formulaires comptes, contacts et prospects (Zod) |
| Secteurs et produits | Fait | Alias de secteurs (`SECTOR_ALIASES`), produit retrouvé par clé normalisée (`+` → `plus`). Les valeurs inconnues sont listées dans le panneau « Valeurs à rapprocher » : l'administrateur choisit la valeur du CRM, la correspondance est conservée dans le lot (`valueMap`) et le lot est ré-analysé ; sans choix, la ligne est rejetée |
| Import des prospects | Fait | Entité `leads` : doublon par e-mail ou entreprise + nom + prénom ; progression 100 % = **gagné présumé** ; perdu exige un motif ; l'historique (`lead_events`) est daté de la date d'insertion du fichier ; responsable par ligne (`ownerEmail`) ou par défaut |
| Import pilote | Fait | Bouton « Import pilote (50 premières lignes) » (`PILOT_SIZE`) quand le lot dépasse 50 lignes valides ; le lot reste « en cours » et le reste peut être importé ensuite sans doublon |
| Rapport d'anomalies | Fait | Avertissements par ligne (`warnings`) en plus des rejets et doublons ; CSV `anomalies-<fichier>.csv` (rejetée, doublon, importée avec avertissement) |
| Conservation de la source | Fait | Les cellules d'origine (`raw`) ne sont plus effacées à l'import : elles servent au rapprochement. Effacées à la **validation**, ou d'office après 90 jours (`purgeExpiredSources`, appelée par `/api/jobs/automations`) ; lot abandonné > 90 j → annulé |
| Rapprochement (sortie de phase) | Fait | `getReconciliation` : chaque ligne du fichier a un sort (importée + rejetée + doublon + en attente = total), chaque ligne importée retrouve sa fiche en base, et le chiffre d'affaires du fichier d'origine égale celui de la base. `validateBatch` exige une case de prise de connaissance du rapport d'anomalies, est auditée (`import.validated`) et efface la source |
| Téléphones déjà enregistrés | Fait | Section « Téléphones déjà enregistrés » de `/admin/import` : simulation (comptage sans écriture) puis normalisation réelle, auditée sans numéro (`phone.normalized`, compteurs seulement). **Non exécutée sur la base de développement** : à lancer sur demande |
| Tests | Fait | Unitaires (téléphone, valeurs, analyse, profil) et d'intégration sur `crm_test` (migration, import, rapprochement, purge, normalisation) ; `tsc`, lint et build réussis. Parcours vérifié dans le navigateur : dépôt, inventaire, analyse, correspondances, import, rapprochement (13 345 790 FCFA fichier = base), validation |

**Limites connues** : aucun vrai fichier source n'a été éprouvé (le parcours a été testé avec des fichiers de test) ; la table `SECTOR_ALIASES` doit être validée avec le métier. Les numéros à 8 chiffres exigent une table de préfixes par opérateur pour être migrés : en attendant ils sont signalés (rejet pour un prospect, où le téléphone est obligatoire ; avertissement pour un compte ou un contact). Les opportunités et activités ne sont pas migrées (seulement comptes, contacts, prospects). « 100 % = gagné » est une présomption à confirmer par le métier. Les données de démonstration existantes peuvent porter des téléphones à normaliser.

### Phase 8 — Recette utilisateur : préparée le 16/10/2026 (reste à exécuter avec le métier) — documents `crm/docs/RECETTE.md`, `crm/docs/RECETTE_SECURITE.md`, `crm/docs/recette/`

**Décisions prises avec l'utilisateur** : objectifs de reprise **RPO 24 h / RTO 4 h** ; environnement de recette = **base locale `crm_recette`** alimentée par un script d'anonymisation reproductible, serveur sur le port 3200. Pour la CSP, l'utilisateur avait retenu « stricte avec nonce » : **c'est inapplicable** (voir ci-dessous) et un compromis a été appliqué.

| Élément du plan | État | Détail |
|---|---|---|
| Environnement de recette | Fait | `npm run recette:init` / `recette:reset` / `recette:start` (`scripts/recette-env.mjs`) : crée la base, applique les migrations, charge `scripts/recette-seed.ts`. Jeu **fictif et déterministe** (graine fixe) : 11 utilisateurs, 190 comptes, 380 contacts, 280 opportunités, 160 prospects, 662 activités, 170 tâches, objectifs mensuels ; adresses `@recette.example`. Mots de passe générés dans `.recette-credentials` (ignoré par git) |
| Scénarios REC-01 à REC-12 + 7 parcours Excel | Partiel | `tests/unit/recette-traceability.test.ts` relie chaque scénario à des tests existants et **échoue si un test cité disparaît** ; `docs/RECETTE.md` donne aussi l'étape à exécuter à la main. **Non exécutés à la main par le métier.** REC-08 (calendrier) **non couvert** : la phase 5 était limitée aux e-mails. REC-07 n'a jamais été éprouvé contre Graph réel |
| Restauration (REC-12) | Fait | `npm run recette:restore-test` : `pg_dump` (format custom), `pg_restore` dans une base temporaire, comparaison table par table (lignes et empreintes d'identifiants), contraintes, migrations, journal d'audit toujours en ajout seul, comptes de connexion complets ; rapport daté dans `docs/recette/`. Premier essai : **conforme**, 4 694 lignes, restauration + contrôles en 1,5 s pour un objectif de 4 h. Mesuré sur la machine locale, pas sur l'hébergement cible |
| Audit de sécurité | Fait (interne) | OWASP Top 10 revu dans le code (`docs/RECETTE_SECURITE.md`) ; requêtes SQL brutes inspectées (5, toutes paramétrées) ; appels sortants (curseur Graph borné à `graph.microsoft.com`) ; fichiers d'import ; limitation de débit |
| Dépendances | Fait | `npm audit fix` : `prisma` 7.10.1, `mysql2` 3.24.x ; production : **0 vulnérabilité**. Restent 5 alertes hautes dans `eslint-config-next` (outil de lint) : le correctif proposé est un retour à la version 14, refusé |
| Limitation de débit | Corrigé | Le webhook Microsoft public n'en avait pas : 600 requêtes/min par IP, réponse 429 au-delà. Les autres points d'entrée étaient déjà protégés |
| En-têtes et CSP | Fait avec écart | CSP complète (`default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `base-uri`, `object-src 'none'`, `form-action`), figée par `tests/unit/security-headers.test.ts`. **`script-src` garde `'unsafe-inline'`** |
| Suivi des anomalies | Ouvert | Registre dans `docs/RECETTE.md` : A-02 et A-03 corrigées, A-01 écart accepté ; A-04 à A-07 ouvertes |

**Écart sur la CSP (A-01)** : un nonce impose un rendu 100 % dynamique et est incompatible avec le rendu partiel (`cacheComponents`) de l'application (documentation de Next 16). L'option SRI, essayée dans le navigateur en production, ne couvre pas les scripts en ligne de Next : la page ne s'hydrate plus. La CSP n'empêche donc pas un script injecté en ligne ; elle interdit tout chargement, connexion ou formulaire vers un autre hôte. La parade reste l'échappement de React (aucun `dangerouslySetInnerHTML`).

**Limites connues** : le procès-verbal n'est pas signé (modèle vierge) ; l'exécution manuelle des scénarios par un représentant métier reste à faire ; les graphiques n'ont pas été vérifiés visuellement après connexion sous la nouvelle CSP (A-06) ; le limiteur de débit est en mémoire (par instance) et se fie à `X-Forwarded-For` (le proxy de production doit l'écraser) ; la décompression d'un `.xlsx` très compressible n'est pas bornée (risque à éprouver) ; pas d'authentification multifacteur ; aucun test d'accessibilité ni d'intrusion externe.


---

## Annexe — Parcours Excel : synthèse des écrans à construire

| Feuille | Écran | Entrées / sorties clés | Règle de gestion |
|---|---|---|---|
| Parcours Utilisateur | Connexion | Login = e-mail ; mot de passe alphanumérique ; tous deux obligatoires | Format e-mail ; code alphanumérique |
| Parcours Tableau de bord | Tableau de bord | 5 KPI avec variation vs semaine passée ; camembert (transformation) ; histogramme 4 semaines (pipeline) | Nombre de RDV recalculé à chaque changement d'étape ou ajout (à clarifier, I6) |
| Reporting prospect | Liste + formulaire prospect | Entreprise, secteur, nom, prénom, téléphone, e-mail, fonction, date, process de vente, étape | Date ≤ aujourd'hui ; process > 40 % → prospect qualifié (I1) |
| Reporting prospect qualifié | Liste des qualifiés | Produit proposé, chiffre d'affaires | Process > 60 % → proposition envoyée **et** valeur du pipeline |
| Reporting proposition envoyée | Liste des offres | Process de vente | Process = 100 % → taux de transformation |
| Reporting taux de transformation | Affaires gagnées | (feuille inachevée) | À spécifier en phase 1 |
| Reporting valeur du pipeline | Offres à 80–90 % | Process de vente | Process = 100 % → taux de transformation |
