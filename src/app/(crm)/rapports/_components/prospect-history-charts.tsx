"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Graphiques de l'historique des prospects. Les séries sont calculées côté serveur : les graphiques n'additionnent rien eux-mêmes
// (mêmes chiffres que les tableaux). Chaque graphique porte un résumé textuel pour les lecteurs d'écran.

export type ComparePoint = { label: string; current: number; previous: number };

/** Nouveaux prospects (barres) comparés à la période de référence (ligne) : semaine précédente, ou même jour de la semaine passée. */
export function CompareChart({ data, title, previousLabel }: { data: ComparePoint[]; title: string; previousLabel: string }) {
  const summary = data.map((point) => `${point.label} : ${point.current} (${previousLabel.toLowerCase()} : ${point.previous})`).join(" ; ");
  return (
    <div role="img" aria-label={`${title}. ${summary}`} className="h-72">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 720, height: 288 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E8EF" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip cursor={{ fill: "#EEF6FC" }} />
          <Legend />
          <Bar dataKey="current" name="Nouveaux prospects" fill="#1B2F7E" radius={[6, 6, 0, 0]} />
          {/* Segments droits : des effectifs n'ont pas de valeurs intermédiaires (un lissage en inventerait). */}
          <Line dataKey="previous" name={previousLabel} type="linear" stroke="#B54708" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Du plus clair (début du process) au plus foncé (closing) : l'ordre des étapes se lit sur la couleur.
const STAGE_COLORS = ["#CFE6F6", "#9FD0EE", "#51AEE2", "#2F7FC1", "#1F57A4", "#1B2F7E"];

/** Prospects ouverts à chaque étape, empilés, à la fin de chaque période (`s10`, `s20`… = une colonne par étape). */
export function StageChart({
  data,
  stages,
  title,
}: {
  data: Record<string, number | string>[];
  stages: { stage: number; name: string }[];
  title: string;
}) {
  const summary = data.map((point) => `${point.label} : ${stages.map((s) => `${s.name} ${point[`s${s.stage}`]}`).join(", ")}`).join(" ; ");
  return (
    <div role="img" aria-label={`${title}. ${summary}`} className="h-80">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 720, height: 320 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E8EF" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip cursor={{ fill: "#EEF6FC" }} />
          <Legend />
          {stages.map((stage, index) => (
            <Bar
              key={stage.stage}
              dataKey={`s${stage.stage}`}
              name={`${stage.stage} % ${stage.name}`}
              stackId="stages"
              fill={STAGE_COLORS[index % STAGE_COLORS.length]}
              radius={index === stages.length - 1 ? [6, 6, 0, 0] : undefined}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
