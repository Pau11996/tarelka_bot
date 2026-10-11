import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { grams, kcal } from "../../format";
import { colors } from "../../theme";
import type { AnalyzeResponse, Entry } from "../../types";
import { ErrorText, Field, PrimaryButton, SecondaryButton } from "../../ui";

export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, signOut } = useAuth();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [correction, setCorrection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<Entry>(`/v1/entries/${id}`, { token })
      .then((next) => {
        if (active) {
          setEntry(next);
        }
      })
      .catch(async (caught: unknown) => {
        const message = await apiFailureMessage(caught, "Запись не найдена", signOut);
        if (message && active) setError(message);
      });
    return () => {
      active = false;
    };
  }, [id, signOut, token]);

  async function correct() {
    if (!correction.trim()) {
      setError("Опишите, что нужно исправить");
      return;
    }
    setBusy(true);
    try {
      const result = await api<AnalyzeResponse>(`/v1/entries/${id}/correct`, {
        method: "POST",
        token,
        json: { text: correction.trim() },
      });
      if (result.status === "unknown") {
        setError(result.message);
        return;
      }
      setEntry(result.entry);
      setCorrection("");
      setError(null);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось исправить", signOut);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function favorite() {
    try {
      await api(`/v1/entries/${id}/favorite`, { method: "POST", token });
      Alert.alert("Избранное", "Запись сохранена.");
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось сохранить");
      if (message) setError(message);
    }
  }

  function remove() {
    Alert.alert("Удалить запись?", "Калории пропадут из дневника.", [
      { text: "Оставить", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await api(`/v1/entries/${id}`, { method: "DELETE", token });
              router.back();
            } catch (caught) {
              const message = await apiFailureMessage(caught, "Не удалось удалить");
              if (message) setError(message);
            }
          })();
        },
      },
    ]);
  }

  if (!entry) {
    return (
      <View style={styles.pad}>
        <ErrorText message={error ?? "Загружаю…"} />
      </View>
    );
  }

  const activity = entry.entry_type === "activity";

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{entry.title}</Text>
      <Text style={styles.calories}>{activity ? `Сожжено ${kcal(entry.calories)}` : kcal(entry.calories)}</Text>
      {activity && entry.duration_minutes ? <Text style={styles.muted}>{entry.duration_minutes} мин</Text> : null}
      {!activity ? (
        <Text style={styles.muted}>
          Б {grams(entry.protein_g)} · Ж {grams(entry.fat_g)} · У {grams(entry.carbs_g)}
        </Text>
      ) : null}
      {entry.items?.map((item, index) => (
        <View key={`${item.name}-${index}`} style={styles.item}>
          <Text style={styles.itemTitle}>{item.name}</Text>
          <Text style={styles.muted}>
            {item.quantity ? `${item.quantity} · ` : ""}
            {kcal(item.calories)}
          </Text>
        </View>
      ))}
      <Field
        value={correction}
        onChangeText={setCorrection}
        placeholder={activity ? "Например: пробежка 45 минут" : "Например: рис 180 г, курица 120 г"}
        multiline
        style={styles.multiline}
      />
      <ErrorText message={error} />
      <PrimaryButton label={busy ? "Пересчитываю…" : "Исправить"} disabled={busy} onPress={() => void correct()} />
      <SecondaryButton label="В избранное" onPress={() => void favorite()} />
      <SecondaryButton label="Удалить" onPress={remove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 20, backgroundColor: colors.bg, flex: 1 },
  content: { padding: 20, gap: 12, paddingBottom: 40, backgroundColor: colors.bg },
  title: { fontSize: 26, fontWeight: "700", color: colors.text },
  calories: { fontSize: 18, fontWeight: "600", color: colors.accentDark },
  muted: { color: colors.muted, fontSize: 14 },
  item: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 2,
  },
  itemTitle: { color: colors.text, fontWeight: "600" },
  multiline: { minHeight: 80, textAlignVertical: "top" },
});
