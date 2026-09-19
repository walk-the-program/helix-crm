/**
 * The named AI errors from PLAN.md's error and rescue map. Each one says what
 * happened and what the owner can do; nothing here is a catch-all.
 *
 *   AiKeyMissing   AI is on but there is no key in the keychain
 *   AiKeyRejected  401: the key is wrong, revoked, or from another account
 *   AiRequestError 429 / 5xx / network: worth retrying
 *   AiParseError   the model answered with something that is not the shape we
 *                  asked for. The raw text is kept on the error so nothing the
 *                  owner pasted is lost.
 */
export class AiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

export class AiKeyMissing extends AiError {
  constructor(message = "No Anthropic key is saved for this workspace.") {
    super("AI_KEY_MISSING", message);
    this.name = "AiKeyMissing";
  }
}

export class AiKeyRejected extends AiError {
  /** The API's own message, which names the actual problem. */
  readonly detail: string;
  constructor(detail: string) {
    super("AI_KEY_REJECTED", "Anthropic rejected that key.");
    this.name = "AiKeyRejected";
    this.detail = detail;
  }
}

function requestSentence(status: number | null): string {
  if (status === 429) {
    return "Anthropic is rate limiting this key. Wait a moment and try again.";
  }
  if (status !== null && status >= 500) {
    return "Anthropic had a problem answering. Try again.";
  }
  if (status !== null) {
    return "Anthropic refused that request.";
  }
  return "Could not reach Anthropic. Check the connection and try again.";
}

export class AiRequestError extends AiError {
  readonly status: number | null;
  readonly detail: string;
  /** True for 429 and 5xx and for a dropped connection: try again later. */
  readonly retryable: boolean;
  constructor(
    status: number | null,
    detail: string,
    options: { message?: string; retryable?: boolean } = {},
  ) {
    super("AI_REQUEST_ERROR", options.message ?? requestSentence(status));
    this.name = "AiRequestError";
    this.status = status;
    this.detail = detail;
    this.retryable =
      options.retryable ??
      (status === null || status === 429 || status >= 500);
  }
}

export class AiParseError extends AiError {
  /** Everything the model said, kept so the owner can copy it out. */
  readonly raw: string;
  constructor(raw: string, detail = "The answer was not in the shape we asked for.") {
    super("AI_PARSE_ERROR", detail);
    this.name = "AiParseError";
    this.raw = raw;
  }
}

/** The sentence a screen shows for any of them. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof AiKeyRejected) return `${err.message} ${err.detail}`.trim();
  if (err instanceof AiRequestError) return `${err.message} (${err.detail})`;
  if (err instanceof AiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
