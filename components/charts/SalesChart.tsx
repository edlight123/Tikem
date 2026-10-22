'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface SalesChartProps {
  data: Array<{
    date: string
    sales: number
    revenue: number
  }>
  currency?: string
}

export default function SalesChart({ data, currency = 'HTG' }: SalesChartProps) {
  const formatRevenue = (value: unknown) => {
    const amount = Number(value || 0)
    if (!Number.isFinite(amount)) return ''
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: String(currency || 'HTG'),
        currencyDisplay: 'code',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    } catch {
      return `${String(currency || 'HTG')} ${amount.toFixed(2)}`
    }
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0F766E" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#0F766E" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#14B8A6" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#14B8A6" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          stroke="rgba(255,255,255,0.25)"
          tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
          tickLine={false}
        />
        <YAxis
          stroke="rgba(255,255,255,0.25)"
          tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
          tickLine={false}
          tickFormatter={(value) => {
            const n = Number(value || 0)
            if (!Number.isFinite(n)) return ''
            if (Math.abs(n) >= 1000) return `${Math.round(n / 100) / 10}k`
            return String(Math.round(n))
          }}
        />
        <Tooltip
          formatter={(value: unknown, name: unknown) => {
            if (name === 'revenue') return [formatRevenue(value), 'Revenue']
            return [Number(value || 0), 'Tickets']
          }}
          contentStyle={{
            backgroundColor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '4px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: '#fff',
          }}
          labelStyle={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}
          itemStyle={{ color: '#fff' }}
          cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
        />
        <Area 
          type="monotone" 
          dataKey="sales" 
          stroke="#0F766E" 
          fillOpacity={1} 
          fill="url(#colorSales)"
          strokeWidth={2}
        />
        <Area 
          type="monotone" 
          dataKey="revenue" 
          stroke="#14B8A6" 
          fillOpacity={1} 
          fill="url(#colorRevenue)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
