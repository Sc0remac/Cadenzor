import { DEFAULT_EMAIL_LABELS } from "./types";
import type { EmailLabel } from "./types";

export interface EmailAnalysisInput {
  subject: string;
  body: string;
  fromName: string | null;
  fromEmail: string;
}

export interface EmailAnalysisResult {
  summary: string;
  labels: EmailLabel[];
}

const MAX_LABELS = 3;

function ensureApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return key;
}

function parseLabels(value: unknown): EmailLabel[] {
  if (!Array.isArray(value)) return ["general"];

  const mapped = value
    .map((item) =>
      typeof item === "string"
        ? item
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s_-]/g, "")
            .replace(/\s+/g, "_")
        : null
    )
    .filter((item): item is string => !!item);

  if (mapped.length === 0) {
    return ["general"];
  }

  const unique = Array.from(new Set(mapped));
  return unique.slice(0, MAX_LABELS);
}

function parseSummary(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  return value.trim();
}

export async function analyzeEmail(
  input: EmailAnalysisInput
): Promise<EmailAnalysisResult> {
  const apiKey = ensureApiKey();

  const systemMessage = `You are an assistant labelling inbox emails for an artist manager. You must always return at least one label. Start from these defaults when they apply: ${DEFAULT_EMAIL_LABELS.join(", ")}. If none apply, invent a concise new label that uses lowercase words joined by underscores (e.g. "tour_planning"). Put the most specific label first.`;

  const userPayload = {
    subject: input.subject,
    from_name: input.fromName,
    from_email: input.fromEmail,
    body: input.body,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Summarise the email in no more than 120 words and return JSON with keys "summary" (string) and "labels" (array of ${MAX_LABELS} lowercase underscore labels). Always include at least one label. Email data: ${JSON.stringify(
                userPayload
              )}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const content: string | undefined = payload?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI response missing content");
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse OpenAI JSON content: ${content}`);
  }

  const summary = parseSummary((parsed as Record<string, unknown>)?.summary);
  const labels = parseLabels((parsed as Record<string, unknown>)?.labels);

  return { summary, labels };
}
