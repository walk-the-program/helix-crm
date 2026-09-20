/**
 * Possible duplicates, and the merges history beside them.
 *
 * The scan runs on boot and every 24 hours (see scanner.ts); this screen shows
 * what it found and re-runs it on demand. Merging is one dialog away, and the
 * 10-second Undo toast is the first line of defence - the history tab is the
 * second, for 30 days.
 *
 * The pairs are one grouped inset list rather than a stack of cards with a
 * primary button on each: a list of twelve primary buttons has no primary at
 * all, and the one primary block belongs to the merge dialog, which
 * is where something actually happens.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise, Users } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  CardGroupLabel,
  CardRow,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@/ui";

import { dqk } from "@/features/data/lib/queries";
import type { DuplicatePair } from "@/db/repos/_base";
import {
  markScanned,
  scanDuplicates,
} from "@/features/data/lib/duplicates";
import { merge as mergeRecords, reverse as reverseMerge } from "@/db/repos/merge";
import { MergeDialog } from "@/features/data/duplicates/MergeDialog";
import { MergesHistory } from "@/features/data/duplicates/MergesHistory";
import { useFormats } from "@/app/formats";
import {
  queryFromState,
  stateFromQuery,
  useSavedViews,
  ViewsToolbar,
  type ViewQuery,
} from "@/features/today/views";

const UNDO_MS = 10_000;
const ALL = "__all__";

/**
 * The pairs list has no filters of its own today, so this adds the minimum
 * needed to give saved views something real to capture: which entity type a
 * pair is (contact or company) and what it matched on. Both are client-side
 * filters over the already-scanned `pairs.data` — no new repository call.
 * There is no sort concept here, so saved views for this screen carry no
 * `sort` entry.
 */
const FILTER_DEFAULTS = {
  entityType: ALL,
  matchedOn: ALL,
};

function matchLabel(pair: DuplicatePair): string {
  if (pair.matchedOn === "email") return "Same email";
  if (pair.matchedOn === "phone") return "Same phone number";
  return "Same name";
}

/** One candidate pair: what matched, the two records, and the two actions. */
function PairRow(props: {
  pair: DuplicatePair;
  dismissed: boolean;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  const formats = useFormats();
  const { pair, dismissed, onMerge, onDismiss } = props;
  const href = (id: string) =>
    pair.entityType === "contact" ? `/contacts/${id}` : `/companies/${id}`;

  return (
    <CardRow className={dismissed ? "flex-wrap opacity-60" : "flex-wrap"}>
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-2)] py-[var(--space-2)]">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Badge tone="neutral">{matchLabel(pair)}</Badge>
          <span className="bg-[var(--color-accent-soft)] px-[var(--space-2)] py-[1px] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
            {pair.value}
          </span>
        </div>
        {/* A grid, not a wrapping flex row: the second record has to start at
            the same x on every row of the list, whatever the first one is
            called. */}
        <div className="grid grid-cols-1 gap-x-[var(--space-6)] gap-y-[var(--space-2)] sm:grid-cols-2">
          {[pair.a, pair.b].map((side) => (
            <div key={side.id} className="flex min-w-0 flex-col">
              <Link
                href={href(side.id)}
                title={side.label}
                className="truncate font-medium text-[var(--color-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
              >
                {side.label}
              </Link>
              <span
                title={side.detail}
                className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
              >
                {side.detail} · added {formats.date(side.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-none items-center gap-[var(--space-2)]">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {dismissed ? "Show again" : "Not a duplicate"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onMerge} disabled={dismissed}>
          Review and merge
        </Button>
      </div>
    </CardRow>
  );
}

export function DuplicatesScreen() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<DuplicatePair | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [entityType, setEntityType] = useState(FILTER_DEFAULTS.entityType);
  const [matchedOn, setMatchedOn] = useState(FILTER_DEFAULTS.matchedOn);

  const currentView: ViewQuery = useMemo(
    () => queryFromState({ entityType, matchedOn }, FILTER_DEFAULTS, null),
    [entityType, matchedOn],
  );

  function applyView(query: ViewQuery | null) {
    const next = stateFromQuery(query, FILTER_DEFAULTS);
    setEntityType(next.entityType);
    setMatchedOn(next.matchedOn);
  }

  // A link from the sidebar's Views group lands here with `?view=<id>` before
  // the row itself has been read, so apply it when it arrives — once per view.
  const { activeId, activeQuery } = useSavedViews("contact", currentView);
  const [appliedViewId, setAppliedViewId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId || !activeQuery || appliedViewId === activeId) return;
    setAppliedViewId(activeId);
    applyView(activeQuery);
  }, [activeId, activeQuery, appliedViewId]);

  const pairs = useQuery({
    queryKey: dqk.duplicatePairs("all"),
    queryFn: async () => {
      const found = await scanDuplicates();
      await markScanned();
      return found;
    },
  });

  async function doMerge(input: {
    pair: DuplicatePair;
    survivorId: string;
    loserId: string;
    picks: Record<string, string | null>;
  }) {
    try {
      const outcome = await mergeRecords(
        input.pair.entityType,
        input.survivorId,
        input.loserId,
        input.picks,
      );
      await queryClient.invalidateQueries();
      toast.undo(
        "Merged. You can still put it back.",
        () => {
          void (async () => {
            try {
              await reverseMerge(outcome.mergeId);
              await queryClient.invalidateQueries();
              toast.success("Merge undone.");
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "That merge could not be undone.",
              );
            }
          })();
        },
        { duration: UNDO_MS },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Those records could not be merged.");
    }
  }

  const matchesFilters = (p: DuplicatePair) =>
    (entityType === ALL || p.entityType === entityType) &&
    (matchedOn === ALL || p.matchedOn === matchedOn);

  const found = (pairs.data ?? []).filter((p) => !dismissed.has(p.key) && matchesFilters(p));
  const hidden = (pairs.data ?? []).filter((p) => dismissed.has(p.key) && matchesFilters(p));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Duplicates"
        subtitle="People and companies that look like the same record twice."
        actions={
          <div className="flex items-center gap-[var(--space-2)]">
            <ViewsToolbar
              entityType="contact"
              current={currentView}
              onPick={(query) => applyView(query)}
            />
            <Button
              variant="secondary"
              onClick={() => void pairs.refetch()}
              loading={pairs.isFetching}
              loadingLabel="Scanning…"
              iconLeft={<ArrowsClockwise size={16} weight="bold" aria-hidden="true" />}
            >
              Scan again
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-[var(--space-6)]">
        <div className="flex flex-wrap items-end gap-[var(--space-4)]">
          <div className="w-[13rem]">
            <Field label="Type" htmlFor="duplicate-entity-type">
              <Select
                id="duplicate-entity-type"
                ariaLabel="Filter by record type"
                value={entityType}
                options={[
                  { value: ALL, label: "Contacts and companies" },
                  { value: "contact", label: "Contacts" },
                  { value: "company", label: "Companies" },
                ]}
                onValueChange={setEntityType}
              />
            </Field>
          </div>

          <div className="w-[13rem]">
            <Field label="Matched on" htmlFor="duplicate-matched-on">
              <Select
                id="duplicate-matched-on"
                ariaLabel="Filter by what matched"
                value={matchedOn}
                options={[
                  { value: ALL, label: "Any match" },
                  { value: "email", label: "Same email" },
                  { value: "phone", label: "Same phone number" },
                  { value: "name", label: "Same name" },
                ]}
                onValueChange={setMatchedOn}
              />
            </Field>
          </div>
        </div>

        <Tabs defaultValue="pairs">
          <TabsList>
            <TabsTrigger value="pairs">
              Possible duplicates{found.length > 0 ? ` (${found.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="history">Merges</TabsTrigger>
          </TabsList>

          <TabsContent value="pairs">
            {pairs.isLoading ? (
              <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                Looking for duplicates…
              </p>
            ) : found.length === 0 ? (
              <EmptyState
                title={
                  hidden.length > 0
                    ? "Nothing left to look at"
                    : "No duplicates to sort out"
                }
                description="Helix checks on every launch and once a day, matching on email address and phone number. Anything it finds shows up here."
                action={
                  <Link href="/contacts">
                    <Button
                      variant="primary"
                      iconLeft={<Users size={16} weight="bold" aria-hidden="true" />}
                    >
                      Back to contacts
                    </Button>
                  </Link>
                }
              />
            ) : (
              <Card>
                {found.map((pair) => (
                  <PairRow
                    key={pair.key}
                    pair={pair}
                    dismissed={false}
                    onMerge={() => setActive(pair)}
                    onDismiss={() =>
                      setDismissed((set) => new Set(set).add(pair.key))
                    }
                  />
                ))}
              </Card>
            )}

            {hidden.length > 0 ? (
              <details className="mt-[var(--space-6)]">
                <summary className="cursor-default text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {hidden.length} pair{hidden.length === 1 ? "" : "s"} you said were
                  not duplicates
                </summary>
                <div className="mt-[var(--space-3)]">
                  <CardGroupLabel>Not duplicates</CardGroupLabel>
                  <Card>
                    {hidden.map((pair) => (
                      <PairRow
                        key={pair.key}
                        pair={pair}
                        dismissed
                        onMerge={() => setActive(pair)}
                        onDismiss={() =>
                          setDismissed((set) => {
                            const next = new Set(set);
                            next.delete(pair.key);
                            return next;
                          })
                        }
                      />
                    ))}
                  </Card>
                </div>
              </details>
            ) : null}
          </TabsContent>

          <TabsContent value="history">
            <MergesHistory />
          </TabsContent>
        </Tabs>
      </div>

      <MergeDialog
        pair={active}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
        onMerge={doMerge}
      />
    </div>
  );
}
