import { Text, View } from "react-native";
import { Screen, Panel, State, design } from "../components/Screen";
import { useResource } from "../hooks/useResource";
import { SubscriptionAvailability } from "../billing/SubscriptionAvailability";
import { colors } from "../theme";
import type { Subscription } from "../types";
import { formatDay } from "../format";
export default function Pay() {
  const { data, error, loading, load } =
    useResource<Subscription>("/v1/subscription");
  return (
    <Screen
      back
      backTo="/account"
      title="Подписка"
      subtitle={
        data?.active
          ? `Активна до ${data.until ? formatDay(data.until) : "—"}`
          : undefined
      }
    >
      <State
        loading={loading && !data}
        error={error}
        onRetry={() => void load()}
      />
      <SubscriptionAvailability />
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
    </Screen>
  );
}
