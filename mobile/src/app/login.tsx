import * as Linking from "expo-linking";
import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, apiFailureMessage, pollLogin } from "../api";
import { useAuth } from "../auth";
import { BrandMark, Icon } from "../components/Brand";
import { SITE_URL } from "../config";
import { colors } from "../theme";
import { ErrorText, Loading, SecondaryButton } from "../ui";

const hero = require("../../assets/login-hero.jpg");

export default function LoginScreen() {
  const { ready, token, signIn } = useAuth();
  const [waiting, setWaiting] = useState(false);
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const running = useRef(false);
  useEffect(() => { return () => { attempt.current += 1; }; }, []);

  if (!ready) return <Loading />;
  if (token) return <Redirect href="/(tabs)/chat" />;

  async function startLogin() {
    if (running.current) return;
    running.current = true;
    const id = ++attempt.current;
    setError(null); setWaiting(true); setBotUrl(null);
    try {
      const started = await api<{ code: string; bot_url: string; expires_in: number }>("/v1/auth/telegram/start", { method: "POST" });
      if (id !== attempt.current) return;
      setBotUrl(started.bot_url);
      await Linking.openURL(started.bot_url).catch(() => undefined);
      const deadline = Date.now() + started.expires_in * 1000;
      while (id === attempt.current && Date.now() < deadline) {
        const result = await pollLogin(started.code);
        if (id !== attempt.current) return;
        if ("access_token" in result) {
          await signIn(result.access_token);
          router.replace("/(tabs)/chat");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (id === attempt.current) setError("Время входа вышло. Попробуйте ещё раз.");
    } catch (caught) {
      if (id === attempt.current) setError(await apiFailureMessage(caught, "Не удалось начать вход"));
    } finally {
      running.current = false;
      if (id === attempt.current) setWaiting(false);
    }
  }

  return <SafeAreaView style={s.safe}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.brandRow}><BrandMark size={36} /><Text style={s.brand}>тарелка</Text></View>
      <Text accessibilityRole="header" style={s.title}>Забота о себе.{"\n"}В одном чате.</Text>
      <Text style={s.subtitle}>Отправляйте фото, голос или текст.{"\n"}Тарелка поможет вести дневник.</Text>
      <View style={s.hero} accessibilityLabel="Фото обеда и пример записи о прогулке">
        <Image source={hero} resizeMode="cover" style={s.heroImage} />
        <View style={s.chipTop}><Icon name="camera" size={16} color={colors.accent} /><Text style={s.chipText}>Фото обеда</Text></View>
        <View style={s.chipBottom}><Icon name="walk" size={16} color={colors.accent} /><Text style={s.chipText}>Прогулка 30 мин</Text></View>
      </View>
      <Pressable accessibilityRole="button" disabled={waiting} onPress={() => void startLogin()} style={({ pressed }) => [s.loginButton, (pressed || waiting) && { opacity: 0.75 }]}>
        {waiting ? <ActivityIndicator color="white" /> : <Icon name="telegram" color="white" size={20} />}
        <Text style={s.loginText}>{waiting ? "Ждём подтверждение…" : "Войти через Telegram"}</Text>
      </Pressable>
      <Text style={s.hint}>{waiting ? "Подтвердите вход в боте и вернитесь сюда" : "Без пароля и лишних шагов"}</Text>
      {waiting && botUrl ? <SecondaryButton label="Открыть Telegram ещё раз" onPress={() => void Linking.openURL(botUrl).catch(() => setError("Не удалось открыть Telegram"))} /> : null}
      <ErrorText message={error} />
      <Text style={s.legal}>Продолжая, вы принимаете <Text accessibilityRole="link" style={s.legalLink} onPress={() => void Linking.openURL(`${SITE_URL}/terms.html`).catch(() => setError("Не удалось открыть условия"))}>условия</Text> и <Text accessibilityRole="link" style={s.legalLink} onPress={() => void Linking.openURL(`${SITE_URL}/privacy.html`).catch(() => setError("Не удалось открыть политику конфиденциальности"))}>политику конфиденциальности</Text>.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20, width: "100%", maxWidth: 480, alignSelf: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brand: { color: colors.text, fontSize: 22, fontWeight: "600", letterSpacing: -0.4 },
  title: { marginTop: 28, fontSize: 34, lineHeight: 40, fontWeight: "700", color: colors.text, letterSpacing: -0.8 },
  subtitle: { marginTop: 14, fontSize: 16, lineHeight: 24, color: colors.muted },
  hero: { height: 250, borderRadius: 28, marginTop: 22, overflow: "hidden", backgroundColor: colors.soft },
  heroImage: { width: "100%", height: "100%" },
  chipTop: { position: "absolute", top: 16, left: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "white", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  chipBottom: { position: "absolute", left: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "white", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },
  loginButton: { marginTop: 22, minHeight: 56, backgroundColor: colors.accent, borderRadius: 28, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, gap: 10 },
  loginText: { color: "white", fontSize: 16, fontWeight: "700" },
  hint: { marginTop: 12, fontSize: 13, lineHeight: 18, textAlign: "center", color: colors.muted },
  legal: { marginTop: "auto", paddingTop: 28, textAlign: "center", color: colors.muted, fontSize: 12, lineHeight: 18 },
  legalLink: { textDecorationLine: "underline" },
});
