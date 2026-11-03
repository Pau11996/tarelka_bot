import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { dailyNorm, normDescription, normTitle, type DailyNorm } from "../sharing/dailyNorm";
import { renderNorm, prepareShareImage, shareCancelled, type ShareImage } from "../sharing/shareImage";
import { useAuth } from "../auth";
import { colors } from "../theme";
import type { DayView } from "../types";
import { Icon } from "./Brand";

function SharePreview({ norm, token, onClose, onRetry }: { norm: DailyNorm; token: string; onClose: () => void; onRetry: () => void }) {
  const mounted = useRef(true);
  const sharing = useRef(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [image, setImage] = useState<ShareImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      active = false;
      controller.abort();
      setError("Картинка загружается дольше обычного. Попробуйте ещё раз.");
    }, 20000);
    (async () => {
      try {
        const base64 = await renderNorm(norm, token, controller.signal);
        if (!active) return;
        setPreviewUri(`data:image/png;base64,${base64}`);
        const prepared = await prepareShareImage(base64);
        if (active) { setImage(prepared); setError(null); }
      } catch {
        if (active) setError("Не удалось подготовить картинку. Проверьте интернет и попробуйте ещё раз.");
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; mounted.current = false; controller.abort(); clearTimeout(timer); };
  }, [norm, token]);

  async function share() {
    if (!image || sharing.current) return;
    sharing.current = true;
    setBusy(true);
    setError(null);
    try {
      await image.share();
    } catch (cause) {
      if (mounted.current && !shareCancelled(cause)) setError("Не получилось поделиться картинкой. Попробуйте ещё раз.");
    } finally {
      sharing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <View style={s.overlay}>
      <Pressable accessibilityLabel="Закрыть предпросмотр" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={s.dialog} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={s.dialogContent} bounces={false}>
          <View style={s.heading}>
            <Text accessibilityRole="header" style={s.title}>{normTitle(norm)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} hitSlop={6} style={s.close}>
              <Icon name="close" size={21} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={s.description}>{norm.personalized ? "Поделитесь своей нормой — кот уже оценил." : "Это стартовые значения. Заполните профиль, чтобы получить персональную норму."}</Text>
          <View style={s.card} accessible accessibilityRole="image" accessibilityLabel={normDescription(norm)}>
            {previewUri ? <Image source={{ uri: previewUri }} style={s.previewImage} resizeMode="contain" accessible={false} /> : <ActivityIndicator color={colors.accent} />}
          </View>
          <Text style={s.values}>{normDescription(norm)}</Text>
          {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
          {error && !image ? <Pressable accessibilityRole="button" onPress={onRetry} style={s.primary}><Text style={s.primaryText}>Попробовать ещё раз</Text></Pressable> :
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !image || busy, busy: !image || busy }} disabled={!image || busy} onPress={() => void share()} style={[s.primary, (!image || busy) && s.disabled]}>
              {!image || busy ? <ActivityIndicator color="white" size="small" /> : <Icon name="share" color="white" size={19} />}
              <Text style={s.primaryText}>{busy ? "Открываем…" : image?.label ?? "Готовим картинку…"}</Text>
            </Pressable>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

export function DailyNormShare({ day }: { day: DayView }) {
  const { token } = useAuth();
  const [snapshot, setSnapshot] = useState<DailyNorm | null>(null);
  const [attempt, setAttempt] = useState(0);
  const norm = dailyNorm(day);
  if (!norm || !token) return null;
  return <>
    <Pressable accessibilityRole="button" onPress={() => setSnapshot(norm)} style={({ pressed }) => [s.entry, pressed && s.pressed]}>
      <Icon name="share" size={18} color={colors.accentDark} />
      <Text style={s.entryText}>Поделиться нормой</Text>
    </Pressable>
    {snapshot ? <SharePreview key={attempt} norm={snapshot} token={token} onClose={() => setSnapshot(null)} onRetry={() => setAttempt(value => value + 1)} /> : null}
  </>;
}

const s = StyleSheet.create({
  entry: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, marginTop: -8 },
  entryText: { color: colors.accentDark, fontSize: 13, fontWeight: "500" },
  pressed: { backgroundColor: colors.soft },
  overlay: { flex: 1, padding: 20, justifyContent: "center", alignItems: "center", backgroundColor: "#14231966" },
  dialog: { width: "100%", maxWidth: 600, maxHeight: "90%", borderRadius: 22, backgroundColor: colors.surface, overflow: "hidden" },
  dialogContent: { padding: 20, gap: 16 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: "600" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10, marginVertical: -8 },
  description: { fontSize: 14, lineHeight: 21, color: colors.muted },
  card: { width: "100%", aspectRatio: 7.5, backgroundColor: "#fbf8eb", justifyContent: "center", overflow: "hidden", borderRadius: 8 },
  previewImage: { width: "100%", height: "100%" },
  values: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: "#8c6555", backgroundColor: "#f7f0e9", padding: 12, borderRadius: 12, fontSize: 13, lineHeight: 19 },
  primary: { minHeight: 48, padding: 12, borderRadius: 14, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { color: "white", fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
