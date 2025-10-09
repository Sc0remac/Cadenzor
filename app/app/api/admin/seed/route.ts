import { NextResponse } from "next/server";
import { requireAdminUser } from "../../../../lib/adminAuth";

const DEMO_SENDERS = [
  { name: "Oran Demo", email: "oran.demo@example.com" },
  { name: "Kazador Bot", email: "bot@kazador.io" },
  { name: "Logistics Team", email: "routing@kazador.io" },
  { name: "Finance Ops", email: "settlements@kazador.io" },
  { name: "Promo Desk", email: "promo@kazador.io" },
];

const DEMO_SUBJECTS = [
  "Routing hold request for EU week",
  "Updated settlement template attached",
  "Promo deliverables tracker",
  "Visa appointments confirmed",
  "New mixdown feedback",
  "Press request: Resident Advisor feature",
  "Travel changes for Berlin show",
  "Sponsorship contract redline",
  "Stage plot revisions",
  "Hold release window discussion",
];

const DEMO_CATEGORIES = [
  "LOGISTICS/Travel",
  "LEGAL/Contract_Draft",
  "FINANCE/Invoice",
  "PROMO/Deliverables",
  "BOOKING/Confirmation",
  "ASSETS/Audio",
];

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function buildSeedEmail(index: number, count: number) {
  const base = Date.now();
  const sender = pickRandom(DEMO_SENDERS);
  const category = pickRandom(DEMO_CATEGORIES);
  const subject = pickRandom(DEMO_SUBJECTS);
  const receivedAt = new Date(base - index * 45 * 60 * 1000);

  return {
    id: `seed-admin-${base}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    from_name: sender.name,
    from_email: sender.email,
    subject,
    received_at: receivedAt.toISOString(),
    category,
    is_read: false,
    summary: `${subject}. Auto-generated for demos.`,
    labels: [category, "DEMO/Seed"],
    triage_state: "unassigned",
    priority_score: Math.floor(Math.random() * 80),
  };
}

interface GenerateEmailsPayload {
  action: "generateEmails";
  count?: number;
}

interface MarkEmailsPayload {
  action: "markAllEmailsRead";
}

interface DeleteSeededPayload {
  action: "deleteSeededEmails";
}

type AdminSeedPayload = GenerateEmailsPayload | MarkEmailsPayload | DeleteSeededPayload;

export async function POST(request: Request) {
  const adminResult = await requireAdminUser(request);

  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const { supabase } = adminResult;

  let payload: AdminSeedPayload;
  try {
    payload = (await request.json()) as AdminSeedPayload;
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  switch (payload.action) {
    case "generateEmails": {
      const requested = typeof payload.count === "number" ? payload.count : 10;
      const count = Math.min(Math.max(Math.floor(requested), 1), 200);
      const rows = Array.from({ length: count }, (_, index) => buildSeedEmail(index, count));

      const { error } = await supabase.from("emails").insert(rows);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ inserted: rows.length });
    }
    case "markAllEmailsRead": {
      const { data, error } = await supabase
        .from("emails")
        .update({ is_read: true })
        .eq("is_read", false)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ updated: (data ?? []).length });
    }
    case "deleteSeededEmails": {
      const { data, error } = await supabase
        .from("emails")
        .delete()
        .like("id", "seed-admin-%")
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ deleted: (data ?? []).length });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
