import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
  showDots?: boolean;
}

/**
 * 简洁的迷你折线图，用于在卡片中展示趋势。
 * 完全基于 SVG，无外部依赖。
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = "currentColor",
  fill,
  className,
  showDots = false,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length === 0) return { line: "", area: "" };

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;

    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return [x, y] as const;
    });

    const line = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");
    const area = `${line} L ${width} ${height} L 0 ${height} Z`;

    return { line, area, points };
  }, [data, width, height]);

  if (!data.length) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
    >
      {fill && <path d={path.area} fill={fill} />}
      <path d={path.line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {showDots &&
        path.points?.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={1.5} fill={stroke} />
        ))}
    </svg>
  );
}
