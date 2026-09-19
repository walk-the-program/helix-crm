/**
 * The provider, with an injected fetch: no network, no keychain, no Tauri.
 *
 * What these prove, in the order the plan's error map lists them: a good answer
 * parses, 401 is AiKeyRejected, 429 and 5xx are AiRequestError and are retried,
 * malformed JSON is AiParseError with the raw text kept - and the key never
 * appears in a log line, a URL, or an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnthropicProvider,
  ANTHROPIC_VERSION,
} from "../../../src/features/ai/provider";
import {
  AiKeyMissing,
  AiKeyRejected,
  AiParseError,
  AiRequestError,
} from "../../../src/features/ai/errors";
import type { FetchLike } from "../../../src/features/ai/lib/http";

const KEY = "sk-ant-test-key-do-not-log-1234";

type Call = { url: string; init: Parameters<FetchLike>[1] };

function stubFetch(
  responses: { status: number; body: string }[],
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => response.body,
    };
  };
  return { fetchImpl, calls };
}

function messageWith(json: unknown): string {
  return JSON.stringify({
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(json) }],
    usage: { input_tokens: 120, output_tokens: 60 },
  });
}

const GOOD_RECORD = {
  contact: {
    firstName: "Dana",
    lastName: "Whitaker",
    email: "dana@example.com",
    phone: "801-555-0147",
    companyName: null,
    notes: null,
  },
  deal: {
    title: "Sprinkler repair",
    value: 600,
    expectedOn: null,
    summary: "Sprinklers flooding the driveway.",
  },
};

function provider(fetchImpl: FetchLike, extra: { maxRetries?: number } = {}) {
  return createAnthropicProvider({
    apiKey: KEY,
    model: "claude-sonnet-5",
    baseUrl: "https://api.anthropic.com",
    fetchImpl,
    sleep: async () => undefined,
    ...extra,
  });
}

describe("provider: a good answer", () => {
  it("parses the proposed contact and deal", async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: messageWith(GOOD_RECORD) },
    ]);

    const result = await provider(fetchImpl).extractRecord(
      "Hi, this is Dana Whitaker at 801-555-0147...",
    );

    expect(result.contact.firstName).toBe("Dana");
    expect(result.deal.title).toBe("Sprinkler repair");
    expect(result.deal.value).toBe(600);
    expect(calls).toHaveLength(1);
  });

  it("posts to /v1/messages with the version header and a JSON schema", async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: messageWith(GOOD_RECORD) },
    ]);
    await provider(fetchImpl).extractRecord("text");

    const call = calls[0];
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.headers?.["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(call.init?.headers?.["x-api-key"]).toBe(KEY);

    const body = JSON.parse(call.init?.body ?? "{}") as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBeGreaterThan(0);
    // temperature is removed on the Claude 5 models and 400s if sent.
    expect(body).not.toHaveProperty("temperature");
    const outputConfig = body.output_config as Record<string, unknown>;
    const format = outputConfig.format as Record<string, unknown>;
    expect(format.type).toBe("json_schema");
    expect(format.schema).toBeTruthy();
  });

  it("leaves effort off for a model that does not take it", async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: messageWith(GOOD_RECORD) },
    ]);
    await createAnthropicProvider({
      apiKey: KEY,
      model: "claude-haiku-4-5",
      fetchImpl,
      sleep: async () => undefined,
    }).extractRecord("text");

    const body = JSON.parse(calls[0].init?.body ?? "{}") as {
      output_config: Record<string, unknown>;
    };
    expect(body.output_config).not.toHaveProperty("effort");
  });

  it("drafts a follow-up and summarises", async () => {
    const draft = stubFetch([
      { status: 200, body: messageWith({ subject: "Your sprinklers", body: "Hi Dana," }) },
    ]);
    const result = await provider(draft.fetchImpl).draftFollowUp(
      {
        title: "Sprinkler repair",
        stage: "New lead",
        value: "$600.00",
        contactName: "Dana Whitaker",
        companyName: null,
        expectedOn: null,
      },
      [{ kind: "note", at: "2026-09-01", text: "Left a voicemail." }],
    );
    expect(result.subject).toBe("Your sprinklers");

    const summary = stubFetch([
      { status: 200, body: messageWith({ summary: "Dana wants a sprinkler fixed." }) },
    ]);
    const text = await provider(summary.fetchImpl).summarize(
      { kind: "deal", name: "Sprinkler repair", fields: [] },
      [],
    );
    expect(text).toBe("Dana wants a sprinkler fixed.");
  });
});

describe("provider: the named errors", () => {
  it("401 is AiKeyRejected and carries the API's own message", async () => {
    const { fetchImpl, calls } = stubFetch([
      {
        status: 401,
        body: JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
      },
    ]);

    await expect(provider(fetchImpl).extractRecord("text")).rejects.toBeInstanceOf(
      AiKeyRejected,
    );
    // Not retried: a wrong key stays wrong.
    expect(calls).toHaveLength(1);

    try {
      await provider(stubFetch([{ status: 401, body: "{}" }]).fetchImpl).extractRecord(
        "text",
      );
    } catch (err) {
      expect(err).toBeInstanceOf(AiKeyRejected);
      expect((err as AiKeyRejected).code).toBe("AI_KEY_REJECTED");
    }
  });

  it("429 retries once, then reports AiRequestError as retryable", async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 429, body: JSON.stringify({ error: { message: "rate limited" } }) },
    ]);

    const error = await provider(fetchImpl)
      .extractRecord("text")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AiRequestError);
    expect((error as AiRequestError).status).toBe(429);
    expect((error as AiRequestError).retryable).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("a 500 that clears on the retry succeeds", async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 500, body: "upstream boom" },
      { status: 200, body: messageWith(GOOD_RECORD) },
    ]);

    const result = await provider(fetchImpl).extractRecord("text");
    expect(result.contact.lastName).toBe("Whitaker");
    expect(calls).toHaveLength(2);
  });

  it("a dropped connection is AiRequestError after the retry", async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts += 1;
      throw new Error("network down");
    };

    const error = await provider(fetchImpl)
      .extractRecord("text")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AiRequestError);
    expect((error as AiRequestError).status).toBeNull();
    expect(attempts).toBe(2);
  });

  it("malformed JSON is AiParseError and keeps the raw text", async () => {
    const { fetchImpl } = stubFetch([
      {
        status: 200,
        body: JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Sure! Here you go: {contact: oops" }],
        }),
      },
    ]);

    const error = await provider(fetchImpl)
      .extractRecord("text")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AiParseError);
    expect((error as AiParseError).raw).toContain("{contact: oops");
  });

  it("JSON of the wrong shape is AiParseError, not a silent half-record", async () => {
    const { fetchImpl } = stubFetch([
      { status: 200, body: messageWith({ contact: { firstName: "Dana" } }) },
    ]);

    const error = await provider(fetchImpl)
      .extractRecord("text")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AiParseError);
  });

  it("a refusal is reported and not retried", async () => {
    const { fetchImpl, calls } = stubFetch([
      {
        status: 200,
        body: JSON.stringify({ stop_reason: "refusal", content: [] }),
      },
    ]);

    const error = await provider(fetchImpl)
      .extractRecord("text")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AiRequestError);
    expect((error as AiRequestError).retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("refuses to build without a key", () => {
    expect(() => createAnthropicProvider({ apiKey: "   " })).toThrow(AiKeyMissing);
  });

  it("an empty paste never reaches the network", async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: "{}" }]);
    await expect(provider(fetchImpl).extractRecord("   ")).rejects.toBeInstanceOf(
      AiParseError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("provider: the key never leaks", () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  const written: string[] = [];

  beforeEach(() => {
    written.length = 0;
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          written.push(args.map((a) => String(a)).join(" "));
        }),
      );
    }
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  it("is absent from the console, the URL and every error, on every path", async () => {
    const cases: { status: number; body: string }[][] = [
      [{ status: 200, body: messageWith(GOOD_RECORD) }],
      [{ status: 401, body: JSON.stringify({ error: { message: "bad key" } }) }],
      [{ status: 429, body: "slow down" }],
      [{ status: 500, body: "boom" }],
      [{ status: 200, body: JSON.stringify({ content: [{ type: "text", text: "{" }] }) }],
    ];

    for (const responses of cases) {
      const { fetchImpl, calls } = stubFetch(responses);
      const outcome = await provider(fetchImpl)
        .extractRecord("text")
        .catch((err: unknown) => err);

      for (const call of calls) {
        expect(call.url).not.toContain(KEY);
        expect(call.init?.body ?? "").not.toContain(KEY);
      }
      if (outcome instanceof Error) {
        expect(outcome.message).not.toContain(KEY);
        expect(JSON.stringify(outcome, Object.getOwnPropertyNames(outcome))).not.toContain(
          KEY,
        );
      }
    }

    expect(written.join("\n")).not.toContain(KEY);
  });
});
