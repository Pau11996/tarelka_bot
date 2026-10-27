import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Screen, State } from "../../components/Screen";
import { FavoriteCard } from "../../components/FavoriteCards";
import { FavoriteOrderEditor } from "../../components/FavoriteOrderEditor";
import { TransientNotice } from "../../components/TransientNotice";
import { Icon } from "../../components/Brand";
import { useResource } from "../../hooks/useResource";
import { useTransientNotice } from "../../hooks/useTransientNotice";
import { useAuth } from "../../auth";
import { api, ApiError, apiFailureMessage } from "../../api";
import { colors } from "../../theme";
import type { EntryType, Favorite } from "../../types";

const filters = [
  { value: "all", label: "Все" },
  { value: "meal", label: "Еда" },
  { value: "water", label: "Вода" },
  { value: "activity", label: "Активность" },
] as const;

export default function Favorites() {
  const { token, signOut } = useAuth();
  const r = useResource<{ favorites: Favorite[] }>("/v1/favorites");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | EntryType>("all");
  const [error, setError] = useState<string | null>(null);
  const { message: notice, show: showNotice, clear: clearNotice } = useTransientNotice();
  const [busy, setBusy] = useState<number | null>(null);
  const lock = useRef(false);
  const [draft, setDraft] = useState<Favorite[] | null>(null);
  const originalOrder = useRef<number[]>([]);
  const orderLock = useRef(false);
  const orderGeneration = useRef(0);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderConflict, setOrderConflict] = useState(false);

  useFocusEffect(useCallback(() => () => {
    orderGeneration.current++;
    orderLock.current = false;
    setDraft(null);
    setSavingOrder(false);
    setOrderError(null);
    setOrderConflict(false);
  }, []));

  function cancelOrder() {
    if (orderLock.current) return;
    setDraft(null); setOrderError(null); setOrderConflict(false);
    void r.load();
  }

  useEffect(() => {
    if (!draft) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { cancelOrder(); return true; });
    return () => sub.remove();
  }, [draft, r.load]);

  function startOrder() {
    const all = r.data?.favorites ?? [];
    if (lock.current || orderLock.current || all.length < 2) return;
    Keyboard.dismiss(); clearNotice();
    originalOrder.current = all.map(item => item.id);
    setOrderError(null); setOrderConflict(false); setDraft([...all]);
  }

  async function saveOrder() {
    if (!draft || orderLock.current || orderConflict) return;
    orderLock.current = true;
    const generation = orderGeneration.current;
    setSavingOrder(true); setOrderError(null);
    try {
      const result = await api<{ favorites: Favorite[] }>("/v1/favorites/order", {
        token, method: "PUT", json: { favorite_ids: draft.map(item => item.id), original_ids: originalOrder.current },
      });
      if (generation !== orderGeneration.current) return;
      r.setData(result); setDraft(null);
      showNotice("Порядок сохранён");
      // Invalidate any older background GET that overlapped the save.
      void r.load();
    } catch (e) {
      const message = await apiFailureMessage(e, "Не удалось сохранить порядок. Попробуйте ещё раз.", signOut);
      if (generation !== orderGeneration.current) return;
      setOrderError(message);
      setOrderConflict(e instanceof ApiError && e.status === 409);
    } finally {
      if (generation === orderGeneration.current) { orderLock.current = false; setSavingOrder(false); }
    }
  }

  async function log(item: Favorite) {
    if (lock.current) return;
    lock.current = true;
    setBusy(item.id);
    setError(null);
    clearNotice();
    try {
      await api(`/v1/favorites/${item.id}/log`, { token, method: "POST" });
      showNotice("Добавлено на сегодня");
    } catch (e) {
      setError(await apiFailureMessage(e, "Не удалось добавить запись", signOut));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const favorites = r.data?.favorites ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const items = favorites.filter((item) =>
    (filter === "all" || item.entry_type === filter)
    && item.title.toLocaleLowerCase("ru").includes(normalizedQuery),
  );

  if (draft) return <FavoriteOrderEditor
    items={draft} saving={savingOrder} error={orderError} conflict={orderConflict}
    onChange={setDraft} onSave={() => void saveOrder()} onCancel={cancelOrder}
  />;

  return (
    <View style={s.page}>
      <Screen
        title="Избранное"
        subtitle={r.data ? `Сохранено: ${favorites.length} · еда, вода и активность` : "Любимые записи под рукой"}
        refreshing={r.loading}
        onRefresh={() => void r.load()}
      >
        <View style={s.controls}>
          <View style={s.search}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Найти в избранном"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Поиск в избранном"
              autoCorrect={false}
              returnKeyType="search"
              style={s.searchInput}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
            {filters.map(({ value, label }) => {
              const count = value === "all" ? favorites.length : favorites.filter((item) => item.entry_type === value).length;
              const active = filter === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}: ${count}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => setFilter(value)}
                  style={({ pressed }) => [s.filter, active && s.filterActive, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[s.filterText, active && s.filterTextActive]}>{label} {count}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <State
          loading={r.loading && !r.data}
          error={error ?? r.error}
          empty={!r.loading && r.data && !items.length ? (
            favorites.length ? "Нет подходящих записей. Попробуйте другой поиск или категорию." : "Пока ничего не сохранено. Нажмите на звёздочку у записи в дневнике."
          ) : undefined}
          onRetry={() => { setError(null); void r.load(); }}
        />
        {favorites.length ? (
          <View style={s.list}>
            <View style={s.listHeading}>
              <Text style={s.listTitle}>Сохранённые записи</Text>
              {favorites.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Изменить порядок"
                disabled={busy !== null} onPress={startOrder} style={[s.order, busy !== null && { opacity: 0.5 }]}>
                <Icon name="sort" size={16} color={colors.accentDark} /><Text style={s.orderText}>Порядок</Text>
              </Pressable> : null}
            </View>
            {items.map((item) => (
              <FavoriteCard
                key={item.id}
                item={item}
                disabled={busy !== null}
                busy={busy === item.id}
                onOpen={() => {
                  Keyboard.dismiss();
                  router.push(`/favorite/${item.id}`);
                }}
                onLog={() => void log(item)}
              />
            ))}
          </View>
        ) : null}
      </Screen>
      <TransientNotice message={notice} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  controls: { gap: 10 },
  search: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, backgroundColor: colors.surface, borderRadius: 13, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, color: colors.text, fontSize: 13, paddingVertical: 10 },
  filters: { gap: 6 },
  filter: { minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: "500" },
  filterTextActive: { color: "white", fontWeight: "600" },
  list: { gap: 9 },
  listTitle: { color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 3 },
  listHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  order: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.soft, flexDirection: "row", alignItems: "center", gap: 5 },
  orderText: { fontSize: 12, fontWeight: "600", color: colors.accentDark },
});
