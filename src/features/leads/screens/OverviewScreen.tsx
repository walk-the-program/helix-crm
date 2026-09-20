/**
 * Overview (/reports).
 *
 * The landing page of Reports: the headline number from each of the other
 * four report tabs, every group linking to the tab it came from. Walker's
 * bug was a Reports button that stranded him on Revenue with no way back;
 * ReportsFrame fixed the chrome, and this page is the other half - a summary
 * that never dead-ends, because every figure here is a door to the report
 * that explains it.
 *
 * Nothing is computed here that a tab does not also show (see the doc
 * comment on `OverviewBundle` in src/db/repos/reports.ts): this is a table
 * of contents with numbers on it, not a sixth report. So there is no chart
 * library pulled in beyond the plain stage bars below, no CSV button, and no
 * period-scoped detail a tab would own instead.
 *
 * Like every report, this one spends zero primary buttons (docs/DESIGN.md
 * "one primary block per view") - the links to each tab are quiet text
 * links, not buttons, because a report is something the owner reads.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from "@/ui";
import { useFormats } from "@/app/formats";
import { periodFor } from "@/lib/periods";
import type { Period } from "@/lib/periods";
import { useOverview } from "@/features/leads/lib/reportKeys";
import type { OverviewBundle } from "@/db/repos/reports";
import { ReportsFrame } from "@/features/leads/components/ReportsFrame";

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function formatDays(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} days`;
}

function formatMoneyOrDash(cents: number | null, money: (cents: number) => string): string {
  return cents === null ? "—" : money(cents);
}

function formatShare(withDeal: number, total: number): string {
  return total === 0 ? "—" : `${((withDeal / total) * 100).toFixed(1)}%`;
}

/* -------------------------------------------------------------------------- */
/* figures                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The headline figure of a group: the heading face at the heading size, a
 * caption under it. Copies RevenueScreen's `HeadlineFigure` pattern (value on
 * top in the heading font, label below) rather than importing it, since that
 * screen is owned by another lead in this round and the helper is not
 * exported.
 */
function Figure(props: { label: string; value: string; sizeClass: string }) {
  const { label, value, sizeClass } = props;
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span
        className={[
          "tabular",
          "font-[family-name:var(--font-heading)] font-bold leading-[var(--leading-heading)]",
          sizeClass,
          "text-[var(--color-heading)]",
        ].join(" ")}
      >
        {value}
      </span>
      <span className="text-[length:var(--text-caption)] text-[var(--color-text-muted)]">
        {label}
      </span>
    </div>
  );
}

/**
 * A smaller stat for a row of secondary numbers: copies ReportsScreen's
 * `StatTile` pattern (caption above, the figure below) at a smaller size than
 * `Figure`, so a group's headline still reads first.
 */
function MiniFigure(props: { label: string; value: string }) {
  const { label, value } = props;
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <span className="text-[length:var(--text-caption)] text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="tabular text-[length:var(--text-lg)] font-semibold text-[var(--color-heading)]">
        {value}
      </span>
    </div>
  );
}

/** The quiet text link every group ends on - never a button. */
function TabLink(props: { href: string; children: ReactNode }) {
  return (
    <Link
      href={props.href}
      className="shrink-0 text-[length:var(--text-caption)] text-[var(--color-link)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
    >
      {props.children}
    </Link>
  );
}

function GroupCard(props: { title: string; href: string; linkLabel?: string; children: ReactNode }) {
  const { title, href, linkLabel = "See the detail", children } = props;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <TabLink href={href}>{linkLabel}</TabLink>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-4)]">{children}</CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* the open pipeline's stage bars                                              */
/* -------------------------------------------------------------------------- */

function StageBar(props: { name: string; count: number; valueCents: number; color: string; share: number }) {
  const { name, count, valueCents, color, share } = props;
  const formats = useFormats();
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <div className="flex items-baseline justify-between gap-[var(--space-3)]">
        <span className="text-[length:var(--text-sm)] text-[var(--color-text)]">{name}</span>
        <span className="tabular shrink-0 text-[length:var(--text-caption)] text-[var(--color-text-muted)]">
          {count} · {formats.money(valueCents)}
        </span>
      </div>
      <div className="h-[var(--space-2)] w-full bg-[var(--color-hover)]">
        <div className="h-full" style={{ width: `${share}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function OpenPipelineGroup(props: { openByStage: OverviewBundle["openByStage"] }) {
  const { openByStage } = props;
  const formats = useFormats();
  const totalCount = openByStage.reduce((sum, row) => sum + row.openDeals, 0);
  const totalValueCents = openByStage.reduce((sum, row) => sum + row.openValueCents, 0);

  return (
    <GroupCard title="Open pipeline" href="/reports/deals">
      <div className="flex flex-wrap gap-[var(--space-8)]">
        <Figure label="Open deals" value={String(totalCount)} sizeClass="text-[length:var(--text-2xl)]" />
        <Figure
          label="Open value"
          value={formats.money(totalValueCents)}
          sizeClass="text-[length:var(--text-2xl)]"
        />
      </div>
      {openByStage.length === 0 ? null : (
        <div className="flex flex-col gap-[var(--space-3)]">
          {openByStage.map((row) => (
            <StageBar
              key={row.stageId}
              name={row.stageName}
              count={row.openDeals}
              valueCents={row.openValueCents}
              color={row.stageColor}
              share={totalValueCents === 0 ? 0 : (row.openValueCents / totalValueCents) * 100}
            />
          ))}
        </div>
      )}
    </GroupCard>
  );
}

/* -------------------------------------------------------------------------- */
/* the page                                                                    */
/* -------------------------------------------------------------------------- */

function isNothingYet(data: OverviewBundle): boolean {
  const noDeals =
    data.deals.newCount === 0 &&
    data.deals.wonCount === 0 &&
    data.deals.lostCount === 0 &&
    data.openByStage.every((row) => row.openDeals === 0);
  const noPeople = data.people.contacts === 0 && data.people.companies === 0;
  const noMoney =
    data.money.quotedCents === 0 &&
    data.money.wonCents === 0 &&
    data.money.invoicedCents === 0 &&
    data.money.collectedCents === 0 &&
    data.mrrCents === 0 &&
    data.arrCents === 0;
  return noDeals && noPeople && noMoney;
}

function OverviewContent(props: { data: OverviewBundle }) {
  const { data } = props;
  const formats = useFormats();

  if (isNothingYet(data)) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Add a contact, send a quote, or win a deal, and the business starts showing up here."
      />
    );
  }

  const { deals, people, money } = data;

  return (
    <div className="grid grid-cols-1 gap-[var(--space-6)] lg:grid-cols-2">
      <GroupCard title="Revenue" href="/reports/revenue">
        <div className="flex flex-wrap items-end gap-[var(--space-8)]">
          <Figure label="Monthly recurring revenue" value={formats.money(data.mrrCents)} sizeClass="text-[length:var(--text-2xl)]" />
          <Figure label="A year of that" value={formats.money(data.arrCents)} sizeClass="text-[length:var(--text-xl)]" />
        </div>
        <div className="flex flex-wrap gap-[var(--space-6)]">
          <MiniFigure label="Quoted" value={formats.money(money.quotedCents)} />
          <MiniFigure label="Won" value={formats.money(money.wonCents)} />
          <MiniFigure label="Invoiced" value={formats.money(money.invoicedCents)} />
          <MiniFigure label="Collected" value={formats.money(money.collectedCents)} />
          <MiniFigure label="Outstanding" value={formats.money(money.outstandingCents)} />
        </div>
      </GroupCard>

      <GroupCard title="Deals" href="/reports/deals">
        <div className="flex flex-wrap gap-[var(--space-6)]">
          <MiniFigure label="New deals" value={String(deals.newCount)} />
          <MiniFigure label="Won rate" value={formatPercent(deals.wonRate)} />
          <MiniFigure label="Average won value" value={formatMoneyOrDash(deals.averageWonCents, formats.money)} />
          <MiniFigure label="Median days to win" value={formatDays(deals.medianDaysToWin)} />
        </div>
      </GroupCard>

      <GroupCard title="Contacts and companies" href="/reports/people">
        <div className="flex flex-wrap gap-[var(--space-6)]">
          <MiniFigure label="Contacts" value={String(people.contacts)} />
          <MiniFigure label="Companies" value={String(people.companies)} />
          <MiniFigure label="New this period" value={String(people.newContacts + people.newCompanies)} />
          <MiniFigure
            label="Contacts with a deal"
            value={formatShare(people.contactsWithDeal, people.contacts)}
          />
          <MiniFigure
            label="Companies with a deal"
            value={formatShare(people.companiesWithDeal, people.companies)}
          />
        </div>
      </GroupCard>

      <OpenPipelineGroup openByStage={data.openByStage} />
    </div>
  );
}

export function OverviewScreen() {
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const query = useOverview(period);

  return (
    <ReportsFrame
      active="overview"
      title="Reports"
      subtitle="The headline from each report. Open one for the detail."
      period={{ value: period, onChange: setPeriod }}
    >
      {query.isPending ? (
        <div className="flex justify-center py-[var(--space-10)]">
          <Spinner label="Loading reports" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="Reports could not load"
          description={
            query.error instanceof Error
              ? query.error.message
              : "The database gave no reason. Try picking the period again."
          }
        />
      ) : query.data ? (
        <OverviewContent data={query.data} />
      ) : null}
    </ReportsFrame>
  );
}

export default OverviewScreen;
