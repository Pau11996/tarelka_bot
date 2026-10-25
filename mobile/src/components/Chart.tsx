import { chartDomain, pointPosition } from "../chartMath";
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import Svg, { Line, Rect, Path, Circle, Text as Label } from "react-native-svg";
import { colors } from "../theme";
import { design } from "./Screen";
export type ChartPoint = { label: string; value: number | null; date: string; detail?: string };
export function Chart({
  points,
  target,
  color = colors.accent,
  line = false,
  unit = "",
  onDay,
  missingLabel = "Нет записей",
  compact = false,
}: {
  points: ChartPoint[];
  target?: number;
  color?: string;
  line?: boolean;
  unit?: string;
  onDay?: (day: string) => void;
  missingLabel?: string;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null),
    [table, setTable] = useState(false),
    [layoutWidth, setLayoutWidth] = useState(320);
  const { low: floor, high: top } = chartDomain(points, target, line);
  const W = compact ? layoutWidth : 320,
    H = 160,
    L = 34,
    B = 133,
    R = W - 10;
  const y = (v: number) => B - ((v - floor) / (top - floor)) * 112;
  const x = (i: number) => L + pointPosition(points, i, line) * (R - L);
  const point = selected === null ? null : points[selected];
  const height = compact ? H : 190;
  const path = points
    .map((p, i) =>
      p.value === null
        ? ""
        : `${i === 0 || points[i - 1].value === null ? "M" : "L"} ${x(i)} ${y(p.value)}`,
    )
    .join(" ");
  return (
    <View style={{ gap: compact ? 6 : 12 }}>
      <View style={{ position: "relative" }} onLayout={compact ? (event) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0) setLayoutWidth(width);
      } : undefined}>
        <Svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={height}
          accessibilityLabel="График. Значения доступны в списке под графиком"
        >
          {[floor, (floor + top) / 2, top].map((v, i) => (
            <Line
              key={"g" + i}
              x1={L}
              x2={R}
              y1={y(v)}
              y2={y(v)}
              stroke={colors.border}
              strokeDasharray="3 4"
            />
          ))}
          {[floor, (floor + top) / 2, top].map((v, i) => (
            <Label
              key={"l" + i}
              x={L - 5}
              y={y(v) + 3}
              fontSize={11}
              textAnchor="end"
              fill={colors.muted}
            >
              {Math.round(v)}
            </Label>
          ))}
          {target !== undefined ? (
            <Line
              x1={L}
              x2={R}
              y1={y(target)}
              y2={y(target)}
              stroke={colors.muted}
              strokeDasharray="5 4"
            />
          ) : null}
          {line ? (
            <Path d={path} stroke={color} strokeWidth={2.5} fill="none" />
          ) : null}
          {points.map((p, i) =>
            p.value === null ? (
              <Circle key={i} cx={x(i)} cy={B} r={1.5} fill={colors.border} />
            ) : line ? (
              <Circle
                key={i}
                cx={x(i)}
                cy={y(p.value)}
                r={selected === i ? 5 : 2.5}
                fill={color}
              />
            ) : (
              <Rect
                key={i}
                x={x(i) - Math.max(1, (R - L) / points.length - 3) / 2}
                y={y(p.value)}
                width={Math.max(1, (R - L) / points.length - 3)}
                height={Math.max(1, B - y(p.value))}
                rx={2}
                fill={selected === i ? colors.accentDark : color}
                opacity={selected === null || selected === i ? 1 : 0.5}
              />
            ),
          )}
          {points.length
            ? [0, Math.floor((points.length - 1) / 2), points.length - 1]
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((i) => (
                  <Label
                    key={"d" + i}
                    x={x(i)}
                    y={153}
                    textAnchor="middle"
                    fontSize={11}
                    fill={colors.muted}
                  >
                    {points[i].label}
                  </Label>
                ))
            : null}
        </Svg>
        <View
          style={{
            position: "absolute",
            left: `${(L / W) * 100}%`,
            right: `${((W - R) / W) * 100}%`,
            top: 0,
            height,
          }}
          pointerEvents="box-none"
        >
          {points.map((p, i) => {
            const position = pointPosition(points, i, line);
            const left =
              i === 0 ? 0 : (pointPosition(points, i - 1, line) + position) / 2;
            const right =
              i === points.length - 1
                ? 1
                : (pointPosition(points, i + 1, line) + position) / 2;
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`${p.label}${p.detail ? ` · ${p.detail}` : ""}: ${p.value === null ? missingLabel : `${Math.round(p.value * 10) / 10} ${unit}`}`}
                onPress={() => setSelected(i)}
                style={{
                  position: "absolute",
                  left: `${left * 100}%`,
                  width: `${(right - left) * 100}%`,
                  top: 0,
                  bottom: 0,
                }}
              />
            );
          })}
        </View>
      </View>
      <View style={compact ? { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 } : undefined}>
      <Text accessibilityLiveRegion="polite" style={compact ? { color: colors.muted, fontSize: 11, flex: 1, lineHeight: 16 } : design.subtitle}>
        {point
          ? `${point.label}${point.detail ? ` · ${point.detail}` : ""} · ${point.value === null ? missingLabel : `${Math.round(point.value * 10) / 10} ${unit}`}`
          : compact ? "Выберите день на графике" : "Нажмите на график, чтобы посмотреть день"}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: table }}
        onPress={() => setTable(!table)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.accent, fontWeight: "600", fontSize: compact ? 11 : 14 }}>
          {table ? compact ? "Скрыть" : "Скрыть значения" : compact ? "Списком" : "Все значения списком"}
        </Text>
      </Pressable>
      </View>
      {point && onDay ? (
        <Pressable
          style={compact ? { minHeight: 36, justifyContent: "center", backgroundColor: colors.soft, paddingHorizontal: 12, borderRadius: 10 } : design.chip}
          onPress={() => onDay(point.date)}
          accessibilityRole="button"
        >
          <Text style={{ color: colors.accent, fontSize: compact ? 11 : 14 }}>Открыть записи дня →</Text>
        </Pressable>
      ) : null}
      {table
        ? points.map((p, i) => (
            <Pressable
              key={i}
              accessibilityRole={onDay ? "button" : undefined}
              onPress={() => {
                setSelected(i);
                onDay?.(p.date);
              }}
              style={[
                design.row,
                { justifyContent: "space-between", minHeight: 44 },
              ]}
            >
              <Text style={[design.subtitle, { flex: 1, flexShrink: 1 }]}>{p.label}{p.detail ? ` · ${p.detail}` : ""}</Text>
              <Text style={{ color: colors.text }}>
                {p.value === null
                  ? missingLabel
                  : `${Math.round(p.value * 10) / 10} ${unit}`}
              </Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}
