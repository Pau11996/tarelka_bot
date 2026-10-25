import { Fragment, useRef, useState } from "react";
import {
  ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text,
  useWindowDimensions, View,
} from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";
import { useAuth } from "../auth";
import { Icon, type IconName } from "./Brand";

type Destination = {
  title: string;
  detail?: string;
  icon: IconName;
  href: Href;
};

const sections: { title: string; items: Destination[] }[] = [
  {
    title: "Профиль",
    items: [
      { title: "Мой профиль", detail: "Личные данные и цель питания", icon: "profile", href: "/profile" },
      { title: "Подписка", icon: "sparkles", href: "/pay" },
    ],
  },
  {
    title: "Настройки",
    items: [
      { title: "Уведомления", icon: "bell", href: "/notifications" },
      { title: "Устройства и здоровье", icon: "device", href: "/health" },
      { title: "Аккаунт и данные", icon: "shield", href: "/settings/data" },
    ],
  },
  {
    title: "Помощь и обратная связь",
    items: [
      { title: "Как пользоваться Тарелкой", icon: "book", href: "/settings/guide" },
      { title: "Написать нам", icon: "chat", href: "/settings/feedback" },
    ],
  },
];

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Открыть меню аккаунта"
      onPress={() => { Keyboard.dismiss(); router.push("/account"); }}
      style={({ pressed }) => [s.trigger, compact && { paddingRight: 5 }, pressed && { opacity: 0.7 }]}
    >
      <View style={s.avatar}><Icon name="profile" size={18} color={colors.accentDark} /></View>
      {!compact ? <Text style={s.triggerText}>Аккаунт</Text> : null}
      {!compact ? <Icon name="down" size={14} color={colors.muted} /> : null}
    </Pressable>
  );
}

export function AccountPanel() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signingOut = useRef(false);
  const inset = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/chat");
  }

  function navigate(href: Href) {
    router.push(href);
  }

  async function logout() {
    if (signingOut.current) return;
    signingOut.current = true;
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch {
      setError("Не удалось выйти из аккаунта. Попробуйте ещё раз.");
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  }

  return (
        <View style={s.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Закрыть меню аккаунта"
            onPress={close}
          />
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            style={[s.menu, { height: Math.min(766, height - inset.top - 16) }]}
          >
            <View style={s.handleArea} accessible={false}>
              <View style={s.handle} />
            </View>
            <View style={s.heading}>
              <Text accessibilityRole="header" style={s.title}>Аккаунт</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Свернуть меню аккаунта"
                onPress={close}
                style={({ pressed }) => [s.close, pressed && { opacity: 0.6 }]}
              >
                <View style={s.closeSurface}>
                  <Icon name="close" size={20} />
                </View>
              </Pressable>
            </View>
            <ScrollView
              style={s.scroll}
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[s.content, { paddingBottom: Math.max(inset.bottom, 16) }]}
            >
              {sections.map(section => (
                <View key={section.title} style={s.group}>
                  <Text accessibilityRole="header" style={s.groupTitle}>{section.title}</Text>
                  <View style={s.card}>
                    {section.items.map((item, index) => (
                      <Fragment key={item.href.toString()}>
                        {index > 0 ? <View style={s.separator} /> : null}
                        <MenuRow item={item} onPress={() => navigate(item.href)} />
                      </Fragment>
                    ))}
                  </View>
                </View>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => navigate("/settings/invite")}
                style={({ pressed }) => [s.invite, pressed && { opacity: 0.7 }]}
              >
                <View style={[s.itemIcon, s.inviteIcon]}>
                  <Icon name="gift" size={19} color="#5e803d" />
                </View>
                <View style={s.itemCopy}>
                  <Text style={s.inviteTitle}>Пригласить друга</Text>
                  <Text style={s.inviteDetail}>Полезными привычками приятно делиться</Text>
                </View>
                <Icon name="chevron" size={15} color="#8b9a8b" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Выйти из аккаунта"
                accessibilityState={{ busy, disabled: busy }}
                disabled={busy}
                onPress={() => void logout()}
                style={({ pressed }) => [s.logout, pressed && { opacity: 0.6 }]}
              >
                {busy ? <ActivityIndicator size="small" color={colors.muted} /> : <Icon name="logout" size={17} color="#9a6255" />}
                <Text style={s.logoutText}>{busy ? "Выходим…" : "Выйти из аккаунта"}</Text>
              </Pressable>
              {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
              <View style={s.footer}>
                <Pressable accessibilityRole="button" onPress={() => navigate("/settings/documents")} style={s.footerLink}>
                  <Text style={s.footerText}>Документы</Text>
                </Pressable>
                <Text style={s.footerDot}>·</Text>
                <Pressable accessibilityRole="button" onPress={() => navigate("/settings/about")} style={s.footerLink}>
                  <Text style={s.footerText}>О приложении</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
  );
}

function MenuRow({ item, onPress }: { item: Destination; onPress: () => void }) {
  const profile = !!item.detail;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.item, profile && s.profileItem, pressed && s.itemPressed]}
    >
      <View style={[
        s.itemIcon,
        profile && s.profileIcon,
        item.icon === "device" && s.deviceIcon,
        item.icon === "sparkles" && s.subscriptionIcon,
      ]}>
        <Icon
          name={item.icon}
          size={profile ? 24 : 19}
          color={item.icon === "device" ? "#477a9b" : item.icon === "sparkles" ? "#9a843f" : colors.accentDark}
        />
      </View>
      <View style={s.itemCopy}>
        <Text style={[s.itemTitle, profile && s.profileTitle]}>{item.title}</Text>
        {item.detail ? <Text style={s.detail}>{item.detail}</Text> : null}
      </View>
      <Icon name="chevron" size={15} color="#8b9a8b" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  trigger: {
    flexDirection: "row", alignItems: "center", gap: 7,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: 24, padding: 5, paddingRight: 10, minHeight: 44,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.soft,
    alignItems: "center", justifyContent: "center",
  },
  triggerText: { fontSize: 12, fontWeight: "600", color: colors.text },
  overlay: { flex: 1, justifyContent: "flex-end", alignItems: "center", backgroundColor: "#182c2355" },
  menu: {
    width: "100%", maxWidth: 460, backgroundColor: "#fafbf8",
    borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: "hidden",
    boxShadow: "0px -8px 30px #182c2320",
  },
  handleArea: { height: 18, alignItems: "center", justifyContent: "center" },
  handle: { width: 35, height: 4, borderRadius: 4, backgroundColor: "#cbd5c5" },
  heading: { minHeight: 55, paddingLeft: 20, paddingRight: 14, paddingBottom: 7, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 23, lineHeight: 29, fontWeight: "700", letterSpacing: -0.6, color: colors.text },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeSurface: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#edf2e9" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 7 },
  group: { marginBottom: 16 },
  groupTitle: { fontSize: 10, lineHeight: 14, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase", color: colors.muted, marginBottom: 7, marginHorizontal: 2 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, overflow: "hidden" },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 54, marginRight: 12 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48 },
  itemPressed: { backgroundColor: colors.bg },
  itemIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#edf4e8", alignItems: "center", justifyContent: "center" },
  itemCopy: { flex: 1, gap: 4 },
  itemTitle: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.text },
  detail: { fontSize: 11, lineHeight: 16, color: colors.muted },
  profileItem: { minHeight: 68 },
  profileIcon: { width: 43, height: 43, borderRadius: 15 },
  profileTitle: { fontSize: 15, lineHeight: 20, letterSpacing: -0.2 },
  deviceIcon: { backgroundColor: "#edf4fa" },
  subscriptionIcon: { backgroundColor: "transparent" },
  invite: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, minHeight: 59, borderRadius: 16, backgroundColor: "#e9f1e1", borderWidth: 1, borderColor: "#dce7d3" },
  inviteIcon: { backgroundColor: "#f8fbf3" },
  inviteTitle: { fontSize: 12, lineHeight: 17, fontWeight: "600", color: colors.text },
  inviteDetail: { fontSize: 10, lineHeight: 14, color: "#637b57" },
  logout: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 },
  logoutText: { fontSize: 12, fontWeight: "500", color: "#9a6255" },
  error: { fontSize: 12, lineHeight: 18, color: colors.danger, textAlign: "center" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 2 },
  footerLink: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  footerText: { fontSize: 10, lineHeight: 15, color: "#82907f" },
  footerDot: { fontSize: 10, color: "#b3bdb0" },
});
