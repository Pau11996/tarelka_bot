import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, AppState, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { Panel, design } from "../components/Screen";
import { SecondaryButton } from "../ui";
import { colors } from "../theme";
import { billingNotice, type BillingAvailability } from "./availability";
import { checkBillingAvailability } from "./native";

export function SubscriptionAvailability() {
  const [status, setStatus] = useState<BillingAvailability>("checking");
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    setStatus("checking");
    const next = await checkBillingAvailability();
    if (request === revision.current) setStatus(next);
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh();
    const listener = AppState.addEventListener("change", state => {
      // Do not keep the Play-country result across background or screen visits.
      if (state === "active") void refresh();
      else { revision.current++; setStatus("checking"); }
    });
    return () => { revision.current++; listener.remove(); };
  }, [refresh]));

  const notice = billingNotice[status];
  return <Panel>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={design.heading}>{notice.title}</Text>
    <Text style={design.subtitle}>{notice.message}</Text>
    {status === "checking" ? <ActivityIndicator color={colors.accentDark} accessibilityLabel="Проверяем доступность подписки" /> : null}
    {status === "unavailable" ? <SecondaryButton label="Повторить проверку" onPress={() => void refresh()} /> : null}
  </Panel>;
}
