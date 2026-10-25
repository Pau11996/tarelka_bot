import { forwardRef, memo, useImperativeHandle, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { DeviceHealthStatistics } from "./DeviceHealth";
import { sourceName } from "../health/math";
import { Chart, type ChartPoint } from "./Chart";
import { Icon } from "./Brand";
import { State } from "./Screen";
import { StarterTargetNotice } from "./StarterTargetNotice";
import { diaryProgress } from "../diary";
import { recordedAverage } from "../statistics";
import { useResource } from "../hooks/useResource";
import { formatDay } from "../format";
import { colors } from "../theme";
import type { NutrientTargets, Stats, StatsDay } from "../types";

const macros = [
  { key: "protein_g", label: "Белки", color: "#3776a2", track: "#edf4fa" },
  { key: "fat_g", label: "Жиры", color: "#946821", track: "#faf3e7" },
  { key: "carbs_g", label: "Углеводы", color: "#698a51", track: "#edf5ec" },
] as const;
const slots: Record<string, string> = { breakfast: "Завтрак", second_breakfast: "Второй завтрак", lunch: "Обед", lanch: "Ланч", snack: "Перекус", afternoon: "Полдник", dinner: "Ужин", late_dinner: "Поздний ужин", unmarked: "Без метки" };
const number = (value: number | null | undefined, precision = 0) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ru-RU", { maximumFractionDigits: precision }) : "—";
const short = (date: string) => formatDay(date).slice(0, 5);

function StatisticsCard({ title, subtitle, action, children }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return <View style={s.card}>
    {title ? <View style={s.cardHeading}><Text accessibilityRole="header" style={s.cardTitle}>{title}</Text>{action}</View> : null}
    {subtitle ? <Text style={s.hint}>{subtitle}</Text> : null}
    {children}
  </View>;
}

export type DiaryStatisticsHandle = { refresh: () => Promise<void> };
export const DiaryStatistics = memo(forwardRef<DiaryStatisticsHandle, { targets?: NutrientTargets }>(function DiaryStatistics({ targets }, ref) {
  const [period, setPeriod] = useState<7 | 30 | 90>(7);
  const [premium, setPremium] = useState<boolean | null>(null);
  const [macro, setMacro] = useState<(typeof macros)[number]["key"]>("protein_g");
  const [habit, setHabit] = useState<"water_ml" | "activity_minutes" | null>(null);
  const { data: report, error, loading, load } = useResource<Stats>(`/v1/stats?days=${period}`);
  useImperativeHandle(ref, () => ({ refresh: load }), [load]);
  const currentMacro = macros.find((item) => item.key === macro)!;
  const points = (key: keyof StatsDay): ChartPoint[] => report?.days.map((day) => ({ date: day.date, label: short(day.date), value: typeof day[key] === "number" ? day[key] as number : null })) ?? [];
  const chartKey = report ? `${report.start_date}:${report.end_date}` : "loading";
  const latestWeight = report?.weight.at(-1)?.weight_kg;
  const weightChange = report && report.weight.length > 1 ? report.weight.at(-1)!.weight_kg - report.weight[0].weight_kg : null;

  return <View style={s.content}>
    <View accessibilityRole="tablist" accessibilityLabel="Период статистики" style={s.periodControl}>
      {([{ value: 7, label: "Неделя" }, { value: 30, label: "Месяц" }, { value: 90, label: "3 месяца" }] as const).map(item => (
        <Pressable key={item.value} accessibilityRole="tab" accessibilityLabel={item.value === 90 && (report?.advanced_available ?? premium) === false ? "3 месяца — по подписке" : item.label} accessibilityState={{ selected: period === item.value, disabled: item.value === 90 && !report && premium === null }} disabled={item.value === 90 && !report && premium === null} onPress={() => {
          const available = report?.advanced_available ?? premium;
          if (item.value === 90 && available === null) return;
          if (item.value === 90 && !available) { router.push("/pay"); return; }
          setPremium(available);
          setPeriod(item.value);
        }} style={[s.periodItem, period === item.value && s.periodSelected]}>
          <Text style={[s.periodText, period === item.value && s.periodTextSelected]}>{item.label}</Text>
          {item.value === 90 && (report?.advanced_available ?? premium) === false ? <Icon name="lock" size={12} color={colors.muted} /> : null}
        </Pressable>
      ))}
    </View>
    <State loading={!report && loading} error={error} onRetry={() => void load()} />
    {report ? <>
      <StatisticsCard title="Калории" subtitle={`Пунктир — ${report.profile_complete ? "текущая цель" : "стартовый ориентир"} ${number(report.daily_calorie_target)} ккал`}>
        <Chart key={`energy:${chartKey}`} compact points={points("calories")} target={report.daily_calorie_target} unit="ккал" />
        {!report.profile_complete ? <StarterTargetNotice /> : null}
      </StatisticsCard>
      <StatisticsCard title="Динамика веса" action={<Text style={s.small}>Измерений: {report.weight.length}</Text>}>
        {report.weight.length ? <>
          <View style={s.weightSummary}><Text style={s.habitValue}>{number(latestWeight, 1)}<Text style={s.unit}> кг</Text></Text>{weightChange !== null ? <Text style={s.hint}>{weightChange > 0 ? "+" : ""}{number(weightChange, 1)} кг за период</Text> : null}</View>
          <Chart key={`weight:${chartKey}`} compact line points={report.weight.map((weight) => ({ date: weight.local_date ?? weight.recorded_at.slice(0, 10), label: short(weight.local_date ?? weight.recorded_at), value: weight.weight_kg, detail: weight.source === "health_connect" ? `Health Connect · ${sourceName(weight.origin ?? "")}` : "Записано вручную" }))} unit="кг" />
          <Text style={s.small}>Фактические измерения. Нажмите на точку, чтобы увидеть источник.</Text>
        </> : <Text style={s.hint}>В выбранном периоде нет измерений веса.</Text>}
        <Pressable accessibilityRole="button" onPress={() => router.push("/weight")} style={s.textButton}><Text style={s.link}>Записать вес →</Text></Pressable>
      </StatisticsCard>
      {report.advanced_available ? <View style={s.sectionHeading}><Text accessibilityRole="header" style={s.sectionTitle}>Питание в деталях</Text><Text style={s.small}>в среднем / день</Text></View> : null}
      {report.advanced_available ? <StatisticsCard>
        <View style={s.macroRow}>{macros.map((item) => {
          const mean = recordedAverage(report.days, item.key), target = report.targets?.[item.key] ?? targets?.[item.key];
          return <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`График: ${item.label}`} accessibilityState={{ selected: macro === item.key }} onPress={() => setMacro(item.key)} style={[s.macroItem, macro === item.key && { backgroundColor: item.track }]}>
            <View style={s.macroLabelRow}><View style={[s.legendDot, { backgroundColor: item.color }]} /><Text style={s.macroLabel}>{item.label}</Text></View>
            <Text style={[s.macroValue, { color: item.color }]}>{number(mean)} <Text style={s.macroTarget}>{target != null && target > 0 ? `/ ${number(target)} г` : "г"}</Text></Text>
            <View style={s.track}><View style={[s.fill, { width: `${diaryProgress(mean ?? 0, target ?? 0) * 100}%`, backgroundColor: item.color }]} /></View>
          </Pressable>;
        })}</View>
        <View style={s.macroChartHeading}><Text style={[s.macroChartTitle, { color: currentMacro.color }]}>{currentMacro.label} за период</Text><Text style={s.small}>Пунктир — текущая цель</Text></View>
        <Chart key={`${macro}:${chartKey}`} compact points={points(macro)} target={report.targets?.[macro] ?? targets?.[macro]} color={currentMacro.color} unit="г" />
      </StatisticsCard> : null}
      {report.advanced_available ? <>
        <Text accessibilityRole="header" style={s.sectionTitle}>Ваши привычки</Text>
        <View style={s.habits}>
          <Pressable accessibilityRole="button" accessibilityLabel="Показать динамику воды" accessibilityState={{ expanded: habit === "water_ml" }} onPress={() => setHabit(habit === "water_ml" ? null : "water_ml")} style={s.habitCard}><View style={s.habitLabel}><Icon name="drop" size={17} color="#3776a2" /><Text style={s.hint}>Вода</Text></View><Text style={s.habitValue}>{number(recordedAverage(report.days, "water_ml"))}<Text style={s.unit}> мл</Text></Text><Text style={s.small}>В день с записью воды</Text><Text style={s.habitLink}>{habit === "water_ml" ? "Скрыть график" : "Динамика воды →"}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Показать динамику движения" accessibilityState={{ expanded: habit === "activity_minutes" }} onPress={() => setHabit(habit === "activity_minutes" ? null : "activity_minutes")} style={s.habitCard}><View style={s.habitLabel}><Icon name="walk" size={17} color="#946821" /><Text style={s.hint}>Движение</Text></View><Text style={s.habitValue}>{number(report.totals?.activity_minutes ?? 0)}<Text style={s.unit}> мин</Text></Text><Text style={s.small}>{report.workouts ?? 0} записей · {number(report.totals?.activity_kcal ?? 0)} ккал</Text><Text style={s.habitLink}>{habit === "activity_minutes" ? "Скрыть график" : "Динамика движения →"}</Text></Pressable>
        </View>
        {habit ? <StatisticsCard title={habit === "water_ml" ? "Вода за период" : "Движение за период"}><Chart key={`${habit}:${chartKey}`} compact points={points(habit)} color={habit === "water_ml" ? "#5085a4" : "#ad8455"} unit={habit === "water_ml" ? "мл" : "мин"} /></StatisticsCard> : null}
      </> : null}
      <DeviceHealthStatistics health={report.health} />
      {report.advanced_available ? <StatisticsCard title="Приёмы пищи" subtitle="Количество записей с указанной меткой">
        {Object.entries(report.meal_slots ?? {}).length ? Object.entries(report.meal_slots ?? {}).map(([key, count]) => <View key={key} style={s.mealSlot}><View style={s.mealLabel}><Text style={s.hint}>{slots[key] ?? key}</Text><Text style={s.hint}>{count}</Text></View><View style={s.track}><View style={[s.fill, { width: `${count / Math.max(1, ...Object.values(report.meal_slots ?? {})) * 100}%` }]} /></View></View>) : <Text style={s.hint}>В выбранном периоде пока нет записей еды.</Text>}
      </StatisticsCard> : <StatisticsCard title="Больше деталей с подпиской" subtitle="Графики БЖУ, воды и активности."><Pressable accessibilityRole="button" onPress={() => router.push("/pay")} style={s.subscribe}><Text style={s.subscribeText}>О подписке</Text></Pressable></StatisticsCard>}
      <Text style={s.coverage}>Средние рассчитаны по дням с данными. Дни без записей не считаются нулём. Полнота дневника не подтверждена.</Text>
    </> : null}
  </View>;
}));

const s = StyleSheet.create({
  content: { gap: 13 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 14, gap: 9 },
  cardHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  small: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  unit: { fontSize: 11, color: colors.muted, fontWeight: "400", letterSpacing: 0 },
  periodControl: { flexDirection: "row", gap: 3, padding: 3, backgroundColor: "#eaf0e6", borderRadius: 12 },
  periodItem: { flex: 1, minHeight: 44, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  periodSelected: { backgroundColor: colors.surface },
  periodText: { fontSize: 12, color: colors.muted },
  periodTextSelected: { color: colors.accentDark, fontWeight: "600" },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 3 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.25 },
  macroRow: { flexDirection: "row", gap: 4 },
  macroItem: { flex: 1, minWidth: 0, paddingHorizontal: 7, paddingVertical: 10, borderRadius: 11, gap: 7 },
  macroLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  macroLabel: { color: colors.muted, fontSize: 10 },
  macroValue: { fontSize: 17, fontWeight: "600", fontVariant: ["tabular-nums"] },
  macroTarget: { color: colors.muted, fontSize: 10, fontWeight: "400" },
  track: { height: 4, backgroundColor: "#eef1e9", borderRadius: 3, overflow: "hidden" },
  fill: { height: 4, backgroundColor: colors.accent, borderRadius: 3 },
  macroChartHeading: { flexDirection: "row", flexWrap: "wrap", gap: 5, justifyContent: "space-between", alignItems: "center", marginTop: 7 },
  macroChartTitle: { fontSize: 12, fontWeight: "600" },
  legendDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accentDark },
  habits: { flexDirection: "row", gap: 10 },
  habitCard: { flex: 1, minWidth: 0, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 13, gap: 7 },
  habitLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  habitValue: { color: colors.text, fontSize: 24, fontWeight: "600", letterSpacing: -0.6, fontVariant: ["tabular-nums"] },
  habitLink: { color: colors.accentDark, fontSize: 10, paddingTop: 5 },
  weightSummary: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  textButton: { minHeight: 36, justifyContent: "center" },
  link: { color: colors.accentDark, fontSize: 12, fontWeight: "500" },
  mealSlot: { gap: 6, paddingVertical: 4 },
  mealLabel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  subscribe: { backgroundColor: colors.accentDark, padding: 12, borderRadius: 11, minHeight: 40, justifyContent: "center" },
  subscribeText: { color: "white", textAlign: "center", fontSize: 12, fontWeight: "600" },
  coverage: { color: colors.muted, fontSize: 10, lineHeight: 16, paddingHorizontal: 3 },
});
