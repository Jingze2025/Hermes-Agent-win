import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface HeatmapProps {
  /** 按日 sessions 计数，长度任意 */
  daily: { day: string; sessions: number }[];
  /** 单元格大小 */
  cellSize?: number;
  /** 单元格间距 */
  gap?: number;
  className?: string;
  weeks?: number;
}

/**
 * GitHub 风格活跃度热力图。
 * 把每天的会话数映射到 0-4 级颜色强度。
 */
export function ActivityHeatmap({
  daily,
  cellSize = 12,
  gap = 3,
  className,
  weeks = 12,
}: HeatmapProps) {
  const grid = useMemo(() => buildGrid(daily, weeks), [daily, weeks]);

  if (grid.length === 0) return null;

  const max = Math.max(...daily.map((d) => d.sessions), 1);

  return (
    <div className={cn("flex gap-[3px]", className)} style={{ gap }}>
      {grid.map((week, wi) => (
        <div key={wi} className="flex flex-col" style={{ gap }}>
          {week.map((cell, di) => {
            if (!cell) {
              return <div key={di} style={{ width: cellSize, height: cellSize }} />;
            }
            const level = bucketize(cell.sessions, max);
            return (
              <div
                key={di}
                className="transition-colors"
                style={{
                  width: cellSize,
                  height: cellSize,
                  background: levelColor(level),
                  borderRadius: 2,
                }}
                title={`${cell.day}: ${cell.sessions} sessions`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function buildGrid(daily: { day: string; sessions: number }[], weeks: number) {
  // 取最近 weeks*7 天
  const totalDays = weeks * 7;
  const slice = daily.slice(-totalDays);
  const grid: ({ day: string; sessions: number } | null)[][] = [];
  // 用第一天的星期数填充偏移
  if (slice.length === 0) return grid;

  const first = new Date(slice[0].day + "T00:00:00");
  const offset = first.getDay(); // 0=Sun .. 6=Sat

  let cursor = 0;
  let week: ({ day: string; sessions: number } | null)[] = Array(offset).fill(null);
  for (const item of slice) {
    week.push(item);
    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
    cursor++;
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    grid.push(week);
  }
  // 限制 weeks 列
  return grid.slice(-weeks);
}

function bucketize(v: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (v === 0) return 0;
  const ratio = v / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function levelColor(level: 0 | 1 | 2 | 3 | 4): string {
  switch (level) {
    case 0:
      return "color-mix(in srgb, var(--color-foreground) 5%, transparent)";
    case 1:
      return "color-mix(in srgb, var(--color-primary) 25%, transparent)";
    case 2:
      return "color-mix(in srgb, var(--color-primary) 50%, transparent)";
    case 3:
      return "color-mix(in srgb, var(--color-primary) 75%, transparent)";
    case 4:
      return "var(--color-primary)";
  }
}
