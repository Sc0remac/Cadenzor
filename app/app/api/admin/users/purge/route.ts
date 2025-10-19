import { NextResponse } from "next/server";
import { requireAdminUser } from "../../../../../lib/adminAuth";
import { createServerSupabaseClient } from "../../../../../lib/serverSupabase";

interface PurgePayload {
  email?: string | null;
  userId?: string | null;
  deleteAuthUser?: boolean | null;
}

interface DeletionResult {
  table: string;
  deleted: number;
}

const TABLE_DELETION_RULES: Array<{ table: string; column: string }> = [
  { table: "user_preferences", column: "user_id" },
  { table: "project_members", column: "user_id" },
  { table: "profiles", column: "id" },
];

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase();
}

function normaliseUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: Request) {
  const adminResult = await requireAdminUser(request);

  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  let payload: PurgePayload;

  try {
    payload = (await request.json()) as PurgePayload;
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const targetEmail = normaliseEmail(payload.email);
  let targetUserId = normaliseUserId(payload.userId);
  const deleteAuthUser = Boolean(payload.deleteAuthUser);

  if (!targetEmail && !targetUserId) {
    return NextResponse.json(
      { error: "Provide either userId or email to purge" },
      { status: 400 }
    );
  }

  const serviceClientResult = createServerSupabaseClient();

  if (!serviceClientResult.ok) {
    return NextResponse.json(
      { error: serviceClientResult.error },
      { status: 500 }
    );
  }

  const serviceSupabase = serviceClientResult.supabase;

  if (!targetUserId && targetEmail) {
    const { data, error } = await serviceSupabase.auth.admin.getUserByEmail(targetEmail);

    if (error) {
      console.error("Failed to lookup auth user", error);
    }

    if (data?.user?.id) {
      targetUserId = data.user.id;
    }
  }

  if (!targetUserId && targetEmail) {
    const { data, error } = await serviceSupabase
      .from("profiles")
      .select("id")
      .ilike("email", targetEmail)
      .maybeSingle();

    if (error) {
      console.error("Failed to lookup profile by email", error);
    }

    if (data?.id) {
      targetUserId = data.id as string;
    }
  }

  if (!targetUserId) {
    return NextResponse.json(
      { error: "Unable to locate user for provided identifiers" },
      { status: 404 }
    );
  }

  const deletionSummaries: DeletionResult[] = [];

  for (const { table, column } of TABLE_DELETION_RULES) {
    const { data, error } = await serviceSupabase
      .from(table)
      .delete()
      .eq(column, targetUserId)
      .select("id");

    if (error) {
      console.error(`Failed to delete from ${table}`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    deletionSummaries.push({ table, deleted: data?.length ?? 0 });
  }

  let authDeletionStatus: "skipped" | "deleted" | "missing" | "error" = "skipped";
  let authDeletionError: string | null = null;

  if (deleteAuthUser) {
    try {
      const { error } = await serviceSupabase.auth.admin.deleteUser(targetUserId);

      if (error) {
        if (error.message?.toLowerCase().includes("user not found")) {
          authDeletionStatus = "missing";
        } else {
          authDeletionStatus = "error";
          authDeletionError = error.message ?? "Failed to delete auth user";
        }
      } else {
        authDeletionStatus = "deleted";
      }
    } catch (error: any) {
      authDeletionStatus = "error";
      authDeletionError = error?.message ?? "Unexpected error deleting auth user";
    }
  }

  return NextResponse.json({
    userId: targetUserId,
    email: targetEmail ?? null,
    dataDeletions: deletionSummaries,
    authDeletion: {
      status: authDeletionStatus,
      error: authDeletionError,
    },
  });
}
