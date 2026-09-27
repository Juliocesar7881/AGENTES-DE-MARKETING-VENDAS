"use client";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/utils";

interface Point {
  date: string;
  revenueCents: number;
  sales: number;
  leads: number;
}

function label(date: string) {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

function TooltipBox({ active, payload, label: l, currency }: { active?: boolean; payload?: { payload: Point }[]; label?: string; currency: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-medium">{l ? label(l) : ""}</div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Attributed revenue</span>
        <span className="tabular font-medium">{money(p.revenueCents, currency)}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Sales</span>
        <span className="tabular">{p.sales}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Leads</span>
        <span className="tabular">{p.leads}</span>
      </div>
    </div>
  );
}

export function RevenueChart({ data, currency = "BRL", height = 240 }: { data: Point[]; currency?: string; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={label} tickLine={false} axisLine={false} tick={{ fill: "var(--subtle)", fontSize: 11 }} minTickGap={24} />
          <YAxis yAxisId="rev" tickFormatter={(v: number) => money(v, currency).replace(/,00$/, "")} tickLine={false} axisLine={false} tick={{ fill: "var(--subtle)", fontSize: 11 }} width={72} />
          <YAxis yAxisId="leads" orientation="right" tickLine={false} axisLine={false} tick={{ fill: "var(--subtle)", fontSize: 11 }} width={28} allowDecimals={false} />
          <Tooltip content={<TooltipBox currency={currency} />} cursor={{ stroke: "var(--border-strong)" }} />
          <Bar yAxisId="leads" dataKey="leads" fill="var(--chart-4)" opacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={14} />
          <Area yAxisId="rev" type="monotone" dataKey="revenueCents" stroke="var(--chart-1)" strokeWidth={2} fill="url(#rev)" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ data, height = 36 }: { data: number[]; height?: number }) {
  const pts = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pts} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={1.5} fill="var(--chart-1)" fillOpacity={0.12} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FunnelBars({ data }: { data: { stage: string; value: number | null }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value ?? 0));
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const prev = i > 0 ? data[i - 1]!.value : null;
        const conv = prev && d.value != null && prev > 0 ? d.value / prev : null;
        return (
          <div key={d.stage}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{d.stage}</span>
              <span className="tabular font-medium">
                {d.value == null ? "not available" : new Intl.NumberFormat("pt-BR").format(d.value)}
                {conv != null ? <span className="ml-2 text-subtle">{(conv * 100).toFixed(1)}%</span> : null}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400" style={{ width: `${d.value == null ? 0 : Math.max(2, (d.value / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
