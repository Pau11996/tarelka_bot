import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import type { HealthReader, HealthType, RawHealthRecord, Changes, MetricType } from "./types";

export function getHealthModule(): typeof import("react-native-health-connect") | null {
  if (Platform.OS !== "android" || isRunningInExpoGo()) return null;
  // This module must never be imported by Expo Go, iOS or web.
  return require("react-native-health-connect");
}
export async function healthAvailability(): Promise<"available" | "install" | "unsupported" | "expo_go" | "rebuild"> {
  if (Platform.OS === "android" && isRunningInExpoGo()) return "expo_go";
  if (Platform.OS !== "android") return "unsupported";
  try {
    const module = getHealthModule()!;
    const status = await module.getSdkStatus();
    return status === 3 ? "available" : status === 2 ? "install" : "unsupported";
  } catch { return "rebuild"; }
}
export async function healthReader(guard: () => void = () => {}): Promise<HealthReader> {
  const native = getHealthModule();
  if (!native || !(await native.initialize())) throw new Error("Health Connect недоступен на этом устройстве");
  guard();
  return {
    async permissions() {
      return (await native.getGrantedPermissions()).filter(p => p.accessType === "read" && ["Steps", "Distance", "ActiveCaloriesBurned", "ExerciseSession", "Weight"].includes(p.recordType)).map(p => p.recordType as HealthType);
    },
    async records(kind, start, end) {
      const result: RawHealthRecord[] = [];
      let pageToken: string | undefined;
      do {
        guard();
        const page = await native.readRecords(kind, { timeRangeFilter: { operator: "between", startTime: start, endTime: end }, pageSize: 1000, ...(pageToken ? { pageToken } : {}) });
        guard();
        result.push(...page.records as unknown as RawHealthRecord[]);
        pageToken = page.pageToken || undefined;
      } while (pageToken);
      return result;
    },
    async changes(kind, token) {
      return await native.getChanges({ recordTypes: [kind], changesToken: token ?? null } as unknown as Parameters<typeof native.getChanges>[0]) as unknown as Changes;
    },
    async aggregate(kind, window, origin) {
      const raw = await native.aggregateRecord({ recordType: kind, timeRangeFilter: { operator: "between", startTime: window.start_at, endTime: window.end_at }, ...(origin ? { dataOriginFilter: [origin] } : {}) });
      const data = raw as unknown as Record<string, unknown>;
      const origins = Array.isArray(data.dataOrigins) ? data.dataOrigins as string[] : [];
      const objectValue = (key: string, unit: string) => (data[key] as Record<string, number> | undefined)?.[unit];
      const value = kind === "Steps" ? data.COUNT_TOTAL : kind === "Distance" ? objectValue("DISTANCE", "inMeters") : kind === "ActiveCaloriesBurned" ? objectValue("ACTIVE_CALORIES_TOTAL", "inKilocalories") : objectValue("EXERCISE_DURATION_TOTAL", "inSeconds");
      // An empty aggregate is unknown, not a recorded zero.
      const numeric = typeof value === "number" && Number.isFinite(value) && value >= 0 && (origins.length > 0 || value > 0) ? value : null;
      return { value: kind === "ExerciseSession" && numeric !== null ? numeric / 60 : numeric, origins };
    },
  };
}
