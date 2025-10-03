import { config } from "dotenv";
config();

import { google, gmail_v1 } from "googleapis";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EmailLabel,
  analyzeEmail,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  selectPrimaryCategory,
  heuristicLabels,
  EMAIL_FALLBACK_LABEL,
} from "@cadenzor/shared";

type ProjectRow = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  labels: Record<string, unknown> | null;
};

interface ProjectCandidate {
  id: string;
  name: string;
  slug: string | null;
  normalizedSlug: string | null;
  status: string;
  labels: Record<string, unknown>;
  keywords: string[];
}

interface LabelEntry {
  prefix: string;
  value: string;
}

interface EmailContext {
  emailId: string;
  subject: string;
  body: string;
  summary: string;
  labels: EmailLabel[];
  labelEntries: LabelEntry[];
  category: EmailLabel;
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
}

interface ProjectSuggestion {
  project: ProjectCandidate;
  score: number;
  rationales: string[];
  timelineItem?: Record<string, unknown> | null;
  confidence?: number;
}

type SupabaseClientType = SupabaseClient<any, any, any, any, any>;

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  const parts: string[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;

    if (part.body?.data && part.mimeType?.startsWith("text/")) {
      try {
        const decoded = decodeBase64Url(part.body.data);
        if (decoded.trim()) {
          parts.push(decoded.trim());
        }
      } catch (err) {
        console.error("Failed to decode message part", err);
      }
    }

    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    } else if (part.body?.data && !part.mimeType) {
      try {
        const decoded = decodeBase64Url(part.body.data);
        if (decoded.trim()) {
          parts.push(decoded.trim());
        }
      } catch (err) {
        console.error("Failed to decode body fallback part", err);
      }
    }
  };

  walk(payload);

  if (parts.length === 0 && payload.body?.data) {
    try {
      const decoded = decodeBase64Url(payload.body.data);
      if (decoded.trim()) {
        parts.push(decoded.trim());
      }
    } catch (err) {
      console.error("Failed to decode root payload", err);
    }
  }

  return parts.join("\n\n");
}

function parseFromHeader(from: string): { name: string | null; email: string } {
  const emailMatch = from?.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1] : from;
  const nameMatch = from?.match(/^\s*"?([^<"]+)"?\s*<[^>]+>/);
  const name = nameMatch ? nameMatch[1].trim() : null;
  return { name, email };
}

function normaliseToken(value: unknown): string | null {
  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    return token.length > 0 ? token : null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

function collectKeywordsFromValue(value: unknown, keywords: Set<string>): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeywordsFromValue(entry, keywords);
    }
    return;
  }

  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectKeywordsFromValue(entry, keywords);
    }
    return;
  }

  const token = normaliseToken(value);
  if (!token) return;
  keywords.add(token);
  for (const part of token.split(/[^a-z0-9]+/g)) {
    if (part.length >= 3) {
      keywords.add(part);
    }
  }
}

function buildProjectCandidate(row: ProjectRow): ProjectCandidate {
  const keywords = new Set<string>();
  collectKeywordsFromValue(row.name, keywords);
  collectKeywordsFromValue(row.slug, keywords);
  collectKeywordsFromValue(row.labels, keywords);

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    normalizedSlug: row.slug ? row.slug.toLowerCase() : null,
    status: row.status,
    labels: row.labels ?? {},
    keywords: Array.from(keywords),
  };
}

async function fetchActiveProjects(
  supabase: SupabaseClientType
): Promise<ProjectCandidate[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, status, labels")
    .in("status", ["active", "paused"]);

  if (error) {
    console.error("Failed to fetch projects for suggestions", error);
    return [];
  }

  const rows = (data as ProjectRow[]) ?? [];
  return rows.map(buildProjectCandidate);
}

function parseLabel(label: EmailLabel): LabelEntry | null {
  if (!label) return null;
  const parts = label.split("/");
  if (parts.length < 2) {
    return {
      prefix: label.toLowerCase(),
      value: label.toLowerCase(),
    };
  }

  const prefix = parts[0]?.trim().toLowerCase() ?? "";
  const value = parts.slice(1).join("/").trim().toLowerCase();
  if (!prefix || !value) {
    return null;
  }
  return { prefix, value };
}

function parseEmailLabels(labels: EmailLabel[]): LabelEntry[] {
  const entries: LabelEntry[] = [];
  for (const label of labels) {
    const entry = parseLabel(label);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function buildTimelineSuggestion(category: EmailLabel, subject: string, receivedAt: string) {
  if (category.startsWith("PROMO/Promo_Time_Request")) {
    return {
      title: subject,
      type: "event",
      lane: "Promo",
      startsAt: null,
      priority: 65,
      metadata: { category },
    };
  }

  if (category.startsWith("LOGISTICS/")) {
    return {
      title: subject,
      type: "milestone",
      lane: "Live",
      startsAt: receivedAt,
      priority: 50,
      metadata: { category },
    };
  }

  if (category === "BOOKING/Offer" || category === "BOOKING/Hold_or_Availability") {
    return {
      title: subject,
      type: "lead",
      lane: "Live",
      startsAt: null,
      priority: 70,
      metadata: { category },
    };
  }

  return null;
}

function scoreProjectForContext(project: ProjectCandidate, context: EmailContext): ProjectSuggestion | null {
  let score = 0;
  const rationaleSet = new Set<string>();
  const keywordSet = new Set(project.keywords);
  const subjectLower = context.subject.toLowerCase();
  const summaryLower = context.summary.toLowerCase();
  const bodyLower = context.body.slice(0, 1500).toLowerCase();

  if (project.normalizedSlug) {
    for (const entry of context.labelEntries) {
      if (entry.prefix === "project" && entry.value === project.normalizedSlug) {
        score += 75;
        rationaleSet.add(`Label references project/${project.normalizedSlug}`);
      }
    }
  }

  const fromDomain = context.fromEmail.split("@")[1]?.toLowerCase();

  for (const entry of context.labelEntries) {
    if (keywordSet.has(entry.value)) {
      score += 25;
      rationaleSet.add(`Label ${entry.prefix}/${entry.value} matches project metadata`);
    }
    if (entry.prefix === "artist" && keywordSet.has(entry.value)) {
      score += 35;
      rationaleSet.add(`Artist tag ${entry.value} aligns with project`);
    }
  }

  for (const keyword of keywordSet) {
    if (!keyword || keyword.length < 3) continue;
    if (subjectLower.includes(keyword)) {
      score += 12;
      rationaleSet.add(`Subject contains "${keyword}"`);
    } else if (summaryLower.includes(keyword)) {
      score += 8;
      rationaleSet.add(`Summary references "${keyword}"`);
    } else if (bodyLower.includes(keyword)) {
      score += 5;
      rationaleSet.add(`Body references "${keyword}"`);
    }
  }

  if (fromDomain && keywordSet.has(fromDomain)) {
    score += 10;
    rationaleSet.add(`Sender domain ${fromDomain} matches project metadata`);
  }

  if (context.category.startsWith("LEGAL/")) {
    score += 8;
    rationaleSet.add("Legal category email");
  }

  if (context.category.startsWith("LOGISTICS/")) {
    score += 12;
    rationaleSet.add("Logistics update likely tied to timeline");
  }

  if (context.category.startsWith("PROMO/")) {
    score += 10;
    rationaleSet.add("Promo request needs project routing");
  }

  if (score <= 0) {
    return null;
  }

  const timelineItem = buildTimelineSuggestion(context.category, context.subject, context.receivedAt);

  return {
    project,
    score,
    rationales: Array.from(rationaleSet),
    timelineItem,
    confidence: score,
  };
}

function computeProjectSuggestions(
  projects: ProjectCandidate[],
  context: EmailContext
): ProjectSuggestion[] {
  const suggestions: ProjectSuggestion[] = [];
  for (const project of projects) {
    if (project.status === "archived") continue;
    const suggestion = scoreProjectForContext(project, context);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }
  return suggestions.sort((a, b) => b.score - a.score);
}

async function ensureProjectEmailApproval(
  supabase: SupabaseClientType,
  suggestion: ProjectSuggestion,
  context: EmailContext
): Promise<void> {
  const { project, score, rationales, timelineItem } = suggestion;

  const { data: existingApproval, error: approvalLookupError } = await supabase
    .from("approvals")
    .select("id")
    .eq("project_id", project.id)
    .eq("type", "project_email_link")
    .eq("status", "pending")
    .eq("payload->>emailId", context.emailId)
    .maybeSingle();

  if (approvalLookupError) {
    console.error("Failed to check existing approvals", approvalLookupError);
    return;
  }

  if (existingApproval) {
    return;
  }

  const payload = {
    emailId: context.emailId,
    subject: context.subject,
    fromEmail: context.fromEmail,
    fromName: context.fromName,
    category: context.category,
    labels: context.labels,
    score,
    rationales,
    summary: context.summary,
    timelineItem,
    suggestedAt: new Date().toISOString(),
    source: "worker",
    confidence: score,
  };

  const { error } = await supabase.from("approvals").insert({
    project_id: project.id,
    type: "project_email_link",
    payload,
  });

  if (error) {
    console.error("Failed to create project email approval", error);
  } else {
    console.log(
      `Queued approval to link email ${context.emailId} to project ${project.name} (score=${score})`
    );
  }
}

async function handleProjectSuggestions(
  supabase: SupabaseClientType,
  projects: ProjectCandidate[],
  context: EmailContext
): Promise<void> {
  if (projects.length === 0) return;

  const { data: existingLinks, error: linkError } = await supabase
    .from("project_email_links")
    .select("project_id")
    .eq("email_id", context.emailId);

  if (linkError) {
    console.error("Failed to load existing project email links", linkError);
    return;
  }

  const linkedProjectIds = new Set((existingLinks ?? []).map((row: any) => row.project_id as string));

  const suggestions = computeProjectSuggestions(projects, context)
    .filter((suggestion) => suggestion.score >= 45 && !linkedProjectIds.has(suggestion.project.id))
    .slice(0, 3);

  for (const suggestion of suggestions) {
    await ensureProjectEmailApproval(supabase, suggestion, context);
  }
}

async function main() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GMAIL_REFRESH_TOKEN,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    console.error("Missing required environment variables");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const oauth2Client = GOOGLE_REDIRECT_URI
    ? new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
    : new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const maxEmails = Number(process.env.MAX_EMAILS_TO_PROCESS || 5);
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
      maxResults: maxEmails,
    });
    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      console.log("No unread messages.");
      return;
    }

    const projectCandidates = await fetchActiveProjects(supabase);

    // Cache Gmail label IDs to avoid repeated lookups/creates
    const labelCache: Map<string, string> = new Map();
    let labelsLoaded = false;

    async function loadLabels() {
      if (labelsLoaded) return;
      try {
        const existing = await gmail.users.labels.list({ userId: "me" });
        for (const label of existing.data.labels || []) {
          if (label.name && label.id) {
            labelCache.set(label.name, label.id);
          }
        }
      } finally {
        labelsLoaded = true;
      }
    }

    async function ensureLabelId(name: string): Promise<string> {
      await loadLabels();
      const cached = labelCache.get(name);
      if (cached) return cached;

      const created = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });

      const id = created.data.id;
      if (!id) {
        throw new Error(`Label creation returned no id for ${name}`);
      }

      labelCache.set(name, id);
      return id;
    }

    async function ensureCadenzorLabelIds(labels: EmailLabel[]): Promise<string[]> {
      const base = "Cadenzor";

      try {
        await ensureLabelId(base);
      } catch (err) {
        console.error("Failed to ensure base Gmail label", err);
      }

      const ids: string[] = [];
      const unique = Array.from(new Set(labels));
      for (const label of unique) {
        try {
          const id = await ensureLabelId(`${base}/${label}`);
          if (id) {
            ids.push(id);
          }
        } catch (err) {
          console.error(`Failed to ensure Gmail label for ${label}`, err);
        }
      }

      return ids;
    }

    for (const msg of messages.slice(0, maxEmails)) {
      if (!msg.id) continue;

      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const payload = msgRes.data.payload;
      const headers = (payload?.headers || []) as gmail_v1.Schema$MessagePartHeader[];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

      const subject = getHeader("Subject");
      const fromHeader = getHeader("From");
      const dateHeader = getHeader("Date");
      const body = extractBody(payload) || msgRes.data.snippet || "";

      const { name: fromName, email: fromEmail } = parseFromHeader(fromHeader);
      const receivedAt = new Date(dateHeader || Date.now()).toISOString();
      let labels: EmailLabel[] = [];
      let summary = "";

      const { data: existingEmail, error: existingEmailError } = await supabase
        .from("emails")
        .select("summary, labels")
        .eq("id", msg.id)
        .maybeSingle();

      if (existingEmailError) {
        console.error(`Failed to read existing email ${msg.id}`, existingEmailError);
      }

      if (existingEmail) {
        if (typeof existingEmail.summary === "string" && existingEmail.summary.trim()) {
          summary = existingEmail.summary.trim();
        }
        labels = normaliseLabels(existingEmail.labels);
      }

      if (!summary || labels.length === 0) {
        try {
          const aiResult = await analyzeEmail({
            subject,
            body,
            fromName,
            fromEmail,
          });
          summary = aiResult.summary;
          labels = normaliseLabels(aiResult.labels);
        } catch (err) {
          console.error(`AI classification failed for message ${msg.id}`, err);
          labels = heuristicLabels(subject, body);
        }
      }

      if (labels.length === 0) {
        labels = heuristicLabels(subject, body);
      }

      labels = ensureDefaultLabelCoverage(labels);
      if (labels.length === 0) {
        labels = [EMAIL_FALLBACK_LABEL];
      }

      const category = selectPrimaryCategory(labels) ?? EMAIL_FALLBACK_LABEL;

      const { error: contactError } = await supabase
        .from("contacts")
        .upsert(
          {
            email: fromEmail,
            name: fromName,
            last_email_at: receivedAt,
          },
          { onConflict: "email" }
        );

      if (contactError) {
        console.error("Failed to upsert contact:", contactError);
      }

      const { error: emailError } = await supabase
        .from("emails")
        .upsert(
          {
            id: msg.id,
            from_name: fromName,
            from_email: fromEmail,
            subject,
            received_at: receivedAt,
            category,
            is_read: false,
            summary,
            labels,
          },
          { onConflict: "id" }
        );

      if (emailError) {
        console.error("Failed to upsert email:", emailError);
      }

      // Apply labels back to Gmail so they are visible in the user's inbox
      try {
        const addLabelIds = await ensureCadenzorLabelIds(labels);
        if (addLabelIds.length > 0) {
          await gmail.users.messages.modify({
            userId: "me",
            id: msg.id,
            requestBody: { addLabelIds },
          });
        }
      } catch (err) {
        console.error(`Failed to apply Gmail labels for message ${msg.id}`, err);
      }

      const labelEntries = parseEmailLabels(labels);
      const context: EmailContext = {
        emailId: msg.id,
        subject,
        body,
        summary,
        labels,
        labelEntries,
        category,
        fromEmail,
        fromName,
        receivedAt,
      };

      await handleProjectSuggestions(supabase, projectCandidates, context);

      console.log(
        `Processed message ${msg.id} -> ${category} (${labels.join(", ")}) summary length=${summary.length}`
      );
    }
  } catch (err) {
    console.error(err);
  }
}

main().catch((e) => console.error(e));
