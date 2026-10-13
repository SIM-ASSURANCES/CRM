"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFcfa } from "@/lib/format";

// Histogramme de la valeur du pipeline sur les 4 dernières semaines (Excel).
export function PipelineBars({ data }: { data: { label: string; gross: number }[] }) {
  const summary = data.map((d) => `${d.label} : ${formatFcfa(d.gross)}`).join(" ; ");

  return (
    <div role="img" aria-label={`Valeur du pipeline sur les 4 dernières semaines. ${summary}`} className="h-56">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 224 }}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E8EF" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => `${Math.round(value / 1_000_000)} M`}
          />
          <Tooltip formatter={(value) => formatFcfa(Number(value))} cursor={{ fill: "#EEF6FC" }} />
          <Bar dataKey="gross" name="Pipeline" fill="#004B9C" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
