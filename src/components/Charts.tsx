import React, { useState } from 'react';
import { ChartVisualType } from '../types/finance';

export interface ChartDataPoint {
  label: string;
  value: number;
  budget?: number;
  secondaryValue?: number;
  isSubtotal?: boolean;
  drillKey?: string;
}

interface InteractiveChartProps {
  data: ChartDataPoint[];
  chartType: ChartVisualType;
  height?: number;
  showBudgetOverlay?: boolean;
  valuePrefix?: string;
  onPointClick?: (point: ChartDataPoint) => void;
}

function formatCompactMoney(val: number, prefix = '$'): string {
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${prefix}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${prefix}${abs.toFixed(0)}`;
}

export const InteractiveFinanceChart: React.FC<InteractiveChartProps> = ({
  data,
  chartType,
  height = 260,
  showBudgetOverlay = true,
  valuePrefix = '$',
  onPointClick,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        No data available for this selection.
      </div>
    );
  }

  const width = 760;
  const pad = { top: 20, right: 20, bottom: 38, left: 62 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Compute waterfall running totals if needed
  const waterfallBars = (() => {
    let running = 0;
    return data.map((d) => {
      if (d.isSubtotal) {
        const start = 0;
        const end = d.value;
        running = d.value;
        return { ...d, start, end };
      }
      const start = running;
      const end = running + d.value;
      running = end;
      return { ...d, start, end };
    });
  })();

  const allValues: number[] = [];
  if (chartType === 'waterfall') {
    for (const b of waterfallBars) {
      allValues.push(b.start, b.end);
    }
  } else {
    for (const d of data) {
      allValues.push(d.value);
      if (showBudgetOverlay && typeof d.budget === 'number') {
        allValues.push(d.budget);
      }
    }
  }
  allValues.push(0);

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const span = Math.max(1, rawMax - rawMin);
  const minY = rawMin < 0 ? rawMin - span * 0.1 : 0;
  const maxY = rawMax + span * 0.12;
  const yRange = Math.max(1, maxY - minY);

  const yToPx = (val: number) => pad.top + ((maxY - val) / yRange) * plotH;
  const zeroY = yToPx(0);

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => minY + (yRange * i) / tickCount);

  const stepX = plotW / Math.max(1, data.length);
  const barWidth = Math.min(40, stepX * 0.56);

  const pointsForLine = data.map((d, i) => ({
    x: pad.left + stepX * i + stepX / 2,
    y: yToPx(d.value),
    budgetY: typeof d.budget === 'number' ? yToPx(d.budget) : null,
  }));

  const linePath = pointsForLine
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    pointsForLine.length > 0
      ? `${linePath} L ${pointsForLine[pointsForLine.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${pointsForLine[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
      : '';

  const budgetPoints = pointsForLine.filter((p) => p.budgetY !== null);
  const budgetPath = budgetPoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${(p.budgetY as number).toFixed(1)}`)
    .join(' ');

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="Financial performance chart"
      >
        {/* Horizontal gridlines */}
        {yTicks.map((tick, idx) => {
          const y = yToPx(tick);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                className={
                  Math.abs(tick) < 1e-3
                    ? 'text-slate-300 dark:text-slate-700'
                    : 'text-slate-200/80 dark:text-slate-800'
                }
                strokeDasharray={Math.abs(tick) < 1e-3 ? undefined : '3 3'}
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-400 font-mono text-[10px] tabular-nums dark:fill-slate-500"
              >
                {formatCompactMoney(tick, valuePrefix)}
              </text>
            </g>
          );
        })}

        {/* Bars / Waterfall */}
        {(chartType === 'bar' || chartType === 'waterfall') &&
          data.map((d, i) => {
            const cx = pad.left + stepX * i + stepX / 2;
            const x = cx - barWidth / 2;

            if (chartType === 'waterfall') {
              const wf = waterfallBars[i];
              const topVal = Math.max(wf.start, wf.end);
              const botVal = Math.min(wf.start, wf.end);
              const yTop = yToPx(topVal);
              const yBot = yToPx(botVal);
              const barH = Math.max(2, yBot - yTop);
              const isPos = d.value >= 0;
              const fillClass = d.isSubtotal
                ? 'fill-slate-800 dark:fill-slate-200'
                : isPos
                  ? 'fill-teal-600 dark:fill-teal-500'
                  : 'fill-rose-600 dark:fill-rose-500';

              const nextWf = waterfallBars[i + 1];
              return (
                <g
                  key={d.label}
                  className={onPointClick ? 'cursor-pointer' : undefined}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                  onClick={() => onPointClick?.(d)}
                >
                  <rect
                    x={x}
                    y={yTop}
                    width={barWidth}
                    height={barH}
                    rx={2}
                    className={`${fillClass} transition-opacity duration-150 ${
                      hoverIdx !== null && hoverIdx !== i ? 'opacity-65' : 'opacity-100'
                    }`}
                  />
                  {nextWf && !nextWf.isSubtotal && (
                    <line
                      x1={x + barWidth}
                      x2={pad.left + stepX * (i + 1) + stepX / 2 - barWidth / 2}
                      y1={yToPx(wf.end)}
                      y2={yToPx(wf.end)}
                      stroke="currentColor"
                      strokeDasharray="2 2"
                      className="text-slate-400 dark:text-slate-600"
                    />
                  )}
                </g>
              );
            }

            // Standard Bar (Actual + Optional Budget ghost bar)
            const yTop = d.value >= 0 ? yToPx(d.value) : zeroY;
            const yBot = d.value >= 0 ? zeroY : yToPx(d.value);
            const barH = Math.max(2, yBot - yTop);
            const hasBudget = showBudgetOverlay && typeof d.budget === 'number';
            const singleW = hasBudget ? barWidth * 0.56 : barWidth;

            return (
              <g
                key={d.label}
                className={onPointClick ? 'cursor-pointer' : undefined}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => onPointClick?.(d)}
              >
                {hasBudget && (
                  <rect
                    x={cx + 1}
                    y={Math.min(zeroY, yToPx(d.budget!))}
                    width={singleW}
                    height={Math.max(2, Math.abs(zeroY - yToPx(d.budget!)))}
                    rx={2}
                    className="fill-slate-300 dark:fill-slate-700"
                  />
                )}
                <rect
                  x={hasBudget ? cx - singleW - 1 : x}
                  y={yTop}
                  width={singleW}
                  height={barH}
                  rx={2}
                  className={`transition-opacity duration-150 ${
                    d.value >= 0
                      ? 'fill-teal-700 dark:fill-teal-500'
                      : 'fill-rose-600 dark:fill-rose-500'
                  } ${hoverIdx !== null && hoverIdx !== i ? 'opacity-65' : 'opacity-100'}`}
                />
              </g>
            );
          })}

        {/* Area & Line Charts */}
        {(chartType === 'area' || chartType === 'line') && (
          <g>
            {chartType === 'area' && (
              <path d={areaPath} className="fill-teal-600/12 dark:fill-teal-400/12" />
            )}
            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.25}
              className="text-teal-700 dark:text-teal-400"
            />
            {showBudgetOverlay && budgetPath && (
              <path
                d={budgetPath}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeDasharray="4 4"
                className="text-slate-400 dark:text-slate-500"
              />
            )}
            {pointsForLine.map((p, i) => (
              <g
                key={data[i].label}
                className={onPointClick ? 'cursor-pointer' : undefined}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => onPointClick?.(data[i])}
              >
                <rect
                  x={p.x - stepX / 2}
                  y={pad.top}
                  width={stepX}
                  height={plotH}
                  fill="transparent"
                />
                {hoverIdx === i && (
                  <line
                    x1={p.x}
                    x2={p.x}
                    y1={pad.top}
                    y2={pad.top + plotH}
                    stroke="currentColor"
                    strokeWidth={1}
                    className="text-slate-300 dark:text-slate-700"
                  />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hoverIdx === i ? 5 : 3.25}
                  className="fill-white stroke-teal-700 stroke-2 dark:fill-slate-900 dark:stroke-teal-400"
                />
              </g>
            ))}
          </g>
        )}

        {/* X Axis Labels */}
        {data.map((d, i) => {
          const cx = pad.left + stepX * i + stepX / 2;
          return (
            <text
              key={d.label}
              x={cx}
              y={height - 10}
              textAnchor="middle"
              className={`text-[10px] ${
                hoverIdx === i
                  ? 'fill-slate-900 font-semibold dark:fill-slate-100'
                  : 'fill-slate-500 dark:fill-slate-400'
              }`}
            >
              {d.label.length > 11 ? `${d.label.slice(0, 10)}…` : d.label}
            </text>
          );
        })}
      </svg>

      {/* Clean Interactive Hover Readout */}
      {hovered && hoverIdx !== null && (
        <div className="pointer-events-none absolute right-3 top-2 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95">
          <div className="font-medium text-slate-900 dark:text-slate-100">{hovered.label}</div>
          <div className="mt-1 flex items-center gap-4 font-mono tabular-nums">
            <span className="text-teal-700 dark:text-teal-400">
              Actual: {formatCompactMoney(hovered.value, valuePrefix)}
            </span>
            {showBudgetOverlay && typeof hovered.budget === 'number' && (
              <span className="text-slate-500 dark:text-slate-400">
                Plan: {formatCompactMoney(hovered.budget, valuePrefix)}
              </span>
            )}
          </div>
          {onPointClick && (
            <div className="mt-0.5 text-[10px] text-slate-400">Click bar/point to drill down</div>
          )}
        </div>
      )}
    </div>
  );
};
