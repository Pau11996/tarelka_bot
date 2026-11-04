import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorText, Loading, PrimaryButton, SecondaryButton } from "../../../ui";
import { useWorkouts } from "../../../workouts/context";
import { courseState } from "../../../workouts/course";
import { useCourseClock } from "../../../workouts/CourseOverview";
import { ExerciseFigure } from "../../../workouts/ExerciseFigure";
import { s, WorkoutHeader } from "../../../workouts/ui";

export default function CourseRecoveryDay() {
  const { day } = useLocalSearchParams<{ day: string }>(), data = useWorkouts();
  const progress = courseState(data, useCourseClock());
  const definition = data.catalogue?.course?.days.find(d => d.day === Number(day));
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  if (!data.ready) return <Loading />;
  const allowed = !!definition && ["walk", "rest"].includes(definition.kind) && progress.day === definition.day && progress.available && !data.draft;
  async function complete() {
    setBusy(true); setError(null);
    try { await data.store.completeCourseDay(Number(day)); router.replace("/(tabs)/workouts"); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить день"); }
    finally { setBusy(false); }
  }
  return <SafeAreaView edges={["top", "bottom"]} style={s.page}><WorkoutHeader title={`День ${day}`} /><ScrollView contentContainerStyle={s.content}>
    {definition ? <><Text style={[s.title, { fontSize: 26 }]}>{definition.title}</Text><Text style={s.body}>{definition.description}</Text>
      {definition.kind === "walk" ? <><Text style={s.muted}>{data.catalogue?.course?.revision === 2 ? "По желанию после прогулки — мягкое раскрытие грудной клетки на 30 секунд, без боли и рывков." : "После прогулки — по 30 секунд в каждой позе, без боли и рывков."}</Text>{(data.catalogue?.course?.revision === 2 ? ["chest"] : ["hands_behind", "quad_right", "quad_left"]).map(id => { const exercise = data.catalogue!.exercises.find(e => e.id === id)!; return <View key={id} style={s.card}><ExerciseFigure exercise={exercise} size={140} /><Text style={s.title}>{exercise.title}</Text><Text style={s.muted}>{exercise.cue}</Text></View>; })}</> : <Text style={s.muted}>{definition.day === 28 ? "Курс завершён. Отдохните и оцените, что стало даваться увереннее." : "Восстановление — часть курса. Завтра можно продолжить со следующего дня."}</Text>}
      <ErrorText message={error} />
      <PrimaryButton disabled={!allowed || busy} label={busy ? "Сохраняем…" : definition.kind === "walk" ? "Прогулка завершена" : "Отметить день отдыха"} onPress={() => void complete()} />
      {!allowed ? <Text style={s.muted}>{data.draft ? "Сначала завершите текущее занятие." : Number(day) < progress.day ? "День уже завершён." : Number(day) === progress.day ? "Этот день откроется завтра." : "Сначала пройдите предыдущие дни курса."}</Text> : null}
      <Text style={s.small}>Отметка сохраняет прогресс курса. Калории прогулки и дня отдыха автоматически не начисляются.</Text></> : <Text style={s.muted}>День курса не найден. Обновите каталог.</Text>}
    <SecondaryButton label="К курсу" onPress={() => router.replace("/(tabs)/workouts")} />
  </ScrollView></SafeAreaView>;
}
