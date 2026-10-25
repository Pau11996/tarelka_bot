import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, apiFailureMessage } from "../api";
import { colors } from "../theme";
import { ErrorText, Field, PrimaryButton, SecondaryButton } from "../ui";

export function PasswordRecoveryForm({ email, onEmailChange, onBack, onBusyChange }: {
  email: string; onEmailChange: (value: string) => void;
  onBack: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    if (!retryAt) { setSeconds(0); return; }
    const tick = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function submit(sendCode: boolean) {
    if (lock.current || (sendCode && Date.now() < retryAt)) return;
    setError(null);
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError("Укажите корректный email"); return; }
    if (!sendCode) {
      if (!/^[0-9]{6}$/.test(code)) { setError("Введите 6 цифр из письма"); return; }
      if (password.length < 8) { setError("Пароль должен содержать не меньше 8 символов"); return; }
      if (password !== confirmation) { setError("Пароли не совпадают"); return; }
    }
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      if (sendCode) {
        const response = await api<{ resend_after: number }>("/v1/auth/email/forgot-password", { json: { email: address } });
        onEmailChange(address);
        setCode("");
        setRetryAt(Date.now() + response.resend_after * 1000);
        setStep("code");
      } else {
        await api("/v1/auth/email/reset-password", { json: { email: address, code, password } });
        setCode(""); setPassword(""); setConfirmation("");
        setStep("done");
      }
    } catch (caught) {
      setError(await apiFailureMessage(caught, "Не удалось восстановить пароль. Попробуйте ещё раз."));
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  if (step === "done") return <View style={s.form}>
    <Text accessibilityRole="header" style={s.success}>Пароль изменён</Text>
    <Text style={s.hint}>Войдите с новым паролем. На других устройствах тоже потребуется войти заново.</Text>
    <PrimaryButton label="Войти с новым паролем" onPress={onBack} />
  </View>;

  return <View style={s.form}>
    {step === "email" ? <>
      <Text style={s.hint}>Укажите почту, с которой создали аккаунт. Мы пришлём код для смены пароля.</Text>
      <Field accessibilityLabel="Email для восстановления" placeholder="you@example.com" value={email} onChangeText={onEmailChange} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254} editable={!busy} onSubmitEditing={() => void submit(true)} />
    </> : <>
      <Text style={s.hint}>Если аккаунт с адресом {email} существует, мы отправили код. Проверьте входящие и «Спам». Код действует 10 минут.</Text>
      <Field accessibilityLabel="Код из письма" placeholder="6 цифр из письма" value={code} onChangeText={value => setCode(value.replace(/[^0-9]/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} editable={!busy} />
      <Field accessibilityLabel="Новый пароль" placeholder="Новый пароль, от 8 символов" value={password} onChangeText={setPassword} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" maxLength={128} editable={!busy} />
      <Field accessibilityLabel="Повторите новый пароль" placeholder="Повторите новый пароль" value={confirmation} onChangeText={setConfirmation} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" maxLength={128} editable={!busy} onSubmitEditing={() => void submit(false)} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => setVisible(value => !value)} style={s.linkButton}><Text style={s.link}>{visible ? "Скрыть пароли" : "Показать пароли"}</Text></Pressable>
    </>}
    <View accessibilityLiveRegion="polite"><ErrorText message={error} /></View>
    <PrimaryButton label={busy ? "Подождите…" : step === "email" ? "Отправить код" : "Сохранить новый пароль"} disabled={busy || (step === "email" && seconds > 0)} onPress={() => void submit(step === "email")} />
    {step === "code" ? <>
      <SecondaryButton label={seconds > 0 ? `Отправить ещё раз через ${seconds} с` : "Отправить код ещё раз"} disabled={busy || seconds > 0} onPress={() => void submit(true)} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setStep("email"); setCode(""); setPassword(""); setConfirmation(""); setError(null); }} style={s.linkButton}><Text style={s.link}>Изменить email</Text></Pressable>
    </> : seconds > 0 ? <Text style={s.hint}>Повторная отправка через {seconds} с.</Text> : null}
    <SecondaryButton label="Вернуться ко входу" disabled={busy} onPress={onBack} />
  </View>;
}

const s = StyleSheet.create({
  form: { gap: 13 },
  hint: { fontSize: 13, lineHeight: 20, color: colors.muted },
  success: { fontSize: 18, fontWeight: "600", color: colors.accentDark },
  linkButton: { minHeight: 44, justifyContent: "center" },
  link: { fontSize: 13, color: colors.accentDark, fontWeight: "500" },
});
