import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { Icon } from "../../components/Brand";
import { SITE_URL } from "../../config";
import { colors } from "../../theme";
import type { AccountSettings, Profile } from "../../types";
import { ErrorText, Field, PrimaryButton, ScreenTitle, SecondaryButton } from "../../ui";

const SEX = [
  { value: "female", label: "Женский" },
  { value: "male", label: "Мужской" },
] as const;

const GOALS = [
  { value: "lose", label: "Похудение" },
  { value: "maintain", label: "Поддержание" },
  { value: "gain", label: "Набор" },
] as const;

const ACTIVITY = [
  { value: "sedentary", label: "Минимальная" },
  { value: "light", label: "Лёгкая" },
  { value: "moderate", label: "Умеренная" },
  { value: "active", label: "Высокая" },
  { value: "very_active", label: "Очень высокая" },
] as const;

export default function ProfileScreen() {
  const { token, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [calories, setCalories] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [next, account] = await Promise.all([
        api<Profile>("/v1/profile", { token }),
        api<AccountSettings>("/v1/settings", { token }),
      ]);
      setProfile(next);
      setSettings(account);
      setWeight(next.weight_kg?.toString() ?? "");
      setHeight(next.height_cm?.toString() ?? "");
      setAge(next.age?.toString() ?? "");
      setCalories(String(Math.round(next.daily_calorie_target)));
      setError(null);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось загрузить настройки", signOut);
      if (message) setError(message);
    }
  }, [signOut, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function setNotifications(enabled: boolean) {
    const previous = settings?.notifications_enabled ?? true;
    setSettings((current) => (current ? { ...current, notifications_enabled: enabled } : current));
    try {
      const next = await api<{ notifications_enabled: boolean }>("/v1/settings/notifications", {
        method: "PUT",
        token,
        json: { enabled },
      });
      setSettings((current) => (current ? { ...current, notifications_enabled: next.notifications_enabled } : current));
    } catch (caught) {
      setSettings((current) => (current ? { ...current, notifications_enabled: previous } : current));
      const message = await apiFailureMessage(caught, "Не удалось изменить напоминания");
      if (message) setError(message);
    }
  }

  async function shareInvite() {
    const url = settings?.referral_url;
    if (!url) {
      setError("Приглашения временно недоступны.");
      return;
    }
    const message = `Я веду дневник питания в Тарелке. ${url}`;
    try {
      await Share.share({ message, url });
    } catch {
      await Linking.openURL(url);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Удалить все данные",
      "Удалятся профиль, дневник, анализы, избранное, история веса и сведения об оплатах. Это нельзя отменить.",
      [
        { text: "Отмена", style: "cancel" },
        { text: "Да, удалить", style: "destructive", onPress: () => void deleteAccount() },
      ],
    );
  }

  async function deleteAccount() {
    try {
      await api("/v1/account", { method: "DELETE", token });
      await signOut();
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось удалить данные", signOut);
      if (message) setError(message);
    }
  }

  async function save() {
    if (!profile) {
      return;
    }
    setSaved(null);
    const body: Record<string, string | number> = {};
    if (weight.trim()) {
      body.weight_kg = Number(weight.replace(",", "."));
    }
    if (height.trim()) {
      body.height_cm = Number(height.replace(",", "."));
    }
    if (age.trim()) {
      body.age = Number(age);
    }
    const loadedCalories = String(Math.round(profile.daily_calorie_target));
    if (calories.trim() && calories.trim() !== loadedCalories) {
      body.daily_calorie_target = Number(calories.replace(",", "."));
    }
    if (profile.sex) {
      body.sex = profile.sex;
    }
    if (profile.goal) {
      body.goal = profile.goal;
    }
    if (profile.activity_level) {
      body.activity_level = profile.activity_level;
    }
    try {
      const next = await api<Profile>("/v1/profile", { method: "PUT", token, json: body });
      setProfile(next);
      setCalories(String(Math.round(next.daily_calorie_target)));
      setSaved(next.is_complete ? "Профиль сохранён." : "Сохранено. Заполните все поля, чтобы пересчитать норму.");
      setError(null);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось сохранить");
      if (message) setError(message);
    }
  }

  const bonus = settings?.referral_bonus_requests ?? 0;
  const inviteHint = settings
    ? `Когда друг заполнит профиль и отправит первый анализ, вы получите ${bonus} ${bonusWord(bonus)}. Сейчас: ${settings.bonus_requests}.`
    : "Загрузка приглашения…";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <Icon name="settings" size={28} color={colors.accentDark} />
          <ScreenTitle title="Настройки" />
        </View>

        <Text style={styles.section}>Уведомления</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Напоминания</Text>
            <Text style={styles.rowHint}>Дневник и информационные сообщения. Сервисные сообщения об оплате могут приходить отдельно.</Text>
          </View>
          <Switch
            accessibilityLabel="Напоминания"
            value={settings?.notifications_enabled ?? true}
            onValueChange={(enabled) => void setNotifications(enabled)}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor="#ffffff"
          />
        </View>

        <Text style={styles.section}>Реферал</Text>
        <View style={styles.block}>
          <Text style={styles.rowTitle}>Пригласить друга</Text>
          <Text style={styles.rowHint}>{inviteHint}</Text>
          {settings?.referral_url ? <Text style={styles.linkText}>{settings.referral_url}</Text> : null}
          <SecondaryButton label="Поделиться приглашением" onPress={() => void shareInvite()} />
        </View>

        <Text style={styles.section}>Подписка</Text>
        <SettingRow label="Подписка" hint="Лимит запросов и оплата" onPress={() => router.push("/pay")} />

        <Text style={styles.section}>Как пользоваться</Text>
        <SettingRow
          label="Как пользоваться"
          hint="Фото, голос, текст, дневник и избранное"
          onPress={() => setHelpOpen((open) => !open)}
        />
        {helpOpen ? (
          <Text style={styles.help}>
            Отправьте фото, голос или текст — Тарелка посчитает калории и БЖУ или учтёт активность. Дневник показывает баланс дня, статистика — месяц и выбранный день, избранное — быстрый повтор блюд и активностей. Профиль ниже задаёт норму калорий. Можно начинать сразу: стартовая норма — 2000 ккал.
          </Text>
        ) : null}

        <Text style={styles.section}>Политики</Text>
        <SettingRow label="Какие данные хранятся" hint="Профиль, дневник, анализы и оплаты" onPress={() => void Linking.openURL(`${SITE_URL}/privacy.html`)} />
        <SettingRow label="Условия использования" onPress={() => void Linking.openURL(`${SITE_URL}/terms.html`)} />

        <Text style={styles.section}>Контакты</Text>
        {settings?.feedback_url ? (
          <SettingRow label="Чат поддержки" onPress={() => void Linking.openURL(settings.feedback_url!)} />
        ) : null}
        {settings?.channel_url ? (
          <SettingRow label="Канал ТАРЕЛКА" hint="Новости и советы" onPress={() => void Linking.openURL(settings.channel_url!)} />
        ) : null}
        <SettingRow
          label="Вопросы по оплате и возвратам"
          hint={settings?.support_email}
          onPress={() => void Linking.openURL(`mailto:${settings?.support_email ?? ""}`)}
        />

        <Text style={styles.section}>Профиль</Text>
        <Text style={styles.rowHint}>Норма калорий считается, когда заполнены вес, рост, возраст, пол, цель и активность.</Text>
        <Field value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="Вес, кг" />
        <Field value={height} onChangeText={setHeight} keyboardType="decimal-pad" placeholder="Рост, см" />
        <Field value={age} onChangeText={setAge} keyboardType="number-pad" placeholder="Возраст" />
        <Choice
          label="Пол"
          options={SEX}
          value={profile?.sex ?? null}
          onChange={(sex) => setProfile((current) => (current ? { ...current, sex } : current))}
        />
        <Choice
          label="Цель"
          options={GOALS}
          value={profile?.goal ?? null}
          onChange={(goal) => setProfile((current) => (current ? { ...current, goal } : current))}
        />
        <Choice
          label="Активность"
          options={ACTIVITY}
          value={profile?.activity_level ?? null}
          onChange={(activity_level) => setProfile((current) => (current ? { ...current, activity_level } : current))}
        />
        <Field value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Дневная норма, ккал" />
        <ErrorText message={error} />
        {saved ? <Text style={styles.saved}>{saved}</Text> : null}
        <PrimaryButton label="Сохранить" onPress={() => void save()} />

        <Text style={styles.section}>Данные</Text>
        <SettingRow label="Удалить все данные" danger onPress={confirmDelete} />
        <SecondaryButton label="Выйти" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function bonusWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "бонусный запрос";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "бонусных запроса";
  return "бонусных запросов";
}

function SettingRow({
  label,
  hint,
  onPress,
  danger,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && styles.danger]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choice}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.chip, selected && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  section: { marginTop: 8, color: colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  block: {
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  rowHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  linkText: { color: colors.accentDark, fontSize: 13 },
  help: { color: colors.text, fontSize: 14, lineHeight: 20 },
  chevron: { color: colors.muted, fontSize: 22, lineHeight: 22 },
  danger: { color: colors.danger },
  choice: { gap: 8 },
  choiceLabel: { color: colors.muted, fontSize: 13 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: colors.soft, borderColor: colors.accent },
  chipLabel: { color: colors.text, fontSize: 14 },
  chipLabelOn: { color: colors.accentDark, fontWeight: "700" },
  saved: { color: colors.accentDark, fontSize: 14 },
});
