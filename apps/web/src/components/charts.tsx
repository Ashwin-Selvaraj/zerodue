'use client';

import { formatINR } from '@zerodue/shared';
import { useState, type ReactNode } from 'react';
import { compactINR, niceTicks } from '@/lib/format';

/**
 * Small SVG charts. Colours come from the --viz-series-N variables (blue, orange, aqua...), marks are
 * thin, and every chart has a readout you can tap and a table view, so nothing depends on colour alone.
 */

const series = (slot: number): string => `var(--viz-series-${slot})`;
const TEXT = 'fill-slate-600 dark:fill-slate-400';

export interface ChartSeries {
  name: string;
  values: number[];
  /** 1-6, following the fixed palette order. */
  slot: number;
}

function Legend({ items }: { items: { name: string; slot: number }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: series(item.slot) }}
          />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

function TableToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="min-h-11 self-start text-sm underline">
      {shown ? 'Show chart' : 'Show as table'}
    </button>
  );
}

function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`py-1 font-medium ${i ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-slate-200 dark:border-slate-800">
              {row.map((cell, i) => (
                <td key={i} className={`py-1 ${i ? 'text-right tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────── columns ─────────────────────────────

const W = 320;
const H = 180;
const LEFT = 36;
const TOP = 8;
const BOTTOM = 24;

/** A column with a rounded top and a square base. */
function columnPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${bottom} Z`;
}

export function ColumnChart({
  title,
  categories,
  series: data,
}: {
  title: string;
  categories: string[];
  series: ChartSeries[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(0, ...data.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const plotW = W - LEFT - 4;
  const plotH = H - TOP - BOTTOM;
  const slot = plotW / Math.max(1, categories.length);
  const barW = Math.max(3, Math.min(24, (slot - 6) / data.length - 2));
  const groupW = barW * data.length + 2 * (data.length - 1);
  const y = (value: number): number => TOP + plotH - (value / top) * plotH;
  const labelEvery = Math.ceil(categories.length / 6);
  const readout =
    selected === null
      ? 'Tap a column to read its values.'
      : `${categories[selected]}: ${data.map((s) => `${s.name} ${formatINR(s.values[selected] ?? 0)}`).join(' · ')}`;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-medium">{title}</figcaption>
      <Legend items={data} />
      {table ? (
        <DataTable
          caption={title}
          head={['', ...data.map((s) => s.name)]}
          rows={categories.map((c, i) => [c, ...data.map((s) => formatINR(s.values[i] ?? 0))])}
        />
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={title}
          className="w-full md:mx-auto md:max-w-md"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={LEFT}
                x2={W - 4}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--viz-grid)"
                strokeWidth={1}
              />
              <text x={LEFT - 6} y={y(tick) + 4} textAnchor="end" fontSize={10} className={TEXT}>
                {compactINR(tick)}
              </text>
            </g>
          ))}
          {categories.map((category, i) => {
            const x0 = LEFT + i * slot + (slot - groupW) / 2;
            return (
              <g key={category}>
                {data.map((s, k) => {
                  const value = s.values[i] ?? 0;
                  const height = Math.max(0, plotH - (y(value) - TOP));
                  return height > 0 ? (
                    <path
                      key={s.name}
                      d={columnPath(x0 + k * (barW + 2), y(value), barW, height)}
                      fill={series(s.slot)}
                      opacity={selected === null || selected === i ? 1 : 0.55}
                    />
                  ) : null;
                })}
                {i % labelEvery === 0 && (
                  <text
                    x={LEFT + i * slot + slot / 2}
                    y={H - 8}
                    textAnchor="middle"
                    fontSize={10}
                    className={TEXT}
                  >
                    {category}
                  </text>
                )}
                <rect
                  x={LEFT + i * slot}
                  y={TOP}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${category}: ${data.map((s) => `${s.name} ${formatINR(s.values[i] ?? 0)}`).join(', ')}`}
                  onClick={() => setSelected(i)}
                  onFocus={() => setSelected(i)}
                  onMouseEnter={() => setSelected(i)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {!table && (
        <p className="text-sm" aria-live="polite">
          {readout}
        </p>
      )}
      <TableToggle shown={table} onToggle={() => setTable(!table)} />
    </figure>
  );
}

// ───────────────────────────── donut ─────────────────────────────

export interface DonutSlice {
  label: string;
  valuePaise: number;
}

const R = 70;
const STROKE = 22;

function arc(from: number, to: number): string {
  const point = (t: number): [number, number] => [
    90 + R * Math.sin(2 * Math.PI * t),
    90 - R * Math.cos(2 * Math.PI * t),
  ];
  const [x1, y1] = point(from);
  const [x2, y2] = point(Math.min(to, 0.99999));
  return `M${x1},${y1} A${R},${R} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x2},${y2}`;
}

/** Share of a total. Up to five named slices; the caller folds the rest into "Other". */
export function Donut({ title, slices }: { title: string; slices: DonutSlice[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const total = slices.reduce((sum, s) => sum + s.valuePaise, 0);
  let cursor = 0;
  const arcs = slices.map((slice, index) => {
    const from = cursor;
    cursor += total === 0 ? 0 : slice.valuePaise / total;
    return { ...slice, index, from, to: cursor };
  });
  const percent = (value: number): string =>
    total ? `${Math.round((value * 100) / total)}%` : '0%';
  const active = selected === null ? null : slices[selected];

  if (total === 0)
    return <p className="text-sm text-slate-600 dark:text-slate-400">Nothing to show yet.</p>;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-medium">{title}</figcaption>
      {table ? (
        <DataTable
          caption={title}
          head={['Category', 'Amount', 'Share']}
          rows={slices.map((s) => [s.label, formatINR(s.valuePaise), percent(s.valuePaise)])}
        />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <svg viewBox="0 0 180 180" role="img" aria-label={title} className="w-44">
            {arcs.map((a) => (
              <path
                key={a.label}
                d={arc(a.from, a.to)}
                fill="none"
                stroke={series(Math.min(a.index + 1, 6))}
                strokeWidth={STROKE}
                opacity={selected === null || selected === a.index ? 1 : 0.5}
              />
            ))}
            {arcs.length > 1 &&
              arcs.map((a) => {
                const angle = 2 * Math.PI * a.from;
                return (
                  <line
                    key={`gap-${a.label}`}
                    x1={90 + (R - STROKE / 2 - 1) * Math.sin(angle)}
                    y1={90 - (R - STROKE / 2 - 1) * Math.cos(angle)}
                    x2={90 + (R + STROKE / 2 + 1) * Math.sin(angle)}
                    y2={90 - (R + STROKE / 2 + 1) * Math.cos(angle)}
                    stroke="var(--viz-surface)"
                    strokeWidth={2}
                  />
                );
              })}
            <text x={90} y={86} textAnchor="middle" fontSize={11} className={TEXT}>
              {active ? active.label : 'Total'}
            </text>
            <text
              x={90}
              y={104}
              textAnchor="middle"
              fontSize={14}
              fontWeight={600}
              className="fill-slate-900 dark:fill-slate-100"
            >
              {formatINR(active ? active.valuePaise : total)}
            </text>
          </svg>
          <ul className="w-full">
            {slices.map((slice, index) => (
              <li key={slice.label}>
                <button
                  type="button"
                  onClick={() => setSelected(selected === index ? null : index)}
                  aria-pressed={selected === index}
                  className="flex min-h-11 w-full items-center gap-3 text-left text-sm"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: series(Math.min(index + 1, 6)) }}
                  />
                  <span className="flex-1">{slice.label}</span>
                  <span className="tabular-nums">{formatINR(slice.valuePaise)}</span>
                  <span className="w-10 text-right tabular-nums text-slate-600 dark:text-slate-400">
                    {percent(slice.valuePaise)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <TableToggle shown={table} onToggle={() => setTable(!table)} />
    </figure>
  );
}

// ───────────────────────────── line ─────────────────────────────

export interface LinePoint {
  label: string;
  /** What happened (solid line). */
  actual?: number;
  /** What is expected (dashed line). */
  projected?: number;
}

export function LineChart({ title, points }: { title: string; points: LinePoint[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = points.flatMap((p) => [p.actual, p.projected]).filter((v) => v !== undefined);
  const ticks = niceTicks(Math.max(0, ...(values as number[])));
  const top = ticks[ticks.length - 1]!;
  const plotW = W - LEFT - 8;
  const plotH = H - TOP - BOTTOM;
  const x = (i: number): number =>
    LEFT + (points.length < 2 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (value: number): number => TOP + plotH - (value / top) * plotH;
  const path = (pick: (p: LinePoint) => number | undefined): string =>
    points
      .map((p, i) => ({ v: pick(p), i }))
      .filter((p) => p.v !== undefined)
      .map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v!)}`)
      .join(' ');
  const lastActual = points.map((p) => p.actual).findLastIndex((v) => v !== undefined);
  const labelEvery = Math.ceil(points.length / 5);
  const read = (p: LinePoint): string =>
    [
      p.actual !== undefined ? `balance ${formatINR(p.actual)}` : null,
      p.projected !== undefined ? `expected ${formatINR(p.projected)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-medium">{title}</figcaption>
      {table ? (
        <DataTable
          caption={title}
          head={['Month', 'Balance', 'Expected']}
          rows={points.map((p) => [
            p.label,
            p.actual === undefined ? '—' : formatINR(p.actual),
            p.projected === undefined ? '—' : formatINR(p.projected),
          ])}
        />
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={title}
          className="w-full md:mx-auto md:max-w-md"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={LEFT}
                x2={W - 4}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--viz-grid)"
                strokeWidth={1}
              />
              <text x={LEFT - 6} y={y(tick) + 4} textAnchor="end" fontSize={10} className={TEXT}>
                {compactINR(tick)}
              </text>
            </g>
          ))}
          <path
            d={path((p) => p.projected)}
            fill="none"
            stroke={series(1)}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={path((p) => p.actual)}
            fill="none"
            stroke={series(1)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {lastActual >= 0 && (
            <circle
              cx={x(lastActual)}
              cy={y(points[lastActual]!.actual!)}
              r={4}
              fill={series(1)}
              stroke="var(--viz-surface)"
              strokeWidth={2}
            />
          )}
          {selected !== null && (
            <line
              x1={x(selected)}
              x2={x(selected)}
              y1={TOP}
              y2={TOP + plotH}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
          )}
          {points.map((p, i) => (
            <g key={p.label}>
              {i % labelEvery === 0 && (
                <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} className={TEXT}>
                  {p.label}
                </text>
              )}
              <rect
                x={x(i) - plotW / Math.max(1, points.length - 1) / 2}
                y={TOP}
                width={plotW / Math.max(1, points.length - 1)}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${p.label}: ${read(p)}`}
                onClick={() => setSelected(i)}
                onFocus={() => setSelected(i)}
                onMouseEnter={() => setSelected(i)}
              />
            </g>
          ))}
        </svg>
      )}
      {!table && (
        <p className="text-sm" aria-live="polite">
          {selected === null
            ? 'Tap the chart to read a month.'
            : `${points[selected]!.label}: ${read(points[selected]!)}`}
        </p>
      )}
      <p className="flex gap-4 text-sm text-slate-700 dark:text-slate-300">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-5"
            style={{ background: series(1) }}
          />
          Actual
        </span>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-0 w-5 border-t-2 border-dashed"
            style={{ borderColor: series(1) }}
          />
          Expected
        </span>
      </p>
      <TableToggle shown={table} onToggle={() => setTable(!table)} />
    </figure>
  );
}
