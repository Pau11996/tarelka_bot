import { Redirect } from "expo-router";
// Keep existing deep links working through the persistent diary composer.
export default function AddScreen() {
  return <Redirect href="/(tabs)/chat" />;
}
