import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useRequestLimit } from "../components/RequestLimitDialog";
import type { Operation } from "../operations";
import { isLegacyLimitMessage, type RequestKind } from "../requestLimits";

export function operationLimitKind(op: Operation): RequestKind {
  if (op.limit_reached) return op.limit_reached.kind;
  if (op.kind === "correct" || op.error?.includes("текстовых")) return "text";
  if (op.error?.includes("голосовых")) return "voice";
  return "photo";
}

export function useOperationLimitNotice(operations: Operation[] | undefined, busy: boolean) {
  const { openLimit } = useRequestLimit();
  const shown = useRef(new Set<string>());
  const markLimitShown = useCallback((id: string) => { shown.current.add(id); }, []);

  useFocusEffect(useCallback(() => {
    if (busy) return;
    const latest = operations?.filter((op) => op.kind !== "review")
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).at(-1);
    if (!latest || latest.status !== "failed" || shown.current.has(latest.id)) return;
    if (!latest.limit_reached && !isLegacyLimitMessage(latest.error)) return;
    markLimitShown(latest.id);
    void openLimit(latest.limit_reached, operationLimitKind(latest));
  }, [operations, busy, openLimit, markLimitShown]));

  return markLimitShown;
}
