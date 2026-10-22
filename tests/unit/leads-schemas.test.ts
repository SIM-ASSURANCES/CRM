import { describe, expect, it } from "vitest";
import {
  createLeadSchema,
  formDataToObject,
  INSERTED_ON_TODAY_MESSAGE,
  leadFieldsSchema,
  markLostSchema,
} from "@/features/leads/schemas";

/** Date du jour (UTC) décalée de `offsetDays` jours, au format AAAA-MM-JJ : la règle dépend du calendrier, rien n'est figé. */
const dayOffset = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const TODAY = dayOffset(0);

// Valeurs telles que les envoie un formulaire HTML : tout est du texte, les champs vides sont « ».
const valid = {
  companyName: "AACI",
  sector: "Mine et énergie",
  contactLastName: "Koffi",
  contactFirstName: "Gado",
  phone: "07 07 35 36 73",
  email: "Koffi.Gado@Client.CI",
  jobTitle: "Responsable achats",
  insertedOn: TODAY,
  progress: "20",
  productId: "",
  expectedRevenue: "",
};

function messages(input: unknown): string[] {
  const result = createLeadSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("createLeadSchema", () => {
  it("accepte un prospect valide et normalise les valeurs", () => {
    const result = createLeadSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phone).toBe("+2250707353673");
    expect(result.data.email).toBe("koffi.gado@client.ci");
    expect(result.data.progress).toBe(20);
    expect(result.data.productId).toBeUndefined();
    expect(result.data.expectedRevenue).toBeUndefined();
    expect(result.data.insertedOn).toEqual(new Date(`${TODAY}T00:00:00.000Z`));
    expect(result.data.wonConfirmed).toBe(false);
  });

  it("n'accepte que la date du jour : ni une date passée, ni une date future", () => {
    expect(createLeadSchema.safeParse({ ...valid, insertedOn: TODAY }).success).toBe(true);
    for (const offset of [-1, -7, -365, 1, 7, 3650]) {
      expect(messages({ ...valid, insertedOn: dayOffset(offset) }), `décalage ${offset} j`).toContain(INSERTED_ON_TODAY_MESSAGE);
    }
  });

  it("refuse une date illisible", () => {
    expect(messages({ ...valid, insertedOn: "demain" })).toContain("Date d'insertion invalide.");
  });

  it("garde la règle « jamais postérieure à aujourd'hui » pour les schémas sans exigence de jour (modification, import)", () => {
    const fields = { ...valid, insertedOn: dayOffset(7) };
    const result = leadFieldsSchema.safeParse(fields);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain("La date d'insertion ne peut pas être postérieure à la date du jour.");
    }
    // Une date passée reste acceptée par ce schéma (fiche ancienne qu'on modifie, ligne importée).
    expect(leadFieldsSchema.safeParse({ ...valid, insertedOn: dayOffset(-30) }).success).toBe(true);
  });

  it("refuse un secteur hors liste, une étape inconnue, un e-mail et un téléphone invalides", () => {
    expect(messages({ ...valid, sector: "Inconnu" })).toContain("Secteur d'activité obligatoire.");
    expect(messages({ ...valid, progress: "30" })).toContain("Étape du process de vente invalide.");
    expect(messages({ ...valid, email: "pas-un-mail" })).toContain("Adresse e-mail invalide.");
    expect(messages({ ...valid, phone: "123" })).toContain("Numéro de téléphone invalide : 10 chiffres pour la Côte d'Ivoire (exemple : 01 02 03 04 05), ou un numéro international en +.");
  });

  it("signale les champs obligatoires manquants", () => {
    const result = createLeadSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = result.error.issues.map((i) => i.path[0]);
    for (const field of ["companyName", "sector", "contactLastName", "contactFirstName", "phone", "email", "jobTitle", "insertedOn", "progress"]) {
      expect(fields).toContain(field);
    }
  });

  it.each([
    ["6 245 790", 6245790],
    ["6245790,50", 6245790.5],
    ["0", 0],
  ])("lit le montant « %s » comme %d", (raw, expected) => {
    const result = createLeadSchema.safeParse({ ...valid, expectedRevenue: raw });
    expect(result.success && result.data.expectedRevenue).toBe(expected);
  });

  it("refuse un montant négatif ou illisible", () => {
    expect(messages({ ...valid, expectedRevenue: "-5" })).toContain("Le montant ne peut pas être négatif.");
    expect(messages({ ...valid, expectedRevenue: "abc" })).toContain("Montant invalide.");
  });

  it("lit la case à cocher « contrat signé » (valeur « on » d'un formulaire)", () => {
    const result = createLeadSchema.safeParse({ ...valid, wonConfirmed: "on" });
    expect(result.success && result.data.wonConfirmed).toBe(true);
  });
});

describe("markLostSchema", () => {
  const base = { id: "4f5b1c0e-6c2e-4b3f-9c61-0f9a3b7e2d11", version: "1" };

  it("exige un motif de perte (CDC 5.4)", () => {
    expect(markLostSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
  });

  it("exige un commentaire pour le motif « Autre »", () => {
    expect(markLostSchema.safeParse({ ...base, reason: "other", comment: "" }).success).toBe(false);
    expect(markLostSchema.safeParse({ ...base, reason: "other", comment: "Fusion avec un concurrent" }).success).toBe(true);
  });

  it("accepte un motif standard sans commentaire", () => {
    expect(markLostSchema.safeParse({ ...base, reason: "price" }).success).toBe(true);
  });
});

describe("formDataToObject", () => {
  it("retire les champs techniques ajoutés par React", () => {
    const formData = new FormData();
    formData.set("$ACTION_ID_abc", "x");
    formData.set("companyName", "AACI");
    expect(formDataToObject(formData)).toEqual({ companyName: "AACI" });
  });
});
