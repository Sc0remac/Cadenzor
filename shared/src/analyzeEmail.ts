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
const BODY_CHAR_LIMIT = Number(process.env.OPENAI_BODY_CHAR_LIMIT || 4000);
const MAX_ATTEMPTS = Number(process.env.OPENAI_MAX_RETRIES || 4);
const BASE_RETRY_DELAY_MS = Number(process.env.OPENAI_RETRY_DELAY_MS || 1500);
const MAX_RETRY_DELAY_MS = Number(process.env.OPENAI_MAX_RETRY_DELAY_MS || 12000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function truncateContent(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}…`;
}

function stripQuotedText(body: string): string {
  const lines = body.split(/\r?\n/);
  const result: string[] = [];

  for (const line of lines) {
    if (/^On .* wrote:$/i.test(line.trim())) {
      break;
    }

    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) {
      break;
    }

    if (/^From:\s.*$/i.test(line.trim())) {
      break;
    }

    if (line.trim().startsWith(">")) {
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

function normaliseBody(body: string): string {
  if (!body) {
    return "";
  }

  const withoutQuoted = stripQuotedText(body)
    .replace(/\r/g, "")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .trim();

  const collapsed = withoutQuoted.replace(/\n{3,}/g, "\n\n");
  return truncateContent(collapsed, BODY_CHAR_LIMIT);
}

function normaliseSubject(subject: string): string {
  if (!subject) {
    return "";
  }
  return truncateContent(subject.trim(), 300);
}

export async function analyzeEmail(
  input: EmailAnalysisInput
): Promise<EmailAnalysisResult> {
  const apiKey = ensureApiKey();

  const systemMessage = `You are an assistant labelling inbox emails for an artist manager. You must always return at least one label. Start from these defaults when they apply: ${DEFAULT_EMAIL_LABELS.join(", ")}. If none apply, invent a concise new label that uses lowercase words joined by underscores (e.g. "tour_planning"). Put the most specific label first.`;

  const sanitizedSubject = normaliseSubject(input.subject);
  const sanitizedBody = normaliseBody(input.body);

  const userPayload = {
    subject: sanitizedSubject,
    from_name: input.fromName,
    from_email: input.fromEmail,
    body: sanitizedBody,
  };

  const requestBody = JSON.stringify({
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
  });

  let attempt = 0;
  let delayMs = BASE_RETRY_DELAY_MS;
  let lastError: Error | null = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      });

      if (response.ok) {
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

      const errorText = await response.text();
      const status = response.status;

      const error = new Error(`OpenAI request failed: ${status} ${errorText}`);
      lastError = error;

      if (status === 429 || status === 503) {
        const retryAfter = response.headers.get("retry-after");
        let waitMs = delayMs;
        if (retryAfter) {
          const parsed = Number(retryAfter);
          if (!Number.isNaN(parsed)) {
            waitMs = parsed * 1000;
          } else {
            const retryDate = new Date(retryAfter).getTime();
            if (!Number.isNaN(retryDate)) {
              waitMs = Math.max(retryDate - Date.now(), delayMs);
            }
          }
        }

        await sleep(waitMs);
        delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS);
        continue;
      }

      throw error;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= MAX_ATTEMPTS) {
        break;
      }
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS);
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
}
