import { Platform } from "react-native";

export const API_URL = (
  (Platform.OS === "web" ? process.env.EXPO_PUBLIC_WEB_API_URL : undefined) ??
  process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001"
).replace(/\/$/, "");
export const SITE_URL = (
  process.env.EXPO_PUBLIC_SITE_URL ?? "https://tarelkaa.by"
).replace(/\/$/, "");
