import { useState, useCallback, useRef, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { api, apiFailureMessage } from "../api";
import { useAuth } from "../auth";
import { onHealthUpdate } from "../health/events";
export function useResource<T>(path: string) {
  const { token, signOut } = useAuth();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const id = ++revision.current;
    setLoading(true);
    try {
      const result = await api<T>(path, { token });
      if (id === revision.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === revision.current)
        setError(
          await apiFailureMessage(e, "Не удалось загрузить данные", signOut),
        );
    } finally {
      if (id === revision.current) setLoading(false);
    }
  }, [path, token, signOut]);
  useFocusEffect(
    useCallback(() => {
      void load();
      const unsubscribe = onHealthUpdate(() => { void load(); });
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") void load();
      });
      return () => {
        sub.remove();
        unsubscribe();
        revision.current++;
      };
    }, [load]),
  );
  useEffect(() => {
    setData(null);
  }, [path, token]);
  return { data, error, loading, load, setData };
}
