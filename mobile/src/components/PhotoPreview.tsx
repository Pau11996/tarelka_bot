import { useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "./Brand";
import { ProtectedImage } from "./ProtectedImage";

export function PhotoPreview({
  uri,
  previewUri,
  style,
}: {
  uri: string;
  previewUri?: string;
  style: StyleProp<ImageStyle>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Увеличить фото еды"
        onPress={(event) => {
          event.stopPropagation();
          Keyboard.dismiss();
          setOpen(true);
        }}
      >
        <ProtectedImage uri={uri} previewUri={previewUri} style={style} />
      </Pressable>
      {open ? (
        <Modal
          visible
          animationType="fade"
          presentationStyle="fullScreen"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setOpen(false)}
        >
          <StatusBar barStyle="light-content" />
          <SafeAreaView style={s.viewer}>
            <View style={s.header}>
              <Text style={s.title}>Фото еды</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Закрыть фото"
                onPress={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                }}
                style={s.close}
                hitSlop={8}
              >
                <Icon name="close" color="white" size={24} />
              </Pressable>
            </View>
            <View style={s.body}>
              <ProtectedImage uri={uri} previewUri={previewUri} style={s.photo} />
            </View>
          </SafeAreaView>
        </Modal>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: "#101512" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    minHeight: 56,
  },
  title: { color: "white", fontSize: 16, fontWeight: "600" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, padding: 8 },
  photo: { width: "100%", height: "100%", resizeMode: "contain", backgroundColor: "#101512" },
});
