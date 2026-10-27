import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { AccountMenu } from "../../components/AccountMenu";
import { Icon } from "../../components/Brand";
import { WeightProgressChart } from "../../components/WeightProgressChart";
import { WeightGoalProgress } from "../../components/WeightGoalProgress";
import { AchievementMedal, achievementTone } from "../../components/AchievementMedal";
import { State } from "../../components/Screen";
import { formatDay } from "../../format";
import { healthUpdated } from "../../health/events";
import { sourceName } from "../../health/math";
import { useResource } from "../../hooks/useResource";
import { achievementColors as c, colors } from "../../theme";
import { fullWeekdays, measurementLabel, parseWeight, weekdays, weightChangePeriod, weightDirection, weightGoalLabels, weightNumber } from "../../weightTracking";
import type { Achievement, Achievements, WeighReminder } from "../../types";

type Sheet = "goal" | "reminder" | "complete" | "cancel" | "history" | "awards";
const statuses = { completed: "Завершена", cancelled: "Отменена", replaced: "Изменена", active: "Активна" };
const sheetTitles: Record<Sheet, string> = { goal: "Желаемый вес", reminder: "Раз в неделю", complete: "Завершить цель?", cancel: "Отменить цель?", history: "История веса", awards: "Ваши награды" };
const shortBadgeTitles: Record<string, string> = { first_weigh_in: "Первый шаг", diary_7_days: "7 дней", diary_30_days: "30 дней", weight_4_weeks: "4 недели", weight_12_weeks: "12 недель", weight_goal_completed: "Цель достигнута" };

function AwardProgress({ item }: { item: Achievement }) {
  const tone = achievementTone(item.key);
  const progress = item.target > 0 ? Math.min(1, Math.max(0, item.progress / item.target)) : 0;
  return item.earned ? <View style={[s.awardEarned, { backgroundColor: tone.background }]}><Icon name="check" size={13} color={tone.ink} /><Text style={[s.awardEarnedText, { color: tone.ink }]}>Получено</Text></View>
    : <View style={s.awardProgress}>
      <View style={s.rowBetween}><Text style={s.awardProgressLabel}>Прогресс</Text><Text style={s.awardProgressValue}>{item.progress} / {item.target}</Text></View>
      <View accessibilityRole="progressbar" accessibilityLabel={item.title} accessibilityValue={{ min: 0, max: item.target, now: Math.min(item.target, Math.max(0, item.progress)) }} style={s.awardTrack}><View style={{ width: `${progress * 100}%`, height: "100%", backgroundColor: tone.ink, borderRadius: 3 }} /></View>
    </View>;
}

export default function AchievementsScreen() {
  const { token, signOut } = useAuth();
  const r = useResource<Achievements>("/v1/achievements");
  const params = useLocalSearchParams<{ editGoal?: string }>();
  const [sheet, setSheet] = useState<Sheet>("goal");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [snapshot, setSnapshot] = useState<{ weight: number | null; goalId: string | null }>({ weight: null, goalId: null });
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [actionGoalId, setActionGoalId] = useState<string | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [weekday, setWeekday] = useState(0);
  const [clock, setClock] = useState("09:00");
  const saving = useRef(false);
  const openedFromProfile = useRef(false);
  const inset = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const data = r.data;
  const goal = data?.goal;
  const parsedTarget = parseWeight(target);
  const unchangedGoal = goal?.id === snapshot.goalId && parsedTarget === goal?.target_weight_kg;
  const previewDirection = unchangedGoal && goal ? goal.direction : snapshot.weight !== null && parsedTarget !== null ? weightDirection(snapshot.weight, parsedTarget) : null;
  const previewStart = unchangedGoal && goal ? goal.start_weight_kg : snapshot.weight;

  function open(next: Sheet) {
    Keyboard.dismiss(); setError(null); setNeedsRefresh(false);
    if (next === "goal") {
      setTarget(data?.goal ? String(data.goal.target_weight_kg).replace(".", ",") : "");
      setSnapshot({ weight: data?.current_weight_kg ?? null, goalId: data?.goal?.id ?? null });
    }
    if (next === "reminder" && data) {
      setReminderEnabled(data.reminder.enabled); setWeekday(data.reminder.weekday); setClock(data.reminder.local_time);
    }
    if (next === "complete" || next === "cancel") setActionGoalId(data?.goal?.id ?? null);
    setSheet(next); setVisible(true);
  }
  function close() { if (!saving.current) { Keyboard.dismiss(); setVisible(false); } }
  useEffect(() => {
    if (params.editGoal === "1" && data && !openedFromProfile.current) {
      openedFromProfile.current = true; open("goal"); router.setParams({ editGoal: "" });
    } else if (params.editGoal !== "1") openedFromProfile.current = false;
  }, [params.editGoal, data]);

  async function mutate(path: string, method: string, json?: unknown) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try {
      const next = await api<Achievements>(path, { token, method, json });
      r.setData(next); setVisible(false); Keyboard.dismiss(); healthUpdated();
    } catch (cause) {
      setError(await apiFailureMessage(cause, "Не удалось сохранить изменение", signOut));
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 409) setNeedsRefresh(true);
    } finally { saving.current = false; setBusy(false); }
  }
  async function refreshSummary() {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const next = await api<Achievements>("/v1/achievements", { token });
      r.setData(next); setSnapshot({ weight: next.current_weight_kg, goalId: next.goal?.id ?? null });
      setNeedsRefresh(false); setError(null);
      if (sheet !== "goal") setVisible(false);
    } catch (cause) { setError(await apiFailureMessage(cause, "Не удалось обновить сводку", signOut)); }
    finally { saving.current = false; setBusy(false); }
  }
  async function saveReminder() {
    if (saving.current) return;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) { setError("Введите время в формате ЧЧ:ММ, например 09:00."); return; }
    if (reminderEnabled && !data?.reminder.delivery_ready && !data?.reminder.enabled) { setError(data?.reminder.unavailable_reason ?? "Настройте канал уведомлений."); return; }
    saving.current = true; setBusy(true); setError(null);
    try {
      const reminder = await api<WeighReminder>("/v1/settings/weigh-in-reminder", { token, method: "PUT", json: { enabled: reminderEnabled, weekday, local_time: clock } });
      r.setData(current => current ? { ...current, reminder } : current); setVisible(false); Keyboard.dismiss();
    } catch (cause) { setError(await apiFailureMessage(cause, "Не удалось сохранить расписание", signOut)); }
    finally { saving.current = false; setBusy(false); }
  }

  const history = data?.weight_history ?? [];
  const awards = data?.achievements ?? [];
  const earned = awards.filter(item => item.earned).length;
  const previewAwards = [...awards.filter(item => item.earned), ...awards.filter(item => !item.earned)].slice(0, 2);
  const informationSheet = sheet === "history" || sheet === "awards";
  const delta = goal?.change_kg;
  const deltaLabel = delta == null ? null : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${weightNumber(Math.abs(delta))} кг`;
  const deltaPeriod = goal ? weightChangePeriod(goal.started_at, data?.latest_measurement?.recorded_at ?? history.at(-1)?.recorded_at, data?.reminder.timezone) : null;
  return <SafeAreaView edges={["top"]} style={s.page}>
    <View style={s.header}><View style={s.heading}><Text accessibilityRole="header" style={s.title}>Прогресс</Text></View><AccountMenu compact /></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={r.loading && !!data} onRefresh={() => void r.load()} tintColor={c.green} />}>
      <State loading={!data && r.loading} error={r.error} onRetry={() => void r.load()} />
      {data ? <>
        {goal ? <>
          <View style={s.overview}>
            <Text style={s.currentCaption}>Текущий вес</Text>
            <View style={s.weightRow}>
              <Text accessibilityLabel={`Текущий вес: ${weightNumber(data.current_weight_kg)} кг`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={s.weight}>{weightNumber(data.current_weight_kg)}<Text style={s.weightUnit}> кг</Text></Text>
              <View style={s.weightAside}>
                <Pressable accessibilityRole="button" accessibilityLabel="Открыть историю веса" onPress={() => open("history")} style={s.historyAction}><Text style={s.link}>История</Text><Icon name="chevron" size={13} color={c.green} /></Pressable>
              </View>
            </View>
            {deltaLabel ? <View style={s.changeSummary} accessibilityLabel={`Изменение веса от начала цели: ${deltaLabel}, ${deltaPeriod}`}>
              <View style={s.delta}><Text style={s.deltaText}>{deltaLabel}</Text></View>
              <View style={s.changePeriod}><Text style={s.changeCaption}>С начала цели</Text><Text style={s.changeDates}>{deltaPeriod}</Text></View>
            </View> : null}
            <WeightProgressChart history={history} target={goal.target_weight_kg} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Изменить цель по весу" accessibilityValue={{ text: `Цель ${weightNumber(goal.target_weight_kg)} кг. ${goal.progress === null ? "Поддерживаем вес" : `${Math.round(goal.progress * 100)}% пути пройдено`}` }} onPress={() => open("goal")} style={s.goalSummary}>
            <View style={s.flex}>
              <View style={s.goalHeading}><Text style={s.eyebrow}>{goal.progress === null ? "ПОДДЕРЖИВАЕМ ВЕС" : "ВАША ЦЕЛЬ"}</Text><Icon name="edit" size={15} color={c.green} /></View>
              <Text style={s.goalWeight}>{weightNumber(goal.target_weight_kg)}<Text style={s.goalUnit}> кг</Text></Text>
              <Text style={s.goalDetail}>{goal.reached ? "Цель достигнута!" : goal.progress === null ? `Отклонение от ориентира: ${weightNumber(goal.remaining_kg)} кг` : `Ещё ${weightNumber(goal.remaining_kg)} кг до цели`}</Text>
              <Text style={s.hint}>Старт {weightNumber(goal.start_weight_kg)} кг</Text>
            </View>
            {goal.progress !== null ? <WeightGoalProgress progress={goal.progress} /> : <Icon name="balance" size={30} color={c.green} />}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => goal.reached ? open("complete") : router.push("/weight")} style={s.primary}><Icon name={goal.reached ? "check" : "plus"} color={c.white} size={18} /><Text style={s.primaryText}>{goal.reached ? "Завершить цель" : "Записать вес"}</Text></Pressable>
          {goal.reached ? <Pressable accessibilityRole="button" onPress={() => router.push("/weight")} style={s.secondary}><Text style={s.secondaryText}>Продолжить наблюдение · записать вес</Text></Pressable> : null}
        </> : <View style={s.goalCard}>
          <View style={s.rowBetween}><Text style={s.eyebrow}>ЦЕЛЬ ПО ВЕСУ</Text><View style={s.smallIcon}><Icon name="trophy" size={19} color={c.green} /></View></View>
          <Text style={s.emptyTitle}>К какому весу идём?</Text><Text style={s.hint}>Укажите желаемый вес и наблюдайте за своим прогрессом. Цель можно добавить в любой момент.</Text>
          <Text style={s.currentWeight}>Сейчас: {weightNumber(data.current_weight_kg)} кг</Text>
          <Pressable accessibilityRole="button" onPress={() => open("goal")} style={s.primary}><Text style={s.primaryText}>Указать желаемый вес</Text><Icon name="arrowRight" size={16} color={c.white} /></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/weight")} style={s.secondary}><Text style={s.secondaryText}>Записать вес</Text></Pressable>
        </View>}

        <View style={s.awardsSection}>
          <View style={s.rowBetween}><Text accessibilityRole="header" style={s.sectionTitle}>Награды</Text><Pressable accessibilityRole="button" accessibilityLabel={`Все награды. Получено ${earned} из ${awards.length}`} onPress={() => open("awards")} style={s.historyAction}><Text style={s.link}>{earned} из {awards.length}</Text><Icon name="chevron" size={13} color={c.green} /></Pressable></View>
          <View style={s.badgePreviews}>{previewAwards.map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.earned ? "Получено" : `${item.progress} из ${item.target}`}. Открыть все награды`} onPress={() => open("awards")} style={({ pressed }) => [s.badgePreview, item.earned && { borderColor: achievementTone(item.key).border }, pressed && s.badgePressed]}>
            <View style={s.badgePreviewHeading}><AchievementMedal badgeKey={item.key} earned={item.earned} size={48} /><Text style={s.badgePreviewTitle}>{shortBadgeTitles[item.key] ?? item.title}</Text></View>
            <View style={s.awardFooter}><AwardProgress item={item} /></View>
          </Pressable>)}</View>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Настроить напоминание о взвешивании" onPress={() => open("reminder")} style={s.reminderCard}>
          <View style={s.bell}><Icon name="bell" size={18} color={c.green} /></View><View style={s.flex}><Text style={s.cardTitle}>Взвешивание раз в неделю</Text><Text style={s.hint}>{data.reminder.effective_enabled ? `${fullWeekdays[data.reminder.weekday]}, ${data.reminder.local_time}` : data.reminder.enabled ? "Доставка приостановлена · проверьте уведомления" : "Напоминание выключено"}</Text></View><Icon name="chevron" size={15} color={c.muted} />
        </Pressable>

        {!goal ? <View style={s.overview}><View style={s.rowBetween}><Text style={s.sectionTitle}>История веса</Text><Pressable accessibilityRole="button" accessibilityLabel="Открыть историю веса" onPress={() => open("history")} style={s.historyAction}><Text style={s.link}>{measurementLabel(history.length)}</Text><Icon name="chevron" size={13} color={c.green} /></Pressable></View><WeightProgressChart history={history} /></View> : null}
        {data.goal_history.length ? <Pressable accessibilityRole="button" onPress={() => open("history")} style={s.previousGoals}><Text style={s.link}>Предыдущие цели · {data.goal_history.length}</Text><Icon name="chevron" size={14} color={c.green} /></Pressable> : null}
      </> : null}
    </ScrollView>

    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть настройки прогресса" onPress={close} disabled={busy} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal onAccessibilityEscape={close} style={[s.sheet, { maxHeight: height - inset.top - 20, paddingBottom: Math.max(inset.bottom, 18) }]}>
          <View style={s.handle} /><View style={s.sheetHeading}><Text accessibilityRole="header" style={s.sheetTitle}>{sheetTitles[sheet]}</Text><Pressable accessibilityRole="button" accessibilityLabel="Закрыть панель прогресса" disabled={busy} onPress={close} style={s.close}><Icon name="close" size={18} /></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.sheetContent}>
            {sheet === "goal" ? <>
              {snapshot.weight === null ? <><Text style={s.hint}>Сначала запишите текущий вес. Он станет стартом вашей цели.</Text><Pressable accessibilityRole="button" onPress={() => { close(); router.push("/weight"); }} style={s.primary}><Text style={s.primaryText}>Записать текущий вес</Text></Pressable></> : <>
                <Text style={s.hint}>Сейчас: {weightNumber(snapshot.weight)} кг. Укажите желаемый вес без срока достижения.</Text>
                <View style={s.targetInputRow}><TextInput accessibilityLabel="Желаемый вес, кг" value={target} onChangeText={value => { setTarget(value); setError(null); }} keyboardType="decimal-pad" maxLength={7} editable={!busy} placeholder="Например, 70" placeholderTextColor={c.muted} style={s.targetInput} /><Text style={s.targetUnit}>кг</Text></View>
                {previewDirection ? <View style={s.preview}><Text style={s.previewTitle}>{weightGoalLabels[previewDirection]}</Text><Text style={s.hint}>{weightNumber(previewStart)} → {weightNumber(parsedTarget)} кг</Text></View> : null}
                <Text style={s.hint}>Норма калорий останется прежней.{unchangedGoal ? " Желаемый вес не изменён — старт и направление цели сохранятся." : snapshot.goalId ? " Предыдущая цель сохранится в истории, новая начнётся от текущего веса." : ""}</Text>
                {goal ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => open("cancel")} style={s.cancelAction}><Text style={s.subtleLink}>Отменить текущую цель</Text></Pressable> : null}
              </>}
            </> : sheet === "reminder" && data ? <>
              <View style={s.rowBetween}><View style={s.flex}><Text style={s.cardTitle}>Напоминать о взвешивании</Text><Text style={s.hint}>По желанию, независимо от цели</Text></View><Switch accessibilityLabel="Напоминать о взвешивании" value={reminderEnabled} onValueChange={setReminderEnabled} disabled={busy} trackColor={{ false: c.line, true: c.green }} thumbColor={c.white} /></View>
              <Text style={s.fieldLabel}>День недели</Text><View accessibilityRole="radiogroup" accessibilityLabel="День напоминания" style={s.weekdays}>{weekdays.map((day, index) => <Pressable key={day} accessibilityRole="radio" accessibilityLabel={fullWeekdays[index]} accessibilityState={{ checked: weekday === index }} disabled={busy} onPress={() => setWeekday(index)} style={[s.weekday, weekday === index && s.weekdaySelected]}><Text style={[s.weekdayText, weekday === index && s.weekdayTextSelected]}>{day}</Text></Pressable>)}</View>
              <View style={s.rowBetween}><Text style={s.cardTitle}>Время</Text><TextInput accessibilityLabel="Время напоминания" value={clock} onChangeText={setClock} editable={!busy} maxLength={5} placeholder="09:00" style={s.timeInput} /></View>
              <Text style={s.hint}>Часовой пояс: {data.reminder.timezone}. Канал: {data.reminder.channel === "telegram" ? "Telegram" : data.reminder.channel === "app" ? "телефон" : "выключен"}.</Text>
              <Text style={s.hint}>Если на этой неделе уже есть измерение, напоминание пропустим.</Text>
              {!data.reminder.delivery_ready ? <View style={s.notice}><Text style={s.hint}>{data.reminder.unavailable_reason}</Text><Pressable accessibilityRole="button" onPress={() => { close(); router.push("/notifications"); }} style={s.textAction}><Text style={s.link}>Настроить уведомления</Text></Pressable></View> : null}
            </> : sheet === "history" && data ? <>
              <Text style={s.hint}>{measurementLabel(history.length)}. Ручные записи и Health Connect в одной истории.</Text>
              {history.length ? [...history].reverse().map(row => <View key={row.id} style={s.historyRow}><View style={s.flex}><Text style={s.historyDate}>{formatDay(row.local_date)}</Text><Text style={s.tiny}>{row.source === "health_connect" ? `Health Connect${row.origin ? ` · ${sourceName(row.origin)}` : ""}` : "Записано вручную"}</Text></View><Text style={s.historyValue}>{weightNumber(row.weight_kg)} кг</Text></View>) : <Text style={s.hint}>Измерений пока нет. Начните с записи текущего веса.</Text>}
              {data.goal_history.length ? <View style={s.pastGoals}><Text style={s.cardTitle}>Предыдущие цели</Text>{data.goal_history.map(item => <View key={item.id} style={s.rowBetween}><Text style={s.hint}>{weightNumber(item.start_weight_kg)} → {weightNumber(item.target_weight_kg)} кг</Text><Text style={s.tiny}>{statuses[item.status]}</Text></View>)}</View> : null}
            </> : sheet === "awards" ? <>
              <View style={s.awardsSummary}><Text style={s.awardsCount}>Получено {earned} из {awards.length}</Text><Text style={s.badgeDescription}>Награды остаются с вами после прерывания серии.</Text></View>
              <View style={s.badges}>{awards.map(item => <View key={item.key} accessible accessibilityLabel={`${item.title}. ${item.description}. ${item.earned ? "Получено" : `${item.progress} из ${item.target}`}`} style={[s.badge, item.earned && { borderColor: achievementTone(item.key).border }]}>
                <AchievementMedal badgeKey={item.key} earned={item.earned} /><Text style={s.badgeTitle}>{item.title}</Text><Text style={s.badgeDescription}>{item.description}</Text><View style={s.awardFooter}><AwardProgress item={item} /></View>
              </View>)}</View>
            </> : <Text style={s.hint}>{sheet === "complete" ? "Цель сохранится в истории и появится награда. Норма калорий останется прежней." : "Все измерения и история сохранятся. Новую цель можно задать позже."}</Text>}
            {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
            {needsRefresh ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void refreshSummary()} style={s.secondary}><Text style={s.secondaryText}>Обновить сводку</Text></Pressable> : null}
            {!informationSheet && (sheet !== "goal" || snapshot.weight !== null) ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || (sheet === "goal" && (parsedTarget === null || needsRefresh)), busy }} disabled={busy || (sheet === "goal" && (parsedTarget === null || needsRefresh))} onPress={() => {
              if (sheet === "goal") void mutate("/v1/weight-goal", "PUT", { target_weight_kg: parsedTarget, expected_goal_id: snapshot.goalId, expected_weight_kg: snapshot.weight });
              else if (sheet === "reminder") void saveReminder();
              else if (actionGoalId && sheet === "complete") void mutate("/v1/weight-goal/complete", "POST", { goal_id: actionGoalId });
              else if (actionGoalId && sheet === "cancel") void mutate(`/v1/weight-goal?goal_id=${actionGoalId}`, "DELETE");
            }} style={({ pressed }) => [s.primary, (busy || pressed || (sheet === "goal" && (parsedTarget === null || needsRefresh))) && s.dim]}>
              {busy ? <ActivityIndicator color={c.white} size="small" /> : null}<Text style={s.primaryText}>{busy ? "Сохраняем…" : sheet === "goal" ? "Подтвердить цель" : sheet === "reminder" ? "Сохранить расписание" : sheet === "complete" ? "Завершить цель" : "Отменить цель"}</Text>
            </Pressable> : null}
            <Pressable accessibilityRole="button" onPress={close} disabled={busy} style={s.cancelAction}><Text style={s.subtleLink}>{informationSheet ? "Готово" : sheet === "complete" ? "Продолжить наблюдение" : "Отмена"}</Text></Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background },
  header: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 18, flexDirection: "row", alignItems: "center", gap: 12 },
  heading: { flex: 1, minWidth: 0, gap: 6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.8, color: c.text },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 14, width: "100%", maxWidth: 600, alignSelf: "center" },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  overview: { gap: 8 },
  currentCaption: { color: c.muted, fontSize: 12, lineHeight: 18 },
  weightRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 80 },
  weight: { flex: 1, minWidth: 0, color: c.text, fontSize: 62, lineHeight: 80, fontWeight: "400", letterSpacing: -2.8 },
  weightUnit: { fontSize: 17, fontWeight: "400", letterSpacing: 0, color: c.muted },
  weightAside: { alignItems: "flex-end", paddingTop: 8 },
  delta: { minWidth: 86, paddingVertical: 7, paddingHorizontal: 15, borderRadius: 16, backgroundColor: c.mint, alignItems: "center" },
  deltaText: { color: c.green, fontSize: 12, fontWeight: "600" },
  changeSummary: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 },
  changePeriod: { gap: 2 },
  changeCaption: { color: c.muted, fontSize: 10, lineHeight: 14 },
  changeDates: { color: c.dark, fontSize: 11, lineHeight: 16 },
  historyAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  goalSummary: { minHeight: 140, borderRadius: 20, padding: 18, backgroundColor: c.mint, borderWidth: 1, borderColor: c.line, flexDirection: "row", alignItems: "center", gap: 14 },
  goalHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  goalWeight: { color: c.dark, fontSize: 36, lineHeight: 43, fontWeight: "600", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  goalUnit: { color: c.green, fontSize: 18, fontWeight: "400", letterSpacing: 0 },
  goalDetail: { color: c.dark, fontSize: 12, lineHeight: 18, fontWeight: "500" },
  goalCard: { backgroundColor: c.mint, borderRadius: 24, padding: 18, gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: "600", letterSpacing: 1.1, color: c.green },
  smallIcon: { height: 32, width: 32, borderRadius: 11, backgroundColor: c.background, justifyContent: "center", alignItems: "center" },
  emptyTitle: { fontSize: 22, fontWeight: "600", lineHeight: 28, letterSpacing: -0.5, color: c.text },
  currentWeight: { fontSize: 15, fontWeight: "500", color: c.dark },
  hint: { color: c.muted, fontSize: 11, lineHeight: 18 },
  tiny: { color: c.muted, fontSize: 10, lineHeight: 16 },
  link: { color: c.green, fontSize: 11, fontWeight: "500" },
  subtleLink: { color: c.muted, fontSize: 12 },
  textAction: { minHeight: 44, justifyContent: "center" },
  cancelAction: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  primary: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 15, backgroundColor: c.green, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { color: c.white, fontSize: 12, lineHeight: 19, fontWeight: "600" },
  secondary: { minHeight: 44, backgroundColor: c.white, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 12, lineHeight: 18, fontWeight: "500", color: c.dark, textAlign: "center" },
  reminderCard: { minHeight: 60, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: c.white, flexDirection: "row", alignItems: "center", gap: 10 },
  bell: { height: 33, width: 33, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: c.mint },
  cardTitle: { fontSize: 12, lineHeight: 18, color: c.text, fontWeight: "500" },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: c.text, letterSpacing: -0.3 },
  awardsSection: { gap: 4 },
  badgePreviews: { flexDirection: "row", gap: 12 },
  badgePreview: { flex: 1, minWidth: 0, gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.white, borderWidth: 1, borderColor: c.line },
  badgePreviewHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  badgePreviewTitle: { flex: 1, minWidth: 72, fontSize: 14, lineHeight: 19, fontWeight: "600", color: c.text },
  badgePressed: { backgroundColor: "#f0f5ec", borderColor: c.green },
  previousGoals: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  historyRow: { minHeight: 53, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  historyDate: { fontSize: 12, color: c.text },
  historyValue: { fontSize: 15, fontWeight: "500", color: c.dark },
  pastGoals: { gap: 12, paddingTop: 10 },
  awardsSummary: { gap: 5, paddingBottom: 2 },
  awardsCount: { fontSize: 14, lineHeight: 20, color: c.dark, fontWeight: "600" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  badge: { flexBasis: "45%", flexGrow: 1, minWidth: 120, backgroundColor: c.white, borderWidth: 1, borderColor: c.line, borderRadius: 18, padding: 14, gap: 10 },
  badgeTitle: { fontSize: 14, lineHeight: 20, color: c.text, fontWeight: "600" },
  badgeDescription: { fontSize: 12, lineHeight: 18, color: colors.muted },
  awardFooter: { marginTop: "auto", paddingTop: 2 },
  awardEarned: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8 },
  awardEarnedText: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  awardProgress: { gap: 7 },
  awardProgressLabel: { fontSize: 11, lineHeight: 16, color: colors.muted },
  awardProgressValue: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: c.text, fontVariant: ["tabular-nums"] },
  awardTrack: { height: 5, borderRadius: 3, backgroundColor: "#e8ede4", overflow: "hidden" },
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: c.overlay },
  sheet: { width: "100%", maxWidth: 460, flexShrink: 1, backgroundColor: c.sheet, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: "hidden" },
  handle: { width: 35, height: 4, borderRadius: 4, backgroundColor: c.handle, alignSelf: "center", marginTop: 9, marginBottom: 9 },
  sheetHeading: { paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 9 },
  sheetTitle: { flex: 1, color: c.text, fontSize: 21, lineHeight: 27, fontWeight: "600", letterSpacing: -0.5 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.mint, alignItems: "center", justifyContent: "center" },
  sheetContent: { paddingHorizontal: 20, gap: 14 },
  targetInputRow: { flexDirection: "row", alignItems: "baseline", backgroundColor: c.white, borderWidth: 1, borderColor: c.line, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 9, gap: 10 },
  targetInput: { flex: 1, minWidth: 0, minHeight: 45, fontSize: 27, color: c.dark, padding: 0 },
  targetUnit: { color: c.muted, fontSize: 12 },
  preview: { padding: 13, borderRadius: 13, backgroundColor: c.mint, gap: 4 },
  previewTitle: { color: c.dark, fontSize: 13, fontWeight: "600" },
  fieldLabel: { color: c.muted, fontSize: 11 },
  weekdays: { flexDirection: "row", gap: 4 },
  weekday: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: c.background, alignItems: "center", justifyContent: "center" },
  weekdaySelected: { backgroundColor: c.mint },
  weekdayText: { fontSize: 11, color: c.muted },
  weekdayTextSelected: { color: c.dark, fontWeight: "600" },
  timeInput: { minHeight: 44, width: 90, borderRadius: 11, borderWidth: 1, borderColor: c.line, textAlign: "center", backgroundColor: c.white, fontSize: 17, color: c.dark, paddingHorizontal: 8 },
  notice: { padding: 12, borderRadius: 13, backgroundColor: c.mint, gap: 5 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 19 },
  dim: { opacity: 0.45 },
});
