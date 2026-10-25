import { AccountPanel } from "../components/AccountMenu";
import { useAssistantHidden } from "../components/AssistantAccess";

export default function AccountScreen() {
  useAssistantHidden(true);
  return <AccountPanel />;
}
