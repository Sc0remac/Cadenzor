import EmailDashboard from "../components/EmailDashboard";

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-6">Cadenzor Email Dashboard</h1>
      <EmailDashboard />
    </main>
  );
}