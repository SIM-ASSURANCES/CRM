import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests de l'import initial sur la base dédiée (TEST_DATABASE_URL, voir tests/setup.ts).
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("import initial CSV/XLSX (PostgreSQL)", () => {
  let db: Db;
  let imp: typeof import("@/features/imports/service");
  let admin: CurrentUser;
  let commercial: CurrentUser;
  let manager: CurrentUser;
  let direction: CurrentUser;
  let audit: CurrentUser;
  let owner: CurrentUser;

  const uniq = () => randomUUID().slice(0, 8);
  const csv = (text: string) => Buffer.from(text, "utf8");

  async function makeUser(role: Role, label: string): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: null, mustChangePassword: false };
  }

  const ACCOUNT_FILE = [
    "Raison sociale;RCCM;Secteur;Statut;Ville;Responsable",
    "Société Alpha;CI-ABJ-1;Santé;Client;Abidjan;",
    "Béta SARL;;Transport et logistique;Prospect;Bouaké;",
    "SOCIETE ALPHA;;Santé;Client;Abidjan;",
    "Gamma;CI-ABJ-3;Pêche;Client;Yamoussoukro;",
    "Delta;;Santé;VIP;;",
    ";;Santé;;;",
  ].join("\n");

  const accountMapping = { legalName: "Raison sociale", legalIdentifier: "RCCM", sector: "Secteur", status: "Statut", city: "Ville", ownerEmail: "Responsable" };
  const analyzeInput = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    mapping: accountMapping,
    defaults: { ownerUserId: owner.id },
    ...over,
  });

  async function uploadAccounts(text = ACCOUNT_FILE) {
    return (await imp.createBatch(admin, { entity: "accounts", filename: "comptes.csv", buffer: csv(text) })).id;
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    imp = await import("@/features/imports/service");
    admin = await makeUser("admin", "Admin Import");
    commercial = await makeUser("commercial", "Commercial Import");
    manager = await makeUser("manager", "Manager Import");
    direction = await makeUser("direction", "Direction Import");
    audit = await makeUser("audit", "Audit Import");
    owner = await makeUser("commercial", "Responsable par défaut");
  });

  beforeEach(async () => {
    await db.importRow.deleteMany();
    await db.importBatch.deleteMany();
    await db.activity.deleteMany();
    await db.task.deleteMany();
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
    await db.opportunityContact.deleteMany();
    await db.opportunityEvent.deleteMany();
    await db.opportunity.deleteMany();
    await db.contactRole.deleteMany();
    await db.accountContact.deleteMany();
    await db.contact.deleteMany();
    await db.crmAccount.updateMany({ data: { parentAccountId: null, mergedIntoId: null } });
    await db.crmAccount.deleteMany();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("droits", () => {
    it("réserve tout l'import à l'administrateur", async () => {
      for (const user of [commercial, manager, direction, audit]) {
        await expect(imp.createBatch(user, { entity: "accounts", filename: "x.csv", buffer: csv("A\n1") })).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(imp.listBatches(user)).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(imp.getBatch(user, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(imp.importBatch(user, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(imp.cancelBatch(user, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(imp.rejectsCsv(user, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await imp.listBatches(admin)).toEqual([]);
    });
  });

  describe("dépôt du fichier", () => {
    it("enregistre le lot et ses lignes sans toucher aux comptes, avec une trace d'audit", async () => {
      const before = await db.auditLog.count({ where: { action: "import.uploaded" } });
      const id = await uploadAccounts();

      const batch = await imp.getBatch(admin, id);
      expect(batch).toMatchObject({ entity: "accounts", filename: "comptes.csv", status: "uploaded", totalRows: 6, creatorName: "Admin Import" });
      expect(batch.headers).toEqual(["Raison sociale", "RCCM", "Secteur", "Statut", "Ville", "Responsable"]);
      expect(await db.importRow.count({ where: { batchId: id } })).toBe(6);
      expect(await db.crmAccount.count()).toBe(0);
      expect(await db.auditLog.count({ where: { action: "import.uploaded" } })).toBe(before + 1);
    });

    it("propose une association automatique des colonnes", async () => {
      const id = await uploadAccounts();
      const { suggestedMapping } = await imp.getBatch(admin, id);
      expect(suggestedMapping).toMatchObject({ legalName: "Raison sociale", legalIdentifier: "RCCM", sector: "Secteur", city: "Ville" });
    });

    it("refuse un type d'import inconnu et un fichier invalide", async () => {
      await expect(imp.createBatch(admin, { entity: "opportunities", filename: "x.csv", buffer: csv("A\n1") })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(imp.createBatch(admin, { entity: "accounts", filename: "x.pdf", buffer: csv("A\n1") })).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await db.importBatch.count()).toBe(0);
    });

    it("nettoie le nom du fichier (chemin et caractères de contrôle)", async () => {
      const { id } = await imp.createBatch(admin, { entity: "accounts", filename: "C:\\Users\\x\\comptes\u0007.csv", buffer: csv("Nom\nA") });
      expect((await imp.getBatch(admin, id)).filename).toBe("comptes.csv");
    });
  });

  describe("analyse", () => {
    it("refuse une association incomplète en désignant les champs manquants", async () => {
      const id = await uploadAccounts();
      await expect(imp.analyzeBatch(admin, analyzeInput(id, { mapping: { city: "Ville" } }))).rejects.toMatchObject({
        details: { fieldErrors: { mapping_legalName: expect.any(Array), mapping_sector: expect.any(Array) } },
      });
      expect((await imp.getBatch(admin, id)).status).toBe("uploaded");
    });

    it("refuse un responsable par défaut inconnu ou désactivé, et des valeurs par défaut inconnues", async () => {
      const id = await uploadAccounts();
      await expect(imp.analyzeBatch(admin, analyzeInput(id, { defaults: { ownerUserId: randomUUID() } }))).rejects.toMatchObject({
        details: { fieldErrors: { ownerUserId: expect.any(Array) } },
      });
      await expect(imp.analyzeBatch(admin, analyzeInput(id, { defaults: { ownerUserId: audit.id } }))).rejects.toMatchObject({
        details: { fieldErrors: { ownerUserId: expect.any(Array) } },
      });
      await expect(imp.analyzeBatch(admin, analyzeInput(id, { defaults: { ownerUserId: owner.id, sector: "Pêche" } }))).rejects.toMatchObject({
        details: { fieldErrors: { sector: expect.any(Array) } },
      });
    });

    it("produit le rapport de qualité : valides, rejets, doublons dans le fichier et en base, champs manquants", async () => {
      await db.crmAccount.create({ data: { legalName: "Béta SARL", sector: "Santé", status: "client", country: "CI", ownerUserId: owner.id } });
      const id = await uploadAccounts();

      const summary = await imp.analyzeBatch(admin, analyzeInput(id));
      // Valides : Alpha (ligne 2). Doublons : Béta (déjà en base, ligne 3) et SOCIETE ALPHA (même nom que la ligne 2).
      // Rejets : Gamma (secteur « Pêche »), Delta (statut « VIP »), ligne 7 (raison sociale vide).
      expect(summary).toMatchObject({ status: "analyzed", validRows: 1, rejectedRows: 3, duplicateRows: 2 });

      const batch = await imp.getBatch(admin, id);
      expect(batch.report).toMatchObject({ total: 6, valid: 1, rejected: 3, duplicatesInDatabase: 1, duplicatesInFile: 1 });
      expect(batch.report?.reasons.map((r) => r.reason)).toEqual(
        expect.arrayContaining([expect.stringContaining("Pêche"), expect.stringContaining("VIP")]),
      );
      expect(batch.report?.missing.map((entry) => entry.label)).toEqual(expect.arrayContaining(["Téléphone", "Effectif"]));
      expect(batch.problems.map((p) => [p.rowNumber, p.status])).toEqual([
        [3, "duplicate"],
        [4, "duplicate"],
        [5, "rejected"],
        [6, "rejected"],
        [7, "rejected"],
      ]);
      expect(batch.problems.find((p) => p.rowNumber === 3)?.messages[0]).toContain("Compte existant");
      expect(await db.crmAccount.count()).toBe(1);
    });

    it("peut être relancée avec une autre association tant que rien n'est importé", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));
      // On ajoute un secteur par défaut et on retire la colonne « Secteur » : les lignes sans secteur valide deviennent valides.
      const second = await imp.analyzeBatch(
        admin,
        analyzeInput(id, { mapping: { legalName: "Raison sociale", legalIdentifier: "RCCM", status: "Statut" }, defaults: { ownerUserId: owner.id, sector: "Santé" } }),
      );
      expect(second.validRows).toBe(3);
    });

    it("répond « introuvable » pour un lot inexistant", async () => {
      await expect(imp.analyzeBatch(admin, analyzeInput(randomUUID()))).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("import des comptes", () => {
    it("ne crée rien avant l'import, puis crée les comptes valides avec leur responsable", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));
      expect(await db.crmAccount.count()).toBe(0);

      const outcome = await imp.importBatch(admin, id);
      expect(outcome).toEqual({ imported: 2, failed: 0, remaining: 0 });

      const accounts = await db.crmAccount.findMany({ orderBy: { legalName: "asc" } });
      expect(accounts.map((a) => a.legalName)).toEqual(["Béta SARL", "Société Alpha"]);
      expect(accounts.find((a) => a.legalName === "Société Alpha")).toMatchObject({
        legalIdentifier: "CI-ABJ-1",
        sector: "Santé",
        status: "client",
        country: "CI",
        city: "Abidjan",
        ownerUserId: owner.id,
      });
    });

    it("trace chaque ligne importée, CONSERVE sa source pour le rapprochement et marque le lot comme importé", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));
      const auditBefore = await db.auditLog.count({ where: { action: "import.completed" } });
      await imp.importBatch(admin, id);

      const imported = await db.importRow.findMany({ where: { batchId: id, status: "imported" } });
      expect(imported).toHaveLength(2);
      for (const row of imported) {
        expect(row.createdEntityId).not.toBeNull();
        // La source reste en base jusqu'à la validation du lot (phase 7) : elle sert au rapprochement.
        expect((row.raw as string[]).length).toBeGreaterThan(0);
        expect(await db.crmAccount.findUnique({ where: { id: row.createdEntityId! } })).not.toBeNull();
      }
      const batch = await imp.getBatch(admin, id);
      expect(batch).toMatchObject({ status: "imported", importedRows: 2 });
      expect(batch.importedAt).not.toBeNull();
      expect(await db.auditLog.count({ where: { action: "import.completed" } })).toBe(auditBefore + 1);
    });

    it("affecte le responsable désigné par l'e-mail de la ligne", async () => {
      const text = ["Raison sociale;Secteur;Responsable", `Alpha;Santé;${commercial.email.toUpperCase()}`, "Béta;Santé;"].join("\n");
      const id = await uploadAccounts(text);
      await imp.analyzeBatch(admin, analyzeInput(id, { mapping: { legalName: "Raison sociale", sector: "Secteur", ownerEmail: "Responsable" } }));
      await imp.importBatch(admin, id);

      expect((await db.crmAccount.findFirstOrThrow({ where: { legalName: "Alpha" } })).ownerUserId).toBe(commercial.id);
      expect((await db.crmAccount.findFirstOrThrow({ where: { legalName: "Béta" } })).ownerUserId).toBe(owner.id);
    });

    it("refuse d'importer deux fois, ou un lot non analysé", async () => {
      const id = await uploadAccounts();
      await expect(imp.importBatch(admin, id)).rejects.toMatchObject({ code: "CONFLICT" });

      await imp.analyzeBatch(admin, analyzeInput(id));
      await imp.importBatch(admin, id);
      await expect(imp.importBatch(admin, id)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(imp.analyzeBatch(admin, analyzeInput(id))).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.crmAccount.count()).toBe(2);
    });

    it("rejette seulement la ligne en conflit quand un compte identique est créé après l'analyse", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));
      // Entre l'analyse et l'import, quelqu'un crée le même identifiant légal : la base le refuse pour cette ligne seule.
      await db.crmAccount.create({ data: { legalName: "Autre nom", legalIdentifier: "CI-ABJ-1", sector: "Santé", status: "client", country: "CI", ownerUserId: owner.id } });

      const outcome = await imp.importBatch(admin, id);
      expect(outcome).toEqual({ imported: 1, failed: 1, remaining: 0 });

      const conflicting = await db.importRow.findFirstOrThrow({ where: { batchId: id, rowNumber: 2 } });
      expect(conflicting.status).toBe("rejected");
      expect(conflicting.errors).toEqual([expect.stringContaining("Conflit à l'insertion")]);
      expect(await db.crmAccount.findFirst({ where: { legalName: "Béta SARL" } })).not.toBeNull();
      expect((await imp.getBatch(admin, id)).status).toBe("imported");
    });

    it("est reprenable : relancer l'import ne traite que les lignes restantes", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));
      // Simule une interruption : une ligne a déjà été importée, le lot est resté « importing ».
      const [first] = await db.importRow.findMany({ where: { batchId: id, status: "valid" }, orderBy: { rowNumber: "asc" } });
      await db.crmAccount.create({ data: { legalName: "Société Alpha", legalIdentifier: "CI-ABJ-1", sector: "Santé", status: "client", country: "CI", ownerUserId: owner.id } });
      await db.importRow.update({ where: { id: first.id }, data: { status: "imported", raw: [] } });
      await db.importBatch.update({ where: { id }, data: { status: "importing" } });

      expect(await imp.importBatch(admin, id)).toEqual({ imported: 2, failed: 0, remaining: 0 });
      expect(await db.crmAccount.count({ where: { legalName: "Société Alpha" } })).toBe(1);
      expect(await db.crmAccount.count()).toBe(2);
    });

    it("ne crée pas deux fois la même ligne si deux imports se chevauchent", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));

      await Promise.allSettled([imp.importBatch(admin, id), imp.importBatch(admin, id)]);
      expect(await db.crmAccount.count()).toBe(2);
      expect(await db.importRow.count({ where: { batchId: id, status: "imported" } })).toBe(2);
    });
  });

  describe("import des contacts", () => {
    async function importAccountsFirst() {
      const id = await uploadAccounts(["Raison sociale;Secteur", "Société Alpha;Santé", "Béta SARL;Santé"].join("\n"));
      await imp.analyzeBatch(admin, analyzeInput(id, { mapping: { legalName: "Raison sociale", sector: "Secteur" } }));
      await imp.importBatch(admin, id);
    }
    const contactMapping = { firstName: "Prénom", lastName: "Nom", accountRef: "Entreprise", email: "E-mail", jobTitle: "Fonction" };
    const uploadContacts = async (rows: string[]) =>
      (await imp.createBatch(admin, { entity: "contacts", filename: "contacts.csv", buffer: csv(["Prénom;Nom;Entreprise;E-mail;Fonction", ...rows].join("\n")) })).id;

    it("crée les contacts, les rattache à leur compte et désigne le premier comme contact principal", async () => {
      await importAccountsFirst();
      const id = await uploadContacts([
        "Awa;Koné;Société Alpha;awa@alpha.ci;Directrice financière",
        "Yao;Kouassi;société alpha;yao@alpha.ci;DG",
        "Fatou;Diabaté;Béta SARL;;Comptable",
      ]);
      await imp.analyzeBatch(admin, { id, mapping: contactMapping, defaults: { ownerUserId: owner.id } });
      expect(await imp.importBatch(admin, id)).toEqual({ imported: 3, failed: 0, remaining: 0 });

      const alpha = await db.crmAccount.findFirstOrThrow({ where: { legalName: "Société Alpha" } });
      const links = await db.accountContact.findMany({
        where: { accountId: alpha.id },
        include: { contact: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(links.map((l) => [l.contact.firstName, l.isPrimary, l.relationshipTitle])).toEqual([
        ["Awa", true, "Directrice financière"],
        ["Yao", false, "DG"],
      ]);
      expect(links[0].contact).toMatchObject({ status: "active", ownerUserId: owner.id, email: "awa@alpha.ci" });
    });

    it("rejette un contact dont le compte est introuvable et signale un contact déjà existant", async () => {
      await importAccountsFirst();
      const alpha = await db.crmAccount.findFirstOrThrow({ where: { legalName: "Société Alpha" } });
      const existing = await db.contact.create({ data: { firstName: "Awa", lastName: "Koné", email: "awa@alpha.ci", ownerUserId: owner.id } });
      await db.accountContact.create({ data: { accountId: alpha.id, contactId: existing.id } });

      const id = await uploadContacts(["Autre;Personne;Société Alpha;AWA@alpha.ci;DG", "Zoé;Test;Inconnue SA;;DG", "Neuf;Contact;Béta SARL;;DG"]);
      const summary = await imp.analyzeBatch(admin, { id, mapping: contactMapping, defaults: { ownerUserId: owner.id } });

      expect(summary).toMatchObject({ validRows: 1, rejectedRows: 1, duplicateRows: 1 });
      const { problems } = await imp.getBatch(admin, id);
      expect(problems.find((p) => p.rowNumber === 3)?.messages[0]).toContain("introuvable");
      expect(problems.find((p) => p.rowNumber === 2)?.messages[0]).toContain("même e-mail");
    });
  });

  describe("annulation et rejets", () => {
    it("annule un lot en supprimant immédiatement les lignes du fichier", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));

      await imp.cancelBatch(admin, id);
      expect((await imp.getBatch(admin, id)).status).toBe("cancelled");
      expect(await db.importRow.count({ where: { batchId: id } })).toBe(0);
      await expect(imp.importBatch(admin, id)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(imp.cancelBatch(admin, id)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.crmAccount.count()).toBe(0);
    });

    it("ne permet pas d'annuler un lot déjà importé", async () => {
      const id = await uploadAccounts();
      await imp.analyzeBatch(admin, analyzeInput(id));
      await imp.importBatch(admin, id);
      await expect(imp.cancelBatch(admin, id)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("exporte le rapport des rejets et doublons, journalise l'export et neutralise les formules", async () => {
      const text = ["Raison sociale;Secteur", "Alpha;Santé", "=CMD();Pêche", "alpha;Santé"].join("\n");
      const id = await uploadAccounts(text);
      await imp.analyzeBatch(admin, analyzeInput(id, { mapping: { legalName: "Raison sociale", sector: "Secteur" } }));
      const before = await db.auditLog.count({ where: { action: "import.rejects_exported" } });

      const { filename, csv: report } = await imp.rejectsCsv(admin, id);
      expect(filename).toBe("anomalies-comptes.csv");
      const lines = report.replace(/^\uFEFF/, "").trim().split("\r\n");
      expect(lines[0]).toBe("Ligne;Résultat;Motif;Raison sociale;Secteur");
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("Rejetée");
      expect(lines[1]).toContain("'=CMD()");
      expect(lines[2]).toContain("Doublon;Ligne 2 du fichier");
      expect(await db.auditLog.count({ where: { action: "import.rejects_exported" } })).toBe(before + 1);
    });
  });

  describe("contraintes en base", () => {
    it("refuse un type de lot, un statut de lot ou un statut de ligne invalide", async () => {
      const base = { filename: "x.csv", headers: [], totalRows: 0, createdByUserId: admin.id };
      await expect(db.importBatch.create({ data: { ...base, entity: "opportunities" } })).rejects.toThrow();
      await expect(db.importBatch.create({ data: { ...base, entity: "accounts", status: "bizarre" } })).rejects.toThrow();

      const batch = await db.importBatch.create({ data: { ...base, entity: "accounts" } });
      await expect(db.importRow.create({ data: { batchId: batch.id, rowNumber: 2, raw: [], status: "bizarre" } })).rejects.toThrow();
      await expect(db.importRow.create({ data: { batchId: batch.id, rowNumber: 1, raw: [] } })).rejects.toThrow();
    });

    it("supprime les lignes avec leur lot", async () => {
      const id = await uploadAccounts();
      await db.importBatch.delete({ where: { id } });
      expect(await db.importRow.count({ where: { batchId: id } })).toBe(0);
    });
  });
});
