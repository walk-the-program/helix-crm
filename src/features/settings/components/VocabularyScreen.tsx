/**
 * "/settings/vocabulary" — relabel deals as jobs or quotes.
 *
 * A grouped list of three choices and a grouped list showing what they read
 * like, which is the System Settings answer to "what will this do": show the
 * result rather than describe it.
 *
 * Labels only: the database always says `deals` and `stages` (see
 * src/app/vocabulary.ts). Saving is immediate, no Save button, and the preview
 * reflects the radio's own selection so it updates before the settings query
 * round-trips.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as settingsRepo from "@/db/repos/settings";
import { qk } from "@/app/queryClient";
import { vocabularyFor, type VocabularyKey } from "@/app/vocabulary";
import {
  SettingsChoiceRow,
  SettingsGroup,
  SettingsScreenFrame,
  SettingsValueRow,
} from "@/features/settings/components/SettingsLayout";
import { toast } from "@/ui";

const OPTIONS: { value: VocabularyKey; label: string; description: string }[] = [
  { value: "deals", label: "Deals", description: "The default." },
  { value: "jobs", label: "Jobs", description: "For work you schedule and complete." },
  { value: "quotes", label: "Quotes", description: "For work you price before it starts." },
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
      <SettingsGroup
        label="Call them"
        footnote="This changes labels only. Nothing in your data moves."
      >
        <div role="radiogroup" aria-label="Vocabulary">
          {OPTIONS.map((option) => (
            <SettingsChoiceRow
              key={option.value}
              name="vocabulary"
              value={option.value}
              checked={selected === option.value}
              label={option.label}
              description={option.description}
              onSelect={() => choose(option.value)}
              testId={`vocabulary-option-${option.value}`}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        label="Reads like"
        data-testid="vocabulary-preview"
        footnote={`Every ${preview.lower} keeps its own timeline.`}
      >
        <SettingsValueRow label="In the sidebar">{preview.many}</SettingsValueRow>
        <SettingsValueRow label="On the pipeline board">{preview.newOne}</SettingsValueRow>
      </SettingsGroup>
    </SettingsScreenFrame>
  );
}
