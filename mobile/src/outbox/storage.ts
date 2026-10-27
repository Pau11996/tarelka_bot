import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { API_URL } from "../config";
import type { LocalMedia } from "../media";
import type { OutboxData, OutboxStorage } from "./queue";

const PREFIX = "tarelka.outbox.v1.";

/** Native files live in documents, since picker/cache files can be evicted. */
export async function createOutboxStorage(token: string): Promise<OutboxStorage> {
  if (Platform.OS === "web") {
    let data: OutboxData | null = null;
    return {
      read: async () => data, write: async next => { data = next; },
      prepare: async item => item, release: async () => {}, clear: async () => { data = null; },
    };
  }
  const [{ Directory, File, Paths }, crypto] = await Promise.all([
    import("expo-file-system"), import("expo-crypto"),
  ]);
  const scope = await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, `${API_URL}\n${token}`);
  const key = PREFIX + scope;
  const root = new Directory(Paths.document, "tarelka-outbox");
  const directory = new Directory(root, scope);
  // A killed app may have missed logout cleanup; never restore another session.
  const staleKeys = (await AsyncStorage.getAllKeys()).filter(value => value.startsWith(PREFIX) && value !== key);
  if (staleKeys.length) await AsyncStorage.multiRemove(staleKeys);
  if (root.exists) for (const child of root.list()) if (child.name !== scope) child.delete();
  const messageDirectory = (requestKey: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(requestKey)) throw new Error("Invalid outbox key");
    return new Directory(directory, requestKey);
  };
  return {
    async read() {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw) as OutboxData;
      if (!Array.isArray(data.items) || !data.anchors || data.items.some(item =>
        !/^[a-zA-Z0-9_-]+$/.test(item.requestKey) || !Array.isArray(item.photos))) throw new Error("Invalid outbox");
      return data;
    },
    async write(data) { await AsyncStorage.setItem(key, JSON.stringify(data)); },
    async prepare(item) {
      const folder = messageDirectory(item.requestKey);
      folder.create({ intermediates: true, idempotent: true });
      const copy = async (media: LocalMedia, name: string): Promise<LocalMedia> => {
        const extension = media.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? ".bin";
        const destination = new File(folder, name + extension);
        if (!destination.exists || !destination.size) {
          const source = new File(media.uri);
          if (!source.exists) throw new Error("Missing attachment");
          // A partial copy must never be mistaken for a finished attachment after restart.
          const partial = new File(folder, name + ".part");
          if (partial.exists) partial.delete();
          await source.copy(partial);
          if (destination.exists) destination.delete();
          await partial.move(destination);
        }
        return { uri: destination.uri, name: media.name, type: media.type };
      };
      const photos: LocalMedia[] = [];
      for (let i = 0; i < item.photos.length; i++) photos.push(await copy(item.photos[i], `photo-${i}`));
      const voiceMedia = item.voiceMedia ? await copy(item.voiceMedia, "voice") : undefined;
      return { ...item, photos, voiceMedia };
    },
    async release(item) {
      const folder = messageDirectory(item.requestKey);
      if (folder.exists) folder.delete();
    },
    async clear() {
      await AsyncStorage.removeItem(key);
      if (directory.exists) directory.delete();
    },
  };
}
