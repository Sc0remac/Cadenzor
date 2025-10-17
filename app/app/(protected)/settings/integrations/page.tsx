"use client";

import GoogleIntegrationCard from "@/components/settings/GoogleIntegrationCard";
import {
  disconnectCalendarAccount,
  disconnectDriveAccount,
  disconnectGmailAccount,
  fetchCalendarAccountStatus,
  fetchDriveAccountStatus,
  fetchGmailAccountStatus,
  startCalendarOAuth,
  startDriveOAuth,
  startGmailOAuth,
} from "@/lib/supabaseClient";

export default function IntegrationSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-600">
          Connect Google services so Kazador can sync files, email triage, and calendar holds for your projects.
        </p>
      </header>

      <div className="space-y-6">
        <GoogleIntegrationCard
          title="Google Drive"
          description="Attach folders, surface assets, and file project resources without leaving Kazador."
          messageChannel="kazador-drive"
          fetchStatus={fetchDriveAccountStatus}
          startOAuth={startDriveOAuth}
          disconnect={disconnectDriveAccount}
          connectLabel="Connect Google Drive"
          additionalDetails={
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
              <li>Browse shared folders directly from a project hub.</li>
              <li>File email attachments into the correct Drive folder with one click.</li>
              <li>Index assets so they surface in digests and approvals.</li>
            </ul>
          }
        />

        <GoogleIntegrationCard
          title="Gmail"
          description="Let Kazador ingest inbox activity, classify every message, and sync labels back to Gmail."
          messageChannel="kazador-gmail"
          fetchStatus={fetchGmailAccountStatus}
          startOAuth={startGmailOAuth}
          disconnect={disconnectGmailAccount}
          connectLabel="Connect Gmail"
          additionalDetails={
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
              <li>Pull unread mail for AI triage and apply Kazador labels automatically.</li>
              <li>Link key threads to projects and timelines.</li>
              <li>Send templated replies and follow-ups directly from Kazador (coming soon).</li>
            </ul>
          }
        />

        <GoogleIntegrationCard
          title="Google Calendar"
          description="Sync holds, travel, and promo events to keep every project timeline aligned."
          messageChannel="kazador-calendar"
          fetchStatus={fetchCalendarAccountStatus}
          startOAuth={startCalendarOAuth}
          disconnect={disconnectCalendarAccount}
          connectLabel="Connect Google Calendar"
          additionalDetails={
            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
              <li>Pull upcoming events onto project timelines and the command center calendar.</li>
              <li>Create or update Google Calendar entries when you add timeline items.</li>
              <li>Track conflicts across touring, promo, and release plans from a single view.</li>
            </ul>
          }
        />
      </div>
    </div>
  );
}
