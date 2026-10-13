import * as ImagePicker from "expo-image-picker";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import { BrandMark, Icon, IconButton, Waveform, type IconName } from "../../components/Brand";
import { EntryCard } from "../../components/ChatCards";
import { VoiceSheet } from "../../components/VoiceSheet";
import { useVoiceDraft } from "../../hooks/useVoiceDraft";
import { appendMedia, type LocalMedia } from "../../media";
import { colors } from "../../theme";
import type { AnalyzeResponse, DayView, Entry } from "../../types";

type SentMessage = { text: string; photos?: string[]; voiceSeconds?: number; voiceUri?: string };

const MAX_PHOTOS = 10;

function clock(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function voiceClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function VoiceBubble({ uri, seconds }: { uri?: string; seconds: number }) {
  const player = useAudioPlayer(uri ?? null);
  const status = useAudioPlayerStatus(player);
  async function toggle() {
    if (!uri) return;
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) await player.seekTo(0);
      player.play();
    }
  }
  return <View style={s.voiceBubble}>
    <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Приостановить" : "Прослушать запись"} onPress={() => void toggle()} style={s.play}>
      <Icon name={status.playing ? "pause" : "play"} color="white" size={16} />
    </Pressable>
    <Waveform />
    <Text style={s.voiceTime}>{voiceClock(seconds)}</Text>
  </View>;
}

function ActionRow({ icon, title, subtitle, onPress, disabled }: {
  icon: IconName; title: string; subtitle: string; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action, (pressed || disabled) && { opacity: 0.6 }]}>
    <View style={s.actionIcon}><Icon name={icon} color={colors.accent} size={22} /></View>
    <View style={s.headerText}>
      <Text style={s.actionTitle}>{title}</Text>
      <Text style={s.actionSub}>{subtitle}</Text>
    </View>
  </Pressable>;
}

export default function ChatScreen() {
  const { token, signOut } = useAuth();
  const [day, setDay] = useState<DayView | null>(null);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<LocalMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<number, SentMessage>>({});
  const [pending, setPending] = useState<SentMessage | null>(null);
  const [correction, setCorrection] = useState<Entry | null>(null);
  const [previousCalories, setPreviousCalories] = useState<Record<number, number>>({});
  const [notedId, setNotedId] = useState<number | null>(null);
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const sending = useRef(false);
  const picking = useRef(false);
  const revision = useRef(0);
  const shouldScroll = useRef(false);
  const armVoiceSend = useRef(false);
  const voice = useVoiceDraft(token, signOut);

  const load = useCallback(async () => {
    const version = ++revision.current;
    try {
      const next = await api<DayView>("/v1/today", { token });
      if (version === revision.current) { setDay(next); setLoadError(null); }
    } catch (caught) {
      if (version === revision.current) setLoadError(await apiFailureMessage(caught, "Не удалось загрузить чат", signOut));
    } finally { if (version === revision.current) setLoading(false); }
  }, [token, signOut]);
  useFocusEffect(useCallback(() => { void load(); return () => { revision.current += 1; voice.cancel(); }; }, [load, voice.cancel]));

  async function pick(camera: boolean) {
    if (picking.current || sending.current) return;
    picking.current = true;
    try {
      if (Platform.OS !== "web") {
        const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) { setError(camera ? "Разрешите доступ к камере в настройках или выберите фото из галереи." : "Разрешите доступ к фото в настройках устройства."); return; }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 0.7,
        allowsMultipleSelection: !camera,
        selectionLimit: camera ? 1 : MAX_PHOTOS,
      };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || result.assets.length === 0) return;
      const incoming: LocalMedia[] = [];
      let skipped = false;
      for (const asset of result.assets) {
        if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) { skipped = true; continue; }
        incoming.push({ uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg", file: asset.file });
      }
      if (incoming.length === 0) { setError("Выберите фото размером до 10 МБ."); return; }
      setPhotos((current) => {
        const seen = new Set(current.map((item) => item.uri));
        const next = [...current];
        for (const item of incoming) {
          if (seen.has(item.uri) || next.length >= MAX_PHOTOS) continue;
          seen.add(item.uri);
          next.push(item);
        }
        return next;
      });
      setError(skipped || incoming.length > MAX_PHOTOS ? `Можно приложить до ${MAX_PHOTOS} фото, каждое не больше 10 МБ.` : null);
      setCorrection(null);
      input.current?.focus();
    } catch { setError("Не удалось открыть фото. Попробуйте ещё раз."); }
    finally { picking.current = false; }
  }

  async function submit(override?: string, extra?: { voiceSeconds?: number; voiceUri?: string }) {
    const message = (override ?? text).trim();
    const attachments = extra?.voiceSeconds ? [] : photos;
    if (sending.current || (!message && attachments.length === 0) || (correction && !message)) return;
    sending.current = true; revision.current += 1;
    const editing = correction;
    const userMessage: SentMessage = { text: message, photos: attachments.map((item) => item.uri), voiceSeconds: extra?.voiceSeconds, voiceUri: extra?.voiceUri };
    setBusy(true); setError(null); setPending(userMessage); shouldScroll.current = true; Keyboard.dismiss();
    try {
      let result: AnalyzeResponse;
      if (editing) {
        result = await api<AnalyzeResponse>(`/v1/entries/${editing.id}/correct`, { token, method: "POST", json: { text: message } });
      } else {
        const form = new FormData(); if (message) form.append("text", message);
        for (const attachment of attachments) await appendMedia(form, "image", attachment);
        result = await api<AnalyzeResponse>("/v1/entries/analyze", { token, body: form });
      }
      if (result.status === "unknown") { setError(result.message); return; }
      setSent((current) => ({ ...current, [result.entry.id]: editing ? { ...current[result.entry.id], text: message } : userMessage }));
      if (editing) {
        setPreviousCalories((current) => ({ ...current, [result.entry.id]: editing.calories }));
        setNotedId(result.entry.id);
      }
      setDay((current) => current ? { ...current, balance: result.balance, entries: [...current.entries.filter((entry) => entry.id !== result.entry.id), result.entry].sort((a, b) => a.id - b.id) } : null);
      setText("");
      setPhotos([]); setCorrection(null); shouldScroll.current = true;
      await load();
    } catch (caught) { setError(await apiFailureMessage(caught, "Не удалось отправить. Сообщение осталось в поле ввода.", signOut)); }
    finally { setPending(null); setBusy(false); sending.current = false; }
  }

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!armVoiceSend.current || voice.recording || voice.transcribing) return;
    const value = voice.transcript.trim();
    if (!value) {
      armVoiceSend.current = false;
      return;
    }
    const seconds = voice.draft?.seconds;
    const uri = voice.draft?.media.uri;
    armVoiceSend.current = false;
    setText(value);
    voice.cancel();
    void submitRef.current(value, { voiceSeconds: seconds, voiceUri: uri });
  }, [voice.recording, voice.transcribing, voice.transcript, voice.error, voice.draft, voice.cancel]);

  function sendVoice() {
    if (voice.recording) { armVoiceSend.current = true; void voice.stop(); return; }
    const value = voice.transcript.trim();
    if (!value || voice.transcribing) return;
    const seconds = voice.draft?.seconds;
    const uri = voice.draft?.media.uri;
    setText(value);
    voice.cancel();
    void submit(value, { voiceSeconds: seconds, voiceUri: uri });
  }

  function correct(entry: Entry) { setCorrection(entry); setPhotos([]); setText(""); setError(null); input.current?.focus(); }
  function removePhoto(uri: string) { setPhotos((current) => current.filter((item) => item.uri !== uri)); }
  const entries = [...(day?.entries ?? [])].sort((a, b) => a.id - b.id);
  const isEmpty = !loading && !loadError && entries.length === 0;

  return <SafeAreaView style={s.safe} edges={["top"]}>
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={s.header}>
        <BrandMark size={40} />
        <View style={s.headerText}>
          <Text style={s.brand}>тарелка</Text>
          <Text style={s.tagline}>Еда и активность</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Открыть настройки" onPress={() => router.push("/(tabs)/profile")} style={s.avatar}>
          <Icon name="profile" color={colors.accent} size={22} />
        </Pressable>
      </View>
      <ScrollView ref={scroll} contentContainerStyle={s.messages} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        onContentSizeChange={() => { if (shouldScroll.current) { scroll.current?.scrollToEnd({ animated: true }); shouldScroll.current = false; } }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={() => { if (!busy) { setRefreshing(true); void load().finally(() => setRefreshing(false)); } }} />}>
        {loading ? <ActivityIndicator color={colors.accent} style={{ margin: 30 }} /> : null}
        {loadError ? <View style={s.errorBox}><Text style={s.error}>{loadError}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={s.retry}><Text style={s.link}>Повторить загрузку</Text></Pressable></View> : null}
        {isEmpty ? <View style={s.welcome}>
          <Text style={s.date}>Сегодня</Text>
          <View style={s.greeting}>
            <View style={s.assistantMark}><BrandMark size={18} /></View>
            <View style={s.assistantBubble}>
              <Text style={s.bodyText}>Привет! Что сегодня на тарелке?</Text>
              <Text style={[s.bodyText, s.greetingSecond]}>Пришлите фото еды, запишите голосовое или расскажите о своей активности.</Text>
            </View>
          </View>
          <ActionRow icon="camera" title="Сфотографировать еду" subtitle="Быстро добавить приём пищи" disabled={busy} onPress={() => void pick(Platform.OS !== "web")} />
          <ActionRow icon="mic" title="Рассказать голосом" subtitle="Про еду или тренировку" disabled={busy} onPress={() => void voice.start()} />
          <ActionRow icon="lines" title="Написать сообщение" subtitle="Например: гуляла 30 минут" disabled={busy} onPress={() => input.current?.focus()} />
          <Text style={s.footerNote}>Можно начать с любой записи</Text>
        </View> : null}
        {entries.map((entry) => {
          const message = sent[entry.id];
          const when = clock(entry.created_at);
          const activity = entry.entry_type === "activity";
          const water = entry.entry_type === "water";
          const revised = previousCalories[entry.id] !== undefined;
          return <View key={entry.id} style={s.exchange}>
            {message ? <View style={s.userGroup}>
              {message.photos?.length ? <View style={s.sentPhotos}>
                {when ? <Text style={s.photoTime}>Сегодня, {when}</Text> : null}
                {message.photos.map((uri) => <Image key={uri} source={{ uri }} accessibilityLabel="Отправленное фото еды" style={s.sentPhoto} />)}
              </View> : null}
              {message.voiceSeconds ? <VoiceBubble uri={message.voiceUri} seconds={message.voiceSeconds} /> : null}
              {message.text ? <View style={s.userBubble}><Text style={s.bodyText}>{message.text}</Text></View> : null}
              {when ? <Text style={s.time}>{when}</Text> : null}
            </View> : null}
            {revised && !activity && !water ? <View style={s.assistantBubble}><Text style={s.bodyText}>Уточнила порцию.</Text></View> : null}
            {revised && water ? <View style={s.assistantBubble}><Text style={s.bodyText}>Уточнила объём.</Text></View> : null}
            <EntryCard entry={entry} disabled={busy} fromPhoto={Boolean(message?.photos?.length)} previousCalories={water ? undefined : previousCalories[entry.id]} time={when} onCorrect={() => correct(entry)} />
            {(activity || water) && !revised ? <View style={s.assistantBubble}><Text style={s.bodyText}>Отлично! Записала в дневник.</Text></View> : null}
            {notedId === entry.id ? <View style={s.note}><Text style={s.noteText}>Любую запись можно исправить прямо в чате.</Text></View> : null}
          </View>;
        })}
        {pending ? <View style={s.exchange}>
          <View style={s.userGroup}>
            {pending.photos?.map((uri) => <Image key={uri} source={{ uri }} style={s.sentPhoto} />)}
            {pending.voiceSeconds ? <VoiceBubble uri={pending.voiceUri} seconds={pending.voiceSeconds} /> : null}
            {pending.text ? <View style={s.userBubble}><Text style={s.bodyText}>{pending.text}</Text></View> : null}
          </View>
          <View style={s.processing}><ActivityIndicator color={colors.accent} /><Text style={s.small}>{correction ? "Уточняю запись…" : "Добавляю в дневник…"}</Text></View>
        </View> : null}
      </ScrollView>
      <View style={s.composerArea}>
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        {correction ? <View style={s.correction}><View style={s.headerText}><Text style={s.link}>Уточняем запись</Text><Text numberOfLines={1} style={s.small}>{correction.title}</Text></View><IconButton name="close" label="Отменить исправление" disabled={busy} onPress={() => setCorrection(null)} /></View> : null}
        {photos.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoStrip}>
          {photos.map((item) => <View key={item.uri} style={s.thumbWrap}>
            <Image source={{ uri: item.uri }} style={s.thumbnail} accessibilityLabel="Выбранное фото" />
            <Pressable accessibilityRole="button" accessibilityLabel="Убрать фото" disabled={busy} onPress={() => removePhoto(item.uri)} style={s.thumbRemove}>
              <Icon name="close" size={12} color="white" />
            </Pressable>
          </View>)}
        </ScrollView> : null}
        {voice.visible ? <VoiceSheet recording={voice.recording} seconds={voice.seconds} draft={voice.draft} transcribing={voice.transcribing} transcript={voice.transcript} error={voice.error} onChange={voice.setTranscript} onClose={voice.cancel} onRetry={voice.retry} onSend={sendVoice} /> : <View style={s.composerRow}>
          <View style={s.inputWrap}>
            {!correction ? <IconButton name="clip" label="Выбрать фото из галереи" disabled={busy} onPress={() => void pick(false)} /> : null}
            <TextInput ref={input} accessibilityLabel={photos.length > 0 ? "Подпись к фото" : correction ? "Что исправить в записи" : "Сообщение о еде или активности"} value={text} onChangeText={setText} multiline maxLength={2000} editable={!busy} placeholder={photos.length > 0 ? "Подпись" : correction ? "Что исправить?" : "Еда или активность…"} placeholderTextColor={colors.muted} style={s.input} />
            {busy ? <View style={s.busy}><ActivityIndicator color="white" /></View> : text.trim() || photos.length > 0 ? <IconButton name="arrow" label={photos.length > 0 ? "Отправить фото" : correction ? "Сохранить исправление" : "Отправить сообщение"} filled onPress={() => void submit()} /> : !correction ? <>
              <IconButton name="camera" label="Сфотографировать еду" onPress={() => void pick(Platform.OS !== "web")} />
              <IconButton name="mic" label="Записать голосовое сообщение" onPress={() => void voice.start()} />
            </> : null}
          </View>
        </View>}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, width: "100%", maxWidth: 600, alignSelf: "center" },
  header: { marginHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  headerText: { flex: 1, gap: 2 },
  brand: { fontSize: 20, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  tagline: { color: colors.muted, fontSize: 13 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  messages: { paddingHorizontal: 20, paddingTop: 12, gap: 22, paddingBottom: 16, flexGrow: 1 },
  date: { color: colors.muted, fontSize: 13, textAlign: "center" },
  welcome: { gap: 12 },
  greeting: { gap: 8, marginBottom: 6 },
  assistantMark: { marginLeft: 2 },
  assistantBubble: { padding: 14, borderRadius: 18, backgroundColor: "white", maxWidth: 340 },
  bodyText: { fontSize: 15, lineHeight: 22, color: colors.text },
  greetingSecond: { marginTop: 8, color: colors.muted },
  action: { backgroundColor: "white", borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 72 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  actionTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  actionSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  footerNote: { textAlign: "center", color: colors.muted, fontSize: 12, marginTop: 8 },
  exchange: { gap: 12 },
  userGroup: { alignItems: "flex-end", gap: 6 },
  userBubble: { maxWidth: "86%", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.soft, borderRadius: 18, borderBottomRightRadius: 6 },
  sentPhotos: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6, maxWidth: 292 },
  sentPhoto: { width: 140, height: 140, borderRadius: 14 },
  photoTime: { fontSize: 12, color: colors.muted },
  time: { fontSize: 11, color: colors.muted, marginRight: 4 },
  voiceBubble: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "white", borderRadius: 18, paddingVertical: 8, paddingLeft: 8, paddingRight: 14, width: 250 },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  voiceTime: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  processing: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  note: { backgroundColor: "#f6f1c4", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  noteText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  composerArea: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 8, backgroundColor: colors.bg },
  composerRow: { flexDirection: "row", alignItems: "center" },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 2, paddingRight: 4, paddingVertical: 2, borderRadius: 26, backgroundColor: "white", borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, paddingVertical: 12, paddingHorizontal: 4, minHeight: 48, maxHeight: 120 },
  busy: { height: 40, width: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginRight: 2 },
  correction: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colors.accent },
  photoStrip: { gap: 8, paddingHorizontal: 4, paddingTop: 4 },
  thumbWrap: { width: 84, height: 84 },
  thumbnail: { width: 84, height: 84, borderRadius: 12 },
  thumbRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "#182c23cc", alignItems: "center", justifyContent: "center" },
  small: { fontSize: 12, lineHeight: 18, color: colors.muted },
  error: { fontSize: 13, lineHeight: 19, color: colors.danger },
  errorBox: { padding: 14, backgroundColor: colors.dangerSoft, borderRadius: 16, gap: 8 },
  retry: { paddingVertical: 8 },
  link: { fontSize: 13, fontWeight: "600", color: colors.accentDark },
});
