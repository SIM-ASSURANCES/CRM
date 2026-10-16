// Jeu de données de RECETTE : un volume réaliste de données 100 % fictives, donc anonymisées par construction
// (aucune donnée client réelle n'est copiée). Déterministe : une graine fixe donne toujours le même jeu, ce qui rend les
// résultats de recette comparables d'une exécution à l'autre.
//
// À lancer via : node scripts/recette-env.mjs init     (crée la base `crm_recette`, applique les migrations, puis ce script)
// Les comptes d'essai ont des mots de passe générés au hasard, écrits dans `.recette-credentials` (ignoré par git).
//
// Fictif = adresses en `@recette.example` (domaine réservé, jamais attribué) et téléphones en `+225 0X 00 …`.
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Prisma } from "../src/generated/prisma/client";
import { LOSS_REASONS, SECTORS } from "../src/features/leads/config";
import { auth } from "../src/lib/auth/auth";
import { db } from "../src/lib/db";

const SEED = 20261016;

/** Générateur pseudo-aléatoire (mulberry32) : reproductible, sans dépendance. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(SEED);
const int = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const chance = (p: number) => random() < p;
const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const DAY = 86_400_000;
const ago = (days: number, hour = 9) => {
  const base = new Date(Date.now() - days * DAY);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour));
};
const dateOnly = (days: number) => {
  const base = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
};

// Numéro fictif au format unique du CRM : +225 + 10 chiffres. Le « 00 » en tête du reste le rend improbable.
const phone = () => `+225${pick(["01", "05", "07"])}00${String(int(0, 999999)).padStart(6, "0")}`;

const FIRST_NAMES = ["Koffi", "Awa", "Yao", "Mariam", "Serge", "Fatou", "Ibrahim", "Adjoua", "Jean", "Nadège", "Paul", "Salif", "Aïcha", "Marc", "Estelle", "Moussa", "Clarisse", "Eric", "Rokia", "Brice", "Sandrine", "Lassina", "Odile", "Thierry"];
const LAST_NAMES = ["Kouassi", "Traoré", "Diallo", "Coulibaly", "Konaté", "Bamba", "Ouattara", "Koné", "Yao", "N'Guessan", "Aka", "Kra", "Sanogo", "Diabaté", "Gnahoré", "Tano", "Soro", "Doumbia", "Zadi", "Bakayoko"];
const JOB_TITLES = ["Directeur général", "Directrice financière", "Responsable achats", "Responsable des assurances", "Directeur des ressources humaines", "Gérant", "Directrice administrative", "Responsable QHSE"];
const NAME_A = ["Lagune", "Baobab", "Savane", "Comoé", "Bandama", "Tabou", "Ivoire", "Éburnéa", "Sassandra", "Atlantique", "Soleil", "Kola", "Palmeraie", "Cacao", "Harmattan", "Azur", "Équateur", "Perle", "Horizon", "Mangrove"];
const NAME_B = ["Logistique", "Négoce", "Distribution", "Services", "Industries", "Transport", "Agro", "Construction", "Énergie", "Santé", "Conseil", "Finance", "Immobilier", "Hôtellerie", "Télécom", "Formation", "Mines", "Commerce", "Équipements", "Pharma"];
const LEGAL_FORMS = ["SARL", "SA", "SAS", "SARL", "SA"];
const CITIES = ["Abidjan", "Bouaké", "Yamoussoukro", "San-Pédro", "Daloa", "Korhogo", "Man", "Abengourou"];
const SOURCES = ["event", "referral", "campaign", "prospecting", "other"] as const;
const ROLE_TYPES = ["decision_maker", "validator", "buyer", "prescriber", "user", "other"] as const;
const INFLUENCE = ["high", "medium", "low"] as const;
const ACTIVITY_TYPES = ["call_in", "call_out", "email", "meeting", "video", "note", "proposal_sent", "contract_step"] as const;
const ACTIVITY_SUBJECTS = ["Appel de découverte du besoin", "Point d'avancement", "Envoi de la documentation", "Rendez-vous sur site", "Relance de la proposition", "Négociation des conditions", "Présentation de l'offre", "Suivi après devis"];
const NEXT_ACTIONS = ["Appeler le décideur", "Envoyer la proposition", "Planifier un rendez-vous", "Relancer pour la signature", "Préparer le contrat", "Qualifier le besoin"];
const TASK_TITLES = ["Relancer le client", "Préparer la proposition", "Rappeler le contact", "Vérifier les pièces du dossier", "Planifier la visite", "Mettre à jour la fiche"];
const STAGES = [10, 20, 40, 60, 80, 90] as const;

type RecetteUser = { key: string; name: string; email: string; role: "admin" | "direction" | "manager" | "commercial" | "audit"; team?: "nord" | "sud" };
const USERS: RecetteUser[] = [
  { key: "admin", name: "Recette Administrateur", email: "recette-admin@recette.example", role: "admin" },
  { key: "direction", name: "Recette Direction", email: "recette-direction@recette.example", role: "direction" },
  { key: "audit", name: "Recette Audit", email: "recette-audit@recette.example", role: "audit" },
  { key: "manager1", name: "Recette Manager Nord", email: "recette-manager1@recette.example", role: "manager", team: "nord" },
  { key: "manager2", name: "Recette Manager Sud", email: "recette-manager2@recette.example", role: "manager", team: "sud" },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({
    key: `commercial${n}`,
    name: `Recette Commercial ${n}`,
    email: `recette-commercial${n}@recette.example`,
    role: "commercial" as const,
    team: n <= 3 ? ("nord" as const) : ("sud" as const),
  })),
];

const COUNTS = { groups: 14, accounts: 190, contacts: 380, opportunities: 280, leads: 160, activities: 650, tasks: 170 };

async function main() {
  if (!process.env.DATABASE_URL?.includes("recette")) {
    throw new Error("Refus : la base visée n'est pas la base de recette. Lancez ce script via scripts/recette-env.mjs.");
  }
  if ((await db.user.count()) > 0) {
    throw new Error("La base de recette contient déjà des utilisateurs. Réinitialisez-la : node scripts/recette-env.mjs reset");
  }

  // --- Utilisateurs et équipes -------------------------------------------------------------------------------------
  const context = await auth.$context;
  const credentials: Record<string, { email: string; password: string }> = {};
  const userIds = new Map<string, string>();
  for (const user of USERS) {
    const password = `${randomBytes(15).toString("base64url")}9aZ!`;
    const id = randomUUID();
    userIds.set(user.key, id);
    credentials[user.key] = { email: user.email, password };
    await db.user.create({
      data: {
        id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        role: user.role,
        mustChangePassword: false,
        accounts: { create: { accountId: id, providerId: "credential", password: await context.password.hash(password) } },
      },
    });
  }
  const teams = {
    nord: await db.team.create({ data: { name: "Équipe Recette Nord", managerUserId: userIds.get("manager1")! } }),
    sud: await db.team.create({ data: { name: "Équipe Recette Sud", managerUserId: userIds.get("manager2")! } }),
  };
  for (const user of USERS) {
    if (user.team) await db.user.update({ where: { id: userIds.get(user.key)! }, data: { teamId: teams[user.team].id } });
  }
  const commercials = USERS.filter((u) => u.role === "commercial").map((u) => userIds.get(u.key)!);

  // --- Produits ----------------------------------------------------------------------------------------------------
  const productDefs = [
    ["individuelle-accident", "Individuelle Accident"], ["relax-moto", "RELAX Moto"], ["secur-moto", "SECUR Moto"], ["relax-auto", "RELAX Auto"],
    ["secur-maison", "SECUR Maison"], ["secur-maison-plus", "SECUR Maison+"], ["relax-sante", "RELAX Santé"],
  ];
  for (const [index, [code, label]] of productDefs.entries()) {
    await db.product.upsert({ where: { code }, update: {}, create: { code, label, sortOrder: index } });
  }
  const products = await db.product.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, label: true } });

  // --- Comptes (groupes avec filiales + comptes autonomes) ---------------------------------------------------------
  const names = new Set<string>();
  const companyName = () => {
    for (let i = 0; i < 1000; i += 1) {
      const name = `${pick(NAME_A)} ${pick(NAME_B)}`;
      if (!names.has(name)) {
        names.add(name);
        return `${name} ${pick(LEGAL_FORMS)}`;
      }
    }
    return `Société ${names.size + 1}`;
  };

  type AccountRow = Prisma.CrmAccountUncheckedCreateInput & { id: string };
  const accounts: AccountRow[] = [];
  let counter = 10000;
  const makeAccount = (parentId: string | null, ownerUserId: string): AccountRow => {
    counter += 1;
    const legalName = companyName();
    const large = chance(0.12);
    return {
      id: randomUUID(),
      legalName,
      legalIdentifier: `CI-ABJ-${int(2008, 2024)}-B-${counter}`,
      sector: pick(SECTORS),
      status: pick(["prospect", "client", "client", "client", "inactive", "partner"]),
      employeeCount: large ? int(500, 3000) : int(8, 400),
      revenueAmount: large ? int(5, 80) * 1_000_000_000 : int(50, 4000) * 1_000_000,
      revenueYear: 2025,
      revenueSource: "Donnée fictive de recette",
      source: pick(SOURCES),
      phone: phone(),
      emailDomain: `${slug(legalName.replace(/\s(SARL|SA|SAS)$/, ""))}.recette.example`,
      city: pick(CITIES),
      country: "CI",
      parentAccountId: parentId,
      ownerUserId,
      createdAt: ago(int(30, 700)),
    };
  };
  for (let g = 0; g < COUNTS.groups; g += 1) {
    const owner = pick(commercials);
    const parent = makeAccount(null, owner);
    accounts.push(parent);
    for (let c = 0; c < int(1, 3); c += 1) accounts.push(makeAccount(parent.id, owner));
  }
  while (accounts.length < COUNTS.accounts) accounts.push(makeAccount(null, pick(commercials)));
  await db.crmAccount.createMany({ data: accounts });

  // --- Contacts, rattachements et rôles ----------------------------------------------------------------------------
  const contactRows: Prisma.ContactUncheckedCreateInput[] = [];
  const linkRows: Prisma.AccountContactUncheckedCreateInput[] = [];
  const roleRows: Prisma.ContactRoleUncheckedCreateInput[] = [];
  const hasPrimary = new Set<string>();
  const contactEmails = new Set<string>();
  for (let i = 0; i < COUNTS.contacts; i += 1) {
    const account = accounts[i % accounts.length];
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    let email = `${slug(firstName)}.${slug(lastName)}@${account.emailDomain}`;
    if (contactEmails.has(email)) email = `${slug(firstName)}.${slug(lastName)}${i}@${account.emailDomain}`;
    contactEmails.add(email);
    const id = randomUUID();
    contactRows.push({
      id, firstName, lastName, jobTitle: pick(JOB_TITLES), email, phone: phone(), status: chance(0.06) ? "to_confirm" : "active",
      preferredChannel: pick(["email", "phone", "whatsapp", "in_person"]), ownerUserId: account.ownerUserId, createdAt: ago(int(10, 600)),
    });
    const accountIds = [account.id];
    // Un contact sur dix intervient dans un second compte (REC-03 : rôles et périmètres par compte).
    if (chance(0.1)) accountIds.push(pick(accounts).id);
    for (const accountId of new Set(accountIds)) {
      const isPrimary = !hasPrimary.has(accountId);
      if (isPrimary) hasPrimary.add(accountId);
      linkRows.push({ accountId, contactId: id, relationshipTitle: pick(JOB_TITLES), isPrimary });
      roleRows.push({
        accountId, contactId: id, roleType: pick(ROLE_TYPES), influence: pick(INFLUENCE),
        productId: chance(0.5) ? pick(products).id : null,
      });
    }
  }
  await db.contact.createMany({ data: contactRows });
  await db.accountContact.createMany({ data: linkRows });
  await db.contactRole.createMany({ data: roleRows });

  // --- Opportunités et historique ----------------------------------------------------------------------------------
  const oppRows: Prisma.OpportunityUncheckedCreateInput[] = [];
  const eventRows: Prisma.OpportunityEventUncheckedCreateInput[] = [];
  for (let i = 0; i < COUNTS.opportunities; i += 1) {
    const account = pick(accounts);
    const product = pick(products);
    const finalIndex = int(0, STAGES.length - 1);
    const outcome = chance(0.18) ? "won" : chance(0.2) && finalIndex >= 1 ? "lost" : "open";
    const createdDays = int(15, 240);
    const created = ago(createdDays);
    const stage = outcome === "won" ? 100 : STAGES[finalIndex];
    const amount = stage <= 20 ? 0 : int(2, 60) * 500_000;
    const closeDate = outcome === "open" ? dateOnly(int(-20, 120)) : null; // quelques clôtures dépassées : alimentent les relances
    const id = randomUUID();
    const closedAt = outcome === "open" ? null : ago(int(1, Math.max(2, createdDays - 5)));

    oppRows.push({
      id, name: `${account.legalName} – ${product.label}`, accountId: account.id, ownerUserId: account.ownerUserId, productId: product.id,
      amount, revenuePeriod: pick(["annual", "annual", "monthly", "one_time"]), stage, status: outcome,
      expectedCloseDate: outcome === "open" ? closeDate : dateOnly(-int(1, 60)),
      nextAction: outcome === "open" ? pick(NEXT_ACTIONS) : null,
      nextActionDate: outcome === "open" ? dateOnly(int(-10, 21)) : null, // une partie en retard
      lossReason: outcome === "lost" ? pick(LOSS_REASONS).code : null,
      closedAt, createdAt: created,
    });

    const path = outcome === "won" ? [...STAGES] : STAGES.slice(0, finalIndex + 1);
    const step = Math.max(1, Math.floor(createdDays / (path.length + 1)));
    path.forEach((toStage, k) => {
      eventRows.push({
        opportunityId: id, occurredAt: ago(createdDays - k * step), actorUserId: account.ownerUserId,
        type: k === 0 ? "created" : "stage_changed", fromStage: k === 0 ? null : path[k - 1], toStage, status: "open", amount,
        expectedCloseDate: closeDate,
      });
    });
    if (outcome !== "open") {
      eventRows.push({
        opportunityId: id, occurredAt: closedAt!, actorUserId: account.ownerUserId, type: outcome,
        fromStage: path[path.length - 1], toStage: stage, status: outcome, amount, expectedCloseDate: null,
      });
    }
  }
  await db.opportunity.createMany({ data: oppRows });
  await db.opportunityEvent.createMany({ data: eventRows });

  // --- Activités et tâches -----------------------------------------------------------------------------------------
  // La moitié des grands comptes (≥ 500 salariés) n'a AUCUNE activité récente : ils déclenchent la règle d'inactivité
  // (REC-06).
  const staleLarge = new Set(accounts.filter((a) => (a.employeeCount ?? 0) >= 500 && chance(0.5)).map((a) => a.id));
  const activeAccounts = accounts.filter((a) => !staleLarge.has(a.id));
  const activityRows: Prisma.ActivityUncheckedCreateInput[] = [];
  for (let i = 0; i < COUNTS.activities; i += 1) {
    const account = pick(activeAccounts);
    activityRows.push({
      type: pick(ACTIVITY_TYPES), subject: pick(ACTIVITY_SUBJECTS), occurredAt: ago(int(0, 180), int(8, 17)),
      authorUserId: account.ownerUserId, accountId: account.id, outcome: chance(0.6) ? "Échange cordial, suite à donner." : null,
    });
  }
  for (const accountId of staleLarge) {
    const account = accounts.find((a) => a.id === accountId)!;
    activityRows.push({ type: "call_out", subject: "Dernier échange", occurredAt: ago(int(90, 200)), authorUserId: account.ownerUserId, accountId });
  }
  await db.activity.createMany({ data: activityRows });

  const taskRows: Prisma.TaskUncheckedCreateInput[] = [];
  for (let i = 0; i < COUNTS.tasks; i += 1) {
    const account = pick(accounts);
    const state = chance(0.45) ? "done" : chance(0.1) ? "cancelled" : "open";
    taskRows.push({
      title: pick(TASK_TITLES), dueDate: dateOnly(int(-25, 30)), status: state, priority: pick(["low", "normal", "normal", "high"]),
      assigneeUserId: account.ownerUserId, createdByUserId: account.ownerUserId, accountId: account.id,
      completedAt: state === "done" ? ago(int(0, 20)) : null,
    });
  }
  await db.task.createMany({ data: taskRows });

  // --- Prospects ---------------------------------------------------------------------------------------------------
  const leadSteps = [10, 20, 40, 60, 80, 90, 100];
  for (let i = 0; i < COUNTS.leads; i += 1) {
    const owner = pick(commercials);
    const progress = pick(leadSteps);
    const lost = progress < 100 && chance(0.18);
    const status = lost ? "lost" : progress === 100 ? "won" : "open";
    const startedDays = int(3, 120);
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const company = companyName();
    const revenue = progress >= 60 ? int(2, 40) * 500_000 : null;
    const path = leadSteps.filter((s) => s <= progress);
    await db.lead.create({
      data: {
        companyName: company, sector: pick(SECTORS), contactFirstName: firstName, contactLastName: lastName,
        phone: phone(), email: `${slug(firstName)}.${slug(lastName)}.${i}@${slug(company)}.recette.example`, jobTitle: pick(JOB_TITLES),
        insertedOn: dateOnly(-startedDays), progress, status, productId: revenue === null ? null : pick(products).id, expectedRevenue: revenue,
        lossReason: lost ? pick(LOSS_REASONS).code : null, closedAt: status === "open" ? null : ago(int(0, startedDays)), ownerUserId: owner,
        events: {
          create: path.map((toProgress, k) => ({
            occurredAt: ago(startedDays - k * Math.max(1, Math.floor(startedDays / (path.length + 1)))),
            actorUserId: owner, type: k === 0 ? "created" : toProgress === 100 ? "won" : "progress_changed",
            fromProgress: k === 0 ? null : path[k - 1], toProgress, status: toProgress === 100 ? "won" : "open", expectedRevenue: revenue,
          })),
        },
      },
    });
  }

  // --- Objectifs mensuels (6 mois passés + 5 à venir) pour les commerciaux -------------------------------------------
  const now = new Date();
  const targets: Prisma.SalesTargetUncheckedCreateInput[] = [];
  for (const ownerUserId of commercials) {
    for (let offset = -6; offset <= 5; offset += 1) {
      targets.push({ ownerUserId, periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)), amount: int(15, 45) * 1_000_000 });
    }
  }
  await db.salesTarget.createMany({ data: targets });

  await db.auditLog.create({
    data: { actorUserId: null, action: "recette.seeded", entityType: "system", metadata: { seed: SEED, accounts: accounts.length, contacts: COUNTS.contacts } },
  });

  writeFileSync(".recette-credentials", JSON.stringify(credentials, null, 2), { encoding: "utf8" });
  console.log(
    `Base de recette prête : ${USERS.length} utilisateurs, ${accounts.length} comptes, ${COUNTS.contacts} contacts, ${COUNTS.opportunities} opportunités, ` +
      `${activityRows.length} activités, ${COUNTS.tasks} tâches, ${COUNTS.leads} prospects (identifiants dans .recette-credentials).`,
  );
}

main()
  .catch((error) => {
    console.error("Échec :", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
