import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../../auth";
import { Icon, type IconName } from "../../components/Brand";
import { colors } from "../../theme";
import { Loading } from "../../ui";

export default function TabsLayout() {
  const { ready, token } = useAuth();
  if (!ready) return <Loading />;
  if (!token) return <Redirect href="/login" />;
  const tabIcon = (name: IconName) => ({ color, focused }: { color: string; focused: boolean }) => <View style={{ width: 44, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: focused ? colors.soft : "transparent" }}><Icon name={name} color={color} size={20} /></View>;
  return <Tabs initialRouteName="chat" screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: colors.accentDark, tabBarInactiveTintColor: colors.muted,
    tabBarLabelStyle: { fontSize: 10, fontWeight: "500", paddingBottom: 2 },
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
  }}>
    <Tabs.Screen name="chat" options={{ title: "Чат", tabBarIcon: tabIcon("chat") }} />
    <Tabs.Screen name="today" options={{ title: "Дневник", tabBarIcon: tabIcon("day") }} />
    <Tabs.Screen name="stats" options={{ title: "Статистика", tabBarIcon: tabIcon("stats") }} />
    <Tabs.Screen name="favorites" options={{ title: "Избранное", tabBarIcon: tabIcon("star") }} />
    <Tabs.Screen name="profile" options={{ title: "Настройки", tabBarIcon: tabIcon("settings") }} />
  </Tabs>;
}
