import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type { LocalMedia } from "../media";

export type VoiceDraft = { media: LocalMedia; seconds: number };

export function useVoiceDraft(onRecorded: (draft: VoiceDraft) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [visible, setVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const recording = useRef(false);
  const starting = useRef(false);
  const requestingPermission = useRef(false);
  const resumeStart = useRef<(() => void) | null>(null);
  const stopping = useRef<Promise<void>>(Promise.resolve());
  const stopped = useRef(false);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const releaseRecorder = useCallback(() => {
    recording.current = false;
    const cleanup = (async () => {
      try {
        await recorder.stop();
      } finally {
        await setAudioModeAsync({ allowsRecording: false });
      }
    })();
    stopping.current = cleanup;
    return cleanup;
  }, [recorder]);

  const cancel = useCallback(() => {
    epoch.current += 1;
    resumeStart.current?.();
    setVisible(false);
    setFinishing(false);
    setError(null);
    if (recording.current) {
      void releaseRecorder().catch(() => undefined);
    }
  }, [releaseRecorder]);
  useEffect(
    () => () => {
      epoch.current += 1;
      resumeStart.current?.();
      if (recording.current) void releaseRecorder().catch(() => undefined);
    },
    [releaseRecorder],
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") resumeStart.current?.();
      // The system microphone permission dialog can temporarily background the app.
      // Keep this start pending until the dialog closes and the app is active again.
      else if (!requestingPermission.current) cancel();
    });
    return () => subscription.remove();
  }, [cancel]);

  async function start() {
    if (starting.current || recording.current) return;
    starting.current = true;
    const id = ++epoch.current;
    let needsCleanup = false;
    setError(null);
    try {
      // A previous cancel may still be releasing the native recorder/audio session.
      await stopping.current.catch(() => undefined);
      if (id !== epoch.current) return;
      let permission = await AudioModule.getRecordingPermissionsAsync();
      if (id !== epoch.current) return;
      if (!permission.granted) {
        requestingPermission.current = true;
        permission = await AudioModule.requestRecordingPermissionsAsync();
      }
      if (id !== epoch.current) return;
      if (!permission.granted)
        throw new Error(
          "Разреши доступ к микрофону в настройках устройства или напиши текстом.",
        );
      while (AppState.currentState && AppState.currentState !== "active") {
        await new Promise<void>((resolve) => { resumeStart.current = resolve; });
        resumeStart.current = null;
        if (id !== epoch.current) return;
      }
      requestingPermission.current = false;
      setFinishing(false);
      needsCleanup = true;
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
      if (id !== epoch.current) return;
      await recorder.prepareToRecordAsync();
      if (id !== epoch.current) return;
      recorder.record();
      if (!recorder.getStatus().isRecording)
        throw new Error("Не удалось начать запись. Попробуй ещё раз.");
      stopped.current = false;
      recording.current = true;
      needsCleanup = false;
      setVisible(true);
    } catch (caught) {
      if (id === epoch.current)
        setError(
          caught instanceof Error ? caught.message : "Не удалось начать запись",
        );
    } finally {
      requestingPermission.current = false;
      resumeStart.current = null;
      if (needsCleanup) await releaseRecorder().catch(() => undefined);
      starting.current = false;
    }
  }
  async function stop() {
    if (!recording.current || stopped.current) return;
    stopped.current = true;
    recording.current = false;
    setFinishing(true);
    const id = epoch.current;
    const seconds = state.durationMillis / 1000;
    try {
      await releaseRecorder();
      if (id !== epoch.current) return;
      const uri = recorder.uri;
      if (!uri) throw new Error("Запись не сохранилась. Попробуй ещё раз.");
      const next: VoiceDraft = {
        seconds,
        media: {
          uri,
          name: Platform.OS === "web" ? "voice.webm" : "voice.m4a",
          type: Platform.OS === "web" ? "audio/webm" : "audio/mp4",
        },
      };
      // Enqueue the audio immediately. Recognition belongs to the chat job.
      onRecordedRef.current(next);
      setVisible(false);
    } catch {
      if (id === epoch.current) {
        setError("Не удалось сохранить запись. Попробуй ещё раз.");
        setVisible(false);
      }
    } finally {
      if (id === epoch.current) setFinishing(false);
    }
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!state.isRecording) return;
    const timer = setTimeout(
      () => void stopRef.current(),
      Math.max(0, 60_000 - state.durationMillis),
    );
    return () => clearTimeout(timer);
  }, [state.isRecording, state.durationMillis]);
  return {
    visible,
    finishing,
    error,
    start,
    stop,
    cancel,
    recording: state.isRecording,
    seconds: state.durationMillis / 1000,
  };
}
