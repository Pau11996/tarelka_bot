import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { API_URL } from "../config";
import { useAuth } from "../auth";
import { colors } from "../theme";
import { loadPrivateImage, type PrivateImage } from "../privateImage";

type Props = {
  uri: string;
  previewUri?: string;
  style: StyleProp<ImageStyle>;
};

export function ProtectedImage(props: Props) {
  const { token } = useAuth();
  // A different photo or account must never reuse the previous resolved image.
  return <Photo key={`${props.uri}:${token}`} {...props} token={token} />;
}

function Photo({
  uri,
  previewUri,
  style,
  token,
}: Props & { token: string | null }) {
  const [resolved, setResolved] = useState<PrivateImage | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const protectedMedia = uri.startsWith(`${API_URL}/`);
  useEffect(() => {
    if (!protectedMedia) return;
    setResolved(null);
    setStatus("loading");
    let active = true;
    let image: PrivateImage | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    void loadPrivateImage(uri, token, controller.signal)
      .then((loaded) => {
        image = loaded;
        if (active) setResolved(loaded);
        else loaded.dispose();
      })
      .catch((error) => {
        if (active) setStatus("error");
        if (active && __DEV__) {
          console.warn("[Photo download failed]", {
            status: error && typeof error.status === "number" ? error.status : undefined,
            reason: error instanceof Error ? error.message : "Photo unavailable",
          });
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      image?.dispose();
    };
  }, [uri, token, protectedMedia, attempt]);

  return (
    <View style={[s.frame, style as StyleProp<ViewStyle>]}>
      {previewUri && status !== "loaded" ? (
        <Image
          source={{ uri: previewUri }}
          style={s.image}
          resizeMode={StyleSheet.flatten(style)?.resizeMode ?? "cover"}
          accessibilityLabel="Фото еды"
        />
      ) : null}
      {(!protectedMedia || resolved) && status !== "error" ? (
        <Image
          key={attempt}
          source={{ uri: resolved?.uri ?? uri }}
          style={[s.image, status !== "loaded" && s.hidden]}
          resizeMethod="resize"
          resizeMode={StyleSheet.flatten(style)?.resizeMode ?? "cover"}
          accessibilityLabel="Фото еды"
          onLoad={() => setStatus("loaded")}
          onError={() => {
            resolved?.invalidate();
            setStatus("error");
          }}
        />
      ) : null}
      {status === "loading" && !previewUri ? (
        <View
          style={s.feedback}
          accessibilityRole="progressbar"
          accessibilityLabel="Загрузка фото"
        >
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={s.caption}>Загрузка фото…</Text>
        </View>
      ) : null}
      {status === "error" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Повторить загрузку фото"
          onPress={(event) => {
            event.stopPropagation();
            setResolved(null);
            setStatus("loading");
            setAttempt((value) => value + 1);
          }}
          style={[s.feedback, previewUri && s.overPreview]}
        >
          <Text style={s.caption}>Не удалось загрузить фото</Text>
          <Text style={s.retry}>Повторить</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { position: "relative", overflow: "hidden", backgroundColor: colors.soft },
  image: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  hidden: { opacity: 0 },
  feedback: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 8,
  },
  overPreview: { top: "auto", backgroundColor: "#ffffffed" },
  caption: { fontSize: 11, color: colors.muted, textAlign: "center" },
  retry: { fontSize: 12, fontWeight: "600", color: colors.accent },
});
