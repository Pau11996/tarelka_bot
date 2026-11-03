import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { IconButton, Waveform } from "./Brand";

function clock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VoiceSheet({ seconds, finishing, onClose, onSend }: {
  seconds: number;
  finishing: boolean;
  onClose: () => void;
  onSend: () => void;
}) {
  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Text style={s.timer}>{clock(seconds)}</Text>
        <Waveform dim />
        {finishing ? <ActivityIndicator color={colors.accent} /> : null}
        <IconButton name="arrow" label="Отправить голосовое сообщение" filled
          disabled={finishing} onPress={onSend} />
      </View>
      <Text style={s.hint}>Нажмите стрелку, чтобы отправить. Распознавание и анализ появятся в чате.</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={s.cancelButton}>
        <Text style={s.cancel}>Отмена</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  bar: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "white", borderRadius: 28, paddingLeft: 16,
    paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderColor: colors.border,
  },
  timer: { color: colors.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"], minWidth: 42 },
  hint: { fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center" },
  cancelButton: { minHeight: 36, alignSelf: "center", justifyContent: "center", paddingHorizontal: 8 },
  cancel: { color: colors.muted, fontSize: 13 },
});
