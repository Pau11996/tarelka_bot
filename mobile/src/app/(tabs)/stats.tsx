import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { formatDay, formatWhen, kcal } from "../../format";
import { colors } from "../../theme";
import type { Stats } from "../../types";
import { ErrorText, ScreenTitle } from "../../ui";

export default function StatsScreen() {
  const { token, signOut } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<Stats>("/v1/stats", { token });
      setStats(next);
      setError(null);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось загрузить статистику", signOut);
      if (message) setError(message);
    }
  }, [signOut, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const max = Math.max(1, ...(stats?.days.map((day) => day.calories) ?? [1]));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle
          title="Статистика"
          subtitle={
            stats
              ? `${formatDay(stats.start_date)} — ${formatDay(stats.end_date)}. Всего ${kcal(stats.total_calories)}, среднее ${kcal(stats.average_calories)}.`
              : "Последние 30 дней"
          }
        />
        <ErrorText message={error} />
        <View style={styles.chart}>
          {stats?.days.map((day) => (
            <View key={day.date} style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(2, (day.calories / max) * 88),
                    backgroundColor: day.calories > 0 ? colors.accent : colors.border,
                  },
                ]}
              />
            </View>
          ))}
        </View>
        <Text style={styles.section}>Вес</Text>
        {stats && stats.weight.length === 0 ? <Text style={styles.muted}>Записей веса за период нет.</Text> : null}
        {stats?.weight.map((point) => (
          <View key={point.recorded_at} style={styles.row}>
            <Text style={styles.rowTitle}>{point.weight_kg} кг</Text>
            <Text style={styles.muted}>{formatWhen(point.recorded_at)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  chart: {
    height: 110,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  barSlot: { flex: 1, justifyContent: "flex-end" },
  bar: { borderRadius: 3 },
  section: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 8 },
  muted: { color: colors.muted, fontSize: 14 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowTitle: { color: colors.text, fontWeight: "600" },
});
