import { api, ApiError } from "../api";
import { API_URL } from "../config";
import { getHealthModule, healthAvailability, healthReader } from "./native";
import { clearAllHealthStates, clearHealthState, installationId, readHealthState, writeHealthState } from "./storage";
import { runHealthSync } from "./engine";
import { healthUpdated } from "./events";
import type { HealthConnection, HealthType } from "./types";

let sessionToken: string | null = null;
let epoch = 0, activeScope: string | null = null, controller: AbortController | null = null;
let running: Promise<void> | null = null;
export function stopHealthSync() { epoch++; controller?.abort(); controller = null; }
export function setHealthSession(token: string) { stopHealthSync(); sessionToken = token; }
export function clearHealthSession(token: string) { if (sessionToken === token) { sessionToken = null; stopHealthSync(); } }
export async function pauseHealthSync(endSession = false) {
  if (endSession) sessionToken = null;
  stopHealthSync();
  // Finish an already-started local write before deleting the outbox.
  if (running) await running.catch(() => undefined);
  if (activeScope) activeScope = null;
  const { Platform } = require("react-native");
  const { isRunningInExpoGo } = require("expo");
  if (Platform.OS === "android" && !isRunningInExpoGo()) await clearAllHealthStates().catch(() => undefined);
}
export async function syncHealth(token: string, force = false): Promise<void> {
  const queuedEpoch = epoch;
  const task = (running ?? Promise.resolve()).catch(() => undefined).then(() => {
    if (queuedEpoch !== epoch || token !== sessionToken) return;
    return performSync(token, force);
  });
  running = task;
  try { await task; } finally { if (running === task) running = null; }
}
async function performSync(token: string, force: boolean) {
  const current = epoch;
  if (await healthAvailability() !== "available" || current !== epoch || token !== sessionToken) return;
  const abort = new AbortController(); controller = abort;
  const guard = () => { if (epoch !== current || token !== sessionToken || abort.signal.aborted) throw new Error("Синхронизация остановлена"); };
  const options = { token, signal: abort.signal };
  const me = await api<{ id: number }>("/v1/me", options); guard();
  const install = await installationId(); guard();
  const scope = `${API_URL}|${me.id}|${install}`; activeScope = scope;
  let connection = await api<HealthConnection>("/v1/health/connection", options); guard();
  if (!connection.available || !connection.connected || connection.installation_id !== install) return;
  const reader = await healthReader(guard); guard();
  const permissions = await reader.permissions(); guard();
  if ([...permissions].sort().join() !== [...connection.permissions].sort().join()) {
    await clearHealthState(scope); guard();
    connection = await api<HealthConnection>("/v1/health/connection", { ...options, method: "PUT", json: { installation_id: install, permissions, workout_origin: connection.workout_origin } }); guard();
    healthUpdated();
  }
  if (!permissions.length) return;
  if (permissions.includes("ExerciseSession") && !connection.workout_origin) {
    const windows = connection.windows!;
    const raw = await reader.records("ExerciseSession", windows[0].start_at, windows.at(-1)!.end_at); guard();
    const origins = [...new Set(raw.map(record => record.metadata?.dataOrigin).filter((origin): origin is string => !!origin))];
    if (!origins.length && permissions.length === 1) { healthUpdated(); return; }
    if (origins.length === 1) {
      connection = await api<HealthConnection>("/v1/health/connection", { ...options, method: "PUT", json: { installation_id: install, permissions, workout_origin: origins[0] } }); guard();
    }
  }
  let state = await readHealthState(scope); guard();
  if (!force && !state?.pending && state?.lastSuccess && state.generation === connection.generation && state.timezone === connection.timezone && Date.now() - state.lastSuccess < 300000) return;
  const { randomUUID }: typeof import("expo-crypto") = require("expo-crypto");
  try {
    await runHealthSync(state, connection, {
      reader, uuid: randomUUID, guard,
      connection: (start, end) => { guard(); return api<HealthConnection>(`/v1/health/connection?start=${start}&end=${end}`, options); },
      upload: (batch) => { guard(); return api("/v1/health/sync", { ...options, method: "POST", json: batch }); },
      persist: async (next) => { guard(); await writeHealthState(scope, next); guard(); state = next; },
    }, force);
    guard(); healthUpdated();
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) { await clearHealthState(scope); }
    throw error;
  }
}
export async function requestHealthPermissions(types: HealthType[]) {
  if (await healthAvailability() !== "available") throw new Error("Для подключения нужна Android-сборка приложения с Health Connect");
  const native = getHealthModule()!;
  await native.initialize();
  await native.requestPermission(types.map(recordType => ({ accessType: "read" as const, recordType })));
  return (await healthReader()).permissions();
}
