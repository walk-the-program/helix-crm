/**
 * Turning FTS5 hits into rows a person can read.
 *
 * `search.searchGrouped()` returns `{ entityType, entityId, text, rank }`, and
 * `text` is the indexed blob — a contact's row is their name plus every phone,
 * every email, the company name and their notes, all run together. That is
 * exactly right for matching and exactly wrong for showing. So a second pass
 * fetches a proper name and a one-line subtitle for the handful of ids the
 * search actually returned: one query per entity type, never one per row.
 *
 * CONTRACT NOTE: like `todayData.ts`, these are repository functions in the
 * wrong folder because a feature agent may not edit `src/db/repos`. They
 * belong in `src/db/repos/search.ts` as `searchRows()` and `recentRecords()`.
 * Recorded in docs/STATUS.md.
 */

import { raw } from "@/db/client";
import * as search from "@/db/repos/search";
import type { SearchEntityType } from "@/db/repos/search";

export type SearchRow = {
  entityType: SearchEntityType;
  entityId: string;
  /** The name the owner would say out loud. */
  label: string;
  /** One line of context: the company, the stage, the date. */
  subtitle: string | null;
  href: string;
};

export type SearchRowGroup = {
  entityType: SearchEntityType;
  heading: string;
  rows: SearchRow[];
};

export const GROUP_HEADINGS: Record<SearchEntityType, string> = {
  contact: "Contacts",
  company: "Companies",
  deal: "Deals",
  activity: "Notes",
};

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const s = text(value);
  return s.length > 0 ? s : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function contactRows(ids: string[]): Promise<Map<string, SearchRow>> {
  const out = new Map<string, SearchRow>();
  for (const part of chunk(ids, 200)) {
    const rows = await raw.query(
      `SELECT c.id          AS c_id,
              c.first_name  AS c_first_name,
              c.last_name   AS c_last_name,
              co.name       AS co_name,
              (SELECT e.email_lower FROM contact_emails e
                WHERE e.contact_id = c.id
                ORDER BY e.is_primary DESC, e.created_at ASC LIMIT 1) AS c_email,
              (SELECT p.raw FROM contact_phones p
                WHERE p.contact_id = c.id
                ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS c_phone
       FROM contacts c
       LEFT JOIN companies co ON co.id = c.company_id
       WHERE c.deleted_at IS NULL AND c.id IN (${part.map(() => "?").join(", ")})`,
      part,
    );
    for (const r of rows) {
      const id = text(r[0]);
      const name = `${text(r[1])} ${text(r[2])}`.trim();
      out.set(id, {
        entityType: "contact",
        entityId: id,
        label: name || "Unnamed contact",
        subtitle: nullableText(r[3]) ?? nullableText(r[4]) ?? nullableText(r[5]),
        href: `/contacts/${id}`,
      });
    }
  }
  return out;
}

async function companyRows(ids: string[]): Promise<Map<string, SearchRow>> {
  const out = new Map<string, SearchRow>();
  for (const part of chunk(ids, 200)) {
    const rows = await raw.query(
      `SELECT co.id         AS co_id,
              co.name       AS co_name,
              co.website    AS co_website,
              co.phone_e164 AS co_phone
       FROM companies co
       WHERE co.deleted_at IS NULL AND co.id IN (${part.map(() => "?").join(", ")})`,
      part,
    );
    for (const r of rows) {
      const id = text(r[0]);
      out.set(id, {
        entityType: "company",
        entityId: id,
        label: text(r[1]) || "Unnamed company",
        subtitle: nullableText(r[2]) ?? nullableText(r[3]),
        href: `/companies/${id}`,
      });
    }
  }
  return out;
}

async function dealRows(ids: string[]): Promise<Map<string, SearchRow>> {
  const out = new Map<string, SearchRow>();
  for (const part of chunk(ids, 200)) {
    const rows = await raw.query(
      `SELECT d.id     AS d_id,
              d.title  AS d_title,
              s.name   AS s_name,
              co.name  AS co_name
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN companies co ON co.id = d.company_id
       WHERE d.deleted_at IS NULL AND d.id IN (${part.map(() => "?").join(", ")})`,
      part,
    );
    for (const r of rows) {
      const id = text(r[0]);
      const stage = text(r[2]);
      const company = nullableText(r[3]);
      out.set(id, {
        entityType: "deal",
        entityId: id,
        label: text(r[1]) || "Untitled deal",
        subtitle: company ? `${company} · ${stage}` : stage,
        href: `/deals/${id}`,
      });
    }
  }
  return out;
}

async function activityRows(ids: string[]): Promise<Map<string, SearchRow>> {
  const out = new Map<string, SearchRow>();
  for (const part of chunk(ids, 200)) {
    const rows = await raw.query(
      `SELECT a.id          AS a_id,
              a.kind        AS a_kind,
              a.body        AS a_body,
              a.occurred_at AS a_occurred_at,
              a.deal_id     AS a_deal_id,
              a.contact_id  AS a_contact_id,
              a.company_id  AS a_company_id,
              d.title       AS d_title,
              c.first_name  AS c_first_name,
              c.last_name   AS c_last_name,
              co.name       AS co_name
       FROM activities a
       LEFT JOIN deals d ON d.id = a.deal_id
       LEFT JOIN contacts c ON c.id = a.contact_id
       LEFT JOIN companies co ON co.id = a.company_id
       WHERE a.deleted_at IS NULL AND a.id IN (${part.map(() => "?").join(", ")})`,
      part,
    );
    for (const r of rows) {
      const id = text(r[0]);
      const body = text(r[2]).replace(/\s+/g, " ").trim();
      const dealId = nullableText(r[4]);
      const contactId = nullableText(r[5]);
      const companyId = nullableText(r[6]);
      const on =
        nullableText(r[7]) ??
        (`${text(r[8])} ${text(r[9])}`.trim() || null) ??
        nullableText(r[10]);

      const href = dealId
        ? `/deals/${dealId}`
        : contactId
          ? `/contacts/${contactId}`
          : companyId
            ? `/companies/${companyId}`
            : "/";

      out.set(id, {
        entityType: "activity",
        entityId: id,
        label: body.length > 90 ? `${body.slice(0, 90)}…` : body || text(r[1]),
        subtitle: on,
        href,
      });
    }
  }
  return out;
}

const RESOLVERS: Record<
  SearchEntityType,
  (ids: string[]) => Promise<Map<string, SearchRow>>
> = {
  contact: contactRows,
  company: companyRows,
  deal: dealRows,
  activity: activityRows,
};

/**
 * Run a search and return readable rows, grouped by type in the palette's
 * fixed order. `perType` caps each group so one very common surname cannot
 * push the deals off the bottom of the list.
 */
export async function searchRows(
  query: string,
  options: { perType?: number; limit?: number } = {},
): Promise<SearchRowGroup[]> {
  const groups = await search.searchGrouped(query, {
    limit: options.limit ?? 50,
    perType: options.perType ?? 5,
  });
  if (groups.length === 0) return [];

  const resolved = await Promise.all(
    groups.map(async (group) => {
      const byId = await RESOLVERS[group.entityType](
        group.hits.map((hit) => hit.entityId),
      );
      // Keep FTS5's relevance order, and drop anything the resolver could not
      // find — a row deleted between the MATCH and this query.
      const rows = group.hits
        .map((hit) => byId.get(hit.entityId))
        .filter((row): row is SearchRow => row !== undefined);
      return {
        entityType: group.entityType,
        heading: GROUP_HEADINGS[group.entityType],
        rows,
      };
    }),
  );

  return resolved.filter((group) => group.rows.length > 0);
}

/**
 * What the palette shows before a single character is typed: the records
 * touched most recently, so the common case — reopening the thing you were
 * just looking at — takes no typing at all.
 */
export async function recentRecords(limit = 8): Promise<SearchRow[]> {
  const rows = await raw.query(
    `SELECT r_type, r_id, r_label, r_sub, r_updated_at FROM (
       SELECT 'contact' AS r_type,
              c.id      AS r_id,
              trim(c.first_name || ' ' || c.last_name) AS r_label,
              co.name   AS r_sub,
              c.updated_at AS r_updated_at
       FROM contacts c
       LEFT JOIN companies co ON co.id = c.company_id
       WHERE c.deleted_at IS NULL
       UNION ALL
       SELECT 'company', co2.id, co2.name, co2.website, co2.updated_at
       FROM companies co2 WHERE co2.deleted_at IS NULL
       UNION ALL
       SELECT 'deal', d.id, d.title, s.name, d.updated_at
       FROM deals d JOIN stages s ON s.id = d.stage_id
       WHERE d.deleted_at IS NULL
     )
     ORDER BY r_updated_at DESC
     LIMIT ?`,
    [limit],
  );

  return rows.map((r) => {
    const type = text(r[0]) as SearchEntityType;
    const id = text(r[1]);
    const href =
      type === "contact"
        ? `/contacts/${id}`
        : type === "company"
          ? `/companies/${id}`
          : `/deals/${id}`;
    return {
      entityType: type,
      entityId: id,
      label: text(r[2]) || "Untitled",
      subtitle: nullableText(r[3]),
      href,
    };
  });
}
