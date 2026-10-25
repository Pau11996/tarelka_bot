import { useEffect } from "react";
import { Platform } from "react-native";
import type { NotificationResponse } from "expo-notifications";
import { router } from "expo-router";
import { useAuth } from "../auth";
import { getNotifications, notificationPath, registerPush } from "../notifications";
import { api } from "../api";
export function NotificationListener() {
  const { token } = useAuth();
  useEffect(() => {
    if (!token || Platform.OS === "web") return;
    const Notifications = getNotifications();
    if (!Notifications) return;
    void api<{ notification_channel: string }>("/v1/settings", { token })
      .then((s) => {
        if (s.notification_channel === "app") return registerPush(token);
      })
      .catch(() => undefined);
    function open(response: NotificationResponse | null) {
      const path = notificationPath(
        response?.notification.request.content.data?.path,
      );
      if (path) {
        router.push(path as any);
        void Notifications?.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    }
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const listener =
      Notifications.addNotificationResponseReceivedListener(open);
    return () => listener.remove();
  }, [token]);
  return null;
}
