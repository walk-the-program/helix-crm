/**
 * The merge screen: which record survives, and which value wins per field.
 *
 *   [ keep ] Sarah Mitchell        [ keep ] Sara Mitchell
 *            first_name  "Sarah"   <-- the owner picks one side per row
 *
 * Everything the loser owned moves either way: activities, tasks, deals, tags,
 * custom values, attachments, phones and emails (src/db/repos/merge.ts). Only
 * the fields on the record itself are a choice.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@/ui";
import {
  loadMergeFields,
  picksFor,
  type DuplicatePair,
  type MergeField,
} from "@/features/data/lib/duplicates";

type Side = "a" | "b";

function valueText(value: string): string {
  if (value.trim().length === 0) return "—";
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

export function MergeDialog(props: {
  pair: DuplicatePair | null;
  onOpenChange: (open: boolean) => void;
  onMerge: (input: {
    pair: DuplicatePair;
    survivorId: string;
    loserId: string;
    picks: Record<string, string | null>;
  }) => Promise<void>;
}) {
  const { pair, onOpenChange, onMerge } = props;
  const [survivor, setSurvivor] = useState<Side>("a");
  const [choice, setChoice] = useState<Record<string, Side>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSurvivor("a");
    setChoice({});
  }, [pair?.key]);

  const fields = useQuery({
    queryKey: ["data", "mergeFields", pair?.key ?? "none"],
    queryFn: async (): Promise<MergeField[]> =>
      pair ? loadMergeFields(pair.entityType, pair.a.id, pair.b.id) : [],
    enabled: pair !== null,
  });

  if (!pair) return null;

  const survivorSide = survivor === "a" ? pair.a : pair.b;
  const loserSide = survivor === "a" ? pair.b : pair.a;

  async function confirm() {
    if (!pair) return;
    setBusy(true);
    try {
      await onMerge({
        pair,
        survivorId: survivorSide.id,
        loserId: loserSide.id,
        picks: picksFor(fields.data ?? [], choice, survivor),
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={pair !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Merge these two {pair.entityType === "contact" ? "people" : "companies"}?</DialogTitle>
          <DialogDescription>
            They share the same {pair.matchedOn}: <strong>{pair.value}</strong>. Keeping{" "}
            <strong>{survivorSide.label}</strong>; {loserSide.label} goes to the trash
            and everything on it moves across.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <div className="grid grid-cols-2 gap-[var(--space-3)]">
            {(["a", "b"] as Side[]).map((side) => {
              const record = side === "a" ? pair.a : pair.b;
              const active = survivor === side;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => setSurvivor(side)}
                  aria-pressed={active}
                  className={[
                    "flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] border p-[var(--space-3)] text-left",
                    "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
                    active
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface)]",
                  ].join(" ")}
                >
                  <span className="text-[length:var(--text-xs)] uppercase tracking-wide text-[var(--color-text-muted)]">
                    {active ? "Keeping this one" : "Keep this one instead"}
                  </span>
                  <span className="text-[length:var(--text-base)] font-semibold text-[var(--color-text)]">
                    {record.label}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {record.detail}
                  </span>
                </button>
              );
            })}
          </div>

          {fields.isLoading ? (
            <div className="flex items-center gap-[var(--space-2)] py-[var(--space-4)]">
              <Spinner size={16} /> <span>Reading both records…</span>
            </div>
          ) : (
            <div className="flex flex-col gap-[var(--space-2)]">
              {(fields.data ?? [])
                .filter((field) => field.differs)
                .map((field) => {
                  const chosen = choice[field.column] ?? survivor;
                  return (
                    <fieldset
                      key={field.column}
                      className="grid grid-cols-[140px_1fr_1fr] items-center gap-[var(--space-2)] border-0 p-0 m-0"
                    >
                      <legend className="sr-only">{field.label}</legend>
                      <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                        {field.label}
                      </span>
                      {(["a", "b"] as Side[]).map((side) => (
                        <label
                          key={side}
                          className={[
                            "flex cursor-pointer items-center gap-[var(--space-2)] rounded-[var(--radius-sm)]",
                            "border px-[var(--space-2)] py-[var(--space-1)]",
                            chosen === side
                              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                              : "border-[var(--color-border)]",
                          ].join(" ")}
                        >
                          <input
                            type="radio"
                            name={`merge-${field.column}`}
                            checked={chosen === side}
                            onChange={() =>
                              setChoice((c) => ({ ...c, [field.column]: side }))
                            }
                            className="accent-[var(--color-accent)]"
                            aria-label={`${field.label}: keep "${
                              side === "a" ? field.aValue : field.bValue
                            }"`}
                          />
                          <span className="truncate text-[length:var(--text-sm)] text-[var(--color-text)]">
                            {valueText(side === "a" ? field.aValue : field.bValue)}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              {(fields.data ?? []).every((f) => !f.differs) ? (
                <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  Every field is the same on both records, so there is nothing to
                  choose.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void confirm()}
            iconLeft={<ArrowLeftRight size={16} aria-hidden="true" />}
          >
            Merge into {survivorSide.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
