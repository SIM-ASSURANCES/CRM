import { z } from "zod";
import { ROLE_TYPE_CODES } from "@/features/accounts/config";
import { LOSS_REASON_CODES } from "@/features/leads/config";
import { REVENUE_PERIOD_CODES, isOpenStage, OPEN_STAGES } from "@/features/opportunities/config";
import { optional } from "@/lib/forms";

// Validation des entrées des opportunités. Messages en français, affichés sous les champs.

function text(label: string, max = 200) {
  return optional(z.string().trim().max(max, `${label} : ${max} caractères au maximum.`));
}

const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());
const id = z.uuid({ error: "Identifiant invalide." });

const requiredDate = (label: string) =>
  z.iso
    .date({ error: `${label} obligatoire.` })
    .transform((value) => new Date(`${value}T00:00:00.000Z`));

// Montant en FCFA : espaces et virgule décimale tolérés (« 12 500 000 »). Obligatoire (0 autorisé).
const amount = z.preprocess(
  (value) => {
    // Un champ vide ne doit pas devenir « 0 » (z.coerce.number convertit « » en 0) : il est absent, donc refusé.
    if (value === "" || value === null || value === undefined) return undefined;
    return typeof value === "string" ? value.replace(/[\s  ]/g, "").replace(",", ".") : value;
  },
  z.coerce
    .number({ error: "Le montant estimé est obligatoire." })
    .min(0, "Le montant ne peut pas être négatif.")
    .max(1e15, "Montant trop élevé."),
);

export const opportunityFieldsSchema = z.object({
  // Vide = nom généré automatiquement : compte – produit – échéance.
  name: optional(z.string().trim().min(3, "Nom : 3 caractères minimum.").max(200, "Nom : 200 caractères au maximum.")),
  accountId: z.uuid({ error: "Choisissez le compte." }),
  productId: optional(z.uuid({ error: "Produit invalide." })),
  amount,
  revenuePeriod: z.enum(REVENUE_PERIOD_CODES, { error: "Période de revenu invalide." }),
  estimationMethod: text("Méthode d'estimation"),
  expectedCloseDate: requiredDate("La date de clôture prévisionnelle"),
  nextAction: z
    .string({ error: "La prochaine action est obligatoire." })
    .trim()
    .min(2, "La prochaine action est obligatoire.")
    .max(300, "Prochaine action : 300 caractères au maximum."),
  nextActionDate: requiredDate("La date de la prochaine action"),
  competitor: text("Concurrent"),
  currentSolution: text("Solution actuelle"),
  ownerUserId: optional(z.uuid({ error: "Propriétaire invalide." })),
});

export const createOpportunitySchema = opportunityFieldsSchema.extend({
  stage: z.coerce
    .number({ error: "Étape invalide." })
    .int()
    .refine(isOpenStage, { message: `Étape invalide (${OPEN_STAGES.join(", ")} %).` }),
});

export const updateOpportunitySchema = opportunityFieldsSchema.extend({
  id,
  version: z.coerce.number().int().min(1),
});

export const moveStageSchema = z.object({
  id,
  version: z.coerce.number().int().min(1),
  targetStage: z.coerce
    .number({ error: "Étape invalide." })
    .int()
    .refine((value) => isOpenStage(value) || value === 100, { message: "Étape invalide." }),
  criteriaConfirmed: checkbox,
  wonConfirmed: checkbox,
});

export const markOpportunityLostSchema = z
  .object({
    id,
    version: z.coerce.number().int().min(1),
    reason: z.enum(LOSS_REASON_CODES, { error: "Le motif de perte est obligatoire." }),
    comment: optional(z.string().trim().max(1000, "Commentaire : 1000 caractères au maximum.")),
  })
  .refine((data) => data.reason !== "other" || Boolean(data.comment), {
    path: ["comment"],
    message: "Précisez le motif dans le commentaire.",
  });

export const addOpportunityContactSchema = z.object({
  opportunityId: id,
  contactId: z.uuid({ error: "Choisissez un contact." }),
  roleType: optional(z.enum(ROLE_TYPE_CODES, { error: "Rôle invalide." })),
  isMain: checkbox,
});

export const removeOpportunityContactSchema = z.object({ opportunityId: id, contactId: id });

/** Conversion d'un prospect (CDC A.8) : compte (créé ou existant), contact et opportunité en une seule transaction. */
export const convertLeadSchema = z.object({
  leadId: id,
  // Vide = créer un nouveau compte à partir du prospect ; renseigné = rattacher à ce compte existant.
  existingAccountId: optional(z.uuid({ error: "Compte invalide." })),
  forceDuplicate: checkbox,
  expectedCloseDate: requiredDate("La date de clôture prévisionnelle"),
  nextAction: z
    .string({ error: "La prochaine action est obligatoire." })
    .trim()
    .min(2, "La prochaine action est obligatoire.")
    .max(300, "Prochaine action : 300 caractères au maximum."),
  nextActionDate: requiredDate("La date de la prochaine action"),
});

export type OpportunityFieldsInput = z.output<typeof opportunityFieldsSchema>;
export type CreateOpportunityInput = z.output<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.output<typeof updateOpportunitySchema>;
export type MoveStageInput = z.output<typeof moveStageSchema>;
export type MarkOpportunityLostInput = z.output<typeof markOpportunityLostSchema>;
export type AddOpportunityContactInput = z.output<typeof addOpportunityContactSchema>;
export type ConvertLeadInput = z.output<typeof convertLeadSchema>;
