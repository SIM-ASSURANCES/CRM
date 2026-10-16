import { z } from "zod";
import { LOSS_REASON_CODES, SECTORS, isProgress } from "@/features/leads/config";
import { phoneSchema } from "@/lib/phone";

// Validation des entrées (formulaires et API). Messages en français, affichés sous les champs.

/** Les formulaires envoient « » pour un champ vide : on le traite comme absent. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());
}

function required(label: string, max = 200) {
  return z
    .string({ error: `${label} obligatoire.` })
    .trim()
    .min(1, `${label} obligatoire.`)
    .max(max, `${label} : ${max} caractères au maximum.`);
}

// Contact téléphonique obligatoire, enregistré au format unique « +225… » (voir lib/phone.ts).
const phone = phoneSchema;

const email = z
  .string({ error: "Adresse e-mail obligatoire." })
  .trim()
  .toLowerCase()
  .pipe(z.email("Adresse e-mail invalide."));

// Date d'insertion : « ne peut être postérieure à la date du jour » (Excel). Un jour de tolérance couvre les fuseaux.
const insertedOn = z
  .iso.date({ error: "Date d'insertion invalide." })
  .refine((value) => new Date(`${value}T00:00:00.000Z`).getTime() <= Date.now() + 24 * 3600 * 1000, {
    message: "La date d'insertion ne peut pas être postérieure à la date du jour.",
  })
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const progress = z.coerce
  .number({ error: "Étape invalide." })
  .int()
  .refine(isProgress, { message: "Étape du process de vente invalide." });

// Montant en FCFA : espaces et virgule décimale tolérés (« 6 245 790 »).
const money = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/[\s  ]/g, "").replace(",", ".") : value),
  z.coerce
    .number({ error: "Montant invalide." })
    .min(0, "Le montant ne peut pas être négatif.")
    .max(1e13, "Montant trop élevé."),
);

const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());

export const leadFieldsSchema = z.object({
  companyName: required("Nom de l'entreprise"),
  sector: z.enum(SECTORS, { error: "Secteur d'activité obligatoire." }),
  contactLastName: required("Nom du prospect", 100),
  contactFirstName: required("Prénom du prospect", 100),
  phone,
  email,
  jobTitle: required("Fonction du prospect", 150),
  insertedOn,
  progress,
  // Exigés quand le prospect franchit le seuil de qualification (règle vérifiée dans le service, seuils paramétrables).
  productId: optional(z.uuid({ error: "Produit invalide." })),
  expectedRevenue: optional(money),
  // Passage à 100 % : contrat signé ET premier paiement validé (CDC 14).
  wonConfirmed: checkbox,
});

export const createLeadSchema = leadFieldsSchema.extend({ forceDuplicate: checkbox });

export const updateLeadSchema = leadFieldsSchema.extend({
  id: z.uuid({ error: "Identifiant invalide." }),
  version: z.coerce.number().int().min(1),
});

export const markLostSchema = z
  .object({
    id: z.uuid({ error: "Identifiant invalide." }),
    version: z.coerce.number().int().min(1),
    reason: z.enum(LOSS_REASON_CODES, { error: "Le motif de perte est obligatoire." }),
    comment: optional(z.string().trim().max(1000, "Commentaire : 1000 caractères au maximum.")),
  })
  .refine((data) => data.reason !== "other" || Boolean(data.comment), {
    path: ["comment"],
    message: "Précisez le motif dans le commentaire.",
  });

export type LeadFieldsInput = z.output<typeof leadFieldsSchema>;
export type CreateLeadInput = z.output<typeof createLeadSchema>;
export type UpdateLeadInput = z.output<typeof updateLeadSchema>;
export type MarkLostInput = z.output<typeof markLostSchema>;

/** FormData → objet simple, sans les champs techniques ajoutés par React (« $ACTION_… »). */
export function formDataToObject(formData: FormData): Record<string, FormDataEntryValue> {
  const entries = Array.from(formData.entries()).filter(([key]) => !key.startsWith("$ACTION"));
  return Object.fromEntries(entries);
}
