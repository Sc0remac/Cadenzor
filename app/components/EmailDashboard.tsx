"use client";

import { useEffect, useState } from "react";
import type { EmailCategory } from "@cadenzor/shared";
import { fetchEmailStats } from "../lib/supabaseClient";

interface StatsState {
  [key: string]: number;
}

const CATEGORIES: EmailCategory[] = [
  "booking",
  "promo_time",
  "promo_submission",
  "logistics",
  "assets_request",
  "finance",
  "fan_mail",
  "legal",
  "other",
];

export default function EmailDashboard() {
  const [stats, setStats] = useState<StatsState>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchEmailStats();
        setStats(data);
      } catch (err) {
        setError("Failed to load statistics");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
    // optionally refresh every minute
    const interval = setInterval(loadStats, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <p>Loading email statistics…</p>;
  }
  if (error) {
    return <p className="text-red-600">{error}</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {CATEGORIES.map((category) => {
        const count = stats[category] ?? 0;
        const label = category.replace(/_/g, " ");
        return (
          <div
            key={category}
            className="p-4 bg-white shadow rounded border border-gray-200"
          >
            <h3 className="text-lg font-semibold capitalize">{label}</h3>
            <p className="mt-2 text-2xl font-bold text-indigo-600">{count}</p>
          </div>
        );
      })}
    </div>
  );
}