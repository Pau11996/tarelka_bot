import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import { api, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";
import type { AnalyzeResponse } from "../types";
import { ErrorText, Field, PrimaryButton, SecondaryButton } from "../ui";

type LocalFile = { uri: string; name: string; type: string };

export default function AddScreen() {
  const { token, signOut } = useAuth();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<LocalFile | null>(null);
  const [audio, setAudio] = useState<LocalFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
  }, []);

  useEffect(() => {
    if (!recorderState.isRecording) {
      return;
    }
    const timer = setTimeout(() => {
      void stopRecording();
    }, 60_000);
    return () => clearTimeout(timer);
  }, [recorderState.isRecording]);

  async function pick(fromCamera: boolean) {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(fromCamera ? "Нет доступа к камере" : "Нет доступа к фото");
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (result.canceled || result.assets.length === 0) {
      return;
    }
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      name: asset.fileName ?? "photo.jpg",
      type: asset.mimeType ?? "image/jpeg",
    });
    setError(null);
  }

  async function toggleRecording() {
    if (recorderState.isRecording) {
      await stopRecording();
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("Нет доступа к микрофону");
      return;
    }
    setAudio(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopRecording() {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      return;
    }
    const name = uri.split("/").pop() || "voice.m4a";
    setAudio({ uri, name, type: "audio/mp4" });
  }

  async function submit() {
    if (!text.trim() && !photo && !audio) {
      setError("Добавьте фото, текст или голосовое.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = new FormData();
    if (text.trim()) {
      form.append("text", text.trim());
    }
    if (photo) {
      form.append("image", photo as unknown as Blob);
    }
    if (audio) {
      form.append("audio", audio as unknown as Blob);
    }
    try {
      const result = await api<AnalyzeResponse>("/v1/entries/analyze", { method: "POST", token, body: form });
      if (result.status === "unknown") {
        setNotice(result.message);
        return;
      }
      router.replace(`/entry/${result.entry.id}`);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось разобрать запись", signOut);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Field
        value={text}
        onChangeText={setText}
        placeholder="Опишите блюдо или тренировку"
        multiline
        style={styles.multiline}
      />
      <View style={styles.row}>
        <View style={styles.half}>
          <SecondaryButton label="Камера" onPress={() => void pick(true)} />
        </View>
        <View style={styles.half}>
          <SecondaryButton label="Галерея" onPress={() => void pick(false)} />
        </View>
      </View>
      {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : null}
      <SecondaryButton
        label={recorderState.isRecording ? "Остановить запись" : audio ? "Перезаписать голос" : "Записать голос"}
        onPress={() => void toggleRecording()}
      />
      {audio && !recorderState.isRecording ? <Text style={styles.hint}>Голосовое готово, до 60 секунд.</Text> : null}
      {recorderState.isRecording ? <Text style={styles.hint}>Идёт запись…</Text> : null}
      <ErrorText message={error} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <PrimaryButton
        label={busy ? "Считаю…" : "Посчитать"}
        disabled={busy || recorderState.isRecording}
        onPress={() => void submit()}
      />
      <Text style={styles.hint}>Результат появится и в боте: дневник общий.</Text>
      <Text style={styles.example}>Например: «гречка 150 г и котлета» или «ходьба 40 минут».</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12, paddingBottom: 40, backgroundColor: colors.bg },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  preview: { width: "100%", height: 180, borderRadius: 16, backgroundColor: colors.soft },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  notice: { color: colors.text, fontSize: 15, lineHeight: 21 },
  example: { color: colors.muted, fontSize: 13 },
});
