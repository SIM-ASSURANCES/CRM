import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateAccountInput } from "@/features/accounts/schemas";
import type { CreateContactInput } from "@/features/contacts/schemas";
import type { Role } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/auth/session";

// Tests des comptes et contacts sur la base dédiée (TEST_DATABASE_URL, voir tests/setup.ts).
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

type Db = (typeof import("@/lib/db"))["db"];
type Accounts = typeof import("@/features/accounts/service");
type Contacts = typeof import("@/features/contacts/service");

describe.skipIf(!hasDb)("comptes et contacts (PostgreSQL)", () => {
  let db: Db;
  let acc: Accounts;
  let con: Contacts;
  let teamId: string;
  let productId: string;
  let a: CurrentUser; // commercial A (équipe)
  let b: CurrentUser; // commercial B (hors équipe)
  let manager: CurrentUser; // manager de l'équipe
  let direction: CurrentUser;
  let audit: CurrentUser;

  const uniq = () => randomUUID().slice(0, 8);

  async function makeUser(role: Role, label: string, team: string | null = null): Promise<CurrentUser> {
    const user = await db.user.create({
      data: {
        name: label,
        email: `${label.toLowerCase().replace(/\W+/g, "-")}-${uniq()}@test.local`,
        role,
        teamId: team,
        emailVerified: true,
      },
    });
    return { id: user.id, name: user.name, email: user.email, role, teamId: team, mustChangePassword: false };
  }

  function accountInput(over: Partial<CreateAccountInput> = {}): CreateAccountInput {
    const id = uniq();
    return {
      legalName: `Entreprise ${id}`,
      sector: "Santé",
      status: "prospect",
      country: "CI",
      forceDuplicate: false,
      ...over,
    };
  }

  function contactInput(over: Partial<CreateContactInput> = {}): CreateContactInput {
    const id = uniq();
    return { firstName: "Yao", lastName: `Nom${id}`, status: "active", forceDuplicate: false, ...over };
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    acc = await import("@/features/accounts/service");
    con = await import("@/features/contacts/service");

    teamId = (await db.team.create({ data: { name: `Équipe comptes ${uniq()}` } })).id;
    a = await makeUser("commercial", "Commercial Alpha", teamId);
    b = await makeUser("commercial", "Commercial Beta");
    manager = await makeUser("manager", "Manager Équipe", teamId);
    direction = await makeUser("direction", "Direction Comptes");
    audit = await makeUser("audit", "Audit Comptes");
    productId = (
      await db.product.upsert({ where: { code: "test-produit" }, update: {}, create: { code: "test-produit", label: "Produit test" } })
    ).id;
  });

  beforeEach(async () => {
    await db.contactRole.deleteMany();
    await db.accountContact.deleteMany();
    await db.contact.deleteMany();
    // Les filiales d'abord (clé étrangère vers le parent), puis le reste.
    await db.crmAccount.updateMany({ data: { parentAccountId: null, mergedIntoId: null } });
    await db.crmAccount.deleteMany();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe("création et périmètre (REC-01, REC-09)", () => {
    it("rattache le compte à son créateur, l'audite, et le rend invisible aux autres commerciaux", async () => {
      const { id } = await acc.createAccount(a, accountInput({ legalName: "Compte d'Alpha" }));

      const detail = await acc.getAccount(a, id);
      expect(detail).toMatchObject({ legalName: "Compte d'Alpha", ownerName: "Commercial Alpha", status: "prospect", country: "CI" });
      expect((await db.auditLog.findFirst({ where: { entityId: id, action: "account.created" } }))?.actorUserId).toBe(a.id);

      await expect(acc.getAccount(b, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(acc.getAccount(direction, id)).resolves.toMatchObject({ id });
      await expect(acc.getAccount(audit, id)).resolves.toMatchObject({ id });
      expect((await acc.listAccounts(b)).total).toBe(0);
    });

    it("laisse un manager voir les comptes de son équipe, et seulement ceux-là", async () => {
      const teamAccount = await acc.createAccount(a, accountInput());
      await acc.createAccount(b, accountInput());

      const visible = await acc.listAccounts(manager);
      expect(visible.rows.map((r) => r.id)).toEqual([teamAccount.id]);
    });

    it("refuse l'écriture à l'audit et à un utilisateur sans droit", async () => {
      await expect(acc.createAccount(audit, accountInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("n'accorde le choix du propriétaire qu'à ceux qui peuvent réaffecter", async () => {
      const byCommercial = await acc.createAccount(a, accountInput({ ownerUserId: b.id }));
      expect((await acc.getAccount(direction, byCommercial.id)).ownerUserId).toBe(a.id);

      const byDirection = await acc.createAccount(direction, accountInput({ ownerUserId: b.id }));
      expect((await acc.getAccount(direction, byDirection.id)).ownerUserId).toBe(b.id);
    });

    it("refuse un propriétaire désactivé ou en lecture seule", async () => {
      await expect(acc.createAccount(direction, accountInput({ ownerUserId: audit.id }))).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("doublons (REC-02)", () => {
    it("détecte une raison sociale, un domaine e-mail ou un téléphone déjà connus", async () => {
      const first = accountInput({ legalName: "Barold Transport", emailDomain: "barold.ci", phone: "0707353673" });
      await acc.createAccount(a, first);

      await expect(acc.createAccount(a, accountInput({ legalName: "BAROLD TRANSPORT" }))).rejects.toMatchObject({
        code: "CONFLICT",
        details: { duplicates: [expect.objectContaining({ matchedOn: ["raison sociale"] })] },
      });
      await expect(acc.createAccount(a, accountInput({ emailDomain: "barold.ci" }))).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(acc.createAccount(a, accountInput({ phone: "0707353673" }))).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("accepte la création si l'utilisateur confirme que ce n'est pas un doublon", async () => {
      await acc.createAccount(a, accountInput({ legalName: "Homonyme SA" }));
      await expect(acc.createAccount(a, accountInput({ legalName: "Homonyme SA", forceDuplicate: true }))).resolves.toBeDefined();
    });

    it("ne révèle pas l'identifiant d'un compte hors périmètre", async () => {
      await acc.createAccount(a, accountInput({ legalName: "Secret Alpha" }));
      try {
        await acc.createAccount(b, accountInput({ legalName: "Secret Alpha" }));
        expect.unreachable();
      } catch (error) {
        const duplicates = (error as { details: { duplicates: { id: string | null; ownerName: string }[] } }).details.duplicates;
        expect(duplicates[0]).toMatchObject({ id: null, ownerName: "Commercial Alpha" });
      }
    });

    it("interdit deux comptes actifs avec le même identifiant légal, même en forçant", async () => {
      await acc.createAccount(a, accountInput({ legalIdentifier: "CI-ABJ-0001" }));
      await expect(
        acc.createAccount(a, accountInput({ legalIdentifier: "ci-abj-0001", forceDuplicate: true })),
      ).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { legalIdentifier: expect.any(Array) } },
      });
      // Le même identifiant dans un autre pays est autorisé.
      await expect(acc.createAccount(a, accountInput({ legalIdentifier: "CI-ABJ-0001", country: "SN" }))).resolves.toBeDefined();
    });
  });

  describe("hiérarchie groupe / filiale (CDC 3.2)", () => {
    it("rattache des filiales et affiche la vue groupe", async () => {
      const group = await acc.createAccount(a, accountInput({ legalName: "Groupe Alpha" }));
      const sub1 = await acc.createAccount(a, accountInput({ legalName: "Filiale 1", parentAccountId: group.id }));
      await acc.createAccount(a, accountInput({ legalName: "Sous-filiale", parentAccountId: sub1.id }));

      const detail = await acc.getAccount(a, group.id);
      expect(detail.children.map((c) => c.legalName)).toEqual(["Filiale 1"]);
      expect(detail.groupSummary.subsidiaries).toBe(2);
      expect((await acc.getAccount(a, sub1.id)).parent?.legalName).toBe("Groupe Alpha");
    });

    it("refuse un cycle : un groupe ne peut pas devenir la filiale de sa propre filiale", async () => {
      const group = await acc.createAccount(a, accountInput({ legalName: "Groupe" }));
      const sub = await acc.createAccount(a, accountInput({ legalName: "Filiale", parentAccountId: group.id }));
      const subsub = await acc.createAccount(a, accountInput({ legalName: "Sous-filiale", parentAccountId: sub.id }));

      const detail = await acc.getAccount(a, group.id);
      const base = { ...accountInput(), legalName: "Groupe", id: group.id, version: detail.version };
      await expect(acc.updateAccount(a, { ...base, parentAccountId: subsub.id })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(acc.updateAccount(a, { ...base, parentAccountId: group.id })).rejects.toMatchObject({ code: "VALIDATION" });
      expect((await acc.getAccount(a, group.id)).parentAccountId).toBeNull();
    });

    it("refuse de rattacher à un compte que l'on ne voit pas", async () => {
      const others = await acc.createAccount(b, accountInput());
      await expect(acc.createAccount(a, accountInput({ parentAccountId: others.id }))).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { parentAccountId: expect.any(Array) } },
      });
    });

    it("conserve les droits de chaque compte : une filiale hors périmètre n'est pas montrée, seulement comptée", async () => {
      const group = await acc.createAccount(a, accountInput({ legalName: "Groupe visible" }));
      const own = await acc.createAccount(a, accountInput({ legalName: "Filiale d'Alpha", parentAccountId: group.id }));
      const foreign = await acc.createAccount(direction, accountInput({ legalName: "Filiale de Beta", parentAccountId: group.id }));
      await db.crmAccount.update({ where: { id: foreign.id }, data: { ownerUserId: b.id } });

      const asAlpha = await acc.getAccount(a, group.id);
      expect(asAlpha.children.map((c) => c.id)).toEqual([own.id]);
      expect(asAlpha.restrictedChildren).toBe(1);
      expect(asAlpha.groupSummary.subsidiaries).toBe(1);

      const asDirection = await acc.getAccount(direction, group.id);
      expect(asDirection.children).toHaveLength(2);
      expect(asDirection.restrictedChildren).toBe(0);
    });

    it("masque le compte parent s'il est hors périmètre", async () => {
      const group = await acc.createAccount(direction, accountInput({ legalName: "Groupe fermé" }));
      const sub = await acc.createAccount(direction, accountInput({ legalName: "Filiale ouverte", parentAccountId: group.id }));
      await db.crmAccount.update({ where: { id: sub.id }, data: { ownerUserId: a.id } });

      const detail = await acc.getAccount(a, sub.id);
      expect(detail.parent).toBeNull();
      expect(detail.parentRestricted).toBe(true);
    });
  });

  describe("modification et réaffectation", () => {
    it("refuse une modification faite sur une version périmée", async () => {
      const created = await acc.createAccount(a, accountInput({ legalName: "Version" }));
      const { version } = await acc.getAccount(a, created.id);
      const edit = { ...accountInput(), legalName: "Version", id: created.id, version };

      await acc.updateAccount(a, { ...edit, city: "Abidjan" });
      await expect(acc.updateAccount(a, { ...edit, city: "Bouaké" })).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("trace le changement de propriétaire, réservé au manager et à la direction", async () => {
      const created = await acc.createAccount(a, accountInput({ legalName: "À réaffecter" }));
      const { version } = await acc.getAccount(a, created.id);
      const edit = { ...accountInput(), legalName: "À réaffecter", id: created.id, version };

      // Le commercial ne peut pas se défaire du compte : la demande de changement est ignorée.
      await acc.updateAccount(a, { ...edit, ownerUserId: b.id });
      expect((await acc.getAccount(direction, created.id)).ownerUserId).toBe(a.id);

      await acc.updateAccount(manager, { ...edit, version: version + 1, ownerUserId: manager.id });
      expect((await acc.getAccount(direction, created.id)).ownerUserId).toBe(manager.id);

      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: created.id, action: "account.owner_changed" } });
      expect(trace.metadata).toMatchObject({ fromOwnerId: a.id, toOwnerId: manager.id });
    });

    it("n'écrit dans l'audit que des noms de champs", async () => {
      const created = await acc.createAccount(a, accountInput({ legalName: "Audit champs" }));
      const { version } = await acc.getAccount(a, created.id);
      await acc.updateAccount(a, { ...accountInput(), legalName: "Audit champs", id: created.id, version, phone: "0102030405" });

      const trace = await db.auditLog.findFirstOrThrow({ where: { entityId: created.id, action: "account.updated" } });
      expect(trace.metadata).toMatchObject({ changedFields: ["phone"] });
      expect(JSON.stringify(trace.metadata)).not.toContain("0102030405");
    });

    it("indique les champs manquants et la complétude (parcours CDC 13.1)", async () => {
      const created = await acc.createAccount(a, accountInput({ city: "Abidjan" }));
      const detail = await acc.getAccount(a, created.id);
      expect(detail.missing.required).toEqual([]);
      expect(detail.missing.recommended).toEqual(expect.arrayContaining(["Identifiant légal", "Téléphone"]));
      expect(detail.completeness).toBeGreaterThan(0);
      expect(detail.completeness).toBeLessThan(100);
    });
  });

  describe("contacts multi-comptes et rôles d'achat (REC-03)", () => {
    it("rattache un contact à un compte : le premier devient principal, un nouveau principal remplace l'ancien", async () => {
      const account = await acc.createAccount(a, accountInput());
      const first = await con.createContact(a, contactInput({ accountId: account.id }));
      const second = await con.createContact(a, contactInput({ accountId: account.id }));

      let contacts = (await acc.getAccount(a, account.id)).contacts;
      expect(contacts.find((c) => c.contactId === first.id)?.isPrimary).toBe(true);
      expect(contacts.find((c) => c.contactId === second.id)?.isPrimary).toBe(false);

      await con.linkContact(a, { contactId: second.id, accountId: account.id, isPrimary: true });
      contacts = (await acc.getAccount(a, account.id)).contacts;
      expect(contacts.filter((c) => c.isPrimary).map((c) => c.contactId)).toEqual([second.id]);
    });

    it("rattache un même contact à plusieurs comptes avec des fonctions différentes", async () => {
      const one = await acc.createAccount(a, accountInput());
      const two = await acc.createAccount(a, accountInput());
      const contact = await con.createContact(a, contactInput({ accountId: one.id, relationshipTitle: "Directeur financier" }));
      await con.linkContact(a, { contactId: contact.id, accountId: two.id, relationshipTitle: "Administrateur", isPrimary: false });

      const detail = await con.getContact(a, contact.id);
      expect(detail.links.map((l) => [l.accountId, l.relationshipTitle]).sort()).toEqual(
        [
          [one.id, "Directeur financier"],
          [two.id, "Administrateur"],
        ].sort(),
      );
    });

    it("qualifie le rôle d'achat par compte et par produit, sans doublon", async () => {
      const account = await acc.createAccount(a, accountInput());
      const contact = await con.createContact(a, contactInput({ accountId: account.id }));

      await con.addRole(a, { contactId: contact.id, accountId: account.id, roleType: "decision_maker", productId, influence: "high" });
      await con.addRole(a, { contactId: contact.id, accountId: account.id, roleType: "decision_maker" });
      await expect(
        con.addRole(a, { contactId: contact.id, accountId: account.id, roleType: "decision_maker", productId }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        con.addRole(a, { contactId: contact.id, accountId: account.id, roleType: "decision_maker" }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const roles = (await con.getContact(a, contact.id)).links[0].roles;
      expect(roles).toHaveLength(2);
      expect(roles.find((r) => r.productLabel === "Produit test")).toMatchObject({ roleType: "decision_maker", influence: "high" });
    });

    it("refuse un rôle pour un contact non rattaché au compte", async () => {
      const account = await acc.createAccount(a, accountInput());
      const other = await acc.createAccount(a, accountInput());
      const contact = await con.createContact(a, contactInput({ accountId: account.id }));
      await expect(con.addRole(a, { contactId: contact.id, accountId: other.id, roleType: "buyer" })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    });

    it("supprime les rôles avec le rattachement", async () => {
      const account = await acc.createAccount(a, accountInput());
      const contact = await con.createContact(a, contactInput({ accountId: account.id }));
      await con.addRole(a, { contactId: contact.id, accountId: account.id, roleType: "validator" });

      await con.unlinkContact(a, { contactId: contact.id, accountId: account.id });
      expect(await db.contactRole.count({ where: { contactId: contact.id } })).toBe(0);
      expect((await acc.getAccount(a, account.id)).contacts).toHaveLength(0);
    });

    it("retire un rôle, mais pas hors de son périmètre", async () => {
      const account = await acc.createAccount(a, accountInput());
      const contact = await con.createContact(a, contactInput({ accountId: account.id }));
      await con.addRole(a, { contactId: contact.id, accountId: account.id, roleType: "buyer" });
      const roleId = (await db.contactRole.findFirstOrThrow({ where: { contactId: contact.id } })).id;

      await expect(con.removeRole(b, roleId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await con.removeRole(a, roleId);
      expect(await db.contactRole.count({ where: { contactId: contact.id } })).toBe(0);
    });

    it("détecte un contact en double sur l'e-mail", async () => {
      await con.createContact(a, contactInput({ email: "marie@client.ci" }));
      await expect(con.createContact(b, contactInput({ email: "marie@client.ci" }))).rejects.toMatchObject({
        code: "CONFLICT",
        details: { duplicates: [expect.objectContaining({ matchedOn: ["e-mail"] })] },
      });
      await expect(con.createContact(b, contactInput({ email: "marie@client.ci", forceDuplicate: true }))).resolves.toBeDefined();
    });
  });

  describe("visibilité des contacts", () => {
    it("rend un contact visible via un compte visible, mais ne montre que les comptes visibles", async () => {
      const accountA = await acc.createAccount(a, accountInput({ legalName: "Compte visible d'Alpha" }));
      const accountB = await acc.createAccount(b, accountInput({ legalName: "Compte secret de Beta" }));
      const contact = await con.createContact(a, contactInput({ accountId: accountA.id }));
      // Beta rattache le même contact à son propre compte.
      await db.accountContact.create({ data: { accountId: accountB.id, contactId: contact.id } });

      const asBeta = await con.getContact(b, contact.id);
      expect(asBeta.links.map((l) => l.accountName)).toEqual(["Compte secret de Beta"]);
      const asAlpha = await con.getContact(a, contact.id);
      expect(asAlpha.links.map((l) => l.accountName)).toEqual(["Compte visible d'Alpha"]);

      const listed = await con.listContacts(b);
      expect(listed.rows[0].accounts.map((x) => x.legalName)).toEqual(["Compte secret de Beta"]);
    });

    it("cache un contact sans lien avec le périmètre de l'utilisateur", async () => {
      const contact = await con.createContact(a, contactInput());
      await expect(con.getContact(b, contact.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(con.updateContact(b, { ...contactInput(), id: contact.id, version: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(con.linkContact(b, { contactId: contact.id, accountId: randomUUID(), isPrimary: false })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("refuse l'écriture des contacts à l'audit", async () => {
      await expect(con.createContact(audit, contactInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("fusion de doublons (CDC 3.2)", () => {
    it("est réservée aux profils autorisés", async () => {
      const x = await acc.createAccount(direction, accountInput());
      const y = await acc.createAccount(direction, accountInput());
      for (const user of [a, manager, audit]) {
        await expect(acc.mergeAccounts(user, { sourceId: x.id, targetId: y.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it("déplace filiales, contacts et rôles, complète les champs vides et archive le compte fusionné", async () => {
      const target = await acc.createAccount(direction, accountInput({ legalName: "Compte conservé" }));
      const source = await acc.createAccount(
        direction,
        accountInput({ legalName: "Compte en double", legalIdentifier: "CI-FUSION-1", phone: "0505050505", city: "Bouaké" }),
      );
      const child = await acc.createAccount(direction, accountInput({ legalName: "Filiale du doublon", parentAccountId: source.id }));

      const shared = await con.createContact(direction, contactInput({ accountId: source.id }));
      await con.linkContact(direction, { contactId: shared.id, accountId: target.id, isPrimary: true });
      await con.addRole(direction, { contactId: shared.id, accountId: source.id, roleType: "decision_maker", productId });
      await con.addRole(direction, { contactId: shared.id, accountId: target.id, roleType: "buyer" });
      const onlySource = await con.createContact(direction, contactInput({ firstName: "Seul" }));
      await con.linkContact(direction, { contactId: onlySource.id, accountId: source.id, isPrimary: true });

      const result = await acc.mergeAccounts(direction, { sourceId: source.id, targetId: target.id });
      expect(result).toMatchObject({ id: target.id, movedChildren: 1, movedContacts: 1 });

      const merged = await acc.getAccount(direction, target.id);
      // Champs complétés, filiale et contacts transférés.
      expect(merged).toMatchObject({ legalIdentifier: "CI-FUSION-1", phone: "0505050505", city: "Bouaké" });
      expect(merged.children.map((c) => c.id)).toEqual([child.id]);
      expect(merged.contacts.map((c) => c.contactId).sort()).toEqual([shared.id, onlySource.id].sort());
      // Un seul contact principal subsiste, le contact seul de la source n'usurpe pas ce statut.
      expect(merged.contacts.filter((c) => c.isPrimary).map((c) => c.contactId)).toEqual([shared.id]);
      // Les rôles des deux comptes sont réunis pour le contact commun.
      const sharedRoles = merged.contacts.find((c) => c.contactId === shared.id)!.roles.map((r) => r.roleType).sort();
      expect(sharedRoles).toEqual(["buyer", "decision_maker"]);

      // Le compte fusionné est archivé (jamais supprimé) et renvoie vers le compte conservé.
      const archived = await acc.getAccount(direction, source.id);
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.mergedInto).toMatchObject({ id: target.id, legalName: "Compte conservé" });
      expect((await acc.listAccounts(direction)).rows.map((r) => r.id)).not.toContain(source.id);

      const trace = await db.auditLog.findFirstOrThrow({ where: { action: "account.merged", entityId: target.id } });
      expect(trace.actorUserId).toBe(direction.id);
      expect(trace.metadata).toMatchObject({ sourceId: source.id, movedContacts: 1, movedChildren: 1 });
    });

    it("refuse de fusionner un groupe avec l'une de ses filiales", async () => {
      const group = await acc.createAccount(direction, accountInput({ legalName: "Groupe à fusionner" }));
      const sub = await acc.createAccount(direction, accountInput({ legalName: "Filiale conservée", parentAccountId: group.id }));
      await expect(acc.mergeAccounts(direction, { sourceId: group.id, targetId: sub.id })).rejects.toMatchObject({
        code: "VALIDATION",
        message: expect.stringContaining("filiale"),
      });
      expect((await acc.getAccount(direction, group.id)).archivedAt).toBeNull();
    });

    it("refuse de fusionner un compte avec lui-même ou un compte déjà archivé", async () => {
      const x = await acc.createAccount(direction, accountInput());
      const y = await acc.createAccount(direction, accountInput());
      await expect(acc.mergeAccounts(direction, { sourceId: x.id, targetId: x.id })).rejects.toMatchObject({ code: "VALIDATION" });
      await acc.mergeAccounts(direction, { sourceId: x.id, targetId: y.id });
      await expect(acc.mergeAccounts(direction, { sourceId: x.id, targetId: y.id })).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("libère l'identifiant légal du compte fusionné", async () => {
      const x = await acc.createAccount(direction, accountInput({ legalIdentifier: "CI-LIBRE-1" }));
      const y = await acc.createAccount(direction, accountInput());
      await acc.mergeAccounts(direction, { sourceId: x.id, targetId: y.id });
      // y porte désormais l'identifiant : un nouveau compte ne peut pas le réutiliser. Il est d'abord signalé comme
      // doublon ; même en forçant, l'index d'unicité de la base refuse.
      await expect(acc.createAccount(direction, accountInput({ legalIdentifier: "CI-LIBRE-1" }))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(
        acc.createAccount(direction, accountInput({ legalIdentifier: "CI-LIBRE-1", forceDuplicate: true })),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("liste et recherche", () => {
    it("filtre par texte et statut, exclut les comptes archivés et pagine", async () => {
      const marker = uniq();
      await acc.createAccount(a, accountInput({ legalName: `Alpha ${marker}`, status: "client", city: "Abidjan" }));
      await acc.createAccount(a, accountInput({ legalName: `Beta ${marker}`, status: "prospect" }));

      expect((await acc.listAccounts(a, { q: marker })).total).toBe(2);
      expect((await acc.listAccounts(a, { q: marker, status: "client" })).rows.map((r) => r.legalName)).toEqual([`Alpha ${marker}`]);
      expect((await acc.listAccounts(a, { q: "abidjan" })).total).toBe(1);

      const page = await acc.listAccounts(a, { q: marker, pageSize: 1, page: 2 });
      expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(page.rows).toHaveLength(1);
    });
  });
});
