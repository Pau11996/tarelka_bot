import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { api, apiFailureMessage } from "../api";
import { appendMedia } from "../media";
import type { VoiceDraft } from "../components/VoiceSheet";

export function useVoiceDraft(token: string | null, signOut: () => Promise<void>) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const recording = useRef(false);
  const starting = useRef(false);
  const stopped = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    epoch.current += 1;
    controller.current?.abort();
    setVisible(false); setTranscribing(false); setDraft(null); setTranscript(""); setError(null);
    if (recording.current) {
      recording.current = false;
      void recorder.stop().catch(() => undefined).finally(() => { void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined); });
    }
  }, [recorder]);
  useEffect(() => () => { epoch.current += 1; controller.current?.abort(); }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => { if (next !== "active") cancel(); });
    return () => subscription.remove();
  }, [cancel]);

  async function transcribe(next: VoiceDraft) {
    const id = ++epoch.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setTranscribing(true); setError(null);
    try {
      const form = new FormData(); await appendMedia(form, "audio", next.media);
      if (id !== epoch.current) return;
      const result = await api<{ transcript: string }>("/v1/voice/transcribe", { token, body: form, signal: abort.signal });
      if (id === epoch.current) setTranscript(result.transcript);
    } catch (caught) {
      if (id === epoch.current) setError(await apiFailureMessage(caught, "Не удалось распознать речь", signOut));
    } finally { if (id === epoch.current) setTranscribing(false); }
  }
  async function start() {
    if (starting.current || recording.current) return;
    starting.current = true;
    const id = ++epoch.current;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (id !== epoch.current) return;
      if (!permission.granted) throw new Error("Разреши доступ к микрофону в настройках устройства или напиши текстом.");
      setError(null); setDraft(null); setTranscript("");
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      if (id !== epoch.current) { await recorder.stop(); return; }
      stopped.current = false; recording.current = true; recorder.record(); setVisible(true);
    } catch (caught) {
      if (id === epoch.current) setError(caught instanceof Error ? caught.message : "Не удалось начать запись");
    } finally { starting.current = false; }
  }
  async function stop() {
    if (!recording.current || stopped.current) return;
    stopped.current = true; recording.current = false;
    const id = epoch.current;
    const seconds = state.durationMillis / 1000;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (id !== epoch.current) return;
      const uri = recorder.uri;
      if (!uri) throw new Error("Запись не сохранилась. Попробуй ещё раз.");
      const next: VoiceDraft = { seconds, media: { uri, name: Platform.OS === "web" ? "voice.webm" : "voice.m4a", type: Platform.OS === "web" ? "audio/webm" : "audio/mp4" } };
      setDraft(next); await transcribe(next);
    } catch { if (id === epoch.current) { setError("Не удалось сохранить запись. Попробуй ещё раз."); setVisible(false); } }
  }
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => {
    if (!state.isRecording) return;
    const timer = setTimeout(() => void stopRef.current(), Math.max(0, 60_000 - state.durationMillis));
    return () => clearTimeout(timer);
  }, [state.isRecording, state.durationMillis]);
  return { visible, draft, transcript, setTranscript, transcribing, error, start, stop, cancel, retry: () => { if (draft) void transcribe(draft); }, recording: state.isRecording, seconds: state.durationMillis / 1000 };
}
