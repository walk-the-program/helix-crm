/**
 * Screen 2: the trade's preset, with everything editable before it is written.
 *
 * Nothing here is a wizard question. It is the finished setup, shown, so the
 * owner can look at it and change the two things that do not match how he
 * works. Rename a stage, drop a source, add a field — and then one button
 * writes the lot in one transaction.
 *
 * One primary block: "Use this setup". The chosen word for the work is a quiet
 * tile, not a second block.
 */
import { Button, Card, CardRow, IconButton, Input, PageHeader, Select } from "@/ui";
import { Plus, Trash } from "@/ui/icons";
import { ChoiceTile, SetupSection } from "@/features/onboarding/components/frame";
import {
  planKey,
  planProblems,
  type PlanField,
  type PlanSource,
  type PlanStage,
  type SetupPlan,
} from "@/features/onboarding/lib/applyPreset";
import type { TradePreset, VocabularyKey } from "@/features/onboarding/presets/types";

const WORDS: { key: VocabularyKey; label: string }[] = [
  { key: "jobs", label: "Jobs" },
  { key: "quotes", label: "Quotes" },
  { key: "deals", label: "Deals" },
];

const OUTCOME_OPTIONS = [
  { value: "open", label: "In progress" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const KIND_OPTIONS = [
  { value: "text", label: "Words" },
  { value: "number", label: "A number" },
  { value: "date", label: "A date" },
  { value: "choice", label: "A short list" },
];

const ON_OPTIONS = [
  { value: "deal", label: "The work" },
  { value: "contact", label: "The person" },
  { value: "company", label: "The business" },
];

function outcomeOf(stage: PlanStage): string {
  if (stage.isWon) return "won";
  if (stage.isLost) return "lost";
  return "open";
}

export function TrackingScreen({
  preset,
  plan,
  onChange,
  onApply,
  onBack,
  busy,
  error,
}: {
  preset: TradePreset;
  plan: SetupPlan;
  onChange: (next: SetupPlan) => void;
  onApply: () => void;
  onBack: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const problems = planProblems(plan);
  const blocking = error ?? problems[0]?.message ?? null;

  const setStages = (stages: PlanStage[]) => onChange({ ...plan, stages });
  const setSources = (sources: PlanSource[]) => onChange({ ...plan, sources });
  const setFields = (fields: PlanField[]) => onChange({ ...plan, fields });

  const patchStage = (key: string, patch: Partial<PlanStage>) =>
    setStages(plan.stages.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const setOutcome = (key: string, outcome: string) =>
    setStages(
      plan.stages.map((stage) => {
        if (stage.key === key) {
          return { ...stage, isWon: outcome === "won", isLost: outcome === "lost" };
        }
        // Won and lost are one each, so choosing a new one releases the old.
        if (outcome === "won" && stage.isWon) return { ...stage, isWon: false };
        if (outcome === "lost" && stage.isLost) return { ...stage, isLost: false };
        return stage;
      }),
    );

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="How you'll track work"
        subtitle={`This is how ${preset.label.toLowerCase()} usually runs. Change anything that is not how you do it.`}
      />

      <SetupSection label="What you call the work" hint={preset.vocabularyWhy}>
        <div role="group" aria-label="What you call the work" className="grid grid-cols-3 gap-[var(--space-2)]">
          {WORDS.map((word) => (
            <ChoiceTile
              key={word.key}
              label={word.label}
              selected={plan.vocabulary === word.key}
              onSelect={() => onChange({ ...plan, vocabulary: word.key })}
            />
          ))}
        </div>
      </SetupSection>

      <SetupSection
        label="Your stages"
        hint="Quiet days is how long something can sit here before Today brings it up again."
      >
        <Card>
          <CardRow className="gap-[var(--space-2)] py-[var(--space-1)]">
            <span className="section-label min-w-0 flex-1">Stage</span>
            <span className="section-label w-[150px] flex-none">What it means</span>
            <span className="section-label w-[76px] flex-none text-right">Quiet days</span>
            <span className="w-[var(--control-h-sm)] flex-none" aria-hidden />
          </CardRow>
          {plan.stages.map((stage) => (
            <CardRow key={stage.key} className="gap-[var(--space-2)]">
              <Input
                aria-label="Stage name"
                value={stage.name}
                onChange={(e) => patchStage(stage.key, { name: e.target.value })}
                className="min-w-0 flex-1"
              />
              <div className="w-[150px] flex-none">
                <Select
                  ariaLabel={`What ${stage.name || "this stage"} means`}
                  value={outcomeOf(stage)}
                  onValueChange={(value) => setOutcome(stage.key, value)}
                  options={OUTCOME_OPTIONS}
                />
              </div>
              <Input
                aria-label={`Quiet days for ${stage.name || "this stage"}`}
                type="number"
                min={0}
                max={365}
                value={String(stage.quietDays)}
                onChange={(e) =>
                  patchStage(stage.key, { quietDays: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-[76px] flex-none text-right"
              />
              <IconButton
                label={`Remove ${stage.name || "this stage"}`}
                title="Remove"
                size="sm"
                icon={<Trash size={16} weight="bold" aria-hidden />}
                onClick={() => setStages(plan.stages.filter((s) => s.key !== stage.key))}
              />
            </CardRow>
          ))}
        </Card>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          iconLeft={<Plus size={16} weight="bold" aria-hidden />}
          onClick={() =>
            setStages([
              ...plan.stages,
              { key: planKey("stage"), name: "", quietDays: 7, isWon: false, isLost: false },
            ])
          }
        >
          Add a stage
        </Button>
      </SetupSection>

      <SetupSection label="Where the work comes from">
        <Card>
          {plan.sources.map((source) => (
            <CardRow key={source.key} className="gap-[var(--space-2)]">
              <Input
                aria-label="Where the work comes from"
                value={source.name}
                onChange={(e) =>
                  setSources(
                    plan.sources.map((s) =>
                      s.key === source.key ? { ...s, name: e.target.value } : s,
                    ),
                  )
                }
                className="min-w-0 flex-1"
              />
              <IconButton
                label={`Remove ${source.name || "this source"}`}
                title="Remove"
                size="sm"
                icon={<Trash size={16} weight="bold" aria-hidden />}
                onClick={() => setSources(plan.sources.filter((s) => s.key !== source.key))}
              />
            </CardRow>
          ))}
        </Card>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          iconLeft={<Plus size={16} weight="bold" aria-hidden />}
          onClick={() =>
            setSources([...plan.sources, { key: planKey("source"), name: "", kind: "manual" }])
          }
        >
          Add a source
        </Button>
      </SetupSection>

      <SetupSection
        label="What else you write down"
        hint="The two or three details you always need and no CRM has a box for."
      >
        <Card>
          {plan.fields.map((field) => (
            <CardRow key={field.key} className="gap-[var(--space-2)]">
              <Input
                aria-label="What you write down"
                value={field.name}
                onChange={(e) =>
                  setFields(
                    plan.fields.map((f) =>
                      f.key === field.key ? { ...f, name: e.target.value } : f,
                    ),
                  )
                }
                className="min-w-0 flex-1"
              />
              <div className="w-[150px] flex-none">
                <Select
                  ariaLabel={`Where ${field.name || "this"} lives`}
                  value={field.entityType}
                  onValueChange={(value) =>
                    setFields(
                      plan.fields.map((f) =>
                        f.key === field.key
                          ? { ...f, entityType: value as PlanField["entityType"] }
                          : f,
                      ),
                    )
                  }
                  options={ON_OPTIONS}
                />
              </div>
              <div className="w-[130px] flex-none">
                <Select
                  ariaLabel={`What ${field.name || "this"} holds`}
                  value={field.kind}
                  onValueChange={(value) =>
                    setFields(
                      plan.fields.map((f) =>
                        f.key === field.key ? { ...f, kind: value as PlanField["kind"] } : f,
                      ),
                    )
                  }
                  options={KIND_OPTIONS}
                />
              </div>
              <IconButton
                label={`Remove ${field.name || "this detail"}`}
                title="Remove"
                size="sm"
                icon={<Trash size={16} weight="bold" aria-hidden />}
                onClick={() => setFields(plan.fields.filter((f) => f.key !== field.key))}
              />
            </CardRow>
          ))}
        </Card>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          iconLeft={<Plus size={16} weight="bold" aria-hidden />}
          onClick={() =>
            setFields([
              ...plan.fields,
              { key: planKey("field"), name: "", kind: "text", entityType: "deal" },
            ])
          }
        >
          Add a detail
        </Button>
      </SetupSection>

      {blocking ? (
        <p role="alert" className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">
          {blocking}
        </p>
      ) : null}

      <div className="flex items-center gap-[var(--space-3)]">
        <Button
          variant="primary"
          onClick={onApply}
          loading={busy}
          loadingLabel="Setting up…"
          disabled={problems.length > 0}
        >
          Use this setup
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  );
}
