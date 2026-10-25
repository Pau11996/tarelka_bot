import { useState } from "react";
import { Text, Pressable } from "react-native";
import { Screen, Panel, State, design } from "../components/Screen";
import { useResource } from "../hooks/useResource";
import { useAuth } from "../auth";
import { api, apiFailureMessage } from "../api";
import { registerPush } from "../notifications";
import { colors } from "../theme";
import type { AccountSettings } from "../types";
export default function NotificationSettings() {
  const { token, signOut } = useAuth();
  const r = useResource<AccountSettings>("/v1/settings");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function choose(channel: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (channel === "app") await registerPush(token);
      await api("/v1/settings/channel", {
        token,
        method: "PUT",
        json: { channel },
      });
      await r.load();
    } catch (e) {
      setError(
        await apiFailureMessage(
          e,
          e instanceof Error ? e.message : "Не удалось изменить канал",
          signOut,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      back
      backTo="/account"
      title="Уведомления"
      subtitle={r.data?.telegram_connected ? "Выберите удобный канал напоминаний" : "Напоминания в приложении"}
    >
      <State
        loading={busy || r.loading}
        error={error ?? r.error}
        onRetry={() => void r.load()}
      />
      <Panel>
        {[
          {
            key: "app",
            label: "На телефон",
            text: "Разбор недели и напоминания в приложении",
          },
          {
            key: "telegram",
            label: "В Telegram",
            text: "Сообщения от привычного бота",
          },
          {
            key: "off",
            label: "Выключить",
            text: "Открывайте дневник и разбор в удобное время",
          },
        ].filter((c) => c.key !== "telegram" || r.data?.telegram_connected).map((c) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{
              checked: r.data?.notification_channel === c.key,
              disabled: busy,
            }}
            disabled={busy}
            key={c.key}
            onPress={() => void choose(c.key)}
            style={[
              design.card,
              {
                backgroundColor:
                  r.data?.notification_channel === c.key
                    ? colors.soft
                    : colors.surface,
              },
            ]}
          >
            <Text style={design.heading}>
              {r.data?.notification_channel === c.key ? "●" : "○"} {c.label}
            </Text>
            <Text style={design.subtitle}>{c.text}</Text>
          </Pressable>
        ))}
      </Panel>
    </Screen>
  );
}
