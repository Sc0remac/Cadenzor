import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { mapProjectTemplateRow, mapProjectTemplateItemRow } from "../../../lib/projectMappers";

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase } = authResult;

  const [templatesRes, itemsRes] = await Promise.all([
    supabase
      .from("project_templates")
      .select("*")
      .order("name", { ascending: true }),
    supabase
      .from("project_template_items")
      .select("*")
      .order("template_id", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (templatesRes.error) {
    return NextResponse.json({ error: templatesRes.error.message }, { status: 500 });
  }

  if (itemsRes.error) {
    return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  }

  const itemsByTemplate = new Map<string, ReturnType<typeof mapProjectTemplateItemRow>[]>();
  for (const row of itemsRes.data ?? []) {
    const mapped = mapProjectTemplateItemRow(row);
    if (!itemsByTemplate.has(mapped.templateId)) {
      itemsByTemplate.set(mapped.templateId, []);
    }
    itemsByTemplate.get(mapped.templateId)!.push(mapped);
  }

  const templates = (templatesRes.data ?? []).map((row) => {
    const template = mapProjectTemplateRow(row);
    return {
      template,
      items: itemsByTemplate.get(template.id) ?? [],
    };
  });

  return NextResponse.json({ templates });
}
