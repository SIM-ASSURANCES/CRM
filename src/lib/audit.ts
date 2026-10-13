import "server-only";
import { headers } from "next/headers";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// Le journal d'audit est en ajout seul (trigger PostgreSQL). Ne jamais y mettre de mot de passe,
// de jeton ou de donnée client sensible : uniquement des identifiants et des métadonnées autorisées.

export type AuditInput = {
  /** null = action du système (jobs, automatisations). */
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

type AuditClient = Pick<PrismaClient, "auditLog">;

export async function getRequestContext(): Promise<{ ipAddress: string | null; requestId: string }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return {
      ipAddress: forwarded || h.get("x-real-ip") || null,
      requestId: h.get("x-request-id") ?? crypto.randomUUID(),
    };
  } catch {
    // Hors requête (script, job) : pas d'en-têtes disponibles.
    return { ipAddress: null, requestId: crypto.randomUUID() };
  }
}

/**
 * Écrit une trace d'audit. Passer le client de transaction (`tx`) pour que la trace soit validée
 * ou annulée avec la mutation qu'elle décrit (changement d'étape, clôture, fusion…).
 */
export async function writeAudit(input: AuditInput, client: AuditClient = db): Promise<void> {
  const { ipAddress, requestId } = await getRequestContext();
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      ipAddress,
      requestId,
    },
  });
}
