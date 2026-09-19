/**
 * The merge screen: which record survives, and which value wins per field.
 *
 *   [ keep ] Sarah Mitchell        [ keep ] Sara Mitchell
 *            first_name  "Sarah"   <-- the owner picks one side per row
 *
 * Everything the loser owned moves either way: activities, tasks, deals, tags,
 * custom values, attachments, phones and emails (src/db/repos/merge.ts). Only
 * the fields on the record itself are a choice.
 *
 * Both choices are marked the way a native list marks a selection: the
 * --color-selected tint and full-strength ink, never a coloured border
 * (docs/DESIGN.md §9). The field choices are one grouped inset list under a
 * small-capitals label rather than a grid of outlined boxes.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowsLeftRight } from "@/ui/icons";
import {
  Button,
  Card,
  CardGroupLabel,
  CardRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@/ui";
import type { DuplicatePair } from "@/db/repos/_base";
import {
  loadMergeFields,
  picksFor,
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
  const differing = (fields.data ?? []).filter((field) => field.differs);

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
          <DialogTitle>
            Merge these two {pair.entityType === "contact" ? "people" : "companies"}?
          </DialogTitle>
          <DialogDescription>
            They share the same {pair.matchedOn}: <strong>{pair.value}</strong>. Keeping{" "}
            <strong>{survivorSide.label}</strong>; {loserSide.label} goes to the trash
            and everything on it moves across.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-6)]">
          <div>
            <CardGroupLabel>Which record stays</CardGroupLabel>
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
                      "flex flex-col gap-[var(--space-1)] p-[var(--space-4)] text-left",
                      "rounded-[var(--radius-lg)] border",
                      "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]",
                      active
                        ? "border-[var(--color-border-strong)] bg-[var(--color-selected)]"
                        : "border-[var(--color-border)] hover:bg-[var(--color-hover)]",
                    ].join(" ")}
                  >
                    <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                      {active ? "Keeping this one" : "Keep this one instead"}
                    </span>
                    <span
                      title={record.label}
                      className="truncate text-[length:var(--text-lg)] font-semibold leading-[var(--leading-tight)] text-[var(--color-text)]"
                    >
                      {record.label}
                    </span>
                    <span className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                      {record.detail}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {fields.isLoading ? (
            <div className="flex items-center gap-[var(--space-3)] py-[var(--space-4)]">
              <Spinner size={18} />
              <span className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
                Reading both records…
              </span>
            </div>
          ) : differing.length === 0 ? (
            <p className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
              Every field is the same on both records, so there is nothing to
              choose.
            </p>
          ) : (
            <div>
              <CardGroupLabel>Which value wins</CardGroupLabel>
              <Card>
                {differing.map((field) => {
                  const chosen = choice[field.column] ?? survivor;
                  return (
                    <CardRow key={field.column}>
                      <fieldset className="m-0 grid w-full grid-cols-[9rem_1fr_1fr] items-center gap-[var(--space-3)] border-0 p-0">
                        <legend className="sr-only">{field.label}</legend>
                        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                          {field.label}
                        </span>
                        {(["a", "b"] as Side[]).map((side) => (
                          <label
                            key={side}
                            className={[
                              "flex min-w-0 cursor-pointer items-center gap-[var(--space-2)]",
                              "rounded-[var(--radius-md)] px-[var(--space-2)] py-[var(--space-1)]",
                              "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none",
                              chosen === side
                                ? "bg-[var(--color-selected)] text-[var(--color-text)]"
                                : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]",
                            ].join(" ")}
                          >
                            <input
                              type="radio"
                              name={`merge-${field.column}`}
                              checked={chosen === side}
                              onChange={() =>
                                setChoice((c) => ({ ...c, [field.column]: side }))
                              }
                              className="flex-none accent-[var(--color-accent)]"
                              aria-label={`${field.label}: keep "${
                                side === "a" ? field.aValue : field.bValue
                              }"`}
                            />
                            <span className="truncate text-[length:var(--text-sm)]">
                              {valueText(side === "a" ? field.aValue : field.bValue)}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    </CardRow>
                  );
                })}
              </Card>
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
            loadingLabel="Merging…"
            onClick={() => void confirm()}
            iconLeft={<ArrowsLeftRight size={16} weight="bold" aria-hidden="true" />}
          >
            Merge into {survivorSide.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
