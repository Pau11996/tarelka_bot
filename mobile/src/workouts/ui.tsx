import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "../components/Brand";
import { colors as c } from "../theme";
import { ExerciseFigure } from "./ExerciseFigure";
import { sessionDate } from "./engine";
import type { Exercise, LocalWorkout } from "./types";

export function WorkoutHeader({ title, back = true, right }: { title: string; back?: boolean; right?: React.ReactNode }) {
  return <View style={s.header}>{back ? <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/workouts")} style={s.iconButton}><Icon name="left" /></Pressable> : null}<Text accessibilityRole="header" style={s.heading}>{title}</Text>{right}</View>;
}
export function ExerciseInfo({ exercise, onClose }: { exercise: Exercise | null; onClose(): void }) {
  return <Modal visible={!!exercise} transparent animationType="fade" onRequestClose={onClose}>
    <View style={s.overlay}><View style={s.sheet}>{exercise ? <ScrollView contentContainerStyle={{ gap: 16, padding: 24 }}>
      <View style={s.row}><Text accessibilityRole="header" style={[s.heading, { flex: 1 }]}>{exercise.title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Закрыть описание" style={s.iconButton} onPress={onClose}><Icon name="close" /></Pressable></View>
      <View style={s.figure}><ExerciseFigure exercise={exercise} playing size={220} /></View>
      <Text style={s.body}>{exercise.instruction}</Text>
      {exercise.equipment.length ? <Text style={s.muted}>{exercise.equipment.join(" · ")}</Text> : null}
      <Text style={s.small}>Двигайтесь в удобной амплитуде. Если появляется боль, остановите упражнение.</Text>
    </ScrollView> : null}</View></View>
  </Modal>;
}
export function statsFor(record: LocalWorkout) {
  const steps = record.server?.steps ?? record.payload?.steps ?? [];
  return {
    seconds: record.server?.active_seconds ?? steps.reduce((sum, s) => sum + s.active_seconds, 0),
    rest: record.server?.rest_seconds ?? steps.reduce((sum, s) => sum + s.rest_seconds, 0),
    completed: record.server?.completed_steps ?? steps.filter(s => s.completed).length,
    status: record.server?.status ?? record.payload?.status ?? "interrupted",
    date: record.server?.local_date ?? (record.payload ? sessionDate(record.payload.started_at, record.payload.timezone) : ""),
  };
}
export function dateLabel(value: string) {
  if (!value) return "";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  heading: { color: c.text, fontSize: 23, fontWeight: "700", flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 18 },
  iconButton: { padding: 10, borderRadius: 14, backgroundColor: c.surface, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  card: { backgroundColor: c.surface, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: c.border, gap: 12 },
  title: { color: c.text, fontSize: 18, fontWeight: "700" },
  body: { color: c.text, fontSize: 16, lineHeight: 24 },
  muted: { color: c.muted, fontSize: 14, lineHeight: 21 },
  small: { color: c.muted, fontSize: 12, lineHeight: 18 },
  link: { color: c.accentDark, fontSize: 14, fontWeight: "600" },
  chip: { borderRadius: 12, backgroundColor: c.soft, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" },
  chipText: { fontSize: 12, fontWeight: "600", color: c.accentDark },
  figure: { alignItems: "center", justifyContent: "center", backgroundColor: "#edf3e6", borderRadius: 24, paddingVertical: 10 },
  notice: { backgroundColor: c.soft, padding: 16, borderRadius: 18, gap: 8 },
  overlay: { flex: 1, backgroundColor: "#182c2377", alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: c.bg, borderRadius: 28, maxHeight: "85%", width: "100%", maxWidth: 480, overflow: "hidden" },
});
