import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, apiFailureMessage } from "../api";
import { colors } from "../theme";
import { ErrorText, Field, PrimaryButton, SecondaryButton } from "../ui";

export type PendingRegistration = {
  registration_id: string;
  email: string;
  resend_after: number;
};

export function EmailVerificationForm({ registration, onVerified, onChangeEmail, onLogin, onBusyChange }: {
  registration: PendingRegistration;
  onVerified: (token: string) => Promise<void>;
  onChangeEmail: () => void;
  onLogin: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const [retryAt, setRetryAt] = useState(() => Date.now() + registration.resend_after * 1000);
  const [seconds, setSeconds] = useState(registration.resend_after);
  const lock = useRef(false);

  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function submit(action: "verify" | "resend") {
    if (lock.current || (action === "resend" && Date.now() < retryAt)) return;
    setError(null);
    if (action === "verify" && !/^[0-9]{6}$/.test(code)) {
      setError("Введите 6 цифр из письма");
      return;
    }
    lock.current = true;
    setBusy(action);
    onBusyChange(true);
    try {
      if (action === "resend") {
        const response = await api<PendingRegistration>("/v1/auth/email/register/resend", {
          json: { registration_id: registration.registration_id },
        });
        setCode("");
        setRetryAt(Date.now() + response.resend_after * 1000);
      } else {
        const response = await api<{ access_token: string }>("/v1/auth/email/register/verify", {
          json: { registration_id: registration.registration_id, code },
        });
        await onVerified(response.access_token);
      }
    } catch (caught) {
      setError(await apiFailureMessage(caught, "Не удалось подтвердить почту. Попробуйте ещё раз."));
    } finally {
      lock.current = false;
      setBusy(null);
      onBusyChange(false);
    }
  }

  return <View style={s.form}>
    <Text style={s.hint}>Отправили код на {registration.email}. Введите его, чтобы завершить регистрацию. Код действует 10 минут.</Text>
    <Field accessibilityLabel="Код подтверждения почты" placeholder="6 цифр из письма" value={code}
      onChangeText={value => setCode(value.replace(/[^0-9]/g, "").slice(0, 6))}
      keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode"
      maxLength={6} editable={!busy} onSubmitEditing={() => void submit("verify")} />
    <View accessibilityLiveRegion="polite"><ErrorText message={error} /></View>
    <PrimaryButton label={busy === "verify" ? "Подтверждаем…" : "Подтвердить почту"}
      disabled={!!busy} onPress={() => void submit("verify")} />
    <Text style={s.hint}>Письма нет? Проверьте папку «Спам» или запросите новый код.</Text>
    <SecondaryButton label={busy === "resend" ? "Отправляем…" : seconds > 0 ? `Отправить ещё раз через ${seconds} с` : "Отправить код ещё раз"}
      disabled={!!busy || seconds > 0} onPress={() => void submit("resend")} />
    <SecondaryButton label="Изменить email" disabled={!!busy} onPress={onChangeEmail} />
    <SecondaryButton label="Вернуться ко входу" disabled={!!busy} onPress={onLogin} />
  </View>;
}

const s = StyleSheet.create({
  form: { gap: 13 },
  hint: { fontSize: 13, lineHeight: 21, color: colors.muted },
});
