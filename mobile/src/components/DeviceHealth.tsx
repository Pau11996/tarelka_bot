import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Chart } from "./Chart";
import { Icon } from "./Brand";
import { colors } from "../theme";
import { sourceName } from "../health/math";
import type { HealthData, HealthDay } from "../health/types";

const metrics = [
  { key: "steps", label: "Шаги", unit: "шагов", scale: 1 },
  { key: "distance_m", label: "Расстояние", unit: "км", scale: 1000 },
  { key: "active_kcal", label: "Активные ккал", unit: "ккал", scale: 1 },
  { key: "exercise_minutes", label: "Тренировки", unit: "мин", scale: 1 },
] as const;
const number = (value: number | null | undefined, scale = 1) => value == null ? "—" : (value / scale).toLocaleString("ru-RU", { maximumFractionDigits: scale === 1000 ? 1 : 0 });
function Heading({ connected }: { connected: boolean }) {
  return <View style={s.heading}><Icon name="walk" size={17} color={colors.accentDark} /><Text accessibilityRole="header" style={s.title}>С устройств</Text><Pressable accessibilityRole="button" accessibilityLabel="Устройства и здоровье" onPress={() => router.push("/health")} style={s.settings}><Text style={s.link}>{connected ? "Настроить →" : "Отключено →"}</Text></Pressable></View>;
}
export function DeviceHealthDay({ health }: { health?: HealthData | null }) {
  if (!health || (!health.connected && !health.last_synced_at)) return null;
  const day = health.days[0];
  return <View style={s.card}>
    <Heading connected={health.connected} />
    <View style={s.metrics}>{metrics.map(metric => <View key={metric.key} style={s.metric}><Text style={s.hint}>{metric.label}</Text><Text style={s.value}>{number(day?.[metric.key], metric.scale)}<Text style={s.unit}>{metric.key === "steps" ? "" : ` ${metric.unit}`}</Text></Text></View>)}</View>
    <Text style={s.hint}>Health Connect · {health.last_synced_at ? `обновлено ${new Date(health.last_synced_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "ожидаем первое обновление"}</Text>
    <Text style={s.hint}>Калории с устройств не добавляются к норме питания. Ручная активность учитывается отдельно.</Text>
    {health.workouts.map(workout => <View key={workout.id} style={s.workout}><Icon name="walk" size={16} color="#946821" /><View style={{ flex: 1, gap: 3 }}><Text style={s.workoutTitle}>{workout.title || "Тренировка"}{workout.duration_minutes != null ? ` · ${number(workout.duration_minutes)} мин` : ""}</Text><Text style={s.hint}>{sourceName(workout.origin)} · {new Date(workout.start_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: health.timezone })}</Text></View></View>)}
  </View>;
}
export function DeviceHealthStatistics({ health, onDay }: { health?: HealthData | null; onDay?: (day: string) => void }) {
  const [key, setKey] = useState<keyof Pick<HealthDay, "steps" | "distance_m" | "active_kcal" | "exercise_minutes">>("steps");
  if (!health || (!health.connected && !health.last_synced_at)) return null;
  const metric = metrics.find(m => m.key === key)!;
  const values = health.days.map(day => day[key]).filter((v): v is number => v !== null);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return <View style={s.card}>
    <Heading connected={health.connected} />
    <View style={s.tabs}>{metrics.map(m => <Pressable key={m.key} accessibilityRole="tab" accessibilityState={{ selected: key === m.key }} onPress={() => setKey(m.key)} style={[s.tab, key === m.key && s.selected]}><Text style={s.tabLabel}>{m.label}</Text></Pressable>)}</View>
    <Text style={s.value}>{number(average, metric.scale)}<Text style={s.unit}> {metric.unit} в среднем / день</Text></Text>
    <Chart key={`${key}:${health.days[0]?.date}:${health.days.at(-1)?.date}`} compact unit={metric.unit} missingLabel="Нет данных устройства" onDay={onDay} points={health.days.map(day => ({ date: day.date, label: `${Number(day.date.slice(8))}.${day.date.slice(5, 7)}`, value: day[key] === null ? null : day[key]! / metric.scale }))} />
    <Text style={s.hint}>Health Connect · дней с данными: {values.length}. Пропуски не считаются нулём. Калории устройств не меняют норму питания.</Text>
  </View>;
}
const s = StyleSheet.create({
  card: { padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 18 },
  heading: { flexDirection: "row", alignItems: "center", gap: 7 }, title: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  settings: { minHeight: 36, justifyContent: "center" }, link: { fontSize: 11, color: colors.accentDark },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 14 }, metric: { minWidth: "40%", flexGrow: 1, gap: 5 },
  value: { fontSize: 22, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] }, unit: { fontSize: 11, fontWeight: "400", color: colors.muted },
  hint: { fontSize: 10, lineHeight: 16, color: colors.muted }, workoutTitle: { fontSize: 12, fontWeight: "500", color: colors.text },
  workout: { flexDirection: "row", gap: 9, alignItems: "center", paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 4 }, tab: { minHeight: 36, paddingHorizontal: 9, borderRadius: 9, justifyContent: "center" }, selected: { backgroundColor: colors.soft }, tabLabel: { fontSize: 11, color: colors.accentDark },
});
