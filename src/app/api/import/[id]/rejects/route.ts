import { connection } from "next/server";
import { z } from "zod";
import { rejectsCsv } from "@/features/imports/service";
import { apiUser, csvResponse } from "@/lib/api";
import { errors, toErrorResponse } from "@/lib/errors";

// Rapport des lignes rejetées et des doublons d'un lot d'import, à corriger puis réimporter. Réservé à `import:run`
// (vérifié par le service) ; l'export est journalisé car il contient des données du fichier d'origine.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const user = await apiUser();
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw errors.notFound("Lot d'import introuvable.");

    const result = await rejectsCsv(user, id);
    return csvResponse(result.filename, result.csv);
  } catch (error) {
    return toErrorResponse(error);
  }
}
