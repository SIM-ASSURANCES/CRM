import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";
import { parseCsv } from "@/lib/csv";

// Migration de données (phase 7) sur la base dédiée (TEST_DATABASE_URL) : prospects, valeurs à rapprocher, import pilote,
// rapprochement avec la source, validation, purge d'office et normalisation des téléphones déjà en base.
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("migration de données (PostgreSQL)", () => {
  let db: Db;
  let imp: typeof import("@/features/imports/service");
  let mig: typeof import("@/features/imports/migration");
  let admin: CurrentUser;
  let commercial: CurrentUser;
  let owner: CurrentUser;
  let productAuto: { id: string; code: string };
  let productMaison: { id: string; code: string };
  let productMaisonPlus: { id: string; code: string };

  const uniq = () => randomUUID().slice(0, 8);
  const csv = (rows: string[]) => Buffer.from(rows.join("\n"), "utf8");

  /** « JJ/MM/AAAA » d'il y a n jours : les dates du fichier ne sont jamais postérieures à aujourd'hui. */
  const daysAgo = (days: number) => {
    const date = new Date(Date.now() - days * 86_400_000);
    return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
  };
  const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  async function makeUser(role: Role, label: string): Promise<CurrentUser> {
    const user = await db.user.create({ data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, emailVerified: true } });
    return { id: user.id, name: user.name, email: user.email, role, teamId: null, mustChangePassword: false };
  }

  const LEAD_HEADER = "Entreprise;Secteur;Nom;Prénom;Téléphone;E-mail;Fonction;Date;Process;Produit;CA;Statut;Motif";
  const leadMapping = {
    companyName: "Entreprise",
    sector: "Secteur",
    contactLastName: "Nom",
    contactFirstName: "Prénom",
    phone: "Téléphone",
    email: "E-mail",
    jobTitle: "Fonction",
    insertedOn: "Date",
    progress: "Process",
    productName: "Produit",
    expectedRevenue: "CA",
    status: "Statut",
    lossReason: "Motif",
  };

  // Numéro de ligne du tableur = rang + 1 (la ligne 1 est l'en-tête) : Alpha = 2, Béta = 3, … Iota = 11.
  const leadFile = () =>
    csv([
      LEAD_HEADER,
      `Alpha SA;Assurances;Koné;Awa;01 02 03 04 05;awa@alpha.ci;DG;${daysAgo(5)};40 %;Test Auto;6 245 790;;`, // 2 : valide
      `Béta SARL;Santé;Traoré;Moussa;07 35 36 73;moussa@beta.ci;DAF;${daysAgo(6)};20;;;;`, // 3 : numéro à 8 chiffres
      `Gamma;Vente de bijoux;Diallo;Fatou;0505050505;fatou@gamma.ci;CEO;${daysAgo(7)};60;Test Maison+;1 200 000;;`, // 4 : secteur inconnu
      `Delta;Santé;Yao;Paul;0707070707;paul@delta.ci;RH;${daysAgo(8)};80;Assurance inconnue;900 000;;`, // 5 : produit inconnu
      `Epsilon;BTP;Kouadio;Jean;+225 01 11 11 11 11;jean@epsilon.ci;DG;${daysAgo(9)};100;Test Maison;5 000 000;;`, // 6 : gagné
      `Zeta;Santé;Bamba;Aïcha;0102030405;aicha@zeta.ci;DG;${daysAgo(10)};40;;;Perdu;Prix`, // 7 : perdu
      `Alpha SA bis;Santé;Koné;Awa;0102030405;AWA@alpha.ci;DG;${daysAgo(11)};20;;;;`, // 8 : doublon (e-mail)
      `Eta;Santé;Sylla;Ali;0102030406;ali@eta.ci;DG;31/02/2026;20;;;;`, // 9 : date impossible
      `Theta;Santé;Soro;Lou;0102030407;lou@theta.ci;DG;01/01/2099;20;;;;`, // 10 : date future
      `Iota;Santé;Ouattara;Sam;abc;sam@iota.ci;DG;${daysAgo(12)};20;;;;`, // 11 : téléphone illisible
    ]);

  async function uploadLeads() {
    return (await imp.createBatch(admin, { entity: "leads", filename: "prospects.csv", buffer: leadFile() })).id;
  }
  const analyzeLeads = (id: string, valueMap?: Record<string, Record<string, string>>) =>
    imp.analyzeBatch(admin, { id, mapping: leadMapping, defaults: { ownerUserId: owner.id }, ...(valueMap ? { valueMap } : {}) });

  /** Table de correspondance qui rend valides les lignes 4 (secteur) et 5 (produit). */
  const FULL_MAP = () => ({ sector: { ventedebijoux: "Commerce et distribution" }, product: { assuranceinconnue: productAuto.code } });

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    imp = await import("@/features/imports/service");
    mig = await import("@/features/imports/migration");
    admin = await makeUser("admin", "Admin Migration");
    commercial = await makeUser("commercial", "Commercial Migration");
    owner = await makeUser("commercial", "Responsable migration");
    productAuto = await db.product.create({ data: { code: `mig-auto-${uniq()}`, label: "Test Auto" }, select: { id: true, code: true } });
    productMaison = await db.product.create({ data: { code: `mig-maison-${uniq()}`, label: "Test Maison" }, select: { id: true, code: true } });
    productMaisonPlus = await db.product.create({ data: { code: `mig-maison-plus-${uniq()}`, label: "Test Maison+" }, select: { id: true, code: true } });
  });

  beforeEach(async () => {
    await db.importRow.deleteMany();
    await db.importBatch.deleteMany();
    await db.setting.deleteMany({ where: { key: "leads.thresholds" } });
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
    await db?.importRow.deleteMany();
    await db?.importBatch.deleteMany();
    await db?.leadEvent.deleteMany();
    await db?.lead.deleteMany();
    await db?.product.deleteMany({ where: { id: { in: [productAuto.id, productMaison.id, productMaisonPlus.id] } } });
    await db?.$disconnect();
  });

  describe("inventaire de la source", () => {
    it("calcule volumes, remplissage et types probables dès le dépôt", async () => {
      const batch = await imp.getBatch(admin, await uploadLeads());
      expect(batch.profile?.rows).toBe(10);
      const byHeader = Object.fromEntries((batch.profile?.columns ?? []).map((column) => [column.header, column]));
      expect(byHeader["E-mail"]).toMatchObject({ kind: "email" });
      expect(byHeader.Date.kind).not.toBe("empty");
      expect(byHeader.Secteur.top.map((entry) => entry.value)).toContain("Santé");
      expect(byHeader.Statut).toMatchObject({ filled: 1 });
    });
  });

  describe("prospects : analyse", () => {
    it("normalise, rejette avec le motif précis et signale les valeurs à rapprocher", async () => {
      const id = await uploadLeads();
      const summary = await analyzeLeads(id);
      expect(summary).toMatchObject({ totalRows: 10, validRows: 3, rejectedRows: 6, duplicateRows: 1 });

      const batch = await imp.getBatch(admin, id);
      const messages = (rowNumber: number) => batch.problems.find((problem) => problem.rowNumber === rowNumber)?.messages.join(" | ") ?? "";
      expect(messages(3)).toContain("antérieur à 2021");
      expect(messages(4)).toContain("Vente de bijoux");
      expect(messages(5)).toContain("Assurance inconnue");
      expect(messages(9)).toContain("n'est pas une date reconnue");
      expect(messages(10)).toContain("postérieure à la date du jour");
      expect(messages(11)).toContain("10 chiffres");
      expect(batch.problems.find((problem) => problem.rowNumber === 8)).toMatchObject({ status: "duplicate" });

      expect(batch.report?.unrecognized).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "sector", value: "Vente de bijoux", count: 1 }),
          expect.objectContaining({ field: "product", value: "Assurance inconnue", count: 1 }),
        ]),
      );
    });

    it("rapproche les valeurs inconnues par la table de correspondance du lot, puis les ré-analyse", async () => {
      const id = await uploadLeads();
      await analyzeLeads(id);
      const summary = await analyzeLeads(id, FULL_MAP());
      expect(summary).toMatchObject({ validRows: 5, rejectedRows: 4, duplicateRows: 1 });

      const batch = await imp.getBatch(admin, id);
      expect(batch.valueMap).toEqual(FULL_MAP());
      // La table est mémorisée : une ré-analyse sans la renvoyer la conserve.
      expect((await analyzeLeads(id)).validRows).toBe(5);
    });

    it("refuse une correspondance vers une valeur qui n'existe pas dans le CRM", async () => {
      const id = await uploadLeads();
      await expect(analyzeLeads(id, { sector: { ventedebijoux: "Secteur inventé" } })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(analyzeLeads(id, { product: { assuranceinconnue: "code-inexistant" } })).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("distingue SECUR Maison de SECUR Maison+ et reprend un prospect à 100 % comme gagné", async () => {
      const id = await uploadLeads();
      await analyzeLeads(id, FULL_MAP());
      await imp.importBatch(admin, id);

      const gamma = await db.lead.findFirstOrThrow({ where: { companyName: "Gamma" } });
      expect(gamma.productId).toBe(productMaisonPlus.id);
      const epsilon = await db.lead.findFirstOrThrow({ where: { companyName: "Epsilon" }, include: { events: true } });
      expect(epsilon).toMatchObject({ productId: productMaison.id, progress: 100, status: "won", sector: "BTP et immobilier" });
      expect(epsilon.closedAt).not.toBeNull();
      expect(epsilon.events).toHaveLength(1);
      expect(epsilon.events[0]).toMatchObject({ type: "won", toProgress: 100, status: "won" });
    });
  });

  describe("prospects : import pilote et historique", () => {
    it("importe d'abord un pilote, puis le reste ; les prospects gardent leur date d'origine", async () => {
      const id = await uploadLeads();
      await analyzeLeads(id, FULL_MAP());

      const pilot = await imp.importBatch(admin, id, { limit: 2 });
      expect(pilot).toEqual({ imported: 2, failed: 0, remaining: 3 });
      expect(await db.lead.count()).toBe(2);
      expect((await imp.getBatch(admin, id)).status).toBe("importing");
      // Un lot en cours de pilote n'est pas rapprochable.
      expect((await mig.getReconciliation(admin, id)).ready).toBe(false);

      const rest = await imp.importBatch(admin, id);
      expect(rest).toEqual({ imported: 5, failed: 0, remaining: 0 });
      expect((await imp.getBatch(admin, id)).status).toBe("imported");

      const alpha = await db.lead.findFirstOrThrow({ where: { companyName: "Alpha SA" }, include: { events: true } });
      expect(alpha).toMatchObject({ phone: "+2250102030405", email: "awa@alpha.ci", sector: "Assurance", progress: 40, status: "open", ownerUserId: owner.id });
      expect(alpha.expectedRevenue?.toNumber()).toBe(6_245_790);
      expect(alpha.insertedOn.toISOString().slice(0, 10)).toBe(isoDaysAgo(5));
      // L'historique est daté de la date d'insertion d'origine, pas d'aujourd'hui (sinon les KPI « cette semaine » explosent).
      expect(alpha.events[0].occurredAt.toISOString().slice(0, 10)).toBe(isoDaysAgo(5));
      expect(alpha.events[0]).toMatchObject({ type: "created", actorUserId: admin.id });

      const zeta = await db.lead.findFirstOrThrow({ where: { companyName: "Zeta" } });
      expect(zeta).toMatchObject({ status: "lost", lossReason: "price", progress: 40 });
    });

    it("refuse un import hors lot analysé et ne ré-importe jamais une ligne", async () => {
      const id = await uploadLeads();
      await expect(imp.importBatch(admin, id, { limit: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
      await analyzeLeads(id);
      await imp.importBatch(admin, id, { limit: 1 });
      await imp.importBatch(admin, id, { limit: 1 });
      await imp.importBatch(admin, id);
      expect(await db.lead.count()).toBe(3);
    });
  });

  describe("rapprochement et validation", () => {
    async function importedLeadBatch() {
      const id = await uploadLeads();
      await analyzeLeads(id, FULL_MAP());
      await imp.importBatch(admin, id);
      return id;
    }

    it("rapproche le fichier d'origine, le sort de chaque ligne et la base", async () => {
      const id = await importedLeadBatch();
      const result = await mig.getReconciliation(admin, id);

      expect(result.counts).toEqual({ imported: 5, rejected: 4, duplicates: 1, pending: 0, withWarnings: 0 });
      expect(result.sourceRows).toBe(10);
      expect(result.checks.every((check) => check.ok)).toBe(true);
      expect(result.ready).toBe(true);
      expect(result.sourceAvailable).toBe(true);
      // 6 245 790 + 1 200 000 + 900 000 + 5 000 000 : relu dans le fichier brut, puis en base.
      expect(result.amounts).toMatchObject({ imported: 13_345_790, inCrm: 13_345_790 });
    });

    it("DÉTECTE une valeur altérée en base après l'import et refuse alors la validation", async () => {
      const id = await importedLeadBatch();
      await db.lead.updateMany({ where: { companyName: "Alpha SA" }, data: { expectedRevenue: 7_000_000 } });

      const result = await mig.getReconciliation(admin, id);
      expect(result.ready).toBe(false);
      expect(result.checks.find((check) => check.label.startsWith("Montants"))).toMatchObject({ ok: false });
      await expect(mig.validateBatch(admin, id, { acknowledged: true })).rejects.toMatchObject({ code: "VALIDATION" });
      expect((await imp.getBatch(admin, id)).status).toBe("imported");
    });

    it("DÉTECTE une fiche supprimée après l'import", async () => {
      const id = await importedLeadBatch();
      const lead = await db.lead.findFirstOrThrow({ where: { companyName: "Epsilon" } });
      await db.leadEvent.deleteMany({ where: { leadId: lead.id } });
      await db.lead.delete({ where: { id: lead.id } });

      const result = await mig.getReconciliation(admin, id);
      expect(result.ready).toBe(false);
      expect(result.checks.find((check) => check.label.startsWith("Chaque ligne importée"))).toMatchObject({ ok: false });
    });

    it("exige la confirmation du rapport d'anomalies, puis efface la source et trace la validation", async () => {
      const id = await importedLeadBatch();
      await expect(mig.validateBatch(admin, id, { acknowledged: false })).rejects.toMatchObject({ code: "VALIDATION" });
      expect((await imp.getBatch(admin, id)).status).toBe("imported");

      await mig.validateBatch(admin, id, { acknowledged: true });
      const batch = await imp.getBatch(admin, id);
      expect(batch.status).toBe("validated");
      expect(batch.validatedAt).not.toBeNull();
      expect((await db.importBatch.findUniqueOrThrow({ where: { id } })).validatedByUserId).toBe(admin.id);

      const rows = await db.importRow.findMany({ where: { batchId: id } });
      expect(rows).toHaveLength(10);
      for (const row of rows) {
        expect(row.raw).toEqual([]);
        expect(row.parsed).toBeNull();
      }
      expect((await mig.getReconciliation(admin, id)).sourceAvailable).toBe(false);
      // Les fiches, elles, restent.
      expect(await db.lead.count()).toBe(5);
      const trace = await db.auditLog.findFirstOrThrow({ where: { action: "import.validated", entityId: id } });
      expect(trace.metadata).toMatchObject({ entity: "leads", imported: 5, rejected: 4, duplicates: 1 });
      expect(JSON.stringify(trace.metadata)).not.toMatch(/alpha|awa@|\+225/i);
    });

    it("refuse de valider deux fois, un lot non importé ou sans droit", async () => {
      const id = await importedLeadBatch();
      await mig.validateBatch(admin, id, { acknowledged: true });
      await expect(mig.validateBatch(admin, id, { acknowledged: true })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(imp.importBatch(admin, id)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(analyzeLeads(id)).rejects.toMatchObject({ code: "CONFLICT" });

      const fresh = await uploadLeads();
      await expect(mig.validateBatch(admin, fresh, { acknowledged: true })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(mig.validateBatch(commercial, id, { acknowledged: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(mig.getReconciliation(commercial, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("valide sans confirmation un lot sans aucune anomalie", async () => {
      const id = (await imp.createBatch(admin, { entity: "leads", filename: "propre.csv", buffer: csv([LEAD_HEADER, `Alpha SA;Santé;Koné;Awa;0102030405;awa@alpha.ci;DG;${daysAgo(5)};20;;;;`]) })).id;
      await analyzeLeads(id);
      await imp.importBatch(admin, id);
      await expect(mig.validateBatch(admin, id, { acknowledged: false })).resolves.toBeUndefined();
    });
  });

  describe("avertissements et rapport d'anomalies", () => {
    const ACCOUNT_FILE = [
      "Raison sociale;Secteur;Téléphone;Statut",
      "Société Alpha;Assurances;01 02 03 04 05;Client",
      "Béta SARL;BTP;07 35 36 73;Prospect",
      "Gamma;Pêche;0505050505;Client",
    ];
    const accountMapping = { legalName: "Raison sociale", sector: "Secteur", phone: "Téléphone", status: "Statut" };

    it("un téléphone illisible n'empêche pas l'import d'un compte : il est ignoré et signalé", async () => {
      const id = (await imp.createBatch(admin, { entity: "accounts", filename: "comptes.csv", buffer: csv(ACCOUNT_FILE) })).id;
      const summary = await imp.analyzeBatch(admin, { id, mapping: accountMapping, defaults: { ownerUserId: owner.id } });
      expect(summary).toMatchObject({ validRows: 2, rejectedRows: 1 });

      const batch = await imp.getBatch(admin, id);
      expect(batch.report?.warningRows).toBe(1);
      expect(batch.report?.warnings[0].reason).toContain("« 07 35 36 73 » non importé");

      await imp.importBatch(admin, id);
      const accounts = await db.crmAccount.findMany({ orderBy: { legalName: "asc" } });
      expect(Object.fromEntries(accounts.map((account) => [account.legalName, [account.sector, account.phone]]))).toEqual({
        "Béta SARL": ["BTP et immobilier", null],
        "Société Alpha": ["Assurance", "+2250102030405"],
      });
    });

    it("le rapport d'anomalies liste rejets, doublons ET avertissements, avec la valeur d'origine", async () => {
      const id = (await imp.createBatch(admin, { entity: "accounts", filename: "comptes.csv", buffer: csv(ACCOUNT_FILE) })).id;
      await imp.analyzeBatch(admin, { id, mapping: accountMapping, defaults: { ownerUserId: owner.id } });
      await imp.importBatch(admin, id);

      const { filename, csv: report } = await imp.rejectsCsv(admin, id);
      expect(filename).toBe("anomalies-comptes.csv");
      const rows = parseCsv(report, ";");
      expect(rows[0].slice(0, 3)).toEqual(["Ligne", "Résultat", "Motif"]);
      const outcomes = Object.fromEntries(rows.slice(1).map((row) => [row[3], row[1]]));
      expect(outcomes).toEqual({ "Béta SARL": "Importée avec avertissement", Gamma: "Rejetée" });
      expect(rows.find((row) => row[3] === "Béta SARL")?.[2]).toContain("07 35 36 73");
    });
  });

  describe("purge d'office de la source", () => {
    const aged = (days: number) => new Date(Date.now() - days * 86_400_000);

    it("efface la source des lots importés non validés depuis plus de 90 jours, et abandonne les lots jamais importés", async () => {
      const importedOld = await uploadLeads();
      await analyzeLeads(importedOld);
      await imp.importBatch(admin, importedOld);
      await db.importBatch.update({ where: { id: importedOld }, data: { createdAt: aged(100) } });

      const abandonedOld = await uploadLeads();
      await db.importBatch.update({ where: { id: abandonedOld }, data: { createdAt: aged(100) } });

      const recent = await uploadLeads();
      const importedRecent = await uploadLeads();
      await analyzeLeads(importedRecent);
      await imp.importBatch(admin, importedRecent);

      const result = await mig.purgeExpiredSources();
      expect(result.abandoned).toBe(1);
      expect(result.purgedRows).toBe(10);

      expect(await db.importRow.count({ where: { batchId: importedOld, raw: { not: [] } } })).toBe(0);
      expect((await imp.getBatch(admin, importedOld)).status).toBe("imported");
      expect((await db.importBatch.findUniqueOrThrow({ where: { id: abandonedOld } })).status).toBe("cancelled");
      expect(await db.importRow.count({ where: { batchId: abandonedOld } })).toBe(0);
      // Les lots récents ne sont pas touchés.
      expect(await db.importRow.count({ where: { batchId: recent } })).toBe(10);
      expect((await db.importRow.findFirstOrThrow({ where: { batchId: importedRecent } })).raw).not.toEqual([]);

      // Idempotent : une seconde exécution ne trouve plus rien à faire.
      expect(await mig.purgeExpiredSources()).toEqual({ abandoned: 0, purgedRows: 0 });
      expect(await db.auditLog.count({ where: { action: "import.source_purged", entityId: importedOld } })).toBe(1);
    });
  });

  describe("téléphones déjà en base", () => {
    async function seedPhones() {
      const ownerUserId = owner.id;
      const account = (phone: string | null) =>
        db.crmAccount.create({ data: { legalName: `Compte ${uniq()}`, sector: "Santé", status: "client", country: "CI", ownerUserId, phone } });
      await account("07 35 36 73"); // 8 chiffres : à corriger à la main
      await account("0102030405"); // à normaliser
      await account("+2250505050505"); // déjà normalisé
      await account(null);
      await db.contact.create({ data: { firstName: "Awa", lastName: "Un", status: "active", ownerUserId, phone: "07 35 36 73" } });
      await db.contact.create({ data: { firstName: "Awa", lastName: "Deux", status: "active", ownerUserId, phone: "(+225) 01 02 03 04 05" } });
      await db.lead.create({
        data: { companyName: "L1", sector: "Santé", contactLastName: "A", contactFirstName: "B", phone: "05.05.05.05.05", email: "l1@x.ci", jobTitle: "DG", insertedOn: new Date(), ownerUserId },
      });
    }

    it("simule d'abord : compte les numéros à normaliser et ceux à corriger à la main, sans rien écrire", async () => {
      await seedPhones();
      const report = Object.fromEntries((await mig.previewStoredPhones(admin)).map((entry) => [entry.entity, entry]));
      expect(report.accounts).toMatchObject({ withPhone: 3, alreadyNormalized: 1, toNormalize: 1, unresolved: 1 });
      expect(report.contacts).toMatchObject({ withPhone: 2, toNormalize: 1, unresolved: 1 });
      expect(report.leads).toMatchObject({ withPhone: 1, toNormalize: 1, unresolved: 0 });
      expect(report.accounts.samples[0]).toMatchObject({ phone: "07 35 36 73" });
      expect(await db.crmAccount.count({ where: { phone: "0102030405" } })).toBe(1);
    });

    it("normalise sans jamais toucher un numéro illisible, de façon idempotente et tracée sans numéro", async () => {
      await seedPhones();
      await mig.normalizeStoredPhones(admin);
      const trace = await db.auditLog.findFirstOrThrow({ where: { action: "phone.normalized" }, orderBy: { occurredAt: "desc" } });
      expect(trace.metadata).toEqual({ accounts: { normalized: 1, unresolved: 1 }, contacts: { normalized: 1, unresolved: 1 }, leads: { normalized: 1, unresolved: 0 } });

      const accountPhones = (await db.crmAccount.findMany({ where: { phone: { not: null } }, select: { phone: true } })).map((row) => row.phone).sort();
      expect(accountPhones).toEqual(["+2250102030405", "+2250505050505", "07 35 36 73"]);
      const contactPhones = Object.fromEntries((await db.contact.findMany()).map((row) => [row.lastName, row.phone]));
      expect(contactPhones).toEqual({ Un: "07 35 36 73", Deux: "+2250102030405" });
      expect((await db.lead.findFirstOrThrow()).phone).toBe("+2250505050505");

      const second = Object.fromEntries((await mig.normalizeStoredPhones(admin)).map((entry) => [entry.entity, entry.toNormalize]));
      expect(second).toEqual({ accounts: 0, contacts: 0, leads: 0 });
    });

    it("est réservée à l'administrateur", async () => {
      await expect(mig.previewStoredPhones(commercial)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(mig.normalizeStoredPhones(commercial)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("contraintes en base", () => {
    it("impose un statut « validé » cohérent avec sa date et son validateur", async () => {
      const base = { filename: "x.csv", headers: [], totalRows: 0, createdByUserId: admin.id, entity: "leads" };
      await expect(db.importBatch.create({ data: { ...base, status: "validated" } })).rejects.toThrow();
      await expect(db.importBatch.create({ data: { ...base, validatedAt: new Date() } })).rejects.toThrow();
      await expect(db.importBatch.create({ data: { ...base, status: "validated", validatedAt: new Date(), validatedByUserId: admin.id } })).resolves.toBeDefined();
    });
  });
});
