/**
 * Screen 1: who you are and what you do.
 *
 * Four boxes and a grid. The name is prefilled, the trade decides everything on
 * screen 2, and the email and phone are here because a draft email that has to
 * ask who is sending it is worse than no draft at all.
 *
 * One primary block: "Continue". The selected trade tile is the quiet
 * `--color-selected` tint, not the primary — the sidebar and the one button are
 * the only places the primary is spent (docs/DESIGN.md §5).
 */
import { useMemo } from "react";
import { Button, Field, Input, PageHeader } from "@/ui";
import { isValidEmail } from "@/lib/email";
import { ChoiceTile, SetupSection } from "@/features/onboarding/components/frame";
import { TRADE_OPTIONS } from "@/features/onboarding/presets";
import type { TradeId } from "@/features/onboarding/presets/types";

export type BusinessDraft = {
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  trade: TradeId | null;
  tradeOther: string;
};

export function businessDraftProblems(draft: BusinessDraft): {
  businessName?: string;
  ownerEmail?: string;
  trade?: string;
} {
  const problems: { businessName?: string; ownerEmail?: string; trade?: string } = {};
  if (draft.businessName.trim().length === 0) {
    problems.businessName = "Helix puts this on everything you send, so it needs a name.";
  }
  if (draft.ownerEmail.trim().length > 0 && !isValidEmail(draft.ownerEmail)) {
    problems.ownerEmail = "That does not look like an email address.";
  }
  if (draft.trade === null) {
    problems.trade = "Pick the one closest to what you do.";
  }
  return problems;
}

export function BusinessScreen({
  draft,
  onChange,
  onContinue,
  busy,
  showProblems,
}: {
  draft: BusinessDraft;
  onChange: (next: BusinessDraft) => void;
  onContinue: () => void;
  busy?: boolean;
  showProblems: boolean;
}) {
  const problems = useMemo(() => businessDraftProblems(draft), [draft]);
  const visible = showProblems ? problems : {};

  const set = <K extends keyof BusinessDraft>(key: K, value: BusinessDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <form
      className="flex flex-col gap-[var(--space-6)]"
      onSubmit={(event) => {
        event.preventDefault();
        onContinue();
      }}
    >
      <PageHeader
        title="Your business"
        subtitle="Four things about you, then Helix sets the rest up the way your trade works."
      />

      <div className="grid grid-cols-2 gap-[var(--space-4)]">
        <div className="col-span-2">
          <Field label="What is the business called?" error={visible.businessName}>
            <Input
              value={draft.businessName}
              onChange={(e) => set("businessName", e.target.value)}
              placeholder="Alpine Ridge Landscape"
              autoComplete="off"
              autoFocus
            />
          </Field>
        </div>
        <Field label="Your name">
          <Input
            value={draft.ownerName}
            onChange={(e) => set("ownerName", e.target.value)}
            placeholder="Dave Tracy"
            autoComplete="off"
          />
        </Field>
        <Field
          label="Your email"
          error={visible.ownerEmail}
          hint="Used on the emails you send from Helix. It stays on this machine."
        >
          <Input
            type="email"
            value={draft.ownerEmail}
            onChange={(e) => set("ownerEmail", e.target.value)}
            placeholder="dave@alpineridge.com"
            autoComplete="off"
          />
        </Field>
        <Field label="Your phone" hint="Used on the texts you send from Helix.">
          <Input
            type="tel"
            value={draft.ownerPhone}
            onChange={(e) => set("ownerPhone", e.target.value)}
            placeholder="(801) 555-0134"
            autoComplete="off"
          />
        </Field>
      </div>

      <SetupSection
        label="What kind of work"
        hint={
          visible.trade ? undefined : "This decides the words and the stages on the next screen."
        }
      >
        {visible.trade ? (
          <p
            role="alert"
            className="text-[length:var(--text-xs)] text-[var(--color-danger-ink)]"
          >
            {visible.trade}
          </p>
        ) : null}
        <div role="group" aria-label="What kind of work" className="grid grid-cols-3 gap-[var(--space-2)]">
          {TRADE_OPTIONS.map((option) => (
            <ChoiceTile
              key={option.id}
              label={option.label}
              hint={option.hint}
              selected={draft.trade === option.id}
              onSelect={() => set("trade", option.id)}
            />
          ))}
        </div>
        {draft.trade === "other" ? (
          <div className="pt-[var(--space-2)]">
            <Field label="What do you call it?">
              <Input
                value={draft.tradeOther}
                onChange={(e) => set("tradeOther", e.target.value)}
                placeholder="Mobile welding"
                autoComplete="off"
              />
            </Field>
          </div>
        ) : null}
      </SetupSection>

      <div className="flex items-center gap-[var(--space-3)]">
        <Button type="submit" variant="primary" loading={busy} loadingLabel="Saving…">
          Continue
        </Button>
      </div>
    </form>
  );
}
