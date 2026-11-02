import { isRunningInExpoGo, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { availabilityForPlayCountry, type BillingAvailability } from "./availability";

type PlayBillingModule = { getCountryCode(): Promise<string> };

export async function checkBillingAvailability(): Promise<BillingAvailability> {
  if (Platform.OS !== "android" || isRunningInExpoGo()) return "unsupported";
  const billing = requireOptionalNativeModule<PlayBillingModule>("TarelkaPlayBilling");
  if (!billing) return "unsupported";
  try {
    return availabilityForPlayCountry(await billing.getCountryCode());
  } catch {
    return "unavailable";
  }
}
