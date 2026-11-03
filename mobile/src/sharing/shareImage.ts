import { Platform } from "react-native";
import { api } from "../api";
import type { DailyNorm } from "./dailyNorm";

export type ShareImage = { label: string; share: () => Promise<void> };
export async function renderNorm(norm: DailyNorm, token: string, signal: AbortSignal): Promise<string> {
  const result = await api<{ image_base64: string }>("/v1/share/daily-norm", { token, json: norm, signal });
  if (typeof result.image_base64 !== "string" || !result.image_base64.startsWith("iVBORw0KGgo")) {
    throw new Error("Invalid PNG");
  }
  return result.image_base64;
}

// Prepare before the click: browsers require share() during the user gesture.
export async function prepareShareImage(base64: string): Promise<ShareImage> {
  const filename = "tarelka-daily-norm.png";
  if (Platform.OS === "web") {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const file = new File([bytes], filename, { type: "image/png" });
    const canShare = typeof navigator.share === "function" && navigator.canShare?.({ files: [file] });
    return {
      label: canShare ? "Поделиться" : "Скачать картинку",
      async share() {
        if (canShare) {
          await navigator.share({ files: [file] });
        } else {
          const url = URL.createObjectURL(file);
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          // Allow the download to start before revoking its source.
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      },
    };
  }

  const [sharing, { File: NativeFile, Directory, Paths }] = await Promise.all([
    import("expo-sharing"), import("expo-file-system"),
  ]);
  if (!await sharing.isAvailableAsync()) throw new Error("Sharing unavailable");
  const directory = new Directory(Paths.cache, "daily-norm-shares");
  directory.create({ intermediates: true, idempotent: true });
  // Keep recently shared files alive: Android recipients may read them after
  // the share sheet closes. Expire only our own older exports on the next use.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const item of directory.list()) {
    if (item instanceof NativeFile && item.modificationTime && item.modificationTime < cutoff) {
      try { item.delete(); } catch { /* Cache eviction is best effort. */ }
    }
  }
  const file = new NativeFile(directory, `norm-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    await file.write(base64, { encoding: "base64" });
  } catch (error) {
    try { if (file.exists) file.delete(); } catch { /* Preserve the write error. */ }
    throw error;
  }
  return {
    label: "Поделиться",
    share: () => sharing.shareAsync(file.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Поделиться дневной нормой" }),
  };
}

export function shareCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
