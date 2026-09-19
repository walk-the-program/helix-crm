/**
 * The reads Today needs that no repository offers yet.
 *
 * CONTRACT NOTE (also recorded in docs/STATUS.md under "Contract changes
 * needed"): every function in this file is a repository function living in the
 * wrong folder. It is here because a feature agent may not edit `src/db/repos`,
 * and Today cannot be built without these three queries. Each one follows the
 * repository conventions exactly — aliased columns, never `SELECT *`, no
 * string interpolation of user input, read-only — so promoting them is a move,
 * not a rewrite:
 *
 *   newLeads()        -> src/db/repos/deals.ts
 *   lastActivityFor() -> src/db/repos/activities.ts
 *   recentWithLinks() -> src/db/repos/activities.ts
 *
 * Everything else Today needs already exists: `tasks.today`, `deals.goneQuiet`,
 * `activities.recent`, `stages.list`, `settings.get`.
 */

import { raw } from "@/db/client";

/**
 * A deal created in the last N days that nobody has worked yet.
 *
 * "No activity yet" means no activity the *owner* created. System entries are
 * excluded deliberately: the website lead poller writes one ("Lead received",
 * carrying the original message) the instant a lead arrives, so counting
 * system rows would empty this section before the owner ever saw it. The point
 * of the section is "nobody has called these people".
 */
export type NewLead = {
  dealId: string;
  title: string;
  valueCents: number;
  currency: string;
  createdAt: string;
  stageId: string;
  stageName: string;
  sourceName: string | null;
  contactId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  companyId: string | null;
  companyName: string | null;
};

export async function newLeads(
  options: { sinceIso: string; limit?: number } = { sinceIso: "" },
): Promise<NewLead[]> {
  const limit = options.limit ?? 25;
  const rows = await raw.query(
    `SELECT d.id            AS d_id,
            d.title         AS d_title,
            d.value_cents   AS d_value_cents,
            d.currency      AS d_currency,
            d.created_at    AS d_created_at,
            d.stage_id      AS d_stage_id,
            s.name          AS s_name,
            src.name        AS src_name,
            d.contact_id    AS d_contact_id,
            c.first_name    AS c_first_name,
            c.last_name     AS c_last_name,
            (SELECT p.raw FROM contact_phones p
              WHERE p.contact_id = c.id
              ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS c_phone,
            (SELECT e.email_lower FROM contact_emails e
              WHERE e.contact_id = c.id
              ORDER BY e.is_primary DESC, e.created_at ASC LIMIT 1) AS c_email,
            d.company_id    AS d_company_id,
            co.name         AS co_name
     FROM deals d
     JOIN stages s ON s.id = d.stage_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN sources src ON src.id = d.source_id
     WHERE d.deleted_at IS NULL
       AND s.is_won = 0 AND s.is_lost = 0
       AND d.created_at >= ?
       AND NOT EXISTS (
             SELECT 1 FROM activities a
             WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.is_system = 0)
     ORDER BY d.created_at DESC
     LIMIT ?`,
    [options.sinceIso, limit],
  );

  return rows.map((r) => ({
    dealId: String(r[0]),
    title: String(r[1]),
    valueCents: Number(r[2] ?? 0),
    currency: String(r[3] ?? "USD"),
    createdAt: String(r[4]),
    stageId: String(r[5]),
    stageName: String(r[6]),
    sourceName: r[7] === null || r[7] === undefined ? null : String(r[7]),
    contactId: r[8] === null || r[8] === undefined ? null : String(r[8]),
    contactFirstName: r[9] === null || r[9] === undefined ? null : String(r[9]),
    contactLastName: r[10] === null || r[10] === undefined ? null : String(r[10]),
    contactPhone: r[11] === null || r[11] === undefined ? null : String(r[11]),
    contactEmail: r[12] === null || r[12] === undefined ? null : String(r[12]),
    companyId: r[13] === null || r[13] === undefined ? null : String(r[13]),
    companyName: r[14] === null || r[14] === undefined ? null : String(r[14]),
  }));
}

/**
 * The newest activity timestamp per deal, for a known set of deal ids.
 *
 * Gone quiet needs "no activity for 21 days" on every row. `deals.goneQuiet()`
 * already decided *which* deals qualify using the same `max()` in SQL; this
 * fetches the number the row has to print, in one query rather than one per
 * row. Returns a map keyed by deal id; a deal with no activity is absent.
 */
export async function lastActivityFor(
  dealIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (dealIds.length === 0) return out;

  // Chunked because SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999 on
  // older builds, and Today can legitimately show a long quiet list.
  const chunkSize = 400;
  for (let i = 0; i < dealIds.length; i += chunkSize) {
    const chunk = dealIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await raw.query(
      `SELECT a.deal_id AS a_deal_id, max(a.occurred_at) AS a_last_at
       FROM activities a
       WHERE a.deleted_at IS NULL AND a.deal_id IN (${placeholders})
       GROUP BY a.deal_id`,
      chunk,
    );
    for (const row of rows) {
      if (row[0] === null || row[1] === null) continue;
      out.set(String(row[0]), String(row[1]));
    }
  }
  return out;
}

/**
 * The last N timeline entries across every record, each already carrying the
 * name of the thing it happened to and where that thing lives.
 *
 * `activities.recent()` returns the rows but only the foreign keys, and Today's
 * "Recent activity" section is useless without a name to click. Resolving the
 * names here in one join beats twenty `contacts.get()` round trips through the
 * IPC pipe.
 */
export type RecentEntry = {
  id: string;
  kind: string;
  body: string;
  occurredAt: string;
  isSystem: boolean;
  /** The record the entry hangs off, closest-first: deal, then contact, then company. */
  linkLabel: string | null;
  linkHref: string | null;
};

export async function recentWithLinks(limit = 20): Promise<RecentEntry[]> {
  const rows = await raw.query(
    `SELECT a.id          AS a_id,
            a.kind        AS a_kind,
            a.body        AS a_body,
            a.occurred_at AS a_occurred_at,
            a.is_system   AS a_is_system,
            a.deal_id     AS a_deal_id,
            d.title       AS d_title,
            a.contact_id  AS a_contact_id,
            c.first_name  AS c_first_name,
            c.last_name   AS c_last_name,
            a.company_id  AS a_company_id,
            co.name       AS co_name
     FROM activities a
     LEFT JOIN deals d ON d.id = a.deal_id AND d.deleted_at IS NULL
     LEFT JOIN contacts c ON c.id = a.contact_id AND c.deleted_at IS NULL
     LEFT JOIN companies co ON co.id = a.company_id AND co.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
     ORDER BY a.occurred_at DESC, a.created_at DESC
     LIMIT ?`,
    [limit],
  );

  return rows.map((r) => {
    const dealId = r[5] === null || r[5] === undefined ? null : String(r[5]);
    const dealTitle = r[6] === null || r[6] === undefined ? null : String(r[6]);
    const contactId = r[7] === null || r[7] === undefined ? null : String(r[7]);
    const first = r[8] === null || r[8] === undefined ? "" : String(r[8]);
    const last = r[9] === null || r[9] === undefined ? "" : String(r[9]);
    const companyId = r[10] === null || r[10] === undefined ? null : String(r[10]);
    const companyName = r[11] === null || r[11] === undefined ? null : String(r[11]);

    let linkLabel: string | null = null;
    let linkHref: string | null = null;
    if (dealId && dealTitle) {
      linkLabel = dealTitle;
      linkHref = `/deals/${dealId}`;
    } else if (contactId && (first || last)) {
      linkLabel = `${first} ${last}`.trim();
      linkHref = `/contacts/${contactId}`;
    } else if (companyId && companyName) {
      linkLabel = companyName;
      linkHref = `/companies/${companyId}`;
    }

    return {
      id: String(r[0]),
      kind: String(r[1]),
      body: String(r[2] ?? ""),
      occurredAt: String(r[3]),
      isSystem: Number(r[4]) === 1,
      linkLabel,
      linkHref,
    };
  });
}

/**
 * Who a task is about, and how to reach them.
 *
 * `tasks.today()` gives the three buckets but only foreign keys, and DESIGN.md
 * is explicit that a Today row without the customer's name and a direct action
 * does not belong on Today. One query for the whole list, keyed by task id.
 * Absent from the map means a standalone task with no record attached, which
 * is legitimate ("Order sod").
 */
export type TaskLink = {
  label: string;
  href: string;
  /** The primary phone of whoever the task is about, if there is one. */
  phone: string | null;
  email: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
};

export async function taskLinks(
  taskIds: string[],
): Promise<Map<string, TaskLink>> {
  const out = new Map<string, TaskLink>();
  if (taskIds.length === 0) return out;

  const chunkSize = 400;
  for (let i = 0; i < taskIds.length; i += chunkSize) {
    const chunk = taskIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await raw.query(
      `SELECT t.id         AS t_id,
              t.deal_id    AS t_deal_id,
              d.title      AS d_title,
              t.contact_id AS t_contact_id,
              c.first_name AS c_first_name,
              c.last_name  AS c_last_name,
              t.company_id AS t_company_id,
              co.name      AS co_name,
              (SELECT p.raw FROM contact_phones p
                WHERE p.contact_id = coalesce(t.contact_id, d.contact_id)
                ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS t_phone,
              (SELECT e.email_lower FROM contact_emails e
                WHERE e.contact_id = coalesce(t.contact_id, d.contact_id)
                ORDER BY e.is_primary DESC, e.created_at ASC LIMIT 1) AS t_email,
              d.contact_id AS d_contact_id
       FROM tasks t
       LEFT JOIN deals d ON d.id = t.deal_id AND d.deleted_at IS NULL
       LEFT JOIN contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
       LEFT JOIN companies co ON co.id = t.company_id AND co.deleted_at IS NULL
       WHERE t.id IN (${placeholders})`,
      chunk,
    );

    for (const r of rows) {
      const taskId = String(r[0]);
      const dealId = r[1] === null || r[1] === undefined ? null : String(r[1]);
      const dealTitle = r[2] === null || r[2] === undefined ? null : String(r[2]);
      const contactId = r[3] === null || r[3] === undefined ? null : String(r[3]);
      const first = r[4] === null || r[4] === undefined ? "" : String(r[4]);
      const last = r[5] === null || r[5] === undefined ? "" : String(r[5]);
      const companyId = r[6] === null || r[6] === undefined ? null : String(r[6]);
      const companyName = r[7] === null || r[7] === undefined ? null : String(r[7]);
      const phone = r[8] === null || r[8] === undefined ? null : String(r[8]);
      const email = r[9] === null || r[9] === undefined ? null : String(r[9]);
      const dealContactId = r[10] === null || r[10] === undefined ? null : String(r[10]);

      const contactName = `${first} ${last}`.trim();
      let label: string | null = null;
      let href: string | null = null;
      if (contactId && contactName) {
        label = contactName;
        href = `/contacts/${contactId}`;
      } else if (companyId && companyName) {
        label = companyName;
        href = `/companies/${companyId}`;
      } else if (dealId && dealTitle) {
        label = dealTitle;
        href = `/deals/${dealId}`;
      }
      if (!label || !href) continue;

      out.set(taskId, {
        label,
        href,
        phone,
        email,
        contactId: contactId ?? dealContactId,
        companyId,
        dealId,
      });
    }
  }
  return out;
}

/** True when the workspace has nothing in it at all — the first-run screen. */
export async function workspaceIsEmpty(): Promise<boolean> {
  const rows = await raw.query(
    `SELECT (SELECT count(*) FROM contacts WHERE deleted_at IS NULL) AS contact_count,
            (SELECT count(*) FROM companies WHERE deleted_at IS NULL) AS company_count,
            (SELECT count(*) FROM deals WHERE deleted_at IS NULL) AS deal_count,
            (SELECT count(*) FROM tasks WHERE deleted_at IS NULL) AS task_count,
            (SELECT count(*) FROM activities WHERE deleted_at IS NULL) AS activity_count`,
  );
  if (rows.length === 0) return true;
  return rows[0].every((value) => Number(value ?? 0) === 0);
}
