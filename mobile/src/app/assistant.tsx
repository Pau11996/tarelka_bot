import { useEffect, useRef, useState } from "react";
import { Text, View, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Screen, Panel, State, design } from "../components/Screen";
import { Icon } from "../components/Brand";
import { AssistantAvatar } from "../components/AssistantAccess";
import { useResource } from "../hooks/useResource";
import { useAuth } from "../auth";
import { api, apiFailureMessage } from "../api";
import { requestKey, waitOperation, Operation } from "../operations";
import { colors } from "../theme";
import { PrimaryButton, SecondaryButton } from "../ui";
import { formatDay } from "../format";
import type { Subscription } from "../types";
type Review = {
  id: number;
  week_start: string;
  text: string;
  refresh_used: boolean;
  created_at: string;
  facts: Record<string, unknown>;
};
type History = {
  reviews: Review[];
  next_before: number | null;
  week_start: string;
  period_start: string;
  period_end: string;
  operation: Operation | null;
};
function plain(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}
export default function Assistant() {
  const { token, signOut } = useAuth();
  const sub = useResource<Subscription>("/v1/subscription");
  const history = useResource<History>("/v1/coach/reviews");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [selected, setSelected] = useState<Review | null>(null),
    [older, setOlder] = useState<Review[]>([]),
    [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const running = useRef(false);
  const key = useRef<string | null>(null);
  async function follow(op: Operation) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const done = await waitOperation(op, token);
      if (done.result?.review) setSelected(done.result.review);
      await history.load();
    } catch (e) {
      setError(
        await apiFailureMessage(
          e,
          e instanceof Error ? e.message : "Не удалось подготовить разбор",
          signOut,
        ),
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (history.data?.operation) void follow(history.data.operation);
  }, [history.data?.operation?.id]);
  async function generate(refresh = false) {
    if (running.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      key.current ??= requestKey();
      const op = await api<Operation>("/v1/coach/reviews", {
        token,
        method: "POST",
        json: { request_key: key.current, refresh },
      });
      key.current = null;
      await follow(op);
    } catch (e) {
      setError(await apiFailureMessage(e, "Не удалось начать разбор", signOut));
      setBusy(false);
    }
  }
  const current = history.data?.reviews.find(
    (r) => r.week_start === history.data?.week_start,
  );
  const report = selected;
  async function more() {
    const before = cursor === undefined ? history.data?.next_before : cursor;
    if (!before) return;
    try {
      const next = await api<History>(`/v1/coach/reviews?before=${before}`, {
        token,
      });
      setOlder((old) => [...old, ...next.reviews]);
      setCursor(next.next_before);
    } catch (e) {
      setError(
        await apiFailureMessage(e, "Не удалось загрузить историю", signOut),
      );
    }
  }
  return (
    <Screen
      back
      title="Ваш помощник"
      subtitle="Чуть больше понимания. Чуть меньше забот."
    >
      <View
        style={{
          backgroundColor: colors.text,
          borderRadius: 28,
          padding: 24,
          gap: 20,
        }}
      >
        <View style={design.row}>
          <View
            style={{
              width: 64,
              height: 64,
              backgroundColor: "#ffffff12",
              borderRadius: 23,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AssistantAvatar size={52} />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text
              style={{ color: colors.lime, fontSize: 12, fontWeight: "600" }}
            >
              ТАРЕЛКА · AI
            </Text>
            <Text style={{ color: "#c1d1c5", fontSize: 12 }}>
              Рядом на пути к привычкам
            </Text>
          </View>
        </View>
        <Text
          style={{
            color: "white",
            fontSize: 27,
            lineHeight: 33,
            fontWeight: "600",
            letterSpacing: -0.6,
          }}
        >
          Посмотрим, как прошла ваша неделя?
        </Text>
        <Text style={{ color: "#c1d1c5", fontSize: 14, lineHeight: 22 }}>
          Соберу записи о питании в понятный разбор: что получается и на что
          обратить внимание дальше.
        </Text>
        <View style={[design.row, { gap: 7 }]}>
          <Icon name="sparkles" color={colors.lime} size={16} />
          <Text style={{ color: colors.lime, fontSize: 11 }}>
            Разбор недели · часть подписки · бета
          </Text>
        </View>
      </View>
      {sub.data && !sub.data.active ? (
        <Panel
          title="Разбор доступен с подпиской"
          subtitle="Личный отчёт по записям о питании и вашей цели."
        >
          <PrimaryButton
            label="Посмотреть подписку"
            onPress={() => router.push("/pay")}
          />
        </Panel>
      ) : (
        <>
          <State
            loading={history.loading && !history.data}
            error={error ?? history.error}
            onRetry={() => void history.load()}
          />
          <Panel
            title="Ваша неделя"
            subtitle={
              history.data
                ? `${formatDay(history.data.period_start)} — ${formatDay(history.data.period_end)}`
                : "Последние 7 дней"
            }
          >
            {busy ? (
              <View style={design.row}>
                <ActivityIndicator color={colors.accent} />
                <Text style={[design.subtitle, { flex: 1 }]}>
                  Анализирую записи. Можно закрыть экран — отчёт останется в
                  истории.
                </Text>
              </View>
            ) : (
              <PrimaryButton
                label={current ? "Открыть разбор" : "Разобрать неделю"}
                onPress={() =>
                  current ? setSelected(current) : void generate()
                }
              />
            )}
          </Panel>
          {report ? (
            <View style={{ gap: 12 }}>
              <Text style={design.label}>
                Разбор · {formatDay(report.created_at)}
              </Text>
              {plain(report.text)
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((part, i) => (
                  <Panel
                    key={`${report.id}-${i}`}
                    title={
                      part.includes("\n") ? part.split("\n")[0] : undefined
                    }
                  >
                    <Text
                      selectable
                      style={{
                        fontSize: 16,
                        lineHeight: 25,
                        color: colors.text,
                      }}
                    >
                      {part.includes("\n")
                        ? part.split("\n").slice(1).join("\n")
                        : part}
                    </Text>
                  </Panel>
                ))}
              {report.week_start === history.data?.week_start &&
              !report.refresh_used ? (
                <SecondaryButton
                  label="Обновить разбор · 1 раз за неделю"
                  disabled={busy}
                  onPress={() => void generate(true)}
                />
              ) : null}
            </View>
          ) : null}
          {history.data?.reviews.length ? (
            <Panel title="История разборов">
              {[...history.data.reviews, ...older]
                .filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i)
                .map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    onPress={() => setSelected(r)}
                    style={[
                      design.row,
                      { minHeight: 48, justifyContent: "space-between" },
                    ]}
                  >
                    <Text style={{ color: colors.text }}>
                      Неделя от {formatDay(r.week_start)}
                    </Text>
                    <Text style={{ color: colors.accent }}>→</Text>
                  </Pressable>
                ))}
              {(cursor === undefined ? history.data.next_before : cursor) ? (
                <SecondaryButton label="Раньше" onPress={() => void more()} />
              ) : null}
            </Panel>
          ) : null}
        </>
      )}
    </Screen>
  );
}
