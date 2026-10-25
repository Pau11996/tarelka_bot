import { Redirect } from "expo-router";
import { useEffect, useState } from "react";

import { useAuth } from "../auth";
import { apiFailureMessage } from "../api";
import { profileSetupDestination } from "../profileSetup";
import { Loading } from "../ui";

export default function Index() {
  const { ready, token, signOut } = useAuth();
  const [destination, setDestination] = useState<{ token: string; userId: number | null } | null>(null);
  useEffect(() => {
    if (!ready || !token) return;
    let active = true;
    void profileSetupDestination(token)
      .then(userId => { if (active) setDestination({ token, userId }); })
      .catch(async error => {
        await apiFailureMessage(error, "", signOut);
        // A failed profile check must not prevent access to the diary.
        if (active) setDestination({ token, userId: null });
      });
    return () => { active = false; };
  }, [ready, token, signOut]);
  if (!ready) return <Loading />;
  if (!token) {
    return <Redirect href="/login" />;
  }
  if (destination?.token !== token) return <Loading />;
  if (destination.userId !== null) {
    return <Redirect href={{ pathname: "/profile", params: { setup: "1", userId: String(destination.userId) } }} />;
  }
  return <Redirect href="/(tabs)/chat" />;
}
