import { Redirect } from "expo-router";

export default function StatsScreen() {
  return <Redirect href={{ pathname: "/(tabs)/today", params: { view: "stats" } }} />;
}
