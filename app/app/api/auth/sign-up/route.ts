import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/serverSupabase";

interface SignUpPayload {
  email: string;
  password: string;
}

export async function POST(request: Request) {
  let payload: SignUpPayload;
  try {
    payload = (await request.json()) as SignUpPayload;
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const email = payload?.email?.trim();
  const password = payload?.password ?? "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const clientResult = createServerSupabaseClient();

  if (!clientResult.ok) {
    return NextResponse.json(
      { error: clientResult.error },
      { status: 500 }
    );
  }

  const { supabase } = clientResult;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!error && data?.user?.id) {
    return NextResponse.json({ userId: data.user.id }, { status: 201 });
  }

  const message = error?.message ?? "Unable to create account";

  const shouldAttemptRecovery =
    error?.status === 422 ||
    message.toLowerCase().includes("already been registered") ||
    message.toLowerCase().includes("already registered") ||
    message.toLowerCase().includes("already exists");

  if (!shouldAttemptRecovery) {
    const status = typeof error?.status === "number" ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const { data: existingUserData, error: lookupError } =
    await supabase.auth.admin.getUserByEmail(email);

  if (lookupError || !existingUserData?.user?.id) {
    const status = typeof error?.status === "number" ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const existingUserId = existingUserData.user.id;

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    existingUserId,
    {
      email_confirm: true,
      password,
    }
  );

  if (updateError) {
    const status = typeof updateError.status === "number" ? updateError.status : 400;
    return NextResponse.json(
      { error: updateError.message ?? message },
      { status }
    );
  }

  return NextResponse.json({ userId: existingUserId, recovered: true }, { status: 200 });
}
