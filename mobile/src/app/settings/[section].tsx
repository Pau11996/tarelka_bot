import { Redirect, router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import { useState } from "react";
import { Alert, Linking, Pressable, Share, Text, View } from "react-native";
import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { FeedbackForm } from "../../components/FeedbackForm";
import { BrandMark, Icon } from "../../components/Brand";
import { Screen, Panel, State, design } from "../../components/Screen";
import { useResource } from "../../hooks/useResource";
import { SITE_URL } from "../../config";
import { colors } from "../../theme";
import type { AccountSettings } from "../../types";
import { SecondaryButton } from "../../ui";

export default function AccountSection() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const { token, signOut } = useAuth();
  const r = useResource<AccountSettings>("/v1/settings");
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const settings = r.data;
  if (section === "personal") return <Redirect href="/profile" />;
  async function shareInvite() {
    if (!settings?.referral_url) return;
    try {
      await Share.share({
        message: `Я веду дневник питания в Тарелке. ${settings.referral_url}`,
        url: settings.referral_url,
      });
    } catch {
      setError("Не удалось поделиться приглашением. Попробуйте ещё раз.");
    }
  }
  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    try {
      await api("/v1/account", { method: "DELETE", token });
      await signOut();
    } catch (e) {
      setError(
        await apiFailureMessage(e, "Не удалось удалить данные", signOut),
      );
    } finally {
      setDeleting(false);
    }
  }
  function confirmDelete() {
    Alert.alert(
      "Удалить все данные",
      "Удалятся профиль, дневник, анализы, избранное, история веса и сведения об оплатах. Это нельзя отменить.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Да, удалить",
          style: "destructive",
          onPress: () => void deleteAccount(),
        },
      ],
    );
  }
  const goal = settings?.referral_monthly_goal ?? 5;
  const progress = settings?.referral_progress ?? 0;
  return (
    <Screen
      back
      backTo="/account"
      title={
        (
          {
            invite: "Пригласить друга",
            help: "Помощь",
            guide: "Как пользоваться",
            feedback: "Обратная связь",
            documents: "Документы",
            about: "О приложении",
            data: "Аккаунт и данные",
          } as Record<string, string>
        )[section] ?? "Аккаунт"
      }
      subtitle={
        (
          {
            invite: "Полезными привычками приятно делиться",
            help: "Подскажем и поможем разобраться",
            guide: "Фото, голос, дневник и избранное",
            feedback: "Поможем разобраться и выслушаем ваши идеи",
            documents: "Условия использования и конфиденциальность",
            data: "Вы управляете своими данными",
          } as Record<string, string>
        )[section]
      }
    >
      <State
        loading={r.loading}
        error={error ?? r.error}
        onRetry={() => void r.load()}
      />
      {section === "invite" ? (
        <>
          <View
            style={[design.card, { backgroundColor: colors.text, gap: 18 }]}
          >
            <Icon name="gift" color={colors.lime} size={34} />
            <Text style={[design.heading, { color: "white", fontSize: 25 }]}>
              Вместе к полезным привычкам.
            </Text>
            <Text style={{ color: "#c1d1c5", lineHeight: 22 }}>
              Пригласите {goal} друзей за календарный месяц и получите месяц
              подписки.
            </Text>
          </View>
          <Panel title="Ваш прогресс за месяц">
            <Text style={design.metric}>
              {progress} <Text style={design.subtitle}>из {goal}</Text>
            </Text>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.soft,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 8,
                  backgroundColor: colors.accent,
                  width: `${Math.min(100, (progress / Math.max(1, goal)) * 100)}%`,
                }}
              />
            </View>
            <Text style={design.subtitle}>
              {settings?.referral_rewarded_this_month
                ? "Подарочная подписка за этот месяц уже начислена. В новом месяце начнём снова."
                : "Друг засчитается, когда заполнит профиль и отправит первый анализ."}
            </Text>
            <SecondaryButton
              label="Поделиться приглашением"
              disabled={!settings?.referral_url}
              onPress={() => void shareInvite()}
            />
          </Panel>
        </>
      ) : null}
      {section === "guide" ? (
        <>
          <Panel title="Записывайте в чате">
            <Text style={design.subtitle}>
              Отправьте фото еды, голос или текст. Тарелка посчитает калории и
              БЖУ, запишет воду или учтёт активность. Нажмите на запись, чтобы
              открыть подробный анализ. Кнопка «Уточнить» помогает исправить
              состав или порцию.
            </Text>
          </Panel>
          <Panel title="Следите за днём и динамикой">
            <Text style={design.subtitle}>
              В дневнике раздел «Сегодня» показывает питание, воду и активность
              за выбранный день. «Статистика» помогает посмотреть изменения за
              период.
            </Text>
          </Panel>
          <Panel title="Повторяйте привычные блюда">
            <Text style={design.subtitle}>
              Сохраните запись в избранное через звёздочку. Нажмите на карточку
              в избранном, чтобы открыть анализ, или на плюс, чтобы добавить
              запись на сегодня.
            </Text>
          </Panel>
          <Panel title="Настройте под себя">
            <Row
              label="Мой профиль"
              hint="Личные данные, цель и дневная норма питания"
              onPress={() => router.replace("/profile")}
            />
          </Panel>
        </>
      ) : null}
      {section === "help" ? (
        <>
          <Panel title="Начать легко">
            <Row
              label="Как пользоваться Тарелкой"
              hint="Фото, голос, дневник и избранное"
              onPress={() => setHelpOpen(!helpOpen)}
            />
            {helpOpen ? (
              <Text style={design.subtitle}>
                Отправьте фото, голос или текст — Тарелка посчитает калории и
                БЖУ или учтёт активность. Дневник показывает баланс дня,
                статистика — изменения за выбранный период, избранное помогает
                повторять блюда. Норма калорий настраивается в отдельном экране
                «Мой профиль» в меню аккаунта. Начинать можно сразу: стартовая
                норма — 2000 ккал.
              </Text>
            ) : null}
          </Panel>
        </>
      ) : null}
      {section === "help" || section === "feedback" ? (
        <>
          {settings?.feedback_url || settings?.channel_url || settings?.support_email ? (
          <Panel title="Связаться с нами">
            {settings?.feedback_url ? (
              <Row
                label="Чат поддержки"
                onPress={() => void Linking.openURL(settings.feedback_url!)}
              />
            ) : null}
            {settings?.channel_url ? (
              <Row
                label="Канал Тарелки"
                hint="Новости и советы"
                onPress={() => void Linking.openURL(settings.channel_url!)}
              />
            ) : null}
            {settings?.support_email ? (
              <Row
                label="Оплата и возвраты"
                hint={settings.support_email}
                onPress={() =>
                  void Linking.openURL(`mailto:${settings.support_email}`)
                }
              />
            ) : null}
          </Panel>
          ) : null}
          <FeedbackForm />
        </>
      ) : null}
      {section === "help" || section === "documents" ? (
          <Panel title="Документы">
            <Row
              label="Политика конфиденциальности"
              onPress={() => void Linking.openURL(`${SITE_URL}/privacy.html`)}
            />
            <Row
              label="Условия использования"
              onPress={() => void Linking.openURL(`${SITE_URL}/terms.html`)}
            />
          </Panel>
      ) : null}
      {section === "about" ? (
        <Panel title="Тарелка" subtitle="Дневник питания, воды и активности">
          <BrandMark size={56} />
          {Constants.expoConfig?.version ? (
            <Text style={design.subtitle}>Версия {Constants.expoConfig.version}</Text>
          ) : null}
          <Row label="Как пользоваться" onPress={() => router.replace("/settings/guide")} />
          <Row label="Написать нам" onPress={() => router.replace("/settings/feedback")} />
          <Row label="Документы" onPress={() => router.replace("/settings/documents")} />
        </Panel>
      ) : null}
      {section === "data" ? (
        <>
          <Panel
            title={settings?.auth_method === "email" ? "Аккаунт по email" : "Аккаунт Telegram"}
            subtitle={settings?.auth_method === "email"
              ? `${settings.email}. Самостоятельный дневник в приложении.`
              : "Общий с ботом профиль, записи и подписка."}
          >
            <Row
              label="Мой профиль"
              hint="Личные данные и цель питания"
              onPress={() => router.replace("/profile")}
            />
            <Row
              label="Конфиденциальность"
              hint="Какие данные хранятся и зачем"
              onPress={() => void Linking.openURL(`${SITE_URL}/privacy.html`)}
            />
          </Panel>
          <Panel
            title="Удаление данных"
            subtitle="Профиль и все записи будут удалены без возможности восстановления."
          >
            <Pressable
              accessibilityRole="button"
              disabled={deleting}
              onPress={confirmDelete}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: colors.danger, fontWeight: "600" }}>
                {deleting ? "Удаляем…" : "Удалить аккаунт и все данные"}
              </Text>
            </Pressable>
          </Panel>
        </>
      ) : null}
    </Screen>
  );
}
function Row({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[design.row, { minHeight: 56, paddingVertical: 8 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
          {label}
        </Text>
        {hint ? <Text style={design.subtitle}>{hint}</Text> : null}
      </View>
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}
