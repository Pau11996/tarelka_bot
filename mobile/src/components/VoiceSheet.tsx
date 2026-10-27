import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors } from "../theme";
import { Icon, IconButton, Waveform } from "./Brand";
import type { LocalMedia } from "../media";

export type VoiceDraft = { media: LocalMedia; seconds: number };

function clock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VoiceSheet({
  recording,
  seconds,
  draft,
  transcribing,
  transcript,
  error,
  onChange,
  onClose,
  onSend,
  onRetry,
}: {
  recording: boolean;
  seconds: number;
  draft: VoiceDraft | null;
  transcribing: boolean;
  transcript: string;
  error: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSend: () => void;
  onRetry: () => void;
}) {
  const player = useAudioPlayer(draft?.media.uri ?? null);
  const status = useAudioPlayerStatus(player);
  const [playError, setPlayError] = useState<string | null>(null);
  const duration = recording ? seconds : (draft?.seconds ?? 0);
  const reviewing = !recording && !transcribing && draft !== null;

  async function togglePlayback() {
    try {
      setPlayError(null);
      if (status.playing) player.pause();
      else {
        if (
          status.didJustFinish ||
          (status.duration > 0 && status.currentTime >= status.duration)
        )
          await player.seekTo(0);
        player.play();
      }
    } catch {
      setPlayError("Не удалось воспроизвести запись");
    }
  }

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Text style={s.timer}>{clock(duration)}</Text>
        {transcribing ? (
          <View style={s.recognizing}>
            <ActivityIndicator color={colors.accent} />
            <Text style={s.recognizingText}>Распознаю речь…</Text>
          </View>
        ) : (
          <Waveform dim={recording} />
        )}
        {reviewing ? (
          <IconButton
            name={status.playing ? "pause" : "play"}
            label={status.playing ? "Приостановить" : "Прослушать запись"}
            onPress={() => void togglePlayback()}
          />
        ) : null}
        <IconButton
          name={recording ? "stop" : "arrow"}
          label={
            recording
              ? "Остановить запись"
              : "Отправить сообщение"
          }
          filled
          disabled={transcribing || (reviewing && !transcript.trim())}
          onPress={onSend}
        />
      </View>
      {recording ? (
        <Text style={s.hint}>Остановите запись, затем проверьте текст.</Text>
      ) : null}
      {reviewing ? (
        <>
          <TextInput
            accessibilityLabel="Расшифровка голосового сообщения"
            value={transcript}
            onChangeText={onChange}
            multiline
            placeholder="Напишите, что было в сообщении"
            placeholderTextColor={colors.muted}
            style={s.transcript}
            maxLength={2000}
          />
          <Text style={s.hint}>Проверьте текст и нажмите стрелку, чтобы отправить.</Text>
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      {playError ? <Text style={s.error}>{playError}</Text> : null}
      <View style={s.actions}>
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            disabled={transcribing}
            style={s.textButton}
          >
            <Text style={s.textButtonLabel}>Повторить распознавание</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            player.pause();
            onClose();
          }}
          style={s.textButton}
        >
          <Text style={s.cancel}>Отмена</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "white",
    borderRadius: 28,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timer: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    minWidth: 42,
  },
  recognizing: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  recognizingText: { color: colors.muted, fontSize: 13 },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: "center",
  },
  transcript: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 14,
    minHeight: 72,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "center", gap: 16 },
  textButton: { minHeight: 36, justifyContent: "center", paddingHorizontal: 8 },
  textButtonLabel: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  cancel: { color: colors.muted, fontSize: 13 },
});
