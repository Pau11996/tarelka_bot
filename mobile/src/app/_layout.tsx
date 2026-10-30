import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "../auth";
import { Loading } from "../ui";
import { NotificationListener } from "../components/NotificationListener";
import { AssistantAccess } from "../components/AssistantAccess";
import { RequestLimitProvider } from "../components/RequestLimitDialog";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "../theme";
import { DeviceHealthSync } from "../components/DeviceHealthSync";
import { WorkoutsProvider } from "../workouts/context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WorkoutsProvider>
          <AssistantAccess>
            <RequestLimitProvider>
              <NotificationListener />
              <DeviceHealthSync />
              <StatusBar style="dark" />
              <AuthenticatedStack />
            </RequestLimitProvider>
          </AssistantAccess>
        </WorkoutsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function AuthenticatedStack() {
  const { ready, token } = useAuth();
  if (!ready) return <Loading />;
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={!token}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="account" options={{ headerShown: false, presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } }} />
        <Stack.Screen
          name="add"
          options={{ title: "Добавить", presentation: "modal" }}
        />
        <Stack.Screen name="entry/[id]" options={{ title: "Запись" }} />
        <Stack.Screen name="favorite/[id]" options={{ title: "Избранное" }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="assistant" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="weight" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="health" options={{ headerShown: false }} />
        <Stack.Screen name="workout/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="workout/player" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="workout/settings" options={{ headerShown: false }} />
        <Stack.Screen name="workout/result/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="settings/[section]" options={{ headerShown: false }} />
        <Stack.Screen name="pay" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
