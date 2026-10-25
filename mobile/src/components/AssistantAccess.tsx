import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  AccessibilityInfo,
  AppState,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, usePathname, useRootNavigationState } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { useAuth } from "../auth";
import {
  assistantBounds,
  ASSISTANT_SIZE,
  assistantDock,
  clampAssistant,
  dockPosition,
  parseAssistantDock,
  type AssistantDock,
} from "../assistantPosition";
import { colors } from "../theme";

const AccessContext = createContext({ setHidden: (_hidden: boolean) => {} });
const POSITION_KEY = "tarelka.assistant.dock.v1";
// Temporarily hidden; the weekly review screen remains available.
const FLOATING_ASSISTANT_ENABLED = false;
export function useAssistantHidden(hidden: boolean) {
  const { setHidden } = useContext(AccessContext);
  useEffect(() => {
    setHidden(hidden);
    return () => setHidden(false);
  }, [hidden, setHidden]);
}
export function AssistantAvatar({ size = 60 }: { size?: number }) {
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let animation: Animated.CompositeAnimation | undefined;
    let active = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let reduceMotion = true;
    let disposed = false;
    function stop() {
      clearTimeout(timer);
      animation?.stop();
      blink.setValue(1);
    }
    function schedule() {
      clearTimeout(timer);
      if (disposed || !active || reduceMotion) return;
      timer = setTimeout(() => {
        animation = Animated.sequence([
          Animated.timing(blink, { toValue: 0.12, duration: 65, useNativeDriver: Platform.OS !== "web" }),
          Animated.delay(45),
          Animated.timing(blink, { toValue: 1, duration: 100, useNativeDriver: Platform.OS !== "web" }),
        ]);
        animation.start(({ finished }) => {
          if (finished) schedule();
        });
      }, 4500 + Math.random() * 3000);
    }
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (disposed) return;
        reduceMotion = reduced;
        schedule();
      })
      .catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      reduceMotion = reduced;
      stop();
      schedule();
    });
    const state = AppState.addEventListener("change", (next) => {
      active = next === "active";
      stop();
      schedule();
    });
    return () => {
      disposed = true;
      stop();
      motion.remove();
      state.remove();
    };
  }, [blink]);
  const unit = size / 64;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none" accessible={false}>
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Circle cx="29" cy="39" r="19" fill={colors.surface} />
        <Path
          d="M42.8 26A19 19 0 1 0 47.6 42.8"
          stroke="#1A4030"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <Path
          d="M37.5 29.2A13 13 0 1 0 41.7 41.6"
          stroke="#1A4030"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <Path d="M25 46Q29 49 33 46" stroke="#1A4030" strokeWidth="1.7" strokeLinecap="round" />
        <Path d="M41 24C40 14 47 4 57 4C56 14 50 22 41 24Z" fill="#CE8054" />
        <Path d="M40 28L53.5 8.5M45.5 20L45 14M49 15L53 14" stroke="#9E593D" strokeWidth="1.2" strokeLinecap="round" />
        <Path d="M10 26C18 22 21 13 20 7C29 9 35 15 39 20L48 27Z" fill="#2C7445" />
        <Path d="M20 7C24 15 29 20 37 24L10 26C18 22 21 13 20 7Z" fill="#3D8C51" />
        <Path d="M7 26C18 22 32 23 47 27L51 32C37 28 21 29 11 32Z" fill="#79A85F" stroke="#2C7445" strokeWidth="1.2" strokeLinejoin="round" />
      </Svg>
      <Animated.View
        style={{
          position: "absolute",
          left: 22.3 * unit,
          top: 36.8 * unit,
          width: 13.4 * unit,
          height: 4.4 * unit,
          flexDirection: "row",
          justifyContent: "space-between",
          transform: [{ scaleY: blink }],
        }}
      >
        {[0, 1].map((eye) => (
          <View key={eye} style={{ width: 3.4 * unit, height: 4.4 * unit, borderRadius: 2 * unit, backgroundColor: "#1A4030" }} />
        ))}
      </Animated.View>
    </View>
  );
}
export function AssistantAccess({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const path = usePathname();
  const navigation = useRootNavigationState();
  const { token, ready } = useAuth();
  const inset = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const bounds = assistantBounds(
    width,
    height,
    inset.top,
    inset.bottom,
    path.includes("chat"),
  );
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const dock = useRef<AssistantDock>({ edge: "right", fraction: 1 });
  const point = useRef(dockPosition(dock.current, bounds));
  const origin = useRef(point.current);
  const position = useRef(new Animated.ValueXY(point.current)).current;
  const lastDrag = useRef(0);
  const lastOpen = useRef(0);
  const moved = useRef(false);
  const gestureActive = useRef(false);
  const access = useMemo(() => ({ setHidden }), []);
  function openAssistant() {
    const now = Date.now();
    if (now - lastDrag.current <= 300 || now - lastOpen.current <= 500) return;
    lastOpen.current = now;
    router.push("/assistant");
  }
  function settle(p = point.current) {
    dock.current = assistantDock(p, boundsRef.current);
    point.current = dockPosition(dock.current, boundsRef.current);
    Animated.spring(position, {
      toValue: point.current,
      useNativeDriver: false,
      speed: 24,
      bounciness: 3,
    }).start();
    void AsyncStorage.setItem(POSITION_KEY, JSON.stringify(dock.current)).catch(
      () => undefined,
    );
    gestureActive.current = false;
    setDragging(false);
    lastDrag.current = Date.now();
  }
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        gestureActive.current = true;
        moved.current = false;
        position.stopAnimation();
        origin.current = point.current;
      },
      onPanResponderMove: (_, g) => {
        if (!moved.current && Math.abs(g.dx) <= 6 && Math.abs(g.dy) <= 6) return;
        if (!moved.current) {
          moved.current = true;
          setDragging(true);
        }
        point.current = clampAssistant(
          { x: origin.current.x + g.dx, y: origin.current.y + g.dy },
          boundsRef.current,
        );
        position.setValue(point.current);
      },
      onPanResponderRelease: () => {
        if (moved.current) settle();
        else {
          gestureActive.current = false;
          openAssistant();
        }
      },
      onPanResponderTerminate: () => settle(),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(POSITION_KEY)
      .then((raw) => {
        const saved = parseAssistantDock(raw);
        if (active && saved && !gestureActive.current && !lastDrag.current) {
          dock.current = saved;
          point.current = dockPosition(saved, boundsRef.current);
          position.setValue(point.current);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [position]);
  useEffect(() => {
    if (gestureActive.current) return;
    position.stopAnimation();
    point.current = dockPosition(dock.current, boundsRef.current);
    position.setValue(point.current);
  }, [width, height, inset.top, inset.bottom, path, position]);
  useEffect(() => {
    const a = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
    const b = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  useEffect(() => {
    if (navigation?.key && ready && !token && path !== "/login" && path !== "/")
      router.replace("/login");
  }, [navigation?.key, ready, token, path]);
  const excluded =
    /login|assistant|pay|add|entry|settings\/|profile|notifications|achievements|weight/.test(path);
  return (
    <AccessContext.Provider value={access}>
      <View style={{ flex: 1 }}>
        {children}
        {FLOATING_ASSISTANT_ENABLED && token && !hidden && !keyboard && !excluded ? (
          <Animated.View
            {...pan.panHandlers}
            style={[
              s.floating,
              { left: position.x, top: position.y },
              dragging && s.dragging,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Открыть ИИ-помощника"
              accessibilityHint="Перетащите пальцем, чтобы переместить. Нажмите для разбора недели."
              onPress={openAssistant}
              style={s.button}
            >
              <AssistantAvatar size={ASSISTANT_SIZE} />
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </AccessContext.Provider>
  );
}
const s = StyleSheet.create({
  floating: {
    position: "absolute",
    width: ASSISTANT_SIZE,
    height: ASSISTANT_SIZE,
    ...Platform.select({ web: { touchAction: "none" }, default: {} }),
  },
  dragging: {
    transform: [{ scale: 1.08 }],
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
