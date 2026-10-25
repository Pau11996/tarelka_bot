import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { SITE_URL } from "../config";
import { Screen, Panel, State } from "../components/Screen";
import { PrimaryButton, SecondaryButton } from "../ui";
import { colors } from "../theme";
import { getHealthModule, healthAvailability, healthReader } from "../health/native";
import { installationId } from "../health/storage";
import { pauseHealthSync, requestHealthPermissions, stopHealthSync, syncHealth } from "../health/service";
import { healthUpdated, onHealthUpdate } from "../health/events";
import { sourceName } from "../health/math";
import { healthTypes, type HealthConnection, type HealthType } from "../health/types";

const labels: Record<HealthType, string> = { Steps: "Шаги", Distance: "Расстояние", ActiveCaloriesBurned: "Активные калории", ExerciseSession: "Тренировки", Weight: "Вес" };
type Availability = Awaited<ReturnType<typeof healthAvailability>>;
export default function HealthSettings() {
  const { token } = useAuth();
  const [connection, setConnection] = useState<HealthConnection | null>(null);
  const [availability, setAvailability] = useState<Availability>("unsupported");
  const [install, setInstall] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "erase" | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [config, status] = await Promise.all([api<HealthConnection>("/v1/health/connection", { token }), healthAvailability()]);
      setConnection(config); setAvailability(status);
      if (status === "available") {
        const id = await installationId(); setInstall(id);
        if (config.connected && config.installation_id === id && config.permissions.includes("ExerciseSession")) {
          const reader = await healthReader();
          if ((await reader.permissions()).includes("ExerciseSession")) {
            const windows = config.windows!;
            const records = await reader.records("ExerciseSession", windows[0].start_at, windows.at(-1)!.end_at);
            setSources([...new Set([...(config.workout_origin ? [config.workout_origin] : []), ...records.map(r => r.metadata?.dataOrigin).filter((value): value is string => !!value)])]);
          } else setSources([]);
        } else setSources([]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить подключение"); }
    finally { setLoading(false); }
  }, [token]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => onHealthUpdate(() => void load()), [load]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось обновить подключение"); }
    finally { await load(); setBusy(false); }
  };
  const connect = async (replace = false) => {
    if (!token) return;
    await pauseHealthSync();
    const permissions = await requestHealthPermissions([...healthTypes]);
    stopHealthSync();
    if (!permissions.length) throw new Error("Доступ не предоставлен. Выберите хотя бы один показатель в Health Connect.");
    await api("/v1/health/connection", { token, method: "PUT", json: { installation_id: await installationId(), permissions, workout_origin: connection?.workout_origin ?? null, replace_existing: replace } });
    setConfirm(null); await syncHealth(token, true);
  };
  const ownPhone = !!install && install === connection?.installation_id;
  const otherPhone = connection?.connected && availability === "available" && !ownPhone;
  return <Screen title="Устройства и здоровье" back backTo="/account" subtitle="Данные часов и фитнес-приложений через Health Connect на Android.">
    <State loading={loading} error={error} onRetry={() => void load()} />
    {connection?.available === false ? <Panel title="Подключение пока недоступно" subtitle="Интеграция ещё не включена на сервере." /> : null}
    <Panel title="Как это работает">
      <Text style={s.body}>Часы → приложение производителя → Health Connect → ТАРЕЛКА. Сначала разрешите приложению часов делиться данными с Health Connect.</Text>
      <Text style={s.body}>С вашего разрешения дневные итоги, тренировки, вес и источники сохраняются в вашем аккаунте на сервере для дневника и статистики. Эти данные не передаются AI-провайдерам и не используются для рекламы.</Text>
      <Text style={s.body}>Обновление — при открытии приложения и вручную. Калории устройств не увеличивают норму питания; вес не меняет профиль автоматически.</Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${SITE_URL}/privacy.html`)} style={s.linkButton}><Text style={s.link}>Политика конфиденциальности →</Text></Pressable>
    </Panel>
    {availability !== "available" ? <Panel title={availability === "install" ? "Установите или обновите Health Connect" : availability === "expo_go" || availability === "rebuild" ? "Нужна Android-сборка ТАРЕЛКИ" : "Нужен Android с Health Connect"} subtitle={availability === "expo_go" || availability === "rebuild" ? "Подключение часов работает в установленном приложении. Expo Go не содержит этот модуль." : "На этом устройстве Health Connect сейчас недоступен. Уже загруженная история останется в дневнике."}>
      {availability === "install" ? <SecondaryButton label="Открыть Google Play" onPress={() => void act(async () => { await Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata"); })} /> : null}
    </Panel> : null}
    {connection?.connected ? <Panel title={otherPhone ? "Подключён другой телефон" : connection.permissions.length ? "Health Connect подключён" : "Доступ к данным отозван"}>
      <Text style={s.body}>Последнее обновление: {connection.last_synced_at ? new Date(connection.last_synced_at).toLocaleString("ru-RU") : "ещё не было"}</Text>
      <Text style={s.body}>{connection.permissions.length ? connection.permissions.map(type => labels[type]).join(" · ") : "Разрешения отозваны. Откройте настройки доступа."}</Text>
      {ownPhone && availability === "available" ? <>
        <PrimaryButton label={busy ? "Обновляем…" : "Обновить данные"} disabled={busy || !connection.available} onPress={() => void act(async () => { await syncHealth(token!, true); })} />
        <SecondaryButton label="Настройки доступа в Health Connect" disabled={busy} onPress={() => void act(async () => { getHealthModule()!.openHealthConnectSettings(); })} />
        <SecondaryButton label="Запросить разрешения снова" disabled={busy} onPress={() => void act(() => connect())} />
        {connection.permissions.includes("ExerciseSession") ? <View style={s.sources}>
          <Text style={s.heading}>Источник тренировок</Text>
          <Text style={s.body}>{sources.length > 1 && !connection.workout_origin ? "Выберите один источник, чтобы одинаковые тренировки не учитывались дважды." : sources.length ? "Для тренировок используем один источник. Шаги учитываются по правилам Health Connect." : "После появления тренировок источник определится при обновлении."}</Text>
          {sources.map(origin => <Pressable key={origin} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: origin === connection.workout_origin, disabled: busy }} onPress={() => void act(async () => {
            await pauseHealthSync();
            await api("/v1/health/connection", { token, method: "PUT", json: { installation_id: install, permissions: connection.permissions, workout_origin: origin } });
            await syncHealth(token!, true);
          })} style={[s.source, origin === connection.workout_origin && s.selected]}><Text style={s.heading}>{origin === connection.workout_origin ? "● " : "○ "}{sourceName(origin)}</Text></Pressable>)}
        </View> : null}
      </> : null}
      {otherPhone ? <SecondaryButton label="Использовать этот телефон" disabled={busy} onPress={() => setConfirm("replace")} /> : null}
      <SecondaryButton label="Отключить синхронизацию" disabled={busy || !connection.available} onPress={() => void act(async () => {
        await pauseHealthSync(); await api("/v1/health/connection", { token, method: "DELETE" }); healthUpdated();
      })} />
      <Text style={s.small}>Отключение сохранит импортированную историю. Разрешения Android можно отозвать отдельно в Health Connect.</Text>
    </Panel> : availability === "available" && connection?.available ? <PrimaryButton label={busy ? "Подключаем…" : "Разрешить доступ и подключить"} disabled={busy} onPress={() => void act(() => connect())} /> : null}
    {confirm === "replace" ? <Panel title="Подключить этот телефон?" subtitle="Предыдущий телефон перестанет загружать данные. История сохранится; последние 30 дней будут сверены с этим устройством."><PrimaryButton label="Подключить этот телефон" disabled={busy} onPress={() => void act(() => connect(true))} /><SecondaryButton label="Отмена" onPress={() => setConfirm(null)} disabled={busy} /></Panel> : null}
    {connection?.connection_id && connection.available ? <>
      <Pressable disabled={busy} accessibilityRole="button" onPress={() => setConfirm("erase")} style={s.linkButton}><Text style={s.danger}>Удалить данные устройств из ТАРЕЛКИ</Text></Pressable>
      {confirm === "erase" ? <Panel title="Удалить импортированную историю?" subtitle="Удалятся итоги устройств, тренировки и измерения веса из Health Connect в этом аккаунте. Ручные записи и оригиналы в Health Connect сохранятся. Синхронизация отключится."><PrimaryButton label="Удалить импортированные данные" disabled={busy} onPress={() => void act(async () => {
        await pauseHealthSync(); await api("/v1/health/data", { token, method: "DELETE" }); setConfirm(null); healthUpdated();
      })} /><SecondaryButton label="Отмена" disabled={busy} onPress={() => setConfirm(null)} /></Panel> : null}
    </> : null}
  </Screen>;
}
const s = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20, color: colors.muted }, small: { fontSize: 11, lineHeight: 17, color: colors.muted },
  heading: { fontSize: 14, fontWeight: "600", color: colors.text }, link: { fontSize: 13, color: colors.accentDark },
  linkButton: { minHeight: 44, justifyContent: "center" }, danger: { color: colors.danger, fontSize: 13 },
  sources: { gap: 10, paddingVertical: 10 }, source: { minHeight: 46, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }, selected: { borderColor: colors.accent, backgroundColor: colors.soft },
});
