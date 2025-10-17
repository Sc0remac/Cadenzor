import ProfileForm from "../../../components/ProfileForm";
import ProfileSnapshot from "../../../components/ProfileSnapshot";
export default function ProfilePage() {
  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-600">
          Review your details, update your contact info, and prepare upcoming integrations.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ProfileSnapshot />
          <ProfileForm />
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <header className="mb-3 space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">Google integrations</h2>
              <p className="text-sm text-gray-600">
                Connect Gmail, Drive, and Calendar from the integrations settings page to unlock syncing across the workspace.
              </p>
            </header>
            <a
              href="/settings/integrations"
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Manage integrations
            </a>
          </section>
        </aside>
      </div>
    </section>
  );
}
