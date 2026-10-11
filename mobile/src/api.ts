import { API_URL } from "./config";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = {
  method?: string;
  token?: string | null;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  errorDetail?: string;
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  let body = options.body;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, "Не удалось связаться с сервером. Проверьте адрес API.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => ({}))) as { detail?: unknown };
  if (!response.ok) {
    const fallback = options.errorDetail ?? "Не получилось выполнить запрос";
    const detail = typeof payload.detail === "string" ? payload.detail : fallback;
    throw new ApiError(response.status, detail);
  }
  return payload as T;
}

export async function pollLogin(code: string): Promise<{ status: "pending" } | { access_token: string }> {
  const payload = await api<{ status?: string; access_token?: string }>(`/v1/auth/telegram/${code}`, {
    errorDetail: "Вход не подтвердился",
  });
  if (payload.access_token) {
    return { access_token: payload.access_token };
  }
  if (payload.status === "pending") {
    return { status: "pending" };
  }
  throw new ApiError(0, "Вход не подтвердился");
}

export async function apiFailureMessage(
  caught: unknown,
  fallback: string,
  signOut?: () => Promise<void>,
): Promise<string | null> {
  if (caught instanceof ApiError && caught.status === 401 && signOut) {
    await signOut();
    return null;
  }
  if (caught instanceof ApiError) {
    return caught.message;
  }
  return fallback;
}
