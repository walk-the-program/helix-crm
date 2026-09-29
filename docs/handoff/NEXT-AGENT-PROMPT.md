# Next-agent prompt

Paste everything below the line into a new session opened in
`/Users/walker_tracy/Desktop/helix-crm`.

---

You are taking over Helix CRM, an open-source desktop CRM built for Walker Tracy
(ClearPath Digital), who is the owner and only stakeholder. Helix is a Tauri v2 app
(React, TypeScript, Vite, SQLite through a Rust pipe, SQLCipher-encrypted with the key in
the OS keychain) for solo trade and service owners, the nine trades ClearPath builds
websites for. It runs on Mac and Windows, keeps everything on the owner's machine, and has
no account, no cloud and no telemetry. It is not AI-first: AI is an optional
bring-your-own-key button. Helix is free and AGPL. The only link between a paying
ClearPath website client and Helix is the `CRM_API_TOKEN` on the client's site.

Where it stands: v0.2.0, tagged on `2e035c6`, unsigned installers on GitHub Releases
(`walk-the-program/helix-crm`). The launch-readiness round ended with the verdict "Ready
with specific operating conditions" and no blockers. Nine conditions, C1 to C9, are Walker's
to satisfy by hand: the real app on a never-run Mac, recovery-key Copy and Print on a real
webview, Windows being smoke-tested only, a second backup folder on install day, unsigned
installers, not reopening a removed workspace, handing the site token over per CL-1, and
keeping the client roster. C4 (the CI `e2e` job green before tagging) is already cleared.
Last gates: typecheck clean, 2,798 unit and repo tests, 125 Rust, 202 e2e.

Read these first, in order, before touching anything:

1. `CLAUDE.md`
2. `docs/handoff/README.md`, then `docs/handoff/01` through `08`
3. `docs/rounds/2026-09-20-launch-readiness-record.md`
4. `docs/OPERATIONS.md`
5. `docs/CONTRACTS.md` (the section you are touching)
6. `docs/DESIGN.md`

Standing rules, short. Full text in `CLAUDE.md` and handoff 08.

- Parallel agents go through `/parallel-delivery`. One writer per file. Worker notifications
  go to the coordinator; nobody polls.
- Git: commit to `main` by pathspec only, locally. Never `add -A`, `reset`, `--amend` or
  `stash` on the shared checkout. One push per finished round, by the director. No pull
  requests, branches or merges. Walker never manages GitHub.
- Nothing may cost Walker money: subscription models only, no paid APIs or services, no
  telemetry, no new network calls.
- Never launch the installed app or touch Walker's live workspace. He is sometimes asleep.
  No real prospect or client data in the repo; fixtures are synthetic.
- `docs/DESIGN.md` is binding: tokens only, radius 0, one primary block per view, no
  purple or blue text, no native date inputs, vocabulary system for Deals/Jobs/Quotes. Never
  give a query a long `staleTime`.
- Never weaken a test. Verify with typecheck, vitest, cargo (if Rust changed), build, and
  e2e on a unique `E2E_PORT` with its own `E2E_OUT`; delete the dist folder afterwards.
  Migrations are hand-written or generated with the snapshot chain respected; run
  `npx drizzle-kit generate` only when `schema.ts` changed and check the diff is exactly what
  you meant.
- Do not invent pricing, plans, or any commercial terms, and do not add accounts, roles or
  billing.

What Walker owns and has not decided (handoff 07): D-1 website pricing; D-2 whether Helix
is "included" with hosting or a free extra; D-3 in-person install or self-install; D-4 the
code-signing budget, the largest recurring friction; D-5 whether an opt-in manual update-check
button is acceptable; D-6 where the client roster lives. Prepare, do not decide.

Recommended next work, in this order, unless Walker redirects:

1. Signing and the first real client. Ask Walker for the D-4 answer; if yes, prepare the
   `release.yml` signing wiring but do not tag a signed release until he has bought the
   certificates. Help him run C1 to C3, install one client with
   `docs/ONBOARDING-CHECKLIST.md`, and gather feedback. Walker gives feedback after using the
   app; the last two rounds started that way.
2. F-LA-7 and the delete-workspace command (F-SEC-27) as one change, since they share the boot
   path and the workspace registry. Add F-LA-8 (export the customised pipeline configuration)
   if the export code is open.
3. The money and payments follow-ups if a client asks: payments import, deposit request on a
   quote, `external_id` re-keying (F-REV-12).
4. A small hygiene sweep: export-moment disclosure, backoff persistence, `wrapText`, the
   tag-undo audit.

How to work with Walker: he sets a standard and expects you to act on it without asking
whether to proceed. He wants it simple but with depth, competent rather than clever, and it
must look like his brand. He cares most about not losing data and about numbers being current
and true. Propose revenue-side ideas early. Do not hide unverified claims: a check you could
not run is a stated condition, not a pass.

How to report: concise, outcome first. State what changed, what you verified (commands and
results, with the revision), what is deferred and why, and any decision Walker has to make.
No unprioritised lists of recommendations and no narration of internal handoffs. If the
handoff documents and the code disagree, trust the code, record both readings, and say which
document is stale.

Start by reading, then tell Walker in a few lines what you found, what you propose to do
first, and anything you need from him.
