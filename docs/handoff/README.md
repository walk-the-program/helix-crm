# Handoff documents

For an agent that has never seen this repository. Written 2026-09-28 at `2e9fb04`
(v0.2.0, tag on `2e035c6`). Start with `/CLAUDE.md` at the repo root, then read these in
order. They summarise and point at the primary sources; when a document and the code
disagree, the code wins, and the document is stale.

| # | Document | Read it for |
| --- | --- | --- |
| 01 | [01-product-overview.md](01-product-overview.md) | What Helix is, who it is for, what it does, what it deliberately does not do. |
| 02 | [02-architecture.md](02-architecture.md) | How it is built: Tauri shell, Rust pipe, data layer, feature modules, encryption, the site lead endpoint. |
| 03 | [03-features-and-data-model.md](03-features-and-data-model.md) | The features screen by screen and the tables behind them, including the money model. |
| 04 | [04-testing-ci-and-verification.md](04-testing-ci-and-verification.md) | The four test suites, CI jobs, the release checklist, and the verification bar. |
| 05 | [05-history-and-direction.md](05-history-and-direction.md) | The timeline from the 2026-09-18 CEO review to v0.2.0, what Walker decided, his verbatim standards, how he works. |
| 06 | [06-operations-release-and-support.md](06-operations-release-and-support.md) | Releasing, install day, the 13 procedures, the commercial lifecycle, the support model, conditions C1 to C9. |
| 07 | [07-open-decisions-and-roadmap.md](07-open-decisions-and-roadmap.md) | Walker's open decisions D-1 to D-6, deferred items with finding ids, the later and rejected lists, the recommended next order. |
| 08 | [08-agent-working-rules.md](08-agent-working-rules.md) | The exact rules every agent follows: parallel work, git, cost, data, design, tests, records. |
| | [NEXT-AGENT-PROMPT.md](NEXT-AGENT-PROMPT.md) | A single prompt Walker can paste to start the next session. |

## Where the primary sources are

| Need | File |
| --- | --- |
| Launch verdict, conditions, decisions LR-1 to LR-6, PX-1 to PX-6 | `docs/rounds/2026-09-20-launch-readiness-record.md` |
| Per-phase findings and evidence | `docs/rounds/launch-returns/{sec,ops,rev,cs,px-a,px-b,px-c,la}.md` |
| Launch acceptance matrix | `docs/LAUNCH-ACCEPTANCE.md` |
| Walker's prompts, verbatim | `docs/rounds/2026-09-20-launch-readiness-prompt.md`, `docs/rounds/2026-09-20-cpo-cdqo-prompt.md` |
| Product and design review pass | `docs/rounds/2026-09-20-cpo-cdqo-record.md`, `docs/rounds/cpo-returns/` |
| The round-3 plan (Walker's first-use feedback) | `docs/rounds/2026-09-20-round-3.md` |
| Original plan, decisions D1 to D15 | `docs/PLAN.md` |
| Incident procedures and commercial lifecycle | `docs/OPERATIONS.md` |
| Install day, client roster | `docs/ONBOARDING-CHECKLIST.md`, `docs/CLIENT-ROSTER-TEMPLATE.md` |
| By-hand release checks | `tests/RELEASE-CHECKLIST.md` |
| Binding interfaces | `docs/CONTRACTS.md` |
| Binding design contract | `docs/DESIGN.md` |
| Build log (append-only, search it) | `docs/STATUS.md`, `docs/ORCHESTRATION.md` |
| What shipped | `CHANGELOG.md` |

## Known stale lines (not fixed by this handoff set)

Recorded in detail in 05 and 06. In short: `CHANGELOG.md` 0.2.0 still says "headings stay
Zilla Slab" (DM Sans since 2026-09-20); `docs/OPERATIONS.md` inventory item 1 says the
versions read `0.1.0` and its "Cut and ship" step 2 omits the `e2e` job;
`tests/RELEASE-CHECKLIST.md` says the `e2e` job has not run yet (it passed on `2e035c6`);
the memory index line for the brand guide still names Zilla Slab.
