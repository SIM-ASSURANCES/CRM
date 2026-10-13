import { z } from "zod";

// Règles de relance automatique (CDC 6.2). Chaque règle est activable, désactivable et paramétrable ; ses valeurs par
// défaut sont celles du cahier des charges (15 jours d'inactivité pour un grand compte, etc.).

export const RULE_CODES = ["inactivity", "no_next_action", "close_date_overdue", "meeting_soon", "task_overdue"] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export type ParamDef = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  default: number;
};

export type RuleDefinition = {
  label: string;
  /** Déclencheur, tel que décrit au cahier des charges. */
  trigger: string;
  /** Action automatique produite. */
  action: string;
  params: ParamDef[];
};

const frequency = (defaultDays: number): ParamDef => ({
  key: "frequencyDays",
  label: "Fréquence maximale d'alerte",
  unit: "jours",
  min: 1,
  max: 90,
  default: defaultDays,
});

const escalation = (defaultDays: number): ParamDef => ({
  key: "escalationDays",
  label: "Escalade au manager après",
  unit: "jours de retard",
  min: 1,
  max: 90,
  default: defaultDays,
});

export const RULES: Record<RuleCode, RuleDefinition> = {
  inactivity: {
    label: "Compte sans activité",
    trigger: "Aucune activité sur un compte client ou prospect depuis le seuil de son segment.",
    action: "Crée une tâche de relance pour le propriétaire et le notifie.",
    params: [
      { key: "largeAccountMinEmployees", label: "Grand compte à partir de", unit: "salariés", min: 1, max: 1_000_000, default: 250 },
      { key: "largeDays", label: "Seuil d'inactivité d'un grand compte", unit: "jours", min: 1, max: 365, default: 15 },
      { key: "standardDays", label: "Seuil d'inactivité des autres comptes", unit: "jours", min: 1, max: 365, default: 30 },
      { key: "dueInDays", label: "Échéance de la tâche créée", unit: "jours", min: 0, max: 30, default: 2 },
      frequency(7),
    ],
  },
  no_next_action: {
    label: "Opportunité sans prochaine action à venir",
    trigger: "Une opportunité ouverte dont la date de prochaine action est dépassée.",
    action: "Alerte le propriétaire.",
    params: [frequency(1)],
  },
  close_date_overdue: {
    label: "Clôture prévisionnelle dépassée",
    trigger: "Une opportunité ouverte dont la date de clôture prévisionnelle est passée.",
    action: "Demande au propriétaire de mettre à jour le dossier, puis escalade au manager.",
    params: [frequency(7), escalation(7)],
  },
  meeting_soon: {
    label: "Rendez-vous imminent",
    trigger: "Un rendez-vous ou une visioconférence débute bientôt.",
    action: "Rappelle le rendez-vous à son auteur.",
    params: [{ key: "hoursBefore", label: "Délai avant l'événement", unit: "heures", min: 1, max: 168, default: 24 }],
  },
  task_overdue: {
    label: "Tâche en retard",
    trigger: "Une tâche ouverte dont l'échéance est dépassée.",
    action: "Notifie le responsable, puis le manager de son équipe.",
    params: [frequency(1), escalation(3)],
  },
};

export type RuleParams = Record<string, number>;

export function defaultParams(code: RuleCode): RuleParams {
  return Object.fromEntries(RULES[code].params.map((param) => [param.key, param.default]));
}

/** Schéma de validation des paramètres d'une règle : entiers, dans les bornes de chaque paramètre. */
export function paramsSchema(code: RuleCode) {
  return z.object(
    Object.fromEntries(
      RULES[code].params.map((param) => [
        param.key,
        z.coerce
          .number({ error: `${param.label} : nombre attendu.` })
          .int(`${param.label} : nombre entier attendu.`)
          .min(param.min, `${param.label} : ${param.min} minimum.`)
          .max(param.max, `${param.label} : ${param.max} maximum.`),
      ]),
    ),
  );
}

/** Paramètres stockés, complétés par les valeurs par défaut : une valeur absente ou invalide ne bloque jamais le moteur. */
export function resolveParams(code: RuleCode, stored: unknown): RuleParams {
  const merged = { ...defaultParams(code), ...(typeof stored === "object" && stored !== null ? stored : {}) };
  const parsed = paramsSchema(code).safeParse(merged);
  return parsed.success ? (parsed.data as RuleParams) : defaultParams(code);
}

export function isRuleCode(value: string): value is RuleCode {
  return (RULE_CODES as readonly string[]).includes(value);
}

export function ruleLabel(code: string): string {
  return isRuleCode(code) ? RULES[code].label : code;
}
