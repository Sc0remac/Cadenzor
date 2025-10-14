import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { normalizePriorityConfigInput, type PriorityConfigInput } from "@kazador/shared";
import {
  buildResponse,
  ensurePreferenceRow,
  formatError,
  persistPriorityConfig,
} from "./utils";

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  try {
    const row = await ensurePreferenceRow(supabase, user.id);
    const payload = buildResponse(row);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load priority configuration";
    return formatError(message, 500);
  }
}

export async function PUT(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!body || typeof body !== "object") {
    return formatError("Request body must be an object", 400);
  }

  const input = (body.config ?? body.overrides ?? null) as PriorityConfigInput | null;
  try {
    const normalized = normalizePriorityConfigInput(input);
    const row = await persistPriorityConfig(supabase, user.id, normalized);
    const payload = buildResponse(row);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update priority configuration";
    return formatError(message, 500);
  }
}
