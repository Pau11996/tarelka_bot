import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AnalysisDetails } from "../../components/AnalysisDetails";
import { FavoriteCorrectionForm } from "../../components/FavoriteCorrectionForm";
import { useRequestLimit } from "../../components/RequestLimitDialog";
import { TransientNotice } from "../../components/TransientNotice";
import { Icon } from "../../components/Brand";
import { State } from "../../components/Screen";
import { useAuth } from "../../auth";
import { useResource } from "../../hooks/useResource";
import { useTransientNotice } from "../../hooks/useTransientNotice";
import { api, apiFailureMessage } from "../../api";
import { requestKey, type Operation } from "../../operations";
import { colors } from "../../theme";
import type { Favorite } from "../../types";
import { PrimaryButton, SecondaryButton } from "../../ui";

type FavoriteDetails = { favorite: Favorite; operation: Operation | null };
const isPending = (operation?: Operation | null) => operation?.status === "queued" || operation?.status === "running";

export default function SavedAnalysis() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, signOut } = useAuth();
  const r = useResource<FavoriteDetails>(`/v1/favorites/${id}`);
  const item = r.data?.favorite;
  const operation = r.data?.operation;
  const pending = isPending(operation);
  const { openLimit } = useRequestLimit();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<"log" | "remove" | "correct" | null>(null);
  const [correction, setCorrection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { message: notice, show: showNotice, clear: clearNotice } = useTransientNotice();
  const lock = useRef(false);
  const attempt = useRef<{ key: string; text: string } | null>(null);
  const observed = useRef<string | null>(null);
  const awaiting = useRef<string | null>(null);
  const scope = useRef(`${token}/${id}`);
  scope.current = `${token}/${id}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!operation) return;
    const state = `${operation.id}/${operation.status}`;
    if (observed.current === state) return;
    observed.current = state;
    if (isPending(operation)) {
      awaiting.current = operation.id;
      attempt.current = { key: operation.request_key, text: operation.text };
      setCorrection(current => current || operation.text);
      setError(null);
    } else if (operation.status === "failed") {
      attempt.current = { key: operation.request_key, text: operation.text };
      setCorrection(current => current || operation.text);
      setError(operation.error ?? "Не удалось уточнить избранное. Можно повторить.");
      if (operation.limit_reached) void openLimit(operation.limit_reached, "text");
    } else if (operation.status === "done") {
      const submitted = awaiting.current === operation.id || attempt.current?.key === operation.request_key;
      if (operation.result?.status === "unknown") {
        setCorrection(current => current || operation.text);
        setError(operation.result.message);
      } else if (submitted) {
        setCorrection(current => current.trim() === operation.text ? "" : current);
        setError(null);
        showNotice("Избранное обновлено");
      }
      attempt.current = null;
      awaiting.current = null;
    }
  }, [operation, openLimit, showNotice]);

  // Accepted corrections continue on the server. Reopening this card recovers
  // their state; polling only runs while the screen and application are active.
  useFocusEffect(useCallback(() => {
    if (!pending) return;
    let disposed = false, loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => AppState.currentState == null || AppState.currentState === "active";
    const poll = async () => {
      if (disposed || loading || !active()) return;
      loading = true;
      await r.load();
      loading = false;
      if (!disposed && active()) timer = setTimeout(() => void poll(), 1400);
    };
    timer = setTimeout(() => void poll(), 1400);
    const sub = AppState.addEventListener("change", state => {
      clearTimeout(timer);
      if (state === "active") void poll();
    });
    return () => { disposed = true; clearTimeout(timer); sub.remove(); };
  }, [pending, r.load]));

  async function correct() {
    if (!item || lock.current || pending) return;
    const text = correction.trim();
    if (!text) { setError("Опишите, что нужно изменить в избранном"); return; }
    if (attempt.current?.text !== text) attempt.current = { key: requestKey(), text };
    const submitted = attempt.current;
    const account = scope.current;
    lock.current = true;
    setBusy("correct");
    setError(null);
    setConfirmRemove(false);
    clearNotice();
    try {
      const next = await api<Operation>(`/v1/favorites/${item.id}/correct`, {
        token, method: "POST", json: { request_key: submitted.key, text: submitted.text },
      });
      if (!mounted.current || scope.current !== account) return;
      awaiting.current = next.id;
      r.setData(current => current ? { ...current, operation: next } : current);
      await r.load();
    } catch (caught) {
      if (!mounted.current || scope.current !== account) return;
      setError(await apiFailureMessage(caught, "Не удалось уточнить избранное", signOut));
      // A lost HTTP response may still have left a durable operation on the server.
      await r.load();
    } finally {
      lock.current = false;
      if (mounted.current && scope.current === account) setBusy(null);
    }
  }

  async function act(action: "log" | "remove") {
    if (!item || lock.current || pending) return;
    const account = scope.current;
    lock.current = true;
    setBusy(action);
    setError(null);
    clearNotice();
    try {
      await api(`/v1/favorites/${item.id}${action === "log" ? "/log" : ""}`, {
        token, method: action === "log" ? "POST" : "DELETE",
      });
      if (!mounted.current || scope.current !== account) return;
      if (action === "remove") {
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)/favorites");
      } else showNotice("Добавлено на сегодня");
    } catch (caught) {
      if (!mounted.current || scope.current !== account) return;
      setError(await apiFailureMessage(caught, action === "log" ? "Не удалось добавить запись" : "Не удалось убрать запись", signOut));
      await r.load();
    } finally {
      lock.current = false;
      if (mounted.current && scope.current === account) setBusy(null);
    }
  }

  return (
    <View style={s.page}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <State loading={r.loading && !item} error={error ?? r.error} empty={r.data && !item ? "Запись не найдена" : undefined} onRetry={() => void r.load()} />
      {item ? (
        <>
          <AnalysisDetails entry={{ ...item, created_at: null }} action={
            <Pressable accessibilityRole="button" accessibilityLabel="Убрать из избранного" disabled={busy !== null || pending} onPress={() => setConfirmRemove(true)} style={s.star}>
              <Icon name="star" size={20} color="#b18835" filled />
            </Pressable>
          } />
          <PrimaryButton label={busy === "log" ? "Добавляю…" : "Добавить на сегодня"} disabled={busy !== null || pending} onPress={() => void act("log")} />
          <FavoriteCorrectionForm item={item} value={correction} onChange={setCorrection} onSubmit={() => void correct()}
            disabled={busy !== null || pending}
            label={busy === "correct" ? "Отправляю…" : operation?.status === "queued" ? "В очереди…" : pending ? "Пересчитываю…" : "Сохранить уточнение"}
          />
          {confirmRemove ? (
            <View style={s.confirmation}>
              <Text style={s.confirmTitle}>Убрать из избранного?</Text>
              <Text style={s.muted}>Записи в дневнике останутся.</Text>
              <SecondaryButton label="Оставить" disabled={busy !== null || pending} onPress={() => setConfirmRemove(false)} />
              <Pressable accessibilityRole="button" disabled={busy !== null || pending} onPress={() => void act("remove")} style={s.remove}>
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
