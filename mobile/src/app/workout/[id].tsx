import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../../components/Brand";
import { colors } from "../../theme";
import { ErrorText, Loading, PrimaryButton, SecondaryButton } from "../../ui";
import { useWorkouts } from "../../workouts/context";
import { ExerciseFigure } from "../../workouts/ExerciseFigure";
import { ExerciseInfo, s, WorkoutHeader } from "../../workouts/ui";
import type { Exercise } from "../../workouts/types";

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, ready, catalogue, draft } = useWorkouts();
  const [info, setInfo] = useState<Exercise | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const focused = useIsFocused();
  const workout = catalogue?.workouts.find(w => w.id === id);
  async function start() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await store.start(id); router.push("/workout/player"); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось начать занятие"); } finally { setBusy(false); }
  }
  if (!ready) return <Loading />;
  return <SafeAreaView edges={["top", "bottom"]} style={s.page}>
    <WorkoutHeader title="Занятие" />
    {workout && catalogue ? <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.figure}><ExerciseFigure exercise={catalogue.exercises.find(e => e.id === workout.preview_exercise_id)!} playing={focused && !info} size={210} /></View>
      <View style={{ gap: 10 }}><View style={s.chip}><Text style={s.chipText}>{workout.focus} · {workout.level}</Text></View><Text accessibilityRole="header" style={[s.heading, { flex: undefined, fontSize: 28 }]}>{workout.title}</Text><Text style={s.muted}>{workout.subtitle}</Text></View>
      <View style={s.row}><Icon name="clock" color={colors.accent} /><Text style={s.body}>Около {Math.round(workout.duration_seconds / 60)} минут · {workout.steps.length} упражнений</Text></View>
      <View style={s.notice}><Text style={s.muted}>{workout.space}.</Text><Text style={s.muted}>{workout.equipment.length ? workout.equipment.join(". ") : "Дополнительные предметы не нужны"}.</Text></View>
      <ErrorText message={error} />
      {draft ? <View style={{ gap: 10 }}><Text style={s.muted}>У вас уже есть незавершённое занятие: {draft.workout.title}.</Text><PrimaryButton label="Продолжить занятие" onPress={() => router.push("/workout/player")} /></View> : <PrimaryButton label={busy ? "Подготовка…" : "Начать занятие"} disabled={busy} onPress={() => void start()} />}
      <Text style={s.small}>Выполняйте движения без боли. В любой момент можно сделать паузу или пропустить упражнение.</Text>
      <Text style={s.title}>Что будем делать</Text>
      {workout.steps.map((step, i) => { const exercise = catalogue.exercises.find(e => e.id === step.exercise_id)!; return <Pressable key={step.id} accessibilityRole="button" accessibilityLabel={`Техника: ${exercise.title}`} onPress={() => setInfo(exercise)} style={[s.card, s.row, { padding: 14 }]}>
        <Text style={[s.small, { width: 20 }]}>{String(i + 1).padStart(2, "0")}</Text><ExerciseFigure exercise={exercise} size={44} /><View style={{ flex: 1, gap: 4 }}><Text style={[s.title, { fontSize: 15 }]}>{exercise.title}</Text><Text style={s.small}>{step.repetitions ? `${step.repetitions} повторов` : `${step.duration_seconds} секунд`}{step.rest_seconds ? ` · отдых ${step.rest_seconds} с` : ""}</Text></View><Icon name="chevron" size={15} color={colors.muted} />
      </Pressable>; })}
    </ScrollView> : <View style={s.content}><Text style={s.muted}>Занятие недоступно. Обновите каталог тренировок.</Text><SecondaryButton label="К каталогу" onPress={() => router.replace("/(tabs)/workouts")} /></View>}
    <ExerciseInfo exercise={info} onClose={() => setInfo(null)} />
  </SafeAreaView>;
}
