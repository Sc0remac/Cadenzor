import EmailDashboard from "../../../components/EmailDashboard";

export default function InboxPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-gray-900">Inbox</h1>
        <p className="mt-1 text-sm text-gray-600">Review recent emails and automation triage signals.</p>
      </header>
      <EmailDashboard />
    </section>
  );
}
