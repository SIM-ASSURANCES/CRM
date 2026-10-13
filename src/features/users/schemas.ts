import { z } from "zod";
import { ROLES } from "@/lib/auth/roles";
import { optional } from "@/lib/forms";

// Validation des entrées de l'administration (utilisateurs et équipes). Messages affichés sous les champs.

const name = z
  .string({ error: "Le nom est obligatoire." })
  .trim()
  .min(2, "Le nom est obligatoire (2 caractères minimum).")
  .max(120, "Le nom est trop long (120 caractères maximum).");

const role = z.enum(ROLES, { error: "Rôle invalide." });
const teamId = optional(z.uuid({ error: "Équipe invalide." }));
const id = z.uuid({ error: "Identifiant invalide." });

export const createUserSchema = z.object({
  name,
  email: z
    .string({ error: "L'adresse e-mail est obligatoire." })
    .trim()
    .toLowerCase()
    .pipe(z.email("Adresse e-mail invalide.")),
  role,
  teamId,
});

export const updateUserSchema = z.object({ id, name, role, teamId });

export const userIdSchema = z.object({ id });

export const setActiveSchema = z.object({
  id,
  active: z.preprocess((value) => value === "true", z.boolean()),
});

export const teamSchema = z.object({
  name: z
    .string({ error: "Le nom de l'équipe est obligatoire." })
    .trim()
    .min(2, "Le nom de l'équipe est obligatoire (2 caractères minimum).")
    .max(100, "Le nom est trop long (100 caractères maximum)."),
  managerUserId: optional(z.uuid({ error: "Manager invalide." })),
});

export const updateTeamSchema = teamSchema.extend({ id });

export type CreateUserInput = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.output<typeof updateUserSchema>;
export type TeamInput = z.output<typeof teamSchema>;
export type UpdateTeamInput = z.output<typeof updateTeamSchema>;
