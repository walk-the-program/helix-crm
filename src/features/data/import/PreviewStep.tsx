/**
 * Step 3: twenty rows as Helix will file them, plus the duplicate policy.
 *
 * The preview is the last place anything is reversible for free, so it shows
 * the mapped values rather than the raw cells, and every warning the mapping
 * raised. The policy is a grouped inset list under a small-capitals label,
 * which is how a native settings pane asks a question like this.
 */
import { Badge, Card, CardGroupLabel, CardRow, Table, TBody, TD, TH, THead, TR } from "@/ui";
import { formatPhone } from "@/lib/phone";
import {
  DEDUPE_POLICIES,
  type DedupePolicy,
} from "@/features/data/lib/importRun";
import type { MappedRow } from "@/features/data/lib/mapping";

function nameOf(row: MappedRow): string {
  const name = `${row.firstName} ${row.lastName}`.trim();
  if (name.length > 0) return name;
  if (row.company.length > 0) return `(${row.company})`;
  return row.emails[0]?.email ?? "(no name)";
}

export function PreviewStep(props: {
  rows: MappedRow[];
  totalRows: number;
  policy: DedupePolicy;
  onPolicyChange: (policy: DedupePolicy) => void;
}) {
  const { rows, totalRows, policy, onPolicyChange } = props;
  const problems = rows.filter((r) => r.flags.length > 0).length;
  const unimportable = rows.filter((r) => !r.importable).length;

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <p className="text-[length:var(--text-base)] text-[var(--color-text)]">
          The first {rows.length} of{" "}
          <span className="font-medium tabular-nums">{totalRows.toLocaleString()}</span>{" "}
          rows, as they will be filed.
        </p>
        {problems > 0 ? (
          <Badge tone="warning">{problems} to look at</Badge>
        ) : (
          <Badge tone="success">Nothing looks wrong</Badge>
        )}
        {unimportable > 0 ? (
          <Badge tone="danger">{unimportable} cannot be filed</Badge>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {/* table-fixed, with a share of the width per column. Seven columns of
            auto layout gave the name almost nothing and let two phone numbers
            wrap a row to double height; a fixed layout keeps every row one line
            tall and puts the full value in a title attribute instead. */}
        <Table className="table-fixed">
          <THead>
            <TR>
              <TH align="right" className="w-[6%]">
                Row
              </TH>
              <TH className="w-[16%]">Name</TH>
              <TH className="w-[16%]">Company</TH>
              <TH className="w-[22%]">Email</TH>
              <TH className="w-[15%]">Phone</TH>
              <TH className="w-[8%]">Tags</TH>
              <TH className="w-[17%]">What Helix noticed</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => {
              const name = nameOf(row);
              const emails = row.emails.map((e) => e.email).join(", ");
              const phones = row.phones
                .map((p) => (p.e164 ? formatPhone(p.e164) : p.raw))
                .join(", ");
              const tags = row.tags.join(", ");
              return (
              <TR key={row.rowNumber}>
                <TD align="right" muted>
                  {row.rowNumber}
                </TD>
                <TD
                  title={name}
                  className={[
                    "truncate font-medium",
                    row.importable ? "" : "text-[var(--color-text-faint)] line-through",
                  ].join(" ")}
                >
                  {name}
                </TD>
                <TD muted title={row.company || undefined} className="truncate">
                  {row.company || "—"}
                </TD>
                <TD muted title={emails || undefined} className="truncate">
                  {emails || "—"}
                </TD>
                <TD muted title={phones || undefined} className="truncate">
                  {phones || "—"}
                </TD>
                <TD muted title={tags || undefined} className="truncate">
                  {tags || "—"}
                </TD>
                <TD muted>
                  {row.flags.length === 0 ? (
                    "—"
                  ) : (
                    <ul className="flex flex-col gap-[var(--space-1)]">
                      {row.flags.map((flag, i) => (
                        <li
                          key={i}
                          className={
                            flag.level === "error"
                              ? "text-[var(--color-danger-ink)]"
                              : "text-[var(--color-warning-ink)]"
                          }
                        >
                          {flag.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </TD>
              </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">When someone is already in Helix</legend>
        <CardGroupLabel aria-hidden="true">When someone is already in Helix</CardGroupLabel>
        <Card>
          {DEDUPE_POLICIES.map((option) => (
            <CardRow key={option.value} interactive>
              <label className="flex w-full cursor-pointer items-start gap-[var(--space-3)]">
                <input
                  type="radio"
                  name="dedupe-policy"
                  value={option.value}
                  checked={policy === option.value}
                  onChange={() => onPolicyChange(option.value)}
                  className="mt-[var(--space-1)] flex-none accent-[var(--color-accent)]"
                />
                <span className="flex flex-col gap-[var(--space-1)]">
                  <span className="font-medium text-[var(--color-text)]">{option.label}</span>
                  <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {option.hint}
                  </span>
                </span>
              </label>
            </CardRow>
          ))}
        </Card>
        <p className="px-[var(--space-1)] pt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          Matched on their email address first, then on their phone number.
        </p>
      </fieldset>
    </div>
  );
}
