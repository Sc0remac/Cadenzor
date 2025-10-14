import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  applyPriorityConfigPreset,
  getPriorityConfigPreset,
  type PriorityConfigPreset,
} from "@kazador/shared";
import {
  buildResponse,
  ensurePreferenceRow,
  formatError,
  persistPriorityConfig,
} from "../../utils";

interface RouteParams {
  params: {
    preset: string;
  };
}

function resolvePreset(slug: string): PriorityConfigPreset | null {
  const preset = getPriorityConfigPreset(slug);
  if (preset) {
    return preset;
  }
  const fallback = getPriorityConfigPreset(slug.toLowerCase());
  return fallback;
}

export async function POST(request: Request, { params }: RouteParams) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const presetSlug = params.preset;
  const preset = resolvePreset(presetSlug);
  if (!preset) {
    return formatError(`Unknown priority preset: ${presetSlug}`, 404);
  }

  const { supabase, user } = authResult;

  try {
    await ensurePreferenceRow(supabase, user.id);
    const nextConfig = applyPriorityConfigPreset(preset);
    const updatedRow = await persistPriorityConfig(supabase, user.id, nextConfig);
    const response = buildResponse(updatedRow);
    return NextResponse.json({ ...response, preset: { slug: preset.slug, name: preset.name } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply priority preset";
    return formatError(message, 500);
  }
}
