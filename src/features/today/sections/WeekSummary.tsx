/**
 * One line under the Today title: "This week: 3 new leads, 2 jobs won
 * ($4,300.00), 5 calls logged."
 *
 * It is a sentence, not a row of statistic tiles. Three coloured cards with big
 * numbers in them is a dashboard, and this owner does not want a dashboard - he
 * wants to know, in passing, whether the week has gone anywhere. So it sits in
 * the page header's own space at secondary-text size, and nothing about it is
 * emphasised.
 *
 * A part with nothing in it is left out rather than printed as a zero, and a
 * week with nothing in it at all renders nothing: a brand-new workspace gets
 * the first-run card instead, and "This week: 0 new leads, 0 jobs won" is a
 * sentence that makes a quiet week feel like a failure.
 *
 * The noun for a deal comes from the vocabulary setting, so an owner who calls
 * them quotes reads "2 quotes won".
 */

import { useVocabulary } from "@/app/vocabulary";
import { useFormats } from "@/app/formats";
import { useWeekSummary, type WeekSummary } from "@/features/today/lib/useWeekSummary";

/** The parts of the sentence, in order, with the empty ones dropped. */
export function summaryParts(
  summary: WeekSummary,
  words: { one: string; many: string },
  money: (cents: number) => string,
): string[] {
  const parts: string[] = [];

  if (summary.newLeads > 0) {
    parts.push(summary.newLeads === 1 ? "1 new lead" : `${summary.newLeads} new leads`);
  }
  if (summary.wonCount > 0) {
    const noun = summary.wonCount === 1 ? words.one : words.many;
    parts.push(`${summary.wonCount} ${noun} won (${money(summary.wonValueCents)})`);
  }
  if (summary.callsLogged > 0) {
    const count = summary.callsCapped ? `${summary.callsLogged}+` : `${summary.callsLogged}`;
    parts.push(summary.callsLogged === 1 && !summary.callsCapped ? "1 call logged" : `${count} calls logged`);
  }

  return parts;
}

export function WeekSummaryLine() {
  const { data } = useWeekSummary();
  const vocabulary = useVocabulary();
  const formats = useFormats();

  if (!data || data.isEmpty) return null;

  const parts = summaryParts(
    data,
    { one: vocabulary.lower, many: vocabulary.lowerMany },
    (cents) => formats.money(cents, data.currency),
  );
  if (parts.length === 0) return null;

  return (
    <p
      data-testid="week-summary"
      className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
    >
      This week: {parts.join(", ")}.
    </p>
  );
}
