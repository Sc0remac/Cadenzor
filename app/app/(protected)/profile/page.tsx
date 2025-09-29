import ProfileForm from "../../../components/ProfileForm";
import ProfileSnapshot from "../../../components/ProfileSnapshot";

const G_SUITE_INTEGRATIONS = [
  {
    name: "Gmail",
    description: "Bring your Gmail inbox into Cadenzor for faster triage.",
  },
  {
    name: "Google Drive",
    description: "Access contracts, assets, and artwork right alongside emails.",
  },
];

const CALENDAR_INTEGRATIONS = [
  {
    name: "Google Calendar",
    description: "Sync upcoming holds and release schedules automatically.",
  },
  {
    name: "Outlook Calendar",
    description: "Coordinate touring and promo schedules from Outlook.",
  },
  {
    name: "Apple Calendar",
    description: "Keep personal availability aligned with the team view.",
  },
];

interface IntegrationGroupProps {
  title: string;
  description: string;
  items: Array<{ name: string; description: string }>;
}

function IntegrationGroup({ title, description, items }: IntegrationGroupProps) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-600">{description}</p>
      </header>
      <div className="space-y-3">
        {items.map((item) => (
          <article
            key={item.name}
            className="flex items-start justify-between gap-4 rounded-lg border border-dashed border-gray-300 bg-white p-4 shadow-sm"
          >
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-gray-900">{item.name}</h3>
              <p className="text-sm text-gray-600">{item.description}</p>
            </div>
            <button
              type="button"
              disabled
              className="whitespace-nowrap rounded-md bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 disabled:cursor-not-allowed"
            >
              Coming soon
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

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
          <IntegrationGroup
            title="Connect G Suite"
            description="Link Gmail and Drive to keep conversations and files in one place."
            items={G_SUITE_INTEGRATIONS}
          />
          <IntegrationGroup
            title="Calendar integrations"
            description="Choose the calendars you want to keep in sync with campaigns."
            items={CALENDAR_INTEGRATIONS}
          />
        </aside>
      </div>
    </section>
  );
}
