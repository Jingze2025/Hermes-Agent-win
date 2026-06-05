import { cn } from "@/lib/utils";

interface GaugeProps {
  /** 0-1 之间的值 */
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  /** 弧形颜色，默认使用 primary */
  color?: string;
  /** 轨道颜色，默认柔和的边框色 */
  trackColor?: string;
}

/**
 * 圆环式仪表盘组件。3/4 圆环，从左下到右下绘制。
 * 用于显示百分比类指标（健康度、命中率等）。
 */
export function Gauge({
  value,
  size = 120,
  strokeWidth = 8,
  label,
  sub,
  className,
  color = "var(--color-primary)",
  trackColor = "color-mix(in srgb, var(--color-foreground) 10%, transparent)",
}: GaugeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2;
  // 270 度弧线（3/4 圆）
  const arcLen = 2 * Math.PI * r * 0.75;
  const dashOffset = arcLen * (1 - clamped);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[135deg]">
        {/* 轨道 */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLen} ${2 * Math.PI * r}`}
          strokeLinecap="round"
        />
        {/* 进度弧 */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLen} ${2 * Math.PI * r}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label && (
          <div className="font-display text-2xl font-bold leading-tight blend-lighter">{label}</div>
        )}
        {sub && (
          <div className="mt-0.5 font-compressed text-[0.6rem] tracking-[0.18em] uppercase text-muted-foreground">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
