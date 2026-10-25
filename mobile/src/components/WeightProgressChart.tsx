import { useId, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as Label } from "react-native-svg";
import { achievementColors as c } from "../theme";
import { weightNumber } from "../weightTracking";
import { closestWeightPoint, weightChartGeometry } from "../weightChart";
import type { WeightMeasurement } from "../types";

function dayLabel(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "");
}

export function WeightProgressChart({ history, target }: { history: WeightMeasurement[]; target?: number }) {
  const [width, setWidth] = useState(346);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gradient = `weight-fill-${useId().replace(/:/g, "")}`;
  const chart = weightChartGeometry(history, width, target);
  const chosen = chart.coordinates.find(point => point.row.id === selectedId);
  const latest = chart.coordinates.at(-1);
  if (!latest) return <View style={s.empty}><Text style={s.hint}>Запишите вес — здесь появится линия изменений.</Text></View>;
  const dates = [0, Math.floor((chart.coordinates.length - 1) / 2), chart.coordinates.length - 1]
    .filter((v, i, all) => all.indexOf(v) === i)
    .filter((v, i, all) => all.findIndex(index => chart.coordinates[index].row.local_date === chart.coordinates[v].row.local_date) === i);
  const targetText = `Цель ${weightNumber(target)} кг`;
  const targetWidth = Math.min(125, targetText.length * 6 + 16);
  const targetLabelY = chart.targetY === null ? 0 : Math.max(2, Math.min(chart.bottom - 18,
    Math.abs(chart.targetY - latest.y) < 24 ? chart.targetY - 34 : chart.targetY - 11));
  return <View onLayout={event => { if (event.nativeEvent.layout.width > 0) setWidth(event.nativeEvent.layout.width); }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`График веса. Последнее измерение ${weightNumber(latest.row.weight_kg)} кг. Все записи доступны в истории.`} accessibilityHint="Нажмите на точку, чтобы посмотреть измерение" onPress={event => {
      const x = Number.isFinite(event.nativeEvent.locationX) ? event.nativeEvent.locationX : latest.x;
      const point = chart.coordinates[closestWeightPoint(chart.coordinates, x)];
      if (point) setSelectedId(point.row.id === selectedId ? null : point.row.id);
    }}>
      <Svg width="100%" height={chart.height} viewBox={`0 0 ${width} ${chart.height}`} pointerEvents="none" accessible={false}>
        <Defs><LinearGradient id={gradient} x1="0%" y1="0%" x2="0%" y2="100%"><Stop offset="0" stopColor={c.chartFill} stopOpacity={0.8} /><Stop offset="1" stopColor={c.background} stopOpacity={0} /></LinearGradient></Defs>
        {chart.grid.map((y, index) => <Line key={index} x1={chart.left} x2={chart.right} y1={y} y2={y} stroke={c.line} strokeWidth={0.8} />)}
        {chart.area ? <Path d={chart.area} fill={`url(#${gradient})`} /> : null}
        {chart.targetY !== null ? <Line x1={chart.left} x2={chart.right} y1={chart.targetY} y2={chart.targetY} stroke={c.purple} strokeDasharray="4 5" /> : null}
        <Path d={chart.line} stroke={c.green} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {chosen ? <><Line x1={chosen.x} x2={chosen.x} y1={chart.top} y2={chart.bottom} stroke={c.line} /><Circle cx={chosen.x} cy={chosen.y} r={5} fill={c.green} stroke={c.white} strokeWidth={2} /></> : null}
        <Circle cx={latest.x} cy={latest.y} r={4.5} fill={c.green} stroke={c.background} strokeWidth={2} />
        {chart.targetY !== null ? <G><Rect x={width - targetWidth - 4} y={targetLabelY} width={targetWidth} height={23} rx={8} fill={c.lilac} /><Label x={width - targetWidth / 2 - 4} y={targetLabelY + 15} textAnchor="middle" fontSize={10} fill={c.purple}>{targetText}</Label></G> : null}
        {dates.map((index, slot) => {
          const point = chart.coordinates[index];
          return <Label key={point.row.id} x={dates.length === 1 ? width / 2 : slot === 0 ? chart.left : slot === dates.length - 1 ? chart.right : point.x} y={180} textAnchor={dates.length === 1 ? "middle" : slot === 0 ? "start" : slot === dates.length - 1 ? "end" : "middle"} fontSize={10} fill={c.muted}>{dayLabel(point.row.local_date)}</Label>;
        })}
      </Svg>
    </Pressable>
    {chosen ? <Text accessibilityLiveRegion="polite" style={s.selection}>{dayLabel(chosen.row.local_date)} · {weightNumber(chosen.row.weight_kg)} кг · {chosen.row.source === "health_connect" ? "Health Connect" : "Записано вручную"}</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 20 },
  hint: { fontSize: 12, lineHeight: 19, color: c.muted, textAlign: "center" },
  selection: { color: c.dark, fontSize: 11, lineHeight: 18, paddingTop: 4 },
});
