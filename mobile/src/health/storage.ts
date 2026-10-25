import type { SyncState } from "./types";

// Web never bundles SQLite's native database or its optional WebAssembly worker.
// Metro selects storage.native.ts for the Android build.
export async function readHealthState(_scope: string): Promise<SyncState | null> { return null; }
export async function writeHealthState(_scope: string, _state: SyncState): Promise<void> {}
export async function clearHealthState(_scope: string): Promise<void> {}
export async function clearAllHealthStates(): Promise<void> {}
export async function installationId(): Promise<string> { throw new Error("Подключение Health Connect доступно в Android-приложении"); }
