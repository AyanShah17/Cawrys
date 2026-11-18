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
  maxValue = 120,
}: {
  data?: VelocityBar[];
  title?: string;
  maxValue?: number;
}) {
  const peakValue = data.reduce((m, b) => (b.value > m ? b.value : m), 0);
  const scaleMax = Math.max(maxValue, peakValue) <= 120 ? 120 : niceMax(Math.max(maxValue, peakValue));
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(scaleMax * f));

  return (
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-neutral-950">{title}</h2>
          <p className="mt-0.5 text-xs text-neutral-600">
            Real-time CNC spindle actuation &amp; units completed per hour
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-600">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-950" aria-hidden="true" />
            <span className="font-medium text-neutral-800 tabular-nums">
              Peak Output ({peakValue} u/h)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" aria-hidden="true" />
            <span>Standard Run</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[560px]">
          <div className="flex items-stretch gap-3">
            {/* Y-axis ticks */}
            <div
              className="flex h-[184px] shrink-0 flex-col justify-between pr-1 text-right text-[11px] font-medium text-neutral-600 tabular-nums select-none"
              aria-hidden="true"
            >
              {yTicks.map((t) => (
                <span key={t} className="leading-none">
                  {t}
                </span>
              ))}
            </div>

            {/* Plot area with reference gridlines */}
            <div className="relative flex-1">
              <div
                className="pointer-events-none absolute inset-0 flex h-[184px] flex-col justify-between"
                aria-hidden="true"
              >
                {yTicks.map((t) => (
                  <div key={t} className="w-full border-b border-neutral-100" />
                ))}
              </div>

              <div className="relative flex h-[184px] items-end justify-between gap-1.5 sm:gap-2 px-1">
                {data.map((bar) => {
                  const isPeak = bar.isPeak || (peakValue > 0 && bar.value === peakValue);
                  const heightPercent =
                    bar.value === 0 ? 0 : Math.min(100, Math.max(4, (bar.value / scaleMax) * 100));

                  return (
                    <div
                      key={bar.time}
                      className="group relative flex h-full flex-1 flex-col items-center justify-end"
                    >
                      <span
                        className={`mb-1 text-[11px] tabular-nums transition-colors duration-150 ${
                          isPeak
                            ? "font-bold text-neutral-950"
                            : bar.value === 0
                            ? "font-medium text-neutral-500"
                            : "font-medium text-neutral-600 group-hover:text-neutral-950"
                        }`}
                      >
                        {bar.value}
                      </span>

                      <div
                        className="flex w-full items-end justify-center"
                        style={{ height: bar.value === 0 ? "3px" : `${heightPercent}%` }}
                      >
                        <div
                          title={`${bar.time}: ${bar.value} units/hr`}
                          className={`h-full w-full max-w-[26px] rounded-full transition-colors duration-150 ease-out-quart ${
                            isPeak
                              ? "bg-neutral-950"
                              : bar.value === 0
                              ? "bg-neutral-300"
                              : "bg-neutral-200 group-hover:bg-neutral-400"
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* X-axis time labels */}
              <div className="mt-2.5 flex items-center justify-between gap-1.5 sm:gap-2 px-1">
                {data.map((bar) => (
                  <span
                    key={bar.time}
                    className="flex-1 text-center text-[11px] font-medium text-neutral-600 tabular-nums select-none"
                  >
                    {bar.time}
                  </span>
                ))}
              </div>
            </div>
          </div>
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
    H = 176,
    padL = 34,
    padB = 24,
    padT = 8;
  const totals = data.map((d) => series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const innerW = W - padL,
    innerH = H - padB - padT;
  const slot = innerW / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(28, slot * 0.66));
  const sum = (k: string) => data.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const empty = totals.every((t) => t === 0);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const labelIdx = new Set([0, Math.floor((data.length - 1) / 2), Math.max(0, data.length - 1)]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full">
        {ticks.map((t) => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="#e5e7eb" />
              <text
                x={padL - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                fill="#525252"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
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
                  fontSize="10"
                  fill="#525252"
                  style={{ fontVariantNumeric: "tabular-nums" }}
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
            fill="#525252"
          >
            No activity in this period
          </text>
        )}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-neutral-600">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span>{s.name}</span>
            <span className="font-semibold text-neutral-950 tabular-nums">{sum(s.key)}</span>
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
      <div role="img" aria-label={ariaLabel} className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
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
      <ul className="mt-3 space-y-1.5 text-xs">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-neutral-600">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
              {i.label}
            </span>
            <span className="font-semibold text-neutral-950 tabular-nums">{i.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({
  data,
  color = "#171717",
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
