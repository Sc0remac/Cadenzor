import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { mapProjectRow } from "../../../../../lib/projectMappers";

interface SuggestProjectPayload {
  emailId: string;
  limit?: number;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: SuggestProjectPayload;
  try {
    payload = (await request.json()) as SuggestProjectPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.emailId) {
    return formatError("emailId is required", 400);
  }

  const { data: emailRow, error: emailError } = await supabase
    .from("emails")
    .select("id, subject, labels, from_email, received_at")
    .eq("id", payload.emailId)
    .maybeSingle();

  if (emailError) {
    return formatError(emailError.message, 500);
  }

  if (!emailRow) {
    return formatError("Email not found", 404);
  }

  const emailLabels: string[] = Array.isArray(emailRow.labels)
    ? (emailRow.labels as string[])
    : [];

  const { data: membershipRows, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id);

  if (membershipError) {
    return formatError(membershipError.message, 500);
  }

  if (!membershipRows || membershipRows.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const projectIds = membershipRows.map((row) => row.project_id as string);

  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .in("id", projectIds);

  if (projectError) {
    return formatError(projectError.message, 500);
  }

  const suggestions = (projectRows ?? [])
    .map((row) => {
      const project = mapProjectRow(row);
      const projectLabels = project.labels ? Object.values(project.labels) : [];
      let score = 0;
      const rationales: string[] = [];

      if (emailLabels.length > 0 && projectLabels.length > 0) {
        const overlap = emailLabels.filter((label) =>
          projectLabels.some((value) =>
            typeof value === "string" && value.toLowerCase() === label.toLowerCase()
          )
        );
        if (overlap.length > 0) {
          score += overlap.length * 0.25;
          rationales.push(`Shared labels: ${overlap.join(", ")}`);
        }
      }

      if (project.startDate) {
        const projectStart = new Date(project.startDate);
        const emailDate = emailRow.received_at ? new Date(emailRow.received_at) : null;
        if (emailDate) {
          const diffDays = Math.abs(
            Math.floor((emailDate.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24))
          );
          const proximityScore = Math.max(0, 1 - diffDays / 90);
          if (proximityScore > 0) {
            score += proximityScore * 0.2;
            rationales.push("Timeline proximity to project start");
          }
        }
      }

      if (emailRow.from_email && project.labels) {
        const emailDomain = emailRow.from_email.split("@")[1]?.toLowerCase();
        const labelDomains = Object.entries(project.labels)
          .filter(([key]) => key.toLowerCase().includes("domain"))
          .map(([, value]) => (typeof value === "string" ? value.toLowerCase() : null))
          .filter(Boolean) as string[];

        if (emailDomain && labelDomains.includes(emailDomain)) {
          score += 0.3;
          rationales.push(`Matches domain label ${emailDomain}`);
        }
      }

      return {
        project,
        score,
        rationales,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, payload.limit ?? 5)
    .map((item) => ({
      project: item.project,
      score: Number(item.score.toFixed(2)),
      rationales: item.rationales,
    }));

  return NextResponse.json({ suggestions });
}
