import "server-only";
import { cache } from "react";
import {
  FEATURE_SETTING_PREFIX,
  FEATURES,
  featureKeyFromSetting,
  featureSettingKey,
  isFeatureKey,
  isSettingEnabled,
  type FeatureDefinition,
  type FeatureKey,
} from "@/features/modules/config";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";

// Interrupteur global des fonctionnalités (voir config.ts). Lire l'état est ouvert à tout code serveur (le menu et chaque écran
// en ont besoin) ; le MODIFIER est réservé à `settings:manage` et tracé dans le journal d'audit, dans la même transaction.

/**
 * Fonctionnalités désactivées, lues une seule fois par requête (`cache`) : le menu et la garde d'un écran partagent la même
 * lecture. Une lecture par requête reste négligeable (une requête indexée sur la clé).
 */
export const getDisabledFeatures = cache(async (): Promise<FeatureKey[]> => {
  const rows = await db.setting.findMany({ where: { key: { startsWith: FEATURE_SETTING_PREFIX } }, select: { key: true, value: true } });
  return rows.flatMap((row) => {
    const key = featureKeyFromSetting(row.key);
    return key && !isSettingEnabled(row.value) ? [key] : [];
  });
});

export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  return !(await getDisabledFeatures()).includes(key);
}

export type FeatureState = FeatureDefinition & { key: FeatureKey; enabled: boolean };

/** Toutes les fonctionnalités avec leur état, pour l'écran d'administration. */
export async function listFeatureStates(user: CurrentUser): Promise<FeatureState[]> {
  if (!can(user.role, "settings:manage")) throw errors.forbidden();
  const disabled = new Set(await getDisabledFeatures());
  return FEATURES.map((feature) => ({ ...feature, screens: [...feature.screens], enabled: !disabled.has(feature.key) }));
}

/**
 * Active ou désactive une fonctionnalité pour tous les utilisateurs. Idempotent : redemander l'état actuel n'écrit rien et ne
 * remplit pas le journal d'audit.
 */
export async function setFeatureEnabled(
  user: CurrentUser,
  input: { key: unknown; enabled: boolean },
): Promise<{ key: FeatureKey; enabled: boolean; changed: boolean }> {
  if (!can(user.role, "settings:manage")) throw errors.forbidden();
  if (!isFeatureKey(input.key)) throw errors.validation("Fonctionnalité inconnue.");
  const key = input.key;
  const settingKey = featureSettingKey(key);

  return db.$transaction(async (tx) => {
    const existing = await tx.setting.findUnique({ where: { key: settingKey } });
    const wasEnabled = isSettingEnabled(existing?.value);
    if (wasEnabled === input.enabled) return { key, enabled: wasEnabled, changed: false };

    await tx.setting.upsert({
      where: { key: settingKey },
      create: { key: settingKey, value: { enabled: input.enabled }, updatedBy: user.id },
      update: { value: { enabled: input.enabled }, updatedBy: user.id },
    });
    await writeAudit(
      {
        actorUserId: user.id,
        action: input.enabled ? "feature.enabled" : "feature.disabled",
        entityType: "setting",
        entityId: null,
        metadata: { feature: key },
      },
      tx,
    );
    return { key, enabled: input.enabled, changed: true };
  });
}
