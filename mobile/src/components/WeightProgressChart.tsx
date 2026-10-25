import { useId, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as Label } from "react-native-svg";
import { achievementColors as c } from "../theme";
import { weightNumber } from "../weightTracking";
import { closestWeightPoint, weightChartGeometry } from "../weightChart";
import type { WeightMeasurement } from "../types";

function dayLabel(date: string, year = false) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).replace(/\./g, "").replace(/\sг$/, "");
}

export function WeightProgressChart({ history, target }: { history: WeightMeasurement[]; target?: number }) {
  const [width, setWidth] = useState(300);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gradient = `weight-fill-${useId().replace(/:/g, "")}`;
  const chart = weightChartGeometry(history, width, target);
  const chosen = chart.coordinates.find(point => point.row.id === selectedId);
  const first = chart.coordinates[0], latest = chart.coordinates.at(-1);
  if (!latest) return <View style={s.empty}><Text style={s.hint}>Запишите вес — здесь появится линия изменений.</Text></View>;
  const selected = chosen ?? latest;
  const middle = chart.coordinates[Math.floor((chart.coordinates.length - 1) / 2)];
  const sameDay = first.row.local_date === latest.row.local_date;
  const showYear = first.row.local_date.slice(0, 4) !== latest.row.local_date.slice(0, 4);
  const dates = sameDay ? [{ point: latest, x: (chart.left + chart.right) / 2, anchor: "middle" as const }] : [
    { point: first, x: chart.left, anchor: "start" as const },
    ...(middle.x - chart.left > 68 && chart.right - middle.x > 68 && middle.row.local_date !== first.row.local_date && middle.row.local_date !== latest.row.local_date
      ? [{ point: middle, x: middle.x, anchor: "middle" as const }] : []),
    { point: latest, x: chart.right, anchor: "end" as const },
  ];
  return <View style={s.card}>
    <View style={s.heading}><Text accessibilityRole="header" style={s.title}>Динамика веса</Text><Text style={s.unit}>кг</Text></View>
    <View style={s.legend}>
      <View style={s.legendItem}><View style={s.legendDot} /><Text style={s.legendText}>Измерения</Text></View>
      {target !== undefined ? <View style={s.legendItem}><View style={s.legendDash} /><Text style={s.legendText}>Цель {weightNumber(target)} кг</Text></View> : null}
    </View>
    <View onLayout={event => { if (event.nativeEvent.layout.width > 0) setWidth(event.nativeEvent.layout.width); }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`График веса: ${dayLabel(first.row.local_date, true)} — ${dayLabel(latest.row.local_date, true)}. Последнее измерение ${weightNumber(latest.row.weight_kg)} кг. Все записи доступны в истории.`} accessibilityHint="Нажмите на точку, чтобы посмотреть измерение" onPress={event => {
        const x = Number.isFinite(event.nativeEvent.locationX) ? event.nativeEvent.locationX : latest.x;
        const point = chart.coordinates[closestWeightPoint(chart.coordinates, x)];
        if (point) setSelectedId(point.row.id === selectedId ? null : point.row.id);
      }}>
        <Svg width="100%" height={chart.height} viewBox={`0 0 ${width} ${chart.height}`} pointerEvents="none" accessible={false}>
          <Defs><LinearGradient id={gradient} x1="0%" y1="0%" x2="0%" y2="100%"><Stop offset="0" stopColor={c.chartFill} stopOpacity={0.85} /><Stop offset="1" stopColor={c.white} stopOpacity={0.1} /></LinearGradient></Defs>
          {chart.ticks.map((tick, index) => <Line key={`grid-${index}`} x1={chart.left} x2={chart.right} y1={tick.y} y2={tick.y} stroke={c.line} strokeDasharray="3 4" />)}
          {chart.ticks.map((tick, index) => <Label key={`scale-${index}`} x={chart.left - 8} y={tick.y + 4} textAnchor="end" fontSize={11} fill={c.muted}>{weightNumber(tick.value)}</Label>)}
          {chart.area ? <Path d={chart.area} fill={`url(#${gradient})`} /> : null}
          {chart.targetY !== null ? <Line x1={chart.left} x2={chart.right} y1={chart.targetY} y2={chart.targetY} stroke={c.purple} strokeWidth={1.5} strokeDasharray="5 5" /> : null}
          {chosen ? <Line x1={chosen.x} x2={chosen.x} y1={chart.top} y2={chart.bottom} stroke={c.green} strokeOpacity={0.35} strokeDasharray="3 4" /> : null}
          <Path d={chart.line} stroke={c.green} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {chart.coordinates.map(point => <Circle key={point.row.id} cx={point.x} cy={point.y} r={3} fill={c.white} stroke={c.green} strokeWidth={1.8} />)}
          <Circle cx={latest.x} cy={latest.y} r={5} fill={c.green} stroke={c.white} strokeWidth={2} />
          {chosen ? <Circle cx={chosen.x} cy={chosen.y} r={6} fill={c.green} stroke={c.white} strokeWidth={2} /> : null}
          {dates.map(({ point, x, anchor }) => <Label key={point.row.id} x={x} y={chart.height - 8} textAnchor={anchor} fontSize={10} fill={c.muted}>{dayLabel(point.row.local_date, showYear)}</Label>)}
        </Svg>
      </Pressable>
    </View>
    <View accessibilityLiveRegion="polite" style={s.selection}>
      <View style={s.selectionHeading}><Text style={s.selectionDate}>{dayLabel(selected.row.local_date, true)}</Text><Text style={s.selectionWeight}>{weightNumber(selected.row.weight_kg)} кг</Text></View>
      <Text style={s.selectionSource}>{selected.row.source === "health_connect" ? "Health Connect" : "Записано вручную"}{chosen ? "" : " · последнее измерение"}</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  card: { padding: 14, borderWidth: 1, borderColor: c.line, borderRadius: 18, backgroundColor: c.white, gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { color: c.text, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  unit: { color: c.muted, fontSize: 11 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.green },
  legendDash: { width: 15, height: 1, borderWidth: 1, borderColor: c.purple, borderStyle: "dashed" },
  legendText: { color: c.muted, fontSize: 10, lineHeight: 16 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 20 },
  hint: { fontSize: 12, lineHeight: 19, color: c.muted, textAlign: "center" },
  selection: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10, gap: 3 },
  selectionHeading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 },
  selectionDate: { color: c.dark, fontSize: 11, lineHeight: 18 },
  selectionWeight: { color: c.dark, fontSize: 14, lineHeight: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  selectionSource: { color: c.muted, fontSize: 10, lineHeight: 15 },
});
