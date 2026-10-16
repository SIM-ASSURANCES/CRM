"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_IMPORT_BYTES, PILOT_SIZE } from "@/features/imports/config";
import { normalizeStoredPhones, validateBatch } from "@/features/imports/migration";
import { analyzeBatch, analyzeInputSchema, cancelBatch, createBatch, getBatch, importBatch } from "@/features/imports/service";
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

  // Import pilote : seules les premières lignes valides sont créées ; la suite s'importe après vérification.
  const pilot = formData.get("pilot") === "1";
  try {
    await importBatch(actor, parsed.data.id, pilot ? { limit: PILOT_SIZE } : {});
  } catch (error) {
    if (error instanceof AppError) redirect(`${back}?erreur=import`);
    throw error;
  }
  redirect(`${back}?ok=${pilot ? "pilot" : "imported"}`);
}

/**
 * Rapproche des valeurs inconnues du fichier (secteurs, produits) d'une valeur du CRM, puis ré-analyse le lot. L'association
 * des colonnes et les valeurs par défaut déjà choisies sont reprises telles quelles ; les correspondances s'ajoutent aux
 * précédentes. Les champs arrivent sous la forme « vm_sector_<clé> » et « vm_product_<clé> ».
 */
export async function valueMapAction(formData: FormData): Promise<void> {
  const actor = await authorize();
  const parsed = z.object({ id: z.uuid() }).safeParse({ id: formData.get("id") });
  if (!actor || !parsed.success) redirect("/admin/import");
  const back = `/admin/import/${parsed.data.id}`;

  const sector: Record<string, string> = {};
  const product: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string" || value === "") continue;
    // La clé est une valeur normalisée (lettres et chiffres) : tout autre format est ignoré.
    const match = /^vm_(sector|product)_([a-z0-9]{1,100})$/.exec(name);
    if (!match) continue;
    (match[1] === "sector" ? sector : product)[match[2]] = value;
  }

  try {
    const batch = await getBatch(actor, parsed.data.id);
    if (!batch.defaults) redirect(`${back}?erreur=correspondances`);
    await analyzeBatch(actor, {
      id: batch.id,
      mapping: batch.mapping,
      defaults: batch.defaults,
      valueMap: { sector: { ...batch.valueMap.sector, ...sector }, product: { ...batch.valueMap.product, ...product } },
    });
  } catch (error) {
    if (error instanceof AppError) redirect(`${back}?erreur=correspondances`);
    throw error;
  }
  redirect(`${back}?ok=mapped`);
}

/** Accepte le rapprochement d'un lot : il passe à « Validé » et sa source est effacée. */
export async function validateAction(formData: FormData): Promise<void> {
  const actor = await authorize();
  const parsed = z.object({ id: z.uuid() }).safeParse({ id: formData.get("id") });
  if (!actor || !parsed.success) redirect("/admin/import");
  const back = `/admin/import/${parsed.data.id}`;

  try {
    await validateBatch(actor, parsed.data.id, { acknowledged: formData.get("acknowledged") === "on" });
  } catch (error) {
    if (error instanceof AppError) redirect(`${back}?erreur=${error.code === "VALIDATION" && error.message.startsWith("Confirmez") ? "acquittement" : "validation"}`);
    throw error;
  }
  redirect(`${back}?ok=validated`);
}

/** Normalise les téléphones déjà enregistrés (comptes, contacts, prospects) au format +225… après confirmation. */
export async function normalizePhonesAction(formData: FormData): Promise<void> {
  const actor = await authorize();
  if (!actor) redirect("/admin/import");
  if (formData.get("confirm") !== "on") redirect("/admin/import?telephones=simulation&erreur=confirmation");

  await normalizeStoredPhones(actor);
  redirect("/admin/import?ok=phones");
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
