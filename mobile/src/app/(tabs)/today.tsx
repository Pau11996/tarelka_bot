import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { grams, kcal } from "../../format";
import { colors } from "../../theme";
import type { DayView, Entry } from "../../types";
import { ErrorText, PrimaryButton, ScreenTitle } from "../../ui";

export default function TodayScreen() {
  const { token, signOut } = useAuth();
  const [day, setDay] = useState<DayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api<DayView>("/v1/today", { token });
      setDay(next);
      setError(null);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось загрузить день", signOut);
      if (message) setError(message);
    }
  }, [signOut, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <ScreenTitle title="Сегодня" subtitle={day ? `${day.requests_used_today} из ${day.daily_limit} запросов` : undefined} />
        {day ? <BalanceCard day={day} /> : null}
        <ErrorText message={error} />
        <PrimaryButton label="Добавить еду или активность" onPress={() => router.push("/add")} />
        <View style={styles.list}>
          {day && day.entries.length === 0 ? (
            <Text style={styles.empty}>Пока пусто. Сфотографируйте еду или опишите её текстом.</Text>
          ) : null}
          {day?.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onPress={() => router.push(`/entry/${entry.id}`)} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BalanceCard({ day }: { day: DayView }) {
  const { balance, nutrient_targets: targets } = day;
  return (
    <View style={styles.balance}>
      <Text style={styles.remaining}>{kcal(balance.remaining)}</Text>
      <Text style={styles.muted}>осталось из {kcal(balance.target)}</Text>
      <Text style={styles.muted}>
        съедено {kcal(balance.consumed)}
        {balance.activity_bonus > 0 ? ` · активность ${kcal(balance.activity_bonus)}` : ""}
        {balance.streak ? ` · серия ${balance.streak} дн.` : ""}
      </Text>
      <View style={styles.macros}>
        <Macro label="Белки" value={grams(balance.protein_g)} target={grams(targets.protein_g)} />
        <Macro label="Жиры" value={grams(balance.fat_g)} target={grams(targets.fat_g)} />
        <Macro label="Углеводы" value={grams(balance.carbs_g)} target={grams(targets.carbs_g)} />
      </View>
    </View>
  );
}

function Macro({ label, value, target }: { label: string; value: string; target: string }) {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>
        {value} / {target}
      </Text>
    </View>
  );
}

function EntryRow({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const activity = entry.entry_type === "activity";
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{entry.title}</Text>
        <Text style={styles.muted}>{activity ? "Активность" : "Еда"}</Text>
      </View>
      <Text style={styles.rowCalories}>{activity ? `−${kcal(entry.calories)}` : kcal(entry.calories)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  balance: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 6,
  },
  remaining: { fontSize: 36, fontWeight: "700", color: colors.text },
  muted: { color: colors.muted, fontSize: 14 },
  macros: { flexDirection: "row", gap: 8, marginTop: 8 },
  macro: { flex: 1, backgroundColor: colors.soft, borderRadius: 12, padding: 10, gap: 2 },
  macroLabel: { color: colors.accentDark, fontSize: 12, fontWeight: "600" },
  macroValue: { color: colors.text, fontSize: 13 },
  list: { gap: 8 },
  empty: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  rowCalories: { color: colors.text, fontSize: 15, fontWeight: "600" },
});
