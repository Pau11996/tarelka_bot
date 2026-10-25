import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { Link, Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInputProps,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { api, apiFailureMessage, pollLogin } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Brand";
import { LoginWelcome } from "../components/LoginWelcome";
import { API_URL, SITE_URL } from "../config";
import { authStorageKeys } from "../authStorage";
import { colors, welcomeColors } from "../theme";
import { ErrorText, Field, Loading, PrimaryButton, SecondaryButton } from "../ui";

const PENDING_LOGIN_KEY = authStorageKeys(API_URL).pendingLogin;

export default function LoginScreen() {
  const { ready, token, signIn } = useAuth();
  const [waiting, setWaiting] = useState(false);
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"choose" | "register" | "login">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const emailSending = useRef(false);
  const attempt = useRef(0);
  const running = useRef<number | null>(null);
  const inset = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  function chooseMode(next: typeof mode) {
    attempt.current++;
    running.current = null;
    setWaiting(false);
    setBotUrl(null);
    setError(null);
    setPassword("");
    setConfirmation("");
    setShowPassword(false);
    setShowConfirmation(false);
    setMode(next);
    void AsyncStorage.removeItem(PENDING_LOGIN_KEY);
  }

  async function waitForLogin(
    pending: { code: string; bot_url: string; expiresAt: number },
    open: boolean,
    id: number,
  ) {
    setBotUrl(pending.bot_url);
    try {
      if (open) await Linking.openURL(pending.bot_url).catch(() => undefined);
      while (id === attempt.current && Date.now() < pending.expiresAt) {
        const result = await pollLogin(pending.code);
        if (id !== attempt.current) return;
        if ("access_token" in result) {
          await AsyncStorage.removeItem(PENDING_LOGIN_KEY);
          if (id !== attempt.current) return;
          await signIn(result.access_token);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (id === attempt.current) {
        await AsyncStorage.removeItem(PENDING_LOGIN_KEY);
        setError("Время входа вышло. Попробуйте ещё раз.");
      }
    } catch (e) {
      if (id === attempt.current) {
        setError(await apiFailureMessage(e, "Не удалось подтвердить вход"));
        await AsyncStorage.removeItem(PENDING_LOGIN_KEY);
      }
    } finally {
      if (running.current === id) running.current = null;
      if (id === attempt.current) setWaiting(false);
    }
  }
  useEffect(() => {
    if (!ready || token) return;
    let active = true;
    const version = attempt.current;
    void AsyncStorage.getItem(PENDING_LOGIN_KEY).then((value) => {
      if (value && active && version === attempt.current) {
        try {
          const pending = JSON.parse(value);
          if (pending.expiresAt > Date.now() && running.current === null) {
            const id = ++attempt.current;
            running.current = id;
            setWaiting(true);
            void waitForLogin(pending, false, id);
          }
          else void AsyncStorage.removeItem(PENDING_LOGIN_KEY);
        } catch {
          void AsyncStorage.removeItem(PENDING_LOGIN_KEY);
        }
      }
    });
    return () => {
      active = false;
      attempt.current++;
    };
  }, [ready, token]);
  async function startLogin() {
    if (running.current !== null || emailSending.current) return;
    const id = ++attempt.current;
    running.current = id;
    setWaiting(true);
    setError(null);
    try {
      const result = await api<{
        code: string;
        bot_url: string;
        expires_in: number;
      }>("/v1/auth/telegram/start", { method: "POST" });
      if (id !== attempt.current) return;
      const pending = {
        ...result,
        expiresAt: Date.now() + result.expires_in * 1000,
      };
      await AsyncStorage.setItem(
        PENDING_LOGIN_KEY,
        JSON.stringify(pending),
      );
      if (id !== attempt.current) return;
      await waitForLogin(pending, true, id);
    } catch (e) {
      if (id === attempt.current) {
        setError(await apiFailureMessage(e, "Не удалось начать вход"));
        setWaiting(false);
      }
    } finally {
      if (running.current === id) running.current = null;
    }
  }

  async function submitEmail() {
    if (emailSending.current || mode === "choose") return;
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Укажите корректный email");
      return;
    }
    if (!password || (mode === "register" && password.length < 8)) {
      setError(mode === "register" ? "Пароль должен содержать не меньше 8 символов" : "Введите пароль");
      return;
    }
    if (mode === "register" && password !== confirmation) {
      setError("Пароли не совпадают");
      return;
    }
    emailSending.current = true;
    setEmailBusy(true);
    attempt.current++;
    running.current = null;
    setWaiting(false);
    try {
      await AsyncStorage.removeItem(PENDING_LOGIN_KEY);
      const result = await api<{ access_token: string }>(`/v1/auth/email/${mode}`, {
        json: {
          email: email.trim(),
          password,
          ...(mode === "register" ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow" } : {}),
        },
      });
      setPassword("");
      setConfirmation("");
      await signIn(result.access_token);
    } catch (e) {
      setError(await apiFailureMessage(e, "Не удалось войти. Попробуйте ещё раз."));
    } finally {
      emailSending.current = false;
      setEmailBusy(false);
    }
  }
  function closeEmailForm() {
    if (!emailSending.current) chooseMode("choose");
  }

  if (!ready) return <Loading />;
  if (token) return <Redirect href="/" />;

  return (
    <>
      <SafeAreaView style={s.safe} edges={["top", "bottom"]} importantForAccessibility={mode === "choose" ? "auto" : "no-hide-descendants"}>
        <LoginWelcome>
          <View style={s.actions}>
            <Pressable accessibilityRole="button" disabled={emailBusy} onPress={() => chooseMode("register")} style={({ pressed }) => [s.createButton, (pressed || emailBusy) && s.pressed]}>
              <Text style={s.createText}>Создать аккаунт</Text>
              <Icon name="arrowRight" size={18} color={colors.surface} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ busy: waiting, disabled: waiting || emailBusy }} disabled={waiting || emailBusy} onPress={() => void startLogin()} style={({ pressed }) => [s.telegramButton, (pressed || waiting) && s.pressed]}>
              {waiting ? <ActivityIndicator color={welcomeColors.telegramIcon} size="small" /> : <Icon name="telegram" color={welcomeColors.telegramIcon} size={18} />}
              <Text style={s.telegramText}>{waiting ? "Ждём подтверждение…" : "Войти через Telegram"}</Text>
            </Pressable>
            <Text style={s.telegramHint}>{waiting ? "Подтвердите вход в боте и вернитесь сюда" : "Откроется ваш дневник из Telegram-бота"}</Text>
            {waiting && botUrl ? <Link href={botUrl as any} target="_blank" style={s.reopenTelegram}>Открыть Telegram ещё раз</Link> : null}
            {waiting ? <SecondaryButton label="Отменить вход через Telegram" onPress={() => chooseMode("choose")} /> : null}
            <View style={s.signinRow}>
              <Text style={s.signinHint}>Уже есть аккаунт?</Text>
              <Pressable accessibilityRole="button" disabled={emailBusy} onPress={() => chooseMode("login")} style={({ pressed }) => [s.signinButton, pressed && s.pressed]}>
                <Text style={s.signinText}>Войти по email</Text>
              </Pressable>
            </View>
            {mode === "choose" ? <ErrorText message={error} /> : null}
            <LegalLinks onError={setError} />
          </View>
        </LoginWelcome>
      </SafeAreaView>
      <Modal visible={mode !== "choose"} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={closeEmailForm}>
        <KeyboardAvoidingView style={s.sheetHost} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Закрыть форму входа" focusable={false} disabled={emailBusy} onPress={closeEmailForm} />
          <View accessibilityViewIsModal onAccessibilityEscape={closeEmailForm} style={[s.sheet, { maxHeight: windowHeight - inset.top - 16, paddingBottom: Math.max(inset.bottom, 20) }]}>
            <View style={s.handle} />
            <View style={s.sheetHeading}>
              <Text accessibilityRole="header" style={s.sheetTitle}>{mode === "register" ? "Создать аккаунт" : "С возвращением"}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть форму" disabled={emailBusy} onPress={closeEmailForm} style={s.sheetClose}>
                <Icon name="close" size={18} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false} contentContainerStyle={s.form}>
              <Text style={s.formIntro}>{mode === "register" ? "Начните свой дневник с чистого листа." : "Войдите в дневник, который создали по email."}</Text>
              <View style={s.tabs}>
                {(["login", "register"] as const).map(item => (
                  <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: mode === item, disabled: emailBusy }} disabled={emailBusy} onPress={() => chooseMode(item)} style={[s.tab, mode === item && s.tabSelected]}>
                    <Text style={[s.tabText, mode === item && s.tabTextSelected]}>{item === "login" ? "Вход" : "Регистрация"}</Text>
                  </Pressable>
                ))}
              </View>
              <Field accessibilityLabel="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" keyboardType="email-address" editable={!emailBusy} maxLength={254} />
              <PasswordField accessibilityLabel="Пароль" placeholder={mode === "register" ? "Не меньше 8 символов" : "Ваш пароль"} value={password} onChangeText={setPassword} visible={showPassword} onToggle={() => setShowPassword(value => !value)} autoCapitalize="none" autoCorrect={false} autoComplete={mode === "register" ? "new-password" : "current-password"} textContentType={mode === "register" ? "newPassword" : "password"} editable={!emailBusy} maxLength={128} onSubmitEditing={() => { if (mode === "login") void submitEmail(); }} />
              {mode === "register" ? <PasswordField accessibilityLabel="Повторите пароль" placeholder="Ещё раз тот же пароль" value={confirmation} onChangeText={setConfirmation} visible={showConfirmation} onToggle={() => setShowConfirmation(value => !value)} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!emailBusy} maxLength={128} onSubmitEditing={() => void submitEmail()} /> : null}
              <View accessibilityLiveRegion="polite"><ErrorText message={error} /></View>
              <PrimaryButton label={emailBusy ? (mode === "register" ? "Создаём аккаунт…" : "Входим…") : mode === "register" ? "Зарегистрироваться" : "Войти"} disabled={emailBusy} onPress={() => void submitEmail()} />
              <Text style={s.accountHint}>Аккаунт по email и аккаунт Telegram имеют отдельные дневники.</Text>
              <LegalLinks onError={setError} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function PasswordField({ visible, onToggle, ...props }: TextInputProps & { visible: boolean; onToggle: () => void }) {
  const target = props.accessibilityLabel === "Повторите пароль" ? "повтор пароля" : "пароль";
  const disabled = props.editable === false;
  return <View>
    <Field {...props} secureTextEntry={!visible} style={[props.style, s.passwordInput]} />
    <Pressable accessibilityRole="button" accessibilityLabel={`${visible ? "Скрыть" : "Показать"} ${target}`} accessibilityState={{ selected: visible, disabled }} disabled={disabled} onPress={onToggle} style={({ pressed }) => [s.passwordEye, pressed && s.passwordEyePressed]}>
      <Icon name={visible ? "eyeOff" : "eye"} size={21} color={colors.muted} />
    </Pressable>
  </View>;
}

function LegalLinks({ onError }: { onError: (message: string) => void }) {
  return (
    <Text style={s.legal}>
      Продолжая, вы принимаете{" "}
      <Text accessibilityRole="link" style={s.legalLink} onPress={() => void Linking.openURL(`${SITE_URL}/terms.html`).catch(() => onError("Не удалось открыть условия"))}>условия</Text>
      {"\n"}и{" "}
      <Text accessibilityRole="link" style={s.legalLink} onPress={() => void Linking.openURL(`${SITE_URL}/privacy.html`).catch(() => onError("Не удалось открыть политику конфиденциальности"))}>политику конфиденциальности</Text>
    </Text>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  actions: { paddingTop: 13 },
  createButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 17, borderRadius: 15, backgroundColor: colors.accent },
  createText: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: colors.surface },
  telegramButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: 8, paddingHorizontal: 12 },
  telegramText: { fontSize: 12, lineHeight: 18, fontWeight: "500", color: welcomeColors.telegramText },
  telegramHint: { fontSize: 9, lineHeight: 14, color: welcomeColors.note, textAlign: "center", marginTop: 5 },
  reopenTelegram: { textAlign: "center", padding: 14, minHeight: 44, color: colors.accent, fontSize: 12, fontWeight: "600" },
  signinRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  signinHint: { fontSize: 11, color: colors.muted },
  signinButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  signinText: { fontSize: 11, fontWeight: "600", color: colors.accentDark },
  legal: { fontSize: 9, lineHeight: 14, color: welcomeColors.legal, textAlign: "center", paddingHorizontal: 10, paddingTop: 2 },
  legalLink: { textDecorationLine: "underline" },
  pressed: { opacity: 0.65 },
  sheetHost: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: welcomeColors.sheetOverlay },
  sheet: { width: "100%", maxWidth: 460, flexShrink: 1, backgroundColor: welcomeColors.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  handle: { width: 35, height: 4, borderRadius: 4, backgroundColor: welcomeColors.sheetHandle, alignSelf: "center", marginTop: 9, marginBottom: 12 },
  sheetHeading: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 24, marginBottom: 7 },
  sheetTitle: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.6, color: colors.text },
  sheetClose: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: welcomeColors.sheetClose },
  form: { paddingHorizontal: 24, paddingBottom: 4, gap: 13 },
  formIntro: { fontSize: 12, lineHeight: 19, color: colors.muted, marginBottom: 3 },
  tabs: { flexDirection: "row", backgroundColor: colors.soft, padding: 3, borderRadius: 12 },
  tab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  tabSelected: { backgroundColor: colors.surface },
  tabText: { fontSize: 12, lineHeight: 18, fontWeight: "500", color: colors.muted },
  tabTextSelected: { color: colors.accentDark, fontWeight: "600" },
  passwordInput: { paddingRight: 54 },
  passwordEye: { position: "absolute", right: 4, bottom: 1, width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  passwordEyePressed: { backgroundColor: colors.soft },
  accountHint: { fontSize: 10, lineHeight: 16, color: colors.muted, textAlign: "center" },
});
