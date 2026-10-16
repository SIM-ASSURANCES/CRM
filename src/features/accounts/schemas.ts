import { z } from "zod";
import {
  ACCOUNT_SOURCE_CODES,
  ACCOUNT_STATUS_CODES,
  COUNTRY_CODES,
} from "@/features/accounts/config";
import { SECTORS } from "@/features/leads/config";
import { optional } from "@/lib/forms";
import { phoneSchema } from "@/lib/phone";

// Validation des entrées des comptes (formulaires et API). Messages en français, affichés sous les champs.

function text(label: string, max = 200) {
  return optional(z.string().trim().max(max, `${label} : ${max} caractères au maximum.`));
}

const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());

// Numéro enregistré au format unique « +225… » (voir lib/phone.ts).
const phone = optional(phoneSchema);

const emailDomain = optional(
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Domaine invalide (exemple : client.ci)."),
);

// Montant en FCFA : espaces et virgule décimale tolérés (« 1 250 000 »).
const money = optional(
  z.preprocess(
    (value) => (typeof value === "string" ? value.replace(/[\s  ]/g, "").replace(",", ".") : value),
    z.coerce.number({ error: "Montant invalide." }).min(0, "Le montant ne peut pas être négatif.").max(1e15, "Montant trop élevé."),
  ),
);

const currentYear = new Date().getUTCFullYear();

export const accountFieldsSchema = z.object({
  legalName: z
    .string({ error: "La raison sociale est obligatoire." })
    .trim()
    .min(2, "La raison sociale est obligatoire (2 caractères minimum).")
    .max(200, "Raison sociale : 200 caractères au maximum."),
  tradeName: text("Nom commercial"),
  legalIdentifier: text("Identifiant légal", 60),
  sector: z.enum(SECTORS, { error: "Le secteur d'activité est obligatoire (reporting sectoriel)." }),
  employeeCount: optional(z.coerce.number({ error: "Effectif invalide." }).int("Effectif invalide.").min(0, "Effectif invalide.").max(10_000_000, "Effectif invalide.")),
  revenueAmount: money,
  revenueYear: optional(
    z.coerce.number({ error: "Année invalide." }).int("Année invalide.").min(1900, "Année invalide.").max(currentYear + 1, "Année invalide."),
  ),
  revenueSource: text("Source du chiffre d'affaires"),
  collectiveAgreement: text("Convention collective"),
  status: z.enum(ACCOUNT_STATUS_CODES, { error: "Statut invalide." }),
  source: optional(z.enum(ACCOUNT_SOURCE_CODES, { error: "Source d'acquisition invalide." })),
  phone,
  emailDomain,
  addressLine: text("Adresse"),
  city: text("Ville", 100),
  country: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? "CI" : value),
    z.enum(COUNTRY_CODES, { error: "Pays invalide." }),
  ),
  parentAccountId: optional(z.uuid({ error: "Compte parent invalide." })),
  ownerUserId: optional(z.uuid({ error: "Propriétaire invalide." })),
});

export const createAccountSchema = accountFieldsSchema.extend({ forceDuplicate: checkbox });

export const updateAccountSchema = accountFieldsSchema.extend({
  id: z.uuid({ error: "Identifiant invalide." }),
  version: z.coerce.number().int().min(1),
});

export const mergeAccountsSchema = z.object({
  targetId: z.uuid({ error: "Compte conservé invalide." }),
  sourceId: z.uuid({ error: "Compte à fusionner invalide." }),
});

export type AccountFieldsInput = z.output<typeof accountFieldsSchema>;
export type CreateAccountInput = z.output<typeof createAccountSchema>;
export type UpdateAccountInput = z.output<typeof updateAccountSchema>;
export type MergeAccountsInput = z.output<typeof mergeAccountsSchema>;
