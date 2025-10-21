import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../../lib/projectAccess";

interface Params {
  params: {
    projectId: string;
    linkId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(request: Request, { params }: Params) {
  const { projectId, linkId } = params;
  if (!projectId || !linkId) {
    return formatError("Project id and link id are required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data: linkRow, error: fetchError } = await supabase
    .from("project_email_links")
    .select("email_id, metadata")
    .eq("id", linkId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchError) {
    return formatError(fetchError.message, 500);
  }
  if (!linkRow) {
    return formatError("Project email link not found", 404);
  }

  try {
    await assertProjectRole(supabase, projectId, user.id, "editor");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  const { error } = await supabase
    .from("project_email_links")
    .delete()
    .eq("id", linkId)
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  const ruleId = (() => {
    const raw = linkRow.metadata && typeof linkRow.metadata === "object" ? (linkRow.metadata as Record<string, unknown>) : null;
    const candidate = raw?.rule_id;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
  })();

  const overridePayload = {
    user_id: user.id,
    project_id: projectId,
    email_id: linkRow.email_id as string,
    rule_id: ruleId,
    reason: "manual_unlink",
    metadata: {
      removed_at: new Date().toISOString(),
      removed_by: user.id,
      rule_id: ruleId,
    },
  } satisfies Record<string, unknown>;

  const { error: overrideError } = await supabase
    .from("project_email_link_overrides")
    .upsert(overridePayload, { onConflict: "user_id,project_id,email_id" });

  if (overrideError) {
    console.error("Failed to persist link override", overrideError);
  }

  return NextResponse.json({ success: true });
}
