import type { SQLiteDatabase } from "expo-sqlite";
import type { SyncState } from "./types";
let database: Promise<SQLiteDatabase> | null = null;
async function db() {
  if (!database) database = (async () => {
    const SQLite: typeof import("expo-sqlite") = require("expo-sqlite");
    const database = await SQLite.openDatabaseAsync("tarelka-health-v1.db");
    await database.execAsync("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS health_local (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
    return database;
  })();
  return database;
}
export async function readHealthState(scope: string): Promise<SyncState | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>("SELECT value FROM health_local WHERE key = ?", scope);
  return row ? JSON.parse(row.value) : null;
}
export async function writeHealthState(scope: string, state: SyncState) {
  await (await db()).runAsync("INSERT INTO health_local (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", scope, JSON.stringify(state));
}
export async function clearHealthState(scope: string) { await (await db()).runAsync("DELETE FROM health_local WHERE key = ?", scope); }
export async function installationId() {
  const database = await db();
  const row = await database.getFirstAsync<{ value: string }>("SELECT value FROM health_local WHERE key='installation'");
  if (row) return row.value;
  const { randomUUID }: typeof import("expo-crypto") = require("expo-crypto");
  const id = randomUUID();
  await database.runAsync("INSERT OR IGNORE INTO health_local (key,value) VALUES ('installation',?)", id);
  return (await database.getFirstAsync<{ value: string }>("SELECT value FROM health_local WHERE key='installation'"))!.value;
}

export async function clearAllHealthStates() { await (await db()).runAsync("DELETE FROM health_local WHERE key != 'installation'"); }
