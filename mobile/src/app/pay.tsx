import { useState } from "react";
import { Text, View } from "react-native";
import { Screen, Panel, State, Segments, design } from "../components/Screen";
import { useResource } from "../hooks/useResource";
import { useAuth } from "../auth";
import { api, apiFailureMessage } from "../api";
import { PrimaryButton, SecondaryButton } from "../ui";
import { colors } from "../theme";
import type { Subscription } from "../types";
import { formatDay } from "../format";
const demo = process.env.EXPO_PUBLIC_DEMO_BILLING === "1";
export default function Pay() {
  const { token, signOut } = useAuth();
  const { data, error, loading, load } =
    useResource<Subscription>("/v1/subscription");
  const [stage, setStage] = useState<
    "offer" | "card" | "processing" | "success" | "declined"
  >("offer");
  const [outcome, setOutcome] = useState<"success" | "declined">("success");
  const [failure, setFailure] = useState<string | null>(null);
  async function checkout() {
    if (stage === "processing") return;
    setStage("processing");
    setFailure(null);
    try {
      const result = await api<{ status: "success" | "declined" }>(
        "/v1/billing/demo",
        { token, method: "POST", json: { outcome } },
      );
      setStage(result.status);
    } catch (e) {
      setFailure(
        await apiFailureMessage(
          e,
          "Не удалось выполнить демонстрацию",
          signOut,
        ),
      );
      setStage("card");
    }
  }
  return (
    <Screen
      back
      backTo="/account"
      title="Подписка"
      subtitle={
        data?.active
          ? `Активна до ${data.until ? formatDay(data.until) : "—"}`
          : "Больше понимания. Меньше рутины."
      }
    >
      <State
        loading={loading && !data}
        error={failure ?? error}
        onRetry={() => void load()}
      />
      {data ? <Panel title="Ваши запросы сегодня" subtitle="Использовано / доступно за день">
        {data.limit_mode === "split" ? data.used && data.limits ? (
          ([['photo', 'Фото'], ['voice', 'Голос'], ['text', 'Текст']] as const).map(([key, label]) => (
            <View key={key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>{data.used![key]} / {data.limits![key]}</Text>
            </View>
          ))
        ) : <Text style={design.subtitle}>Лимиты пока недоступны. Обновите экран.</Text> : (
          <Text style={{ color: colors.text, lineHeight: 22 }}>{data.requests_used_today} / {data.daily_limit} запросов · общий лимит для фото, голоса и текста</Text>
        )}
        {data.bonus_requests > 0 ? <Text style={design.subtitle}>Дополнительные запросы: {data.bonus_requests}</Text> : null}
      </Panel> : null}
      <Panel
        title="Ваш помощник в питании"
        subtitle="Один аккаунт и общая подписка в приложении и Telegram."
      >
        {[
          "ИИ-разбор недели · бета",
          "Подробная статистика БЖУ, воды и активности",
          "Периоды статистики до 90 дней",
          "Больше запросов для фото, голоса и текста",
        ].map((t) => (
          <Text key={t} style={{ color: colors.text, lineHeight: 26 }}>
            ✓ {t}
          </Text>
        ))}
      </Panel>
      {demo ? (
        <>
          <View
            style={[
              design.card,
              { backgroundColor: "#fff4d9", borderColor: "#f1deb1" },
            ]}
          >
            <Text style={{ fontWeight: "700", color: "#725514" }}>
              Демонстрационная оплата
            </Text>
            <Text style={{ color: "#725514", lineHeight: 21 }}>
              Деньги не списываются. Реальная подписка аккаунта не изменится.
            </Text>
          </View>
          {stage === "offer" ? (
            <PrimaryButton
              label="Попробовать оплату картой"
              onPress={() => setStage("card")}
            />
          ) : null}
          {stage === "card" || stage === "processing" ? (
            <Panel
              title="Тестовая карта"
              subtitle="Используем готовые тестовые данные. Настоящие реквизиты не нужны."
            >
              <View
                style={[design.card, { backgroundColor: colors.accentDark }]}
              >
                <Text
                  style={{ color: "white", fontSize: 22, letterSpacing: 2 }}
                >
                  4242 4242 4242 4242
                </Text>
                <Text style={{ color: "#d6e7d1" }}>12 / 30 TEST CARD</Text>
              </View>
              <Text style={design.subtitle}>Сценарий для проверки</Text>
              <Segments
                value={outcome}
                onChange={setOutcome}
                items={[
                  { value: "success", label: "Успех" },
                  { value: "declined", label: "Отказ" },
                ]}
              />
              <PrimaryButton
                disabled={stage === "processing"}
                label={
                  stage === "processing" ? "Обработка…" : "Проверить оплату"
                }
                onPress={() => void checkout()}
              />
            </Panel>
          ) : null}
          {stage === "success" ? (
            <Panel
              title="Демонстрация прошла успешно"
              subtitle="Деньги не списаны. Настоящая подписка не активирована."
            >
              <SecondaryButton
                label="Повторить демонстрацию"
                onPress={() => setStage("card")}
              />
            </Panel>
          ) : null}
          {stage === "declined" ? (
            <Panel
              title="Тестовый отказ банка"
              subtitle="В этом сценарии оплата отклонена. Попробуйте успешный сценарий."
            >
              <SecondaryButton
                label="Попробовать снова"
                onPress={() => setStage("card")}
              />
            </Panel>
          ) : null}
        </>
      ) : (
        <Panel
          title="Оплата в приложении пока недоступна"
          subtitle="Если подписка уже оформлена в Telegram, она действует и здесь."
        />
      )}
    </Screen>
  );
}
