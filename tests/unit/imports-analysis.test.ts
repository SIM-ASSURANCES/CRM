import { describe, expect, it } from "vitest";
import {
  analyzeAccounts,
  analyzeContacts,
  buildReport,
  cleanDomain,
  type AccountContext,
  type ContactContext,
  type SourceRow,
} from "@/features/imports/analysis";
import { accountNameKey, contactNameKey, identifierKey } from "@/features/imports/rules";

const OWNER = "00000000-0000-7000-8000-000000000001";
const OTHER_OWNER = "00000000-0000-7000-8000-000000000002";

describe("analyse d'un fichier de comptes", () => {
  const headers = ["Raison sociale", "Identifiant", "Secteur", "Statut", "Pays", "Effectif", "Tel", "Domaine", "Responsable"];
  const mapping = {
    legalName: "Raison sociale",
    legalIdentifier: "Identifiant",
    sector: "Secteur",
    status: "Statut",
    country: "Pays",
    employeeCount: "Effectif",
    phone: "Tel",
    emailDomain: "Domaine",
    ownerEmail: "Responsable",
  };
  const defaults = { ownerUserId: OWNER };
  const emptyContext = (over: Partial<AccountContext> = {}): AccountContext => ({
    owners: new Map([["commercial@crm.local", OTHER_OWNER]]),
    existingByIdentifier: new Map(),
    existingByName: new Map(),
    valueMap: {},
    ...over,
  });
  const row = (rowNumber: number, cells: Partial<Record<string, string>>): SourceRow => ({
    rowNumber,
    cells: headers.map((header) => cells[header] ?? ""),
  });
  const run = (rows: SourceRow[], ctx = emptyContext(), over: { ownerUserId: string; sector?: string } = defaults) =>
    analyzeAccounts(rows, headers, mapping, over, ctx);

  it("normalise les libellés saisis librement et les nombres des tableurs français", () => {
    const [result] = run([
      row(2, {
        "Raison sociale": "  Société Alpha ",
        Secteur: "sante",
        Statut: "CLIENT",
        Pays: "Côte d'Ivoire",
        Effectif: "1 250",
        Tel: "01 02 03 04 05",
        Domaine: "https://www.Alpha.ci/contact",
      }),
    ]).values();

    expect(result.status).toBe("valid");
    expect(result.parsed).toMatchObject({
      legalName: "Société Alpha",
      sector: "Santé",
      status: "client",
      country: "CI",
      employeeCount: 1250,
      phone: "+2250102030405",
      emailDomain: "alpha.ci",
      ownerUserId: OWNER,
    });
  });

  it("rejette une ligne en listant TOUS ses motifs, avec le nom lisible de chaque champ", () => {
    const [result] = run([row(2, { "Raison sociale": "", Secteur: "Pêche", Statut: "VIP", Tel: "abc", Pays: "Atlantide" })]).values();

    expect(result.status).toBe("rejected");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Secteur d'activité : « Pêche » n'est pas dans la liste du CRM.",
        expect.stringContaining("Statut : « VIP »"),
        expect.stringContaining("Pays : « Atlantide »"),
        expect.stringContaining("Raison sociale"),
      ]),
    );
    // Un téléphone illisible n'est plus un motif de rejet (champ facultatif) : il est ignoré et signalé en avertissement.
    expect(result.errors.some((error) => error.startsWith("Téléphone"))).toBe(false);
    expect(result.warnings).toEqual([expect.stringContaining("Téléphone : « abc » non importé")]);
    // Le secteur n'est pas signalé deux fois (une fois par la reconnaissance, une fois par le schéma).
    expect(result.errors.filter((error) => error.startsWith("Secteur"))).toHaveLength(1);
  });

  it("exige un secteur sauf si un secteur par défaut est choisi", () => {
    const rows = [row(2, { "Raison sociale": "Alpha" })];
    expect([...run(rows).values()][0].errors).toEqual(["Secteur d'activité : obligatoire (colonne vide et aucun secteur par défaut)."]);
    expect([...run(rows, emptyContext(), { ownerUserId: OWNER, sector: "Santé" }).values()][0].status).toBe("valid");
  });

  it("applique les valeurs par défaut du statut et du pays", () => {
    const [result] = run([row(2, { "Raison sociale": "Alpha", Secteur: "Santé" })]).values();
    expect(result.parsed).toMatchObject({ status: "prospect", country: "CI" });
  });

  it("rattache la ligne au responsable désigné par son e-mail, et rejette un responsable inconnu", () => {
    const [known, unknown] = run([
      row(2, { "Raison sociale": "Alpha", Secteur: "Santé", Responsable: "Commercial@CRM.local" }),
      row(3, { "Raison sociale": "Béta", Secteur: "Santé", Responsable: "inconnu@x.ci" }),
    ]).values();
    expect(known.parsed?.ownerUserId).toBe(OTHER_OWNER);
    expect(unknown.errors).toEqual(["Responsable : aucun utilisateur actif ne correspond à « inconnu@x.ci »."]);
  });

  it("détecte un doublon existant en base : par identifiant légal, puis par raison sociale sans accents", () => {
    const ctx = emptyContext({
      existingByIdentifier: new Map([[identifierKey("CI", "CI-ABJ-1"), "Alpha Existante"]]),
      existingByName: new Map([[accountNameKey("CI", "Société Béta"), "Société Béta"]]),
    });
    const [byId, byName, fresh] = run(
      [
        row(2, { "Raison sociale": "Autre nom", Identifiant: "ci-abj-1", Secteur: "Santé" }),
        row(3, { "Raison sociale": "SOCIETE BETA", Secteur: "Santé" }),
        row(4, { "Raison sociale": "Gamma", Secteur: "Santé" }),
      ],
      ctx,
    ).values();

    expect(byId).toMatchObject({ status: "duplicate", duplicateScope: "database" });
    expect(byId.duplicateOf).toContain("Alpha Existante");
    expect(byName).toMatchObject({ status: "duplicate", duplicateScope: "database" });
    expect(fresh.status).toBe("valid");
  });

  it("détecte les doublons à l'intérieur du fichier et renvoie à la première ligne", () => {
    const results = run([
      row(2, { "Raison sociale": "Alpha", Identifiant: "X1", Secteur: "Santé" }),
      row(3, { "Raison sociale": "Autre", Identifiant: "x1", Secteur: "Santé" }),
      row(4, { "Raison sociale": "ALPHA", Secteur: "Santé" }),
    ]);
    expect(results.get(2)?.status).toBe("valid");
    expect(results.get(3)).toMatchObject({ status: "duplicate", duplicateOf: "Ligne 2 du fichier", duplicateScope: "file" });
    expect(results.get(4)).toMatchObject({ status: "duplicate", duplicateOf: "Ligne 2 du fichier" });
  });

  it("ne traite pas comme doublon deux comptes de même nom dans des pays différents", () => {
    const results = run([
      row(2, { "Raison sociale": "Alpha", Secteur: "Santé", Pays: "CI" }),
      row(3, { "Raison sociale": "Alpha", Secteur: "Santé", Pays: "Sénégal" }),
    ]);
    expect([...results.values()].map((r) => r.status)).toEqual(["valid", "valid"]);
  });

  it("une ligne rejetée ne sert pas de référence : la ligne suivante de même nom reste valide", () => {
    const results = run([
      row(2, { "Raison sociale": "Alpha", Secteur: "Pêche" }),
      row(3, { "Raison sociale": "Alpha", Secteur: "Santé" }),
    ]);
    expect(results.get(2)?.status).toBe("rejected");
    expect(results.get(3)?.status).toBe("valid");
  });

  it("produit un rapport de qualité : rejets, doublons, champs manquants, colonnes ignorées", () => {
    const rows = [
      row(2, { "Raison sociale": "Alpha", Secteur: "Santé", Tel: "0102030405", Identifiant: "A1" }),
      row(3, { "Raison sociale": "Béta", Secteur: "Santé" }),
      row(4, { "Raison sociale": "Alpha", Secteur: "Santé" }),
      row(5, { "Raison sociale": "Gamma", Secteur: "Pêche" }),
      row(6, { "Raison sociale": "Delta", Secteur: "Pêche" }),
    ];
    const ctx = emptyContext({ existingByName: new Map([[accountNameKey("CI", "Béta"), "Béta"]]) });
    const report = buildReport("accounts", run(rows, ctx).values(), headers, { ...mapping, ownerEmail: "", emailDomain: "" });

    expect(report).toMatchObject({ total: 5, valid: 1, rejected: 2, duplicatesInDatabase: 1, duplicatesInFile: 1 });
    expect(report.reasons[0]).toEqual({ reason: "Secteur d'activité : « Pêche » n'est pas dans la liste du CRM.", count: 2 });
    // Parmi l'unique ligne valide (Alpha), le téléphone et l'identifiant sont renseignés ; la ville, le domaine, etc. non.
    const missing = Object.fromEntries(report.missing.map((entry) => [entry.label, entry.count]));
    expect(missing).toMatchObject({ Ville: 1, "Domaine e-mail": 1, Effectif: 1 });
    expect(missing["Téléphone"]).toBeUndefined();
    expect(missing["Identifiant légal"]).toBeUndefined();
    expect(report.unmappedHeaders).toEqual(["Domaine", "Responsable"]);
  });
});

describe("nettoyage d'un domaine", () => {
  it("extrait le domaine d'une adresse, d'une URL ou d'un texte", () => {
    expect(cleanDomain("https://www.Client.ci/contact?x=1")).toBe("client.ci");
    expect(cleanDomain("marie@Client.CI")).toBe("client.ci");
    expect(cleanDomain("  client.ci ")).toBe("client.ci");
    expect(cleanDomain("http://client.ci")).toBe("client.ci");
  });
});

describe("analyse d'un fichier de contacts", () => {
  const headers = ["Prénom", "Nom", "Entreprise", "Fonction", "E-mail", "Tel"];
  const mapping = { firstName: "Prénom", lastName: "Nom", accountRef: "Entreprise", jobTitle: "Fonction", email: "E-mail", phone: "Tel" };
  const defaults = { ownerUserId: OWNER };
  const alpha = { id: "a1", name: "Société Alpha" };
  const beta = { id: "b1", name: "Béta" };
  const ctx = (over: Partial<ContactContext> = {}): ContactContext => ({
    owners: new Map(),
    accountsByIdentifier: new Map([["ci-abj-1", [alpha]]]),
    accountsByName: new Map([
      ["societealpha", [alpha]],
      ["beta", [beta]],
      ["homonyme", [{ id: "h1", name: "Homonyme" }, { id: "h2", name: "Homonyme" }]],
    ]),
    existingContactsByEmail: new Map(),
    existingContactsByName: new Map(),
    ...over,
  });
  const row = (rowNumber: number, cells: Partial<Record<string, string>>): SourceRow => ({
    rowNumber,
    cells: headers.map((header) => cells[header] ?? ""),
  });
  const run = (rows: SourceRow[], context = ctx()) => analyzeContacts(rows, headers, mapping, defaults, context);

  it("rattache le contact à son compte par raison sociale (sans accents) ou par identifiant légal", () => {
    const [byName, byId] = run([
      row(2, { Prénom: "Awa", Nom: "Koné", Entreprise: "SOCIETE ALPHA" }),
      row(3, { Prénom: "Yao", Nom: "Kouassi", Entreprise: "CI-ABJ-1" }),
    ]).values();
    expect(byName.parsed).toMatchObject({ accountId: "a1", firstName: "Awa", status: "active", ownerUserId: OWNER });
    expect(byId.parsed).toMatchObject({ accountId: "a1" });
  });

  it("rejette un compte introuvable, ambigu ou absent", () => {
    const [missing, ambiguous, empty] = run([
      row(2, { Prénom: "A", Nom: "B", Entreprise: "Inconnue SA" }),
      row(3, { Prénom: "C", Nom: "D", Entreprise: "Homonyme" }),
      row(4, { Prénom: "E", Nom: "F", Entreprise: "" }),
    ]).values();
    expect(missing.errors[0]).toContain("est introuvable (importez d'abord les comptes)");
    expect(ambiguous.errors[0]).toContain("plusieurs comptes");
    expect(empty.errors).toEqual(["Compte : obligatoire (colonne vide)."]);
  });

  it("valide prénom, nom, e-mail et téléphone avec les règles des formulaires", () => {
    const [result] = run([row(2, { Prénom: "", Nom: "Koné", Entreprise: "Béta", "E-mail": "pas-un-mail", Tel: "12" })]).values();
    expect(result.status).toBe("rejected");
    // Prénom manquant et e-mail invalide rejettent la ligne ; le téléphone « 12 » (facultatif) est seulement signalé.
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.warnings).toEqual([expect.stringContaining("Téléphone : « 12 » non importé")]);
  });

  it("détecte un doublon par e-mail (base et fichier) ou par nom dans le même compte", () => {
    const context = ctx({
      existingContactsByEmail: new Map([["awa@alpha.ci", "Awa Koné"]]),
      existingContactsByName: new Map([[contactNameKey("b1", "Yao", "Kouassi"), "Yao Kouassi"]]),
    });
    const results = run(
      [
        row(2, { Prénom: "Autre", Nom: "Personne", Entreprise: "Société Alpha", "E-mail": "AWA@alpha.ci" }),
        row(3, { Prénom: "yao", Nom: "KOUASSI", Entreprise: "Béta" }),
        row(4, { Prénom: "Nouveau", Nom: "Contact", Entreprise: "Béta", "E-mail": "n@beta.ci" }),
        row(5, { Prénom: "Copie", Nom: "Contact", Entreprise: "Béta", "E-mail": "N@beta.ci" }),
        row(6, { Prénom: "Nouveau", Nom: "Contact", Entreprise: "Béta" }),
      ],
      context,
    );
    expect(results.get(2)).toMatchObject({ status: "duplicate", duplicateScope: "database" });
    expect(results.get(3)).toMatchObject({ status: "duplicate", duplicateScope: "database" });
    expect(results.get(4)?.status).toBe("valid");
    expect(results.get(5)).toMatchObject({ status: "duplicate", duplicateOf: "Ligne 4 du fichier" });
    expect(results.get(6)).toMatchObject({ status: "duplicate", duplicateOf: "Ligne 4 du fichier" });
  });

  it("accepte deux homonymes dans des comptes différents", () => {
    const results = run([
      row(2, { Prénom: "Awa", Nom: "Koné", Entreprise: "Société Alpha" }),
      row(3, { Prénom: "Awa", Nom: "Koné", Entreprise: "Béta" }),
    ]);
    expect([...results.values()].map((r) => r.status)).toEqual(["valid", "valid"]);
  });
});
