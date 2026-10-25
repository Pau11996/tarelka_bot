import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth";
import { syncHealth, setHealthSession, clearHealthSession, stopHealthSync } from "../health/service";

export function DeviceHealthSync() {
  const { token } = useAuth();
  useEffect(() => {
    if (!token) return;
    setHealthSession(token);
    const run = () => { void syncHealth(token).catch(() => undefined); };
    run();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") run(); else stopHealthSync(); });
    return () => { subscription.remove(); clearHealthSession(token); };
  }, [token]);
  return null;
}
