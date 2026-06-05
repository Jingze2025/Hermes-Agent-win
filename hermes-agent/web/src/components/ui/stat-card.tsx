import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: { value: number; positive?: boolean };
  accent?: "primary" | "success" | "warning" | "destructive" | "muted";
  className?: string;
  /** 渐变光晕色，用于强调卡片视觉重点 */
  glowColor?: string;
}

const ACCENT_MAP: Record<NonNullable<StatCardProps["accent"]>, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

/**
 * 现代仪表盘统计卡片：
 * - 顶部图标 + 标签
 * - 大字号数值
 * - 可选趋势 / 副文本
 * - 角落柔和光晕呼应 Solar Dusk 黄昏氛围
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  accent = "muted",
  className,
  glowColor,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden border border-border bg-card/70 p-4 transition-colors hover:bg-card/90",
        "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/40 before:to-transparent",
        className,
      )}
    >
      {glowColor && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-40 blur-2xl"
          style={{ background: glowColor }}
        />
      )}

      <div className="relative flex items-center justify-between gap-2">
        <span className="font-compressed text-[0.7rem] tracking-[0.2em] uppercase text-muted-foreground">
          {label}
        </span>
        <Icon className={cn("h-4 w-4", ACCENT_MAP[accent])} />
      </div>

      <div className="relative mt-3 flex items-end gap-2">
        <div className="font-display text-2xl font-bold leading-none truncate" title={typeof value === "string" ? value : undefined}>
          {value}
        </div>
        {trend && (
          <span
            className={cn(
              "font-compressed text-[0.65rem] tracking-[0.1em] uppercase pb-0.5",
              trend.positive ? "text-success" : "text-destructive",
            )}
          >
            {trend.positive ? "▲" : "▼"} {Math.abs(trend.value).toFixed(1)}%
          </span>
        )}
      </div>

      {sub && (
        <div className="relative mt-1.5 text-xs text-muted-foreground truncate">{sub}</div>
      )}
    </div>
  );
}
