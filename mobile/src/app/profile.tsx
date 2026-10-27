import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  type KeyboardTypeOptions, type TextInputInstance, useWindowDimensions, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { api, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { BrandMark, Icon, type IconName } from "../components/Brand";
import { State } from "../components/Screen";
import { TransientNotice } from "../components/TransientNotice";
import { ProfileLeaveDialog } from "../components/ProfileLeaveDialog";
import { useResource } from "../hooks/useResource";
import { useTransientNotice } from "../hooks/useTransientNotice";
import { colors } from "../theme";
import { dismissProfileSetup } from "../profileSetup";
import { calculateSetupTarget } from "../profileTarget";
import { parseWeight, weightDirection, weightNumber } from "../weightTracking";
import type { Profile } from "../types";

const goals: { value: NonNullable<Profile["goal"]>; label: string; full: string; icon: IconName }[] = [
  { value: "lose", label: "Снизить", full: "Снизить вес", icon: "trendDown" },
  { value: "maintain", label: "Поддержать", full: "Поддерживать вес", icon: "balance" },
  { value: "gain", label: "Набрать", full: "Набрать вес", icon: "trendUp" },
];
const activity: { value: NonNullable<Profile["activity_level"]>; label: string; hint: string }[] = [
  { value: "sedentary", label: "Минимальная", hint: "Преимущественно сидячий ритм" },
  { value: "light", label: "Лёгкая", hint: "Немного движения в течение дня" },
  { value: "moderate", label: "Умеренная", hint: "Регулярное движение и тренировки" },
  { value: "active", label: "Высокая", hint: "Много движения и тренировок" },
  { value: "very_active", label: "Очень высокая", hint: "Интенсивная физическая активность" },
];
const sexes = [{ value: "female", label: "Женский" }, { value: "male", label: "Мужской" }] as const;
const setupActivity = activity.map((option, index) => ({
  ...option,
  label: option.value === "moderate" ? "Средняя" : option.label,
  hint: ["Мало движения, сидячая работа", "Прогулки, тренировки 1–3 раза в неделю", "Тренировки 3–5 раз в неделю", "Активный день, тренировки 6–7 раз", "Физическая работа, интенсивные нагрузки"][index],
}));
type MetricSheet = "weight" | "height" | "age" | "desiredWeight";
type ProfileSheet = "sex" | "goal" | "activity" | "calories" | MetricSheet;
const metricSheets = {
  weight: { title: "Ваш вес", label: "Вес, кг", unit: "кг", placeholder: "72,5", keyboard: "decimal-pad" },
  height: { title: "Ваш рост", label: "Рост, см", unit: "см", placeholder: "174", keyboard: "decimal-pad" },
  age: { title: "Ваш возраст", label: "Возраст", unit: "лет", placeholder: "31", keyboard: "number-pad" },
  desiredWeight: { title: "Желаемый вес", label: "Желаемый вес, кг", unit: "кг", placeholder: "70", keyboard: "decimal-pad" },
} as const;

// Formatting alone (72,5 / 72.50) is not an unsaved change. Empty or invalid
// input remains distinct so leaving an unfinished field still asks for a choice.
function sameNumber(input: string, saved: number | null | undefined) {
  const text = input.trim().replace(",", ".");
  return text === "" ? saved == null : saved != null && Number(text) === saved;
}

export default function ProfileScreen() {
  const { token, signOut } = useAuth();
  const params = useLocalSearchParams<{ setup?: string; userId?: string }>();
  const setupUserId = Number(params.userId);
  const isSetup = params.setup === "1" && Number.isSafeInteger(setupUserId) && setupUserId > 0;
  const resource = useResource<Profile>("/v1/profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [calories, setCalories] = useState("");
  const [desiredWeight, setDesiredWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ProfileSheet | null>(null);
  const [calorieDraft, setCalorieDraft] = useState("");
  const [calorieError, setCalorieError] = useState<string | null>(null);
  const [metricDraft, setMetricDraft] = useState("");
  const [metricError, setMetricError] = useState<string | null>(null);
  const [savedProfile, setSavedProfile] = useState<Profile | null>(null);
  const [exitPrompt, setExitPrompt] = useState(false);
  const [exitApproved, setExitApproved] = useState(false);
  const pendingExit = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const account = useRef(token);
  account.current = token;
  const metricInput = useRef<TextInputInstance>(null);
  const notice = useTransientNotice();
  const saving = useRef(false);
  const leaving = useRef(false);
  const inset = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const compactSetup = windowHeight - inset.top - inset.bottom < 740;
  const metricSheet = sheet && sheet in metricSheets ? sheet as MetricSheet : null;
  const metricConfig = metricSheet ? metricSheets[metricSheet] : null;
  const hasUnsavedChanges = !!(profile && savedProfile && (
    !sameNumber(weight, savedProfile.weight_kg) || !sameNumber(height, savedProfile.height_cm) ||
    !sameNumber(age, savedProfile.age) || !sameNumber(calories, Math.round(savedProfile.daily_calorie_target)) ||
    profile.sex !== savedProfile.sex || profile.goal !== savedProfile.goal || profile.activity_level !== savedProfile.activity_level ||
    (isSetup && !sameNumber(desiredWeight, savedProfile.weight_goal?.target_weight_kg))
  ));
  const disableLeaveGuard = usePreventRemove(!!token && !isSetup && !exitApproved && (hasUnsavedChanges || busy), ({ repeat }) => requestLeave(repeat));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!resource.data || saving.current) return;
    const next = resource.data;
    // A foreground/focus refresh may update untouched values, but never the
    // user's edits. The separate input inside an open sheet is kept as well.
    setProfile(current => current && savedProfile ? {
      ...next,
      sex: current.sex !== savedProfile.sex ? current.sex : next.sex,
      goal: current.goal !== savedProfile.goal ? current.goal : next.goal,
      activity_level: current.activity_level !== savedProfile.activity_level ? current.activity_level : next.activity_level,
    } : next);
    setWeight(value => savedProfile && !sameNumber(value, savedProfile.weight_kg) ? value : next.weight_kg?.toString() ?? "");
    setHeight(value => savedProfile && !sameNumber(value, savedProfile.height_cm) ? value : next.height_cm?.toString() ?? "");
    setAge(value => savedProfile && !sameNumber(value, savedProfile.age) ? value : next.age?.toString() ?? "");
    setCalories(value => savedProfile && !sameNumber(value, Math.round(savedProfile.daily_calorie_target)) ? value : String(Math.round(next.daily_calorie_target)));
    setDesiredWeight(value => savedProfile && !sameNumber(value, savedProfile.weight_goal?.target_weight_kg) ? value : isSetup && next.weight_goal ? String(next.weight_goal.target_weight_kg) : "");
    setSavedProfile(next);
  }, [resource.data]);

  function acceptSavedProfile(next: Profile) {
    setProfile(next);
    setSavedProfile(next);
    setWeight(next.weight_kg?.toString() ?? "");
    setHeight(next.height_cm?.toString() ?? "");
    setAge(next.age?.toString() ?? "");
    setCalories(String(Math.round(next.daily_calorie_target)));
    setDesiredWeight(isSetup && next.weight_goal ? String(next.weight_goal.target_weight_kg) : "");
  }

  function requestLeave(action: () => void = () => router.dismissTo("/account")) {
    if (saving.current || leaving.current) return;
    if (!hasUnsavedChanges) { action(); return; }
    Keyboard.dismiss();
    pendingExit.current = action;
    setExitPrompt(true);
  }

  function continueEditing() {
    if (saving.current) return;
    pendingExit.current = null;
    setExitPrompt(false);
  }

  function completeExit() {
    if (leaving.current) return;
    const action = pendingExit.current;
    pendingExit.current = null;
    leaving.current = true;
    setExitApproved(true);
    setExitPrompt(false);
    disableLeaveGuard();
    action?.();
  }

  function change(update: () => void) {
    notice.clear();
    setError(null);
    update();
  }

  async function finishSetup() {
    if (leaving.current) return;
    leaving.current = true;
    Keyboard.dismiss();
    try {
      await dismissProfileSetup(setupUserId);
    } catch {
      // Storage may be unavailable; "later" must still open the diary.
    }
    router.replace("/(tabs)/chat");
  }

  async function save(exitAfterSave = false) {
    if (!profile || saving.current) return;
    saving.current = true;
    setBusy(true);
    notice.clear();
    setError(null);
    Keyboard.dismiss();
    try {
      const body: Record<string, string | number> = {};
      for (const [key, value] of Object.entries({ weight_kg: weight, height_cm: height, age })) {
        if (value.trim()) body[key] = Number(value.replace(",", "."));
      }
      if (Object.values(body).some(value => typeof value === "number" && (!Number.isFinite(value) || value <= 0))) {
        throw new Error("Укажите положительные числа в полях профиля.");
      }
      if (body.age !== undefined && (!Number.isInteger(body.age) || Number(body.age) > 120)) {
        throw new Error("Укажите возраст целым числом от 1 до 120.");
      }
      if (isSetup && setupTarget === null) {
        throw new Error("Заполните все поля или нажмите «Заполнить потом».");
      }
      if (isSetup && desiredWeight.trim()) {
        if (desiredTarget === null) throw new Error("Введите положительный желаемый вес не больше 1000 кг или оставьте поле пустым.");
        body.target_weight_kg = desiredTarget;
      }
      if (isSetup && setupTarget !== null) {
        body.daily_calorie_target = setupTarget;
      } else if (calories.trim() && calories !== String(Math.round(profile.daily_calorie_target))) {
        body.daily_calorie_target = Number(calories.replace(",", "."));
      }
      if (profile.sex) body.sex = profile.sex;
      if (effectiveGoal) body.goal = effectiveGoal;
      if (profile.activity_level) body.activity_level = profile.activity_level;
      const next = await api<Profile>("/v1/profile", { method: "PUT", token, json: body });
      if (!mounted.current || account.current !== token) return;
      resource.setData(next);
      acceptSavedProfile(next);
      if (isSetup && next.is_complete) await finishSetup();
      else if (exitAfterSave) completeExit();
      else notice.show(next.is_complete ? "Профиль сохранён" : "Сохранено. Заполните остальные поля профиля.");
    } catch (e) {
      if (!mounted.current || account.current !== token) return;
      const message = await apiFailureMessage(e, e instanceof Error ? e.message : "Не удалось сохранить профиль", signOut);
      if (mounted.current && account.current === token) setError(message);
    } finally {
      saving.current = false;
      if (mounted.current && account.current === token) setBusy(false);
    }
  }

  function openSheet(next: ProfileSheet) {
    Keyboard.dismiss();
    if (next === "calories") {
      setCalorieDraft(calories);
      setCalorieError(null);
    }
    if (next in metricSheets) {
      setMetricDraft({ weight, height, age, desiredWeight }[next as MetricSheet]);
      setMetricError(null);
    }
    setSheet(next);
  }

  function closeSheet() {
    Keyboard.dismiss();
    setSheet(null);
  }

  function applyMetric() {
    if (!metricSheet) return;
    const value = metricDraft.trim();
    const numeric = /^\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(",", ".")) : NaN;
    const parsed = metricSheet === "weight" || metricSheet === "desiredWeight" ? parseWeight(value) : Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    if (metricSheet === "age" && (parsed === null || !Number.isInteger(parsed) || parsed > 120)) {
      setMetricError("Укажите возраст целым числом от 1 до 120.");
      return;
    }
    if (parsed === null && !(metricSheet === "desiredWeight" && !value)) {
      setMetricError(metricSheet === "height" ? "Введите положительный рост в сантиметрах." : "Введите положительный вес не больше 1000 кг.");
      return;
    }
    change(() => {
      const next = parsed === null ? "" : String(parsed).replace(".", ",");
      ({ weight: setWeight, height: setHeight, age: setAge, desiredWeight: setDesiredWeight })[metricSheet](next);
    });
    closeSheet();
  }

  function applyCalories() {
    const value = Number(calorieDraft.trim().replace(",", "."));
    if (!Number.isFinite(value) || value < 500 || value > 10000) {
      setCalorieError("Укажите норму от 500 до 10 000 ккал.");
      return;
    }
    change(() => setCalories(String(value)));
    Keyboard.dismiss();
    setSheet(null);
  }

  const desiredTarget = parseWeight(desiredWeight);
  const draftWeight = parseWeight(weight);
  const effectiveGoal = isSetup && desiredTarget !== null && draftWeight !== null ? weightDirection(draftWeight, desiredTarget) : profile?.goal;
  const selectedActivity = activity.find(option => option.value === profile?.activity_level);
  const selectedSetupActivity = setupActivity.find(option => option.value === profile?.activity_level);
  const selectedGoal = goals.find(option => option.value === effectiveGoal);
  const selectedSex = sexes.find(option => option.value === profile?.sex);
  const target = Number(calories.replace(",", ".")) || profile?.daily_calorie_target || 0;
  const setupTarget = isSetup ? calculateSetupTarget({ weight, height, age, sex: profile?.sex ?? null, goal: effectiveGoal ?? null, activity_level: profile?.activity_level ?? null }) : null;
  const continueDisabled = busy || (isSetup && (setupTarget === null || (!!desiredWeight.trim() && desiredTarget === null)));

  return (
    <SafeAreaView style={[s.page, isSetup && s.setupPage]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={s.main} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}>
        {isSetup ? <View style={s.setupBrandRow}>
          <View style={s.setupBrand}><BrandMark size={27} /><Text style={s.setupBrandText}>тарелка</Text></View>
          <Text style={s.setupEyeline}>Знакомство</Text>
        </View> : <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Назад" disabled={busy} onPress={() => requestLeave()} style={s.back}>
            <Icon name="left" size={21} />
          </Pressable>
          <Text accessibilityRole="header" style={s.title}>Мой профиль</Text>
          <View style={s.headerAvatar} accessible={false}>
            <Icon name="profile" size={18} color="#4b7b68" />
          </View>
        </View>}
        <View style={s.main}>
          <ScrollView
            style={s.main}
            contentContainerStyle={[s.content, isSetup && s.setupContent]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {isSetup ? <View style={[s.setupHeading, compactSetup && s.setupHeadingCompact]}>
              <Text accessibilityRole="header" style={s.setupTitle}>Расскажите о себе</Text>
              <Text style={s.setupIntro}>Заполните анкету — рассчитаем вашу{"\n"}дневную норму калорий.</Text>
            </View> : null}
            <State loading={resource.loading && !profile} error={error ?? resource.error} onRetry={() => void resource.load()} />
            {profile && isSetup ? <>
              <View style={s.setupForm}>
                <SetupMetricRow label="Введите ваш вес" unit="кг" value={weight} onPress={() => openSheet("weight")} disabled={busy} compact={compactSetup} />
                <SetupMetricRow label="Введите ваш рост" unit="см" value={height} onPress={() => openSheet("height")} disabled={busy} compact={compactSetup} />
                <SetupMetricRow label="Укажите ваш возраст" unit="лет" value={age} onPress={() => openSheet("age")} disabled={busy} compact={compactSetup} />
                <SetupChoiceRow label="Выберите пол" value={selectedSex?.label} onPress={() => openSheet("sex")} disabled={busy} compact={compactSetup} />
                <SetupChoiceRow label="Выберите цель" value={selectedGoal?.value === "maintain" ? "Поддерживать" : selectedGoal?.full} onPress={() => openSheet("goal")} disabled={busy} compact={compactSetup} />
                <SetupMetricRow label="Желаемый вес" unit="кг" value={desiredWeight} onPress={() => openSheet("desiredWeight")} disabled={busy} compact={compactSetup} optional />
                <SetupChoiceRow label="Ваша активность" value={selectedSetupActivity?.label} onPress={() => openSheet("activity")} disabled={busy} compact={compactSetup} last />
              </View>
            </> : profile ? (
              <>
                <View style={s.hero}>
                  <View pointerEvents="none" style={s.heroRing} accessible={false} />
                  <View pointerEvents="none" style={[s.heroRing, s.heroRingInner]} accessible={false} />
                  <View style={s.heroTop}>
                    <View style={s.heroAvatar}>
                      <Icon name="profile" size={24} color="#4b7b68" />
                    </View>
                    <View style={s.heroCopy}>
                      <Text style={s.heroTitle}>Ваш ориентир на день</Text>
                      <Text style={s.heroHint}>{profile.is_complete ? "Текущая дневная норма" : "Стартовая норма · заполните профиль"}</Text>
                    </View>
                  </View>
                  <View style={s.targetRow}>
                    <View style={s.targetValue}>
                      <Text style={s.target}>{Math.round(target).toLocaleString("ru-RU")}</Text>
                      <Text style={s.targetUnit}>ккал / день</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Изменить дневную норму" disabled={busy} onPress={() => openSheet("calories")} style={({ pressed }) => [s.targetEdit, pressed && s.pressed]}>
                      <Icon name="edit" size={18} color="#4b7b68" />
                    </Pressable>
                  </View>
                  <View style={s.metrics}>
                    <MetricField label="Вес" unit="кг" accessibilityLabel="Вес, кг" value={weight} onChangeText={value => change(() => setWeight(value))} disabled={busy} />
                    <MetricField label="Рост" unit="см" accessibilityLabel="Рост, см" value={height} onChangeText={value => change(() => setHeight(value))} disabled={busy} divided />
                    <MetricField label="Возраст" unit="лет" accessibilityLabel="Возраст" value={age} onChangeText={value => change(() => setAge(value))} keyboardType="number-pad" disabled={busy} divided />
                  </View>
                </View>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push("/weight")} style={s.recordWeight}><Icon name="plus" size={15} color={colors.accentDark} /><Text style={s.recordWeightText}>Записать новое взвешивание</Text></Pressable>
                <View style={s.sexRow}>
                  <Text style={s.label}>Пол</Text>
                  <View accessibilityRole="radiogroup" accessibilityLabel="Пол" style={s.sexOptions}>
                    {([{ value: "female", label: "Женский" }, { value: "male", label: "Мужской" }] as const).map(option => (
                      <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: profile.sex === option.value, disabled: busy }} disabled={busy} onPress={() => change(() => setProfile({ ...profile, sex: option.value }))} style={[s.sexOption, profile.sex === option.value && s.sexSelected]}>
                        <Text style={[s.sexText, profile.sex === option.value && s.sexTextSelected]}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={s.section}>
                  <Text accessibilityRole="header" style={s.sectionTitle}>Ваша цель</Text>
                  {profile.weight_goal ? <Pressable accessibilityRole="button" accessibilityLabel="Изменить цель по весу" disabled={busy} onPress={() => router.push("/(tabs)/achievements?editGoal=1")} style={s.activity}>
                    <View style={s.activityCopy}><Text style={s.activityTitle}>{profile.weight_goal.direction_label} · {weightNumber(profile.weight_goal.target_weight_kg)} кг</Text><Text style={s.activityHint}>Управление целью в «Прогрессе»</Text></View><Icon name="chevron" size={15} color="#93a598" />
                  </Pressable> : <View accessibilityRole="radiogroup" accessibilityLabel="Цель питания" style={s.goalOptions}>
                    {goals.map(option => {
                      const selected = profile.goal === option.value;
                      return (
                        <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.full} accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} onPress={() => change(() => setProfile({ ...profile, goal: option.value }))} style={({ pressed }) => [s.goalOption, selected && s.goalSelected, pressed && s.pressed]}>
                          <Icon name={option.icon} size={21} color={selected ? "#477a60" : "#809487"} />
                          <Text style={[s.goalText, selected && s.goalTextSelected]}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>}
                </View>
                <View style={s.section}>
                  <Text accessibilityRole="header" style={s.sectionTitle}>Ритм жизни</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Выбрать физическую активность" accessibilityValue={{ text: selectedActivity?.label ?? "Не выбрана" }} disabled={busy} onPress={() => openSheet("activity")} style={({ pressed }) => [s.activity, pressed && s.pressed]}>
                    <View style={s.activityIcon}><Icon name="walk" size={21} color="#4b7b68" /></View>
                    <View style={s.activityCopy}>
                      <Text style={s.activityTitle}>{selectedActivity ? `${selectedActivity.label} активность` : "Выберите активность"}</Text>
                      <Text style={s.activityHint}>{selectedActivity?.hint ?? "Пять уровней на выбор"}</Text>
                    </View>
                    <Icon name="chevron" size={15} color="#93a598" />
                  </Pressable>
                </View>
              </>
            ) : null}
          </ScrollView>
          <TransientNotice message={notice.message} />
        </View>
        {profile || isSetup ? (
          <View style={[s.footer, isSetup && s.setupFooter]}>
            {!isSetup && hasUnsavedChanges ? <Text accessibilityLiveRegion="polite" style={s.unsaved}>Есть несохранённые изменения</Text> : null}
            {isSetup ? <View accessibilityLiveRegion="polite" accessibilityLabel="Рассчитанная дневная норма" style={s.setupResult}>
              <View style={s.setupResultHeading}>
                <Text style={s.setupResultLabel}>Ваша дневная норма</Text>
                {setupTarget !== null ? <Icon name="check" size={17} color="#6c9b7d" /> : null}
              </View>
              {setupTarget === null ? <Text style={s.setupResultHint}>Рассчитается после заполнения анкеты</Text> : <View style={s.setupResultValue}>
                <Text style={s.setupResultNumber}>{setupTarget.toLocaleString("ru-RU")}</Text>
                <Text style={s.targetUnit}>ккал / день</Text>
              </View>}
              {setupTarget !== null ? <Text style={s.setupResultHint}>Позже можно изменить в профиле</Text> : null}
            </View> : null}
            {profile ? <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: continueDisabled }} disabled={continueDisabled} onPress={() => void save()} style={({ pressed }) => [s.save, (pressed || busy) && s.pressed, continueDisabled && !busy && s.disabled]}>
              {busy ? <ActivityIndicator size="small" color="white" /> : !isSetup ? <Icon name="check" size={18} color="white" /> : null}
              <Text style={s.saveText}>{busy ? (isSetup ? "Продолжаем…" : "Сохраняем…") : isSetup ? "Продолжить" : "Сохранить изменения"}</Text>
              {isSetup && !busy ? <Icon name="arrowRight" size={16} color="white" /> : null}
            </Pressable> : null}
            {isSetup ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void finishSetup()} style={({ pressed }) => [s.setupSkip, pressed && s.pressed]}>
              <Text style={s.setupSkipText}>Заполнить потом</Text>
            </Pressable> : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <Modal visible={sheet !== null} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={closeSheet} onShow={() => { if (metricSheet) metricInput.current?.focus(); }}>
        <KeyboardAvoidingView style={s.sheetHost} behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Закрыть редактирование профиля" onPress={closeSheet} />
          <View accessibilityViewIsModal onAccessibilityEscape={closeSheet} style={[s.sheet, { maxHeight: windowHeight - inset.top - 16, paddingBottom: Math.max(inset.bottom, 20) }]}>
            <View style={s.handle} />
            <View style={s.sheetHeading}>
              <Text accessibilityRole="header" style={s.sheetTitle}>{metricConfig?.title ?? (sheet === "sex" ? "Выберите пол" : sheet === "goal" ? "Выберите цель" : sheet === "activity" ? "Физическая активность" : "Дневная норма")}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть панель профиля" onPress={closeSheet} style={s.sheetClose}>
                <Icon name="close" size={19} />
              </Pressable>
            </View>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetContent}>
              {metricConfig ? <>
                <View style={s.weightInputBox}>
                  <TextInput key={sheet} ref={metricInput} accessibilityLabel={metricConfig.label} autoFocus keyboardType={metricConfig.keyboard} selectTextOnFocus value={metricDraft} onChangeText={value => { setMetricDraft(value); setMetricError(null); }} maxLength={metricSheet === "age" ? 3 : 7} placeholder={metricConfig.placeholder} placeholderTextColor="#a0ae94" style={s.weightSheetInput} onSubmitEditing={applyMetric} />
                  <Text style={s.weightSheetUnit}>{metricConfig.unit}</Text>
                </View>
                {metricError ? <Text accessibilityLiveRegion="polite" style={s.error}>{metricError}</Text> : null}
                <Pressable accessibilityRole="button" onPress={applyMetric} style={s.sheetApply}><Text style={s.saveText}>Готово</Text></Pressable>
              </> : null}
              {sheet === "sex" && profile ? <View accessibilityRole="radiogroup" accessibilityLabel="Пол" style={s.activityChoices}>
                {sexes.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: profile.sex === option.value }} onPress={() => { change(() => setProfile({ ...profile, sex: option.value })); setSheet(null); }} style={[s.activityChoice, profile.sex === option.value && s.goalSelected]}>
                  <Text style={[s.activityTitle, s.choiceTitle]}>{option.label}</Text>
                  {profile.sex === option.value ? <Icon name="check" size={18} color="#477a60" /> : null}
                </Pressable>)}
              </View> : null}
              {sheet === "goal" && profile ? <View accessibilityRole="radiogroup" accessibilityLabel="Цель питания" style={s.activityChoices}>
                {isSetup && desiredTarget !== null ? <Text style={s.activityHint}>Направление выбрано по желаемому весу. Измените или очистите это поле, чтобы выбрать другое направление.</Text> : null}
                {goals.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.full} accessibilityState={{ checked: effectiveGoal === option.value, disabled: isSetup && desiredTarget !== null }} disabled={isSetup && desiredTarget !== null} onPress={() => { change(() => setProfile({ ...profile, goal: option.value })); setSheet(null); }} style={[s.activityChoice, effectiveGoal === option.value && s.goalSelected]}>
                  <Text style={[s.activityTitle, s.choiceTitle]}>{option.full}</Text>
                  {effectiveGoal === option.value ? <Icon name="check" size={18} color="#477a60" /> : null}
                </Pressable>)}
              </View> : null}
              {sheet === "activity" && profile ? (
                <View accessibilityRole="radiogroup" accessibilityLabel="Физическая активность" style={s.activityChoices}>
                  {(isSetup ? setupActivity : activity).map(option => {
                    const selected = profile.activity_level === option.value;
                    return (
                      <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: selected }} onPress={() => { change(() => setProfile({ ...profile, activity_level: option.value })); setSheet(null); }} style={[s.activityChoice, selected && s.goalSelected]}>
                        <View style={s.activityCopy}><Text style={s.activityTitle}>{option.label}</Text><Text style={s.activityHint}>{option.hint}</Text></View>
                        {selected ? <Icon name="check" size={18} color="#477a60" /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {sheet === "calories" ? (
                <>
                  <Text style={s.calorieLabel}>Ваша норма, ккал</Text>
                  <TextInput accessibilityLabel="Дневная норма, ккал" keyboardType="number-pad" selectTextOnFocus value={calorieDraft} onChangeText={value => { setCalorieDraft(value); setCalorieError(null); }} style={s.calorieInput} />
                  {calorieError ? <Text accessibilityLiveRegion="polite" style={s.error}>{calorieError}</Text> : null}
                  <Pressable accessibilityRole="button" onPress={applyCalories} style={s.sheetApply}><Text style={s.saveText}>Готово</Text></Pressable>
                </>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {exitPrompt ? <ProfileLeaveDialog busy={busy} error={error} onSave={() => void save(true)} onContinue={continueEditing} onDiscard={() => { if (!saving.current) completeExit(); }} /> : null}
    </SafeAreaView>
  );
}

function SetupMetricRow({ label, unit, value, onPress, disabled, compact, optional }: {
  label: string; unit: string; value: string; onPress: () => void; disabled: boolean; compact: boolean; optional?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: value ? `${value} ${unit}` : "Не указано" }} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.setupRow, compact && s.setupRowCompact, pressed && s.pressed]}>
    <View style={s.setupQuestionGroup}><Text style={[s.setupQuestion, { flex: 0 }]}>{label}</Text>{optional ? <Text style={s.setupOptional}>Необязательно</Text> : null}</View>
    <View style={s.setupInputBox}><Text style={[s.setupInput, s.setupWeightValue, !value && s.setupWeightPlaceholder]}>{value || "—"}</Text><Text style={s.setupUnit}>{unit}</Text></View>
  </Pressable>;
}

function SetupChoiceRow({ label, value, onPress, disabled, compact, last }: {
  label: string; value?: string; onPress: () => void; disabled: boolean; compact: boolean; last?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: value ?? "Не выбрано" }} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.setupRow, compact && s.setupRowCompact, last && s.setupRowLast, pressed && s.pressed]}>
    <Text style={s.setupQuestion}>{label}</Text>
    <View style={s.setupChoiceValue}>
      <Text numberOfLines={1} style={[s.setupChoiceText, !!value && s.setupChoiceSelected]}>{value ?? "Выберите"}</Text>
      <Icon name="down" size={12} color="#96a987" />
    </View>
  </Pressable>;
}

function MetricField({ label, unit, accessibilityLabel, value, onChangeText, disabled, divided, keyboardType = "decimal-pad" }: {
  label: string; unit: string; accessibilityLabel: string; value: string;
  onChangeText: (value: string) => void; disabled: boolean; divided?: boolean; keyboardType?: KeyboardTypeOptions;
}) {
  return (
    <View style={[s.metric, divided && s.metricDivided]}>
      <Text style={s.metricLabel}>{label}</Text>
      <View style={s.metricValue}>
        <TextInput accessibilityLabel={accessibilityLabel} value={value} onChangeText={onChangeText} editable={!disabled} selectTextOnFocus keyboardType={keyboardType} placeholder="—" placeholderTextColor="#91aa9d" style={s.metricInput} />
        <Text style={s.metricUnit}>{unit}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1 },
  header: { width: "100%", maxWidth: 520, alignSelf: "center", minHeight: 68, paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: "white", alignItems: "center", justifyContent: "center", marginLeft: -4 },
  title: { flex: 1, fontSize: 25, lineHeight: 31, fontWeight: "700", letterSpacing: -0.7, color: colors.text },
  headerAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#e8f1eb", alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: 20, paddingTop: 2, paddingBottom: 20 },
  setupPage: { backgroundColor: "#f0f5ec" },
  setupBrandRow: { width: "100%", maxWidth: 520, alignSelf: "center", minHeight: 54, paddingHorizontal: 24, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  setupBrand: { flexDirection: "row", alignItems: "center", gap: 7 },
  setupBrandText: { fontSize: 18, fontWeight: "700", letterSpacing: -0.5, color: colors.text },
  setupEyeline: { fontSize: 10, color: "#84917d" },
  setupContent: { paddingHorizontal: 24, paddingTop: 0, paddingBottom: 16 },
  setupHeading: { paddingTop: 18, paddingBottom: 24, gap: 11 },
  setupHeadingCompact: { paddingTop: 9, paddingBottom: 18 },
  setupTitle: { fontSize: 28, lineHeight: 34, letterSpacing: -0.9, fontWeight: "700", color: colors.text },
  setupIntro: { fontSize: 12, lineHeight: 20, color: "#7d8a74" },
  setupForm: { backgroundColor: "white", borderWidth: 1, borderColor: "#e1e8db", borderRadius: 21, paddingHorizontal: 17, paddingVertical: 3 },
  setupRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 66, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#dfe6d7" },
  setupRowCompact: { minHeight: 57 },
  setupRowLast: { borderBottomWidth: 0 },
  setupQuestion: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18, color: "#4b5e45" },
  setupQuestionGroup: { flex: 1, minWidth: 0, gap: 3 },
  setupOptional: { fontSize: 9, lineHeight: 13, color: "#98a58e" },
  setupInputBox: { width: 78, minHeight: 42, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, borderWidth: 1, borderColor: "#e2e9da", borderRadius: 10, backgroundColor: "#f5f8f1" },
  setupInput: { flex: 1, minWidth: 0, minHeight: 42, padding: 0, fontSize: 17, lineHeight: 23, fontWeight: "500", color: "#45653b", textAlign: "right", includeFontPadding: false },
  setupWeightValue: { minHeight: 0 },
  setupWeightPlaceholder: { color: "#a0ae94" },
  setupUnit: { fontSize: 10, color: "#8d9b81" },
  setupChoiceValue: { maxWidth: 126, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 7 },
  setupChoiceText: { flexShrink: 1, fontSize: 11, lineHeight: 16, color: "#9ba991" },
  setupChoiceSelected: { color: "#4b6c3f", fontWeight: "500" },
  setupFooter: { paddingHorizontal: 24, paddingBottom: 0, backgroundColor: "#f0f5ec" },
  setupResult: { width: "100%", maxWidth: 472, alignSelf: "center", minHeight: 74, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: "white", borderWidth: 1, borderColor: "#dce6d3", marginBottom: 12, gap: 4 },
  setupResultHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  setupResultLabel: { fontSize: 11, lineHeight: 15, fontWeight: "500", color: "#5f816c" },
  setupResultValue: { flexDirection: "row", alignItems: "baseline", gap: 7 },
  setupResultNumber: { fontSize: 29, lineHeight: 34, fontWeight: "700", letterSpacing: -0.8, color: "#2c604a" },
  setupResultHint: { fontSize: 10, lineHeight: 15, color: "#799082" },
  setupSkip: { width: "100%", maxWidth: 480, alignSelf: "center", minHeight: 44, alignItems: "center", justifyContent: "center" },
  setupSkipText: { fontSize: 11, color: "#7e8e73" },
  hero: { backgroundColor: "#e5f0eb", borderColor: "#d0e4da", borderWidth: 1, borderRadius: 25, padding: 18, marginBottom: 18, overflow: "hidden" },
  heroRing: { position: "absolute", width: 190, height: 190, right: -84, top: -90, borderRadius: 95, borderWidth: 1, borderColor: "#ccdfd5" },
  heroRingInner: { width: 146, height: 146, right: -62, top: -68, borderRadius: 73 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  heroAvatar: { width: 39, height: 39, borderRadius: 13, backgroundColor: "#f8fcfa", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 4 },
  heroTitle: { fontSize: 14, lineHeight: 19, fontWeight: "600", color: "#284d3f" },
  heroHint: { fontSize: 11, lineHeight: 15, color: "#6f887c" },
  targetRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, marginBottom: 15 },
  targetValue: { flexDirection: "row", alignItems: "baseline", gap: 7, flexShrink: 1 },
  target: { fontSize: 37, lineHeight: 44, fontWeight: "700", letterSpacing: -1.3, color: "#2c604a" },
  targetUnit: { fontSize: 11, color: "#718b7c" },
  targetEdit: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  metrics: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#ccdfd4", paddingTop: 12 },
  metric: { flex: 1, minWidth: 0, paddingRight: 9 },
  metricDivided: { paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: "#ccdfd4" },
  metricLabel: { fontSize: 10, lineHeight: 14, color: "#6d887a" },
  metricValue: { flexDirection: "row", alignItems: "center", gap: 2 },
  metricInput: { flex: 1, minWidth: 0, minHeight: 38, fontSize: 23, lineHeight: 30, fontWeight: "600", color: "#284d3f", padding: 0, includeFontPadding: false },
  metricUnit: { fontSize: 10, color: "#718b7c" },
  sexRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18 },
  label: { fontSize: 12, color: colors.muted },
  sexOptions: { flexDirection: "row", padding: 3, gap: 2, borderRadius: 12, backgroundColor: "#e9efe7" },
  sexOption: { minHeight: 40, paddingHorizontal: 15, borderRadius: 9, justifyContent: "center", alignItems: "center" },
  sexSelected: { backgroundColor: "white", boxShadow: "0px 2px 4px #26462c08" },
  sexText: { fontSize: 12, lineHeight: 17, color: "#7c8977" },
  sexTextSelected: { color: colors.text, fontWeight: "600" },
  section: { gap: 9, marginBottom: 18 },
  sectionTitle: { fontSize: 14, lineHeight: 19, fontWeight: "600", color: colors.text, letterSpacing: -0.2 },
  goalOptions: { flexDirection: "row", gap: 8 },
  goalOption: { flex: 1, minWidth: 0, minHeight: 74, padding: 9, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: "white", alignItems: "center", justifyContent: "center", gap: 9 },
  goalSelected: { backgroundColor: "#e8f2eb", borderColor: "#a5c5b2" },
  goalText: { fontSize: 12, lineHeight: 17, color: "#627c6b", textAlign: "center" },
  goalTextSelected: { color: "#386b51", fontWeight: "600" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
  activity: { flexDirection: "row", alignItems: "center", gap: 11, padding: 12, minHeight: 60, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" },
  recordWeight: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: -9, marginBottom: 13 },
  recordWeightText: { fontSize: 12, color: colors.accentDark, fontWeight: "500" },
  activityIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#edf4ef", alignItems: "center", justifyContent: "center" },
  activityCopy: { flex: 1, gap: 4 },
  activityTitle: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.text },
  choiceTitle: { flex: 1 },
  activityHint: { fontSize: 11, lineHeight: 15, color: colors.muted },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: "#f8faf6" },
  unsaved: { fontSize: 12, lineHeight: 18, color: "#826028", textAlign: "center", marginBottom: 10 },
  save: { width: "100%", maxWidth: 480, alignSelf: "center", minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: colors.accent, borderRadius: 14 },
  saveText: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: "white", textAlign: "center" },
  sheetHost: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: "#182c2355" },
  sheet: { width: "100%", maxWidth: 460, flexShrink: 1, backgroundColor: "#f8faf6", borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  handle: { width: 35, height: 4, borderRadius: 4, backgroundColor: "#c7d2c4", alignSelf: "center", marginTop: 9, marginBottom: 10 },
  sheetHeading: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, marginBottom: 9 },
  sheetTitle: { flex: 1, fontSize: 19, lineHeight: 25, fontWeight: "600", color: colors.text, letterSpacing: -0.4 },
  sheetClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#e9efe7", alignItems: "center", justifyContent: "center" },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 4 },
  activityChoices: { gap: 7 },
  activityChoice: { minHeight: 59, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: "white" },
  calorieLabel: { fontSize: 12, lineHeight: 17, color: colors.muted, marginBottom: 8 },
  calorieInput: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: "white", color: colors.text, fontSize: 23 },
  weightInputBox: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: "white" },
  weightSheetInput: { flex: 1, minWidth: 0, minHeight: 64, paddingVertical: 12, fontSize: 30, lineHeight: 38, color: colors.accentDark },
  weightSheetUnit: { fontSize: 15, color: colors.muted },
  error: { fontSize: 12, lineHeight: 18, color: colors.danger, marginTop: 8 },
  sheetApply: { minHeight: 46, padding: 12, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.accent, marginTop: 18 },
});
