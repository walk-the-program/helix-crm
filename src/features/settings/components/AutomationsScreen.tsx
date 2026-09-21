/**
 * "/settings/automations" — the owner's own words for three follow-up rules
 * (LR-PX-C, PART 2).
 *
 * "Switch Helix's follow-up rules on and word them himself": each rule is a
 * grouped inset list in the house pattern (TagsScreen.tsx,
 * VocabularyScreen.tsx) - a kit `Switch`, a delay in the rule's own fixed
 * unit, and a title with the tokens it accepts spelled out underneath in the
 * workspace's own words for a job. There is no Save button: every field
 * saves itself the moment it changes, the same as every neighbouring settings
 * screen, and a rule that is off still shows its fields (greyed, never
 * hidden) so the owner can see what turning it on would do before he does.
 *
 * `automations.update(kind, patch)` always stores `delayMinutes`; two of the
 * three rules show it to the owner in days, because nobody thinks about a
 * quote follow-up in minutes. The conversion is exact and one-directional per
 * edit: days x 1440 going in, delayMinutes / 1440 rounded going out, so
 * "3" always round-trips to "3" even though the stored number is 4320.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Field, Input, Switch, toast } from "@/ui";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsRow,
} from "@/features/settings/components/SettingsLayout";
import { SettingsScreenFrame } from "@/features/settings/components/SettingsLayout";
import { useVocabulary } from "@/app/vocabulary";
import type { Vocabulary } from "@/app/vocabulary";
import * as automationsRepo from "@/db/repos/automations";
import {
  AUTOMATION_KINDS,
  renderTemplate,
  type Automation,
  type AutomationKind,
} from "@/db/repos/automations";
import { HelpLink } from "@/features/help";

const AUTOMATIONS_KEY = ["automations"] as const;

const MINUTES_PER_DAY = 1440;

type DelayUnit = "minutes" | "days";

type RuleMeta = {
  name: string;
  /** One plain sentence: what switching this on does. */
  description: string;
  unit: DelayUnit;
  /** The words around the number: "Remind me {n} <unit> after <clause>." */
  clause: string;
  /** Tokens this rule's template actually receives, for the helper text and the example. */
  tokens: { name: boolean; number: string | null; job: boolean };
  sample: { name: string; number: string | null; job: string | null };
};

/**
 * One entry per `AutomationKind`, in the words the owner reads. `job` and
 * `number` are only offered where the runner in automations.ts actually fills
 * them in (see `runLeadArrived`, `runQuoteSent`, `runInvoiceOverdue`) - a
 * token the product never fills renders as nothing, and listing it anyway
 * would be a promise the task text cannot keep.
 */
function ruleMeta(vocabulary: Vocabulary): Record<AutomationKind, RuleMeta> {
  return {
    lead_arrived: {
      name: "New lead follow-up",
      description: `Add a task to follow up soon after a new lead turns into a ${vocabulary.lower}.`,
      unit: "minutes",
      clause: "after a lead arrives",
      tokens: { name: true, number: null, job: true },
      sample: { name: "Jamie Rivera", number: null, job: `Sample ${vocabulary.lower}` },
    },
    quote_sent: {
      name: "Quote follow-up",
      description: "Add a task to check in after a quote is sent.",
      unit: "days",
      clause: "after a quote is sent",
      tokens: { name: true, number: "the quote number", job: true },
      sample: { name: "Jamie Rivera", number: "Q-1042", job: `Sample ${vocabulary.lower}` },
    },
    invoice_overdue: {
      name: "Overdue invoice follow-up",
      description: "Add a task when an invoice goes past its due date.",
      unit: "days",
      clause: "after an invoice is overdue",
      tokens: { name: true, number: "the invoice number", job: false },
      sample: { name: "Jamie Rivera", number: "INV-1042", job: null },
    },
  };
}

/** delayMinutes -> the number the owner types, in the rule's own unit. */
function toDisplayValue(delayMinutes: number, unit: DelayUnit): number {
  return unit === "minutes" ? delayMinutes : Math.round(delayMinutes / MINUTES_PER_DAY);
}

/** The number the owner typed, in the rule's own unit -> delayMinutes. */
function toDelayMinutes(displayValue: number, unit: DelayUnit): number {
  return unit === "minutes" ? displayValue : displayValue * MINUTES_PER_DAY;
}

function tokensHint(meta: RuleMeta, vocabulary: Vocabulary): string {
  const parts = ["{name} is the customer's name."];
  if (meta.tokens.number) parts.push(`{number} is ${meta.tokens.number}.`);
  if (meta.tokens.job) parts.push(`{job} is the ${vocabulary.lower}.`);
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* one rule                                                                   */
/* -------------------------------------------------------------------------- */

function RuleGroup(props: {
  automation: Automation;
  meta: RuleMeta;
  vocabulary: Vocabulary;
  onPatch: (kind: AutomationKind, patch: automationsRepo.AutomationPatch) => void;
}) {
  const { automation, meta, vocabulary, onPatch } = props;

  const [delayInput, setDelayInput] = useState(() =>
    String(toDisplayValue(automation.delayMinutes, meta.unit)),
  );
  const [titleInput, setTitleInput] = useState(automation.titleTemplate);
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    setDelayInput(String(toDisplayValue(automation.delayMinutes, meta.unit)));
  }, [automation.delayMinutes, meta.unit]);

  useEffect(() => {
    setTitleInput(automation.titleTemplate);
  }, [automation.titleTemplate]);

  function commitDelay() {
    const parsed = Number(delayInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDelayInput(String(toDisplayValue(automation.delayMinutes, meta.unit)));
      return;
    }
    const nextMinutes = toDelayMinutes(Math.trunc(parsed), meta.unit);
    if (nextMinutes === automation.delayMinutes) return;
    onPatch(automation.kind, { delayMinutes: nextMinutes });
  }

  function commitTitle() {
    const trimmed = titleInput.trim();
    if (trimmed.length === 0) {
      setTitleError("Give this task a title, in plain words.");
      return;
    }
    setTitleError(null);
    if (trimmed === automation.titleTemplate) return;
    onPatch(automation.kind, { titleTemplate: trimmed });
  }

  const example = renderTemplate(automation.titleTemplate, meta.sample).trim();

  return (
    <SettingsGroup label={meta.name} data-testid={`automation-${automation.kind}`}>
      <SettingsRow
        label={meta.name}
        hint={meta.description}
        htmlFor={`automation-${automation.kind}-enabled`}
      >
        {/* The kit Switch (src/ui/Switch.tsx) does not forward a bare
            data-testid - it destructures a fixed prop set rather than
            spreading the rest onto RadixSwitch.Root - so this is found by
            its aria-label, which it does carry, both here and from a test. */}
        <Switch
          id={`automation-${automation.kind}-enabled`}
          checked={automation.enabled}
          onCheckedChange={(checked) => onPatch(automation.kind, { enabled: checked })}
          aria-label={`Turn ${meta.name.toLowerCase()} on or off`}
        />
      </SettingsRow>

      <div
        className={
          automation.enabled
            ? "flex flex-col gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)]"
            : "flex flex-col gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] opacity-50"
        }
      >
        <div className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--text-base)] text-[var(--color-text)]">
          <span>Remind me</span>
          <Input
            type="number"
            min={0}
            className="w-20"
            aria-label={`Delay, in ${meta.unit}, for ${meta.name.toLowerCase()}`}
            data-testid={`automation-${automation.kind}-delay`}
            value={delayInput}
            onChange={(event) => setDelayInput(event.target.value)}
            onBlur={commitDelay}
          />
          <span>
            {meta.unit} {meta.clause}
          </span>
        </div>

        <Field
          label="Task title"
          htmlFor={`automation-${automation.kind}-title`}
          error={titleError ?? undefined}
          hint={titleError ? undefined : tokensHint(meta, vocabulary)}
        >
          <Input
            id={`automation-${automation.kind}-title`}
            data-testid={`automation-${automation.kind}-title`}
            value={titleInput}
            onChange={(event) => {
              setTitleInput(event.target.value);
              if (titleError) setTitleError(null);
            }}
            onBlur={commitTitle}
          />
        </Field>

        <p
          className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
          data-testid={`automation-${automation.kind}-example`}
        >
          Reads like: {example.length > 0 ? example : "—"}
        </p>
      </div>
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* screen                                                                     */
/* -------------------------------------------------------------------------- */

export function AutomationsScreen() {
  const queryClient = useQueryClient();
  const vocabulary = useVocabulary();
  const query = useQuery({
    queryKey: AUTOMATIONS_KEY,
    queryFn: () => automationsRepo.list(),
  });

  const mutation = useMutation({
    mutationFn: (vars: { kind: AutomationKind; patch: automationsRepo.AutomationPatch }) =>
      automationsRepo.update(vars.kind, vars.patch),
    onSuccess: async (_result, vars) => {
      await queryClient.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
      const meta = ruleMeta(vocabulary)[vars.kind];
      if (vars.patch.enabled !== undefined) {
        toast.success(
          vars.patch.enabled ? `Turned on ${meta.name.toLowerCase()}` : `Turned off ${meta.name.toLowerCase()}`,
        );
      } else {
        toast.success(`Saved ${meta.name.toLowerCase()}`);
      }
    },
    onError: (_err, vars) => {
      const meta = ruleMeta(vocabulary)[vars.kind];
      toast.error(`${meta.name} did not save. Try again.`);
    },
  });

  function handlePatch(kind: AutomationKind, patch: automationsRepo.AutomationPatch) {
    mutation.mutate({ kind, patch });
  }

  const meta = ruleMeta(vocabulary);

  return (
    <SettingsScreenFrame
      title="Automations"
      testId="settings-automations"
      // Two of these three are on out of the box, so this screen is where an
      // owner arrives asking "what wrote that task, and how do I stop it".
      // The first half is answered on the customer's own timeline; the rest
      // is said here, once, under the title (LR-CS-RECHECK, F-CS-R-5).
      subtitle={
        <>
          Helix&rsquo;s own follow-up rules, switched on and worded your way. A rule
          only ever creates an ordinary task, and the customer&rsquo;s history says
          which rule made it and why. Importing a spreadsheet sets none of them
          off. <HelpLink to="follow-ups">More about follow-ups</HelpLink>
        </>
      }
    >
      {query.isLoading ? (
        <SettingsLoading>Reading your automations…</SettingsLoading>
      ) : (
        AUTOMATION_KINDS.map((kind) => {
          const automation = query.data?.find((a) => a.kind === kind);
          if (!automation) return null;
          return (
            <RuleGroup
              key={kind}
              automation={automation}
              meta={meta[kind]}
              vocabulary={vocabulary}
              onPatch={handlePatch}
            />
          );
        })
      )}
    </SettingsScreenFrame>
  );
}

export default AutomationsScreen;
