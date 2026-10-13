import { z } from "zod";
import { TASK_PRIORITY_CODES, TASK_STATUS_CODES, TASK_VIEW_CODES } from "@/features/tasks/config";
import { optional } from "@/lib/forms";

// Validation des entrées des tâches. Messages en français, affichés sous les champs.

const id = z.uuid({ error: "Identifiant invalide." });
const optionalId = (label: string) => optional(z.uuid({ error: `${label} invalide.` }));

const taskFields = {
  title: z
    .string({ error: "Le titre est obligatoire." })
    .trim()
    .min(2, "Le titre est obligatoire.")
    .max(200, "Titre : 200 caractères au maximum."),
  description: optional(z.string().trim().max(2000, "Description : 2000 caractères au maximum.")),
  dueDate: z.iso
    .date({ error: "L'échéance est obligatoire." })
    .transform((value) => new Date(`${value}T00:00:00.000Z`)),
  priority: z.enum(TASK_PRIORITY_CODES, { error: "Priorité invalide." }).default("normal"),
  // Vide = la tâche est pour son créateur.
  assigneeUserId: optionalId("Responsable"),
  accountId: optionalId("Compte"),
  contactId: optionalId("Contact"),
  opportunityId: optionalId("Opportunité"),
};

export const createTaskSchema = z.object(taskFields);

export const updateTaskSchema = z.object({ ...taskFields, id, version: z.coerce.number().int().min(1) });

/** Terminer, annuler ou rouvrir une tâche. */
export const setTaskStatusSchema = z.object({
  id,
  version: z.coerce.number().int().min(1),
  status: z.enum(TASK_STATUS_CODES, { error: "Statut invalide." }),
});

/** Filtres de la liste : une valeur invalide est ignorée plutôt que refusée. */
export const taskListSchema = z.object({
  view: z.enum(TASK_VIEW_CODES).catch("open"),
  assigneeId: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
});

export type CreateTaskInput = z.output<typeof createTaskSchema>;
export type UpdateTaskInput = z.output<typeof updateTaskSchema>;
export type SetTaskStatusInput = z.output<typeof setTaskStatusSchema>;
