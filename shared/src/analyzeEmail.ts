import {
  CROSS_LABEL_DEFINITIONS,
  EMAIL_FALLBACK_LABEL,
  PRIMARY_LABEL_DEFINITIONS,
} from "./types";
import type { EmailLabel } from "./types";
import { normaliseLabels } from "./labelUtils";

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

const PRIMARY_LABEL_GUIDE = PRIMARY_LABEL_DEFINITIONS.map(
  ({ name, meaning, whyItMatters }) => `- ${name}: ${meaning} Why: ${whyItMatters}`
).join("\n");

const CROSS_LABEL_GUIDE = CROSS_LABEL_DEFINITIONS.map(
  ({ prefix, meaning, whyItMatters }) => `- ${prefix}/{value}: ${meaning} Why: ${whyItMatters}`
).join("\n");

const PLAYBOOK_CUES: Array<{ scope: string; instruction: string }> = [
  {
    scope: "LEGAL/",
    instruction:
      "Never auto-send. Keep drafts only, route to owner or manager for approval, extract key terms (fee, exclusivity, territory, dates), attach them to Projects and Bookings, and enforce tight retention with restricted sharing.",
  },
  {
    scope: "FINANCE/Settlement",
    instruction:
      "Parse statements into line items, costs, taxes, and net; update the ledger; tag city/venue/date; link to the show Project; require two-step verification for banking changes; remind teams about unpaid invoices or mismatched remittances.",
  },
  {
    scope: "LOGISTICS/",
    instruction:
      "Create or refresh timeline items for travel, accommodation, and technical advance. Validate buffers and conflicts, and push key contacts plus day sheets to the Project hub.",
  },
  {
    scope: "BOOKING/",
    instruction:
      "Create a lead, propose or set holds, scaffold the show folder, draft a reply, kick off brand-fit scoring, and attach to an existing Project or suggest a new one.",
  },
  {
    scope: "PROMO/Promo_Time_Request",
    instruction:
      "Propose time-zone-aware slots based on routing, generate reply drafts, and set tentative promo holds on the Project timeline.",
  },
  {
    scope: "PROMO/Promos_Submission",
    instruction:
      "Acknowledge receipt automatically, add to the listening queue, and tag the sender as a promo contact.",
  },
  {
    scope: "ASSETS/",
    instruction:
      "Canonicalise filenames, store items in the asset library, update track report completeness, and auto-attach correct links in replies.",
  },
  {
    scope: "FAN/",
    instruction:
      "Send a friendly auto-acknowledgement, include in the weekly digest, and escalate only if flagged as issues or safety.",
  },
];

const PLAYBOOK_GUIDE = PLAYBOOK_CUES.map(
  ({ scope, instruction }) => `- ${scope}: ${instruction}`
).join("\n");

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
  const normalised = normaliseLabels(value);
  if (normalised.length === 0) {
    return [EMAIL_FALLBACK_LABEL];
  }

  return normalised.slice(0, MAX_LABELS);
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

  const systemMessage = [
    "You are an assistant labelling inbox emails for an artist manager.",
    `Return between 1 and ${MAX_LABELS} labels for each message.`,
    "Primary labels (always include at least one and place it first):",
    PRIMARY_LABEL_GUIDE,
    "",
    "Cross-tag prefixes (optional, append after the primary label only when evidence exists):",
    CROSS_LABEL_GUIDE,
    "",
    "Playbook cues:",
    PLAYBOOK_GUIDE,
    "",
    "Rules:",
    "- Use the exact label names and casing shown above.",
    `- Never invent new primary labels; use ${EMAIL_FALLBACK_LABEL} alone when nothing fits.`,
    "- Optional cross-tags must follow the format prefix/value using the supported prefixes.",
    "- Prioritise concise, factual summaries supporting the chosen labels.",
  ].join("\n");

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
            text: `Summarise the email in no more than 120 words and return JSON with keys "summary" (string) and "labels" (array of up to ${MAX_LABELS} strings). Labelling rules: (1) include at least one primary label and put it first, (2) append any supported cross-tags after the primary label when the content provides that metadata, (3) use the exact casing provided in the taxonomy, (4) if no primary label fits, use only ${EMAIL_FALLBACK_LABEL}. Email data: ${JSON.stringify(
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
