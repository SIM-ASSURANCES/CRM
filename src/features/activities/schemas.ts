import { z } from "zod";
import { ACTIVITY_TYPE_CODES, FEED_TYPE_CODES } from "@/features/activities/config";
import { optional } from "@/lib/forms";

// Validation des entrées des activités. Messages en français, affichés sous les champs.

const id = z.uuid({ error: "Identifiant invalide." });
const optionalId = (label: string) => optional(z.uuid({ error: `${label} invalide.` }));

const dateOnly = (label: string) =>
  z.iso.date({ error: `${label} invalide.` }).transform((value) => new Date(`${value}T00:00:00.000Z`));

// « datetime-local » envoie « 2026-10-13T14:30 » sans fuseau : on le lit comme une heure UTC. Le CRM ne gère qu'un
// fuseau (Abidjan = UTC+0), ce qui évite tout décalage à l'affichage.
const occurredAt = z
  .string({ error: "La date de l'activité est obligatoire." })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "La date de l'activité est obligatoire.")
  .transform((value) => new Date(`${value}${value.length === 16 ? ":00" : ""}.000Z`))
  .refine((value) => !Number.isNaN(value.getTime()), "Date invalide.");

const activityFields = {
  type: z.enum(ACTIVITY_TYPE_CODES, { error: "Choisissez le type d'activité." }),
  subject: z
    .string({ error: "L'objet est obligatoire." })
    .trim()
    .min(2, "L'objet est obligatoire.")
    .max(200, "Objet : 200 caractères au maximum."),
  occurredAt,
  accountId: z.uuid({ error: "Choisissez le compte." }),
  contactId: optionalId("Contact"),
  opportunityId: optionalId("Opportunité"),
  outcome: optional(z.string().trim().max(2000, "Résultat : 2000 caractères au maximum.")),
  nextAction: optional(z.string().trim().min(2, "Prochaine action : 2 caractères minimum.").max(300, "Prochaine action : 300 caractères au maximum.")),
  nextActionDate: optional(dateOnly("Date de la prochaine action")),
};

function nextActionPair<T extends { nextAction?: string; nextActionDate?: Date }>(data: T, ctx: z.RefinementCtx) {
  if (data.nextActionDate && !data.nextAction) {
    ctx.addIssue({ code: "custom", path: ["nextAction"], message: "Précisez la prochaine action." });
  }
  if (data.nextAction && !data.nextActionDate) {
    ctx.addIssue({ code: "custom", path: ["nextActionDate"], message: "Indiquez la date de la prochaine action." });
  }
}

export const createActivitySchema = z.object(activityFields).superRefine(nextActionPair);

export const updateActivitySchema = z
  .object({ ...activityFields, id, version: z.coerce.number().int().min(1) })
  .superRefine(nextActionPair);

/** Filtres du fil (CDC 3.4) : type, période, contact, opportunité, auteur. Une valeur invalide est ignorée. */
export const feedFiltersSchema = z.object({
  accountId: optionalId("Compte"),
  opportunityId: optionalId("Opportunité"),
  contactId: optionalId("Contact"),
  authorId: optionalId("Auteur"),
  type: optional(z.enum(FEED_TYPE_CODES)),
  from: optional(dateOnly("Début")),
  to: optional(dateOnly("Fin")),
});

export type CreateActivityInput = z.output<typeof createActivitySchema>;
export type UpdateActivityInput = z.output<typeof updateActivitySchema>;
export type FeedFilters = z.output<typeof feedFiltersSchema>;
