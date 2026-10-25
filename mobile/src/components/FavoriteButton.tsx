import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet } from "react-native";
import { api, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";
import type { Favorite } from "../types";
import { Icon } from "./Brand";

export function FavoriteButton({
  entryId,
  favoriteId,
  onChange,
}: {
  entryId: number;
  favoriteId?: number | null;
  onChange: (favoriteId: number | null) => void;
}) {
  const { token, signOut } = useAuth();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const saved = favoriteId != null;

  async function toggle() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (favoriteId != null) {
        await api(`/v1/favorites/${favoriteId}`, { method: "DELETE", token });
        onChange(null);
      } else {
        const result = await api<{ favorite: Favorite }>(`/v1/entries/${entryId}/favorite`, {
          method: "POST",
          token,
        });
        onChange(result.favorite.id);
      }
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось обновить избранное", signOut);
      if (message) Alert.alert("Избранное", message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? "Убрать из избранного" : "Добавить в избранное"}
      accessibilityState={{ selected: saved, disabled: busy, busy }}
      disabled={busy}
      onPress={(event) => {
        event.stopPropagation();
        void toggle();
      }}
      style={({ pressed }) => [s.button, (pressed || busy) && { opacity: 0.5 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : (
        <Icon name="star" size={20} color={saved ? "#b18835" : colors.muted} filled={saved} />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 },
});
