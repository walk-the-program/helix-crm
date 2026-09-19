/**
 * Possible duplicates, and the merges history beside them.
 *
 * The scan runs on boot and every 24 hours (see scanner.ts); this screen shows
 * what it found and re-runs it on demand. Merging is one dialog away, and the
 * 10-second Undo toast is the first line of defence - the history tab is the
 * second, for 30 days.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, Users } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@/ui";
import { formatDateDisplay } from "@/lib/dates";
import { dqk } from "@/features/data/lib/queries";
import {
  markScanned,
  scanDuplicates,
  type DuplicatePair,
} from "@/features/data/lib/duplicates";
import { merge as mergeRecords, reverse as reverseMerge } from "@/db/repos/merge";
import { MergeDialog } from "@/features/data/duplicates/MergeDialog";
import { MergesHistory } from "@/features/data/duplicates/MergesHistory";

const UNDO_MS = 10_000;

function matchLabel(pair: DuplicatePair): string {
  if (pair.matchedOn === "email") return "Same email";
  if (pair.matchedOn === "phone") return "Same phone number";
  return "Same name";
}

function PairCard(props: {
  pair: DuplicatePair;
  dismissed: boolean;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  const { pair, dismissed, onMerge, onDismiss } = props;
  const href = (id: string) =>
    pair.entityType === "contact" ? `/contacts/${id}` : `/companies/${id}`;

  return (
    <Card className={dismissed ? "opacity-60" : undefined}>
      <CardBody className="flex flex-wrap items-center justify-between gap-[var(--space-4)]">
        <div className="flex min-w-0 flex-col gap-[var(--space-2)]">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Badge tone="warning">{matchLabel(pair)}</Badge>
            <span className="rounded-[var(--radius-sm)] bg-[var(--color-warning-soft)] px-[var(--space-2)] py-[var(--space-1)] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text)]">
              {pair.value}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-[var(--space-4)]">
            {[pair.a, pair.b].map((side) => (
              <div key={side.id} className="flex flex-col">
                <Link
                  href={href(side.id)}
                  className="text-[length:var(--text-base)] font-medium text-[var(--color-accent)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2"
                >
                  {side.label}
                </Link>
                <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {side.detail} · added {formatDateDisplay(side.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-[var(--space-2)]">
          <Button variant="ghost" onClick={onDismiss}>
            {dismissed ? "Show again" : "Not a duplicate"}
          </Button>
          <Button variant="primary" onClick={onMerge} disabled={dismissed}>
            Review and merge
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function DuplicatesScreen() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<DuplicatePair | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

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

  const found = (pairs.data ?? []).filter((p) => !dismissed.has(p.key));
  const hidden = (pairs.data ?? []).filter((p) => dismissed.has(p.key));

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="Duplicates"
        subtitle="People and companies that look like the same record twice."
        actions={
          <Button
            variant="secondary"
            onClick={() => void pairs.refetch()}
            loading={pairs.isFetching}
            iconLeft={<RefreshCw size={16} aria-hidden="true" />}
          >
            Scan again
          </Button>
        }
      />

      <Tabs defaultValue="pairs">
        <TabsList>
          <TabsTrigger value="pairs">
            Possible duplicates{found.length > 0 ? ` (${found.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="history">Merges</TabsTrigger>
        </TabsList>

        <TabsContent value="pairs">
          {pairs.isLoading ? (
            <p className="text-[var(--color-text-muted)]">Looking for duplicates…</p>
          ) : found.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={32} aria-hidden="true" />}
              title={
                hidden.length > 0
                  ? "Nothing left to look at"
                  : "No duplicates to sort out"
              }
              description="Helix checks on every launch and once a day, matching on email address and phone number. Anything it finds shows up here."
              action={
                <Link href="/contacts">
                  <Button iconLeft={<Users size={16} aria-hidden="true" />}>
                    Back to contacts
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-[var(--space-3)]">
              {found.map((pair) => (
                <PairCard
                  key={pair.key}
                  pair={pair}
                  dismissed={false}
                  onMerge={() => setActive(pair)}
                  onDismiss={() =>
                    setDismissed((set) => new Set(set).add(pair.key))
                  }
                />
              ))}
            </div>
          )}

          {hidden.length > 0 ? (
            <details className="mt-[var(--space-5)]">
              <summary className="cursor-pointer text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                {hidden.length} pair{hidden.length === 1 ? "" : "s"} you said were
                not duplicates
              </summary>
              <div className="mt-[var(--space-3)] flex flex-col gap-[var(--space-3)]">
                {hidden.map((pair) => (
                  <PairCard
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
              </div>
            </details>
          ) : null}
        </TabsContent>

        <TabsContent value="history">
          <MergesHistory />
        </TabsContent>
      </Tabs>

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
