import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../../components/Brand";
import { colors as c } from "../../theme";
import { ErrorText, Loading, SecondaryButton } from "../../ui";
import { useWorkouts } from "../../workouts/context";
import { ExerciseFigure } from "../../workouts/ExerciseFigure";
import { dateLabel, s, statsFor, WorkoutHeader } from "../../workouts/ui";

export default function WorkoutsScreen() {
  const { store, ready, catalogue, draft, records, error, syncing, next_offset } = useWorkouts();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<"catalogue" | "history">(params.view === "history" ? "history" : "catalogue");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => { if (params.view === "history") setView("history"); }, [params.view]);
  useFocusEffect(useCallback(() => { void store.refresh(); }, [store]));
  if (!ready) return <Loading />;
  const total = records.filter(r => statsFor(r).status === "completed");
  return <SafeAreaView edges={["top"]} style={s.page}>
    <WorkoutHeader title="Тренировки" back={false} right={<Pressable accessibilityRole="button" accessibilityLabel="Настройки тренировок" style={s.iconButton} onPress={() => router.push("/workout/settings")}><Icon name="settings" color={c.accentDark} /></Pressable>} />
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void store.refresh()} tintColor={c.accent} />}>
      {draft ? <Pressable accessibilityRole="button" onPress={() => router.push("/workout/player")} style={s.notice}><View style={s.row}><Icon name="play" color={c.accentDark} /><View style={{ flex: 1 }}><Text style={s.title}>Продолжить занятие</Text><Text style={s.muted}>{draft.workout.title} · упражнение {draft.index + 1} из {draft.workout.steps.length}</Text></View><Icon name="chevron" color={c.accentDark} /></View></Pressable> : null}
      <View style={local.tabs}>{(["catalogue", "history"] as const).map(key => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: view === key }} onPress={() => setView(key)} style={[local.tab, view === key && local.selected]}><Text style={[local.tabText, view === key && { color: c.accentDark }]}>{key === "catalogue" ? "Занятия" : "Моя история"}</Text></Pressable>)}</View>
      {error ? <View style={s.notice}><Text style={s.muted}>{catalogue ? "Сохранённые занятия доступны. Синхронизацию можно повторить." : "Для первой загрузки каталога нужен интернет."}</Text><ErrorText message={error} /><Pressable accessibilityRole="button" style={{ paddingVertical: 6 }} onPress={() => void store.retry().catch(e => setLocalError(e.message))}><Text style={s.link}>Повторить</Text></Pressable></View> : null}
      <ErrorText message={localError} />
      {view === "catalogue" ? <>
        {catalogue ? <View style={local.hero}>
          <View style={{ flex: 1, gap: 10 }}><Text style={local.eyebrow}>В СВОЁМ ТЕМПЕ</Text><Text style={local.heroTitle}>Движение —{`\n`}тоже забота</Text><Text style={s.muted}>Короткие занятия дома.{`\n`}Начните с пяти минут.</Text></View>
          <ExerciseFigure exercise={catalogue.exercises.find(e => e.id === "arm_raise")!} size={120} />
        </View> : null}
        <View style={s.row}><Text style={[s.title, { flex: 1 }]}>Выберите занятие</Text><View style={s.chip}><Text style={s.chipText}>Все доступны</Text></View></View>
        {catalogue?.workouts.map(workout => <Pressable key={workout.id} accessibilityRole="button" accessibilityLabel={`${workout.title}, около ${Math.round(workout.duration_seconds / 60)} минут`} onPress={() => router.push({ pathname: "/workout/[id]", params: { id: workout.id } })} style={({ pressed }) => [s.card, local.workoutCard, pressed && { opacity: .75 }]}>
          <View style={local.thumb}><ExerciseFigure exercise={catalogue.exercises.find(e => e.id === workout.preview_exercise_id)!} size={76} /></View>
          <View style={{ flex: 1, gap: 7 }}><Text style={s.title}>{workout.title}</Text><Text style={s.small}>{workout.subtitle}</Text><Text style={s.link}>{Math.round(workout.duration_seconds / 60)} мин · {workout.steps.length} упражнений</Text></View><Icon name="chevron" size={16} color={c.muted} />
        </Pressable>)}
        <Text style={s.small}>Без спортивного инвентаря. Для некоторых движений нужна свободная стена. Выбирайте удобный темп и амплитуду.</Text>
      </> : <>
        <View style={s.notice}><Text style={s.title}>{total.length ? `Завершено занятий: ${total.length}` : "Первое занятие впереди"}</Text><Text style={s.muted}>{total.length ? `${Math.round(total.reduce((sum, r) => sum + statsFor(r).seconds, 0) / 60)} минут движения в загруженной истории` : "Здесь появятся ваши занятия и результаты."}</Text></View>
        {records.map(record => { const stats = statsFor(record); return <Pressable key={record.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/workout/result/[id]", params: { id: record.id } })} style={s.card}>
          <View style={s.row}><View style={[s.iconButton, { backgroundColor: c.soft }]}><Icon name={stats.status === "completed" ? "check" : "pause"} color={c.accentDark} /></View><View style={{ flex: 1, gap: 4 }}><Text style={s.title}>{record.title}</Text><Text style={s.small}>{dateLabel(stats.date)} · {Math.round(stats.seconds / 60)} мин движения</Text></View><Icon name="chevron" size={16} color={c.muted} /></View>
          <Text style={s.small}>{record.error ? "Требуется внимание — откройте результат" : !record.server ? "Сохранено на устройстве · ожидает отправки" : stats.status === "completed" ? "Завершено" : "Завершено досрочно"}</Text>
        </Pressable>; })}
        {next_offset != null ? <SecondaryButton label="Загрузить ещё" onPress={() => void store.loadMore().catch(e => setLocalError(e.message))} /> : null}
        {!records.length ? <SecondaryButton label="Выбрать занятие" onPress={() => setView("catalogue")} /> : null}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
const local = StyleSheet.create({
  tabs: { flexDirection: "row", padding: 4, borderRadius: 18, backgroundColor: "#e9eee3", gap: 4 },
  tab: { flex: 1, padding: 12, alignItems: "center", borderRadius: 14 },
  selected: { backgroundColor: c.surface }, tabText: { color: c.muted, fontWeight: "600", fontSize: 14 },
  hero: { backgroundColor: "#e7f0dc", borderRadius: 26, padding: 20, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  eyebrow: { fontSize: 10, letterSpacing: 1.3, color: c.accentDark, fontWeight: "700" },
  heroTitle: { fontSize: 25, lineHeight: 31, fontWeight: "700", color: c.text },
  workoutCard: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  thumb: { width: 82, height: 96, alignItems: "center", justifyContent: "center", backgroundColor: "#eff4e9", borderRadius: 18 },
});
