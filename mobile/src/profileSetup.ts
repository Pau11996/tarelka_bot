import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { authStorageKeys } from "./authStorage";
import { API_URL } from "./config";

function setupKey(userId: number) {
  return `${authStorageKeys(API_URL).token}.profile-setup.${userId}`;
}

export async function profileSetupDestination(token: string) {
  const user = await api<{ id: number; profile_complete: boolean }>("/v1/me", { token });
  if (user.profile_complete) return null;
  const dismissed = await AsyncStorage.getItem(setupKey(user.id));
  return dismissed === "done" ? null : user.id;
}

export async function dismissProfileSetup(userId: number) {
  await AsyncStorage.setItem(setupKey(userId), "done");
}
