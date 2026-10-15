"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_IMPORT_BYTES } from "@/features/imports/config";
import { analyzeBatch, analyzeInputSchema, cancelBatch, createBatch, importBatch } from "@/features/imports/service";
import { failureState, type AdminFormState } from "@/lib/action-result";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { submittedValues } from "@/lib/forms";

// Server Actions de l'import : réservées à `import:run`, revérifié ici ET dans le service (jamais seulement dans
// l'interface). Le fichier n'est lu qu'après contrôle de sa taille déclarée.

const DENIED: AdminFormState = { error: "Vous n'avez pas accès à cette action." };

async function authorize() {
  const actor = await requireUser();
  return can(actor.role, "import:run") ? actor : null;
}

export async function uploadAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;
  const values = submittedValues(formData);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choisissez un fichier .csv ou .xlsx.", fieldErrors: { file: ["Aucun fichier sélectionné."] }, values };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { error: "Fichier trop volumineux.", fieldErrors: { file: [`Le fichier dépasse ${MAX_IMPORT_BYTES / 1024 / 1024} Mo.`] }, values };
  }

  let id: string;
  try {
    ({ id } = await createBatch(actor, { entity: String(formData.get("entity") ?? ""), filename: file.name, buffer: Buffer.from(await file.arrayBuffer()) }));
  } catch (error) {
    // Les erreurs de fichier (format, volume) sont rattachées au champ « fichier » pour s'afficher à côté.
    if (error instanceof AppError && error.code === "VALIDATION" && !(error.details as { fieldErrors?: unknown } | undefined)?.fieldErrors) {
      return { error: error.message, fieldErrors: { file: [error.message] }, values };
    }
    return failureState(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(`/admin/import/${id}`);
}

export async function analyzeAction(_previous: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await authorize();
  if (!actor) return DENIED;
  const values = submittedValues(formData);

  // Les colonnes arrivent sous la forme « map_<champ> » : le nom de la colonne du fichier associée à ce champ.
  const mapping: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("map_") && typeof value === "string") mapping[key.slice(4)] = value;
  }
  const optionalText = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const parsed = analyzeInputSchema.safeParse({
    id: formData.get("id"),
    mapping,
    defaults: {
      ownerUserId: formData.get("ownerUserId"),
      sector: optionalText("sector"),
      status: optionalText("status"),
      country: optionalText("country"),
    },
  });
  if (!parsed.success) {
    // Les erreurs des valeurs par défaut sont imbriquées : on les ramène au nom du champ du formulaire.
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === "defaults" ? String(issue.path[1]) : String(issue.path[0]);
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return { error: "Corrigez les champs signalés.", fieldErrors, values };
  }

  try {
    await analyzeBatch(actor, parsed.data);
  } catch (error) {
    return failureState(error, values);
  }
  redirect(`/admin/import/${parsed.data.id}?ok=analyzed`);
}

export async function importAction(formData: FormData): Promise<void> {
  const actor = await authorize();
  const parsed = z.object({ id: z.uuid() }).safeParse({ id: formData.get("id") });
  if (!actor || !parsed.success) redirect("/admin/import");
  const back = `/admin/import/${parsed.data.id}`;

  // Confirmation explicite : l'import crée de vraies fiches, il ne part jamais d'un simple clic.
  if (formData.get("confirm") !== "on") redirect(`${back}?erreur=confirmation`);

  try {
    await importBatch(actor, parsed.data.id);
  } catch (error) {
    if (error instanceof AppError) redirect(`${back}?erreur=import`);
    throw error;
  }
  redirect(`${back}?ok=imported`);
}

export async function cancelAction(formData: FormData): Promise<void> {
  const actor = await authorize();
  const parsed = z.object({ id: z.uuid() }).safeParse({ id: formData.get("id") });
  if (!actor || !parsed.success) redirect("/admin/import");

  try {
    await cancelBatch(actor, parsed.data.id);
  } catch (error) {
    if (error instanceof AppError) redirect(`/admin/import/${parsed.data.id}?erreur=annulation`);
    throw error;
  }
  redirect("/admin/import?ok=cancelled");
}
