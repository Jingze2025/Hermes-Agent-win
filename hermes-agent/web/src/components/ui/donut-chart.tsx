import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** 中心区域内容 */
  centerLabel?: React.ReactNode;
  centerValue?: React.ReactNode;
}

/**
 * 环形图组件，用于展示模型/平台/类别比例。
 * 自动按 segments 数组生成圆环段，无外部依赖。
 */
export function DonutChart({
  segments,
  size = 160,
  strokeWidth = 18,
  className,
  centerLabel,
  centerValue,
}: DonutChartProps) {
  const { ringSegments, total } = useMemo(() => {
    const tot = segments.reduce((s, x) => s + x.value, 0);
    if (tot <= 0) return { ringSegments: [], total: 0 };

    const r = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    const out = segments.map((seg) => {
      const ratio = seg.value / tot;
      const len = ratio * circumference;
      const dasharray = `${len} ${circumference - len}`;
      const result = { ...seg, dasharray, dashoffset: -offset, ratio, r, circumference };
      offset += len;
      return result;
    });
    return { ringSegments: out, total: tot };
  }, [segments, size, strokeWidth]);

  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {ringSegments.map((seg, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={seg.r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={seg.dasharray}
            strokeDashoffset={seg.dashoffset}
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
        ))}
        {/* 空状态轨道 */}
        {total === 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={(size - strokeWidth) / 2}
            fill="none"
            stroke="color-mix(in srgb, var(--color-foreground) 8%, transparent)"
            strokeWidth={strokeWidth}
          />
        )}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && (
            <div className="font-display text-xl font-bold leading-tight blend-lighter">{centerValue}</div>
          )}
          {centerLabel && (
            <div className="mt-0.5 font-compressed text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">
              {centerLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
