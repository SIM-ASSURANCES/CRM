import { connection } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Sonde de santé pour la supervision et les tests de fumée : vérifie que la base répond.
// Ne renvoie aucune information interne.
export async function GET() {
  await connection();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch (error) {
    logger.error({ err: error }, "Sonde de santé : base de données indisponible");
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
