import AsyncStorage from "@react-native-async-storage/async-storage";
import { digestStringAsync, CryptoDigestAlgorithm, randomUUID } from "expo-crypto";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { api } from "../api";
import { useAuth } from "../auth";
import { API_URL } from "../config";
import { healthUpdated } from "../health/events";
import { Loading } from "../ui";
import { monotonicNow, workoutAccount } from "./engine";
import { WorkoutStore } from "./store";

const Context = createContext<WorkoutStore | null>(null);
function AccountWorkouts({ token, children }: { token: string; children: ReactNode }) {
  const [store, setStore] = useState<WorkoutStore | null>(null);
  useEffect(() => {
    const key = Promise.resolve().then(() => workoutAccount(token)).then(account => digestStringAsync(CryptoDigestAlgorithm.SHA256, `${API_URL}\n${account}`)).then(hash => `tarelka.workouts.v1.${hash}`);
    const current = new WorkoutStore({
      async read() { const value = await AsyncStorage.getItem(await key); return value ? JSON.parse(value) : null; },
      async write(value) { await AsyncStorage.setItem(await key, JSON.stringify(value)); },
      async remove() { await AsyncStorage.removeItem(await key); },
      request: (path, options) => api(path, { ...options, token }),
      uuid: randomUUID, now: monotonicNow, wall: () => new Date().toISOString(), updated: healthUpdated,
    });
    setStore(current);
    void current.initialize();
    const interval = setInterval(() => current.tick(), 250);
    const retries = setInterval(() => { if (current.hasPending()) void current.refresh(); }, 20000);
    const subscription = AppState.addEventListener("change", state => { void current.setActive(state === "active").catch(() => undefined); });
    if (AppState.currentState !== "active") void current.setActive(false).catch(() => undefined);
    return () => { clearInterval(interval); clearInterval(retries); subscription.remove(); void current.close(); };
  }, [token]);
  return store ? <Context.Provider value={store}>{children}</Context.Provider> : <Loading />;
}
export function WorkoutsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  return token ? <AccountWorkouts key={token} token={token}>{children}</AccountWorkouts> : children;
}
export function useWorkouts() {
  const store = useContext(Context);
  if (!store) throw Error("Тренировки доступны после входа");
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, ...snapshot };
}
