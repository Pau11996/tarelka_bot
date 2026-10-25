import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnalysisDetails } from "../../components/AnalysisDetails";
import { TransientNotice } from "../../components/TransientNotice";
import { Icon } from "../../components/Brand";
import { State } from "../../components/Screen";
import { useAuth } from "../../auth";
import { useResource } from "../../hooks/useResource";
import { useTransientNotice } from "../../hooks/useTransientNotice";
import { api, apiFailureMessage } from "../../api";
import { colors } from "../../theme";
import type { Favorite } from "../../types";
import { PrimaryButton, SecondaryButton } from "../../ui";

// Old favorites can outlive their original diary entry. Render their saved
// analysis with the same component instead of navigating to a deleted entry.
export default function SavedAnalysis() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, signOut } = useAuth();
  const r = useResource<{ favorites: Favorite[] }>("/v1/favorites");
  const item = r.data?.favorites.find((favorite) => String(favorite.id) === id);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<"log" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { message: notice, show: showNotice, clear: clearNotice } = useTransientNotice();
  const lock = useRef(false);

  useEffect(() => {
    if (item?.source_entry_id != null) router.replace(`/entry/${item.source_entry_id}`);
  }, [item?.source_entry_id]);

  async function act(action: "log" | "remove") {
    if (!item || lock.current) return;
    lock.current = true;
    setBusy(action);
    setError(null);
    clearNotice();
    try {
      await api(`/v1/favorites/${item.id}${action === "log" ? "/log" : ""}`, {
        token, method: action === "log" ? "POST" : "DELETE",
      });
      if (action === "remove") {
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)/favorites");
      } else showNotice("Добавлено на сегодня");
    } catch (caught) {
      setError(await apiFailureMessage(caught, action === "log" ? "Не удалось добавить запись" : "Не удалось убрать запись", signOut));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  return (
    <View style={s.page}>
    <ScrollView contentContainerStyle={s.content}>
      <State loading={r.loading && !item} error={error ?? r.error} empty={r.data && !item ? "Запись не найдена" : undefined} onRetry={() => void r.load()} />
      {item ? (
        <>
          <AnalysisDetails entry={item} action={
            <Pressable accessibilityRole="button" accessibilityLabel="Убрать из избранного" disabled={busy !== null} onPress={() => setConfirmRemove(true)} style={s.star}>
              <Icon name="star" size={20} color="#b18835" filled />
            </Pressable>
          } />
          <PrimaryButton label={busy === "log" ? "Добавляю…" : "Добавить на сегодня"} disabled={busy !== null} onPress={() => void act("log")} />
          {confirmRemove ? (
            <View style={s.confirmation}>
              <Text style={s.confirmTitle}>Убрать из избранного?</Text>
              <Text style={s.muted}>Записи в дневнике останутся.</Text>
              <SecondaryButton label="Оставить" disabled={busy !== null} onPress={() => setConfirmRemove(false)} />
              <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void act("remove")} style={s.remove}>
                <Text style={s.removeText}>{busy === "remove" ? "Убираю…" : "Убрать"}</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
    <TransientNotice message={notice} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 20, gap: 12, paddingBottom: 40, backgroundColor: colors.bg },
  star: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  confirmation: { backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 14, gap: 10 },
  confirmTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  remove: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: "600" },
});
