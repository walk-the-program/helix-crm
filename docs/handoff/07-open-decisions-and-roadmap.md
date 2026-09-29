# 07. Open decisions and roadmap

What is still open at v0.2.0 (`2e035c6`, main `2e9fb04`): the six decisions that
belong to Walker, everything deliberately deferred, what was judged and turned
away, and a recommended order for the next round. Nothing here is started.

The recommended order in the last section is a recommendation written for this
handoff. It is not a decision by Walker. Walker's decisions are D-1 to D-6.

## Walker's six open decisions (D-1 to D-6)

From `docs/rounds/launch-returns/rev.md` §4, restated in the launch record §6.
Agents prepare; they do not decide and they do not invent commercial terms.

| # | Decision | What is prepared | What waits on the answer |
| --- | --- | --- | --- |
| D-1 | Website pricing. On record it is unsettled: about $1,000 build with monthly hosting unpriced; an earlier $500 plus $75 to $100 a month; a $250 a month AI cohort; "$2K" as what a signature site must justify (`ClearPath Sites/FOR-THE-NEXT-AGENT.md`, 2026-09-16). | Nothing in this repo depends on it and nothing was invented. `rev.md` §3's per-client effort table is the cost side of the arithmetic. | Nothing technical; only the conversation with the first client. |
| D-2 | Is Helix "included" with hosting, or a free extra? | README and Help say Helix is free and AGPL and say what the client keeps when the website ends. Neither framing is contradicted by the product. | The words Walker uses on a call; "included" invites support expectations that follow the monthly fee. |
| D-3 | Walker installs in person, or the client self-installs? | Both work. Procedures assume in person, the only hand-over where the token never travels (CL-1), and where the recovery key and second backup folder actually get done. | Install-day cost (45 to 75 minutes of Walker's time) against a self-install that may skip the second backup folder. (The recovery key is no longer skippable since F-CS-2 / LR-6: Today shows a persistent card.) |
| D-4 | Code-signing budget (Apple Developer Program and the Windows equivalent). | Nothing to build; a purchase plus a CI change in `release.yml`. | Removes the Gatekeeper/SmartScreen warning and the returning Keychain prompt at every install and update for every client. The largest recurring friction; raised by SEC, REV, CS (F-CS-17) and LA (C6). |
| D-5 | Is an opt-in update check acceptable? | Judged, not built. Recommended shape: a manual "Check for a new version" button in Settings, off until pressed, one call to GitHub's releases endpoint, no launch ping, nothing in the background. | Today a client can sit on a fixed bug forever (OPERATIONS inventory item 4; F-OPS-18; F-CS-19). It would be the first network call the owner did not ask for, against a stated promise. |
| D-6 | Where the client roster lives and who keeps it. | Blank template `docs/CLIENT-ROSTER-TEMPLATE.md` with a recommended path outside this public repo. | Nothing if Walker keeps it. If not, there is no other record of who runs what. |

Also declined, not open: scheduled `rustsec/audit-check` runs (F-OPS-13, decision
LR-5): a scheduled run opens GitHub issues on Walker's repo, and he never manages
GitHub.

## Deferred items

Each is a real, recorded gap, not a defect that blocks launch. Finding ids are the
ones in the launch returns; where a return carries no id, the source is named.

| Item | Finding id / source | What it is | Why deferred |
| --- | --- | --- | --- |
| Delete-workspace command | F-SEC-27 (`sec.md` line 144) | Only Archive exists; nothing in-app deletes a workspace or its `helix.json` row. Needs a Rust command (recursive delete plus an owner-confirmed keychain delete of `dbkey`) and a registry mutation. | Needs a scope decision before the second client. The manual procedure is in Help. |
| Reopening an archived workspace whose folder was deleted | F-LA-7 (`la.md` line 172) | `db.rs::open` silently creates an empty workspace under the same name; the registry row stays forever. Fix: `helix.json` records "opened before" so boot can refuse instead of create. | A boot-path change judged too late in the round. Same area as F-SEC-27; do them together. Condition C7 covers it meanwhile. |
| Backoff persistence | F-SEC-29, F-OPS-15 | Poller backoff is a module variable, so a broken site is polled once hard per launch. Needs a `lead_sync` column. | Bounded at one request per launch to the owner's own site. |
| Export-moment disclosure | F-SEC-32, F-SEC-R-3 | The export screen, save-PDF flow, statement PDF and .ics do not say "this file is not encrypted" at the moment of saving. README, Diagnostics, Backups and Help do. | Copy work not done. |
| `external_id` re-keying on a site address change | F-REV-12 (`rev.md` §5) | Choosing "same website at a new address" carries the cursor forward, but does not rewrite the origin prefix of `deals.external_id`, so a re-sent pre-cursor lead would arrive as new. Needs a migration under the partial UNIQUE index (0005). | Deserves its own verified pass with a real before/after workspace. Also in PX-2 "later". |
| Payments import | PX-2 (`px-common.md`) | Bringing existing payment history in. | Unvalidated demand. |
| Deposit request on a quote | PX-2 | Asking for a deposit from a quote document. | Unvalidated demand; deposits work as a partial payment or a deposit invoice. |
| OS notifications for due work | PX-2 | Native notifications for due tasks and reminders. | Later. |
| Multi-select on the pipeline board | `px-c.md` deviations, item 1 ("accepted") | Bulk actions exist on Contacts and the deals list only. | Argued: the card is already the drag handle; a selection model would put three meanings on one gesture. |
| Quadratic `wrapText` | F-SEC-25 | PDF text wrapping re-measures the growing prefix per character; mitigated by a 10,000-character cap. Needs incremental width tracking. | Mitigated. |
| Other tag-removal undo peers | `px-c.md` HANDOFF item 2; record §2 | Removing a tag link logged an id-less `before`, so undo reported success and restored nothing. `tags.detach` and `tags.setForEntity` were fixed in `c9fb6f5` (test `tests/repo/tagsUndo.test.ts`); the launch record still lists "`tags.setTags` peers audited for the same undo shape" as open. | The remaining work is auditing any other hard-delete path for the same id-less `before`. |

### Other follow-ups on record

Not in the launch record's deferred list; in the returns. Take when the area is
touched.

- F-LA-8: owner-customised pipelines, stages, sources and the three automation
  rows are not in "export everything" (custom fields, templates and saved views are).
- F-LA-4 residue: `cpoWalk.e2e.ts` (`STATIC_ROUTES`) still lacks `/schedule`,
  `/settings/automations` and `/reports/sources`; `la-j12.e2e.ts` covers them.
  Add them when regenerating design reference screenshots.
- F-OPS-16 (`deals.goneQuiet()` has no LIMIT), F-OPS-17 (six list screens not
  virtualised), F-OPS-20 (an import cannot be undone as "this import", only by the
  pre-import backup).
- F-CS-15, F-CS-16 (Export is not in the sidebar), F-CS-18 (duplicate preflight is
  contacts-only).
- F-SEC-30 (stale `src/features/data/attachments/README.md`), F-SEC-31 (old PDF
  orphaned on a bill-to change), F-SEC-33 (merge-field recursion not investigated),
  F-SEC-34 (`copy_in` takes an arbitrary source path), F-SEC-35 (thumbnails decode by
  extension), F-SEC-36 (`npm audit` full: 4 moderate, one dev-only esbuild advisory;
  `--omit=dev`: zero).
- Gone-quiet rule for tagged contacts without deals (PLAN.md TODO; no audit raised it).
  Multiple stakeholders on one deal (not built; contact plus company is proportionate).
  PDF fonts follow the app font switch (R18, deferred; PDFs use the brand guide's
  print faces). Search group headings and zod `newDealSchema` messages follow the
  vocabulary (F-P2-LA-4, module-load constants).
- Manual checks Walker still owes on a real launch: window drag, single Keychain prompt,
  real window layout (round 3); Copy/Print on the real webview (C2).

## The "later" list (PX-2)

Recorded, not built: OS notifications for due work; an opt-in update check (Walker's
D-5); `external_id` re-keying on a site address change (F-REV-12); payments import;
deposit request on a quote; multi-currency.

## The rejected list (PX-3)

| Rejected | Reason recorded |
| --- | --- |
| Sending email from Helix | Product promise: Helix never sends. |
| Teams, sync, a client portal | No server by design. |
| A map view | No reason given in PX-3; PLAN.md "NOT in scope (v1)" also lists it. |
| Time or expense tracking | No reason given in PX-3. |
| E-signature | No reason given in PX-3. |
| Contact photos | No reason given in PX-3. |

Also rejected in the returns: crash or error reporting ("telemetry wearing a
different hat", `rev.md` §3); Helix fetching its own token (against the
write-only-token design, `rev.md` §3); building accounts, roles, sessions,
invitations or in-app billing to satisfy a checklist item that does not apply to a
local desktop app (LR-2).

## Recommended next-round order

Recommendation, with rationale. Walker may reorder it.

1. **Signing (D-4) and the first real client, together.** Signing is the largest
   recurring friction for every client at every update, and it is a decision plus a
   purchase, so it blocks on Walker first. In parallel, do what needs no purchase: run
   C1 to C3 on a never-run Mac (and Windows if a Windows client is next), then install
   one real client per `docs/ONBOARDING-CHECKLIST.md` and keep the roster. Real use is
   what surfaced round 3 and the stale-pages fix; expect the next list to come from
   the same place. Do not start speculative features before that feedback exists.
   If Walker approves D-4, the agent's part is the `release.yml` change, with signing
   secrets read from GitHub Actions secrets. Do not tag a signed release until Walker
   has bought the certificates himself; nothing may cost him money without his say.
2. **F-LA-7 and the delete-workspace command (F-SEC-27) as one change.** They share
   the boot path and registry (`helix.json` "opened before" flag; an owner-confirmed
   delete that also removes the keychain `dbkey`), and `la.md` says to do them
   together. Removes condition C7 and the only way a client can silently lose the
   sense of where their data went. Add F-LA-8 (export the customised pipeline
   configuration) if the export code is open anyway.
3. **The money and payments follow-ups, if a client asks:** payments import, deposit
   request on a quote, F-REV-12 (`external_id` re-keying), then D-5's manual update
   button if Walker says yes. All are "unvalidated demand" or need a real
   before/after workspace; the first client's books will show which matters.
4. **A hygiene sweep, whenever convenient:** export-moment disclosure (F-SEC-32),
   backoff persistence (F-SEC-29), `wrapText` (F-SEC-25), the tag-undo audit, adding
   the three routes to the design walk.

Constraints on any of this: the standing rules in 08, no telemetry, no paid services,
and do not launch the installed app or touch Walker's live workspace.

---

Verified against: `docs/rounds/launch-returns/rev.md` §3 to §5; `docs/rounds/2026-09-20-launch-readiness-record.md`
§3 (LR-2, LR-5), §6; `docs/rounds/launch-returns/la.md` lines 28, 162 to 177, 371 to 404;
`docs/rounds/launch-returns/sec.md` lines 55, 144 to 154, 197; `docs/rounds/launch-returns/ops.md`
lines 54 to 61; `docs/rounds/launch-returns/cs.md` lines 169 to 174; `docs/rounds/launch-returns/px-common.md`
(PX-1 to PX-6); `docs/rounds/launch-returns/px-c.md` lines 228 to 273; `docs/rounds/2026-09-20-cpo-cdqo-record.md`
§6.1; `docs/OPERATIONS.md` inventory; `git show c9fb6f5` and `tests/repo/tagsUndo.test.ts`;
at `2e9fb04`, 2026-09-28.
