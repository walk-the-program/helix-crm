/**
 * The merges history: every merge for 30 days, and the reason a reversal is
 * refused when it is (docs/PLAN.md item 15).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tooltip,
  toast,
} from "@/ui";
import { formatDateTimeDisplay } from "@/lib/dates";
import { dqk } from "@/features/data/lib/queries";
import {
  MERGE_REVERSAL_DAYS,
  list as listMerges,
  reversalRefusal,
  reverse as reverseMerge,
  type MergeRecord,
} from "@/db/repos/merge";

type Row = MergeRecord & { refusal: string | null };

async function loadHistory(): Promise<Row[]> {
  const records = await listMerges(100);
  return Promise.all(
    records.map(async (record) => ({
      ...record,
      refusal: await reversalRefusal(record.id),
    })),
  );
}

export function MergesHistory() {
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: dqk.mergeHistory(), queryFn: loadHistory });

  async function undo(row: Row) {
    try {
      await reverseMerge(row.id);
      toast.success("Merge reversed. Both records are back.");
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That merge could not be reversed.");
    }
  }

  if (history.isLoading) {
    return <p className="text-[var(--color-text-muted)]">Reading the history…</p>;
  }

  const rows = history.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No merges yet"
        description="When you merge two records, the pair is listed here and can be put back for 30 days."
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        A merge can be reversed for {MERGE_REVERSAL_DAYS} days, as long as the
        surviving record has not been merged again since.
      </p>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Type</TH>
              <TH>Kept</TH>
              <TH>Merged in</TH>
              <TH>Status</TH>
              <TH align="right">Reverse</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>{formatDateTimeDisplay(row.at)}</TD>
                <TD>{row.entityType === "contact" ? "Person" : "Company"}</TD>
                <TD>
                  <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)]">
                    {row.survivorId.slice(0, 8)}
                  </code>
                </TD>
                <TD>
                  <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)]">
                    {row.loserId.slice(0, 8)}
                  </code>
                </TD>
                <TD>
                  {row.reversedAt ? (
                    <Badge tone="neutral">Reversed</Badge>
                  ) : row.refusal ? (
                    <Badge tone="warning">Locked</Badge>
                  ) : (
                    <Badge tone="success">Reversible</Badge>
                  )}
                </TD>
                <TD align="right">
                  {row.refusal ? (
                    <Tooltip content={row.refusal}>
                      <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                        {row.reversedAt ? "Already undone" : "Cannot undo"}
                      </span>
                    </Tooltip>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void undo(row)}
                      iconLeft={<Undo2 size={14} aria-hidden="true" />}
                    >
                      Reverse
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
