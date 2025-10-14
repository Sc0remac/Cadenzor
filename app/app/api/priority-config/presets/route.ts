import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { listPriorityConfigPresets } from "@kazador/shared";
import { formatError } from "../utils";

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  try {
    const presets = listPriorityConfigPresets().map((preset) => ({
      slug: preset.slug,
      name: preset.name,
      description: preset.description,
      recommendedScenarios: preset.recommendedScenarios,
      adjustments: preset.adjustments,
    }));
    return NextResponse.json({ presets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load priority presets";
    return formatError(message, 500);
  }
}
