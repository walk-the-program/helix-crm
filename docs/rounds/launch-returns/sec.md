# LR-SEC return — Chief Security and Privacy Officer

TASK: LR-SEC (parent: Fable coordinator) · ATTEMPT 1 · PACKET REV 1
STATUS: **submitted**
Base revision: `552177f`. Revision this return describes and was verified at: `d3267ec`.
Team: this Opus lead + 3 Sonnet workers (W1 Rust boundary, W2 JS boundary, W3 retention/claims).
Worker returns are reproduced in the findings below; every worker diff was inspected by the lead
against its packet before acceptance.

---

## 0. What this phase had to prove

Helix has no accounts, sessions, roles, invitations, tenants, webhooks or in-app billing, by design
(`docs/rounds/2026-09-20-launch-readiness-record.md` §1, decision LR-2). Those checklist items are
recorded in §5 as **not applicable: local app**, with the one-line reason each, and nothing was built
to satisfy them. What a local-first CRM must instead prove is: the bytes on disk, the two opt-in
outbound integrations, the keychain, backups, exports, logs, deletion, and the ingestion path that
takes untrusted input from a public web form. That is what was reviewed.

---

## 1. Findings

Class: **Blocker** (exposing a real client would create an unacceptable data/access risk) ·
**Required** (required before paid onboarding) · **Follow-up** (useful, not needed for first launch).

| # | class | finding | why that class | fix | evidence |
|---|---|---|---|---|---|
| F-SEC-1 | **Blocker** | A keychain item that existed but would not parse was read as an *empty* bundle. With the per-kind items folded into the bundle and deleted, `db_key` then believed the workspace had no key, minted a fresh one, and `save_bundle` wrote it straight over the damaged item. The real key went with it and the workspace file could never be decrypted again. | Silent, total, unrecoverable loss of a paying client's entire CRM, triggered by one corrupt keychain record. Nothing else in this review can destroy data. | `load_bundle` refuses; every read/write propagates the refusal; the damaged item is left exactly as found so a keychain backup can still recover it. A bundle that parses as an object is still accepted when it holds values this build does not understand. | `523d14a`; `secrets::tests::an_unreadable_bundle_is_refused_and_never_overwritten` asserts the refusal **and** that the item is byte-identical afterwards; `a_bundle_with_unknown_or_non_string_values_still_reads` |
| F-SEC-2 | Required | The plaintext original the one-time SQLCipher migration sets aside was left to the ordinary 30-day backup retention — a complete unencrypted copy of a client's CRM on disk for a month, and **forever** on a workspace never backed up again, because retention always keeps the newest file. | Defeats encryption at rest for any install that migrates. Not a Blocker only because no released build ever wrote a plaintext workspace — v0.1.0 ships SQLCipher — so it reaches upgraders, not new clients. | The first later `db_open` that finds an already-encrypted file deletes every `*-pre-encryption.db`. Recovery survives: the converting launch takes an ordinary backup afterwards, encrypted with the workspace key. | `523d14a`; `reopening_removes_the_plaintext_copy_and_nothing_else` proves the plaintext copy goes and an ordinary encrypted backup in the same folder stays |
| F-SEC-3 | Required | An encrypted file plus a keychain with no entry for it made `db_open` mint a key, write it, then fail to open with it — reported as "the saved key does not open this workspace", which reads like the wrong workspace rather than a lost key, and with the entry a keychain restore needed now occupied. | The client is told the wrong thing at the exact moment recovery is still possible, and the write forecloses it. | Refused before anything is written; message names the real cause and says nothing was replaced. | `523d14a`; `a_lost_keychain_entry_is_reported_and_no_new_key_is_minted` asserts no replacement key exists after the refusal |
| F-SEC-6 | Required | The site's own HTTP response body (200 chars) was copied into `helix.log` — plaintext, and exactly what Diagnostics invites the owner to email support — and into `lead_sync.last_error`. Many frameworks echo a rejected credential back on a 401, so the site bearer token could land in a log file. | A credential and arbitrary third-party text in a file the product asks clients to send to a stranger. | Rust: 401/403 carry no body at all; other statuses keep a 200-char snippet with the exact token and bearer-shaped values redacted. JS: the auth branch drops the body from both sinks; the network branch keeps it in `lead_sync.last_error` (encrypted, and what Settings → Website needs) and drops it from the log. | `613091b`, `eabeb03`; `a_401_body_that_echoes_the_token_never_reaches_the_error_message`, `a_500_body_has_the_token_redacted_but_otherwise_keeps_its_detail`, `pollerLogRedaction.test.ts` asserts presence in the DB **and explicit absence** from the log |
| F-SEC-7 | Required | `CompanyPage` rendered a raw `<a href={company.website…} target="_blank">` with a `startsWith("http")` check and no scheme allow-list, bypassing the opener capability. `company.website` is free text from CSV import. | Imported data controlling a navigation in the app's own webview; no navigation guard exists in `src-tauri`, so a click would take the single window off the app with no way back. | Routed through `openUrl` behind `safeExternalUrl`: control characters stripped before parsing, `//host` refused, scheme-vs-`host:port` disambiguated, `http`/`https` only, second `URL` parse as backstop. | `ee67420`; `tests/unit/security/actionsHostile.test.ts` (`javascript:`, `JaVaScRiPt:`, leading space/tab/newline, `data:`, `file:`, `vbscript:`, `blob:`, `//evil.com`) |
| F-SEC-10 | Required | Purging a customer left every note about them behind. `activities`, `tasks`, `recurring_rules` reference a contact `ON DELETE set null`, and the FTS triggers only fire on a real DELETE — so after emptying the trash, typing the customer's name still found "Called Jane about the leak, she is at 42 Elm St". | "Delete" did not delete, and the residue stayed *searchable*. This is the half of deletion a client actually cares about. | `orphanSweep()` removes, inside the purge transaction and before the parent row goes, rows whose only subject was the purged record. Rows that also belong to a surviving deal/company keep the note and lose only the link. `documents` deliberately excluded (financial record; ruling R6b). | `0b3b6f9`; `purgeOrphanSweep.test.ts` — mutation-checked: removing the call fails the note and task tests and leaves the keep-the-deal-note test passing |
| F-SEC-11 | Required | `leads_fetch` called `response.json()` with no cap: a hostile or compromised site could stream unbounded bytes into memory. | Trivial remote DoS on the one path that accepts input from the internet. | `read_capped_body` checks `Content-Length` then aborts mid-stream past 5 MB. | `613091b`; `a_content_length_over_the_cap_is_refused_before_any_body_is_read`, `a_body_that_exceeds_the_cap_mid_stream_is_refused_with_no_content_length` |
| F-SEC-12 | Required | reqwest's default `Policy::limited(10)` was in force, so the validated https origin could redirect the authenticated poll elsewhere. W1 verified in `reqwest-0.12.28/src/redirect.rs:238-249` that `remove_sensitive_headers` compares host+port and not scheme, so a redirect to `http://origin:443` would **not** have stripped `Authorization`. | Origin validation could be sidestepped after the fact, with the bearer token attached in one real edge case. | `redirect::Policy::none()`; a 3xx now falls into ordinary non-2xx handling. | `613091b`; `a_redirect_is_never_followed_and_the_target_is_never_contacted` uses a second listener and asserts it never accepts a connection |
| F-SEC-13 | Required | No cap on lead count or field length: the server can return any number of leads regardless of `limit`, with megabyte fields. | Unbounded untrusted data straight into SQLite and the UI. | `enforce_bounds`: >200 leads rejects the page; identity fields (id/email/phone) reject rather than truncate, so no two values collide on a shared prefix and merge unrelated leads; display fields truncate, `message` with a visible note. NUL and bidi-override characters stripped char-wise, so a 4-byte emoji is never split. | `613091b`; 11 boundary/over-boundary tests |
| F-SEC-14 | Required | Deeply nested JSON hit serde's recursive descent with no depth limit — stack overflow, which aborts the process and cannot be caught. | A hostile 200 could kill the app on every poll. | Linear, non-recursive byte scan for depth before `serde_json::from_slice`, ignoring brackets inside strings. | `613091b`; 3 pure tests + a full network round-trip with 100+ deep nesting |
| F-SEC-15 | Required | A site whose `nextCursor` never advanced spun the poller's page loop forever. | Infinite loop, pegged CPU, no lead ever applied. | `isStalledCursor()` throws before the page is applied, failing like every other hostile shape. | `eabeb03`; 5 unit tests |
| F-SEC-17 | Required | Attachment *display* names were stored exactly as the OS returned them; only `storedName` was sanitised. A bidi override can disguise `evil.exe` as `fdp.txt` in the list and in the "Removed <name>" toast. | The owner is shown a name that misrepresents the file they are about to open. | `sanitizeDisplayName` strips NUL and bidi override/embedding characters, replaces path separators, caps at 255 code points. Windows-reserved names left alone deliberately — `fileName` never touches a real path. | `1bf762d`; `sanitizeDisplayName.test.ts` |
| F-SEC-18 | Required | `change_log` kept `before_json`/`after_json` — full field values — forever, including after the record was purged. Its own header said "Rows are never deleted, not even when the entity is purged." | A purged customer's name, phone and notes stayed recoverable from the database indefinitely, which is the opposite of what the purge promises. | `sweepOldChangeLog` bounds it at 90 days, well past the 30-day `MERGE_REVERSAL_DAYS` floor and past the fact that the undo stack is emptied on every `db_open`. | `675004c`; `changeLogRetention.test.ts` |
| F-SEC-19 | Required | Purging a quote or invoice never deleted its rendered PDF — a separate file the row only pointed at. | A document with the customer's name, address, phone and email baked in survived the purge as a plain file. | The sweep deletes it when it sits inside the workspace's own `documents/` folder; a copy the owner saved elsewhere is deliberately untouched. | `675004c`; `documentPdfPurge.test.ts` |
| F-SEC-20 | Required | The CSV export formula guard `/^[=+\-@\t\r]/` missed a leading **LF** entirely, and missed whitespace-then-trigger (`" =1+1"` — RFC 4180 quoting does not stop Excel or Sheets trimming and evaluating it). | Formula injection into a spreadsheet the owner opens, from data a lead or an import supplied. | Two-part check: trigger set now includes `\n`, plus a second check against the leading-whitespace-stripped string. | `a067fcc`; `exportCsvHostile.test.ts` — W2 verified the old regex returned `false` for `" =1"` and `"\n1"` before changing it |
| F-SEC-21 | Required | CSV import had **no** file-size or row-count limit. The existing 5,000 constants bounded only the diagnostic lists, not the row array; nothing bounded file bytes, and the UTF-8 decode runs twice over the whole file before a row is parsed. | A 2 GB or 10M-row file wedges the app during onboarding, which is exactly when a client imports their spreadsheet. | `MAX_IMPORT_FILE_BYTES` 100 MB checked before the decode; `MAX_IMPORT_ROWS` 250,000 thrown from papaparse's `step`. Sits above the existing 100k-row test. | `f1e8add`; `importLimits.test.ts` |
| F-SEC-23 | Required | `DraftFollowUpButton.openInMail` hand-built `mailto:${to}?subject=…` with the customer email completely unescaped, plus a `window.location.href` fallback. | `a@b.com?to=attacker@evil.com` rides along as extra mail parameters, from a CSV-imported address. Found by W2, not in the packet. | Rebuilt on `mailtoHref`; fallback dropped. CRLF stripped from the address segment as defence in depth. | `ee67420`; `actionsHostile.test.ts` |
| F-SEC-26 | Required | Customer-facing claims were wrong. CHANGELOG's "Not in v1" still listed invoices, recurring reminders, deal import, encrypted workspaces and merge-field templates as absent — a list clients are meant to rely on for what Helix does *not* do. Help said "nothing you type is sent anywhere, ever", which the AI module and site poll contradict. Nothing told the owner attachments and exports are plain files. | The product was making false statements about its own privacy behaviour to the people buying it. | All corrected; see §3. | `529ecc2` |
| F-SEC-4 | Follow-up (fixed) | The CSP relied on `default-src` for everything it did not name, but `base-uri`, `form-action`, `frame-ancestors` and `object-src` do not fall back — they were unset. | No known exploit path in an app with no remote content; closed because it is free. | All four set explicitly. `script-src` left to fall back deliberately, so Tauri's initialisation hash lands where it always has. | `b8c5634`, `ff7f9e9` |
| F-SEC-5 | Follow-up (fixed) | A large sort or FTS rebuild could spill to a scratch file. SQLCipher does key its temp databases, so this was never a live exposure. | "Does" is a property of a dependency; this was the one place records could reach disk outside the keyed file. | `PRAGMA temp_store = MEMORY`. | `b9bede3`; asserted in `pragmas_are_applied_on_open` and by `no_file_in_the_workspace_folder_holds_a_name_in_the_clear` |
| F-SEC-8 | Follow-up (fixed) | `disk.rs` spawned `fdesetup`, `manage-bde` and `powershell` by bare name; Windows `CreateProcess` searches the current directory before PATH. | Diagnostics only, never privileged, and the install dir is not user-writable — but it costs two lines. | Absolute paths; `SystemRoot` read from the environment. | `b8c5634` |
| F-SEC-9 | Follow-up (fixed) | The crash screen asked the owner to copy the details and send them, while rendering `error.message` plus a component stack that can quote a record's values. | Informed consent, not a vulnerability. | One sentence before the button. | `c215d4f` |
| F-SEC-16 | Follow-up (fixed) | The 50 MB attachment cap trusted a pre-copy `stat` for the whole copy (TOCTOU). | Needs a file that grows between stat and copy; the owner picked it themselves. | `bounded_copy` reads/writes in 256 KB steps and aborts on bytes actually moved, deleting the partial file. | `eb7aa4d`; tested by passing a `max_bytes` below the real size, so no race is needed |
| F-SEC-22 | Follow-up (fixed) | `LIKE ?` without `ESCAPE` in five owner-facing search filters, while `_pickers.ts` escaped correctly. | Not injection — every value is bound. A search for `%` matched everything. | Made consistent. | `e06dadd`; `likeEscaping.test.ts` runs against real SQLite |
| F-SEC-24 | Follow-up (fixed) | The AI transport's e2e gate was the only harness check in the codebase not compiled out; a shipped build still evaluated `window.__HELIX_E2E__`. | Unreachable (nothing sets the global; `connect-src 'self'` would block the browser fetch anyway) but it should not have been the one exception. | Gated on `import.meta.env.VITE_E2E` like every other. W2 correctly used a truthy check — `VITE_E2E` is the string `"1"`, so the `=== true` I proposed would have broken the harness. | `dc4fa54`; `aiE2eGate.test.ts` |
| F-SEC-25 | Follow-up (mitigated) | `renderDocument.ts`'s `wrapText` re-measures the whole growing prefix per character for an unbroken word — quadratic. W2 measured against pdf-lib: 5,000 chars ≈ 0.4 s, 20,000 ≈ 6.3 s, 50,000 ≈ 41 s. | A 1 MB note with no spaces hangs PDF generation on the main thread. Mitigated at the boundary; the algorithm is still quadratic underneath. | Free-text fields capped at 10,000 characters in `buildRenderInput`. Real fix (incremental width tracking) left for OPS/PX. | `403fe85`; `pdfTextCap.test.ts` |

### Checked, no issue — with the hostile case actually run

- **FTS5 injection.** `toMatchQuery` quotes every token and doubles internal quotes. Run against `"`, `""`, `*`, `a*`, `NEAR(a b)`, `a OR b`, `a AND NOT b`, `^a`, `a:b`, `(`, `)`, a 10 kB token, all-punctuation and emoji: none throws. Test added because none existed (`be156f3`).
- **SQL construction.** Every `${…}` in `src/db/repos/*.ts` enumerated: all are static fragments, table names indexed by a typed union, or `?`-placeholder counts. Custom field names and saved-view sorts are never SQL identifiers (`custom_values` is keyed by `field_id`; saved views store an opaque `query_json`).
- **WAL and every sibling file.** A contact is inserted, the connection left **open** so the WAL is not truncated, and every file in the workspace folder read back as bytes and searched for the name. Clean (`84358b0`).
- **Backups are encrypted** — existing `a_backup_is_encrypted_and_opens_with_the_same_key`, re-run.
- **The JS bundle holds no secret.** Fresh `npm run build`, then `dist/` grepped for `sk-ant-`, bearer-shaped strings, PEM headers and 64-hex: nothing. No sourcemaps are emitted; the only `import.meta.env` uses are the e2e gates, which compile out.
- **Unsafe rendering.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in `src/`. The only other raw `<a href>`s (`Nav.tsx`, `SettingsLayout.tsx`) are internal SPA routes.
- **`tel:`/`sms:`/`mailto:`** strip to `[^\d+]` or percent-encode the address itself; tested against `+1-555-0100"><script>`, `a@b.com?to=attacker@evil.com`, CRLF header-injection payloads and a 100 kB address.
- **AI key handling.** Read fresh from the keychain per call, never cached, never in a settings row (only the last 4), never in a URL or body (`x-api-key` header), never logged, never in an error — `errorDetail()` derives only from the HTTP *response*. Base URL is a setting with no UI and no JS validation, but the Tauri capability confines it to `api.anthropic.com` and that is now a test.
- **Replay/idempotency.** Same page twice and a cursor reset create nothing twice — existing `applyLeads.test.ts` coverage, read and cited. Enforcement is JS-side only; see F-SEC-28.
- **Search index after purge.** A purged contact or company leaves no `search_docs`/`search_index` row (`searchIndexPurge.test.ts`).
- **Trash purge boundary.** 29 days survives, 31 days does not (`trashPurgeCutoff.test.ts`).
- **`merges`** holds only opaque ids, not field values.
- **Log contents.** Every `log::` call in `src-tauri/**` and the single JS logger enumerated: timestamps, counts, versions, the connected site's origin, and — after F-SEC-6 — nothing a remote host wrote. `console.*` goes to the webview console, not the file.
- **Tauri hardening.** `withGlobalTauri` absent (default off); no `devtools` feature, so no inspector in release; `dragDropEnabled` at its safe default with Tauri intercepting; asset protocol scoped to `…/attachments/**`; every `fs:` permission appdata-scoped. All now asserted by `capability_tests.rs`.

---

## 2. Data map

| data class | where stored | encrypted at rest? | who can read it | retention | leaves the machine? |
|---|---|---|---|---|---|
| Contacts (names, phones, emails, addresses, tags, custom values) | `contacts`, `contact_phones`, `contact_emails` in `helix.db` | **Yes** — SQLCipher, 32-byte per-workspace key in the OS keychain | The OS account, through the app; or anyone holding both the file and the keychain entry | Trash, then hard purge at 30 days; phones/emails cascade | No, unless exported or sent to Anthropic on a button press |
| Companies, deals, stage events, deal items | own tables | Yes | same | 30-day trash/purge; a deal a sent document refers to is never purged (R6b) | same |
| Activities and notes | `activities` | Yes | same | 30-day trash/purge. **As of F-SEC-10**, deleted with the record when that record was their only subject; kept, minus the link, when they also belong to a surviving deal or company | No |
| Tasks, recurring reminders | `tasks`, `recurring_rules` | Yes | same | same as activities | No |
| Attachments — the row | `attachments` | Yes | same | 30-day purge | No |
| **Attachments — the file** | `<workspace>/attachments/<uuid>.<ext>` | **No — plain file on disk** | Anyone who can read the folder | Removed by the purge sweep | No, unless the owner opens or sends it |
| Quotes and invoices | `documents` + children | Yes | same | 30-day purge | No |
| **A rendered PDF** | `<workspace>/documents/*.pdf`, or wherever the owner saved it | **No — plain PDF** with the customer's details baked in | Anyone who can read that folder | The in-workspace copy is purged with its row (F-SEC-19); a copy saved elsewhere is the owner's and is never tracked | No, unless the owner sends it |
| Products, pipelines, stages, sources, tags, saved views, custom field definitions | own tables | Yes | same | Indefinite; configuration, not customer data | No |
| Settings (vocabulary, currency, site origin, AI model, `aiBaseUrl`) | `settings` | Yes | same | Indefinite. **No secret is ever stored here** | No |
| `change_log` (undo trail, full field values) | `change_log` | Yes | same | **90 days** (F-SEC-18); was unbounded | No |
| `merges` | `merges` | Yes | same | Indefinite; opaque ids only | No |
| Search index | `search_docs`, `search_index` | Yes | same | Follows its rows; purge removes both | No |
| `lead_sync` (cursor, last error, last poll) | `lead_sync` | Yes | same | Indefinite. Holds the site origin and, on a non-auth failure, a token-redacted snippet of the site's reply | No |
| Backups | `<workspace>/backups/*.db` | **Yes** — `VACUUM INTO` through a keyed connection | same as the live file | 24 h keep-all, then daily to 30 days, newest always kept | No |
| Pre-encryption plaintext copy | `<workspace>/backups/*-pre-encryption.db` | **No** | anyone who can read the folder | **Deleted at the next clean open** (F-SEC-2); was 30 days or forever | No |
| Exports (CSV / JSON / ZIP) | wherever the owner's dialog points | **No — plain, by design** | anyone who can read the file | Not tracked by Helix | **Yes** — this is the path built for data to leave; Helix uploads it nowhere |
| OS keychain item | Keychain / Credential Manager, service `helix`, one `<workspaceId>:bundle` per workspace holding `dbkey`/`site`/`anthropic` | This *is* the key store | The OS account, under the OS's ACL | `dbkey` is never deleted by the app, by design — deleting it would make the file unreadable forever. Archiving clears `site`/`anthropic` only | The site token and the API key are sent to the two opt-in integrations; the entry itself never leaves |
| `helix.log` | `<appData>/logs/helix.log` | **No — plain text** | The OS account | `KeepSome(7)`, 4 MB per file, folder swept of >7-day files on launch | No, unless the owner copies it out |
| `helix.json` (workspace names, ids, paths, last poll/backup) | `<appData>/helix.json` | **No — plain JSON** | The OS account | Indefinite; entries are archived, never removed | No |
| Window position/size | plugin-managed file under appData | Not verified; treat as plain | The OS account | Plugin-managed | No |
| Error text on screen | window memory only | n/a | whoever is looking | Not persisted by Helix | Only if the owner copies and sends it — the screen now says so (F-SEC-9) |
| Site bearer token, in flight | keychain → `Authorization` header | In transit over HTTPS (rustls) | The owner's own site, which issued it | n/a | **Yes**, to the owner's own site, every 5 min while connected — that is the feature |
| Anthropic request payload | not stored | In transit | Anthropic, on the owner's own account | n/a | **Yes, on a button press only.** One record: its name, company, phones, emails, notes, website, deal stage/value/date, and up to 30 timeline entries. Never the contact list, never the whole database |

---

## 3. Claims changed

| claim | where | what the code does | new wording |
|---|---|---|---|
| "Not in v1: quotes/invoices, recurring reminders, deal import, encrypted workspaces, merge-field templates" | `CHANGELOG.md` | All five ship in 0.1.0 | Moved into the shipped list; "Not in v1" now lists only what is genuinely absent |
| "nothing you type is sent anywhere, ever" | Help | The AI module and the site poll both send, opt-in | "nothing leaves your machine unless you turn on…", matching the README |
| *(absent)* attachments and exports are unencrypted | README, Diagnostics, Backups | They are plain files beside the encrypted database | Stated in all three, in the owner's terms |
| *(absent)* what `helix.log` holds | Diagnostics, Help | Timestamps, counts, versions, the site origin — and, after F-SEC-6, nothing a remote host wrote | "Records when Helix started, backed up, checked your website, or hit an error, plus your connected website's address. It does not hold a customer's name, phone number, email or message." |
| *(absent)* a backup excludes attachments | Backups | True | Stated |
| "copy the details and send them to us" | crash screen | Renders `error.message` + component stack | "Read them first — an error can quote a name, an address or a note from your own records." |
| *(absent)* archiving deletes nothing | Workspaces | Archiving clears two keychain fields and marks a flag; no file is removed | Stated, with a new Help article "Removing a workspace for good" giving the manual procedure |

No certification, compliance or legal claim was added anywhere.

---

## 4. Acceptance

| | result | evidence |
|---|---|---|
| **A1** data map | **pass** | §2, one row per class, each justified by code read |
| **A2** verdict + evidence per scope item | **pass** | §1: 25 numbered findings with class and reason, plus the "checked, no issue" list with the hostile case actually run for each |
| **A3** Blockers and Required fixed with tests; Follow-ups listed | **pass** | 1 Blocker + 16 Required all fixed and tested; 12 Follow-ups in §5 each with a why-not-now |
| **A4** typecheck / vitest / cargo / e2e / build | **pass** | §6 |
| **A5** claims match behaviour | **pass** | §3 |
| **A6** no file outside ownership; no CI edits | **pass** | Every worker diff inspected against its packet; all within grant. `.github/workflows/**` untouched — requests in §7 instead. `git status` clean at `d3267ec` |

---

## 5. Follow-ups, and what does not apply

**Not applicable: local app** — sign-up/authentication/logout/session expiry, account recovery, invitations, organisation membership, role changes, user removal, backend authorisation, tenant isolation, revoked-session access, webhook authenticity, public-endpoint rate limits, in-app billing state. Reason in every case: Helix has no accounts, no server and no second user; the OS account is the trust boundary (record §1, decision LR-2). Nothing was built for these.

**Rate limits and abuse (applicable part).** Judged for the two integrations. The site poll backs off 1/2/4/8 minutes and caps at 8, stops outright on 401/403, and the 5-minute timer only runs while the app is open — it cannot hammer a site returning 5xx. Anthropic is a button press. No further control is warranted.

| # | class | why not now |
|---|---|---|
| F-SEC-27 | Follow-up | **No in-app "Delete workspace" exists** — only Archive, which deletes nothing. Needs a Rust command (recursive delete + a keychain delete permitted to touch `dbkey` under one explicit owner-confirmed path) plus a registry mutation. The manual procedure is now documented in Help, and on a single-owner machine the owner has Finder; building an irreversible delete unverifiable in this session is the worse risk. Recommend building it before the second paying client. |
| F-SEC-28 | Follow-up | `deals.external_id` has an index but no UNIQUE constraint; lead idempotency is a read-then-write safe only because the app's write lock serialises writers. Needs a migration: `CREATE UNIQUE INDEX … ON deals(external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL`. Text written, not applied — `drizzle/` belonged to no worker and a migration deserves its own verified pass. |
| F-SEC-29 | Follow-up | Backoff state is a module variable, so a broken site is polled once hard at every launch. Needs a `lead_sync` column. Bounded harm: one request per launch. |
| F-SEC-31 | Follow-up | `documents.syncCustomerFromDeal` nulls `pdf_path` on a bill-to change without deleting the old PDF, orphaning it beyond the purge sweep's reach. Same class as F-SEC-19, narrower trigger. |
| F-SEC-32 | Follow-up | The export screen and save-PDF flow do not say "this file is not encrypted" *at the moment of the action*. README, Diagnostics, Backups and Help now do. |
| F-SEC-33 | Follow-up | `src/features/templates/lib/merge.ts` merge-field recursion not investigated — no worker owned it. Tokens are a fixed set from a static table, so expansion is not user-defined; worth a read before templates grow. |
| F-SEC-34 | Follow-up | `copy_in` takes an arbitrary source path from JS, so JS can copy any readable file into attachments — an arbitrary-file-read primitive *if* an attacker ever controls JS. The correct fix (dialog opened in Rust, one command) cannot be verified without launching the app. Precondition has no path today: no `innerHTML`, `default-src 'self'`, no remote content. |
| F-SEC-35 | Follow-up | Image thumbnails call the webview's native decoder on any file with an image extension (mime is extension-only). Standard risk for any app that thumbnails user files; removing thumbnails is a product decision, not a patch. |
| F-SEC-36 | Follow-up | `npm audit --omit=dev`: **zero**. Full audit: 4 moderate, all one advisory (GHSA-67mh-4wv8-2f99, esbuild dev server) reachable only through `drizzle-kit` when a developer generates migrations. The offered fix is a semver-major *downgrade* of drizzle-kit; not worth risking the migration tooling for a dev-only issue that never ships. |
| F-SEC-30 | Follow-up | `src/features/data/attachments/README.md` is stale (claims purge needs a Rust command that does not exist). Docs only. |
| F-SEC-25 | Follow-up | Quadratic `wrapText` mitigated by a 10,000-char cap; the algorithm needs incremental width tracking. |
| — | Follow-up | Unsigned installers (existing TODO E5). Out of scope here and a spending decision; see §8. |

---

## 6. Verification

All at `d3267ec`, on this machine, macOS. Walker's live workspace was never touched; the installed app was never launched.

```
npm run typecheck                 clean, exit 0
npx vitest run                    170 passed | 1 skipped (171 files)
                                  2221 passed | 3 skipped | 0 failed
cd src-tauri && cargo test        73 + 8 + 10 + 11 = 102 passed, 0 failed
                                  (baseline 41; capability_tests and the new
                                   encryption/leads/files tests are the growth)
npm run build                     built in 1.50s, exit 0
                                  (only the pre-existing chunking advisories)
E2E_PORT=4260 E2E_OUT=dist-sec npm run e2e:mac -- \
  data settings records leads ai invoices smoke
                                  107 passed, 1 failed -> fixed in d3267ec,
                                  leads.e2e.ts re-run: 23 passed
dist/ secret scan                 no sk-ant-, bearer, PEM or 64-hex match
```

Two test assertions pinned the pre-F-SEC-6 string and were updated, not weakened: `tests/repo/leads/poller.test.ts` (`02bfb2b`) and `tests/e2e-mac/specs/leads.e2e.ts` (`d3267ec`). In both, the assertion's actual subject — that a plain `{code, message}` rejection is not stringified to `"[object Object]"` — is untouched and still asserted; only the string encoding the unsafe behaviour changed, with a comment saying why. Both were stranded by pathspec (`tests/repo/**` and `tests/e2e-mac/**` belonged to no worker) and were picked up by the lead.

Three fixes were **mutation-checked** rather than assumed: the capability/CSP tests (4 deliberate weakenings — an extra http host, `file:` in the opener, `unsafe-eval`, a relaxed `form-action` — each caught, then reverted), the orphan sweep (removing the call fails exactly the two tests it should and spares the third), and W2's export guard (the old regex confirmed to return `false` for `" =1"` and `"\n1"` before the change).

---

## 7. CI requests for OPS (no workflow was edited)

1. Add `npm audit --omit=dev --audit-level=high` to `ci.yml`. Production advisories are zero today; this keeps them there. Read-only, no new tooling.
2. Add `cargo audit` via the `rustsec/audit-check` action. **`cargo audit` is not installed on this machine and I did not install it**, so the Rust dependency tree is the one item in scope this phase could not check. CI is the right place for it.
3. `cargo test` already runs on macOS and Windows, so `capability_tests.rs` and the Windows branch of `disk.rs` are both covered without a workflow change — no action needed, recorded so OPS knows the new tests are gated.

---

## 8. Escalations for Fable / Walker

1. **Unsigned installers.** An unsigned macOS build changes identity every rebuild, so the Keychain prompt reappears and Gatekeeper warns the client on first run. A spending decision (Apple Developer Program), not a code fix.
2. **`docs/CONTRACTS.md` was changed** by the lead for F-SEC-1/2/3/5 — the pre-encryption purge rule, the refusal to mint over a lost key, the unreadable-bundle refusal, and `temp_store`. Text is in `523d14a` and `b9bede3`; flagged because CONTRACTS is shared.
3. **F-SEC-27 (no delete-workspace) and F-SEC-28 (the UNIQUE index migration)** each need a decision about scope before the second client, not before the first.
4. Nothing in this phase needed Walker's machine or keychain.

---

## 9. Handoff

Nothing running: no servers, no background processes, no fake-site instance. `dist-sec` and its Playwright cache removed. All 23 commits are local on `main`; **nothing pushed** — Fable pushes. Working tree clean at `d3267ec`.
