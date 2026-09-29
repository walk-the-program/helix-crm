# 05. History and direction

Where Helix has been, what Walker decided at each step, in his own words where
the words survive, and how he drives the work. Read this before proposing
anything: several things below were decided once and should not be reopened
without concrete evidence.

Walker Tracy (ClearPath Digital) is the owner and the only stakeholder. Every
date is 2026-09 and local time (UTC-6) unless it says otherwise. Between
2026-09-18 19:07 and 2026-09-20 22:26 the repo went from an empty scaffold to a
tagged v0.2.0: 454 commits on main (18 on 09-18, 115 on 09-19, 321 on 09-20,
counted from `git log`).

## Timeline

### 2026-09-18: the CEO review and the plan (D1 to D15)

`/plan-ceo-review` in selective-expansion mode produced `docs/PLAN.md`. Fifteen
decisions, all Walker's answers:

| # | Decision |
| --- | --- |
| D1 | First user: trade and service owners (the nine ClearPath trades). Walker is customer zero. |
| D2 | Not AI-first. A competent CRM; AI is an optional extra. |
| D3 | AI is bring-your-own Anthropic key. No proxy, no server. |
| D4 | The old ClearPath pipeline tool (`ClearPath Sites/crm/`) stays for outreach. Helix is a separate codebase. |
| D5 | Core objects: Contacts, Companies, Deals (renameable to Jobs/Quotes), Activities, Tasks; editable stages. |
| D6 | Tauri v2. |
| D7 | Local SQLite, sync-ready schema (UUIDs, timestamps, soft delete), no cloud. |
| D8 | v1 lead sources: CSV import and the ClearPath website quote form. Gmail and Calendar deferred. |
| D9 | Look: a fresh direction from research into what trade owners trust. Not the dispatch board. |
| D10 | JavaScript owns schema, migrations and logic. SQLite is reached through a small Rust pipe, not the stock SQL plugin, which cannot hold a transaction open reliably. |
| D11 | AGPL-3.0, public repo. |
| D12 | Review mode: selective expansion. |
| D13 | Baseline: all 19 core features, kept knowingly after the reviewer proposed deferring some. |
| D14 | Extras accepted: optional AI module (BYO key); several businesses in one app (workspaces). |
| D15 | Name: Helix CRM. |

The plan's review report records 2 extras accepted and 7 deferred. Walker
disagreed with the AI-first framing mid-review and said: "it just needs to be
competent... a product that I want to use... open-source CRM could be cool."
(`docs/PLAN.md` "What this is".) The two-sentence test for every screen, from
the same file: the owner does not want a CRM; he wants to not lose a lead and to
remember what he promised.

### 2026-09-18 to 09-19: waves 1 to 3

Walker's execution rule (memory `helix-crm-product.md`): up to 5 Opus agents in
parallel, each with up to 3 Sonnet subagents doing legwork; the main session
directs and does QC only; a "straight shot" to a finished build; restart if usage
runs out.

- **Wave 1:** Rust shell (db pipe, secrets, `leads_fetch`, `copy_in`, CI), TypeScript
  data layer and app shell, design direction, and the site endpoint with a fake
  site and test harnesses. `docs/CONTRACTS.md` pins every interface between
  agents.
- **Wave 2:** six feature areas in parallel: records, today, data, leads, ai,
  settings.
- **Wave 3:** reconciliation of the seams between them, a UI polish pass, and
  the `GET /api/crm/leads` endpoint ported to the other 17 ClearPath templates
  (17 commits; all 18 templates expose it behind `CRM_API_TOKEN`).
- Working notes for these waves are in `docs/ORCHESTRATION.md` and
  `docs/STATUS.md` (append-only, 4,000+ lines; search it, do not read it whole).

### 2026-09-18: the first look is rejected

After seeing the first build (light-first, "equipment orange", dense tables),
Walker said: "The design is still super sloppy use /minimalist ui - and shoot
for a truly Apple-like design." (memory `feedback-helix-apple-like-design.md`).
The whole UI was redone: calm, flat, generous, near-white canvas, hairlines,
Phosphor icons (DESIGN.md revision 2, built 09-19). Why he cares: he sells
websites on design taste, and a CRM that reads as generic undermines that.

### 2026-09-19: the brand guide becomes binding

Walker supplied `helix-crm-brand-guide.html` (now `assets/brand/guide/`) and
asked for it to be implemented everywhere. It supersedes the plain Apple-like
direction where the two differ; the Apple-like discipline (air, hairlines, calm
hierarchy) stays where the guide is silent. Result: DESIGN.md revision 3. Radius
0, flat fills, one confident primary block per view, two self-hosted faces
behind one font switch. Later the same weekend, from his own reviews:

- 09-20: dropped Zilla Slab for headings ("does not look that good"); DM Sans is
  the heading face now. Body face moved from Poppins to Lato the same day.
- Dark-mode review: wants the macOS traffic lights inside the app (overlay title
  bar), the shell filling the window, no clipped dialog rows, no browser-blue
  text in date fields.
- The offset sticker shadow from the guide was tried, shipped, and retired
  (see round 3 below).

### 2026-09-19: onboarding, encryption, depth, revenue (D16 to D22)

| # | Decision | Built |
| --- | --- | --- |
| D16 | Industry-first onboarding with trade presets and sample data | yes (STATUS 2026-09-19) |
| D17 | No app lock or account yet ("Nothing now") | nothing to build |
| D18 | SQLCipher at rest, key in the OS keychain | yes |
| D19 | Recurring reminders, templates, add-to-calendar, week summary, help | yes |
| D20 | Deal value is upfront plus 12 months recurring, always shown as "Upfront $X + $Y/mo" | yes (services catalog) |
| D21 | Full local invoicing: numbered, tax, branded PDF, AR aging, overdue on Today, no online payments | yes |
| D22 | Quotes as a document (accept converts to invoice) and a recurring invoice schedule | yes |

Walker's words on why depth matters: "simple but with depth is what wins"; he was
annoyed that services, pricing and MRR were not proposed earlier, so propose
revenue-side features proactively. Also this weekend: the Windows e2e suite got a
real WebDriver session, and an Apple HIG pass wired Helix into macOS (a real
menu bar, the seam between the window and the OS; `design/apple-hig-review.md`,
top ten of its list).

### 2026-09-19 evening: "Quicker is better"

Mid-turn message from Walker, 2026-09-19 18:05 local (transcript timestamp
2026-09-20T00:05Z): "execute as before - you the fable agents are the ultimate
QC at the end of the day, for additional features, Opus + sonnet subs. Quicker
is better. Make sure branding is kept in all builds."

### 2026-09-20: v0.1.0 published

Repo public at `https://github.com/walk-the-program/helix-crm`, AGPL-3.0.
v0.1.0: Mac arm64/x64 dmg, Windows exe/msi, unsigned. CI, e2e-win and Release
green. The `v0.1.0` tag was later moved (after the CPO/CDQO push) and now
points at `e8e7650`; it was first published from `cca77bb`.

### 2026-09-20: round 3, Walker's first real use

Walker used 0.1.0 and listed defects and gaps; `docs/rounds/2026-09-20-round-3.md`
turned them into 27 numbered acceptance criteria across 4 Opus leads (L1 shell,
kit and OS; L2 reports and onboarding; L3 invoices; L4 records, deals, dates).
What he changed, all binding since:

- Sticker shadow killed entirely: the one primary block is a flat brand-primary
  fill. Sidebar lockup is the plain mark plus the word.
- No purple or blue text anywhere in dark or light mode. Links are ink with an
  underline; only the focus ring keeps the secondary colour.
- No native date or time inputs, ever: in-app `DatePicker` / `TimePicker`, and
  type-ahead `Combobox` wherever a record is picked (never a `Select`).
- The window must drag from the top bar; theme toggle is one click each way;
  sidebar resizable (200 to 360 px) and collapsible; the Keychain asked at most
  once per new build.
- Sidebar grouped by relation: Today, Contacts and Companies, Deals and Services
  and Invoices and Reports, Tasks and Reminders, Import, Trash, Settings and
  Help. `NAV_ORDER` in `src/app/feature.ts` is the single place.
- Stages always in pipeline order everywhere; onboarding replaces empty default
  stages instead of appending.
- Money model: Customer, Deal, Invoice, Payment. Every invoice and quote is tied
  to a deal and inherits its customer. One query module, `src/db/repos/money.ts`.
- Stage changes are dated, confirmed events; the timeline is the record's full
  history; the content column is the only scroller.

Integrated by Fable: typecheck clean, 1,789 unit/repo tests, 49 Rust, 121 e2e in
one run. The real-app checks (window drag, single Keychain prompt) were deferred
because Walker was asleep and the app may not be launched then.

### 2026-09-20: the CPO / CDQO pass

Walker's prompt (`2026-09-20-cpo-cdqo-prompt.md`, verbatim) asked a Chief Product
Officer review then a Chief Design and Quality Officer review, with his standard
stated in it: "Be rigorous and candid. Do not protect existing decisions because
they are already implemented. Do not confuse a large feature list with a good
product, or an attractive screenshot with a good experience." And the close: "Your
job is to deliver a materially better CRM—not merely a critique, a plan, or a
cosmetic refresh." Header rule: "Nothing may incur cost."

Run by Fable plus 3 Opus leads and Sonnet workers; record
`docs/rounds/2026-09-20-cpo-cdqo-record.md`, lead returns in
`docs/rounds/cpo-returns/` (165 commits per memory). Fixed: one definition of the
money numbers (Quoted is the deal's value), quick-add double submit, a contact's
company change moving its jobs, one overdue rule, Trash purge covering more
tables, export of every table, workspace currency and locale reaching every
format, lost deals stop billing, deposits, kit-level table/overlay/label/icon
rules, two 1024 px reachability bugs, boot chunk 886 to 358 kB gzip. The record's
own decisions are numbered D1 to D4 (Quoted is deal value; no new entities without
a walk-through; copy tells the truth about zero; proportion). These are not the
PLAN.md D1 to D4. Rulings R1 to R19 are in the record §4.2. Baseline main was
`487c2b2`, 46 ahead of origin. After it: the push, the tag moved, no app launch.

### 2026-09-20: the launch-readiness round (six phases)

Walker's prompt (`2026-09-20-launch-readiness-prompt.md`, verbatim) told Fable to
act sequentially as six executive owners to find and fix what "would prevent me
from confidently onboarding paying clients", "thorough, skeptical, and practical",
with "authority to implement reasonable improvements. Do not stop at
recommendations or routinely ask whether to proceed." Ceiling: 3 Opus leads plus 9
Sonnet workers in one pool. Baseline `e8e7650`. Record:
`docs/rounds/2026-09-20-launch-readiness-record.md`; returns in
`docs/rounds/launch-returns/`.

| Phase | Lead return | Headline |
| --- | --- | --- |
| SEC | `sec.md` (24 commits) | Blocker F-SEC-1: a corrupt keychain item made the app mint a new key over the real one. 16 Required fixed (site 401 body echoing the token into the log, unbounded lead responses, off-origin redirects with the token, CSV formula guard, and more). |
| OPS | `ops.md` (23 commits + Fable's F-OPS-12 fix) | Blocker F-OPS-1: no recovery key, so a dead laptop killed every backup. Recovery key, "open a backup from another machine", second backup folder, pre-import backup, keychain-denial screen, newer-schema refusal, `deals.external_id` UNIQUE (migration 0005), npm and cargo audit in CI. |
| REV | `rev.md` (6 commits) | Blocker F-REV-2: a 400 from the site re-sent the same bad cursor forever. Commercial model confirmed: Helix is free, the site token is the only link to a paying client; nothing billing-related built. CL-1..CL-7, roster template. |
| CS | `cs.md` (32 commits) | Blocker F-CS-2 (= LR-6): recovery key now a persistent Today card. 13 Required (empty-state lies after import, mapper, previews, error strings). Install-day checklist. First meaningful outcome 18 actions before, 21 after. |
| PX | `px-a.md`, `px-b.md`, `px-c.md` | Built: payments as records (0006) with derived invoice status and Statement PDF; Schedule with timed visits and .ics (0007, 0009); automations, Leads by source report, bulk actions (0008). Then SEC, CS, OPS rechecks. |
| LA | `la.md`, `docs/LAUNCH-ACCEPTANCE.md` | Verdict: Ready with specific operating conditions, no blockers. J1 to J14 run against the integrated app. Added the `e2e` CI job (F-LA-1). Nine conditions, C1 to C9. |

Gate numbers at each close, by Fable, are in the record §5 (last: vitest 235
files, 2,798 passed, 3 skipped; cargo 125; LA's own e2e 202 passed).

### 2026-09-20 night: v0.2.0

Walker's first reaction to 0.2.0: pages showed stale data. Fixed the same night
(`2e035c6`): `staleTime: 0`, refetch on focus, invalidate on route change, and a
Refresh command (mod+R, View menu, palette). CI on `2e035c6` green (js, rust on
macOS and Windows, e2e, audits) and e2e-win green, so condition C4 cleared. Tag
`v0.2.0` set 22:26; `release.yml` builds the unsigned installers. Standing rule
from it: never give a Helix query a long `staleTime`. Local reads are cheap, and
stale numbers are what Walker notices first (`docs/CONTRACTS.md` "Fresh pages").

## Walker's standards, verbatim

Quoted exactly from the source named.

- "it just needs to be competent... a product that I want to use... open-source
  CRM could be cool." (`docs/PLAN.md`). Not AI-first; AI stays optional,
  bring-your-own-key, off by default, only on a button press.
- "simple but with depth is what wins" (memory `helix-crm-product.md`).
- "The design is still super sloppy use /minimalist ui - and shoot for a truly
  Apple-like design." (2026-09-18).
- "Quicker is better. Make sure branding is kept in all builds." (2026-09-19 18:05).
- "I never, ever want to deal with pull requests or merge or whatever. I never
  want to manage GitHub." (2026-09-20, memory `feedback-github-no-prs.md`).
- "Your standard is: 'This capability belongs in this CRM, solves a concrete
  problem, and now works end to end.'" (launch prompt, PX phase).
- "A completion message is not verification." / "An agent's completion message is
  not proof that the task is complete." (launch prompt, CPO prompt).
- "Do not finish with an unprioritized recommendations list." (launch prompt).
- "Do not claim launch readiness when essential checks could not be performed."
  (launch prompt, LA phase).
- "Nothing may incur cost." (CPO prompt header).
- From the brand guide via DESIGN.md §11: direct, specific, warm; never hype,
  jargon or filler. Buttons name what will happen. No exclamation marks, no
  apologies, no emoji anywhere including code comments and alt text.

Standing design rules that came out of his reviews (all in `docs/DESIGN.md` §12):
no purple or blue text; radius 0; no sticker shadow; no native date or time
inputs; no `Select` for picking a record; sidebar grouped by relation; stages in
pipeline order; every invoice tied to a deal; one primary block per view; colour
literals only in `src/styles/tokens.css`.

## How Walker works

- **He judges by using the app.** Feedback arrives after he has used a build:
  the "super sloppy" look, round 3's list, the stale pages. Expect the next
  round to start from his use of the current build.
- **He wants agents in parallel** and quick: through `/parallel-delivery`, with
  Fable coordinating and doing final QC, Opus leads and Sonnet workers.
- **He gives an outcome, not steps.** His prompts set a standard and authority
  ("do not routinely ask whether to proceed") and expect a concise final report:
  verdict, most consequential findings, what was actually verified, what is
  deferred.
- **He never manages GitHub.** Commits go straight to main; one push per
  finished round, by the director; no pull requests, branches or merges.
- **Nothing may cost him money.** Subscription models only, no paid APIs,
  GitHub Actions free on the public repo, CI artifacts failure-only.
- **He is asleep sometimes.** No app launches while he is; real-window checks
  wait for his next launch.
- **He wants the truth about state.** Claims that the app has been proven on a
  real machine, on Windows, or on a signed build are conditions, not facts
  (see 07).
- **He decides money and commercial terms.** Pricing, signing spend, and how Helix
  is offered are his (07, D-1 to D-6). Agents prepare; they do not invent terms.

## Conflicts between sources

Recorded, not resolved. Where a fact differs, both readings are listed.

| Topic | Reading A | Reading B |
| --- | --- | --- |
| Date the first look was rejected | memory `feedback-helix-apple-like-design.md` and `ORCHESTRATION.md` "Redesign": 2026-09-18 | `docs/DESIGN.md` §13 "Revision 1 (rejected, 2026-09-19)"; the Redesign agent's STATUS entry is dated 09-19 |
| Date of D16 to D22 | memory heading "DECISIONS 2026-09-20" | `ORCHESTRATION.md` "Brand guide + depth (2026-09-19)" lists D16 to D19; STATUS shows D16, D18, D19, D20 built 09-19 and D21/D22 in a 09-20 entry |
| Heading face | `MEMORY.md` index line: "Zilla Slab + Lato body (was Poppins)" | memory `helix-brand-guide.md` and DESIGN.md §4: DM Sans headings since 2026-09-20. CHANGELOG 0.2.0 still says "headings stay Zilla Slab" (stale). DESIGN.md §1 also still says Zilla Slab in prose. |
| Sticker shadow | memory `helix-brand-guide.md`: brand guide's offset sticker shadow | DESIGN.md §12 and round 3: retired, `--shadow-sticker` resolves to none. Follow DESIGN.md. |
| v0.1.0 tag | memory and round 3: published from `cca77bb` | `git rev-list v0.1.0` and the launch record: `e8e7650` (tag moved) |
| Rust test count | round 3 and CPO baseline: 49 | launch record §1 and memory: 41 (different counting) and cargo 102 to 125 through the round |
| Wording of Walker's competence quote | `docs/PLAN.md`: "a product that I want to use" | memory: "a product I want to use" |

---

Verified against: `docs/PLAN.md` (D1 to D15, lines 28 to 46, report lines 722 to
728); `docs/ORCHESTRATION.md`; `docs/rounds/2026-09-20-launch-readiness-record.md`;
`docs/rounds/2026-09-20-launch-readiness-prompt.md`;
`docs/rounds/2026-09-20-cpo-cdqo-prompt.md`; `docs/rounds/2026-09-20-cpo-cdqo-record.md`
(§1, §5, §6.1); `docs/rounds/2026-09-20-round-3.md`; `docs/rounds/launch-returns/*`;
`docs/DESIGN.md` §11 to §13; `CHANGELOG.md`; `git log` and `git tag` at `2e9fb04`
(2026-09-28); memory files `helix-crm-product.md`, `helix-brand-guide.md`,
`feedback-helix-apple-like-design.md`, `feedback-github-no-prs.md`; and the
2026-09-19 18:05 message from the session transcript (not stored in the repo).
