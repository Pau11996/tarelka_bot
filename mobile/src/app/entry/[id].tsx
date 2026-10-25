import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState, useRef } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { requestKey, waitOperation, Operation } from "../../operations";
import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { AnalysisDetails } from "../../components/AnalysisDetails";
import { FavoriteButton } from "../../components/FavoriteButton";
import { useRequestLimit } from "../../components/RequestLimitDialog";
import { colors } from "../../theme";
import type { AnalyzeResponse, EntryDetails } from "../../types";
import { ErrorText, Field, PrimaryButton, SecondaryButton } from "../../ui";

export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, signOut } = useAuth();
  const { handleLimit } = useRequestLimit();
  const [entry, setEntry] = useState<EntryDetails | null>(null);
  const [correction, setCorrection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<EntryDetails>(`/v1/entries/${id}`, { token })
      .then((next) => {
        if (active) {
          setEntry(next);
        }
      })
      .catch(async (caught: unknown) => {
        const message = await apiFailureMessage(
          caught,
          "Запись не найдена",
          signOut,
        );
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
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      key.current ??= requestKey();
      const form = new FormData();
      form.append("request_key", key.current);
      form.append("text", correction.trim());
      form.append("entry_id", String(id));
      const operation = await api<Operation>("/v1/operations", {
        token,
        body: form,
      });
      key.current = null;
      const done = await waitOperation(operation, token);
      const result = done.result as AnalyzeResponse;
      if (result.status === "unknown") {
        setError(result.message);
        return;
      }
      setEntry(await api<EntryDetails>(`/v1/entries/${id}`, { token }));
      setCorrection("");
      setError(null);
    } catch (caught) {
      if (await handleLimit(caught, "text")) return;
      const message = await apiFailureMessage(
        caught,
        "Не удалось исправить",
        signOut,
      );
      if (message) setError(message);
    } finally {
      lock.current = false;
      setBusy(false);
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
              const message = await apiFailureMessage(
                caught,
                "Не удалось удалить",
              );
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
  const water = entry.entry_type === "water";

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <AnalysisDetails entry={entry} action={
        <FavoriteButton
          entryId={entry.id}
          favoriteId={entry.favorite_id}
          onChange={(favoriteId) => setEntry((current) => current ? { ...current, favorite_id: favoriteId } : current)}
        />
      } />
      <Text style={styles.sectionTitle}>Уточнить запись</Text>
      <Field
        value={correction}
        onChangeText={setCorrection}
        placeholder={
          water
            ? "Например: 500 мл"
            : activity
              ? "Например: пробежка 45 минут"
              : "Например: рис 180 г, курица 120 г"
        }
        multiline
        style={styles.multiline}
      />
      <ErrorText message={error} />
      <PrimaryButton
        label={busy ? "Пересчитываю…" : "Исправить"}
        disabled={busy}
        onPress={() => void correct()}
      />
      <SecondaryButton label="Удалить" onPress={remove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 20, backgroundColor: colors.bg, flex: 1 },
  content: {
    padding: 20,
    gap: 12,
    paddingBottom: 40,
    backgroundColor: colors.bg,
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "600", marginTop: 10 },
  multiline: { minHeight: 80, textAlignVertical: "top" },
});
