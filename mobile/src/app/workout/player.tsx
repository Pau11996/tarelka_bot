import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { SafeAreaView } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useAudioPlayer } from "expo-audio";
import { Icon } from "../../components/Brand";
import { useAssistantHidden } from "../../components/AssistantAccess";
import { colors as c } from "../../theme";
import { ErrorText, Loading, PrimaryButton, SecondaryButton } from "../../ui";
import { useWorkouts } from "../../workouts/context";
import { clock, remaining, type WorkoutAction } from "../../workouts/engine";
import { ExerciseFigure } from "../../workouts/ExerciseFigure";
import { ExerciseInfo, s } from "../../workouts/ui";
import type { Exercise } from "../../workouts/types";

function Awake({ id }: { id: string }) {
  useEffect(() => {
    let disposed = false;
    const tag = `workout:${id}`;
    void activateKeepAwakeAsync(tag).then(() => { if (disposed) void deactivateKeepAwake(tag).catch(() => undefined); }).catch(() => undefined);
    return () => { disposed = true; void deactivateKeepAwake(tag).catch(() => undefined); };
  }, [id]);
  return null;
}

export default function WorkoutPlayer() {
  const { store, ready, draft, records, settings, error } = useWorkouts();
  const { width } = useWindowDimensions();
  const id = useRef(draft?.id), navigated = useRef(false);
  const [info, setInfo] = useState<Exercise | null>(null), [exit, setExit] = useState(false), [leaving, setLeaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const repeatExit = useRef<(() => void) | null>(null);
  const player = useAudioPlayer(require("../../../assets/workouts/cue.wav"));
  const previousPhase = useRef(draft ? `${draft.index}:${draft.phase}` : "");
  useAssistantHidden(true);
  const disablePrevention = usePreventRemove(!!draft && !leaving, ({ repeat }) => {
    repeatExit.current = repeat;
    void store.action("pause").catch(e => setLocalError(e.message)); setExit(true);
  });
  useEffect(() => {
    if (draft) id.current = draft.id;
    if (!draft && id.current && records.some(r => r.id === id.current) && !navigated.current) {
      navigated.current = true;
      disablePrevention();
      router.replace({ pathname: "/workout/result/[id]", params: { id: id.current } });
    }
  }, [draft, records, disablePrevention]);
  useEffect(() => {
    const key = draft ? `${draft.index}:${draft.phase}` : "finished";
    if (key !== previousPhase.current && settings.sound && AppState.currentState === "active") {
      let valid = true;
      void player.seekTo(0).then(() => { if (valid && AppState.currentState === "active") player.play(); }).catch(() => undefined);
      previousPhase.current = key;
      return () => { valid = false; };
    }
    previousPhase.current = key;
  }, [draft?.index, draft?.phase, settings.sound, player]);
  async function action(value: WorkoutAction) {
    try { setLocalError(null); await store.action(value); } catch (e) { setLocalError(e instanceof Error ? e.message : "Не удалось сохранить занятие"); }
  }
  async function leavePaused() {
    try {
      await store.action("pause");
      setLeaving(true); setExit(false);
      if (repeatExit.current) repeatExit.current();
      else { disablePrevention(); router.replace("/(tabs)/workouts"); }
    } catch (e) { setLocalError(e instanceof Error ? e.message : "Не удалось сохранить паузу"); }
  }
  const step = draft?.workout.steps[draft.index];
  const exercise = draft?.exercises.find(e => e.id === step?.exercise_id);
  const nextStep = draft?.workout.steps[(draft?.index ?? 0) + 1];
  const nextExercise = draft?.exercises.find(e => e.id === nextStep?.exercise_id);
  const rest = draft?.phase === "rest";
  const figure = rest ? nextExercise : exercise;
  const current = draft?.results[draft.index];
  if (!ready) return <Loading />;
  if (!draft || !step || !exercise || !current) return <SafeAreaView style={s.page}><View style={[s.content, { paddingTop: 40 }]}><Text style={s.title}>Занятие сохранено</Text><SecondaryButton label="К тренировкам" onPress={() => router.replace("/(tabs)/workouts")} /></View></SafeAreaView>;
  return <SafeAreaView edges={["top", "bottom"]} style={s.page}>
    {!draft.paused ? <Awake id={draft.id} /> : null}
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Выйти из занятия" onPress={() => { repeatExit.current = null; void action("pause"); setExit(true); }} style={s.iconButton}><Icon name="close" /></Pressable>
      <View style={{ flex: 1, gap: 3 }}><Text style={s.small}>{draft.workout.title}</Text><Text style={s.link}>Упражнение {draft.index + 1} из {draft.workout.steps.length}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={settings.sound ? "Выключить звуки" : "Включить звуки"} onPress={() => void store.setSettings({ ...settings, sound: !settings.sound }).catch(e => setLocalError(e.message))} style={s.iconButton}><Text style={s.link}>{settings.sound ? "Звук" : "Тихо"}</Text></Pressable>
    </View>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: draft.workout.steps.length, now: draft.index }} style={local.track}><View style={[local.progress, { width: `${draft.index / draft.workout.steps.length * 100}%` }]} /></View>
    <ScrollView contentContainerStyle={[s.content, { paddingTop: 16, alignItems: "stretch" }]} showsVerticalScrollIndicator={false}>
      <View style={{ alignItems: "center", gap: 6 }}><Text style={local.eyebrow}>{draft.paused ? "НА ПАУЗЕ" : rest ? "ВРЕМЯ ОТДОХНУТЬ" : "ДВИГАЕМСЯ"}</Text><Text accessibilityRole="header" style={local.exerciseTitle}>{rest ? "Спокойно подышите" : exercise.title}</Text></View>
      <View style={s.figure}>{figure ? <ExerciseFigure exercise={figure} playing={!draft.paused && !rest && !info} size={Math.min(240, width - 70)} /> : null}{rest && nextExercise ? <Text style={[s.small, { paddingBottom: 10 }]}>Далее: {nextExercise.title}</Text> : null}</View>
      <View style={{ alignItems: "center", gap: 4 }}>
        <Text style={local.counter}>{rest ? clock(remaining(draft)) : step.repetitions ? `${step.repetitions}` : clock(remaining(draft))}<Text style={local.counterUnit}>{!rest && step.repetitions ? " повторов" : ""}</Text></Text>
        <Text style={[s.muted, { textAlign: "center" }]}>{rest ? "Можно продлить отдых или перейти дальше" : step.repetitions ? `В своём темпе · прошло ${clock(current.active_seconds)}` : exercise.cue}</Text>
      </View>
      {!rest ? <Pressable accessibilityRole="button" style={{ alignSelf: "center", padding: 10 }} onPress={() => { void action("pause"); setInfo(exercise); }}><Text style={s.link}>Как выполнять упражнение</Text></Pressable> : null}
      <ErrorText message={localError ?? error} />
      {draft.paused ? <PrimaryButton label="Продолжить" onPress={() => void action("resume")} /> : !rest && step.repetitions ? <PrimaryButton label="Повторы выполнены" onPress={() => void action("complete_reps")} /> : <PrimaryButton label="Пауза" onPress={() => void action("pause")} />}
      <View style={s.row}>
        {rest ? <View style={{ flex: 1 }}><SecondaryButton label="+15 секунд" disabled={draft.rest_target >= 3600} onPress={() => void action("more_rest")} /></View> : step.repetitions && !draft.paused ? <View style={{ flex: 1 }}><SecondaryButton label="Пауза" onPress={() => void action("pause")} /></View> : null}
        <View style={{ flex: 1 }}><SecondaryButton label={rest ? "Далее" : "Пропустить"} onPress={() => void action("skip")} /></View>
      </View>
      <Text style={[s.small, { textAlign: "center" }]}>При сворачивании приложения занятие встаёт на паузу.</Text>
    </ScrollView>
    <ExerciseInfo exercise={info} onClose={() => setInfo(null)} />
    <Modal visible={exit} transparent animationType="fade" onRequestClose={() => setExit(false)}><View style={s.overlay}><View style={[s.sheet, { padding: 24, gap: 16 }]}>
      <Text accessibilityRole="header" style={s.title}>Сделать перерыв?</Text><Text style={s.muted}>Вы можете выйти на паузе и продолжить позже. Досрочно завершённое занятие останется в истории и не добавится в дневник автоматически.</Text>
      <ErrorText message={localError} />
      <PrimaryButton label="Остаться" onPress={() => setExit(false)} /><SecondaryButton label="Сохранить паузу и выйти" onPress={() => void leavePaused()} />
      <Pressable accessibilityRole="button" onPress={() => { setExit(false); void action("stop"); }} style={{ padding: 12 }}><Text style={{ color: c.danger, textAlign: "center", fontWeight: "600" }}>Завершить досрочно</Text></Pressable>
    </View></View></Modal>
  </SafeAreaView>;
}
const local = StyleSheet.create({
  track: { height: 5, borderRadius: 3, backgroundColor: c.border, marginHorizontal: 20, overflow: "hidden" },
  progress: { height: "100%", backgroundColor: c.accent },
  eyebrow: { color: c.accentDark, fontSize: 11, fontWeight: "700", letterSpacing: 1.6 },
  exerciseTitle: { color: c.text, fontSize: 25, lineHeight: 32, fontWeight: "700", textAlign: "center" },
  counter: { fontSize: 48, lineHeight: 58, fontWeight: "700", color: c.text, fontVariant: ["tabular-nums"] },
  counterUnit: { fontSize: 18, fontWeight: "500" },
});
