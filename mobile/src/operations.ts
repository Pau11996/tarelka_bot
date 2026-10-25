import { api, ApiError } from "./api";
import type { RequestLimitInfo } from "./requestLimits";
export type Operation = {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  text: string;
  created_at: string;
  entry_id: number | null;
  result: any;
  error: string | null;
  limit_reached?: RequestLimitInfo | null;
  request_key: string;
};
export function requestKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
export async function waitOperation(
  op: Operation,
  token: string | null,
  onProgress?: (op: Operation) => void,
): Promise<Operation> {
  const deadline = Date.now() + 180000;
  onProgress?.(op);
  while (op.status === "queued" || op.status === "running") {
    if (Date.now() > deadline)
      throw new Error("Обработка продолжается. Результат появится в истории.");
    await new Promise((r) => setTimeout(r, 1400));
    op = await api<Operation>(`/v1/operations/${op.id}`, { token });
    onProgress?.(op);
  }
  if (op.status === "failed" && op.limit_reached)
    throw new ApiError(429, op.limit_reached.message, op.limit_reached);
  if (op.status === "failed")
    throw new Error(op.error ?? "Не удалось завершить запрос");
  return op;
}
