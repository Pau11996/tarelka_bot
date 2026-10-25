import { Platform } from "react-native";
import { API_URL } from "./config";
import { ApiError } from "./api";

export type PrivateImage = { uri: string; dispose: () => void };

/** Fetch with the app's authenticated transport; Image receives only a local URI. */
export async function loadPrivateImage(
  uri: string,
  token: string | null,
  signal: AbortSignal,
): Promise<PrivateImage> {
  if (!uri.startsWith(`${API_URL}/v1/media/`)) {
    throw new Error("Неизвестный адрес фото");
  }
  if (!token) throw new ApiError(401, "Нужен вход");
  if (signal.aborted) throw new Error("Загрузка отменена");
  const response = await fetch(uri, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new ApiError(response.status, "Не удалось загрузить фото");
  const mime = response.headers.get("Content-Type")?.split(";")[0].toLowerCase() ?? "";
  if (!mime.startsWith("image/")) throw new Error("Сервер не вернул фото");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error("Не удалось прочитать фото");
  }
  if (signal.aborted) throw new Error("Загрузка отменена");
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    return { uri: url, dispose: () => URL.revokeObjectURL(url) };
  }
  const { File, Paths } = await import("expo-file-system");
  if (signal.aborted) throw new Error("Загрузка отменена");
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" }[mime] ?? "img";
  const file = new File(Paths.cache, `tarelka-photo-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  const dispose = () => {
    try {
      if (file.exists) file.delete();
    } catch {
      // Cache eviction must not break closing the photo or signing out.
    }
  };
  try {
    await file.write(bytes);
    if (signal.aborted) throw new Error("Загрузка отменена");
    return { uri: file.uri, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
