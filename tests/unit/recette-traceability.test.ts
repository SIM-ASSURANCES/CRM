import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Traçabilité de la RECETTE (phase 8) : chaque scénario du cahier des charges (REC-01 à REC-12, CDC §15) et chaque
// parcours du classeur Excel renvoie à des tests automatisés EXISTANTS. Ce test échoue si un test cité est renommé ou
// supprimé, ou si `docs/RECETTE.md` oublie un scénario : la matrice ne peut pas mentir en silence.

type Ref = { file: string; title: string };
type Scenario = {
  id: string;
  label: string;
  /** automated : couvert par des tests ; manual : étape à exécuter à la main ; not_covered : hors périmètre livré. */
  status: "automated" | "manual" | "not_covered";
  tests: Ref[];
  /** Pour `manual` et `not_covered` : l'explication, dont le début doit figurer dans docs/RECETTE.md. */
  note?: string;
};

const I = "tests/integration/";
const U = "tests/unit/";

const REC: Scenario[] = [
  {
    id: "REC-01",
    label: "Créer un compte avec les champs obligatoires",
    status: "automated",
    tests: [{ file: `${I}accounts-service.test.ts`, title: "rattache le compte à son créateur" }],
  },
  {
    id: "REC-02",
    label: "Créer un doublon de compte",
    status: "automated",
    tests: [
      { file: `${I}accounts-service.test.ts`, title: "détecte une raison sociale, un domaine e-mail ou un téléphone déjà connus" },
      { file: `${I}accounts-service.test.ts`, title: "accepte la création si l'utilisateur confirme que ce n'est pas un doublon" },
      { file: `${I}leads-service.test.ts`, title: "détecte un doublon (REC-02)" },
    ],
  },
  {
    id: "REC-03",
    label: "Associer plusieurs contacts à un compte",
    status: "automated",
    tests: [{ file: `${I}accounts-service.test.ts`, title: "contacts multi-comptes et rôles d'achat (REC-03)" }],
  },
  {
    id: "REC-04",
    label: "Déplacer une opportunité dans le pipeline",
    status: "automated",
    tests: [
      { file: `${I}opportunities-service.test.ts`, title: "exige la confirmation du critère pour avancer, historise et incrémente la version" },
      { file: `${I}leads-service.test.ts`, title: "historise le changement d'étape (REC-04)" },
    ],
  },
  {
    id: "REC-05",
    label: "Clôturer une opportunité en perte sans motif",
    status: "automated",
    tests: [
      { file: `${I}opportunities-service.test.ts`, title: "clôture en perte avec un motif" },
      { file: `${I}leads-service.test.ts`, title: "marque un prospect perdu avec son motif" },
      { file: `${U}leads-schemas.test.ts`, title: "exige un motif de perte" },
    ],
  },
  {
    id: "REC-06",
    label: "Laisser un grand compte sans activité au-delà du seuil",
    status: "automated",
    tests: [
      { file: `${I}automations-service.test.ts`, title: "applique un seuil par segment : 15 jours pour un grand compte, 30 pour les autres" },
      { file: `${I}automations-service.test.ts`, title: "est idempotent : une tâche par compte et par période" },
    ],
  },
  {
    id: "REC-07",
    label: "Synchroniser un e-mail correspondant à un contact",
    status: "automated",
    tests: [
      { file: `${I}integrations-service.test.ts`, title: "crée une activité « e-mail » pour un message reçu d'un contact connu" },
      { file: `${I}integrations-service.test.ts`, title: "est idempotente : relire les mêmes messages ne crée rien de plus" },
    ],
  },
  {
    id: "REC-08",
    label: "Créer / modifier un rendez-vous dans le calendrier",
    status: "not_covered",
    tests: [],
    note: "Non couvert : la synchronisation du calendrier n'a pas été livrée (décision de la phase 5 : e-mails seulement, en lecture seule).",
  },
  {
    id: "REC-09",
    label: "Consulter un compte non autorisé",
    status: "automated",
    tests: [
      { file: `${I}accounts-service.test.ts`, title: "laisse un manager voir les comptes de son équipe" },
      { file: `${I}leads-service.test.ts`, title: "présente le prospect d'un autre commercial comme introuvable" },
      { file: `${I}opportunities-service.test.ts`, title: "présente l'opportunité d'un autre commercial comme introuvable" },
      { file: `${I}users-service.test.ts`, title: "refuse toute opération d'administration à un non-administrateur" },
    ],
  },
  {
    id: "REC-10",
    label: "Comparer KPI et export",
    status: "automated",
    tests: [{ file: `${I}reporting-service.test.ts`, title: "exports (CDC 8.3) et cohérence écran / export (REC-10)" }],
  },
  {
    id: "REC-11",
    label: "Déconnecter une intégration",
    status: "automated",
    tests: [
      { file: `${I}integrations-service.test.ts`, title: "la déconnexion efface les jetons" },
      { file: `${I}integrations-service.test.ts`, title: "passe la connexion à « À reconnecter » quand Microsoft révoque l'accès" },
      { file: `${I}integrations-service.test.ts`, title: "vue d'ensemble (REC-11)" },
    ],
  },
  {
    id: "REC-12",
    label: "Restaurer une sauvegarde en recette",
    status: "manual",
    tests: [],
    note: "Procédure scriptée : npm run recette:restore-test (rapport daté dans docs/recette/). Objectifs RPO 24 h, RTO 4 h.",
  },
];

const EXCEL: Scenario[] = [
  {
    id: "Parcours 1 — Connexion",
    label: "Login = e-mail ; mot de passe alphanumérique",
    status: "automated",
    tests: [
      { file: `${U}password-policy.test.ts`, title: "exige des lettres ET des chiffres" },
      { file: `${I}users-service.test.ts`, title: "crée un compte avec un mot de passe temporaire qui permet de se connecter" },
    ],
  },
  {
    id: "Parcours 2 — Tableau de bord",
    label: "5 KPI avec variation vs semaine passée",
    status: "automated",
    tests: [
      { file: `${U}kpi-math.test.ts`, title: "calcule la variation par rapport à la période PRÉCÉDENTE" },
      { file: `${I}leads-service.test.ts`, title: "compte les nouveaux prospects et signale" },
    ],
  },
  {
    id: "Parcours 3 — Saisie d'un prospect",
    label: "Date ≤ aujourd'hui ; seuil de qualification",
    status: "automated",
    tests: [
      { file: `${U}leads-schemas.test.ts`, title: "n'accepte que la date du jour : ni une date passée, ni une date future" },
      { file: `${U}leads-rules.test.ts`, title: "jusqu'au seuil de qualification" },
    ],
  },
  {
    id: "Parcours 4 — Prospect qualifié",
    label: "Produit proposé et chiffre d'affaires obligatoires au-delà du seuil",
    status: "automated",
    tests: [
      { file: `${U}leads-views.test.ts`, title: "place un prospect à 60 % dans « Prospects qualifiés »" },
      { file: `${U}leads-rules.test.ts`, title: "exige le produit ET le chiffre d'affaires au-delà du seuil" },
    ],
  },
  {
    id: "Parcours 5 — Proposition envoyée",
    label: "Écran des offres et comptage hebdomadaire",
    status: "automated",
    tests: [
      { file: `${I}leads-service.test.ts`, title: "compte les propositions envoyées de chaque semaine" },
      { file: `${U}leads-views.test.ts`, title: "répartit chaque prospect ouvert dans exactement un écran principal" },
    ],
  },
  {
    id: "Parcours 6 — Taux de transformation",
    label: "Affaires gagnées / clôturées",
    status: "automated",
    tests: [
      { file: `${I}leads-service.test.ts`, title: "calcule le taux de transformation" },
      { file: `${U}leads-views.test.ts`, title: "place une affaire gagnée uniquement dans « Taux de transformation »" },
    ],
  },
  {
    id: "Parcours 7 — Valeur du pipeline",
    label: "Offres à 80–90 % et valeur reconstituée à une date",
    status: "automated",
    tests: [{ file: `${I}leads-service.test.ts`, title: "reconstitue la valeur du pipeline à la fin de la semaine précédente" }],
  },
];

const read = (file: string) => readFileSync(file, "utf8");
const doc = existsSync("docs/RECETTE.md") ? read("docs/RECETTE.md") : "";

describe("traçabilité de la recette (CDC §15)", () => {
  it("couvre exactement REC-01 à REC-12", () => {
    expect(REC.map((s) => s.id)).toEqual(Array.from({ length: 12 }, (_, i) => `REC-${String(i + 1).padStart(2, "0")}`));
  });

  it.each([...REC, ...EXCEL].flatMap((s) => s.tests.map((t) => [s.id, t.file, t.title] as const)))(
    "%s — le test cité existe (%s) : %s",
    (_id, file, title) => {
      expect(existsSync(file), `${file} est introuvable`).toBe(true);
      expect(read(file), `« ${title} » est introuvable dans ${file}`).toContain(title);
    },
  );

  it("chaque scénario automatisé cite au moins un test", () => {
    for (const s of [...REC, ...EXCEL].filter((s) => s.status === "automated")) {
      expect(s.tests.length, `${s.id} n'a aucun test`).toBeGreaterThan(0);
    }
  });

  it("REC-08 est explicitement signalé comme non couvert", () => {
    const rec08 = REC.find((s) => s.id === "REC-08")!;
    expect(rec08.status).toBe("not_covered");
    expect(rec08.tests).toHaveLength(0);
  });

  it("REC-12 s'appuie sur un script de restauration qui existe", () => {
    expect(existsSync("scripts/restore-test.mjs")).toBe(true);
    expect(JSON.parse(read("package.json")).scripts["recette:restore-test"]).toContain("restore-test.mjs");
  });
});

describe("docs/RECETTE.md", () => {
  it("existe", () => {
    expect(existsSync("docs/RECETTE.md")).toBe(true);
  });

  it.each([...REC, ...EXCEL].map((s) => [s.id] as const))("mentionne %s", (id) => {
    expect(doc).toContain(id);
  });

  it("reprend les explications des scénarios manuels et non couverts", () => {
    for (const s of [...REC, ...EXCEL].filter((s) => s.note)) {
      expect(doc, `la note de ${s.id} manque dans docs/RECETTE.md`).toContain(s.note!.split(":")[0]);
    }
  });

  it("contient le modèle de procès-verbal laissé vierge", () => {
    expect(doc).toContain("Procès-verbal de recette");
    expect(doc).toContain("Représentant métier");
    expect(doc).toContain("Responsable technique");
  });
});
