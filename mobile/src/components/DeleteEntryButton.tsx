import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet } from "react-native";
import { api, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";
import { Icon } from "./Brand";

export function DeleteEntryButton({
  entryId,
  disabled,
  onDeleted,
}: {
  entryId: number;
  disabled?: boolean;
  onDeleted: () => void;
}) {
  const { token, signOut } = useAuth();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await api(`/v1/entries/${entryId}`, { method: "DELETE", token });
      onDeleted();
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось удалить запись", signOut);
      if (message) Alert.alert("Удаление записи", message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Удалить запись"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      hitSlop={8}
      onPress={(event) => {
        event.stopPropagation();
        void remove();
      }}
      style={({ pressed }) => [s.button, (pressed || disabled || busy) && { opacity: 0.5 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : (
        <Icon name="close" size={18} color={colors.muted} />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14 },
});
