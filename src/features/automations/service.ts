import "server-only";
import { z } from "zod";
import {
  RULE_CODES,
  RULES,
  isRuleCode,
  paramsSchema,
  resolveParams,
  type ParamDef,
  type RuleCode,
  type RuleParams,
} from "@/features/automations/config";
import { runAutomations, type RunSummary } from "@/features/automations/engine";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errors } from "@/lib/errors";
import type { FieldErrors } from "@/lib/forms";

// Administration des automatisations : réservée à `settings:manage` (administrateur). Le moteur lui-même est dans
// engine.ts ; il est aussi appelé sans utilisateur par la route planifiée.

export type RuleView = {
  code: RuleCode;
  label: string;
  trigger: string;
  action: string;
  enabled: boolean;
  params: RuleParams;
  paramDefs: ParamDef[];
  lastRun: { startedAt: Date; status: string; evaluated: number; tasksCreated: number; notificationsCreated: number } | null;
};

export type RunRow = {
  id: string;
  ruleCode: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  evaluated: number;
  tasksCreated: number;
  notificationsCreated: number;
  skipped: number;
  error: string | null;
};

function assertAdmin(user: CurrentUser): void {
  if (!can(user.role, "settings:manage")) throw errors.forbidden();
}

export const updateRuleSchema = z.object({
  code: z.string().refine(isRuleCode, "Règle inconnue."),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()),
});
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;

export async function listRules(user: CurrentUser): Promise<RuleView[]> {
  assertAdmin(user);
  const [rules, runs] = await Promise.all([
    db.automationRule.findMany(),
    db.automationRun.findMany({ orderBy: { startedAt: "desc" }, take: 100 }),
  ]);

  return RULE_CODES.map((code) => {
    const stored = rules.find((rule) => rule.code === code);
    const last = runs.find((run) => run.ruleCode === code);
    return {
      code,
      label: RULES[code].label,
      trigger: RULES[code].trigger,
      action: RULES[code].action,
      enabled: stored?.enabled ?? false,
      params: resolveParams(code, stored?.params),
      paramDefs: RULES[code].params,
      lastRun: last
        ? {
            startedAt: last.startedAt,
            status: last.status,
            evaluated: last.evaluated,
            tasksCreated: last.tasksCreated,
            notificationsCreated: last.notificationsCreated,
          }
        : null,
    };
  });
}

export async function listRuns(user: CurrentUser, limit = 30): Promise<RunRow[]> {
  assertAdmin(user);
  const runs = await db.automationRun.findMany({ orderBy: { startedAt: "desc" }, take: Math.min(Math.max(limit, 1), 200) });
  return runs.map((run) => ({
    id: run.id,
    ruleCode: run.ruleCode,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    evaluated: run.evaluated,
    tasksCreated: run.tasksCreated,
    notificationsCreated: run.notificationsCreated,
    skipped: run.skipped,
    error: run.error,
  }));
}

/** Active, désactive ou règle une automatisation. Les paramètres sont validés règle par règle (bornes entières). */
export async function updateRule(user: CurrentUser, input: UpdateRuleInput): Promise<void> {
  assertAdmin(user);
  const code = input.code as RuleCode;

  const parsed = paramsSchema(code).safeParse(input.params);
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = `p_${String(issue.path[0])}`;
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    throw errors.validation("Certains paramètres sont invalides.", { fieldErrors });
  }

  await db.$transaction(async (tx) => {
    const existing = await tx.automationRule.findUnique({ where: { code } });
    await tx.automationRule.upsert({
      where: { code },
      update: { enabled: input.enabled, params: parsed.data, updatedByUserId: user.id },
      create: { code, enabled: input.enabled, params: parsed.data, updatedByUserId: user.id },
    });

    const before = resolveParams(code, existing?.params);
    const changedParams = Object.keys(parsed.data).filter((key) => before[key] !== parsed.data[key]);
    await writeAudit(
      {
        actorUserId: user.id,
        action: "automation.rule_updated",
        entityType: "automation_rule",
        metadata: { code, enabled: input.enabled, enabledChanged: existing?.enabled !== input.enabled, changedParams },
      },
      tx,
    );
  });
}

/** « Exécuter maintenant » : un passage manuel de toutes les règles activées, consigné au journal. */
export async function runNow(user: CurrentUser): Promise<RunSummary[]> {
  assertAdmin(user);
  return runAutomations({ trigger: "manual", actorUserId: user.id });
}
