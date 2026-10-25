export type RequestKind = "photo" | "text" | "voice";

export type RequestLimitInfo = {
  code: "daily_limit_reached";
  message: string;
  kind: RequestKind;
  limit_mode: "split" | "shared";
  limit: number;
  used: number;
  subscription_active: boolean;
  can_upgrade: boolean;
  upgrade_limit: number;
  resets_at: string;
  timezone: string;
  alternatives: RequestKind[];
};

export function isRequestLimitInfo(value: unknown): value is RequestLimitInfo {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<RequestLimitInfo>;
  return data.code === "daily_limit_reached"
    && ["photo", "text", "voice"].includes(data.kind ?? "")
    && (data.limit_mode === "split" || data.limit_mode === "shared")
    && typeof data.message === "string"
    && typeof data.limit === "number" && Number.isFinite(data.limit) && data.limit >= 0
    && typeof data.used === "number" && Number.isFinite(data.used) && data.used >= 0
    && typeof data.subscription_active === "boolean"
    && typeof data.can_upgrade === "boolean"
    && typeof data.upgrade_limit === "number"
    && typeof data.resets_at === "string" && Number.isFinite(Date.parse(data.resets_at))
    && typeof data.timezone === "string"
    && Array.isArray(data.alternatives)
    && data.alternatives.every((kind) => ["photo", "text", "voice"].includes(kind));
}

export function isLegacyLimitMessage(message: string | null | undefined): boolean {
  return Boolean(message?.startsWith("Вы достигли дневного лимита")
    || message?.startsWith("Достигнут дневной лимит")
    || message?.startsWith("Сработала защита от чрезмерного числа текстовых запросов"));
}

export function formatLimitReset(info: RequestLimitInfo): string {
  try {
    return new Date(info.resets_at).toLocaleString("ru-RU", {
      timeZone: info.timezone,
      day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "в начале следующего дня";
  }
}
