// Données initiales. Lancé par `npm run db:seed` (condition « react-server » pour « server-only »).
// Idempotent : ne recrée jamais un compte existant. Les mots de passe viennent de .env et ne sont jamais affichés.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "../src/generated/prisma/client";
import { auth } from "../src/lib/auth/auth";
import { passwordSchema } from "../src/lib/auth/password-policy";
import type { Role } from "../src/lib/auth/roles";
import { db } from "../src/lib/db";

const schema = z.object({
  SEED_ADMIN_EMAIL: z.email().transform((value) => value.toLowerCase()),
  SEED_ADMIN_NAME: z.string().min(1),
  SEED_ADMIN_PASSWORD: passwordSchema,
  // Comptes de démonstration (un par rôle) : développement uniquement.
  SEED_DEMO_PASSWORD: passwordSchema.optional(),
});

const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: "admin.demo@crm.local", name: "Démo Administrateur", role: "admin" },
  { email: "direction@crm.local", name: "Démo Direction", role: "direction" },
  { email: "manager@crm.local", name: "Démo Manager", role: "manager" },
  { email: "commercial@crm.local", name: "Démo Commercial", role: "commercial" },
  { email: "audit@crm.local", name: "Démo Audit", role: "audit" },
];

async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  password: string;
  mustChangePassword: boolean;
}): Promise<boolean> {
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) return false;

  // Le hachage est celui de Better Auth : le compte pourra se connecter normalement.
  const context = await auth.$context;
  const passwordHash = await context.password.hash(input.password);
  const id = randomUUID();

  await db.user.create({
    data: {
      id,
      name: input.name,
      email: input.email,
      emailVerified: true,
      role: input.role,
      mustChangePassword: input.mustChangePassword,
      accounts: { create: { accountId: id, providerId: "credential", password: passwordHash } },
    },
  });
  await db.auditLog.create({
    data: { actorUserId: null, action: "user.seeded", entityType: "user", entityId: id, metadata: { role: input.role } },
  });
  return true;
}

// Produits proposés : « Individuelle Accident » vient de l'exemple de l'Excel, les autres de la charte graphique
// (gamme SECUR et RELAX). Liste initiale à valider par le métier ; elle est ensuite administrable.
const PRODUCTS = [
  { code: "individuelle-accident", label: "Individuelle Accident" },
  { code: "relax-moto", label: "RELAX Moto" },
  { code: "secur-moto", label: "SECUR Moto" },
  { code: "relax-auto", label: "RELAX Auto" },
  { code: "secur-maison", label: "SECUR Maison" },
  { code: "secur-maison-plus", label: "SECUR Maison+" },
  { code: "relax-sante", label: "RELAX Santé" },
];

async function seedProducts() {
  for (const [index, product] of PRODUCTS.entries()) {
    // update vide : ne jamais écraser une modification faite depuis l'administration.
    await db.product.upsert({ where: { code: product.code }, update: {}, create: { ...product, sortOrder: index } });
  }
  console.log(`Produits : ${PRODUCTS.length} vérifié(s).`);
}

type DemoStep = { daysAgo: number; progress: number; revenue?: number };
type DemoLead = {
  company: string;
  sector: string;
  contact: [string, string, string];
  steps: DemoStep[];
  /** Perdu après la dernière étape, `lostDaysAgo` jours avant maintenant. */
  lost?: { daysAgo: number; reason: string };
};

// Historique étalé sur 5 semaines : alimente les KPI « vs semaine dernière » et l'histogramme du pipeline.
const DEMO_LEADS: DemoLead[] = [
  { company: "Abidjan Mines SA", sector: "Mine et énergie", contact: ["Koffi", "Gado", "Responsable achats"], steps: [{ daysAgo: 30, progress: 10 }, { daysAgo: 26, progress: 20 }, { daysAgo: 20, progress: 40 }, { daysAgo: 12, progress: 60, revenue: 6245790 }, { daysAgo: 5, progress: 80, revenue: 9800000 }] },
  { company: "Barold Transport", sector: "Transport et logistique", contact: ["Awa", "Traoré", "Directrice générale"], steps: [{ daysAgo: 28, progress: 10 }, { daysAgo: 22, progress: 20 }, { daysAgo: 9, progress: 40 }] },
  { company: "Agro Ivoire", sector: "Agriculture et agro-industrie", contact: ["Yao", "Kouassi", "Responsable RH"], steps: [{ daysAgo: 3, progress: 10 }] },
  { company: "Nova Bank CI", sector: "Banque et finance", contact: ["Mariam", "Diallo", "Directrice administrative"], steps: [{ daysAgo: 2, progress: 10 }, { daysAgo: 1, progress: 20 }] },
  { company: "Hôtel Les Palmes", sector: "Hôtellerie et restauration", contact: ["Serge", "N'Guessan", "Gérant"], steps: [{ daysAgo: 16, progress: 10 }, { daysAgo: 11, progress: 40 }, { daysAgo: 6, progress: 60, revenue: 3200000 }, { daysAgo: 1, progress: 90, revenue: 4100000 }] },
  { company: "Clinique Sainte-Marie", sector: "Santé", contact: ["Fatou", "Coulibaly", "Directrice"], steps: [{ daysAgo: 25, progress: 10 }, { daysAgo: 18, progress: 40 }, { daysAgo: 10, progress: 60, revenue: 5245875 }, { daysAgo: 2, progress: 100, revenue: 5245875 }] },
  { company: "BTP Plateau", sector: "BTP et immobilier", contact: ["Ibrahim", "Sanogo", "Directeur des achats"], steps: [{ daysAgo: 27, progress: 10 }, { daysAgo: 21, progress: 60, revenue: 7000000 }], lost: { daysAgo: 4, reason: "competition" } },
  { company: "Cacao Export SARL", sector: "Agriculture et agro-industrie", contact: ["Adjoua", "Bamba", "Responsable achats"], steps: [{ daysAgo: 9, progress: 10 }, { daysAgo: 8, progress: 20 }, { daysAgo: 7, progress: 40 }, { daysAgo: 6, progress: 60, revenue: 2100000 }] },
  { company: "Télécom Express", sector: "Télécommunications et numérique", contact: ["Jean", "Kra", "Directeur financier"], steps: [{ daysAgo: 34, progress: 10 }, { daysAgo: 30, progress: 20 }, { daysAgo: 24, progress: 40 }, { daysAgo: 17, progress: 60, revenue: 12000000 }, { daysAgo: 13, progress: 80, revenue: 12500000 }, { daysAgo: 8, progress: 100, revenue: 12500000 }] },
  { company: "Pharma Plus", sector: "Santé", contact: ["Nadège", "Ouattara", "Pharmacienne titulaire"], steps: [{ daysAgo: 14, progress: 10 }, { daysAgo: 13, progress: 20 }, { daysAgo: 12, progress: 40 }, { daysAgo: 10, progress: 60, revenue: 1800000 }, { daysAgo: 4, progress: 80, revenue: 2000000 }] },
  { company: "École Les Lauréats", sector: "Éducation", contact: ["Paul", "Aka", "Directeur"], steps: [{ daysAgo: 20, progress: 10 }, { daysAgo: 19, progress: 40 }], lost: { daysAgo: 7, reason: "price" } },
  { company: "Imprimerie Centrale", sector: "Industrie", contact: ["Salif", "Konaté", "Responsable achats"], steps: [{ daysAgo: 1, progress: 10 }] },
];

/** Équipe de démonstration : le manager voit les prospects de ses membres (périmètre « manager »). */
async function seedDemoTeam() {
  const manager = await db.user.findUnique({ where: { email: "manager@crm.local" }, select: { id: true } });
  if (!manager) return;

  const team = await db.team.upsert({
    where: { name: "Équipe démo" },
    update: {},
    create: { name: "Équipe démo", managerUserId: manager.id },
  });
  await db.user.updateMany({
    where: { email: { in: ["manager@crm.local", "commercial@crm.local"] }, teamId: null },
    data: { teamId: team.id },
  });
}

/** Comptes et contacts de démonstration : un groupe avec filiales, des clients, des contacts multi-comptes et leurs rôles. */
async function seedDemoAccounts(ownerEmail: string) {
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (!owner || (await db.crmAccount.count({ where: { ownerUserId: owner.id } })) > 0) return 0;

  const products = await db.product.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } });
  const account = (data: Omit<Prisma.CrmAccountUncheckedCreateInput, "ownerUserId">) =>
    db.crmAccount.create({ data: { country: "CI", ...data, ownerUserId: owner.id } });

  const group = await account({
    legalName: "Groupe Ouattara Holding",
    sector: "Services aux entreprises",
    status: "client",
    legalIdentifier: "CI-ABJ-2015-B-10001",
    city: "Abidjan",
    employeeCount: 850,
    revenueAmount: 42_000_000_000,
    revenueYear: 2025,
    revenueSource: "Bilan consolidé 2025",
    phone: "0102030405",
    emailDomain: "ouattara-holding.ci",
    source: "referral",
  });
  const transport = await account({
    legalName: "Ouattara Transport",
    sector: "Transport et logistique",
    status: "client",
    legalIdentifier: "CI-ABJ-2016-B-20002",
    city: "Abidjan",
    employeeCount: 320,
    parentAccountId: group.id,
    emailDomain: "ouattara-transport.ci",
  });
  await account({
    legalName: "Ouattara Agro",
    sector: "Agriculture et agro-industrie",
    status: "prospect",
    city: "Yamoussoukro",
    parentAccountId: group.id,
  });
  const clinique = await account({
    legalName: "Clinique Sainte-Marie",
    sector: "Santé",
    status: "client",
    legalIdentifier: "CI-ABJ-2012-B-30003",
    city: "Abidjan",
    employeeCount: 140,
    phone: "0709090909",
    source: "event",
  });
  await account({ legalName: "Imprimerie Centrale", sector: "Industrie", status: "prospect", city: "Bouaké" });

  const contact = (firstName: string, lastName: string, jobTitle: string, extra: Record<string, string> = {}) =>
    db.contact.create({
      data: {
        firstName,
        lastName,
        jobTitle,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, "")}@demo.ci`,
        ownerUserId: owner.id,
        ...extra,
      },
    });
  const link = (accountId: string, contactId: string, title: string, isPrimary = false) =>
    db.accountContact.create({ data: { accountId, contactId, relationshipTitle: title, isPrimary } });
  const role = (accountId: string, contactId: string, roleType: string, productIndex: number | null, influence: string) =>
    db.contactRole.create({
      data: { accountId, contactId, roleType, influence, productId: productIndex === null ? null : products[productIndex]?.id },
    });

  const amadou = await contact("Amadou", "Ouattara", "Président-directeur général");
  await link(group.id, amadou.id, "Président du groupe", true);
  await link(transport.id, amadou.id, "Administrateur");
  await role(group.id, amadou.id, "decision_maker", null, "high");
  await role(transport.id, amadou.id, "validator", 4, "high");

  const fatou = await contact("Fatou", "Diabaté", "Directrice financière");
  await link(transport.id, fatou.id, "Directrice financière", true);
  await role(transport.id, fatou.id, "buyer", 0, "medium");
  await role(transport.id, fatou.id, "buyer", 3, "medium");

  const marc = await contact("Marc", "Bamba", "Responsable des assurances");
  await link(group.id, marc.id, "Responsable des assurances");
  await role(group.id, marc.id, "prescriber", null, "medium");

  const aicha = await contact("Aïcha", "Koné", "Directrice générale", { status: "to_confirm" });
  await link(clinique.id, aicha.id, "Directrice générale", true);
  await role(clinique.id, aicha.id, "decision_maker", 6, "high");

  return 5;
}

async function seedDemoLeads(ownerEmail: string) {
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (!owner || (await db.lead.count({ where: { ownerUserId: owner.id } })) > 0) return 0;

  const products = await db.product.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } });
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

  for (const [index, demo] of DEMO_LEADS.entries()) {
    const last = demo.steps[demo.steps.length - 1];
    const status = demo.lost ? "lost" : last.progress === 100 ? "won" : "open";
    const revenue = [...demo.steps].reverse().find((step) => step.revenue !== undefined)?.revenue ?? null;
    const first = at(demo.steps[0].daysAgo);

    const events = demo.steps.map((step, i) => ({
      occurredAt: at(step.daysAgo),
      actorUserId: owner.id,
      type: i === 0 ? "created" : step.progress === 100 ? "won" : "progress_changed",
      fromProgress: i === 0 ? null : demo.steps[i - 1].progress,
      toProgress: step.progress,
      status: step.progress === 100 ? "won" : "open",
      expectedRevenue: step.revenue ?? null,
    }));
    if (demo.lost) {
      events.push({
        occurredAt: at(demo.lost.daysAgo),
        actorUserId: owner.id,
        type: "lost",
        fromProgress: last.progress,
        toProgress: last.progress,
        status: "lost",
        expectedRevenue: revenue,
      });
    }

    await db.lead.create({
      data: {
        companyName: demo.company,
        sector: demo.sector,
        contactFirstName: demo.contact[0],
        contactLastName: demo.contact[1],
        jobTitle: demo.contact[2],
        phone: `07${String(10000000 + index * 1234567).slice(0, 8)}`,
        email: `${demo.contact[0].toLowerCase()}.${demo.contact[1].toLowerCase().replace(/[^a-z]/g, "")}@demo.ci`,
        insertedOn: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())),
        progress: last.progress,
        status,
        productId: revenue === null ? null : products[index % products.length].id,
        expectedRevenue: revenue,
        lossReason: demo.lost?.reason ?? null,
        closedAt: status === "open" ? null : at(demo.lost?.daysAgo ?? last.daysAgo),
        ownerUserId: owner.id,
        events: { create: events },
      },
    });
  }
  return DEMO_LEADS.length;
}

/** Opportunités de démonstration : une par étape ouverte, plus une gagnée et une perdue, rattachées aux comptes de démo. */
async function seedDemoOpportunities(ownerEmail: string) {
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (!owner || (await db.opportunity.count({ where: { ownerUserId: owner.id } })) > 0) return 0;

  const accounts = await db.crmAccount.findMany({ where: { ownerUserId: owner.id }, select: { id: true, legalName: true } });
  const accountId = (name: string) => accounts.find((a) => a.legalName === name)?.id;
  const products = await db.product.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } });
  const inDays = (days: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + days));

  const demo = [
    { account: "Ouattara Agro", name: "Ouattara Agro – prévoyance collective", stage: 10, amount: 0, action: "Premier appel de découverte", actionIn: 2, closeIn: 90, product: 0 },
    { account: "Imprimerie Centrale", name: "Imprimerie Centrale – santé groupe", stage: 20, amount: 0, action: "Planifier un rendez-vous", actionIn: 5, closeIn: 75, product: 1 },
    { account: "Ouattara Transport", name: "Ouattara Transport – flotte automobile", stage: 40, amount: 8_500_000, action: "Envoyer le questionnaire de risque", actionIn: -3, closeIn: 45, product: 2 },
    { account: "Clinique Sainte-Marie", name: "Clinique Sainte-Marie – responsabilité civile", stage: 60, amount: 4_200_000, action: "Présenter la proposition", actionIn: 4, closeIn: 30, product: 3 },
    { account: "Groupe Ouattara Holding", name: "Groupe Ouattara – assurance groupe", stage: 80, amount: 25_000_000, action: "Négocier les conditions", actionIn: 1, closeIn: 20, product: 4 },
    { account: "Ouattara Transport", name: "Ouattara Transport – marchandises transportées", stage: 90, amount: 6_000_000, action: "Préparer le contrat à signer", actionIn: 3, closeIn: 10, product: 0 },
  ];

  let count = 0;
  for (const item of demo) {
    const id = accountId(item.account);
    if (!id) continue;
    const productId = products[item.product % products.length]?.id ?? null;
    await db.opportunity.create({
      data: {
        name: item.name,
        accountId: id,
        ownerUserId: owner.id,
        // Au-delà du seuil de qualification, produit et montant sont obligatoires.
        productId,
        amount: item.amount,
        revenuePeriod: "annual",
        stage: item.stage,
        expectedCloseDate: inDays(item.closeIn),
        nextAction: item.action,
        nextActionDate: inDays(item.actionIn),
        events: { create: { actorUserId: owner.id, type: "created", toStage: item.stage, status: "open", amount: item.amount, expectedCloseDate: inDays(item.closeIn) } },
      },
    });
    count += 1;
  }

  const closedId = accountId("Clinique Sainte-Marie");
  if (closedId) {
    const closedAt = new Date(Date.now() - 12 * 86_400_000);
    await db.opportunity.create({
      data: {
        name: "Clinique Sainte-Marie – santé du personnel",
        accountId: closedId,
        ownerUserId: owner.id,
        productId: products[1]?.id ?? null,
        amount: 9_800_000,
        revenuePeriod: "annual",
        stage: 100,
        status: "won",
        closedAt,
        events: { create: { actorUserId: owner.id, type: "won", fromStage: 90, toStage: 100, status: "won", amount: 9_800_000, occurredAt: closedAt } },
      },
    });
    count += 1;
  }
  const lostId = accountId("Ouattara Agro");
  if (lostId) {
    const closedAt = new Date(Date.now() - 20 * 86_400_000);
    await db.opportunity.create({
      data: {
        name: "Ouattara Agro – assurance récolte",
        accountId: lostId,
        ownerUserId: owner.id,
        productId: products[2]?.id ?? null,
        amount: 3_000_000,
        revenuePeriod: "annual",
        stage: 40,
        status: "lost",
        lossReason: "price",
        closedAt,
        events: { create: { actorUserId: owner.id, type: "lost", fromStage: 40, toStage: 40, status: "lost", amount: 3_000_000, occurredAt: closedAt } },
      },
    });
    count += 1;
  }
  return count;
}

/** Activités et tâches de démonstration : un historique réaliste, une tâche en retard et une tâche du jour. */
async function seedDemoActivity(ownerEmail: string) {
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (!owner || (await db.activity.count({ where: { authorUserId: owner.id } })) > 0) return { activities: 0, tasks: 0 };

  const accounts = await db.crmAccount.findMany({ where: { ownerUserId: owner.id }, select: { id: true, legalName: true } });
  const opportunities = await db.opportunity.findMany({ where: { ownerUserId: owner.id }, select: { id: true, name: true, accountId: true } });
  const contacts = await db.contact.findMany({ where: { ownerUserId: owner.id }, select: { id: true, lastName: true } });
  const accountId = (name: string) => accounts.find((a) => a.legalName === name)?.id;
  const opportunityId = (part: string) => opportunities.find((o) => o.name.includes(part))?.id;
  const contactId = (lastName: string) => contacts.find((c) => c.lastName === lastName)?.id;
  const ago = (days: number, hour = 9) => {
    const base = new Date(Date.now() - days * 86_400_000);
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour));
  };
  const inDays = (days: number) => {
    const base = new Date(Date.now() + days * 86_400_000);
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  };

  const activities = [
    { type: "call_out", subject: "Appel de découverte du besoin", account: "Ouattara Transport", opportunity: "flotte", contact: "Diabaté", outcome: "Flotte de 42 véhicules ; renouvellement en janvier.", daysAgo: 21 },
    { type: "meeting", subject: "Rendez-vous sur site", account: "Ouattara Transport", opportunity: "flotte", contact: "Diabaté", outcome: "Visite du parc ; questionnaire de risque remis.", daysAgo: 14 },
    { type: "email", subject: "Envoi du questionnaire de risque", account: "Ouattara Transport", opportunity: "flotte", contact: "Diabaté", outcome: null, daysAgo: 9 },
    { type: "proposal_sent", subject: "Proposition commerciale envoyée", account: "Clinique Sainte-Marie", opportunity: "responsabilité civile", contact: "Koné", outcome: "En attente de la validation de la direction.", daysAgo: 4 },
    { type: "video", subject: "Point de négociation", account: "Groupe Ouattara Holding", opportunity: "assurance groupe", contact: "Ouattara", outcome: "Demande de remise de 5 % ; contre-proposition à étudier.", daysAgo: 2 },
    { type: "note", subject: "Compte à suivre de près", account: "Imprimerie Centrale", opportunity: null, contact: null, outcome: "Premier contact par téléphone, décideur absent.", daysAgo: 1 },
  ];
  let activityCount = 0;
  for (const item of activities) {
    const account = accountId(item.account);
    if (!account) continue;
    await db.activity.create({
      data: {
        type: item.type,
        subject: item.subject,
        occurredAt: ago(item.daysAgo),
        authorUserId: owner.id,
        accountId: account,
        contactId: item.contact ? (contactId(item.contact) ?? null) : null,
        opportunityId: item.opportunity ? (opportunityId(item.opportunity) ?? null) : null,
        outcome: item.outcome,
      },
    });
    activityCount += 1;
  }

  const tasks = [
    { title: "Relancer pour le questionnaire de risque", account: "Ouattara Transport", opportunity: "flotte", due: inDays(-3), priority: "high" },
    { title: "Préparer la contre-proposition", account: "Groupe Ouattara Holding", opportunity: "assurance groupe", due: inDays(0), priority: "high" },
    { title: "Appeler la direction de la clinique", account: "Clinique Sainte-Marie", opportunity: "responsabilité civile", due: inDays(3), priority: "normal" },
    { title: "Qualifier le décideur d'Imprimerie Centrale", account: "Imprimerie Centrale", opportunity: null, due: inDays(7), priority: "low" },
  ];
  let taskCount = 0;
  for (const item of tasks) {
    const account = accountId(item.account);
    if (!account) continue;
    await db.task.create({
      data: {
        title: item.title,
        dueDate: item.due,
        priority: item.priority,
        assigneeUserId: owner.id,
        createdByUserId: owner.id,
        accountId: account,
        opportunityId: item.opportunity ? (opportunityId(item.opportunity) ?? null) : null,
      },
    });
    taskCount += 1;
  }
  return { activities: activityCount, tasks: taskCount };
}

async function main() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Variables SEED_* invalides :", z.flattenError(parsed.error).fieldErrors);
    process.exitCode = 1;
    return;
  }
  const env = parsed.data;

  // Le mot de passe initial de l'administrateur est connu de celui qui lance le seed :
  // changement obligatoire à la première connexion.
  const adminCreated = await createUser({
    email: env.SEED_ADMIN_EMAIL,
    name: env.SEED_ADMIN_NAME,
    role: "admin",
    password: env.SEED_ADMIN_PASSWORD,
    mustChangePassword: true,
  });
  console.log(
    adminCreated
      ? `Administrateur créé : ${env.SEED_ADMIN_EMAIL} (changement de mot de passe exigé à la première connexion).`
      : `L'administrateur ${env.SEED_ADMIN_EMAIL} existe déjà.`,
  );

  await seedProducts();

  if (process.env.NODE_ENV === "production") {
    if (env.SEED_DEMO_PASSWORD) console.warn("SEED_DEMO_PASSWORD ignoré : comptes de démonstration interdits en production.");
    return;
  }

  if (env.SEED_DEMO_PASSWORD) {
    let created = 0;
    for (const user of DEMO_USERS) {
      const ok = await createUser({ ...user, password: env.SEED_DEMO_PASSWORD, mustChangePassword: false });
      if (ok) created += 1;
    }
    console.log(`Comptes de démonstration : ${created} créé(s) sur ${DEMO_USERS.length}.`);

    await seedDemoTeam();

    const accounts = await seedDemoAccounts("commercial@crm.local");
    console.log(`Comptes de démonstration : ${accounts} créé(s) pour commercial@crm.local.`);

    const leads = await seedDemoLeads("commercial@crm.local");
    console.log(`Prospects de démonstration : ${leads} créé(s) pour commercial@crm.local.`);

    const opportunities = await seedDemoOpportunities("commercial@crm.local");
    console.log(`Opportunités de démonstration : ${opportunities} créée(s) pour commercial@crm.local.`);

    const activity = await seedDemoActivity("commercial@crm.local");
    console.log(`Activités de démonstration : ${activity.activities} créée(s), ${activity.tasks} tâche(s) pour commercial@crm.local.`);
  }
}

main()
  .catch((error) => {
    console.error("Échec du seed :", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
