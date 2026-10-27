import { useEffect, useRef, useState, type ComponentRef } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, PanResponder, Platform,
  Pressable, ScrollView, StyleSheet, Text, View, type ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";
import { favoriteDropIndex, favoriteScrollStep, moveFavorite, type RowLayout } from "../favoriteOrder";
import type { Favorite } from "../types";
import { FavoriteCard } from "./FavoriteCards";
import { Icon } from "./Brand";

type HandleProps = {
  item: Favorite; index: number; count: number; disabled: boolean;
  onStart: (id: number, y: number) => void;
  onMove: (dy: number, y: number) => void;
  onEnd: (cancelled: boolean) => void;
  onStep: (index: number, delta: number) => void;
};

function OrderHandle(props: HandleProps) {
  const latest = useRef(props);
  latest.current = props;
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: event => latest.current.onStart(latest.current.item.id, event.nativeEvent.pageY),
    onPanResponderMove: (event, gesture) => latest.current.onMove(gesture.dy, event.nativeEvent.pageY),
    onPanResponderRelease: () => latest.current.onEnd(false),
    onPanResponderTerminate: () => latest.current.onEnd(true),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  })).current;
  const step = (delta: number) => { if (!props.disabled) props.onStep(props.index, delta); };
  const webKeys: Pick<ViewProps, "onKeyDown"> = Platform.OS === "web" ? {
    onKeyDown: event => {
      const key = (event as unknown as { key?: string }).key;
      if (key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault(); step(key === "ArrowUp" ? -1 : 1);
      }
    },
  } : {};
  return <View
    {...responder.panHandlers} {...webKeys}
    accessible focusable accessibilityRole="adjustable"
    accessibilityLabel={`Переместить: ${props.item.title}`}
    accessibilityHint="Перетащите выше или ниже. Доступны действия «Выше» и «Ниже»."
    accessibilityState={{ disabled: props.disabled }}
    accessibilityValue={{ min: 1, max: props.count, now: props.index + 1 }}
    accessibilityActions={[
      ...(props.index > 0 ? [{ name: "decrement" as const, label: "Выше" }] : []),
      ...(props.index + 1 < props.count ? [{ name: "increment" as const, label: "Ниже" }] : []),
    ]}
    onAccessibilityAction={event => {
      if (event.nativeEvent.actionName === "increment") step(1);
      if (event.nativeEvent.actionName === "decrement") step(-1);
    }}
    style={[s.handle, props.disabled && { opacity: 0.4 }]}
  ><Icon name="grip" size={23} color={colors.muted} /></View>;
}

type Drag = { id: number; from: number; to: number; dy: number; pointerY: number; startScroll: number; layouts: RowLayout[] };

export function FavoriteOrderEditor({ items, saving, error, conflict, onChange, onSave, onCancel }: {
  items: Favorite[]; saving: boolean; error: string | null; conflict: boolean;
  onChange: (items: Favorite[]) => void; onSave: () => void; onCancel: () => void;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewport = useRef<ComponentRef<typeof View>>(null);
  const metrics = useRef({ top: 0, height: 0, offset: 0, content: 0 });
  const layouts = useRef(new Map<number, RowLayout>());
  const drag = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const translate = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState<number | null>(null);
  const [destination, setDestination] = useState(0);
  const latest = useRef({ items, onChange });
  latest.current = { items, onChange };

  function stopTimer() { if (timer.current !== null) clearInterval(timer.current); timer.current = null; }
  useEffect(() => stopTimer, []);

  function updateDrag() {
    const d = drag.current;
    if (!d) return;
    const row = d.layouts[d.from], last = d.layouts[d.layouts.length - 1];
    const dy = Math.max(-row.y, Math.min(last.y + last.height - row.height - row.y, d.dy + metrics.current.offset - d.startScroll));
    translate.setValue(dy);
    const to = favoriteDropIndex(d.layouts, d.from, d.dy + metrics.current.offset - d.startScroll);
    if (to !== d.to) { d.to = to; setDestination(to); }
  }

  function start(id: number, pointerY: number) {
    if (saving || conflict || drag.current) return;
    const rows = items.map(item => layouts.current.get(item.id));
    if (rows.some(row => !row)) return;
    const from = items.findIndex(item => item.id === id);
    drag.current = { id, from, to: from, dy: 0, pointerY, startScroll: metrics.current.offset, layouts: rows as RowLayout[] };
    translate.setValue(0); setDestination(from); setActive(id);
    viewport.current?.measureInWindow((_x, y, _width, height) => {
      metrics.current.top = y; metrics.current.height = height;
    });
    timer.current = setInterval(() => {
      if (!drag.current) return;
      const m = metrics.current;
      const next = favoriteScrollStep(drag.current.pointerY, m.top, m.height, m.offset, Math.max(0, m.content - m.height));
      if (next === m.offset) return;
      m.offset = next;
      scroll.current?.scrollTo({ y: next, animated: false });
      updateDrag();
    }, 16);
  }

  function announce(item: Favorite, index: number) {
    AccessibilityInfo.announceForAccessibility(`${item.title}. Позиция ${index + 1} из ${items.length}`);
  }

  function end(cancelled: boolean) {
    const d = drag.current;
    stopTimer(); drag.current = null; setActive(null); translate.setValue(0);
    if (!d || cancelled || d.from === d.to) return;
    const current = latest.current;
    current.onChange(moveFavorite(current.items, d.from, d.to));
    announce(current.items[d.from], d.to);
  }

  function step(index: number, delta: number) {
    if (saving || conflict || active !== null) return;
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    onChange(moveFavorite(items, index, to)); announce(items[index], to);
  }

  return <SafeAreaView style={s.page} edges={["top"]}>
    <View style={s.header}>
      <Text accessibilityRole="header" style={s.title}>Избранное</Text>
      <Text style={s.subtitle}>Сохранено: {items.length} · еда, вода и активность</Text>
      <View style={s.toolbar}>
        <Text style={s.label}>Изменить порядок</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Сохранить порядок"
          accessibilityState={{ busy: saving, disabled: saving || conflict || active !== null }}
          disabled={saving || conflict || active !== null} onPress={onSave}
          style={[s.done, (saving || conflict || active !== null) && { opacity: 0.5 }]}>
          {saving ? <ActivityIndicator color="white" size="small" /> : <Text style={s.doneText}>Готово</Text>}
        </Pressable>
      </View>
      <View style={s.hint}><Icon name="grip" color={colors.accent} size={20} /><Text style={s.hintText}>Удерживайте значок справа и перетащите запись выше или ниже.</Text></View>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    </View>
    <View ref={viewport} style={s.viewport} onLayout={event => { metrics.current.height = event.nativeEvent.layout.height; }}>
      <ScrollView ref={scroll} scrollEnabled={active === null} removeClippedSubviews={false}
        scrollEventThrottle={16} contentContainerStyle={s.list}
        onContentSizeChange={(_width, height) => { metrics.current.content = height; }}
        onScroll={event => { metrics.current.offset = event.nativeEvent.contentOffset.y; updateDrag(); }}>
        {items.map((item, index) => {
          const d = drag.current;
          const shifted = d && index !== d.from && (d.from < destination ? index > d.from && index <= destination : index < d.from && index >= destination);
          const displacement = shifted && d ? (d.layouts[d.from].height + 9) * (d.from < destination ? -1 : 1) : 0;
          return <Animated.View key={item.id}
            onLayout={event => { layouts.current.set(item.id, event.nativeEvent.layout); }}
            style={[{ transform: [{ translateY: active === item.id ? translate : displacement }], zIndex: active === item.id ? 2 : 0 }, active === item.id && s.lifted]}>
            <FavoriteCard item={item} disabled busy={false} onOpen={() => {}} onLog={() => {}}
              reorderHandle={<OrderHandle item={item} index={index} count={items.length} disabled={saving || conflict}
                onStart={start} onMove={(dy, y) => { if (drag.current) { drag.current.dy = dy; drag.current.pointerY = y; updateDrag(); } }} onEnd={end} onStep={step} />} />
          </Animated.View>;
        })}
      </ScrollView>
    </View>
    <Pressable accessibilityRole="button" disabled={saving || active !== null} onPress={onCancel} style={s.cancel}>
      <Text style={s.subtitle}>{conflict ? "Обновить список" : "Отмена"}</Text>
    </Pressable>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  header: { padding: 20, paddingBottom: 12, gap: 10, width: "100%", maxWidth: 680, alignSelf: "center" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.7, color: colors.text },
  subtitle: { fontSize: 13, color: colors.muted },
  toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  done: { backgroundColor: colors.accent, borderRadius: 12, minWidth: 80, minHeight: 44, alignItems: "center", justifyContent: "center" },
  doneText: { color: "white", fontSize: 13, fontWeight: "600" },
  hint: { backgroundColor: colors.soft, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  hintText: { flex: 1, color: colors.accentDark, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  viewport: { flex: 1 },
  list: { padding: 20, paddingTop: 6, gap: 9, width: "100%", maxWidth: 680, alignSelf: "center" },
  handle: { width: 44, minHeight: 48, alignSelf: "stretch", justifyContent: "center", alignItems: "center" },
  lifted: { elevation: 5, shadowColor: colors.text, shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, borderRadius: 16, opacity: 0.95 },
  cancel: { minHeight: 48, justifyContent: "center", alignItems: "center", paddingBottom: 8 },
});
