import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../../../components/Brand";
import { colors as c } from "../../../theme";
import { ErrorText, Loading, PrimaryButton, SecondaryButton } from "../../../ui";
import { useWorkouts } from "../../../workouts/context";
import { clock } from "../../../workouts/engine";
import { dateLabel, s, statsFor, WorkoutHeader } from "../../../workouts/ui";

export default function WorkoutResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, ready, records, syncing, catalogue, error: syncError, storage_error } = useWorkouts();
  const record = records.find(r => r.id === id);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  async function add() { setBusy(true); setError(null); try { await store.addToDiary(id); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось добавить в дневник"); } finally { setBusy(false); } }
  const stats = record ? statsFor(record) : null;
  const needsWeight = record?.server?.needs_weight;
  const added = record?.server?.diary_added;
  const steps = record?.server?.steps ?? record?.payload?.steps ?? [];
  const definition = catalogue?.workouts.find(w => w.id === (record?.server?.workout_id ?? record?.payload?.workout_id));
  if (!ready) return <Loading />;
  return <SafeAreaView edges={["top", "bottom"]} style={s.page}>
    <WorkoutHeader title="Результат занятия" />
    {record && stats ? <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={local.hero}><View style={local.medal}><Icon name={stats.status === "completed" ? "check" : "pause"} size={36} color={c.accentDark} /></View><Text style={local.heroTitle}>{stats.status === "completed" ? "Вы уделили себе время" : "Каждое движение считается"}</Text><Text style={[s.muted, { textAlign: "center" }]}>{record.title} · {dateLabel(stats.date)}</Text><Text style={s.small}>{stats.status === "completed" ? "Занятие завершено" : "Завершено досрочно"}</Text></View>
      <View style={local.metrics}><View style={local.metric}><Text style={local.value}>{clock(stats.seconds)}</Text><Text style={s.small}>Движение</Text></View><View style={local.metric}><Text style={local.value}>{stats.completed}</Text><Text style={s.small}>Упражнений</Text></View><View style={local.metric}><Text style={local.value}>{record.server?.calories != null ? `≈${Math.round(record.server.calories)}` : "—"}</Text><Text style={s.small}>Активных ккал</Text></View></View>
      <Text style={s.small}>Время отдыха: {clock(stats.rest)}. Паузы и отдых не входят в расход калорий. Значение приблизительное.</Text>
      <View style={s.notice}><View style={s.row}><Icon name={record.server ? "check" : "clock"} color={c.accentDark} /><Text style={[s.body, { flex: 1 }]}>{record.server ? "Результат сохранён в аккаунте" : storage_error ? "Результат ещё не сохранён" : "Результат сохранён на устройстве"}</Text></View>{!record.server ? <Text style={s.muted}>{storage_error ? "Освободите место и повторите сохранение перед закрытием приложения." : syncing ? "Отправляем результат…" : "Отправим при подключении к интернету. Можно закрыть этот экран."}</Text> : null}</View>
      {record.error || error || syncError ? <View style={{ gap: 10 }}><ErrorText message={error ?? record.error ?? syncError ?? null} /><SecondaryButton label="Повторить синхронизацию" onPress={() => void store.retry().catch(e => setError(e.message))} /></View> : null}
      {stats.status === "completed" ? <View style={s.card}>
        <Text style={s.title}>Дневник питания</Text>
        {added ? <><Text style={s.muted}>{record.server?.diary_entry_id ? "Активность добавлена в общий дневник. Расход учтён в остатке калорий." : "Запись была удалена из дневника. Тренировка остаётся в истории."}</Text>{record.server?.diary_entry_id ? <SecondaryButton label="Открыть запись" onPress={() => router.push({ pathname: "/entry/[id]", params: { id: String(record.server!.diary_entry_id) } })} /> : null}</> : <>
          <Text style={s.muted}>{needsWeight ? "Для расчёта расхода укажите вес в профиле, затем вернитесь и добавьте занятие в дневник." : record.payload?.auto_log && !record.server ? "После синхронизации занятие автоматически добавится в дневник, если в профиле указан вес." : "Добавьте активность, чтобы учесть приблизительный расход в дневном остатке калорий."}</Text>
          {needsWeight ? <SecondaryButton label="Указать вес" onPress={() => router.push("/weight")} /> : null}
          <PrimaryButton disabled={busy || !!record.diary_requested} label={record.diary_requested ? "Ожидает добавления…" : busy ? "Добавляем…" : "Добавить в дневник"} onPress={() => void add()} />
        </>}
      </View> : <Text style={s.muted}>Досрочно завершённое занятие сохраняется в истории и не переносится в дневник.</Text>}
      <View style={s.card}><Text style={s.title}>Как прошло занятие</Text>{steps.map((step, index) => {
        const exerciseId = "exercise_id" in step ? step.exercise_id : definition?.steps.find(s => s.id === step.step_id)?.exercise_id;
        const title = "exercise_title" in step ? String(step.exercise_title) : catalogue?.exercises.find(e => e.id === exerciseId)?.title;
        return <View key={step.step_id} style={s.row}><Icon name={step.completed ? "check" : "pause"} size={18} color={step.completed ? c.accentDark : c.muted} /><View style={{ flex: 1, gap: 3 }}><Text style={s.body}>{title ?? `Упражнение ${index + 1}`}</Text><Text style={s.small}>{step.completed ? "Выполнено" : step.active_seconds > 0 ? "Выполнено частично" : "Пропущено"} · {clock(step.active_seconds)}</Text></View></View>;
      })}</View>
      <PrimaryButton label="К тренировкам" onPress={() => router.replace("/(tabs)/workouts")} />
      <Pressable accessibilityRole="button" style={{ padding: 12, alignItems: "center" }} onPress={() => router.replace({ pathname: "/(tabs)/workouts", params: { view: "history" } })}><Text style={s.link}>Моя история занятий</Text></Pressable>
    </ScrollView> : <View style={s.content}><Text style={s.muted}>Результат не найден в этом аккаунте.</Text><SecondaryButton label="К тренировкам" onPress={() => router.replace("/(tabs)/workouts")} /></View>}
  </SafeAreaView>;
}
const local = StyleSheet.create({
  hero: { alignItems: "center", gap: 12, paddingVertical: 16 },
  medal: { height: 86, width: 86, borderRadius: 43, backgroundColor: "#e0eecb", alignItems: "center", justifyContent: "center", borderWidth: 6, borderColor: "#edf5e2" },
  heroTitle: { color: c.text, fontSize: 27, lineHeight: 33, textAlign: "center", fontWeight: "700" },
  metrics: { flexDirection: "row", backgroundColor: c.surface, borderRadius: 22, paddingVertical: 22, borderColor: c.border, borderWidth: 1 },
  metric: { flex: 1, alignItems: "center", gap: 6 }, value: { color: c.text, fontSize: 25, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
