import { Redirect } from "expo-router";

import { useAuth } from "../auth";
import { Loading } from "../ui";

export default function Index() {
  const { ready, token } = useAuth();
  if (!ready) {
    return <Loading />;
  }
  if (!token) {
    return <Redirect href="/login" />;
  }
  return <Redirect href="/(tabs)/chat" />;
}
