/**
 * Every quote and invoice in the workspace: what is outstanding, what has
 * been paid, and what is still a quote.
 *
 * The non-obvious decision: DESIGN.md allows one primary block per screen, and
 * this screen wants two — the header's "New invoice" action and the money
 * outstanding, which is the number the owner actually came here to check. The
 * money wins, because it is the thing that needs him; a button that opens a
 * blank form does not. "New invoice" is therefore a secondary button, and the
 * outstanding total is the one flat accent block, drawn exactly the way
 * DealPage.tsx draws a deal's value.
 *
 * Four tabs share one search box and one sort: overdue sent invoices first
 * (the word "overdue" carries no colour — DESIGN.md §5 — so the row's ink and
 * its place at the top of the list do the work), then everything else by
 * issue date, newest first. Each tab is its own `useDocuments` call rather
 * than one call filtered in memory, because the four sets overlap in ways a
 * single query result cannot cheaply answer (unpaid is two statuses, paid is
 * one, quotes are a different kind, and all is everything).
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Plus } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
  Table,
} from "@/ui";
import type { Document } from "@/db/repos/documents";
import { useFormats } from "@/app/formats";
import { useVocabulary } from "@/app/vocabulary";
import { HelpLink } from "@/features/help";
import { useDocuments, useOutstandingSummary } from "@/features/invoices/lib/hooks";
import {
  customerLabel,
  dueLabel,
  hasAnyDocuments as computeHasAnyDocuments,
  isOverdue,
  statusLabel,
  statusTone,
  summarySentence,
  unpaidEmptyCopy,
} from "@/features/invoices/lib/format";

type TabId = "unpaid" | "paid" | "quotes" | "all";

const EMPTY_SUMMARY = {
  sentCount: 0,
  outstandingCents: 0,
  overdueCount: 0,
  worstOverdueDays: 0,
  draftCount: 0,
};

export function InvoicesScreen() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabId>("unpaid");
  const [search, setSearch] = useState("");

  const formats = useFormats();
  const vocabulary = useVocabulary();
  const { data: summary } = useOutstandingSummary();

  const searchFilter = search.trim().length > 0 ? search.trim() : undefined;

  const unpaid = useDocuments({ kind: "invoice", unpaidOnly: true, search: searchFilter });
  const paid = useDocuments({ kind: "invoice", status: "paid", search: searchFilter });
  const quotes = useDocuments({ kind: "quote", search: searchFilter });
  const all = useDocuments({ search: searchFilter });

  const byTab: Record<TabId, ReturnType<typeof useDocuments>> = { unpaid, paid, quotes, all };
  const active = byTab[tab];
  const rows = useMemo(() => sortDocuments(active.data?.rows ?? []), [active.data]);
  const filtered = Boolean(searchFilter);

  // Every kind and every status counts here - a draft, a quote and a voided
  // invoice all mean "this workspace has raised a document before" just as
  // much as a paid one does. `all` already reads that unfiltered count for
  // the All tab, so this reuses it rather than adding a second query. While
  // it is still loading, assume documents exist (the pre-fix behaviour) so
  // the page does not flash the first-invoice state on a workspace that
  // actually has plenty of them.
  const totalDocuments = all.data?.total;
  const hasAnyDocuments = computeHasAnyDocuments(totalDocuments);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Invoices"
        actions={
          <Button
            // With no invoice ever raised there is nothing for the money
            // block below to show, so this is the screen's one flat primary
            // block instead (F-LB-11a) - never both at once.
            variant={hasAnyDocuments ? "secondary" : "primary"}
            iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
            onClick={() => navigate("/invoices/new")}
          >
            New invoice
          </Button>
        }
      />

      {hasAnyDocuments ? (
        <div className="flex flex-wrap items-center gap-[var(--space-3)] pb-[var(--space-5)]">
          {/* The one primary block on this screen (see the file comment): the
              money outstanding, flat-filled, with the accent sticker shadow as
              its single detail — the same treatment DealPage.tsx gives the
              deal value. */}
          <span className="money inline-flex items-center bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-accent-text)]">
            {formats.money((summary ?? EMPTY_SUMMARY).outstandingCents)}
          </span>
          <span className="text-[length:var(--text-base)] text-[var(--color-text)]">
            {summarySentence(summary ?? EMPTY_SUMMARY, formats.currency, formats.locale)}
          </span>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <TabsList>
          <TabsTrigger value="unpaid">{tabLabel("Unpaid", unpaid.data?.total)}</TabsTrigger>
          <TabsTrigger value="paid">{tabLabel("Paid", paid.data?.total)}</TabsTrigger>
          <TabsTrigger value="quotes">{tabLabel("Quotes", quotes.data?.total)}</TabsTrigger>
          <TabsTrigger value="all">{tabLabel("All", all.data?.total)}</TabsTrigger>
        </TabsList>

        <div className="max-w-[360px] py-[var(--space-4)]">
          <label htmlFor="invoice-search" className="sr-only">
            Search invoices
          </label>
          <Input
            id="invoice-search"
            search
            value={search}
            placeholder="Number, customer or company"
            aria-label="Search invoices"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <TabsContent value="unpaid">
          <DocumentTable
            rows={rows}
            // Waits on the unfiltered document count too, so this tab never
            // shows "nothing outstanding" (true only once invoices exist)
            // before it has actually confirmed whether any do.
            isLoading={unpaid.isLoading || totalDocuments === undefined}
            summable
            filtered={filtered}
            onClearSearch={() => setSearch("")}
            empty={
              <EmptyState
                {...unpaidEmptyCopy(hasAnyDocuments, vocabulary.lower)}
                action={
                  hasAnyDocuments ? undefined : (
                    <Button variant="secondary" onClick={() => navigate("/invoices/new")}>
                      New invoice
                    </Button>
                  )
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="paid">
          <DocumentTable
            rows={rows}
            isLoading={paid.isLoading}
            summable
            filtered={filtered}
            onClearSearch={() => setSearch("")}
            empty={
              <EmptyState
                title="No paid invoices yet"
                description={
                  <>
                    Invoices show up here once you mark them paid.{" "}
                    <HelpLink to="quotes-invoices">How quotes and invoices work</HelpLink>
                  </>
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="quotes">
          <DocumentTable
            rows={rows}
            isLoading={quotes.isLoading}
            summable
            filtered={filtered}
            onClearSearch={() => setSearch("")}
            empty={
              <EmptyState
                title="No quotes yet"
                description={
                  <>
                    Raise one from a {vocabulary.lower}, or start a blank one here.{" "}
                    <HelpLink to="quotes-invoices">How quotes and invoices work</HelpLink>
                  </>
                }
                action={
                  <Button variant="secondary" onClick={() => navigate("/invoices/new")}>
                    New quote
                  </Button>
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="all">
          <DocumentTable
            rows={rows}
            isLoading={all.isLoading}
            summable={false}
            filtered={filtered}
            onClearSearch={() => setSearch("")}
            empty={
              <EmptyState
                title="No invoices yet"
                description={
                  <>
                    Create your first invoice, or raise one from a {vocabulary.lower}.{" "}
                    <HelpLink to="quotes-invoices">How quotes and invoices work</HelpLink>
                  </>
                }
                action={
                  <Button variant="secondary" onClick={() => navigate("/invoices/new")}>
                    New invoice
                  </Button>
                }
              />
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** "Unpaid" / "Unpaid (12)" — a tab keeps a plain label until its count loads. */
function tabLabel(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${count})`;
}

/**
 * Overdue sent invoices first — the row's ink and its place at the top carry
 * the weight, because "overdue" itself has no colour (DESIGN.md §5) — then
 * everything else by issue date, newest first. A draft has no issue date yet,
 * so it sorts by when it was created, same as the repository's own default.
 */
function sortDocuments(rows: Document[]): Document[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const aOverdue = isOverdue(a);
    const bOverdue = isOverdue(b);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const aDate = a.issuedOn ?? a.createdAt;
    const bDate = b.issuedOn ?? b.createdAt;
    return bDate.localeCompare(aDate);
  });
  return copy;
}

function DocumentTable(props: {
  rows: Document[];
  isLoading: boolean;
  filtered: boolean;
  onClearSearch: () => void;
  empty: ReactNode;
  /**
   * Whether the footer may add the amounts up.
   *
   * On Unpaid, Paid and Quotes every row means the same thing, so a total is
   * a real number. On All it would add a quote nobody has accepted to an
   * invoice that was paid last month to a draft that has never been sent, and
   * the figure would be of nothing at all. That tab counts and does not sum.
   */
  summable: boolean;
}) {
  const { rows, isLoading, filtered, onClearSearch, empty, summable } = props;
  const formats = useFormats();

  if (isLoading) {
    return (
      <p role="status" className="py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        Reading the database.
      </p>
    );
  }

  if (rows.length === 0) {
    if (filtered) {
      return (
        <EmptyState
          title="Nothing matches that search"
          description="Clear the search to see this list again."
          action={
            <Button variant="secondary" onClick={onClearSearch}>
              Clear search
            </Button>
          }
        />
      );
    }
    return <>{empty}</>;
  }

  const totalCents = rows.reduce((sum, row) => sum + row.totalCents, 0);

  return (
    <Table>
      <THead>
        <TR>
          {/* "INV-2026-0002" was truncating to "INV-2026…" at the 1024px
              floor, hiding the one thing the owner scans for first on this
              table (rule 1). Status gives up the width it does not need -
              a badge word ("Sent", "Paid") never needed 12% - and Number
              takes it. */}
          <TH className="w-[22%] min-w-[132px]">Number</TH>
          <TH className="w-[26%]">Customer</TH>
          <TH className="w-[9%]">Status</TH>
          <TH className="w-[11%]">Issued</TH>
          <TH className="w-[16%]">Due</TH>
          <TH className="w-[16%]" align="right">Amount</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const overdue = isOverdue(row);
          return (
            <TR key={row.id}>
              <TD primary>
                <Link
                  href={`/invoices/${row.id}`}
                  className="block truncate text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                >
                  {row.number}
                </Link>
              </TD>
              <TD muted>
                <span className="block truncate" title={customerLabel(row)}>
                  {customerLabel(row)}
                </span>
              </TD>
              <TD>
                <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
              </TD>
              <TD className="tabular whitespace-nowrap">{formats.date(row.issuedOn)}</TD>
              <TD className="tabular whitespace-nowrap">
                {overdue ? (
                  <span className="font-medium text-[var(--color-text)]">{dueLabel(row.dueOn)}</span>
                ) : (
                  formats.date(row.dueOn)
                )}
              </TD>
              <TD align="right" className="money">
                {formats.money(row.totalCents)}
              </TD>
            </TR>
          );
        })}
      </TBody>
      <TFoot>
        <TR>
          <TD colSpan={5}>
            <span className="tabular text-[var(--color-text-muted)]">
              {rows.length === 1 ? "1 document" : `${rows.length} documents`}
            </span>
          </TD>
          <TD align="right" className="money">
            {summable ? formats.money(totalCents) : null}
          </TD>
        </TR>
      </TFoot>
    </Table>
  );
}
