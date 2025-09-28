import EmailDashboard from "../../components/EmailDashboard";

export default function DashboardPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-gray-900">Cadenzor Email Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Review recent emails and their automated categorisation.
        </p>
      </header>
      <EmailDashboard />
    </section>
  );
}
