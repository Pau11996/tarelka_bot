import * as ImagePicker from "expo-image-picker";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "../../config";
import { PhotoPreview } from "../../components/PhotoPreview";
import { useRequestLimit } from "../../components/RequestLimitDialog";
import { isLegacyLimitMessage } from "../../requestLimits";
import { operationLimitKind, useOperationLimitNotice } from "../../hooks/useOperationLimitNotice";
import { Operation, requestKey, waitOperation } from "../../operations";
import { buildChatTimeline, type ChatMessage, type ChatTimelineItem, type PendingChatMessage } from "../../chatTimeline";
import { useAssistantHidden } from "../../components/AssistantAccess";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError, apiFailureMessage } from "../../api";
import { useAuth } from "../../auth";
import {
  BrandMark,
  Icon,
  IconButton,
  Waveform,
  type IconName,
} from "../../components/Brand";
import {
  DaySummary,
  EntryCard,
  AnalysisFailureCard,
  WeightChatCard,
  GoalReachedChatCard,
} from "../../components/ChatCards";
import { AccountMenu } from "../../components/AccountMenu";
import { VoiceSheet } from "../../components/VoiceSheet";
import { MediaPermissionDialog, type MediaPermissionKind } from "../../components/MediaPermissionDialog";
import { useVoiceDraft } from "../../hooks/useVoiceDraft";
import { appendMedia, type LocalMedia } from "../../media";
import { colors } from "../../theme";
import type { AchievementMessage, AnalyzeResponse, DayView, Entry } from "../../types";
import { healthUpdated } from "../../health/events";

type History = {
  notices?: AchievementMessage[];
  entries: Entry[];
  operations: Operation[];
  media: { id: string; operation_id: string; mime: string; url: string }[];
  next_before: number | null;
};
type SentMessage = ChatMessage;

const MAX_PHOTOS = 10;

function clock(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function voiceClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function VoiceBubble({ uri, seconds }: { uri?: string; seconds: number }) {
  const { token } = useAuth();
  const player = useAudioPlayer(
    uri
      ? {
          uri,
          headers: uri.startsWith(API_URL)
            ? { Authorization: `Bearer ${token}` }
            : undefined,
        }
      : null,
  );
  const status = useAudioPlayerStatus(player);
  async function toggle() {
    if (!uri) return;
    if (status.playing) player.pause();
    else {
      if (
        status.didJustFinish ||
        (status.duration > 0 && status.currentTime >= status.duration)
      )
        await player.seekTo(0);
      player.play();
    }
  }
  return (
    <View style={s.voiceBubble}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          status.playing ? "Приостановить" : "Прослушать запись"
        }
        onPress={() => void toggle()}
        style={s.play}
      >
        <Icon
          name={status.playing ? "pause" : "play"}
          color="white"
          size={16}
        />
      </Pressable>
      <Waveform />
      <Text style={s.voiceTime}>{voiceClock(status.duration || seconds)}</Text>
    </View>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <View style={s.actionIcon}>
        <Icon name={icon} color={colors.accent} size={22} />
      </View>
      <View style={s.headerText}>
        <Text style={s.actionTitle}>{title}</Text>
        <Text style={s.actionSub}>{subtitle}</Text>
      </View>
      <Icon name="chevron" size={17} color={colors.muted} />
    </Pressable>
  );
}

function ProcessingStatus({
  status,
  hasPhotos,
  correcting,
}: {
  status: "uploading" | "queued" | "running";
  hasPhotos: boolean;
  correcting: boolean;
}) {
  const title = status === "uploading"
    ? hasPhotos ? "Загружаю фото…" : "Отправляю запись…"
    : status === "queued"
      ? hasPhotos ? "Готовлю анализ фото…" : "Запись в очереди…"
      : correcting ? "Уточняю запись…" : hasPhotos ? "Анализирую фото…" : "Анализирую запись…";
  return (
    <View style={s.processing} accessibilityRole="progressbar" accessibilityLabel={title} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.accent} size="small" />
      <View style={s.processingText}>
        <Text style={s.processingTitle}>{title}</Text>
        <Text style={s.small}>
          {status === "uploading"
            ? "Отправляем вложения. Это может занять немного времени."
            : hasPhotos
              ? "Определяю блюда, порции и БЖУ. Результат сохранится в дневнике."
              : "Результат сохранится в дневнике, даже если выйти из чата."}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { token, signOut } = useAuth();
  const { handleLimit, openLimit } = useRequestLimit();
  const [history, setHistory] = useState<History | null>(null);
  const submission = useRef<string | null>(null);
  const draftReady = useRef(false);
  const [day, setDay] = useState<DayView | null>(null);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<LocalMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaPermission, setMediaPermission] = useState<MediaPermissionKind | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<number, SentMessage>>({});
  const [pending, setPending] = useState<PendingChatMessage | null>(null);
  const [operationMessages, setOperationMessages] = useState<Record<string, SentMessage>>({});
  const [correction, setCorrection] = useState<Entry | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [previousCalories, setPreviousCalories] = useState<
    Record<number, number>
  >({});
  const [notedId, setNotedId] = useState<number | null>(null);
  const input = useRef<TextInputInstance>(null);
  const scroll = useRef<FlatList<ChatTimelineItem>>(null);
  const sending = useRef(false);
  const retrying = useRef(new Set<string>());
  const picking = useRef(false);
  const revision = useRef(0);
  const shouldScroll = useRef(true);
  const markLimitShown = useOperationLimitNotice(history?.operations, busy);

  const voice = useVoiceDraft(token, signOut);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);
  useAssistantHidden(
    busy || inputFocused || voice.visible || photos.length > 0 || !!correction || !!mediaPermission,
  );
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(`draft:${token?.slice(-24)}`).then((value) => {
      if (active) {
        if (value) setText(value);
        draftReady.current = true;
      }
    });
    return () => {
      active = false;
      draftReady.current = false;
    };
  }, [token]);
  useEffect(() => {
    if (!draftReady.current) return;
    const timer = setTimeout(
      () => void AsyncStorage.setItem(`draft:${token?.slice(-24)}`, text),
      350,
    );
    return () => clearTimeout(timer);
  }, [text, token]);

  const updateOperation = useCallback((operation: Operation) => {
    revision.current += 1;
    setHistory((current) => ({
      entries: current?.entries ?? [],
      notices: current?.notices ?? [],
      operations: [...(current?.operations ?? []).filter((item) => item.id !== operation.id), operation],
      media: current?.media ?? [],
      next_before: current?.next_before ?? null,
    }));
  }, []);

  const load = useCallback(async () => {
    const version = ++revision.current;
    try {
      const [next, chat] = await Promise.all([
        api<DayView>("/v1/today", { token }),
        api<History>("/v1/chat", { token }),
      ]);
      if (version === revision.current) {
        setDay(next);
        setHistory(chat);
        setLoadError(null);
      }
    } catch (caught) {
      if (version === revision.current)
        setLoadError(
          await apiFailureMessage(caught, "Не удалось загрузить чат", signOut),
        );
    } finally {
      if (version === revision.current) setLoading(false);
    }
  }, [token, signOut]);
  useFocusEffect(
    useCallback(() => {
      scroll.current?.scrollToOffset({ offset: 0, animated: false });
      void load();
      let active = true;
      // Goal updates from Telegram or another device should appear in an open chat.
      const timer = setInterval(() => {
        if (AppState.currentState !== "active") return;
        void api<{ notices: AchievementMessage[] }>("/v1/chat/notices", { token }).then((next) => {
          if (active) setHistory((current) => current ? { ...current, notices: next.notices } : current);
        }).catch(() => {});
      }, 15000);
      return () => {
        active = false;
        clearInterval(timer);
        revision.current += 1;
        voice.cancel();
        setMediaPermission(null);
        setError(null);
      };
    }, [load, token, voice.cancel]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => sub.remove();
  }, [load]);
  useEffect(() => {
    if (
      !history?.operations.some(
        (o) => o.status === "queued" || o.status === "running",
      )
    )
      return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [history, load]);
  async function earlier() {
    if (!history?.next_before) return;
    const version = revision.current;
    try {
      const next = await api<History>(
        `/v1/chat?before=${history.next_before}`,
        { token },
      );
      if (version !== revision.current) return;
      setHistory((old) =>
        old
          ? {
              ...next,
              entries: [...next.entries, ...old.entries],
              notices: [...(next.notices ?? []), ...(old.notices ?? [])],
              operations: [...old.operations, ...next.operations].filter(
                (o, i, a) => a.findIndex((x) => x.id === o.id) === i,
              ),
              media: [...old.media, ...next.media].filter(
                (item, index, all) => all.findIndex((value) => value.id === item.id) === index,
              ),
            }
          : next,
      );
    } catch (e) {
      setError(
        await apiFailureMessage(e, "Не удалось загрузить историю", signOut),
      );
    }
  }
  function entryDeleted(entryId: number) {
    const version = ++revision.current;
    setHistory((current) => {
      if (!current) return current;
      const removedOperations = new Set(
        current.operations.filter((op) => op.entry_id === entryId).map((op) => op.id),
      );
      return {
        ...current,
        entries: current.entries.filter((entry) => entry.id !== entryId),
        operations: current.operations.filter((op) => !removedOperations.has(op.id)),
        media: current.media.filter((item) => !removedOperations.has(item.operation_id)),
      };
    });
    setDay((current) => current ? { ...current, entries: current.entries.filter((entry) => entry.id !== entryId) } : current);
    setCorrection((current) => current?.id === entryId ? null : current);
    setNotedId((current) => current === entryId ? null : current);
    setSent((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    setPreviousCalories((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    void api<DayView>("/v1/today", { token }).then((next) => {
      if (version === revision.current) setDay(next);
    }).catch(async (caught) => {
      const message = await apiFailureMessage(caught, "Запись удалена. Не удалось обновить баланс — потяните чат вниз для обновления.", signOut);
      if (version === revision.current && message) setError(message);
    });
  }

  async function retry(op: Operation) {
    if (retrying.current.has(op.id)) return;
    retrying.current.add(op.id);
    markLimitShown(op.id);
    let accepted = false;
    try {
      setError(null);
      const next = await api<Operation>(`/v1/operations/${op.id}/retry`, { token, method: "POST" });
      accepted = true;
      updateOperation(next);
      await waitOperation(next, token, updateOperation);
    } catch (e) {
      if (await handleLimit(e, operationLimitKind(op))) {
        if (!accepted) updateOperation({
          ...op, status: "failed", error: e instanceof Error ? e.message : op.error,
          limit_reached: e instanceof ApiError ? e.limitReached ?? op.limit_reached : op.limit_reached,
        });
        return;
      }
      const message = await apiFailureMessage(e, "Не удалось повторить запрос", signOut);
      if (!accepted && message) updateOperation({ ...op, status: "failed", error: message, limit_reached: null });
    } finally {
      retrying.current.delete(op.id);
      void load();
    }
  }
  async function pick(camera: boolean) {
    if (picking.current || sending.current) return;
    picking.current = true;
    setError(null);
    try {
      if (Platform.OS !== "web") {
        const permission = camera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Keyboard.dismiss();
          setMediaPermission(camera ? "camera" : "photos");
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 0.7,
        allowsMultipleSelection: !camera,
        selectionLimit: camera ? 1 : MAX_PHOTOS,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || result.assets.length === 0) return;
      const incoming: LocalMedia[] = [];
      let skipped = false;
      for (const asset of result.assets) {
        if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
          skipped = true;
          continue;
        }
        incoming.push({
          uri: asset.uri,
          name: asset.fileName ?? "photo.jpg",
          type: asset.mimeType ?? "image/jpeg",
          file: asset.file,
        });
      }
      if (incoming.length === 0) {
        setError("Выберите фото размером до 10 МБ.");
        return;
      }
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
      setError(
        skipped || incoming.length > MAX_PHOTOS
          ? `Можно приложить до ${MAX_PHOTOS} фото, каждое не больше 10 МБ.`
          : null,
      );
      setCorrection(null);
      input.current?.focus();
    } catch {
      setError("Не удалось открыть фото. Попробуйте ещё раз.");
    } finally {
      picking.current = false;
    }
  }

  async function submit(
    override?: string,
    extra?: {
      voiceSeconds?: number;
      voiceUri?: string;
      voiceId?: string | null;
    },
  ) {
    const message = (override ?? text).trim();
    const attachments = extra?.voiceId ? [] : photos;
    if (
      sending.current ||
      (!message && attachments.length === 0) ||
      (correction && !message)
    )
      return;
    sending.current = true;
    revision.current += 1;
    const editing = correction;
    const userMessage: SentMessage = {
      text: message,
      photos: attachments.map((item) => item.uri),
      voiceSeconds: extra?.voiceSeconds,
      voiceUri: extra?.voiceUri,
    };
    setBusy(true);
    setError(null);
    submission.current ??= requestKey();
    const currentRequestKey = submission.current;
    setPending({ ...userMessage, requestKey: currentRequestKey, createdAt: new Date().toISOString() });
    shouldScroll.current = true;
    scroll.current?.scrollToOffset({ offset: 0, animated: true });
    Keyboard.dismiss();
    let operationId: string | null = null;
    try {
      const form = new FormData();
      form.append("request_key", currentRequestKey);
      if (message) form.append("text", message);
      if (editing) form.append("entry_id", String(editing.id));
      if (extra?.voiceId) form.append("voice_id", extra.voiceId);
      for (const attachment of attachments)
        await appendMedia(form, "image", attachment);
      const op = await api<Operation>("/v1/operations", { token, body: form });
      operationId = op.id;
      setOperationMessages((current) => ({ ...current, [op.id]: userMessage }));
      updateOperation(op);
      submission.current = null;
      setText("");
      setPhotos([]);
      voice.cancel();
      await AsyncStorage.removeItem(`draft:${token?.slice(-24)}`);
      const completed = await waitOperation(op, token, updateOperation);
      const result = completed.result as AnalyzeResponse;
      if (result.status === "unknown") {
        return;
      }
      if (result.status === "weight_saved") {
        healthUpdated();
        shouldScroll.current = true;
        await load();
        return;
      }
      setSent((current) => ({
        ...current,
        [result.entry.id]: editing
          ? { ...current[result.entry.id], text: message }
          : userMessage,
      }));
      // Keep the saved exchange visible even if refreshing history loses its connection.
      setHistory((current) => ({
        entries: [
          ...(current?.entries ?? []).filter((entry) => entry.id !== result.entry.id),
          result.entry,
        ].sort((a, b) => a.id - b.id),
        operations: [
          ...(current?.operations ?? []).filter((operation) => operation.id !== completed.id),
          completed,
        ],
        media: current?.media ?? [],
        notices: current?.notices ?? [],
        next_before: current?.next_before ?? null,
      }));
      if (editing) {
        setPreviousCalories((current) => ({
          ...current,
          [result.entry.id]: editing.calories,
        }));
        setNotedId(result.entry.id);
      }
      setDay((current) =>
        current
          ? {
              ...current,
              balance: result.balance,
              entries: [
                ...current.entries.filter(
                  (entry) => entry.id !== result.entry.id,
                ),
                result.entry,
              ].sort((a, b) => a.id - b.id),
            }
          : null,
      );
      setText("");
      setPhotos([]);
      setCorrection(null);
      shouldScroll.current = true;
      await load();
    } catch (caught) {
      if (await handleLimit(caught, editing ? "text" : attachments.length ? "photo" : extra?.voiceId ? "voice" : "text")) {
        if (operationId) markLimitShown(operationId);
        else {
          setText(message);
          setPhotos(attachments);
          setCorrection(editing);
        }
      } else {
        const failure = await apiFailureMessage(
          caught,
          caught instanceof Error
            ? caught.message
            : "Не удалось отправить. Проверьте историю перед повтором.",
          signOut,
        );
        if (!operationId && failure) setError(failure);
      }
    } finally {
      setPending(null);
      setBusy(false);
      sending.current = false;
      void load();
    }
  }

  function sendVoice() {
    if (voice.recording) {
      void voice.stop();
      return;
    }
    if (!voice.transcript.trim() || voice.transcribing || !voice.mediaId)
      return;
    void submit(voice.transcript, {
      voiceSeconds: voice.draft?.seconds,
      voiceUri: voice.draft?.media.uri,
      voiceId: voice.mediaId,
    });
  }

  function correct(entry: Entry) {
    setCorrection(entry);
    setPhotos([]);
    setText("");
    setError(null);
    input.current?.focus();
  }
  function removePhoto(uri: string) {
    setPhotos((current) => current.filter((item) => item.uri !== uri));
  }
  const entries = history?.entries ?? day?.entries ?? [];
  const timeline = buildChatTimeline(entries, history?.operations ?? [], pending, history?.notices ?? []);
  const isEmpty = !loading && !loadError && timeline.length === 0;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={s.header}>
          <View style={s.headerMark}>
            <BrandMark size={38} />
          </View>
          <View style={s.headerText}>
            <Text style={s.brand}>Тарелка</Text>
            <View style={s.status}>
              <View style={s.statusDot} />
              <Text style={s.tagline}>Ваш дневник в чате</Text>
            </View>
          </View>
          <AccountMenu />
        </View>
        {day ? (
          <DaySummary day={day} onPress={() => router.push("/(tabs)/today")} />
        ) : null}
        <FlatList
          ref={scroll}
          data={[...timeline].reverse()}
          inverted
          keyExtractor={(item) => item.key}
          contentContainerStyle={s.messages}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={8}
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
          ItemSeparatorComponent={() => <View style={s.messageGap} />}
          onContentSizeChange={() => {
            if (shouldScroll.current && !loading) {
              scroll.current?.scrollToOffset({ offset: 0, animated: false });
              shouldScroll.current = false;
            }
          }}
          refreshControl={
            Platform.OS === "web" ? undefined : (
              <RefreshControl
                refreshing={refreshing}
                tintColor={colors.accent}
                onRefresh={() => {
                  if (!busy) {
                    setRefreshing(true);
                    void load().finally(() => setRefreshing(false));
                  }
                }}
              />
            )
          }
          ListFooterComponent={
            <View style={s.messageSection}>
              {loading ? (
                <ActivityIndicator color={colors.accent} style={{ margin: 30 }} />
              ) : null}
              {loadError ? (
                <View style={s.errorBox}>
                  <Text style={s.error}>{loadError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void load()}
                    style={s.retry}
                  >
                    <Text style={s.link}>Повторить загрузку</Text>
                  </Pressable>
                </View>
              ) : null}
              {isEmpty ? (
                <View style={s.welcome}>
                  <View style={s.dateRow}>
                    <View style={s.dateLine} />
                    <Text style={s.date}>Сегодня</Text>
                    <View style={s.dateLine} />
                  </View>
                  <Text style={s.quickLabel}>С чего начнём?</Text>
                  <ActionRow
                    icon="camera"
                    title="Сфотографировать еду"
                    subtitle="Быстро добавить приём пищи"
                    disabled={busy}
                    onPress={() => void pick(Platform.OS !== "web")}
                  />
                  <ActionRow
                    icon="mic"
                    title="Рассказать голосом"
                    subtitle="Про еду или тренировку"
                    disabled={busy}
                    onPress={() => void voice.start()}
                  />
                  <ActionRow
                    icon="lines"
                    title="Написать в чат"
                    subtitle="Например: омлет из двух яиц"
                    disabled={busy}
                    onPress={() => input.current?.focus()}
                  />
                  <Text style={s.footerNote}>
                    Без форм и подсчётов. Просто расскажите о своём дне.
                  </Text>
                </View>
              ) : null}
              {history?.next_before ? (
                <Pressable
                  style={s.retry}
                  accessibilityRole="button"
                  onPress={() => void earlier()}
                >
                  <Text style={s.link}>Ранние записи ↑</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item, index: reverseIndex }) => {
            const index = timeline.length - 1 - reverseIndex;
            const dateHeader = index === 0 || timeline[index - 1].date !== item.date ? (
              <View style={s.dateRow}>
                <View style={s.dateLine} />
                <Text style={s.date}>
                  {item.date === day?.date ? "Сегодня" : item.date.split("-").reverse().join(".")}
                </Text>
                <View style={s.dateLine} />
              </View>
            ) : null;
            if (item.kind === "notice") {
              return <View style={s.exchange}>{dateHeader}<GoalReachedChatCard notice={item.notice} time={clock(item.createdAt)} /></View>;
            }
            if (item.kind === "pending") {
              const message = item.message;
              return (
                <View style={s.exchange}>
                  {dateHeader}
                  <View style={s.userGroup}>
                    <Text style={s.sender}>Вы</Text>
                    {message.photos?.length ? (
                      <View style={s.sentPhotos}>
                        {message.photos.map((uri) => <PhotoPreview key={uri} uri={uri} style={s.sentPhoto} />)}
                      </View>
                    ) : null}
                    {message.voiceUri ? <VoiceBubble uri={message.voiceUri} seconds={message.voiceSeconds ?? 0} /> : null}
                    {message.text ? <View style={s.userBubble}><Text style={s.bodyText}>{message.text}</Text></View> : null}
                  </View>
                  <ProcessingStatus status="uploading" hasPhotos={Boolean(message.photos?.length)} correcting={Boolean(correction)} />
                </View>
              );
            }
            if (item.kind === "operation") {
              const op = item.operation;
              const local = operationMessages[op.id] ?? (pending?.requestKey === op.request_key ? pending : undefined);
              const media = history?.media.filter((file) => file.operation_id === op.id) ?? [];
              const remotePhotos = media.filter((file) => file.mime.startsWith("image/"));
              const cardPhotos = remotePhotos.length
                ? remotePhotos.map((file, i) => ({ uri: API_URL + file.url, previewUri: local?.photos?.[i] }))
                : (local?.photos ?? []).map((uri) => ({ uri }));
              const audio = media.find((file) => file.mime.startsWith("audio/"));
              const voiceUri = audio ? API_URL + audio.url : local?.voiceUri;
              const message = op.text || local?.text;
              const processing = op.status === "queued" || op.status === "running";
              const limited = op.status === "failed" && Boolean(op.limit_reached || isLegacyLimitMessage(op.error));
              return (
                <View style={s.exchange}>
                  {dateHeader}
                  {message || voiceUri || (processing && cardPhotos.length > 0) ? (
                    <View style={s.userGroup}>
                      <Text style={s.sender}>Вы</Text>
                      {processing && cardPhotos.length ? (
                        <View style={s.sentPhotos}>
                          {cardPhotos.map((photo) => <PhotoPreview key={photo.uri} {...photo} style={s.sentPhoto} />)}
                        </View>
                      ) : null}
                      {voiceUri ? <VoiceBubble uri={voiceUri} seconds={local?.voiceSeconds ?? 0} /> : null}
                      {message ? <View style={s.userBubble}><Text style={s.bodyText}>{message}</Text></View> : null}
                    </View>
                  ) : null}
                  {processing ? (
                    <ProcessingStatus status={op.status as "queued" | "running"} hasPhotos={cardPhotos.length > 0} correcting={op.kind === "correct"} />
                  ) : op.status === "done" && op.result?.status === "weight_saved" ? (
                    <WeightChatCard weight={op.result.weight.weight_kg} time={clock(op.created_at)} photos={cardPhotos} />
                  ) : (
                    <AnalysisFailureCard
                      message={limited ? "Не удалось обработать запись: достигнут дневной лимит." : op.error ?? op.result?.message ?? "Не удалось обработать запись."}
                      photos={cardPhotos}
                      time={clock(op.created_at)}
                      disabled={busy}
                      onLimit={limited ? () => {
                        markLimitShown(op.id);
                        void openLimit(op.limit_reached, operationLimitKind(op));
                      } : undefined}
                      onRetry={op.status === "failed" ? () => void retry(op) : undefined}
                    />
                  )}
                </View>
              );
            }
            const entry = item.entry;
            const ops =
              history?.operations.filter((o) => o.entry_id === entry.id && o.status === "done" && o.result?.status !== "unknown")
                .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) ?? [];
            const op = ops.at(-1);
            const media =
              history?.media.filter((m) =>
                ops.some((o) => o.id === m.operation_id),
              ) ?? [];
            const audio = media.find((m) => m.mime.startsWith("audio/"));
            const remotePhotos = media
              .filter((m) => m.mime.startsWith("image/"))
              .map((m) => API_URL + m.url);
            const localMessage = sent[entry.id] ?? (op ? operationMessages[op.id] : undefined);
            const message = op
              ? {
                  text: op.text,
                  photos: remotePhotos.length ? remotePhotos : localMessage?.photos,
                  voiceUri: audio ? API_URL + audio.url : localMessage?.voiceUri,
                  voiceSeconds: localMessage?.voiceSeconds ?? (audio ? 0 : undefined),
                }
              : localMessage;
            const when = clock(entry.created_at);
            const activity = entry.entry_type === "activity";
            const water = entry.entry_type === "water";
            const revised = previousCalories[entry.id] !== undefined;
            return (
              <View key={entry.id} style={s.exchange}>
                {dateHeader}
                {message && (message.voiceUri || message.text || ops.some((o) => o.text)) ? (
                  <View style={s.userGroup}>
                    <Text style={s.sender}>Вы</Text>
                    {message.voiceUri ? (
                      <VoiceBubble
                        uri={message.voiceUri}
                        seconds={message.voiceSeconds ?? 0}
                      />
                    ) : null}
                    {ops.length ? (
                      ops.map((o) =>
                        o.text ? (
                          <View key={o.id} style={s.userBubble}>
                            {o.kind === "correct" ? (
                              <Text style={s.small}>Уточнение</Text>
                            ) : null}
                            <Text style={s.bodyText}>{o.text}</Text>
                          </View>
                        ) : null,
                      )
                    ) : message.text ? (
                      <View style={s.userBubble}>
                        <Text style={s.bodyText}>{message.text}</Text>
                      </View>
                    ) : null}
                    {when ? (
                      <View style={s.messageMeta}>
                        <Text style={s.time}>{when}</Text>
                        <Icon name="check" size={12} color={colors.accent} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {revised && !activity && !water ? (
                  <View style={s.assistantBubble}>
                    <Text style={s.bodyText}>Уточнила порцию.</Text>
                  </View>
                ) : null}
                {revised && water ? (
                  <View style={s.assistantBubble}>
                    <Text style={s.bodyText}>Уточнила объём.</Text>
                  </View>
                ) : null}
                <EntryCard
                  entry={entry}
                  disabled={busy}
                  fromPhoto={Boolean(message?.photos?.length)}
                  photos={(message?.photos ?? []).map((uri, i) => ({ uri, previewUri: localMessage?.photos?.[i] }))}
                  previousCalories={
                    water ? undefined : previousCalories[entry.id]
                  }
                  time={when}
                  onCorrect={() => correct(entry)}
                  onDeleted={() => entryDeleted(entry.id)}
                  onFavoriteChange={(favoriteId) => {
                    const update = (item: Entry) => item.id === entry.id ? { ...item, favorite_id: favoriteId } : item;
                    setHistory((current) => current ? { ...current, entries: current.entries.map(update) } : current);
                    setDay((current) => current ? { ...current, entries: current.entries.map(update) } : current);
                  }}
                />
                {notedId === entry.id ? (
                  <View style={s.note}>
                    <Text style={s.noteText}>
                      Любую запись можно исправить прямо в чате.
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
        <View style={s.composerArea}>
          {error ? (
            <View style={s.composerNotice}>
              <Text accessibilityRole="alert" style={s.composerNoticeText}>{error}</Text>
              <IconButton name="close" label="Скрыть сообщение" onPress={() => setError(null)} />
            </View>
          ) : null}
          {correction ? (
            <View style={s.correction}>
              <View style={s.headerText}>
                <Text style={s.link}>Уточняем запись</Text>
                <Text numberOfLines={1} style={s.small}>
                  {correction.title}
                </Text>
              </View>
              <IconButton
                name="close"
                label="Отменить исправление"
                disabled={busy}
                onPress={() => setCorrection(null)}
              />
            </View>
          ) : null}
          {photos.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.photoStrip}
            >
              {photos.map((item) => (
                <View key={item.uri} style={s.thumbWrap}>
                  <Image
                    source={{ uri: item.uri }}
                    style={s.thumbnail}
                    accessibilityLabel="Выбранное фото"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Убрать фото"
                    disabled={busy}
                    onPress={() => removePhoto(item.uri)}
                    style={s.thumbRemove}
                  >
                    <Icon name="close" size={12} color="white" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
          {voice.visible ? (
            <VoiceSheet
              recording={voice.recording}
              seconds={voice.seconds}
              draft={voice.draft}
              transcribing={voice.transcribing}
              transcript={voice.transcript}
              error={voice.error}
              onChange={voice.setTranscript}
              onClose={voice.cancel}
              onRetry={voice.retry}
              onSend={sendVoice}
            />
          ) : (
            <View style={s.composerRow}>
              <View style={s.inputWrap}>
                {!correction ? (
                  <IconButton
                    name="clip"
                    label="Выбрать фото из галереи"
                    disabled={busy}
                    onPress={() => void pick(false)}
                  />
                ) : null}
                <TextInput
                  ref={input}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  accessibilityLabel={
                    photos.length > 0
                      ? "Подпись к фото"
                      : correction
                        ? "Что исправить в записи"
                        : "Сообщение о еде или активности"
                  }
                  value={text}
                  onChangeText={setText}
                  multiline
                  maxLength={2000}
                  editable={!busy}
                  placeholder={
                    photos.length > 0
                      ? "Подпись"
                      : correction
                        ? "Что исправить?"
                        : "Сообщение Тарелке…"
                  }
                  placeholderTextColor={colors.muted}
                  style={s.input}
                />
                {busy ? (
                  <View style={s.busy}>
                    <ActivityIndicator color="white" />
                  </View>
                ) : text.trim() || photos.length > 0 ? (
                  <IconButton
                    name="arrow"
                    label={
                      photos.length > 0
                        ? "Отправить фото"
                        : correction
                          ? "Сохранить исправление"
                          : "Отправить сообщение"
                    }
                    filled
                    onPress={() => void submit()}
                  />
                ) : !correction ? (
                  <>
                    <IconButton
                      name="camera"
                      label="Сфотографировать еду"
                      onPress={() => void pick(Platform.OS !== "web")}
                    />
                    <IconButton
                      name="mic"
                      label="Записать голосовое сообщение"
                      onPress={() => void voice.start()}
                    />
                  </>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
      {mediaPermission ? <MediaPermissionDialog key={mediaPermission} kind={mediaPermission} onClose={() => setMediaPermission(null)} /> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, width: "100%", maxWidth: 600, alignSelf: "center" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  headerMark: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  status: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  headerText: { flex: 1, gap: 2 },
  brand: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.4,
  },
  tagline: { color: colors.muted, fontSize: 10 },
  messages: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexGrow: 1,
  },
  messageGap: { height: 16 },
  messageSection: { gap: 16 },
  date: {
    color: colors.muted,
    fontSize: 10,
    textAlign: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#eaf0e4",
    borderRadius: 10,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  dateLine: { flex: 1, height: 1, backgroundColor: colors.border },
  welcome: { gap: 8 },
  assistantBubble: {
    padding: 18,
    borderRadius: 22,
    borderTopLeftRadius: 6,
    backgroundColor: "white",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 4,
    paddingLeft: 4,
  },
  bodyText: { fontSize: 15, lineHeight: 22, color: colors.text },
  action: {
    backgroundColor: "white",
    borderRadius: 17,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 68,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  actionSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  footerNote: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 8,
  },
  exchange: { gap: 10 },
  sender: { color: colors.muted, fontSize: 11, paddingRight: 6 },
  messageMeta: { flexDirection: "row", alignItems: "center", gap: 2 },
  userGroup: { alignItems: "flex-end", gap: 6 },
  userBubble: {
    maxWidth: "86%",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#e1edce",
    borderRadius: 21,
    borderBottomRightRadius: 6,
  },
  sentPhotos: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    width: 300,
    maxWidth: "100%",
  },
  sentPhoto: { width: 96, height: 96, borderRadius: 12 },
  time: { fontSize: 11, color: colors.muted, marginRight: 4 },
  voiceBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "white",
    borderRadius: 18,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 14,
    width: 250,
  },
  play: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceTime: {
    color: colors.muted,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  processing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  processingText: { flex: 1, gap: 4 },
  processingTitle: { color: colors.accentDark, fontSize: 14, fontWeight: "600" },
  note: {
    backgroundColor: "#f6f1c4",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noteText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  composerArea: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerRow: { flexDirection: "row", alignItems: "center" },
  composerNotice: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 2, paddingVertical: 4, borderRadius: 14, backgroundColor: colors.bg },
  composerNoticeText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 19 },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 2,
    paddingRight: 4,
    paddingVertical: 2,
    borderRadius: 24,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 12,
    paddingHorizontal: 4,
    minHeight: 48,
    maxHeight: 120,
  },
  busy: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  correction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  photoStrip: { gap: 8, paddingHorizontal: 4, paddingTop: 4 },
  thumbWrap: { width: 84, height: 84 },
  thumbnail: { width: 84, height: 84, borderRadius: 12 },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#182c23cc",
    alignItems: "center",
    justifyContent: "center",
  },
  small: { fontSize: 12, lineHeight: 18, color: colors.muted },
  error: { fontSize: 13, lineHeight: 19, color: colors.danger },
  errorBox: {
    padding: 14,
    backgroundColor: colors.dangerSoft,
    borderRadius: 16,
    gap: 8,
  },
  retry: { paddingVertical: 8 },
  link: { fontSize: 13, fontWeight: "600", color: colors.accentDark },
});
