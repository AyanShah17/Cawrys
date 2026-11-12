// apps/web/components/charts.tsx
import React from "react";

type Series = { key: string; name: string; color: string };
type Row = { label: string } & Record<string, number | string>;

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
}

export type VelocityBar = {
  time: string;
  value: number;
  isPeak?: boolean;
};

export const DEFAULT_VELOCITY_DATA: VelocityBar[] = [
  { time: "12AM", value: 42 },
  { time: "1AM", value: 36 },
  { time: "2AM", value: 61 },
  { time: "3AM", value: 84 },
  { time: "4AM", value: 89, isPeak: true },
  { time: "5AM", value: 63 },
  { time: "6AM", value: 32 },
  { time: "7AM", value: 42 },
  { time: "8AM", value: 61 },
  { time: "9AM", value: 39 },
  { time: "10AM", value: 63 },
  { time: "11AM", value: 37 },
  { time: "12PM", value: 43 },
  { time: "1PM", value: 56 },
  { time: "2PM", value: 0 },
  { time: "3PM", value: 43 },
  { time: "4PM", value: 43 },
  { time: "5PM", value: 32 },
];

export function TelemetryVelocityBarChart({
  data = DEFAULT_VELOCITY_DATA,
  title = "Line 2 Production Velocity",
  maxValue = 100,
}: {
  data?: VelocityBar[];
  title?: string;
  maxValue?: number;
}) {
  const yTicks = [120, 100, 80, 60, 40, 20, 0];
  const chartHeightPx = 180;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-neutral-900 tracking-tight">{title}</h3>
          <p className="text-xs text-neutral-500 mt-0.5">Real-time CNC spindle actuation & units completed per hour</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-950" />
            <span className="text-neutral-600 font-medium">Peak Output (89 u/h)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-200" />
            <span className="text-neutral-500">Standard Run</span>
          </div>
        </div>
      </div>

      <div className="flex items-end gap-2 sm:gap-3 overflow-x-auto pb-2 pt-6">
        {/* Y Axis ticks */}
        <div className="flex flex-col justify-between text-[10px] text-neutral-400 font-medium h-[180px] pr-2 border-r border-neutral-100 select-none shrink-0">
          {yTicks.map((t) => (
            <span key={t} className="leading-none">{t}</span>
          ))}
        </div>

        {/* Bars Container */}
        <div className="flex-1 flex items-end justify-between gap-1.5 sm:gap-2.5 min-w-[580px] h-[180px] px-2">
          {data.map((bar) => {
            const heightPercent = Math.min(100, Math.max(4, (bar.value / 120) * 100));
            return (
              <div
                key={bar.time}
                className="flex-1 flex flex-col items-center justify-end h-full group relative"
              >
                {/* Numeric value label above bar */}
                <span
                  className={`text-[10px] font-semibold mb-1 tabular-nums transition-opacity ${
                    bar.isPeak
                      ? "text-neutral-950 font-bold scale-105"
                      : "text-neutral-400 group-hover:text-neutral-700"
                  }`}
                >
                  {bar.value}
                </span>

                {/* Vertical Bar Pill */}
                <div className="w-full flex justify-center items-end" style={{ height: `${heightPercent}%` }}>
                  <div
                    className={`w-full max-w-[28px] rounded-full transition-all duration-300 ${
                      bar.isPeak
                        ? "bg-neutral-950 shadow-md ring-2 ring-neutral-950/20"
                        : bar.value === 0
                        ? "bg-neutral-100 h-1.5"
                        : "bg-neutral-100 group-hover:bg-neutral-200/90"
                    }`}
                    style={{ height: "100%" }}
                  />
                </div>

                {/* X Axis Time Label */}
                <span className="text-[10px] text-neutral-400 font-medium mt-2 shrink-0 select-none">
                  {bar.time}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function StackedBars({
  data,
  series,
  ariaLabel,
}: {
  data: Row[];
  series: Series[];
  ariaLabel: string;
}) {
  const W = 640,
    H = 170,
    padL = 30,
    padB = 22,
    padT = 6;
  const totals = data.map((d) => series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const innerW = W - padL,
    innerH = H - padB - padT;
  const slot = innerW / Math.max(1, data.length);
  const bw = Math.max(3, slot * 0.68);
  const sum = (k: string) => data.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const empty = totals.every((t) => t === 0);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const labelIdx = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full">
        {ticks.map((t) => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="#e5e7eb" strokeOpacity="0.8" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
                {t}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          let y = padT + innerH;
          return (
            <g key={d.label}>
              {series.map((s) => {
                const v = Number(d[s.key]) || 0;
                if (!v) return null;
                const h = (v / max) * innerH;
                y -= h;
                return (
                  <rect key={s.key} x={x} y={y} width={bw} height={h} rx="2" fill={s.color}>
                    <title>{`${d.label}: ${v} ${s.name}`}</title>
                  </rect>
                );
              })}
              {labelIdx.has(i) && (
                <text
                  x={x + bw / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#9ca3af"
                >
                  {String(d.label).slice(5)}
                </text>
              )}
            </g>
          );
        })}
        {empty && (
          <text
            x={padL + innerW / 2}
            y={padT + innerH / 2}
            textAnchor="middle"
            fontSize="12"
            fill="#9ca3af"
          >
            No activity in this period
          </text>
        )}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.name} <span className="tabular-nums font-semibold text-neutral-800">{sum(s.key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Distribution({
  items,
  ariaLabel,
}: {
  items: { label: string; value: number; color: string }[];
  ariaLabel: string;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex h-3 overflow-hidden rounded-full bg-neutral-100">
        {total > 0 &&
          items
            .filter((i) => i.value > 0)
            .map((i) => (
              <div
                key={i.label}
                title={`${i.label}: ${i.value}`}
                style={{ width: `${(i.value / total) * 100}%`, background: i.color }}
              />
            ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-neutral-600 text-xs">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
              {i.label}
            </span>
            <span className="tabular-nums font-semibold text-neutral-900 text-xs">{i.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({
  data,
  color = "#0f172a",
  width = 100,
  height = 24,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
