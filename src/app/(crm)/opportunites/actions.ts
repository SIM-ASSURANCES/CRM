"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { AccountDuplicate } from "@/features/accounts/service";
import { convertLead } from "@/features/opportunities/conversion";
import {
  addOpportunityContactSchema,
  convertLeadSchema,
  createOpportunitySchema,
  markOpportunityLostSchema,
  moveStageSchema,
  removeOpportunityContactSchema,
  updateOpportunitySchema,
} from "@/features/opportunities/schemas";
import {
  addContact,
  createOpportunity,
  markLost,
  moveStage,
  removeContact,
  updateOpportunity,
} from "@/features/opportunities/service";
import type { AdminFormState } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formDataToObject, submittedValues, type FieldErrors } from "@/lib/forms";
import { logger } from "@/lib/logger";
import { safeRedirectPath } from "@/lib/safe-redirect";

// Server Actions des opportunités : identité relue côté serveur, validation Zod, puis délégation au service
// (permission, périmètre, règles métier, audit). `returnTo` (chemin interne uniquement) ramène à l'écran d'origine.

export type OpportunityFormState = AdminFormState & {
  duplicates?: AccountDuplicate[];
  /** Renseigné quand un prospect est déjà converti : permet d'y renvoyer l'utilisateur. */
  opportunityId?: string;
};

function failure(error: unknown, values?: Record<string, string>): OpportunityFormState {
  if (error instanceof AppError) {
    const details = error.details as
      | { fieldErrors?: FieldErrors; duplicates?: AccountDuplicate[]; opportunityId?: string | null }
      | undefined;
    return {
      error: error.message,
      fieldErrors: details?.fieldErrors,
      duplicates: details?.duplicates,
      opportunityId: details?.opportunityId ?? undefined,
      values,
    };
  }
  logger.error({ err: error }, "Erreur inattendue dans une action opportunités");
  return { error: "Une erreur est survenue. Réessayez dans un instant.", values };
}

function invalid(error: z.ZodError, values: Record<string, string>): OpportunityFormState {
  return { error: "Corrigez les champs signalés.", fieldErrors: z.flattenError(error).fieldErrors, values };
}

/** Ajoute des paramètres à un chemin, qu'il porte déjà une requête ou non. */
function withParams(path: string, params: Record<string, string>): string {
  return `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(params).toString()}`;
}

export async function createOpportunityAction(_previous: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = createOpportunitySchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  let id: string;
  try {
    ({ id } = await createOpportunity(user, parsed.data));
  } catch (error) {
    return failure(error, values);
  }
  // redirect() lève une exception : il doit rester en dehors du try/catch.
  redirect(`/opportunites/${id}?ok=created`);
}

export async function updateOpportunityAction(_previous: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = updateOpportunitySchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await updateOpportunity(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/opportunites/${parsed.data.id}?ok=updated`);
}

export async function moveStageAction(_previous: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const user = await requireUser();
  const returnTo = safeRedirectPath(formData.get("returnTo"), "/opportunites");

  const parsed = moveStageSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, submittedValues(formData));

  let result: { stage: number; status: string };
  try {
    result = await moveStage(user, parsed.data);
  } catch (error) {
    return failure(error);
  }
  // Le paramètre « t » change à chaque déplacement : la page recrée le tableau et ferme la boîte de dialogue.
  redirect(withParams(returnTo, { ok: result.status === "won" ? "won" : "moved", t: String(Date.now()) }));
}

export type QuickMoveResult =
  | { ok: true; stage: number; version: number }
  // needsDetails : le serveur demande une information (critère, produit, montant) : le tableau rouvre la boîte de dialogue.
  | { ok: false; error: string; needsDetails: boolean };

/**
 * Déplacement « à la HubSpot » depuis le tableau : appelé directement par le navigateur, sans redirection, pour que la carte
 * change de colonne tout de suite. Mêmes règles que `moveStageAction` (schéma, service) : le gain (100 %) reste réservé à
 * la boîte de dialogue, car `wonConfirmed` n'est jamais fourni ici.
 */
export async function quickMoveStageAction(input: {
  id: string;
  version: number;
  targetStage: number;
  /** Retour à une étape déjà validée (annulation d'un recul) : le critère est réputé rempli. */
  criteriaConfirmed?: boolean;
}): Promise<QuickMoveResult> {
  const user = await requireUser();

  const parsed = moveStageSchema.safeParse({
    id: input.id,
    version: input.version,
    targetStage: input.targetStage,
    criteriaConfirmed: input.criteriaConfirmed === true,
    wonConfirmed: false,
  });
  if (!parsed.success) return { ok: false, error: "Déplacement invalide.", needsDetails: false };

  try {
    const result = await moveStage(user, parsed.data);
    return { ok: true, stage: result.stage, version: result.version };
  } catch (error) {
    const state = failure(error);
    const fields = state.fieldErrors ?? {};
    const needsDetails = ["criteriaConfirmed", "wonConfirmed", "productId", "amount"].some((name) => name in fields);
    return { ok: false, error: state.error ?? "Déplacement impossible.", needsDetails };
  }
}

export async function markOpportunityLostAction(_previous: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const user = await requireUser();
  const returnTo = safeRedirectPath(formData.get("returnTo"), "/opportunites");

  const parsed = markOpportunityLostSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, submittedValues(formData));

  try {
    await markLost(user, parsed.data);
  } catch (error) {
    return failure(error);
  }
  redirect(withParams(returnTo, { ok: "lost", t: String(Date.now()) }));
}

export async function addOpportunityContactAction(_previous: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = addOpportunityContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  try {
    await addContact(user, parsed.data);
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/opportunites/${parsed.data.opportunityId}?ok=contact_added`);
}

/** Retrait d'un contact depuis un simple bouton de formulaire (pas d'état à afficher). */
export async function removeOpportunityContactAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = removeOpportunityContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) redirect("/opportunites");

  try {
    await removeContact(user, parsed.data);
  } catch (error) {
    if (error instanceof AppError) redirect(`/opportunites/${parsed.data.opportunityId}?erreur=1`);
    throw error;
  }
  redirect(`/opportunites/${parsed.data.opportunityId}?ok=contact_removed`);
}

export async function convertLeadAction(_previous: OpportunityFormState, formData: FormData): Promise<OpportunityFormState> {
  const user = await requireUser();
  const values = submittedValues(formData);

  const parsed = convertLeadSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return invalid(parsed.error, values);

  let opportunityId: string;
  try {
    ({ opportunityId } = await convertLead(user, parsed.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/opportunites/${opportunityId}?ok=converted`);
}
