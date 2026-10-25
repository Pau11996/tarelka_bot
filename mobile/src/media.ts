import { Platform } from "react-native";

export type LocalMedia = {
  uri: string;
  name: string;
  type: string;
  file?: File;
};

/** Expo fetch requires readable file bytes, not RN's legacy URI descriptor. */
export async function appendMedia(
  form: FormData,
  field: string,
  media: LocalMedia,
) {
  if (Platform.OS === "web") {
    const blob = media.file ?? (await (await fetch(media.uri)).blob());
    form.append(field, blob, media.name);
  } else {
    const { File } = await import("expo-file-system");
    const file = new File(media.uri);
    if (!file.exists) {
      throw new Error("Файл больше недоступен. Выберите фото или запишите голосовое заново.");
    }
    form.append(field, file);
  }
}
