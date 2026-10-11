import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { api, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { formatDay } from "../format";
import { colors } from "../theme";
import type { Subscription } from "../types";
import { ErrorText, Field, PrimaryButton, ScreenTitle } from "../ui";

export default function PayScreen() {
  const { token, signOut } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api<Subscription>("/v1/subscription", { token });
      setSubscription(next);
      setError(null);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось загрузить подписку", signOut);
      if (message) setError(message);
    }
  }, [signOut, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function checkout() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ status: string; message: string }>("/v1/billing/checkout", {
        method: "POST",
        token,
        json: { plan: "monthly" },
      });
      setMessage(result.message);
      setNumber("");
      setExpiry("");
      setCvc("");
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось отправить форму");
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  }

  const status = subscription?.active
    ? `Подписка активна до ${subscription.until ? formatDay(subscription.until) : "—"}.`
    : `Сейчас ${subscription?.requests_used_today ?? 0} из ${subscription?.daily_limit ?? "—"} запросов в день.`;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ScreenTitle title="Оплата картой" subtitle={status} />
      <Text style={styles.note}>Данные карты никуда не отправляются. Оплата ещё не подключена.</Text>
      <Field value={number} onChangeText={setNumber} keyboardType="number-pad" placeholder="Номер карты" maxLength={19} />
      <Field value={expiry} onChangeText={setExpiry} keyboardType="number-pad" placeholder="ММ/ГГ" maxLength={5} />
      <Field value={cvc} onChangeText={setCvc} keyboardType="number-pad" placeholder="CVC" maxLength={3} secureTextEntry />
      <ErrorText message={error} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <PrimaryButton label={busy ? "Проверяю…" : "Оплатить картой"} disabled={busy} onPress={() => void checkout()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40, backgroundColor: colors.bg },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  message: { color: colors.text, fontSize: 16, fontWeight: "600" },
});