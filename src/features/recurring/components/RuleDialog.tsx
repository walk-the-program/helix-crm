/**
 * "Remind me every..." - the whole of adding a recurring reminder.
 *
 * Four things and no more: what it is called, how often, and the first date.
 * The sentence under the fields says back what will happen in the owner's own
 * words, because "every 3 months from 12 April" is easier to check in a
 * sentence than in three boxes.
 *
 * The presets exist because the three intervals a trade business actually uses
 * are a year, a season and a fortnight, and picking one is faster than typing
 * a number and opening a menu.
 */
import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  toast,
} from "@/ui";
import { formatDateDisplay, todayLocal } from "@/lib/dates";
import {
  RECURRING_UNITS,
  advanceDate,
  describeInterval,
  type RecurringRule,
  type RecurringUnit,
} from "@/db/repos/recurring";
import { useCreateRule, useUpdateRule } from "@/features/recurring/lib/hooks";

const UNIT_OPTIONS = RECURRING_UNITS.map((unit) => ({
  value: unit,
  label: unit === "week" ? "weeks" : unit === "month" ? "months" : "years",
}));

const PRESETS: { label: string; everyN: number; unit: RecurringUnit }[] = [
  { label: "Every year", everyN: 1, unit: "year" },
  { label: "Every 6 months", everyN: 6, unit: "month" },
  { label: "Every 3 months", everyN: 3, unit: "month" },
  { label: "Every 2 weeks", everyN: 2, unit: "week" },
];

export type RuleTarget = { contactId?: string | null; companyId?: string | null };

export function RuleDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which record the reminder belongs to. Both null is a standalone reminder. */
  target: RuleTarget;
  /** Set to edit an existing rule instead of adding one. */
  rule?: RecurringRule | null;
  /** What the record is called, for the dialog's own sentence. */
  aboutLabel?: string | null;
}) {
  const { open, onOpenChange, target, rule, aboutLabel } = props;
  const editing = Boolean(rule);

  const [title, setTitle] = useState("");
  const [everyN, setEveryN] = useState("1");
  const [unit, setUnit] = useState<RecurringUnit>("year");
  const [startOn, setStartOn] = useState(todayLocal());
  const [error, setError] = useState<string | null>(null);

  const create = useCreateRule();
  const update = useUpdateRule();
  const saving = create.isPending || update.isPending;

  // Reset every time the dialog opens, so a cancelled draft never comes back.
  useEffect(() => {
    if (!open) return;
    setTitle(rule?.title ?? "");
    setEveryN(String(rule?.everyN ?? 1));
    setUnit(rule?.unit ?? "year");
    setStartOn(rule?.nextDueOn ?? advanceDate(todayLocal(), 1, "year"));
    setError(null);
  }, [open, rule]);

  const parsedEvery = Number.parseInt(everyN, 10);
  const everyValid = Number.isFinite(parsedEvery) && parsedEvery >= 1 && parsedEvery <= 120;
  const sentence =
    everyValid && startOn
      ? `${describeInterval(parsedEvery, unit)}, starting ${
          formatDateDisplay(startOn) || startOn
        }.`
      : null;

  async function save() {
    const name = title.trim();
    if (name.length === 0) {
      setError("Give the reminder a name, like Spring cleanup.");
      return;
    }
    if (!everyValid) {
      setError("How often? Use a whole number of weeks, months or years.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) {
      setError("Pick the first date this is due.");
      return;
    }
    setError(null);

    try {
      if (rule) {
        await update.mutateAsync({
          id: rule.id,
          patch: { title: name, everyN: parsedEvery, unit, nextDueOn: startOn },
        });
        toast.success(`Saved "${name}"`);
      } else {
        await create.mutateAsync({
          title: name,
          everyN: parsedEvery,
          unit,
          nextDueOn: startOn,
          contactId: target.contactId ?? null,
          companyId: target.companyId ?? null,
        });
        toast.success(`Added "${name}"`);
      }
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : "That reminder did not save.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="rule-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit this reminder" : "Remind me every..."}</DialogTitle>
          <DialogDescription>
            {aboutLabel
              ? `Work that comes back around for ${aboutLabel}. Helix puts it on Today a week before it is due.`
              : "Work that comes back around. Helix puts it on Today a week before it is due."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field
            label="What is it"
            htmlFor="rule-title"
            error={error && title.trim().length === 0 ? error : undefined}
          >
            <Input
              id="rule-title"
              autoFocus
              value={title}
              placeholder="Spring cleanup"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            {PRESETS.map((preset) => {
              const chosen = preset.everyN === parsedEvery && preset.unit === unit;
              return (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={chosen}
                  className={
                    chosen ? "bg-[var(--color-selected)] text-[var(--color-text)]" : undefined
                  }
                  onClick={() => {
                    setEveryN(String(preset.everyN));
                    setUnit(preset.unit);
                  }}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="Every" htmlFor="rule-every">
              <Input
                id="rule-every"
                className="tabular"
                type="number"
                min={1}
                max={120}
                value={everyN}
                invalid={!everyValid}
                onChange={(event) => setEveryN(event.target.value)}
              />
            </Field>
            <Field label="Weeks, months or years" htmlFor="rule-unit">
              <Select
                id="rule-unit"
                ariaLabel="Weeks, months or years"
                value={unit}
                options={UNIT_OPTIONS}
                onValueChange={(next) => setUnit(next as RecurringUnit)}
              />
            </Field>
            <Field label="First one due" htmlFor="rule-start">
              <DatePicker
                id="rule-start"
                className="tabular"
                value={startOn || null}
                onChange={(next) => setStartOn(next ?? "")}
                clearable
              />
            </Field>
          </div>

          {sentence ? (
            <p className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
              {sentence}
            </p>
          ) : null}

          {error && title.trim().length > 0 ? (
            <p role="alert" className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            loadingLabel="Saving"
            onClick={() => void save()}
          >
            {editing ? "Save changes" : "Add reminder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
