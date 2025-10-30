import EmailDashboardV2 from "../../../components/EmailDashboardV2";
import ThreadInbox from "../../../components/ThreadInbox";
import { featureFlags } from "../../../lib/featureFlags";

export default function InboxPage() {
  if (featureFlags.threadedInbox) {
    return <ThreadInbox />;
  }

  return <EmailDashboardV2 />;
}
