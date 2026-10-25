import { shiftDay } from "../chartMath";
import { dateChunks, indexRecord, intervalDates, localDate, normalizeRecord } from "./math";
import { healthFields, type HealthBatch, type HealthConnection, type HealthDay, type HealthReader, type HealthType, type ImportedRecord, type MetricType, type RecordIndex, type SyncState } from "./types";

type Dependencies = {
  reader: HealthReader;
  connection(start: string, end: string): Promise<HealthConnection>;
  upload(batch: HealthBatch): Promise<unknown>;
  persist(state: SyncState): Promise<void>;
  uuid(): string;
  guard(): void;
};

/** Every upload is persisted before sending; cursors advance only after all ACKs. */
export async function runHealthSync(previous: SyncState | null, connection: HealthConnection, deps: Dependencies, full = false): Promise<SyncState> {
  const { generation, timezone, today } = connection;
  if (!connection.connected || !generation || !timezone || !today || !connection.connection_id) throw new Error("Подключите Health Connect");
  const types = [...connection.permissions].filter(type => type !== "ExerciseSession" || !!connection.workout_origin).sort();
  if (!types.length) throw new Error(connection.permissions.includes("ExerciseSession") && !connection.workout_origin ? "Выберите источник тренировок в разделе «Устройства и здоровье»" : "Разрешите чтение хотя бы одного показателя в Health Connect");
  const permissions = types.join(",");
  let state: SyncState = previous && previous.generation === generation && previous.timezone === timezone && previous.permissions === permissions ? previous : { generation, timezone, permissions, tokens: {}, index: {} };
  const wait = async <T>(promise: Promise<T>) => { const result = await promise; deps.guard(); return result; };
  const drain = async () => {
    if (!state.pending) return;
    while (state.pending.next < state.pending.batches.length) {
      deps.guard();
      await wait(deps.upload(state.pending.batches[state.pending.next]));
      state.pending.next++;
      await wait(deps.persist(state));
    }
    state = { ...state, tokens: state.pending.tokens, index: state.pending.index, lastSuccess: Date.now() };
    delete state.pending;
    await wait(deps.persist(state));
  };
  if (state.pending) { await drain(); return state; }
  deps.guard();
  let reconcile = full || types.some(type => !state.tokens[type]);
  const tokens = { ...state.tokens }, index: RecordIndex = { ...state.index };
  const changed = new Map<string, ImportedRecord>(), deleted = new Map<string, { record_type: "Weight" | "ExerciseSession"; external_id: string }>();
  let first = connection.windows![0].date;
  for (const kind of types) {
    if (full || !tokens[kind]) continue;
    let token = tokens[kind], more = false;
    do {
      const page = await wait(deps.reader.changes(kind, token));
      if (page.changesTokenExpired) { reconcile = true; break; }
      for (const { record } of page.upsertionChanges) {
        const indexed = indexRecord({ ...record, recordType: kind });
        if (!indexed) continue;
        for (const interval of [index[indexed.key], indexed.interval].filter(Boolean)) {
          for (const date of intervalDates(interval, timezone)) if (date < first) first = date;
        }
        index[indexed.key] = indexed.interval;
        const normalized = normalizeRecord({ ...record, recordType: kind });
        if (normalized && (kind !== "ExerciseSession" || normalized.origin === connection.workout_origin)) {
          changed.set(indexed.key, normalized);
          deleted.delete(indexed.key);
        }
      }
      for (const { recordId } of page.deletionChanges) {
        const key = `${kind}:${recordId}`, interval = index[key];
        if (kind === "Weight" || kind === "ExerciseSession") deleted.set(key, { record_type: kind, external_id: recordId });
        if (!interval) { reconcile = true; continue; }
        for (const date of intervalDates(interval, timezone)) if (date < first) first = date;
        delete index[key];
        changed.delete(key);
      }
      token = page.nextChangesToken;
      more = page.hasMore;
    } while (more);
    tokens[kind] = token;
  }
  if (reconcile) {
    first = previous && connection.history_start && connection.history_start < first ? connection.history_start : first;
    // Reserve tokens BEFORE the full read so writes during the read aren't lost.
    for (const kind of types) tokens[kind] = (await wait(deps.reader.changes(kind))).nextChangesToken;
  }
  let revision = connection.revision ?? 0;
  const batches: HealthBatch[] = [];
  const makeBatches = async (start: string) => {
    batches.length = 0;
    revision = connection.revision ?? 0;
    for (const chunk of dateChunks(start, today)) {
      const config = await wait(deps.connection(chunk.start, chunk.end));
      if (config.generation !== generation || config.timezone !== timezone) throw new Error("Подключение изменилось. Повторите обновление.");
      const windows = config.windows!;
      const from = windows[0].start_at, to = windows.at(-1)!.end_at;
      const records: ImportedRecord[] = [];
      if (reconcile) {
        // Do not remove old index entries until the source range has been read.
        for (const kind of types) {
          const raw = await wait(deps.reader.records(kind, from, to));
          for (const [key, interval] of Object.entries(index)) if (key.startsWith(kind + ":") && Date.parse(interval.start_at) >= Date.parse(from) && Date.parse(interval.start_at) < Date.parse(to)) delete index[key];
          for (const rawRecord of raw) {
            const record = { ...rawRecord, recordType: kind }, indexed = indexRecord(record);
            if (indexed) index[indexed.key] = indexed.interval;
            const normalized = normalizeRecord(record);
            if (normalized && (kind !== "ExerciseSession" || normalized.origin === connection.workout_origin)) records.push(normalized);
          }
        }
      } else {
        for (const record of changed.values()) {
          const date = localDate(record.start_at, timezone);
          if (date >= chunk.start && date <= chunk.end) records.push(record);
        }
      }
      const days: HealthDay[] = [];
      for (const window of windows) {
        const day: HealthDay = { date: window.date, steps: null, distance_m: null, active_kcal: null, exercise_minutes: null, origins: [] };
        for (const kind of types) {
          if (kind === "Weight") continue;
          const aggregate = await wait(deps.reader.aggregate(kind as MetricType, window, kind === "ExerciseSession" ? connection.workout_origin : undefined));
          day[healthFields[kind]] = aggregate.value;
          day.origins!.push(...aggregate.origins);
        }
        day.origins = [...new Set(day.origins)];
        days.push(day);
      }
      deps.guard();
      batches.push({ connection_id: connection.connection_id!, generation, timezone, batch_id: deps.uuid(), base_revision: revision++, start_date: chunk.start, end_date: chunk.end, types: types as HealthType[], days, records, deleted: batches.length ? [] : [...deleted.values()].filter(item => !records.some(record => record.record_type === item.record_type && record.external_id === item.external_id)), reconcile });
    }
  };
  try { await makeBatches(first); }
  catch (error) {
    // Reinstallation/re-grant can shorten the accessible history. Old cloud data
    // must not be deleted based on an unreadable range.
    const initial = connection.windows![0].date;
    if (!reconcile || first >= initial) throw error;
    deps.guard();
    const current = await wait(deps.reader.permissions());
    if (types.some(type => !current.includes(type))) throw error;
    await makeBatches(initial);
  }
  state = { ...state, pending: { batches, next: 0, tokens, index } };
  await wait(deps.persist(state));
  await drain();
  return state;
}
