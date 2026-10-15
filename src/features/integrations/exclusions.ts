import "server-only";
import { z } from "zod";
import { EXCLUDED_DOMAINS_SETTING_KEY } from "@/features/integrations/config";
import { parseDomainList } from "@/features/integrations/rules";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Domaines dont les échanges ne sont JAMAIS importés (CDC 7.1 : exclure les messages personnels). Paramètre global, géré
// par l'administrateur : webmails grand public, famille, partenaires non commerciaux…

const MAX_DOMAINS = 200;

export async function getExcludedDomains(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: EXCLUDED_DOMAINS_SETTING_KEY } });
  const parsed = z.array(z.string()).safeParse(row?.value);
  return parsed.success ? parsed.data : [];
}

/** Remplace la liste à partir d'un texte libre (un domaine par ligne, ou séparés par des virgules). */
export async function updateExcludedDomains(user: CurrentUser, text: string): Promise<{ domains: string[] }> {
  if (!can(user.role, "settings:manage")) throw errors.forbidden();

  const { domains, invalid } = parseDomainList(text);
  if (invalid.length > 0) {
    throw errors.validation("Certains domaines sont invalides.", {
      fieldErrors: { domains: [`Domaines invalides : ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "…" : ""}`] },
    });
  }
  if (domains.length > MAX_DOMAINS) {
    throw errors.validation("Trop de domaines.", { fieldErrors: { domains: [`La liste est limitée à ${MAX_DOMAINS} domaines.`] } });
  }

  await db.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key: EXCLUDED_DOMAINS_SETTING_KEY },
      create: { key: EXCLUDED_DOMAINS_SETTING_KEY, value: domains, updatedBy: user.id },
      update: { value: domains, updatedBy: user.id },
    });
    await writeAudit(
      { actorUserId: user.id, action: "integration.exclusions_updated", entityType: "setting", entityId: null, metadata: { count: domains.length } },
      tx,
    );
  });
  return { domains };
}
