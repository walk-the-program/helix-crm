/**
 * Step 3: twenty rows as Helix will file them, plus the duplicate policy.
 *
 * The preview is the last place anything is reversible for free, so it shows
 * the mapped values rather than the raw cells, and every warning the mapping
 * raised.
 */
import { AlertTriangle, Ban } from "lucide-react";
import { Badge, Card, CardBody, Table, TBody, TD, TH, THead, TR } from "@/ui";
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
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="flex flex-wrap items-baseline gap-[var(--space-3)]">
        <p className="text-[length:var(--text-sm)] text-[var(--color-text)]">
          The first {rows.length} of{" "}
          <span className="tabular-nums font-medium">{totalRows.toLocaleString()}</span>{" "}
          rows, as they will be filed.
        </p>
        {problems > 0 ? (
          <Badge tone="warning">
            <AlertTriangle size={12} aria-hidden="true" /> {problems} to look at
          </Badge>
        ) : (
          <Badge tone="success">Nothing looks wrong</Badge>
        )}
        {unimportable > 0 ? (
          <Badge tone="danger">
            <Ban size={12} aria-hidden="true" /> {unimportable} cannot be filed
          </Badge>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <Table>
          <THead>
            <TR>
              <TH>Row</TH>
              <TH>Name</TH>
              <TH>Company</TH>
              <TH>Email</TH>
              <TH>Phone</TH>
              <TH>Tags</TH>
              <TH>What Helix noticed</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.rowNumber}>
                <TD align="right">
                  <span className="tabular-nums text-[var(--color-text-faint)]">
                    {row.rowNumber}
                  </span>
                </TD>
                <TD>
                  <span
                    className={
                      row.importable
                        ? "text-[var(--color-text)]"
                        : "text-[var(--color-text-faint)] line-through"
                    }
                  >
                    {nameOf(row)}
                  </span>
                </TD>
                <TD>{row.company || "—"}</TD>
                <TD>{row.emails.map((e) => e.email).join(", ") || "—"}</TD>
                <TD>
                  {row.phones.length > 0
                    ? row.phones
                        .map((p) => (p.e164 ? formatPhone(p.e164) : p.raw))
                        .join(", ")
                    : "—"}
                </TD>
                <TD>{row.tags.join(", ") || "—"}</TD>
                <TD>
                  {row.flags.length === 0 ? (
                    <span className="text-[var(--color-text-faint)]">—</span>
                  ) : (
                    <ul className="flex flex-col gap-[var(--space-1)]">
                      {row.flags.map((flag, i) => (
                        <li
                          key={i}
                          className={
                            flag.level === "error"
                              ? "text-[var(--color-danger)]"
                              : "text-[var(--color-warning)]"
                          }
                        >
                          {flag.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-[var(--space-3)]">
          <fieldset className="flex flex-col gap-[var(--space-3)] border-0 p-0 m-0">
            <legend className="text-[length:var(--text-base)] font-semibold text-[var(--color-text)]">
              When someone is already in Helix
            </legend>
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Matched on their email address first, then on their phone number.
            </p>
            {DEDUPE_POLICIES.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--space-3)] hover:bg-[var(--color-surface)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-focus)]"
              >
                <input
                  type="radio"
                  name="dedupe-policy"
                  value={option.value}
                  checked={policy === option.value}
                  onChange={() => onPolicyChange(option.value)}
                  className="mt-[3px] accent-[var(--color-accent)]"
                />
                <span className="flex flex-col gap-[var(--space-1)]">
                  <span className="text-[length:var(--text-sm)] font-medium text-[var(--color-text)]">
                    {option.label}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </CardBody>
      </Card>
    </div>
  );
}
