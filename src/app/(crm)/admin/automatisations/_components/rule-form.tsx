"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { updateRuleAction } from "@/app/(crm)/admin/automatisations/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { ParamDef } from "@/features/automations/config";
import type { AdminFormState } from "@/lib/action-result";

type RuleFormProps = {
  code: string;
  label: string;
  trigger: string;
  action: string;
  enabled: boolean;
  params: Record<string, number>;
  paramDefs: ParamDef[];
  /** Dernier passage, déjà mis en forme côté serveur (« 13/10/2026 à 10:00 — 3 tâche(s)… »). */
  lastRunText: string | null;
};

const INITIAL_STATE: AdminFormState = {};

/** Une règle : activation et paramètres. Les bornes sont revalidées par le serveur (jamais seulement ici). */
export function RuleForm({ code, label, trigger, action, enabled, params, paramDefs, lastRunText }: RuleFormProps) {
  const [state, formAction, pending] = useActionState(updateRuleAction, INITIAL_STATE);
  const values = state.values ?? {};
  const error = (name: string) => state.fieldErrors?.[name]?.join(" ");
  const checked = state.values ? state.values.enabled === "on" : enabled;

  return (
    <form action={formAction} noValidate className="space-y-5 rounded-2xl border border-line bg-white p-6">
      <input type="hidden" name="code" value={code} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink">{label}</h3>
          <p className="mt-1 text-sm text-ink-soft">
            <strong>Déclencheur :</strong> {trigger}
          </p>
          <p className="text-sm text-ink-soft">
            <strong>Action :</strong> {action}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" name="enabled" defaultChecked={checked} className="size-4 accent-brand-700" />
          Activée
        </label>
      </div>

      {state.error && !state.fieldErrors && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paramDefs.map((def) => (
          <Field
            key={def.key}
            label={`${def.label} (${def.unit})`}
            name={`p_${def.key}`}
            type="number"
            inputMode="numeric"
            min={def.min}
            max={def.max}
            defaultValue={values[`p_${def.key}`] ?? String(params[def.key])}
            error={error(`p_${def.key}`)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{lastRunText ?? "Jamais exécutée."}</p>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
