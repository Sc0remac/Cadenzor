import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  getCalendarAccount,
  hasCalendarScopes,
  disconnectCalendarAccount,
} from "@/lib/googleCalendarClient";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let account = null;
  try {
    account = await getCalendarAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Calendar account", 500);
  }

  if (!hasCalendarScopes(account)) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    account: {
      id: account.id,
      email: account.accountEmail,
      scopes: account.scopes,
      expiresAt: account.expiresAt,
    },
  });
}

export async function DELETE(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let account = null;
  try {
    account = await getCalendarAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Calendar account", 500);
  }

  if (!account) {
    return formatError("No Calendar account connected", 404);
  }

  try {
    await disconnectCalendarAccount(supabase, account.id);
  } catch (err: any) {
    return formatError(err?.message || "Failed to disconnect Calendar", 500);
  }

  try {
    await recordAuditLog(supabase, {
      projectId: null,
      userId: user.id,
      action: "calendar.oauth.disconnected",
      entity: "oauth_account",
      refId: account.id,
      metadata: { accountEmail: account.accountEmail },
    });
  } catch (err) {
    // Ignore audit logging failures
  }

  return NextResponse.json({ success: true });
}
