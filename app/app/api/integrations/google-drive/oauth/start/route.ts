import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { buildOAuthUrl, generateOAuthState } from "@/lib/googleOAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartOAuthPayload {
  redirectTo?: string | null;
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

  let payload: StartOAuthPayload = {};
  try {
    payload = (await request.json()) as StartOAuthPayload;
  } catch (err) {
    // Optional body; ignore parse failure when empty
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/integrations/google-drive/oauth/callback`;

  const state = generateOAuthState();

  const { error: insertError } = await supabase.from("oauth_sessions").insert({
    state,
    user_id: user.id,
    redirect_to: payload.redirectTo ?? null,
  });

  if (insertError) {
    return formatError(insertError.message, 500);
  }

  const authUrl = buildOAuthUrl({
    redirectUri,
    state,
    prompt: "consent",
    accessType: "offline",
  });

  return NextResponse.json({ authUrl, state });
}
