'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface CategoryChartProps {
  data: Array<{
    name: string;
    value: number;
  }>;
}

// Restrained brand teal ramp + neutral (one accent, no rainbow).
const COLORS = ['#0F766E', '#14B8A6', '#5EEAD4', '#99F6E4', '#94A3B8'];

export default function CategoryChart({ data }: CategoryChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
          outerRadius={80}
          fill="#0F766E"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '4px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: '#fff',
          }}
          itemStyle={{ color: '#fff' }}
        />
        <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
