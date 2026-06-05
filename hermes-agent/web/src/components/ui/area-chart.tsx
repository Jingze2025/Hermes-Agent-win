import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Series {
  label: string;
  color: string;
  data: number[];
}

interface AreaChartProps {
  /** 多个系列共享同一组 X 轴标签 */
  series: Series[];
  labels: string[];
  height?: number;
  className?: string;
  /** 是否使用渐变填充 */
  gradient?: boolean;
  /** 是否堆叠 */
  stacked?: boolean;
  /** 自定义工具提示渲染 */
  formatTooltipValue?: (value: number, seriesLabel: string) => string;
  formatXAxis?: (label: string, index: number) => string;
}

/**
 * 平滑面积图，支持多系列堆叠或叠加，带交互式 tooltip。
 * 使用 SVG 路径绘制，无外部依赖。
 */
export function AreaChart({
  series,
  labels,
  height = 200,
  className,
  gradient = true,
  stacked = false,
  formatTooltipValue = (v) => String(v),
  formatXAxis = (l) => l,
}: AreaChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const computed = useMemo(() => {
    if (series.length === 0 || labels.length === 0) return null;

    // 处理堆叠
    let processedSeries: Series[];
    if (stacked) {
      processedSeries = [];
      const cumulative = new Array(labels.length).fill(0);
      for (const s of series) {
        const newData = s.data.map((v, i) => cumulative[i] + v);
        processedSeries.push({ ...s, data: newData });
        for (let i = 0; i < cumulative.length; i++) cumulative[i] = newData[i];
      }
    } else {
      processedSeries = series;
    }

    const allValues = processedSeries.flatMap((s) => s.data);
    const max = Math.max(...allValues, 1);
    const min = stacked ? 0 : Math.min(...allValues, 0);
    const range = max - min || 1;
    return { processedSeries, max, min, range };
  }, [series, labels, stacked]);

  if (!computed) return null;

  const { processedSeries, min, range } = computed;
  const stepX = labels.length > 1 ? 100 / (labels.length - 1) : 100;

  // 倒序绘制堆叠序列以便顶层可见
  const drawSeries = stacked ? [...processedSeries].reverse() : processedSeries;

  return (
    <div className={cn("relative w-full", className)}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        className="overflow-visible"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const ratio = x / rect.width;
          const idx = Math.round(ratio * (labels.length - 1));
          setHoverIndex(Math.max(0, Math.min(labels.length - 1, idx)));
        }}
      >
        <defs>
          {drawSeries.map((s, i) => (
            <linearGradient key={i} id={`area-grad-${i}-${s.label}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>

        {/* 背景网格 */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={0}
            x2={100}
            y1={height * t}
            y2={height * t}
            stroke="color-mix(in srgb, var(--color-foreground) 8%, transparent)"
            strokeWidth={0.5}
            strokeDasharray="1.5 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {drawSeries.map((s, i) => {
          const points = s.data.map((v, idx) => {
            const x = idx * stepX;
            const y = height - ((v - min) / range) * height;
            return [x, y] as const;
          });

          const linePath = points
            .map(([x, y], idx) => `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
            .join(" ");
          const areaPath = `${linePath} L 100 ${height} L 0 ${height} Z`;

          return (
            <g key={s.label}>
              {gradient && (
                <path d={areaPath} fill={`url(#area-grad-${i}-${s.label})`} />
              )}
              <path
                d={linePath}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {/* 悬停指示线 */}
        {hoverIndex !== null && (
          <line
            x1={hoverIndex * stepX}
            x2={hoverIndex * stepX}
            y1={0}
            y2={height}
            stroke="var(--color-primary)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            opacity={0.5}
          />
        )}
      </svg>

      {/* X 轴 */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{formatXAxis(labels[0] ?? "", 0)}</span>
        {labels.length > 2 && (
          <span>{formatXAxis(labels[Math.floor(labels.length / 2)] ?? "", Math.floor(labels.length / 2))}</span>
        )}
        <span>{formatXAxis(labels[labels.length - 1] ?? "", labels.length - 1)}</span>
      </div>

      {/* 工具提示 */}
      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 border border-border bg-card/95 px-2.5 py-1.5 text-[10px] shadow-lg backdrop-blur-sm"
          style={{ left: `${(hoverIndex / Math.max(labels.length - 1, 1)) * 100}%` }}
        >
          <div className="font-medium text-foreground">{formatXAxis(labels[hoverIndex], hoverIndex)}</div>
          {series.map((s) => (
            <div key={s.label} className="mt-0.5 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2" style={{ background: s.color }} />
              <span className="text-muted-foreground">{s.label}:</span>
              <span className="text-foreground">{formatTooltipValue(s.data[hoverIndex] ?? 0, s.label)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
