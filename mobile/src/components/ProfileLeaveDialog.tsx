import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";
import { Icon } from "./Brand";

export function ProfileLeaveDialog({ busy, error, onSave, onContinue, onDiscard }: {
  busy: boolean; error: string | null;
  onSave: () => void; onContinue: () => void; onDiscard: () => void;
}) {
  return <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onContinue}>
    <SafeAreaView style={s.overlay}>
      <Pressable style={StyleSheet.absoluteFill} disabled={busy} accessibilityRole="button" accessibilityLabel="Продолжить редактирование профиля" onPress={onContinue} />
      <View style={s.card} role="dialog" accessibilityLabel="Сохранить изменения?" accessibilityViewIsModal onAccessibilityEscape={onContinue}>
        <ScrollView contentContainerStyle={s.content} bounces={false}>
          <View style={s.icon}><Icon name="left" size={24} color="#477a60" /></View>
          <Text accessibilityRole="header" style={s.title}>Сохранить изменения?</Text>
          <Text style={s.description}>В профиле есть несохранённые правки.{"\n"}Что сделать перед выходом?</Text>
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onSave} style={({ pressed }) => [s.button, s.primary, (pressed || busy) && s.pressed]}>
            {busy ? <ActivityIndicator size="small" color="white" /> : null}
            <Text style={s.primaryText}>{busy ? "Сохраняем…" : "Сохранить и выйти"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onContinue} style={({ pressed }) => [s.button, s.secondary, (pressed || busy) && s.pressed]}>
            <Text style={s.secondaryText}>Продолжить редактирование</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onDiscard} style={({ pressed }) => [s.button, (pressed || busy) && s.pressed]}>
            <Text style={s.discardText}>Выйти без сохранения</Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: "#182c2355" },
  card: { width: "100%", maxWidth: 420, maxHeight: "90%", borderRadius: 25, backgroundColor: "#f8faf6", overflow: "hidden" },
  content: { padding: 22, gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#e7efe3", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 23, lineHeight: 29, fontWeight: "600", letterSpacing: -0.5, color: colors.text, marginTop: 5 },
  description: { fontSize: 14, lineHeight: 21, color: colors.muted, marginBottom: 6 },
  error: { fontSize: 13, lineHeight: 19, color: colors.danger },
  button: { minHeight: 48, borderRadius: 13, padding: 12, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: colors.accent },
  primaryText: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: "white", textAlign: "center" },
  secondary: { backgroundColor: "#e4efdf" },
  secondaryText: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: colors.accentDark, textAlign: "center" },
  discardText: { fontSize: 13, lineHeight: 19, fontWeight: "500", color: colors.danger, textAlign: "center" },
  pressed: { opacity: 0.6 },
});
