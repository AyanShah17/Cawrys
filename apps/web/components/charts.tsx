// apps/web/components/charts.tsx
import React from "react";

type Series = { key: string; name: string; color: string };
type Row = { label: string } & Record<string, number | string>;

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
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
              <line x1={padL} x2={W} y1={y} y2={y} stroke="white" strokeOpacity="0.07" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#737373">
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
                  <rect key={s.key} x={x} y={y} width={bw} height={h} rx="1.5" fill={s.color}>
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
                  fill="#737373"
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
            fill="#737373"
          >
            No activity in this period
          </text>
        )}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name} <span className="tabular-nums text-neutral-200">{sum(s.key)}</span>
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
      <div role="img" aria-label={ariaLabel} className="flex h-3 overflow-hidden rounded-full bg-white/10">
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
            <span className="flex items-center gap-2 text-neutral-300">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
              {i.label}
            </span>
            <span className="tabular-nums text-neutral-200">{i.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({
  data,
  color = "#6366f1",
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
