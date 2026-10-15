"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFcfa } from "@/lib/format";

export type ForecastPoint = { label: string; signed: number; weighted: number; target: number | null };

// Forecast par période : revenu signé + pipeline pondéré (empilés = forecast), et l'objectif en ligne quand il existe.
// Les séries sont calculées côté serveur : le graphique n'additionne rien lui-même (mêmes chiffres que le tableau).
export function ForecastChart({ data, hasTarget }: { data: ForecastPoint[]; hasTarget: boolean }) {
  const summary = data
    .map((point) => `${point.label} : signé ${formatFcfa(point.signed)}, pondéré ${formatFcfa(point.weighted)}${point.target !== null ? `, objectif ${formatFcfa(point.target)}` : ""}`)
    .join(" ; ");

  return (
    <div role="img" aria-label={`Forecast par période. ${summary}`} className="h-72">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 720, height: 288 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E8EF" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => `${Math.round(value / 1_000_000)} M`} />
          <Tooltip formatter={(value) => formatFcfa(Number(value))} cursor={{ fill: "#EEF6FC" }} />
          <Legend />
          <Bar dataKey="signed" name="Revenu signé" stackId="forecast" fill="#1B2F7E" />
          <Bar dataKey="weighted" name="Pipeline pondéré" stackId="forecast" fill="#51AEE2" radius={[6, 6, 0, 0]} />
          {hasTarget && <Line dataKey="target" name="Objectif" type="monotone" stroke="#B54708" strokeWidth={2} dot={{ r: 3 }} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
