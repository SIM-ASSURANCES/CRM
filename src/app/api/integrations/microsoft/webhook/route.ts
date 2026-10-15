import { connection } from "next/server";
import { handleNotifications, MAX_WEBHOOK_BODY_BYTES } from "@/features/integrations/webhook";
import { logger } from "@/lib/logger";

// Point d'entrée des notifications Microsoft Graph. Route PUBLIQUE par nature (Microsoft n'a pas de session) : elle ne
// fait confiance à rien. Chaque notification est authentifiée par son secret (`clientState`) dans le service, et ne fait
// que marquer une connexion « à synchroniser » : la lecture elle-même est différée (route planifiée). Réponse immédiate.

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_VALIDATION_TOKEN = 1024;

export async function POST(request: Request) {
  await connection();

  // Poignée de main à la création de l'abonnement : Microsoft envoie un jeton que l'on doit renvoyer tel quel, en texte brut.
  const validationToken = new URL(request.url).searchParams.get("validationToken");
  if (validationToken !== null) {
    if (validationToken.length === 0 || validationToken.length > MAX_VALIDATION_TOKEN) return new Response(null, { status: 400 });
    return new Response(validationToken, { status: 200, headers: TEXT });
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BODY_BYTES) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }

  try {
    const { valid } = await handleNotifications(body);
    if (!valid) return new Response(null, { status: 400 });
  } catch (error) {
    // Microsoft réessaie en cas d'erreur 5xx ; la lecture planifiée rattrape de toute façon.
    logger.error({ err: error }, "Échec du traitement d'une notification Microsoft");
    return new Response(null, { status: 500 });
  }
  // 202 dans tous les cas valides, que l'abonnement existe ou non : rien n'est révélé à l'appelant.
  return new Response(null, { status: 202 });
}
