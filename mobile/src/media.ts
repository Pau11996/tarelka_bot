import { Platform } from "react-native";

export type LocalMedia = { uri: string; name: string; type: string; file?: File };

/** RN's FormData accepts a URI descriptor; browsers require an actual Blob. */
export async function appendMedia(form: FormData, field: string, media: LocalMedia) {
  if (Platform.OS === "web") {
    const blob = media.file ?? await (await fetch(media.uri)).blob();
    form.append(field, blob, media.name);
  } else {
    form.append(field, { uri: media.uri, name: media.name, type: media.type } as unknown as Blob);
  }
}
