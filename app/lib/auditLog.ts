import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditLogInput {
  projectId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  refId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAuditLog(
  supabase: SupabaseClient,
  input: AuditLogInput
): Promise<void> {
  const { projectId, userId, action, entity, refId, metadata } = input;
  const payload = {
    project_id: projectId ?? null,
    user_id: userId ?? null,
    action,
    entity,
    ref_id: refId ?? null,
    metadata: metadata ?? {},
  };

  const { error } = await supabase.from("audit_logs").insert(payload);
  if (error) {
    throw error;
  }
}
