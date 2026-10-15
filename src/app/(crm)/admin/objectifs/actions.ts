"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { saveTargets } from "@/features/reporting/service";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Server Action de saisie des objectifs : réservée à `target:manage`, revérifiée ICI et dans le service (qui contrôle aussi
// que le commercial visé fait bien partie du périmètre de l'utilisateur). Seul un code de résultat passe dans l'adresse.

const PAGE = "/admin/objectifs";

/** « 1 500 000 », « 1500000 » ou « 1,5 » → nombre ; vide → 0 ; tout autre texte → NaN (refusé par le service). */
function parseAmount(raw: FormDataEntryValue | null): number {
  if (raw === null || typeof raw !== "string") return 0;
  const cleaned = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (cleaned === "") return 0;
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

export async function saveTargetsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const year = Number(formData.get("year"));
  const back = (query: string) => `${PAGE}?annee=${Number.isInteger(year) ? year : new Date().getUTCFullYear()}&${query}`;
  if (!can(user.role, "target:manage")) redirect(back("erreur=acces"));

  const owner = z.uuid().safeParse(formData.get("ownerUserId"));
  if (!owner.success || !Number.isInteger(year)) redirect(back("erreur=invalide"));

  const amounts: Record<string, number> = {};
  for (let month = 1; month <= 12; month++) {
    const key = String(month).padStart(2, "0");
    amounts[`${year}-${key}`] = parseAmount(formData.get(`m${key}`));
  }

  try {
    await saveTargets(user, { ownerUserId: owner.data, year, amounts });
  } catch (error) {
    if (error instanceof AppError) redirect(back(error.code === "FORBIDDEN" ? "erreur=perimetre" : "erreur=invalide"));
    logger.error({ err: error }, "Échec de l'enregistrement des objectifs");
    redirect(back("erreur=echec"));
  }
  redirect(back("ok=saved"));
}
