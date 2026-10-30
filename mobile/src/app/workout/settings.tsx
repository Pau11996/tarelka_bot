import { useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorText, Loading } from "../../ui";
import { colors } from "../../theme";
import { useWorkouts } from "../../workouts/context";
import { s, WorkoutHeader } from "../../workouts/ui";

export default function WorkoutSettingsScreen() {
  const { store, ready, settings, settings_dirty, storage_error } = useWorkouts();
  const [error, setError] = useState<string | null>(null);
  async function change(key: "auto_log" | "sound", value: boolean) {
    setError(null);
    try { await store.setSettings({ ...settings, [key]: value }); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить настройки"); }
  }
  if (!ready) return <Loading />;
  return <SafeAreaView edges={["top", "bottom"]} style={s.page}>
    <WorkoutHeader title="Настройки тренировок" />
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.card}><View style={s.row}><Text style={[s.title, { flex: 1 }]}>Добавлять тренировку в дневник автоматически</Text><Switch accessibilityLabel="Добавлять тренировку в дневник автоматически" value={settings.auto_log} onValueChange={value => void change("auto_log", value)} trackColor={{ true: colors.accent, false: colors.border }} /></View><Text style={s.muted}>Завершённое занятие станет записью активности. Приблизительный расход увеличит остаток калорий на день. Запись будет видна и в общем дневнике Telegram.</Text><Text style={s.small}>Действует для новых занятий. Прерванные тренировки сохраняются только в истории. Для расчёта калорий нужен вес в профиле.</Text></View>
      <View style={s.card}><View style={s.row}><Text style={[s.title, { flex: 1 }]}>Звуки переходов</Text><Switch accessibilityLabel="Звуки переходов" value={settings.sound} onValueChange={value => void change("sound", value)} trackColor={{ true: colors.accent, false: colors.border }} /></View><Text style={s.muted}>Короткий сигнал при смене упражнения и начале отдыха.</Text></View>
      <ErrorText message={error} />
      {settings_dirty && !storage_error ? <Text style={s.small}>Настройки сохранены на устройстве и отправятся в аккаунт при подключении к интернету.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
