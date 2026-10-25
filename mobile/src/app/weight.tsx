import { useRef, useState } from "react";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Brand";
import { colors } from "../theme";
import { parseWeight } from "../weightTracking";
import { healthUpdated } from "../health/events";

export default function RecordWeight() {
  const { token, signOut } = useAuth();
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const operation = useRef<{ id: string; weight: number } | null>(null);
  function back() {
    Keyboard.dismiss();
    if (router.canGoBack()) router.back(); else router.replace("/(tabs)/achievements");
  }
  async function save() {
    if (saving.current) return;
    const value = parseWeight(weight);
    if (value === null) { setError("Введите положительный вес не больше 1000 кг."); return; }
    saving.current = true; setBusy(true); setError(null);
    if (!operation.current || operation.current.weight !== value) operation.current = { id: randomUUID(), weight: value };
    try {
      await api("/v1/weight", { token, method: "POST", json: { weight_kg: value, operation_id: operation.current.id } });
      healthUpdated();
      back();
    } catch (cause) { setError(await apiFailureMessage(cause, "Не удалось сохранить вес", signOut)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <SafeAreaView style={s.page} edges={["top", "bottom"]}>
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть запись веса" disabled={busy} onPress={back} style={s.back}><Icon name="left" size={21} /><Text style={s.backText}>Назад</Text></Pressable>
        <View style={s.icon}><Icon name="balance" size={25} color={colors.accent} /></View>
        <Text accessibilityRole="header" style={s.title}>Записать вес</Text>
        <Text style={s.hint}>Сохраним новое измерение за сегодня.{"\n"}Норма калорий останется прежней.</Text>
        <View style={s.field}>
          <Text style={s.label}>Ваш вес</Text>
          <View style={s.valueRow}><TextInput accessibilityLabel="Вес, кг" value={weight} onChangeText={value => { setWeight(value); setError(null); }} editable={!busy} keyboardType="decimal-pad" autoFocus maxLength={7} placeholder="72,5" placeholderTextColor="#a3b49a" style={s.input} /><Text style={s.unit}>кг</Text></View>
        </View>
        <Text style={s.hint}>Если вес не изменился, это тоже новое взвешивание.</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void save()} style={({ pressed }) => [s.save, (busy || pressed) && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="white" /> : <Icon name="check" size={18} color="white" />}<Text style={s.saveText}>{busy ? "Сохраняем…" : "Сохранить измерение"}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg }, content: { padding: 24, width: "100%", maxWidth: 480, alignSelf: "center", gap: 18 },
  back: { minHeight: 44, flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start" }, backText: { color: colors.accentDark, fontSize: 13 },
  icon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.soft, marginTop: 8 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.7, color: colors.text }, hint: { fontSize: 12, lineHeight: 20, color: colors.muted },
  field: { padding: 18, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: "white", gap: 12 }, label: { fontSize: 12, color: colors.muted },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 10 }, input: { flex: 1, minWidth: 0, minHeight: 54, padding: 0, fontSize: 37, lineHeight: 46, color: colors.accentDark, fontWeight: "600" }, unit: { color: colors.muted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 19 }, save: { minHeight: 48, padding: 12, borderRadius: 14, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, saveText: { color: "white", fontSize: 13, fontWeight: "600" },
});
