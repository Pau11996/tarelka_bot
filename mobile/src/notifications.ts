import { isRunningInExpoGo } from "expo";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";
const DEVICE_TOKEN_KEY = "tarelka.push_device_token";
// Importing the native module itself is unsupported in Expo Go on Android.
export function getNotifications(): typeof import("expo-notifications") | null {
  if (Platform.OS === "web" || isRunningInExpoGo()) return null;
  return require("expo-notifications");
}
const Notifications = getNotifications();
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
let registered: string | null = null;
export async function registerPush(token: string | null) {
  if (isRunningInExpoGo())
    throw new Error("Push недоступен в Expo Go. Пока выберите Telegram; уведомления проверим в отдельной сборке приложения.");
  if (!Notifications)
    throw new Error("Уведомления доступны в сборке приложения на телефоне.");
  if (Platform.OS === "web" || !Device.isDevice)
    throw new Error("Уведомления доступны в сборке приложения на телефоне.");
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId)
    throw new Error(
      "Push ещё не настроен для этой сборки. Пока выберите Telegram.",
    );
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "Тарелка",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted")
    permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Разрешите уведомления в настройках телефона или оставьте Telegram.",
    );
  registered = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await AsyncStorage.setItem(DEVICE_TOKEN_KEY, registered);
  await api("/v1/devices", {
    token,
    method: "POST",
    json: { token: registered, platform: Platform.OS },
  });
  return registered;
}
export async function unregisterPush(token: string | null) {
  registered = registered ?? await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
  if (registered) {
    await api("/v1/devices/unregister", {
      token,
      method: "POST",
      json: { token: registered, platform: Platform.OS },
    });
    registered = null;
    await AsyncStorage.removeItem(DEVICE_TOKEN_KEY);
  }
}
export { allowedNotificationPath as notificationPath } from "./chartMath";
