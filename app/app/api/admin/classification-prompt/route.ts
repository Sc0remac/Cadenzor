import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/adminAuth";

interface ClassificationPromptSettings {
  systemMessage: string;
  userInstructions: string;
  model: string;
  temperature: number;
  maxLabels: number;
}

const DEFAULT_SETTINGS: ClassificationPromptSettings = {
  systemMessage: "",
  userInstructions: "",
  model: "gpt-4o-mini",
  temperature: 0.4,
  maxLabels: 3,
};

export async function GET(request: Request) {
  const authResult = await requireAdminUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("classification_prompt_settings")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Failed to load classification prompt settings:", error);
      return NextResponse.json({ settings: DEFAULT_SETTINGS });
    }

    const settings = data?.classification_prompt_settings || DEFAULT_SETTINGS;

    return NextResponse.json({ settings });
  } catch (err) {
    console.error("Unexpected error loading classification prompt settings:", err);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const authResult = await requireAdminUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const settings = body?.settings;
  if (!settings || typeof settings !== "object") {
    return NextResponse.json({ error: "Settings object required" }, { status: 400 });
  }

  try {
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: user.id,
          classification_prompt_settings: settings,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
        }
      );

    if (error) {
      console.error("Failed to save classification prompt settings:", error);
      return NextResponse.json(
        { error: "Failed to save settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error("Unexpected error saving classification prompt settings:", err);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
