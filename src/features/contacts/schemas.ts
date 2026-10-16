import { z } from "zod";
import {
  CONTACT_STATUS_CODES,
  INFLUENCE_CODES,
  PREFERRED_CHANNEL_CODES,
  ROLE_TYPE_CODES,
} from "@/features/accounts/config";
import { optional } from "@/lib/forms";
import { phoneSchema } from "@/lib/phone";

// Validation des entrées des contacts, de leurs rattachements et de leurs rôles d'achat.

function text(label: string, max = 200) {
  return optional(z.string().trim().max(max, `${label} : ${max} caractères au maximum.`));
}

const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());

const required = (label: string, max = 100) =>
  z
    .string({ error: `${label} obligatoire.` })
    .trim()
    .min(1, `${label} obligatoire.`)
    .max(max, `${label} : ${max} caractères au maximum.`);

const dateOnly = optional(
  z
    .iso.date({ error: "Date invalide." })
    .transform((value) => new Date(`${value}T00:00:00.000Z`)),
);

export const contactFieldsSchema = z.object({
  firstName: required("Le prénom"),
  lastName: required("Le nom"),
  jobTitle: text("Fonction", 150),
  department: text("Service", 100),
  email: optional(z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide."))),
  phone: optional(phoneSchema),
  status: z.enum(CONTACT_STATUS_CODES, { error: "Statut invalide." }),
  preferredChannel: optional(z.enum(PREFERRED_CHANNEL_CODES, { error: "Canal invalide." })),
  contactRestrictions: text("Restrictions de contact", 500),
});

export const createContactSchema = contactFieldsSchema.extend({
  /** Compte auquel rattacher le nouveau contact (facultatif). */
  accountId: optional(z.uuid({ error: "Compte invalide." })),
  relationshipTitle: text("Fonction chez ce compte", 150),
  forceDuplicate: checkbox,
});

export const updateContactSchema = contactFieldsSchema.extend({
  id: z.uuid({ error: "Identifiant invalide." }),
  version: z.coerce.number().int().min(1),
});

export const linkContactSchema = z
  .object({
    contactId: z.uuid({ error: "Contact invalide." }),
    accountId: z.uuid({ error: "Compte invalide." }),
    relationshipTitle: text("Fonction chez ce compte", 150),
    isPrimary: checkbox,
    startDate: dateOnly,
    endDate: dateOnly,
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
    path: ["endDate"],
    message: "La date de fin doit suivre la date de début.",
  });

export const unlinkContactSchema = z.object({
  contactId: z.uuid({ error: "Contact invalide." }),
  accountId: z.uuid({ error: "Compte invalide." }),
});

export const addRoleSchema = z.object({
  contactId: z.uuid({ error: "Contact invalide." }),
  accountId: z.uuid({ error: "Choisissez le compte concerné." }),
  roleType: z.enum(ROLE_TYPE_CODES, { error: "Choisissez un rôle d'achat." }),
  productId: optional(z.uuid({ error: "Produit invalide." })),
  influence: optional(z.enum(INFLUENCE_CODES, { error: "Niveau d'influence invalide." })),
});

export const removeRoleSchema = z.object({ roleId: z.uuid({ error: "Rôle invalide." }) });

export type ContactFieldsInput = z.output<typeof contactFieldsSchema>;
export type CreateContactInput = z.output<typeof createContactSchema>;
export type UpdateContactInput = z.output<typeof updateContactSchema>;
export type LinkContactInput = z.output<typeof linkContactSchema>;
export type AddRoleInput = z.output<typeof addRoleSchema>;
