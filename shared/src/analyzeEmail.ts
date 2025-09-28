import type { EmailCategory } from "./types";

export interface EmailAnalysisInput {
  subject: string;
  body: string;
  fromName: string | null;
  fromEmail: string;
}

export interface EmailAnalysisResult {
  summary: string;
  labels: EmailCategory[];
}

export const CATEGORY_VALUES: EmailCategory[] = [
  "booking",
  "promo_time",
  "promo_submission",
  "logistics",
  "assets_request",
  "finance",
  "fan_mail",
  "legal",
  "other",
];

function ensureApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return key;
}

function normaliseCategory(label: string | null | undefined): EmailCategory | null {
  if (!label || typeof label !== "string") return null;
  const canonical = label.trim().toLowerCase().replace(/\s+/g, "_");
  return CATEGORY_VALUES.find((cat) => cat === canonical) ?? null;
}

function parseLabels(value: unknown): EmailCategory[] {
  if (!Array.isArray(value)) return ["other"];

  const mapped = value
    .map((item) => (typeof item === "string" ? normaliseCategory(item) : null))
    .filter((item): item is EmailCategory => item !== null);

  if (mapped.length === 0) {
    return ["other"];
  }

  return [...new Set(mapped)];
}

function parseSummary(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  return value.trim();
}

export async function analyzeEmail(
  input: EmailAnalysisInput
): Promise<EmailAnalysisResult> {
  const apiKey = ensureApiKey();

  const systemMessage = `You are an assistant that classifies music industry emails for an artist manager. Choose zero or more labels from the following list only: ${CATEGORY_VALUES.join(", ")}. Provide the most relevant labels in order of importance. Always include "other" if nothing fits.`;

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
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Summarise the email in no more than 120 words and return JSON with keys "summary" (string) and "labels" (array of the allowed labels). Email data: ${JSON.stringify(
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
