"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// Camembert du taux de transformation (Excel : « Afficher un graphique en camembert »).
const COLORS = ["#004B9C", "#CBD5E1"];

export function ConversionPie({ won, lost }: { won: number; lost: number }) {
  if (won + lost === 0) {
    return <p className="py-10 text-center text-sm text-muted">Aucune affaire clôturée cette semaine.</p>;
  }

  const data = [
    { name: "Gagnées", value: won },
    { name: "Perdues", value: lost },
  ];

  return (
    <div role="img" aria-label={`Affaires clôturées cette semaine : ${won} gagnée(s), ${lost} perdue(s)`} className="h-56">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 224 }}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={COLORS[index]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
