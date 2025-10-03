import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeEmail } from "../analyzeEmail";
import { EMAIL_FALLBACK_LABEL } from "../types";

declare const global: typeof globalThis;

describe("analyzeEmail", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_RETRY_DELAY_MS = "1";
    process.env.OPENAI_MAX_RETRY_DELAY_MS = "2";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends sanitized payloads to OpenAI and returns parsed labels", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      const payload = body.messages[1].content[0].text;
      expect(payload).not.toContain("http://example.com");
      expect(payload).toContain("[link]");
      expect(payload).toContain("Sanitised Subject");
      expect(payload).toContain("body excerpt");

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "A concise summary",
                  labels: ["FINANCE/Invoice", "promo/pitch"],
                }),
              },
            },
          ],
        }),
      } as Response;
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await analyzeEmail({
      subject: "   Sanitised Subject   ",
      body: "Here is the body excerpt. Visit http://example.com for more info.\n> quoted text", 
      fromName: "Sender Name",
      fromEmail: "sender@example.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("A concise summary");
    expect(result.labels).toEqual(["FINANCE/Invoice"]);
  });

  it("retries on rate limits before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => "rate limited",
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Retried summary",
                  labels: ["LOGISTICS/Travel"],
                }),
              },
            },
          ],
        }),
      }));

    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await analyzeEmail({
      subject: "Retry",
      body: "Flight info",
      fromName: null,
      fromEmail: "sender@example.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.labels).toEqual(["LOGISTICS/Travel"]);
  });

  it("falls back to default label when OpenAI returns no labels", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ summary: "No labels", labels: [] }),
            },
          },
        ],
      }),
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await analyzeEmail({
      subject: "No label",
      body: "",
      fromName: null,
      fromEmail: "sender@example.com",
    });

    expect(result.labels).toEqual([EMAIL_FALLBACK_LABEL]);
  });
});
