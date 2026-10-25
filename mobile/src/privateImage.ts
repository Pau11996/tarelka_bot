import { Platform } from "react-native";
import { API_URL } from "./config";
import { ApiError } from "./api";
import type { Directory } from "expo-file-system";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CACHE_BYTES = 100 * 1024 * 1024;
const MAX_CACHE_IMAGES = 100;

export type PrivateImage = {
  uri: string;
  dispose: () => void;
  invalidate: () => void;
};

type CachedImage = {
  uri: string;
  size: number;
  users: number;
  exists: () => boolean;
  remove: () => void;
};
type Download = {
  controller: AbortController;
  promise: Promise<CachedImage>;
  users: number;
  settled: boolean;
  heldImage?: CachedImage;
};
type Session = {
  token: string;
  closed: boolean;
  entries: Map<string, CachedImage>;
  downloads: Map<string, Download>;
  directory?: Promise<Directory>;
  initialized?: Promise<void>;
};

let session: Session | null = null;

async function digest(value: string) {
  const crypto = await import("expo-crypto");
  return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value);
}

function directoryFor(cache: Session) {
  return cache.directory ??= (async () => {
    const [{ Directory, Paths }, scope] = await Promise.all([
      import("expo-file-system"), digest(`${API_URL}\n${cache.token}`),
    ]);
    return new Directory(Paths.cache, "tarelka-private-photos", scope);
  })();
}

/** Called by auth before exposing a session, and on logout/account changes. */
export async function setPrivateImageSession(token: string | null): Promise<void> {
  if (session?.token === token) return;
  const previous = session;
  session = token ? { token, closed: false, entries: new Map(), downloads: new Map() } : null;
  if (!previous) return;
  previous.closed = true;
  for (const download of previous.downloads.values()) download.controller.abort();
  for (const entry of previous.entries.values()) entry.remove();
  previous.entries.clear();
  if (Platform.OS !== "web") {
    try {
      const directory = await directoryFor(previous);
      if (directory.exists) directory.delete();
    } catch {
      // Cache eviction or a missing directory must not prevent signing out.
    }
  }
}

function check(cache: Session, signal: AbortSignal) {
  if (cache.closed || cache !== session || signal.aborted) throw new Error("Загрузка отменена");
}

function safelyRemove(remove: () => void) {
  try { remove(); } catch { /* The OS may have evicted the cached file already. */ }
}

function trim(cache: Session) {
  let size = [...cache.entries.values()].reduce((total, entry) => total + entry.size, 0);
  // Map insertion order is LRU. Visible images are pinned until their last user closes.
  for (const [key, entry] of cache.entries) {
    if (size <= MAX_CACHE_BYTES && cache.entries.size <= MAX_CACHE_IMAGES) break;
    if (entry.users) continue;
    cache.entries.delete(key);
    size -= entry.size;
    entry.remove();
  }
}

function diskEntry(file: import("expo-file-system").File): CachedImage {
  return {
    uri: file.uri, size: file.size, users: 0,
    exists: () => file.exists && file.size > 0,
    remove: () => safelyRemove(() => { if (file.exists) file.delete(); }),
  };
}

async function initialize(cache: Session) {
  return cache.initialized ??= (async () => {
    if (Platform.OS === "web") return;
    const directory = await directoryFor(cache);
    if (cache.closed) return;
    directory.create({ intermediates: true, idempotent: true });
    const { File } = await import("expo-file-system");
    if (cache.closed) return;
    const files = directory.list().filter((file): file is InstanceType<typeof File> => file instanceof File);
    files.sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
    for (const file of files) {
      const match = /^([a-f0-9]{64})-.+\.(jpg|png|webp|heic|heif|img)$/.exec(file.name);
      if (!match || !file.size || file.size > MAX_FILE_BYTES) {
        safelyRemove(() => file.delete());
        continue;
      }
      cache.entries.get(match[1])?.remove();
      cache.entries.set(match[1], diskEntry(file));
    }
    trim(cache);
  })().catch((error: unknown) => {
    cache.initialized = undefined;
    throw error;
  });
}

async function downloadImage(cache: Session, key: string, uri: string, signal: AbortSignal): Promise<CachedImage> {
  const response = await fetch(uri, {
    headers: { Authorization: `Bearer ${cache.token}` }, signal, cache: "no-store",
  });
  if (!response.ok) throw new ApiError(response.status, "Не удалось загрузить фото");
  const mime = response.headers.get("Content-Type")?.split(";")[0].toLowerCase() ?? "";
  if (!mime.startsWith("image/")) throw new Error("Сервер не вернул фото");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error("Не удалось прочитать фото");
  check(cache, signal);
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    return { uri: url, size: bytes.byteLength, users: 0, exists: () => true, remove: () => URL.revokeObjectURL(url) };
  }
  const [{ File }, directory] = await Promise.all([import("expo-file-system"), directoryFor(cache)]);
  check(cache, signal);
  directory.create({ intermediates: true, idempotent: true });
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" }[mime] ?? "img";
  const name = `${key}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const partial = new File(directory, `${name}.part`);
  const file = new File(directory, `${name}.${extension}`);
  try {
    // Incomplete writes must never be mistaken for cached photos after a restart.
    await partial.write(bytes);
    check(cache, signal);
    await partial.move(file);
    check(cache, signal);
    return diskEntry(file);
  } catch (error) {
    safelyRemove(() => { if (partial.exists) partial.delete(); });
    safelyRemove(() => { if (file.exists) file.delete(); });
    throw error;
  }
}

function sharedDownload(cache: Session, key: string, uri: string): Download {
  let download = cache.downloads.get(key);
  if (!download) {
    const controller = new AbortController();
    const next: Download = { controller, users: 0, settled: false, promise: undefined! };
    next.promise = downloadImage(cache, key, uri, controller.signal)
      .then((entry) => {
        try { check(cache, controller.signal); } catch (error) {
          entry.remove();
          throw error;
        }
        // Keep the file pinned until waiting viewers have acquired their own leases.
        entry.users++;
        next.heldImage = entry;
        cache.entries.set(key, entry);
        return entry;
      })
      .finally(() => {
        next.settled = true;
        releaseDownloadHold(next);
        if (cache.downloads.get(key) === next) cache.downloads.delete(key);
      });
    cache.downloads.set(key, next);
    download = next;
  }
  return download;
}

function releaseDownloadHold(download: Download) {
  if (download.users === 0 && download.heldImage) {
    download.heldImage.users--;
    download.heldImage = undefined;
  }
}

function waitForDownload(cache: Session, key: string, download: Download, signal: AbortSignal): Promise<CachedImage> {
  download.users++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const leave = () => {
      finished = true;
      signal.removeEventListener("abort", abort);
      if (--download.users === 0) {
        releaseDownloadHold(download);
        if (!download.settled) {
          download.controller.abort();
          if (cache.downloads.get(key) === download) cache.downloads.delete(key);
        }
      }
    };
    const abort = () => {
      if (finished) return;
      leave();
      reject(new Error("Загрузка отменена"));
    };
    signal.addEventListener("abort", abort, { once: true });
    download.promise.then((entry) => {
      if (finished) return;
      entry.users++;
      leave();
      resolve(entry);
    }, (error: unknown) => {
      if (finished) return;
      leave();
      reject(error);
    });
    if (signal.aborted) abort();
  });
}

/** Reuse one account-scoped image across chat, details and the full-screen viewer. */
export async function loadPrivateImage(uri: string, token: string | null, signal: AbortSignal): Promise<PrivateImage> {
  if (!uri.startsWith(`${API_URL}/v1/media/`)) throw new Error("Неизвестный адрес фото");
  if (!token || session?.token !== token) throw new ApiError(401, "Нужен вход");
  const cache = session;
  check(cache, signal);
  // Web uses the URI directly; native filenames never contain the access token.
  const key = Platform.OS === "web" ? uri : await digest(uri);
  await initialize(cache);
  check(cache, signal);
  let entry = cache.entries.get(key);
  if (entry && !entry.exists()) {
    entry.remove();
    cache.entries.delete(key);
    entry = undefined;
  }
  if (entry) entry.users++;
  else entry = await waitForDownload(cache, key, sharedDownload(cache, key, uri), signal);
  try { check(cache, signal); } catch (error) {
    entry.users--;
    trim(cache);
    throw error;
  }
  const image = entry;
  cache.entries.delete(key);
  cache.entries.set(key, image);
  trim(cache);
  let released = false;
  return {
    uri: image.uri,
    dispose: () => {
      if (released) return;
      released = true;
      image.users--;
      trim(cache);
    },
    invalidate: () => {
      if (cache.entries.get(key) === image) cache.entries.delete(key);
      image.remove();
    },
  };
}
