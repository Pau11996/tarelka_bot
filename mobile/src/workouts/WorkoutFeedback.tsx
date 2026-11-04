import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors as c } from "../theme";
import { ErrorText, SecondaryButton } from "../ui";
import { activityLevels } from "./course";
import { useWorkouts } from "./context";
import { effortSuggestion, ratedWorkout } from "./effort";
import type { LocalWorkout, WorkoutEffort } from "./types";
import { s } from "./ui";

const choices: { id: WorkoutEffort; title: string }[] = [
  { id: "easy", title: "Легко" }, { id: "comfortable", title: "В самый раз" }, { id: "hard", title: "Тяжело" },
];
export function WorkoutFeedback({ record }: { record: LocalWorkout }) {
  const data = useWorkouts();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  if (!ratedWorkout(data, record)) return null;
  const suggestion = effortSuggestion(data, record);
  async function save(work: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить оценку"); }
    finally { setBusy(false); }
  }
  return <View style={s.card}>
    <Text style={s.title}>Как ощущалась нагрузка?</Text>
    <Text style={s.muted}>Учитывайте усилие и то, удавалось ли сохранять технику.</Text>
    <View style={[s.row, { gap: 6 }]}>{choices.map(choice => <Pressable key={choice.id} accessibilityRole="radio" accessibilityState={{ checked: record.effort === choice.id, disabled: busy }} disabled={busy}
      onPress={() => void save(() => data.store.rateWorkout(record.id, choice.id))}
      style={{ flex: 1, minHeight: 48, padding: 8, justifyContent: "center", borderRadius: 12, backgroundColor: record.effort === choice.id ? c.soft : c.surface, borderWidth: 1, borderColor: record.effort === choice.id ? c.accent : c.border }}>
      <Text style={[s.small, { textAlign: "center", color: c.text }]}>{choice.title}</Text>
    </Pressable>)}</View>
    {suggestion ? <Text style={s.muted}>{suggestion.message}</Text> : null}
    {suggestion && suggestion.level !== (data.settings.activity_level ?? "medium") ? <SecondaryButton disabled={busy}
      label={`На следующее занятие: ${activityLevels.find(level => level.id === suggestion.level)!.title.toLowerCase()}`}
      onPress={() => void save(() => data.store.setSettings({ ...data.settings, activity_level: suggestion.level }))} /> : null}
    <Text style={s.small}>Оценка сохраняется на этом устройстве. Выбор нагрузки применяется к следующему занятию.</Text>
    <ErrorText message={error} />
  </View>;
}
