import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { api } from "./api";

type GoogleNative = {
  signIn(clientId: string, nonce: string): Promise<string | null>;
  signOut(): Promise<void>;
};

function nativeModule() {
  return Platform.OS === "android"
    ? requireOptionalNativeModule<GoogleNative>("TarelkaGoogleSignIn")
    : null;
}

export const supportsGoogleSignIn = Platform.OS === "android";
export type GoogleAttempt = { challenge_id: string; id_token: string; timezone: string };
export type GoogleLoginResult = { access_token: string } | { status: "password_required"; email: string };

export async function startGoogleSignIn(): Promise<GoogleAttempt | null> {
  const native = nativeModule();
  if (!native) throw new Error("Для входа через Google обновите приложение.");
  const challenge = await api<{ challenge_id: string; nonce: string; web_client_id: string }>(
    "/v1/auth/google/start", { method: "POST" },
  );
  const idToken = await native.signIn(challenge.web_client_id, challenge.nonce);
  if (!idToken) return null;
  return { challenge_id: challenge.challenge_id, id_token: idToken,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow" };
}

export function finishGoogleSignIn(attempt: GoogleAttempt, password?: string) {
  return api<GoogleLoginResult>("/v1/auth/google/login", {
    json: { ...attempt, ...(password === undefined ? {} : { password }) },
  });
}

export async function clearGoogleSignIn() {
  await nativeModule()?.signOut();
}
