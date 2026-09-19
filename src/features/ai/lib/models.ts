/**
 * The models offered in Settings > AI.
 *
 * Ids and tiers come from the claude-api skill (`~/.claude/skills/claude-api`,
 * read 2026-09-18), not from memory. The default is the mid-tier Claude 5
 * model: this is a CRM doing short extractions and short drafts, and the owner
 * is paying for every token himself.
 *
 * Structured output (`output_config.format` with a JSON schema) is supported on
 * all three, which is what the provider relies on.
 */
export type AiModel = {
  id: string;
  label: string;
  /** One line the owner can actually choose on. */
  note: string;
  /**
   * `output_config.effort` is a Claude 5 parameter: Haiku 4.5 errors on it, so
   * the provider only sends it for the models that take it.
   */
  supportsEffort: boolean;
};

export const AI_MODELS: AiModel[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5 (recommended)",
    note: "The middle option. Fast, cheap enough to use all day, and accurate on a pasted email.",
    supportsEffort: true,
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    note: "The strongest. Better on messy notes and long threads; costs about two and a half times Sonnet.",
    supportsEffort: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    note: "The cheapest and quickest. Fine for tidy text, weaker on anything ambiguous.",
    supportsEffort: false,
  },
];

export function supportsEffort(id: string): boolean {
  return AI_MODELS.find((m) => m.id === id)?.supportsEffort ?? false;
}

export const DEFAULT_MODEL = "claude-sonnet-5";

export function isKnownModel(id: string): boolean {
  return AI_MODELS.some((m) => m.id === id);
}

export function modelLabel(id: string): string {
  return AI_MODELS.find((m) => m.id === id)?.label ?? id;
}
