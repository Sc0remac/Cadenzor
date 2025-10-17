import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  getGmailAccount,
  disconnectGmailAccount,
  hasGmailScopes,
} from "@/lib/googleGmailClient";
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
    account = await getGmailAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Gmail account", 500);
  }

  if (!hasGmailScopes(account)) {
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
    account = await getGmailAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Gmail account", 500);
  }

  if (!account) {
    return formatError("No Gmail account connected", 404);
  }

  try {
    await disconnectGmailAccount(supabase, account.id);
  } catch (err: any) {
    return formatError(err?.message || "Failed to disconnect Gmail", 500);
  }

  try {
    await recordAuditLog(supabase, {
      projectId: null,
      userId: user.id,
      action: "gmail.oauth.disconnected",
      entity: "oauth_account",
      refId: account.id,
      metadata: { accountEmail: account.accountEmail },
    });
  } catch (err) {
    // ignore audit failures
  }

  return NextResponse.json({ success: true });
}
