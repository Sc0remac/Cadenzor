import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { mapEmailAttachmentRow } from "../../../../../lib/projectMappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, { params }: { params: { emailId: string } }) {
  const { emailId } = params;
  if (!emailId) {
    return formatError("Email id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase } = authResult;

  const { data, error } = await supabase
    .from("email_attachments")
    .select("*")
    .eq("email_id", emailId)
    .order("created_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ attachments: (data ?? []).map(mapEmailAttachmentRow) });
}
