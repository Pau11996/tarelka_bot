import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { api, ApiError, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { formatLimitReset, isLegacyLimitMessage, type RequestKind, type RequestLimitInfo } from "../requestLimits";
import { colors } from "../theme";
import { PrimaryButton, SecondaryButton } from "../ui";
import { Icon } from "./Brand";

type LimitContext = {
  handleLimit: (error: unknown, kind: RequestKind) => Promise<boolean>;
  openLimit: (info: RequestLimitInfo | null | undefined, kind: RequestKind) => Promise<void>;
};
const Context = createContext<LimitContext | null>(null);

export function useRequestLimit() {
  const value = useContext(Context);
  if (!value) throw new Error("RequestLimitProvider is missing");
  return value;
}

export function RequestLimitProvider({ children }: { children: ReactNode }) {
  const { token, signOut } = useAuth();
  const account = useRef(token);
  account.current = token;
  const [info, setInfo] = useState<RequestLimitInfo | null>(null);
  useEffect(() => setInfo(null), [token]);
  const openLimit = useCallback(async (known: RequestLimitInfo | null | undefined, kind: RequestKind) => {
    try {
      const next = known ?? await api<RequestLimitInfo>(`/v1/request-limits?kind=${kind}`, { token });
      if (account.current !== token) return;
      Keyboard.dismiss();
      setInfo(next);
    } catch (caught) {
      const message = await apiFailureMessage(caught, "Не удалось загрузить информацию о лимите", signOut);
      if (message) Alert.alert("Лимит запросов", message);
    }
  }, [token, signOut]);
  const handleLimit = useCallback(async (error: unknown, kind: RequestKind) => {
    if (error instanceof ApiError && error.limitReached) {
      await openLimit(error.limitReached, kind);
      return true;
    }
    if (error instanceof Error && isLegacyLimitMessage(error.message)) {
      await openLimit(null, kind);
      return true;
    }
    return false;
  }, [openLimit]);
  return (
    <Context.Provider value={{ handleLimit, openLimit }}>
      {children}
      {info ? <RequestLimitDialog info={info} onClose={() => setInfo(null)} /> : null}
    </Context.Provider>
  );
}

export function RequestLimitDialog({ info, onClose }: { info: RequestLimitInfo; onClose: () => void }) {
  const expired = Date.parse(info.resets_at) <= Date.now() || info.used < info.limit;
  const shared = info.limit_mode === "shared";
  const label = shared ? "Запросы сегодня" : {
    photo: "Анализы фото сегодня", text: "Текстовые запросы сегодня", voice: "Голосовые запросы сегодня",
  }[info.kind];
  const alternatives = info.alternatives.map((kind) => ({ photo: "фото", text: "текст", voice: "голос" })[kind]).join(" и ");
  const canUpgrade = !expired && info.can_upgrade && !info.subscription_active;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaView style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть окно лимита" accessibilityRole="button" />
        <View style={s.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.top}>
              <View style={s.icon}><Icon name="clock" size={26} color={colors.accent} /></View>
              <Pressable style={s.close} accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose}>
                <Icon name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <Text accessibilityRole="header" style={s.title}>{expired ? "Можно попробовать снова" : "Достигнут дневной лимит"}</Text>
            <Text style={s.description}>
              {expired ? "Дневной лимит обновился. Вернитесь к записи и отправьте её снова." : "Новые запросы этого типа будут доступны после обновления лимита."}
            </Text>
            {!expired ? (
              <View style={s.usage}>
                <View style={s.row}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={s.count}>{info.used} / {info.limit}</Text>
                </View>
                <View style={s.track}><View style={s.fill} /></View>
                <Text style={s.reset}>Обновится {formatLimitReset(info)}</Text>
                <Text style={s.timezone}>Часовой пояс: {info.timezone}</Text>
              </View>
            ) : null}
            {!expired && info.subscription_active ? (
              <Text style={s.note}>Подписка активна. Её продление не сбрасывает дневной лимит.</Text>
            ) : null}
            {!expired && alternatives ? <Text style={s.note}>Можно использовать {alternatives}.</Text> : null}
            {canUpgrade ? (
              <>
                <Text style={s.note}>С подпиской — до {info.upgrade_limit} {info.kind === "photo" ? "анализов фото" : info.kind === "voice" ? "голосовых запросов" : "текстовых запросов"} в день.</Text>
                <PrimaryButton label="Посмотреть подписку" onPress={() => { onClose(); router.push("/pay"); }} />
                <SecondaryButton label="Не сейчас" onPress={onClose} />
              </>
            ) : <PrimaryButton label="Понятно" onPress={onClose} />}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: "#10251b80" },
  card: { width: "100%", maxWidth: 420, maxHeight: "90%", backgroundColor: colors.surface, borderRadius: 26, overflow: "hidden" },
  content: { padding: 24, gap: 16 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  icon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700", color: colors.text },
  description: { fontSize: 15, lineHeight: 22, color: colors.muted },
  usage: { padding: 16, backgroundColor: colors.bg, borderRadius: 16, gap: 8 },
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  label: { fontSize: 13, color: colors.muted },
  count: { fontSize: 20, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
  track: { height: 6, backgroundColor: colors.soft, borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  fill: { height: "100%", width: "100%", backgroundColor: colors.accent },
  reset: { fontSize: 14, fontWeight: "500", color: colors.text },
  timezone: { fontSize: 12, color: colors.muted },
  note: { fontSize: 14, lineHeight: 21, color: colors.text },
});
