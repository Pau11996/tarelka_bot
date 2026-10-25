import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";
import { PrimaryButton, SecondaryButton } from "../ui";
import { Icon, IconButton } from "./Brand";

export type MediaPermissionKind = "camera" | "photos";

export function MediaPermissionDialog({ kind, onClose }: {
  kind: MediaPermissionKind; onClose: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const camera = kind === "camera";

  async function openSettings() {
    if (opening) return;
    setOpening(true);
    setSettingsError(false);
    try {
      await Linking.openSettings();
      onClose();
    } catch {
      setSettingsError(true);
    } finally {
      setOpening(false);
    }
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaView style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Закрыть запрос доступа" onPress={onClose} />
        <View style={s.card} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.top}>
              <View style={s.icon}><Icon name={camera ? "camera" : "gallery"} size={26} color={colors.accent} /></View>
              <IconButton name="close" label="Закрыть запрос доступа" onPress={onClose} />
            </View>
            <Text accessibilityRole="header" style={s.title}>{camera ? "Доступ к камере" : "Доступ к фотографиям"}</Text>
            <Text style={s.description}>
              {camera
                ? "Чтобы сделать снимок, разрешите приложению доступ к камере в настройках телефона. Готовое фото можно выбрать через скрепку в чате."
                : "Чтобы выбрать готовое фото, разрешите приложению доступ к фотографиям в настройках телефона."}
            </Text>
            {settingsError ? <Text accessibilityLiveRegion="polite" style={s.description}>Не удалось открыть настройки. Откройте настройки телефона → Приложения → Тарелка → Разрешения.</Text> : null}
            <PrimaryButton label="Открыть настройки" onPress={() => void openSettings()} disabled={opening} />
            <SecondaryButton label="Не сейчас" onPress={onClose} />
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "#10251b66" },
  card: { width: "100%", maxWidth: 380, maxHeight: "90%", borderRadius: 24, backgroundColor: colors.surface, overflow: "hidden" },
  content: { padding: 20, gap: 14 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "600", color: colors.text },
  description: { fontSize: 14, lineHeight: 21, color: colors.muted },
});
