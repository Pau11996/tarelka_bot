import { memo, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { AccountMenu } from "../../components/AccountMenu";
import { DiaryCalendar, DiaryChronicle, DiaryEnergy, DiaryNutrients, StreakBadge } from "../../components/DiaryDay";
import { DiaryDetails } from "../../components/DiaryDetails";
import { DailyNormShare } from "../../components/DailyNormShare";
import { DiaryStatistics, type DiaryStatisticsHandle } from "../../components/DiaryStatistics";
import { State } from "../../components/Screen";
import { diaryDate } from "../../diary";
import { formatDay } from "../../format";
import { useResource } from "../../hooks/useResource";
import { colors } from "../../theme";
import type { DayView } from "../../types";

type DiaryView = "today" | "stats";

const DayContent = memo(function DayContent({ day, date, error, loading, load, onDate, onToday, onFavorite }: {
  day: DayView | null; date: string | null; error: string | null; loading: boolean;
  load: () => Promise<void>; onDate: (value: string | null) => void; onToday: () => void;
  onFavorite: (id: number, favoriteId: number | null) => void;
}) {
  const selected = date ?? day?.date;
  const entryDates = day?.entry_dates ?? (day?.entries.length ? [day.date] : []);
  return <>
    {selected ? <DiaryCalendar selected={selected} entryDates={entryDates} isToday={date === null} onSelect={onDate} onToday={onToday} /> : null}
    <State loading={!day && loading} error={error} onRetry={() => void load()} />
    {day ? <>
      {date ? <Text style={s.selectedDate}>{formatDay(day.date)}</Text> : null}
      <DiaryEnergy day={day} />
      <DiaryNutrients day={day} />
      <DailyNormShare key={day.date} day={day} />
      <DiaryDetails key={day.date} day={day} />
      <DiaryChronicle entries={day.entries} onFavoriteChange={onFavorite} />
    </> : null}
  </>;
});

export default function Diary() {
  const params = useLocalSearchParams<{ date?: string; view?: string }>();
  const [date, setDate] = useState<string | null>(diaryDate(params.date));
  const [view, setView] = useState<DiaryView>(params.view === "stats" ? "stats" : "today");
  const [hasOpenedStats, setHasOpenedStats] = useState(params.view === "stats");
  const [refreshing, setRefreshing] = useState(false);
  const statistics = useRef<DiaryStatisticsHandle>(null);
  const { data: day, error, loading, load, setData } = useResource<DayView>(date ? `/v1/days/${date}` : "/v1/today");

  useEffect(() => {
    setDate(diaryDate(params.date));
    const next = params.view === "stats" ? "stats" : "today";
    setView(next);
    if (next === "stats") setHasOpenedStats(true);
  }, [params.date, params.view]);

  // Fetch the weekly report after rendering the day, before the first tab switch.
  useEffect(() => {
    if (!day || hasOpenedStats) return;
    const timer = setTimeout(() => startTransition(() => setHasOpenedStats(true)), 350);
    return () => clearTimeout(timer);
  }, [day, hasOpenedStats]);

  const selectDate = useCallback((value: string | null) => {
    setDate(value);
    setView("today");
    startTransition(() => router.setParams({ date: value ?? "", view: "today" }));
  }, []);
  const selectToday = useCallback(() => selectDate(null), [selectDate]);
  const favoriteChanged = useCallback((id: number, favoriteId: number | null) => {
    setData(current => current ? { ...current, entries: current.entries.map(entry => entry.id === id ? { ...entry, favorite_id: favoriteId } : entry) } : current);
  }, [setData]);

  function selectView(value: DiaryView) {
    if (view === value) return;
    setView(value);
    if (value === "stats") setHasOpenedStats(true);
    if (value === "today") setDate(null);
    startTransition(() => router.setParams({ view: value, ...(value === "today" ? { date: "" } : {}) }));
  }
  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([load(), view === "stats" ? statistics.current?.refresh() : Promise.resolve()]);
    } finally {
      setRefreshing(false);
    }
  }
  const refreshControl = () => <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />;

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <View style={s.header}>
        <View style={s.headingRow}>
          <Text accessibilityRole="header" style={s.title}>Дневник</Text>
          <StreakBadge value={day?.balance.streak} />
          <AccountMenu compact />
        </View>
        <View accessibilityRole="tablist" style={s.switch}>
          {([{ value: "today", label: "Сегодня" }, { value: "stats", label: "Статистика" }] as const).map(item => (
            <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{ selected: view === item.value }} onPress={() => selectView(item.value)} style={({ pressed }) => [s.switchItem, view === item.value && s.switchSelected, pressed && s.switchPressed]}>
              <Text style={[s.switchText, view === item.value && s.switchTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {/* Android RefreshControl adds a flex wrapper, so hide the entire pane. */}
      <View collapsable={false} style={view === "today" ? s.page : s.hidden} accessibilityElementsHidden={view !== "today"} importantForAccessibility={view === "today" ? "auto" : "no-hide-descendants"}>
        <ScrollView style={s.page} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={refreshControl()}>
          <DayContent day={day} date={date} error={error} loading={loading} load={load} onDate={selectDate} onToday={selectToday} onFavorite={favoriteChanged} />
        </ScrollView>
      </View>
      {hasOpenedStats ? <View collapsable={false} style={view === "stats" ? s.page : s.hidden} accessibilityElementsHidden={view !== "stats"} importantForAccessibility={view === "stats" ? "auto" : "no-hide-descendants"}>
        <ScrollView style={s.page} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={refreshControl()}>
          <DiaryStatistics ref={statistics} targets={day?.nutrient_targets} />
        </ScrollView>
      </View> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, minHeight: 0 },
  content: { padding: 16, paddingTop: 10, gap: 14, paddingBottom: 100, width: "100%", maxWidth: 680, alignSelf: "center" },
  header: { width: "100%", maxWidth: 680, alignSelf: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 14, backgroundColor: colors.bg },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, minWidth: 0, color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: "700", letterSpacing: -0.7 },
  switch: { flexDirection: "row", backgroundColor: "#eaf0e6", borderRadius: 13, padding: 3, gap: 3 },
  switchItem: { flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  switchSelected: { backgroundColor: colors.surface },
  switchPressed: { opacity: 0.65 },
  switchText: { color: colors.muted, fontSize: 13, fontWeight: "500" },
  switchTextSelected: { color: colors.accentDark, fontWeight: "600" },
  selectedDate: { color: colors.muted, fontSize: 12, marginTop: -3 },
  hidden: { display: "none" },
});
