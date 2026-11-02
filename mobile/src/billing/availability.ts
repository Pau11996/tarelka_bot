export type BillingAvailability =
  | "checking"
  | "russia_unavailable"
  | "google_play_setup"
  | "unavailable"
  | "unsupported";

/** Called only with the current response from Play Billing, never a device locale or timezone. */
export function availabilityForPlayCountry(country: unknown): BillingAvailability {
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return "unavailable";
  return country === "RU" ? "russia_unavailable" : "google_play_setup";
}

export const billingNotice: Record<BillingAvailability, { title: string; message: string }> = {
  checking: {
    title: "Проверяем доступность подписки…",
    message: "Это займёт несколько секунд.",
  },
  russia_unavailable: {
    title: "Подписка пока недоступна в России",
    message: "Мы готовим возможность оплаты. Бесплатные функции приложения остаются доступны. Если у вас уже есть действующая подписка, она продолжает работать до конца оплаченного срока.",
  },
  google_play_setup: {
    title: "Оплата через Google Play скоро появится",
    message: "Оформление подписки пока недоступно. Бесплатные функции приложения и ранее оплаченный доступ продолжают работать.",
  },
  unavailable: {
    title: "Не удалось проверить доступность подписки",
    message: "Проверьте подключение к интернету и вход в Google Play, затем повторите попытку. Бесплатные функции приложения остаются доступны.",
  },
  unsupported: {
    title: "Оформление подписки пока недоступно",
    message: "Бесплатные функции приложения и ранее оплаченный доступ продолжают работать.",
  },
};
