import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { kcal } from "../../format";
import { colors } from "../../theme";
import type { Favorite } from "../../types";
import { ErrorText, ScreenTitle } from "../../ui";

export default function FavoritesScreen() {
  const { token, signOut } = useAuth();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<{ favorites: Favorite[] }>("/v1/favorites", { token });
      setFavorites(next.favorites);
      setError(null);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось загрузить избранное", signOut);
      if (message) setError(message);
    }
  }, [signOut, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function logFavorite(item: Favorite) {
    try {
      await api(`/v1/favorites/${item.id}/log`, { method: "POST", token });
      Alert.alert("Добавлено", `${item.title} записано на сегодня.`);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось добавить");
      if (message) setError(message);
    }
  }

  async function remove(item: Favorite) {
    try {
      await api(`/v1/favorites/${item.id}`, { method: "DELETE", token });
      setFavorites((current) => current.filter((favorite) => favorite.id !== item.id));
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось удалить");
      if (message) setError(message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle title="Избранное" subtitle="Нажмите, чтобы добавить в сегодняшний дневник." />
        <ErrorText message={error} />
        {favorites.length === 0 ? <Text style={styles.muted}>Пока ничего не сохранено.</Text> : null}
        {favorites.map((item) => (
          <Pressable key={item.id} style={styles.row} onPress={() => void logFavorite(item)}>
            <View style={styles.rowText}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.muted}>{item.entry_type === "activity" ? "Активность" : "Еда"}</Text>
            </View>
            <Text style={styles.calories}>{kcal(item.calories)}</Text>
            <Pressable onPress={() => void remove(item)} hitSlop={8}>
              <Text style={styles.remove}>Удалить</Text>
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 12, paddingBottom: 32 },
  muted: { color: colors.muted, fontSize: 14 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowText: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  calories: { color: colors.text, fontWeight: "600" },
  remove: { color: colors.danger, fontSize: 13 },
});
