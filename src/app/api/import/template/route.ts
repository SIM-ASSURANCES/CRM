import { connection } from "next/server";
import { isImportEntity, templateRows } from "@/features/imports/config";
import { apiUser, csvResponse } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { toCsv } from "@/lib/csv";
import { errors, toErrorResponse } from "@/lib/errors";

// Fichier modèle de l'import : les en-têtes que le CRM reconnaît automatiquement et une ligne d'exemple.
// Aucune donnée client : seule la permission d'importer est exigée.

export async function GET(request: Request) {
  await connection();
  try {
    const user = await apiUser();
    if (!can(user.role, "import:run")) throw errors.forbidden();

    const entity = new URL(request.url).searchParams.get("entite") ?? "";
    if (!isImportEntity(entity)) throw errors.validation("Type d'import invalide.");

    const filename = `modele-import-${entity === "accounts" ? "comptes" : "contacts"}.csv`;
    return csvResponse(filename, toCsv(templateRows(entity)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
