import { randomUUID } from "node:crypto";
import { readSheet } from "read-excel-file/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ForecastFilters, LossFilters } from "@/features/reporting/schemas";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";
import { parseCsv } from "@/lib/csv";

// Reporting avancé (CDC 8.2 et 8.3) sur la base dédiée (TEST_DATABASE_URL) : forecast, objectifs, motifs de perte,
// périmètres, exports et cohérence écran / export (REC-10).
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];

describe.skipIf(!hasDb)("reporting avancé (PostgreSQL)", () => {
  let db: Db;
  let svc: typeof import("@/features/reporting/service");
  let exp: typeof import("@/features/reporting/export");
  let acc: typeof import("@/features/accounts/service");
  let c1: CurrentUser; // commercial, équipe A
  let c2: CurrentUser; // commercial, équipe A
  let c3: CurrentUser; // commercial, hors équipe
  let c4: CurrentUser; // commercial avec objectif mais sans opportunité
  let manager: CurrentUser; // équipe A
  let direction: CurrentUser;
  let admin: CurrentUser;
  let audit: CurrentUser;
  let p1: string;
  let p2: string;
  let accountA1: string;
  let teamId: string;

  const uniq = () => randomUUID().slice(0, 8);
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const NOW = new Date(Date.UTC(2026, 9, 15, 10, 0));

  const forecast = (over: Partial<ForecastFilters> = {}): ForecastFilters => ({ from: "2026-01", to: "2026-12", granularity: "month", segment: "none", ...over });
  const losses = (over: Partial<LossFilters> = {}): LossFilters => ({ from: "2026-01", to: "2026-12", dimension: "product", ...over });

  async function makeUser(role: Role, label: string, team: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: { name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`, role, teamId: team, emailVerified: true },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: team, mustChangePassword: false };
  }

  async function makeAccount(owner: CurrentUser, over: { sector?: string; employeeCount?: number; parentId?: string; name?: string } = {}) {
    const created = await acc.createAccount(owner, { legalName: over.name ?? `Compte ${uniq()}`, sector: "Santé", status: "client", country: "CI", forceDuplicate: false });
    await db.crmAccount.update({
      where: { id: created.id },
      data: { sector: over.sector ?? null, employeeCount: over.employeeCount ?? null, parentAccountId: over.parentId ?? null },
    });
    return created.id;
  }

  type OppSeed = {
    owner: CurrentUser;
    accountId: string;
    productId?: string;
    amount: number;
    revenuePeriod?: string;
    stage?: number;
    status?: "open" | "won" | "lost";
    close?: string | null;
    closedAt?: string;
    lossReason?: string;
  };
  const makeOpp = (seed: OppSeed) =>
    db.opportunity.create({
      data: {
        name: `Opp ${uniq()}`,
        accountId: seed.accountId,
        ownerUserId: seed.owner.id,
        productId: seed.productId ?? p1,
        amount: seed.amount,
        revenuePeriod: seed.revenuePeriod ?? "annual",
        stage: seed.stage ?? 40,
        status: seed.status ?? "open",
        expectedCloseDate: seed.close === null ? null : day(seed.close ?? "2026-11-10"),
        closedAt: seed.closedAt ? new Date(`${seed.closedAt}T09:00:00Z`) : null,
        lossReason: seed.lossReason ?? null,
        nextAction: "Relancer",
        nextActionDate: day("2026-10-20"),
      },
    });

  const setTarget = (owner: CurrentUser, month: string, amount: number) =>
    db.salesTarget.create({ data: { ownerUserId: owner.id, periodStart: day(`${month}-01`), amount } });

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    svc = await import("@/features/reporting/service");
    exp = await import("@/features/reporting/export");
    acc = await import("@/features/accounts/service");

    teamId = (await db.team.create({ data: { name: `Équipe reporting ${uniq()}` } })).id;
    c1 = await makeUser("commercial", "Commercial Un", teamId);
    c2 = await makeUser("commercial", "Commercial Deux", teamId);
    c3 = await makeUser("commercial", "Commercial Trois");
    c4 = await makeUser("commercial", "Commercial Quatre");
    manager = await makeUser("manager", "Manager Reporting", teamId);
    direction = await makeUser("direction", "Direction Reporting");
    admin = await makeUser("admin", "Admin Reporting");
    audit = await makeUser("audit", "Audit Reporting");
    p1 = (await db.product.create({ data: { code: `rpt-a-${uniq()}`, label: "Produit Auto" } })).id;
    p2 = (await db.product.create({ data: { code: `rpt-b-${uniq()}`, label: "Produit Santé" } })).id;
  });

  beforeEach(async () => {
    await db.activity.deleteMany();
    await db.task.deleteMany();
    await db.leadEvent.deleteMany();
    await db.lead.deleteMany();
    await db.opportunityContact.deleteMany();
    await db.opportunityEvent.deleteMany();
    await db.opportunity.deleteMany();
    await db.salesTarget.deleteMany();
    await db.contactRole.deleteMany();
    await db.accountContact.deleteMany();
    await db.contact.deleteMany();
    await db.crmAccount.updateMany({ data: { parentAccountId: null, mergedIntoId: null } });
    await db.crmAccount.deleteMany();

    const group = await makeAccount(admin, { name: "Groupe Alpha" });
    accountA1 = await makeAccount(c1, { sector: "Santé", employeeCount: 300, name: "Compte A1" });
    const a2 = await makeAccount(c2, { sector: "Banque et finance", employeeCount: 40, parentId: group, name: "Compte A2" });
    const a3 = await makeAccount(c3, { name: "Compte A3" });

    await makeOpp({ owner: c1, accountId: accountA1, amount: 1_000_000, stage: 40, close: "2026-11-10" }); // O1
    await makeOpp({ owner: c1, accountId: accountA1, productId: p2, amount: 100_000, revenuePeriod: "monthly", stage: 60, close: "2026-11-20" }); // O2 : 1,2 M annualisé
    await makeOpp({ owner: c1, accountId: accountA1, amount: 2_000_000, stage: 100, status: "won", close: "2026-10-25", closedAt: "2026-10-05" }); // O3
    await makeOpp({ owner: c1, accountId: accountA1, amount: 500_000, stage: 20, close: "2026-12-20" }); // O4
    await makeOpp({ owner: c1, accountId: accountA1, productId: p2, amount: 800_000, stage: 20, status: "lost", closedAt: "2026-09-01", lossReason: "price" }); // O5
    await makeOpp({ owner: c2, accountId: a2, amount: 3_000_000, stage: 80, close: "2026-12-15" }); // O6
    await makeOpp({ owner: c2, accountId: a2, amount: 400_000, stage: 40, status: "lost", closedAt: "2026-08-10", lossReason: "competition" }); // O7
    await makeOpp({ owner: c3, accountId: a3, amount: 9_000_000, stage: 90, close: "2026-11-01" }); // O8 : hors équipe A
    await makeOpp({ owner: c3, accountId: a3, amount: 5_000_000, stage: 20, status: "lost", closedAt: "2026-07-01", lossReason: "timing" }); // O9

    await setTarget(c1, "2026-10", 1_000_000);
    await setTarget(c1, "2026-11", 2_000_000);
    await setTarget(c2, "2026-12", 5_000_000);
    await setTarget(c3, "2026-11", 1_000_000);
    await setTarget(c4, "2026-11", 700_000);
  });

  afterAll(async () => {
    await db?.opportunity.deleteMany();
    await db?.product.deleteMany({ where: { id: { in: [p1, p2] } } });
    await db?.$disconnect();
  });

  describe("forecast (CDC 8.2)", () => {
    it("sépare brut, pondéré, gagné et signé sur tout le périmètre de l'administrateur", async () => {
      const { report } = await svc.getForecast(admin, forecast());
      expect(report.total).toMatchObject({ openCount: 5, gross: 14_700_000, weighted: 11_720_000, wonCount: 1, signed: 2_000_000, forecast: 13_720_000 });
      expect(report.periodTotals["2026-12"]).toMatchObject({ openCount: 2, gross: 3_500_000, weighted: 2_500_000 });
      expect(report.periodTotals["2026-11"]).toMatchObject({ gross: 11_200_000, weighted: 9_220_000 });
      expect(report.periodTotals["2026-10"]).toMatchObject({ signed: 2_000_000, openCount: 0 });
    });

    it("limite chacun à son périmètre : commercial = les siennes, manager = son équipe, direction = tout", async () => {
      expect((await svc.getForecast(c1, forecast())).report.total).toMatchObject({ gross: 2_700_000, weighted: 1_220_000, signed: 2_000_000 });
      expect((await svc.getForecast(c2, forecast())).report.total).toMatchObject({ gross: 3_000_000, signed: 0 });
      expect((await svc.getForecast(manager, forecast())).report.total).toMatchObject({ gross: 5_700_000, weighted: 3_620_000, signed: 2_000_000, forecast: 5_620_000 });
      expect((await svc.getForecast(direction, forecast())).report.total.gross).toBe(14_700_000);
      expect((await svc.getForecast(audit, forecast())).report.total.gross).toBe(14_700_000);
      // Un filtre sur un commercial hors périmètre ne révèle rien.
      expect((await svc.getForecast(manager, forecast({ ownerId: c3.id }))).report.total.gross).toBe(0);
    });

    it("segmente par produit, commercial, équipe, secteur et groupe, et chaque segmentation additionne au même total", async () => {
      for (const segment of ["product", "owner", "team", "sector", "group"] as const) {
        const { report } = await svc.getForecast(admin, forecast({ segment }));
        expect(report.segments.reduce((sum, item) => sum + item.total.forecast, 0), segment).toBe(13_720_000);
        expect(report.segments.reduce((sum, item) => sum + item.total.gross, 0), segment).toBe(14_700_000);
      }
      const byProduct = (await svc.getForecast(admin, forecast({ segment: "product" }))).report.segments;
      expect(byProduct.map((item) => item.label)).toEqual(expect.arrayContaining(["Produit Auto", "Produit Santé"]));
      const byGroup = (await svc.getForecast(admin, forecast({ segment: "group" }))).report.segments;
      // Le compte A2 appartient au groupe Alpha ; les autres comptes sont leur propre groupe.
      expect(byGroup.find((item) => item.label === "Groupe Alpha")?.total.gross).toBe(3_000_000);
      expect(byGroup.find((item) => item.label === "Compte A1")?.total.gross).toBe(2_700_000);
      const bySector = (await svc.getForecast(admin, forecast({ segment: "sector" }))).report.segments;
      expect(bySector.find((item) => item.label === "Secteur non renseigné")?.total.gross).toBe(9_000_000);
    });

    it("filtre par produit et par commercial", async () => {
      expect((await svc.getForecast(admin, forecast({ productId: p2 }))).report.total).toMatchObject({ gross: 1_200_000, openCount: 1 });
      expect((await svc.getForecast(admin, forecast({ ownerId: c2.id }))).report.total.gross).toBe(3_000_000);
    });

    it("lit un trimestre en entier même si la plage demandée le coupe", async () => {
      const { report } = await svc.getForecast(admin, forecast({ from: "2026-11", to: "2026-12", granularity: "quarter" }));
      expect(report.periods).toEqual(["2026-T4"]);
      // L'opportunité gagnée en octobre appartient au T4 : elle ne doit pas disparaître parce que la plage commence en novembre.
      expect(report.total).toMatchObject({ signed: 2_000_000, gross: 14_700_000 });
      const yearly = (await svc.getForecast(admin, forecast({ granularity: "year" }))).report;
      expect(yearly.periods).toEqual(["2026"]);
      expect(yearly.total.forecast).toBe(13_720_000);
    });
  });

  describe("objectifs (CDC 8.2)", () => {
    it("compare le forecast à l'objectif, par période, avec écart et taux", async () => {
      const { targets } = await svc.getForecast(admin, forecast());
      expect(targets?.total).toEqual({ target: 9_700_000, forecast: 13_720_000, gap: 4_020_000, rate: 141.4 });
      expect(targets?.byPeriod["2026-11"]).toMatchObject({ target: 3_700_000, forecast: 9_220_000 });
      // Un mois sans objectif : taux non calculable, jamais un pourcentage trompeur.
      expect(targets?.byPeriod["2026-03"]).toMatchObject({ target: 0, rate: null });
      expect(targets?.bySegment).toBeNull();
    });

    it("compare par commercial, y compris celui qui a un objectif mais aucune opportunité", async () => {
      const { report, targets } = await svc.getForecast(admin, forecast({ segment: "owner" }));
      expect(targets?.bySegment?.[c1.id].total).toMatchObject({ target: 3_000_000, forecast: 3_220_000, rate: 107.3 });
      expect(targets?.bySegment?.[c2.id].total).toMatchObject({ target: 5_000_000, forecast: 2_400_000, rate: 48 });
      expect(targets?.bySegment?.[c3.id].total).toMatchObject({ rate: 810 });
      expect(targets?.bySegment?.[c4.id].total).toMatchObject({ target: 700_000, forecast: 0, gap: -700_000, rate: 0 });
      expect(report.segments.find((segment) => segment.key === c4.id)?.label).toBe("Commercial Quatre");
    });

    it("compare par équipe", async () => {
      const { targets } = await svc.getForecast(admin, forecast({ segment: "team" }));
      expect(targets?.bySegment?.[teamId].total).toMatchObject({ target: 8_000_000, forecast: 5_620_000 });
      expect(targets?.bySegment?.none.total).toMatchObject({ target: 1_700_000 });
    });

    it("n'additionne que les objectifs du périmètre, et masque la comparaison quand elle n'a pas de sens", async () => {
      const asManager = await svc.getForecast(manager, forecast({ segment: "owner" }));
      expect(asManager.targets?.total.target).toBe(8_000_000);
      expect(Object.keys(asManager.targets?.bySegment ?? {})).not.toContain(c3.id);
      expect((await svc.getForecast(c1, forecast())).targets?.total.target).toBe(3_000_000);
      // Filtrer un produit : l'objectif est fixé par commercial, tous produits confondus.
      expect((await svc.getForecast(admin, forecast({ productId: p1 }))).targets).toBeNull();
      // Segmenter par produit : le total se compare, pas chaque produit.
      const byProduct = await svc.getForecast(admin, forecast({ segment: "product" }));
      expect(byProduct.targets?.bySegment).toBeNull();
      expect(byProduct.targets?.total.target).toBe(9_700_000);
    });

    it("enregistre les objectifs d'un commercial (12 mois), de façon idempotente et tracée", async () => {
      const amounts = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2027-${String(i + 1).padStart(2, "0")}`, (i + 1) * 100_000]));
      await expect(svc.saveTargets(manager, { ownerUserId: c2.id, year: 2027, amounts })).resolves.toEqual({ total: 7_800_000 });
      await svc.saveTargets(manager, { ownerUserId: c2.id, year: 2027, amounts });
      expect(await db.salesTarget.count({ where: { ownerUserId: c2.id, periodStart: { gte: day("2027-01-01"), lt: day("2028-01-01") } } })).toBe(12);
      expect(await db.auditLog.count({ where: { action: "target.updated", entityId: c2.id, actorUserId: manager.id } })).toBe(2);

      const grid = await svc.getTargetGrid(manager, 2027);
      expect(grid.rows.map((row) => row.name).sort()).toEqual(["Commercial Deux", "Commercial Un", "Manager Reporting"]);
      expect(grid.rows.find((row) => row.userId === c2.id)?.months["2027-03"]).toBe(300_000);
    });

    it("refuse les objectifs hors périmètre, sans permission ou invalides", async () => {
      const ok = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2027-${String(i + 1).padStart(2, "0")}`, 1000]));
      await expect(svc.saveTargets(manager, { ownerUserId: c3.id, year: 2027, amounts: ok })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(svc.saveTargets(c1, { ownerUserId: c1.id, year: 2027, amounts: ok })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(svc.saveTargets(audit, { ownerUserId: c1.id, year: 2027, amounts: ok })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(svc.saveTargets(admin, { ownerUserId: c3.id, year: 2027, amounts: { ...ok, "2027-05": -1 } })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(svc.saveTargets(admin, { ownerUserId: c3.id, year: 2027, amounts: { ...ok, "2027-05": Number.NaN } })).rejects.toMatchObject({ code: "VALIDATION" });
      const incomplete = { ...ok } as Record<string, number>;
      delete incomplete["2027-12"];
      await expect(svc.saveTargets(admin, { ownerUserId: c3.id, year: 2027, amounts: incomplete })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(svc.saveTargets(admin, { ownerUserId: c3.id, year: 1900, amounts: ok })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(svc.getTargetGrid(c1, 2027)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.salesTarget.count({ where: { periodStart: { gte: day("2027-01-01") } } })).toBe(0);
    });

    it("impose en base un montant positif et un mois entier", async () => {
      await expect(db.$executeRaw`INSERT INTO sales_targets (id, owner_user_id, period_start, amount, updated_at) VALUES (gen_random_uuid(), ${c1.id}::uuid, '2027-03-15', 10, now())`).rejects.toThrow();
      await expect(db.$executeRaw`INSERT INTO sales_targets (id, owner_user_id, period_start, amount, updated_at) VALUES (gen_random_uuid(), ${c1.id}::uuid, '2027-03-01', -10, now())`).rejects.toThrow();
    });
  });

  describe("motifs de perte (CDC 5.4)", () => {
    it("croise motifs et produits, avec les totaux", async () => {
      const { matrix } = await svc.getLosses(admin, losses());
      expect(matrix.total.total).toEqual({ count: 3, amount: 6_200_000 });
      expect(matrix.rows.map((row) => row.label)).toEqual(["Produit Auto", "Produit Santé"]);
      const auto = matrix.rows.find((row) => row.label === "Produit Auto")!;
      expect(auto.byReason.competition).toEqual({ count: 1, amount: 400_000 });
      expect(auto.byReason.timing).toEqual({ count: 1, amount: 5_000_000 });
      expect(matrix.rows.find((row) => row.label === "Produit Santé")?.byReason.price).toEqual({ count: 1, amount: 800_000 });
    });

    it("croise aussi avec le secteur, le commercial, la taille du compte et l'équipe", async () => {
      const bySize = (await svc.getLosses(admin, losses({ dimension: "size" }))).matrix;
      expect(bySize.rows.find((row) => row.key === "large")?.total.amount).toBe(800_000);
      expect(bySize.rows.find((row) => row.key === "small")?.total.amount).toBe(400_000);
      expect(bySize.rows.find((row) => row.key === "unknown")?.total.amount).toBe(5_000_000);
      const byOwner = (await svc.getLosses(admin, losses({ dimension: "owner" }))).matrix;
      expect(byOwner.rows.map((row) => row.label)).toEqual(["Commercial Trois", "Commercial Un", "Commercial Deux"]);
      const byTeam = (await svc.getLosses(admin, losses({ dimension: "team" }))).matrix;
      expect(byTeam.rows.find((row) => row.key === teamId)?.total.count).toBe(2);
      expect((await svc.getLosses(admin, losses({ dimension: "sector" }))).matrix.total.total.count).toBe(3);
    });

    it("applique le périmètre, la période et les filtres", async () => {
      expect((await svc.getLosses(manager, losses())).matrix.total.total).toEqual({ count: 2, amount: 1_200_000 });
      expect((await svc.getLosses(c3, losses())).matrix.total.total).toEqual({ count: 1, amount: 5_000_000 });
      expect((await svc.getLosses(admin, losses({ from: "2026-08", to: "2026-12" }))).matrix.total.total).toEqual({ count: 2, amount: 1_200_000 });
      expect((await svc.getLosses(admin, losses({ productId: p2 }))).matrix.total.total).toEqual({ count: 1, amount: 800_000 });
      expect((await svc.getLosses(admin, losses({ ownerId: c2.id }))).matrix.total.total).toEqual({ count: 1, amount: 400_000 });
    });
  });

  describe("exports (CDC 8.3) et cohérence écran / export (REC-10)", () => {
    const toNumber = (cell: string) => Number(cell.replace(",", "."));
    const csvRows = (body: string | Buffer) => parseCsv(String(body), ";");
    const totalRow = (rows: string[][]) => rows.find((row) => row[0] === "TOTAL" && row[1] === "Toutes périodes")!;

    it("le total du forecast exporté en CSV et en XLSX est exactement celui de l'écran", async () => {
      const view = await svc.getForecast(admin, forecast());
      const csv = await exp.exportReport(admin, { report: "forecast", format: "csv", filters: forecast() }, NOW);
      const xlsx = await exp.exportReport(admin, { report: "forecast", format: "xlsx", filters: forecast() }, NOW);

      const fromCsv = totalRow(csvRows(csv.body));
      expect([2, 3, 4, 5, 6, 7, 8, 9].map((index) => toNumber(fromCsv[index]))).toEqual([
        view.report.total.openCount,
        view.report.total.gross,
        view.report.total.weighted,
        view.report.total.wonCount,
        view.report.total.signed,
        view.report.total.forecast,
        view.targets!.total.target,
        view.targets!.total.gap,
      ]);
      expect(fromCsv[10]).toBe("141,4");

      const sheet = (await readSheet(xlsx.body as Buffer)) as unknown[][];
      const fromXlsx = sheet.find((row) => row[0] === "TOTAL" && row[1] === "Toutes périodes")!;
      expect(fromXlsx.slice(2, 10)).toEqual([5, 14_700_000, 11_720_000, 1, 2_000_000, 13_720_000, 9_700_000, 4_020_000]);
      expect(fromXlsx[10]).toBe(141.4);
      expect(csv.contentType).toContain("text/csv");
      expect(xlsx.contentType).toContain("spreadsheetml");
      expect(csv.filename).toBe("previsions_2026-01_2026-12_20261015.csv");
    });

    it("le classeur contient les définitions des KPI dans un second onglet", async () => {
      const xlsx = await exp.exportReport(admin, { report: "forecast", format: "xlsx", filters: forecast() }, NOW);
      const definitions = (await readSheet(xlsx.body as Buffer, "Définitions")) as unknown[][];
      expect(definitions[0]).toEqual(["Indicateur", "Définition"]);
      expect(definitions.map((row) => row[0])).toEqual(expect.arrayContaining(["Revenu signé", "Pipeline pondéré", "Écart à l'objectif"]));
    });

    it("l'export segmenté se somme au même total, et un mois sans objectif est « non calculable »", async () => {
      const csv = await exp.exportReport(admin, { report: "forecast", format: "csv", filters: forecast({ segment: "owner" }) }, NOW);
      const rows = csvRows(csv.body);
      const header = rows.findIndex((row) => row[0] === "Segment");
      const lines = rows.slice(header + 1).filter((row) => row.length >= 11 && row[0] && row[0] !== "TOTAL" && row[1] !== "Sans date de clôture" && /\d{4}$/.test(row[1]));
      expect(lines.reduce((sum, row) => sum + toNumber(row[7]), 0)).toBe(13_720_000);
      expect(lines.find((row) => row[0] === "Commercial Quatre" && row[1] === "nov. 2026")!.slice(8, 11)).toEqual(["700000", "-700000", "0"]);
      expect(lines.find((row) => row[0] === "Commercial Un" && row[1] === "mars 2026")!.slice(8, 11)).toEqual(["0", "0", "non calculable"]);
    });

    it("le détail exporté additionne aux mêmes montants que le forecast", async () => {
      const view = await svc.getForecast(admin, forecast());
      const csv = await exp.exportReport(admin, { report: "opportunities", format: "csv", filters: forecast() }, NOW);
      const rows = csvRows(csv.body);
      const header = rows.findIndex((row) => row[0] === "Compte");
      const lines = rows.slice(header + 1).filter((row) => row.length >= 14 && ["Ouverte", "Gagnée"].includes(row[7]));

      expect(lines).toHaveLength(6);
      const sum = (index: number, status: string) => lines.filter((row) => row[7] === status).reduce((total, row) => total + toNumber(row[index]), 0);
      expect(sum(10, "Gagnée")).toBe(view.report.total.signed);
      expect(sum(11, "Ouverte")).toBe(view.report.total.weighted);
      expect(sum(10, "Ouverte")).toBe(view.report.total.gross);
      expect(lines.find((row) => row[9] === "Mensuel")?.[10]).toBe("1200000");
    });

    it("le détail d'un manager ne contient que son périmètre", async () => {
      const result = await exp.exportReport(manager, { report: "opportunities", format: "csv", filters: forecast() }, NOW);
      expect(result.rows).toBe(5);
      expect(String(result.body)).not.toContain("Compte A3");
      expect(String(result.body)).toContain("Compte A1");
    });

    it("exporte la matrice des motifs de perte avec son total", async () => {
      const view = await svc.getLosses(admin, losses());
      const csv = await exp.exportReport(admin, { report: "losses", format: "csv", filters: losses() }, NOW);
      const rows = csvRows(csv.body);
      const total = rows.find((row) => row[0] === "TOTAL" && row[1] === "Tous motifs")!;
      expect([toNumber(total[2]), toNumber(total[3])]).toEqual([view.matrix.total.total.count, view.matrix.total.total.amount]);
      expect(rows.find((row) => row[0] === "Produit Santé" && row[1] === "Prix")?.slice(2, 4)).toEqual(["1", "800000"]);
    });

    it("annonce les filtres appliqués, la date de génération et les définitions des KPI, sans identifiant", async () => {
      const csv = String((await exp.exportReport(admin, { report: "forecast", format: "csv", filters: forecast({ productId: p1, ownerId: c1.id, segment: "owner" }) }, NOW)).body);
      expect(csv).toContain("Généré le;2026-10-15T10:00:00.000Z");
      expect(csv).toContain("Produit;Produit Auto");
      expect(csv).toContain("Commercial;Commercial Un");
      expect(csv).toContain("Segmentation;Commercial");
      expect(csv).toContain("Définitions des indicateurs");
      expect(csv).toContain("Revenu signé;");
      expect(csv).not.toContain(c1.id);
      expect(csv).not.toContain(p1);
    });

    it("ne nomme pas un commercial hors de son périmètre dans les filtres de l'export", async () => {
      const csv = String((await exp.exportReport(manager, { report: "forecast", format: "csv", filters: forecast({ ownerId: c3.id }) }, NOW)).body);
      expect(csv).toContain("Commercial;Hors de votre périmètre");
      expect(csv).not.toContain("Commercial Trois");
    });

    it("neutralise les formules dans les noms de comptes exportés", async () => {
      await db.crmAccount.update({ where: { id: accountA1 }, data: { legalName: '=HYPERLINK("http://mal.example";"x")' } });
      const csv = String((await exp.exportReport(admin, { report: "opportunities", format: "csv", filters: forecast() }, NOW)).body);
      expect(csv).toContain("'=HYPERLINK");
      expect(csv).not.toMatch(/(^|;)=HYPERLINK/m);
    });

    it("réserve l'export aux managers et au-dessus, et le trace sans son contenu", async () => {
      for (const user of [c1, audit]) {
        await expect(exp.exportReport(user, { report: "forecast", format: "csv", filters: forecast() }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const before = await db.auditLog.count({ where: { action: "report.exported" } });
      await exp.exportReport(direction, { report: "losses", format: "xlsx", filters: losses({ dimension: "owner" }) }, NOW);
      expect(await db.auditLog.count({ where: { action: "report.exported" } })).toBe(before + 1);

      const trace = await db.auditLog.findFirstOrThrow({ where: { action: "report.exported", actorUserId: direction.id } });
      expect(trace.metadata).toMatchObject({ report: "losses", format: "xlsx", rows: expect.any(Number), truncated: false, filters: { from: "2026-01", to: "2026-12", dimension: "owner" } });
      expect(JSON.stringify(trace.metadata)).not.toMatch(/Compte A|Commercial Un|1000000/);
    });

    it("plafonne le détail exporté et l'annonce dans le fichier", () => {
      const table = exp.detailTable(
        Array.from({ length: 5001 }, (_, i) => ({
          id: String(i),
          name: "O",
          accountName: "C",
          productLabel: null,
          ownerName: "N",
          teamName: null,
          sector: null,
          stage: 40,
          status: "open" as const,
          amount: 1,
          revenuePeriod: "annual",
          annualized: 1,
          weighted: 0.4,
          expectedCloseDate: null,
          closedAt: null,
        })),
        [],
      );
      expect(table.rows).toHaveLength(5000);
      expect(table.truncated).toBe(true);
      expect(exp.serializeCsv(table, NOW)).toContain("Export tronqué");
    });
  });
});
