/**
 * "/settings/vocabulary" - relabel deals as jobs or quotes.
 *
 * Labels only: the database always says `deals` and `stages` (see
 * src/app/vocabulary.ts). Saving is immediate, no Save button, and the
 * preview below the radios reflects the radio's own selection so it updates
 * before the settings query round-trips.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as settingsRepo from "@/db/repos/settings";
import { qk } from "@/app/queryClient";
import { vocabularyFor, type VocabularyKey } from "@/app/vocabulary";
import { SettingsScreenFrame } from "@/features/settings/components/SettingsLayout";
import { Button, toast } from "@/ui";

const OPTIONS: { value: VocabularyKey; label: string }[] = [
  { value: "deals", label: "Deals" },
  { value: "jobs", label: "Jobs" },
  { value: "quotes", label: "Quotes" },
];

export function VocabularyScreen() {
  const queryClient = useQueryClient();
  const vocabQuery = useQuery({
    queryKey: qk.setting(settingsRepo.VOCABULARY_KEY),
    queryFn: () => settingsRepo.get("vocabulary"),
  });

  const [selected, setSelected] = useState<VocabularyKey>(vocabQuery.data ?? "deals");
  const priorLabel = useRef<string>(vocabularyFor(vocabQuery.data ?? "deals").lowerMany);

  useEffect(() => {
    if (vocabQuery.data) setSelected(vocabQuery.data);
  }, [vocabQuery.data]);

  const mutation = useMutation({
    mutationFn: (value: VocabularyKey) => settingsRepo.set("vocabulary", value),
    onSuccess: async (_result, value) => {
      await queryClient.invalidateQueries({ queryKey: qk.setting(settingsRepo.VOCABULARY_KEY) });
      await queryClient.invalidateQueries({ queryKey: qk.settings() });
      toast.success(`Renamed ${priorLabel.current} to ${vocabularyFor(value).lowerMany}`);
      priorLabel.current = vocabularyFor(value).lowerMany;
    },
    onError: () => {
      toast.error("Could not save the vocabulary setting.");
    },
  });

  function choose(value: VocabularyKey) {
    if (value === selected) return;
    setSelected(value);
    mutation.mutate(value);
  }

  const preview = vocabularyFor(selected);

  return (
    <SettingsScreenFrame
      title="Vocabulary"
      testId="settings-vocabulary"
      subtitle="Call your deals whatever fits the work."
    >
      <div className="flex max-w-[560px] flex-col gap-[var(--space-6)]">
        <div
          role="radiogroup"
          aria-label="Vocabulary"
          className="flex flex-col gap-[var(--space-2)]"
        >
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={[
                "flex min-h-[var(--control-h)] cursor-pointer items-center gap-[var(--space-3)]",
                "rounded-[var(--radius-md)] border px-[var(--space-4)] py-[var(--space-2)]",
                "bg-[var(--color-surface)]",
                selected === option.value
                  ? "border-[var(--color-border-strong)]"
                  : "border-[var(--color-border)]",
              ].join(" ")}
            >
              <input
                type="radio"
                name="vocabulary"
                value={option.value}
                checked={selected === option.value}
                onChange={() => choose(option.value)}
                data-testid={`vocabulary-option-${option.value}`}
                className={[
                  "h-[var(--space-4)] w-[var(--space-4)] shrink-0",
                  // The accent means "this needs you" (DESIGN.md s5); a chosen radio is not
          // a signal, so the control paints in ink.
          "accent-[var(--color-text)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                ].join(" ")}
              />
              <span className="text-[length:var(--text-base)] text-[var(--color-text)]">
                {option.label}
              </span>
            </label>
          ))}
        </div>

        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          This changes labels only. Nothing in your data moves.
        </p>

        <div
          data-testid="vocabulary-preview"
          className="flex flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]"
        >
          <div>
            <div className="text-[length:var(--text-xs)] font-semibold text-[var(--color-text-muted)]">
              Sidebar
            </div>
            <div className="mt-[var(--space-1)] flex items-center justify-between border-b border-[var(--color-border)] pb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text)]">
              <span>Pipeline</span>
              <span className="text-[var(--color-text-muted)]">{preview.many}</span>
            </div>
          </div>
          <div>
            <div className="text-[length:var(--text-xs)] font-semibold text-[var(--color-text-muted)]">
              Pipeline board
            </div>
            <div className="mt-[var(--space-2)]">
              <Button variant="primary" size="sm" disabled tabIndex={-1} aria-hidden="true">
                {preview.newOne}
              </Button>
            </div>
          </div>
          <p className="text-[length:var(--text-sm)] text-[var(--color-text)]">
            Every {preview.lower} keeps its own timeline.
          </p>
        </div>
      </div>
    </SettingsScreenFrame>
  );
}
