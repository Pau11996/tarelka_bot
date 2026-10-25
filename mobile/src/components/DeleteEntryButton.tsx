import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (!lock.current) { setConfirming(false); setError(null); }
  }

  async function remove() {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/entries/${entryId}`, { method: "DELETE", token });
      setConfirming(false);
      onDeleted();
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось удалить запись", signOut);
      if (message) setError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <><Pressable
      accessibilityRole="button"
      accessibilityLabel="Удалить запись"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      hitSlop={8}
      onPress={(event) => {
        event.stopPropagation();
        if (!disabled && !lock.current) setConfirming(true);
      }}
      style={({ pressed }) => [s.button, (pressed || disabled || busy) && { opacity: 0.5 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : (
        <Icon name="trash" size={19} color={colors.muted} />
      )}
    </Pressable>
      <Modal visible={confirming} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Отменить удаление" disabled={busy} onPress={event => { event.stopPropagation(); close(); }} />
          <View style={s.dialog} accessibilityViewIsModal onAccessibilityEscape={close}>
            <Text accessibilityRole="header" style={s.title}>Удалить запись?</Text>
            <Text style={s.hint}>Запись исчезнет из дневника, а итоги дня пересчитаются. Восстановить её не получится.</Text>
            {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
            <View style={s.actions}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={event => { event.stopPropagation(); close(); }} style={s.cancel}><Text style={s.cancelText}>Оставить</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || disabled }} disabled={busy || disabled} onPress={event => { event.stopPropagation(); void remove(); }} style={[s.delete, busy && { opacity: 0.6 }]}><Text style={s.deleteText}>{busy ? "Удаляем…" : "Удалить"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  button: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "rgba(20,35,25,0.4)" },
  dialog: { width: "100%", maxWidth: 360, padding: 22, gap: 14, borderRadius: 22, backgroundColor: colors.surface },
  title: { fontSize: 21, fontWeight: "600", color: colors.text },
  hint: { fontSize: 14, lineHeight: 21, color: colors.muted },
  error: { fontSize: 14, lineHeight: 21, color: colors.danger },
  actions: { flexDirection: "row", gap: 10 },
  cancel: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.soft },
  delete: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.danger },
  cancelText: { fontSize: 14, fontWeight: "600", color: colors.text },
  deleteText: { fontSize: 14, fontWeight: "600", color: "white" },
});
