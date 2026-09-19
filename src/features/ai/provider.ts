/**
 * The AI provider.
 *
 *   caller --> AiProvider ---> POST <baseUrl>/v1/messages
 *                  |            x-api-key, anthropic-version: 2023-06-01
 *                  |            output_config.format = a JSON schema
 *                  |
 *                  +-- 401           -> AiKeyRejected
 *                  +-- 429 / 5xx     -> AiRequestError (retried once)
 *                  +-- network       -> AiRequestError
 *                  +-- bad JSON      -> AiParseError, raw text kept
 *
 * The wire shape (endpoint, headers, `output_config: { format: { type:
 * "json_schema", schema } }`, the model ids) comes from the claude-api skill,
 * read on 2026-09-18. Two things it is specific about and this file obeys:
 * `temperature` is removed on the Claude 5 models and returns a 400, and
 * `output_config.effort` is not accepted by Haiku 4.5.
 *
 * Three rules from PLAN.md's security section, all load-bearing here:
 *   - the key is never logged, never put in a URL, never stored outside the
 *     keychain, and never included in an error;
 *   - only the record on screen is sent, and only when the owner presses a
 *     button - nothing in this file runs on a timer;
 *   - what comes back is untrusted data. It is parsed, validated, and shown for
 *     confirmation. It is never saved without the owner pressing Confirm, and
 *     it is never executed.
 *
 * The request goes out through `fetch` from @tauri-apps/plugin-http, so it is
 * made by Rust and the webview's CSP and CORS rules never see it. Every entry
 * point takes an injectable fetch, which is what the unit tests use.
 */
import { z } from "zod";
import {
  AiKeyMissing,
  AiKeyRejected,
  AiParseError,
  AiRequestError,
} from "@/features/ai/errors";
import { resolveFetch, type FetchLike } from "@/features/ai/lib/http";
import { DEFAULT_MODEL, supportsEffort } from "@/features/ai/lib/models";
import { DEFAULT_BASE_URL } from "@/features/ai/lib/aiSettings";

export const ANTHROPIC_VERSION = "2023-06-01";

/* -------------------------------------------------------------------------- */
/* what the three actions take and return                                     */
/* -------------------------------------------------------------------------- */

export const proposedContactSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyName: z.string().nullable(),
  notes: z.string().nullable(),
});

export const proposedDealSchema = z.object({
  title: z.string(),
  /** Whole currency units as the text stated them; cents are computed later. */
  value: z.number().nullable(),
  expectedOn: z.string().nullable(),
  summary: z.string().nullable(),
});

export const proposedRecordSchema = z.object({
  contact: proposedContactSchema,
  deal: proposedDealSchema,
});

export type ProposedContact = z.infer<typeof proposedContactSchema>;
export type ProposedDeal = z.infer<typeof proposedDealSchema>;
export type ProposedRecord = z.infer<typeof proposedRecordSchema>;

export const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});
export type Draft = z.infer<typeof draftSchema>;

/** Only what is on screen: no ids, no other records, no whole-database context. */
export type DealContext = {
  title: string;
  stage: string;
  value: string | null;
  contactName: string | null;
  companyName: string | null;
  expectedOn: string | null;
};

export type RecordContext = {
  kind: "contact" | "company" | "deal";
  name: string;
  fields: { label: string; value: string }[];
};

export type TimelineEntry = {
  kind: string;
  at: string;
  text: string;
};

export interface AiProvider {
  extractRecord(text: string): Promise<ProposedRecord>;
  draftFollowUp(deal: DealContext, timeline: TimelineEntry[]): Promise<Draft>;
  summarize(record: RecordContext, timeline: TimelineEntry[]): Promise<string>;
  /** One tiny request, used by Settings > AI to check a key. */
  testKey(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* the JSON schemas the API is asked to answer in                             */
/* -------------------------------------------------------------------------- */

const RECORD_JSON_SCHEMA = {
  type: "object",
  properties: {
    contact: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        companyName: { type: ["string", "null"] },
        notes: { type: ["string", "null"] },
      },
      required: ["firstName", "lastName", "email", "phone", "companyName", "notes"],
      additionalProperties: false,
    },
    deal: {
      type: "object",
      properties: {
        title: { type: "string" },
        value: { type: ["number", "null"] },
        expectedOn: { type: ["string", "null"] },
        summary: { type: ["string", "null"] },
      },
      required: ["title", "value", "expectedOn", "summary"],
      additionalProperties: false,
    },
  },
  required: ["contact", "deal"],
  additionalProperties: false,
} as const;

const DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
} as const;

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
} as const;

/* -------------------------------------------------------------------------- */
/* the Anthropic implementation                                               */
/* -------------------------------------------------------------------------- */

export type AnthropicProviderOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injected by the tests; defaults to the plugin-http fetch. */
  fetchImpl?: FetchLike;
  /** One retry by default, for 429 / 5xx / network. */
  maxRetries?: number;
  /** Injected by the tests so a retry does not really wait. */
  sleep?: (ms: number) => Promise<void>;
};

type MessagesRequest = {
  system: string;
  user: string;
  schema: unknown;
  maxTokens: number;
  effort: "low" | "medium";
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function normaliseBaseUrl(url: string | undefined): string {
  const value = (url ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  return value.replace(/\/+$/, "");
}

/** Whatever the API said went wrong, without ever echoing the request. */
function errorDetail(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof parsed.error === "object" &&
      "message" in parsed.error
    ) {
      return String((parsed.error as { message: unknown }).message);
    }
  } catch {
    // Not JSON: the status line is all we have.
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 300) : `HTTP ${status}`;
}

/** The text blocks of a Messages response, joined. */
function textFromResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("content" in payload)) return "";
  const content = (payload as { content: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        Boolean(block) &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): AiProvider {
  const apiKey = options.apiKey.trim();
  if (apiKey.length === 0) throw new AiKeyMissing();

  const model = options.model?.trim() || DEFAULT_MODEL;
  const baseUrl = normaliseBaseUrl(options.baseUrl);
  const maxRetries = options.maxRetries ?? 1;
  const sleep = options.sleep ?? defaultSleep;

  async function transport(): Promise<FetchLike> {
    return options.fetchImpl ?? (await resolveFetch());
  }

  async function send(request: MessagesRequest): Promise<string> {
    const fetchImpl = await transport();
    const outputConfig: Record<string, unknown> = {
      format: { type: "json_schema", schema: request.schema },
    };
    // Haiku 4.5 rejects `effort`; the Claude 5 models take it.
    if (supportsEffort(model)) outputConfig.effort = request.effort;

    const body = JSON.stringify({
      model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      output_config: outputConfig,
    });

    let attempt = 0;
    // The loop runs at most maxRetries + 1 times; only a retryable failure
    // comes back around, and only after a wait.
    for (;;) {
      let status = 0;
      let text = "";
      try {
        const response = await fetchImpl(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // The key travels in a header, never in the URL or the body.
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body,
        });
        status = response.status;
        text = await response.text();
        if (response.ok) return text;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const failure = new AiRequestError(null, detail);
        if (attempt >= maxRetries) throw failure;
        attempt += 1;
        await sleep(400 * attempt);
        continue;
      }

      if (status === 401 || status === 403) {
        throw new AiKeyRejected(errorDetail(status, text));
      }
      const failure = new AiRequestError(status, errorDetail(status, text));
      if (!failure.retryable || attempt >= maxRetries) throw failure;
      attempt += 1;
      await sleep(400 * attempt);
    }
  }

  async function ask<S extends z.ZodType>(
    request: MessagesRequest,
    schema: S,
  ): Promise<z.infer<S>> {
    const raw = await send(request);

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AiParseError(raw, "Anthropic sent something that was not JSON.");
    }

    const stopReason =
      payload && typeof payload === "object" && "stop_reason" in payload
        ? String((payload as { stop_reason: unknown }).stop_reason)
        : null;
    if (stopReason === "refusal") {
      throw new AiRequestError(null, "stop_reason: refusal", {
        message: "Claude declined to answer that one. Nothing was saved.",
        retryable: false,
      });
    }

    const text = textFromResponse(payload);
    if (text.length === 0) {
      throw new AiParseError(raw, "Anthropic answered with nothing to read.");
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AiParseError(text);
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new AiParseError(text, "The answer was missing something we need.");
    }
    return parsed.data as z.infer<S>;
  }

  return {
    async extractRecord(input: string): Promise<ProposedRecord> {
      const text = input.trim();
      if (text.length === 0) {
        throw new AiParseError("", "There is nothing pasted to read.");
      }
      return ask(
        {
          system: [
            "You read one piece of text a small business owner pasted in - an email, a text message, or a voicemail transcript - and pull out the person and the job they are asking about.",
            "Answer only with what the text actually says. Never invent a name, a number, an email address or a price. Anything the text does not state is null.",
            "firstName and lastName are empty strings if no name is given. phone is written exactly as it appears. value is the number of dollars as a plain number, with no symbol or separators, and null when no price is mentioned. expectedOn is an ISO date (YYYY-MM-DD) only when the text gives a real date; otherwise null.",
            "title is a short job title in the owner's words, such as \"Sprinkler repair\" or \"Patio quote\".",
          ].join("\n"),
          user: text,
          schema: RECORD_JSON_SCHEMA,
          maxTokens: 2048,
          effort: "low",
        },
        proposedRecordSchema,
      );
    },

    async draftFollowUp(deal: DealContext, timeline: TimelineEntry[]): Promise<Draft> {
      const lines = timeline
        .slice(0, 30)
        .map((entry) => `- ${entry.at} ${entry.kind}: ${entry.text}`)
        .join("\n");
      return ask(
        {
          system: [
            "You draft a short follow-up email for a tradesperson or small service business owner to send to a customer.",
            "Plain words, no marketing language, no exclamation marks, no emoji. Five sentences at most.",
            "Refer only to what the history below actually says. Never invent a price, a date or a promise.",
            "The body ends without a signature: the owner signs it himself.",
          ].join("\n"),
          user: [
            `Job: ${deal.title}`,
            `Stage: ${deal.stage}`,
            deal.value ? `Value: ${deal.value}` : null,
            deal.contactName ? `Customer: ${deal.contactName}` : null,
            deal.companyName ? `Company: ${deal.companyName}` : null,
            deal.expectedOn ? `Expected: ${deal.expectedOn}` : null,
            "",
            "History, newest first:",
            lines || "- nothing logged yet",
          ]
            .filter((line) => line !== null)
            .join("\n"),
          schema: DRAFT_JSON_SCHEMA,
          maxTokens: 2048,
          effort: "medium",
        },
        draftSchema,
      );
    },

    async summarize(record: RecordContext, timeline: TimelineEntry[]): Promise<string> {
      const lines = timeline
        .slice(0, 40)
        .map((entry) => `- ${entry.at} ${entry.kind}: ${entry.text}`)
        .join("\n");
      const result = await ask(
        {
          system: [
            "You summarise one record from a small business CRM so the owner can catch up in ten seconds.",
            "Three or four plain sentences: who this is, where the work stands, and what was promised or is owed next.",
            "Only what the text below says. No advice, no invented facts, no exclamation marks.",
          ].join("\n"),
          user: [
            `${record.kind}: ${record.name}`,
            ...record.fields.map((f) => `${f.label}: ${f.value}`),
            "",
            "History, newest first:",
            lines || "- nothing logged yet",
          ].join("\n"),
          schema: SUMMARY_JSON_SCHEMA,
          maxTokens: 1024,
          effort: "low",
        },
        z.object({ summary: z.string() }),
      );
      return result.summary;
    },

    async testKey(): Promise<void> {
      await ask(
        {
          system: "Answer with the single word ok.",
          user: "ok",
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
          maxTokens: 64,
          effort: "low",
        },
        z.object({ ok: z.boolean() }),
      );
    },
  };
}
