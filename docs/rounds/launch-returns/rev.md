# LR-REV return — Chief Revenue Operations Officer

**TASK / ATTEMPT / REV:** LR-REV / attempt 1 / packet rev 1
**Parent:** Fable (coordinator). **Base:** `d376382` on main. **Head:** `ab8eb4a`.
**Children:** 2 Sonnet workers, both read-only investigation (LR-REV-W1 failure-path
trace, LR-REV-W2 claims-and-effort audit). Neither wrote a file; both returns were
checked against the code by the lead before anything here was written.

**STATUS: submitted.** 11 findings, 1 Blocker-class, 7 Required, 3 Follow-up. Every
Blocker and Required is fixed with a test. No billing, licensing, entitlement check or
update check was built. No spending, no network call, no customer contact.

---

## 0. What this phase had to prove

That the commercial lifecycle is coherent, accurate and manageable — for a product
with no commerce in it.

Helix is free and AGPL. There is no Helix price, plan, trial, subscription, billing
code or entitlement, and the packet forbade inventing one. What ClearPath sells is the
**website**; its pricing is unsettled and is Walker's decision, not this round's
(`ClearPath Sites/FOR-THE-NEXT-AGENT.md`, 2026-09-16 note). The only thing connecting
a paying client to Helix is the `CRM_API_TOKEN` on their site, which they paste into
Settings → Website.

So "trace sale → provisioning → entitlement → billing → renewal → access change →
data disposition" becomes: **trace the lifecycle of one string.** That is what this
phase reviewed, and where every finding came from. The prompt's own list of billing
failure cases maps onto it exactly: "payment succeeded but provisioning failed"
becomes "the site is live but Helix gets nothing", which turned out to have four
distinct causes the product reported as one wrong cause.

**Not applicable, by design** (and nothing was built for any of them): trial/active/
overdue/cancelled account states, an authoritative source of billing state,
entitlement checks, payment failures, duplicate or out-of-order webhooks, upgrades,
downgrades, refunds, reactivation, manual entitlement overrides, sandbox payment
testing. Reason in every case: no account, no server, no payment path, no state to
drift. See §5, F-REV-E.

---

## 1. Findings

`F-REV-n` | class | finding | why that class | fix | evidence.

| # | class | finding | why that class | fix commit |
|---|---|---|---|---|
| **F-REV-1** | **Required** | A site deployed without the lead endpoint answers **404**, and Helix reported it as "Helix cannot reach your website" — then backed off silently for two tries. The owner was told his internet was down; the actual fix is on ClearPath's side and no amount of waiting or restarting helps. This is the "provisioning failed" case, and it is the single likeliest thing to go wrong on a real install day, because a site built from a pre-2026-09-18 template has no CRM block at all. | Required, not Blocker: leads are not lost (the site keeps them; the cursor never moves on a failure), but the owner and Walker are both sent to the wrong problem on day one, which is exactly what "essential to delivering the promised service" means. | `8ec6a0f` |
| **F-REV-2** | **Blocker** | A **400** from the site is, by contract, exactly one thing: the `after` marker Helix sent could not be decoded. Helix treated it as a generic network failure, so every subsequent poll re-sent the same unreadable marker, forever, at the 8-minute ceiling, under the message "Helix cannot reach your website". **This state was unrecoverable inside the app** — it survived a disconnect and reconnect, because `disconnectSite()` deliberately keeps the `lead_sync` row. The only exit was editing the encrypted database. | Blocker: lead sync stops permanently and silently, with a message that names the wrong cause and no owner-reachable recovery. That is a core-workflow failure on a paying client's machine with no way out. Low probability, unbounded consequence. | `8ec6a0f` |
| **F-REV-3** | **Required** | **Test connection tested the wrong token.** It goes through `leads_fetch`, which reads the *saved* address and the *saved* token out of the keychain — it cannot see the boxes. So the owner in the middle of a rotation, who had just pasted the new token and pressed the button the screen offers for exactly this moment, was told whether the *old* token worked. A pass meant nothing and a fail meant nothing. | Required: the one verification affordance in the connect flow returned an answer about something other than what the owner was verifying. Rotation (procedure CL-2) depends on it. | `6531158` |
| **F-REV-4** | **Required** | Settings → Website printed `lead_sync.last_error` verbatim, so a solo tradesman whose token had been rotated read **"LeadPollAuthError: HTTP 401"** in red on his own screen, two inches below a perfectly good plain-English banner. | Required: it is the client-facing surface of the most common lifecycle event, and it reads as a crash. The stored form is right for Diagnostics (SEC/support read it raw) — the screen was the wrong place to show it. | `6531158` |
| **F-REV-5** | **Required** | **A site that is gone forever is indistinguishable from a site that is down.** When a client stops paying and Walker takes the site down, the poll backs off to 8 minutes and retries until the end of time, telling the owner "Helix keeps trying on its own" and never once suggesting he could stop. There was no concept of giving up and no prompt to disconnect. | Required: this is the *normal* end state of a churned client, and the product had no answer for it. Not a Blocker — nothing breaks and no data is at risk — but an owner staring at a permanent warning about a website that no longer exists is not a supportable state. | `8ec6a0f` |
| **F-REV-6** | **Required** | If the keychain refuses between the connection check and the request, `leads_fetch` rejects with `SECRET_ERROR` and Helix said "Helix cannot reach your website" — sending the owner to his router when the problem is a permission prompt on his own Mac. | Required: OPS procedure 9 covers the *boot-time* denial and gave it its own screen; the runtime path had no such handling and actively misdirected. | `8ec6a0f` |
| **F-REV-7** | Follow-up (fixed) | Test connection's success message said "The oldest lead waiting is from …". It asks for one lead from the beginning, so what comes back is the site's oldest lead, which is almost always one Helix imported months ago. "Waiting" read as though leads were stuck. | Follow-up by consequence (a confusing sentence), fixed because it was three words. | `6531158` |
| **F-REV-8** | **Required** | **The token paste.** A token is handed over in a message, so what lands in the box is routinely the whole environment line (`CRM_API_TOKEN=abc…`), the value in quotes, or a value a mail client wrapped across two lines. All three were stored verbatim and then rejected by the site as a wrong token — sending owner and Walker hunting a rotation that never happened. The literal `replace-with-a-long-random-string` placeholder that ships in all eighteen templates' `.env.example` was also accepted and then 401'd forever. Separately, a refused token left the *address* saved, because the origin was written before the token was validated. | Required: every one of these produces a 401 whose real cause is invisible from both ends, on install day, on the one step that connects the client to the product. | `6531158` |
| **F-REV-9** | Follow-up (fixed) | The Disconnect mutation had no error handler. A keychain that refused the delete left the dialog sitting there saying nothing. | Follow-up: rare, and nothing is lost. Fixed because it is four lines. | `6531158` |
| **F-REV-10** | **Required** | The model picker claimed Opus "costs about two and a half times Sonnet" — a numeric claim about Anthropic's list prices that this repository cannot back and that is wrong the day Anthropic changes them. The packet explicitly forbids claiming call costs with numbers we cannot back. Separately, no copy anywhere stated plainly that **Anthropic bills the client directly**; the closest was "paid for with your own Anthropic key", which a solo owner can read as "included". | Required before paid onboarding: a cost claim a client can act on, that ClearPath cannot stand behind, on the one feature that costs the client real money. | `c1345ae` |
| **F-REV-11** | **Required** | **Changing the site address duplicated the client's entire pipeline.** A lead's identity is `<normalised origin>:<lead id>` (`leadMapping.externalIdFor`) and `lead_sync` is keyed on the origin, so a new address is, to everything downstream, a new website: the cursor resets to null, the site re-sends its whole history, every lead arrives with an `external_id` Helix has never seen, and every one becomes a second contact and a second deal. The changes that trigger it are the ordinary ones — staging to live, apex to www. | Required: silent, large-scale data corruption of the client's working pipeline, from a two-word edit in a text box, with no warning. Not a Blocker only because it is fully recoverable through the existing Duplicates/merge flow (reversible for 30 days) and nothing is destroyed. | `6531158` |

### Checked, no issue — with the hostile case actually run

- **Token entropy.** `openssl rand -base64 32` — 256 bits, 44 characters — is what every template's `.env.example` documents and the only generator in the process. Compared on the site side through SHA-256 digests into `timingSafeEqual` (length-safe by construction), rate-limited at 60/min keyed on the *presented* token before the auth check, so a wrong token is throttled too.
- **Cursor semantics across a rotation.** The 401 branch never calls `saveCursor`, so the cursor from the last successful page survives the outage; `refresh()` → `tick()` → `leadSync.ensure()` returns the existing row. The new token resumes exactly where the old one stopped. **No lead is lost and none is re-read.** Now asserted, where before it was only true.
- **The 401 body.** Rust withholds it for 401/403 specifically because rejection bodies echo credentials (`sec.md` F-SEC-6). Re-verified end to end at the commercial layer: a 401 whose body contains the token reaches neither `lead_sync.last_error` nor the screen.
- **Origin validation.** HTTPS anywhere, plain HTTP only on loopback, enforced in Rust and restated in the UI with the reason. An HTTP-only staging site cannot be connected, by design. Redirects are never followed, so the token cannot be walked off-origin.
- **Disconnect really disconnects.** The token is deleted from the keychain (not hidden), the address is nulled, the timer is cleared, and the poller refuses to run. Asserted against the keychain stub, not inferred.
- **Reconnecting the same site does not re-import history.** `lead_sync` survives a disconnect on purpose; asserted.

---

## 2. Lifecycle state table

Nine states. Every owner-facing string comes from one module
(`src/features/leads/lib/pollMessages.ts`), so the Settings banner, Today's quiet line
and the "Last result" row cannot drift apart from each other or from
`docs/OPERATIONS.md`. Full table with the verbatim strings: **OPERATIONS.md,
"Commercial lifecycle", "What the owner sees in every state"**. Summary:

| State | Owner-facing headline | Helix's behaviour | Walker's procedure | Test |
|---|---|---|---|---|
| Connected | "Everything came through." | 5-min poll while open | — | lifecycle state 1 |
| Token rotated (401/403) | "Your website turned the connection down. Check the token." | Timer **stops** until the settings change | CL-2 | lifecycle state 2 (×3) |
| No endpoint (404) | "Your website is not set up to send leads yet." | Retries so it self-heals; banner at once | CL-3 A | lifecycle state 3 (×2), e2e |
| Unreadable marker (400) | "Your website could not read where Helix left off." | Drops the cursor, restarts from lead 1 | CL-3 D | lifecycle state 3b (×2) |
| Site error (5xx, 429) | "Your website answered with an error (503)." | Backs off; banner at once | CL-3 C | lifecycle state 4 |
| Site down (no answer) | Silent ×2, then "Helix cannot reach your website." | Backs off 1/2/4/8, holds at 8 | — | lifecycle state 4 |
| Site gone forever | + "If the site is gone for good, you can disconnect it below. Every lead already in Helix stays." (from failure 12) | Same; never gives up, never deletes | CL-5 | lifecycle state 6 (×2) |
| Address changed | "This address is: the same website at a new address / a different website" | Carries the cursor, or starts fresh | CL-4 | lifecycle state 3c (×3) |
| Disconnected | "Not connected" | Token deleted, timer off, **every record kept** | — | lifecycle state 5 (×2), e2e |

---

## 3. Per-client effort table

Minutes are the lead's estimate from the actual step lists (sourced by LR-REV-W2 from
README, `docs/OPERATIONS.md`, `tests/RELEASE-CHECKLIST.md` and
`src/features/onboarding/**`); the *steps* are evidenced, the *minutes* are judgement
and are marked as such. "Who" is who spends the time.

| Event | Frequency | Steps | Minutes | Who |
|---|---|---|---|---|
| **Install day** | Once per client | Download installer; right-click → Open past Gatekeeper (or SmartScreen "Run anyway"); allow the Keychain prompt; onboarding screen 1 (business name, trade, owner email and phone); screen 2 (apply the trade preset); screen 3 (choose how customers come in); **show and save the recovery key** (Settings → Backups — *not* in onboarding today); **choose the second backup folder** (Settings → Backups); paste site address + token and Save; Test connection; run the CSV import and review the mapping | **45–75** | Walker, with the client |
| — of which the CSV import alone | | File pick, column mapping review, duplicate-handling choice, commit, review the result | 15–30 | Walker |
| **Each Helix release** | Per release, per client | Walker tells the client (no auto-update, no in-app notice); client downloads; reinstalls; Gatekeeper/SmartScreen warning again; **Keychain prompt returns** (unsigned builds change identity every rebuild) | **10–15** per client, plus Walker's one-off release run (version sync, CI check, full checklist on both OSes, CHANGELOG, tag, publish the draft) of **60–120** | Walker + client |
| **Token rotation** | As needed | Site: set the variable, redeploy, two `curl` checks; hand over; client pastes and saves; confirm the banner cleared | **10–20** | Walker + client |
| **One support contact** | Unpredictable | Client calls; Walker asks what the banner and "Last result" say (usually enough — the state table maps both to a fix); if not, client opens Diagnostics → Copy log → pastes into an email; Walker reads it | **10–30** | Walker + client |
| **Offboarding** | Once per churned client | Rotate or remove the token / take the site down; tell the client what they keep; point at Disconnect; update the roster | **10–15** | Walker |
| **Roster upkeep** | Continuous | One row per client, updated at install, each confirmed update, each rotation, each contact, offboarding | **2–5** per event | Walker |

**Steps a product change could remove** (all judged here, none built — the packet
forbids an update check, and two of these are deliberate design):

| Step | Removed by | Verdict |
|---|---|---|
| Gatekeeper/SmartScreen warning, every install and every update | Code signing + notarization | A spending decision (TODO E5). The single largest recurring friction, and it is bought, not coded. |
| Keychain prompt returning on every update | The same signing fix — keychain access is tied to the signing identity | Same decision. These two are one purchase. |
| Recovery key never saved | Surface it in onboarding | Already decided (**LR-6**) and assigned to the CS phase; **confirmed not implemented at this revision**. Until it is, this is a manual install-day step Walker must remember, and a client who skips it has no recovery. |
| Second backup folder never chosen | Prompt during onboarding, or detect an existing iCloud/Dropbox/OneDrive folder | Local only, no network call. Recommend to CS alongside LR-6. |
| **Walker telling each client a release exists** | An in-app update check | **Judged and recorded as a decision for Walker, not built** (D-5 below). It requires a new outbound call to GitHub on every launch. Even opt-in and off by default, it is the first network call Helix makes that the owner did not ask for, and "no telemetry, no update ping" is a stated product promise (`CHANGELOG.md` "Not in v1", `docs/DESIGN.md` §2.10). The honest reading: an *opt-in, off-by-default, manual* "Check for a new version" **button** in Settings → About would remove most of the pain with no background call at all, and is the version worth building — but it is still a change to a promise, so it is Walker's to make. |
| Client manually sending helix.log | Crash/error reporting | **Reject.** This is telemetry wearing a different hat, on a product whose clients' customer lists are the asset. |
| Client manually pasting a rotated token | Helix fetching its own token | **Reject.** It would mean Helix calling out to retrieve a secret, against the whole write-only-token design. |

---

## 4. Decisions for Walker

Each with what is already prepared, so a decision costs nothing but the decision.

| # | Decision | What is prepared | What is blocked until he answers |
|---|---|---|---|
| **D-1** | **Website pricing.** Unsettled on record: ~$1,000 build with monthly hosting unpriced; an earlier $500 + $75–100/mo; a $250/mo AI cohort; "$2K" as what a signature site must justify (`FOR-THE-NEXT-AGENT.md`, 2026-09-16). | Nothing in this repo depends on it, and nothing was invented. The per-client effort table above is the cost side of that arithmetic. | Nothing technical. Only the conversation with the first client. |
| **D-2** | **Is Helix "included" in hosting, or a free extra?** These read very differently to a client, and they create different expectations about support. | Every claim in README and Help now says Helix is free and AGPL, and says what the client keeps when the website ends. Neither framing is contradicted by the product. | The words Walker uses on a call. If he says "included", he should expect support expectations to follow the website's monthly fee. |
| **D-3** | **Does Walker install Helix in person, or does the client self-install?** | Both paths work. The procedures assume in-person as the default, because it is the only hand-over where the token never travels (CL-1), and because the recovery key and second backup folder are install-day steps a self-installing client will skip (LR-6 is not implemented). | The effort table's install-day row: 45–75 minutes of Walker's time per client, or a self-install with a real chance of no recovery key. |
| **D-4** | **Code-signing budget** (Apple Developer Program, and the Windows equivalent). | Nothing to build; it is a purchase plus a CI change. | Removes the Gatekeeper/SmartScreen warning *and* the returning Keychain prompt — the two largest recurring frictions, at every install and every update, for every client, forever. Escalated by SEC as well. |
| **D-5** | **Is an opt-in update check acceptable?** | Judged, not built. See §3. The defensible version is a **manual button** in Settings, off until pressed, that calls GitHub's releases endpoint once — no background call, no launch ping, nothing automatic. | Today a client can sit on a fixed bug forever and nothing will tell them. This is founder-task inventory item 4, with "nothing catches this today, by design" against it. |
| **D-6** | **Where the client roster lives, and who keeps it.** | The blank template is committed (`docs/CLIENT-ROSTER-TEMPLATE.md`) with a recommended path outside this public repo. | Nothing, if he keeps it. Everything about account-state visibility, if he does not — there is no other record anywhere. |

---

## 5. What does not apply, and why

| # | Item from the prompt | Verdict |
|---|---|---|
| F-REV-A | Trial / active / overdue / cancelled account states | Not applicable. No account object exists in the app, in any database table, or in `helix.json`. Nothing was built. |
| F-REV-B | The authoritative source for billing state and entitlements | Not applicable. There is no entitlement. The nearest thing is the token on the site, and the site's environment is its authoritative source. |
| F-REV-C | Payment failures, duplicate events, delayed or out-of-order webhooks | Not applicable. No payment path and no inbound webhook. Helix polls; nothing ever calls it. |
| F-REV-D | Upgrades, downgrades, cancellations, refunds, reactivation | Not applicable. Nothing to up- or downgrade — every install has every feature. |
| **F-REV-E** | **"Billing changed but access did not"** | **Cannot happen, and this is stated rather than assumed.** There is no access to change. Nothing is unlocked, nothing expires, no ClearPath action reaches inside a client's Helix. Written into OPERATIONS.md's "Commercial lifecycle" preamble so it does not get re-litigated. |
| **F-REV-F** | **The reverse: does a ClearPath action lose client data?** | **No, and it is proved, not asserted.** `tests/repo/leads/lifecycle.test.ts` counts deals before and after a disconnect, after twelve consecutive failures, and after the site is gone: identical every time. The token lives in the OS keychain, the data in a SQLCipher file whose key is in that same keychain, on the client's machine. Walker has no path to either. |
| F-REV-G | Manual overrides and their auditability | Not applicable in-app. The one manual lever is the site's environment variable; its audit trail is the roster (CL-6) and the site's own deploy history. |
| F-REV-H | Sandbox payment testing | Not applicable. No payment facility to test. **No real charge, refund or customer message was initiated.** |
| F-REV-I | Reconciliation between clients, invoices, payments and enabled service | Not applicable inside Helix (the invoices feature is the *client's* invoicing of *their* customers, not ClearPath's of them). The ClearPath-side reconciliation is the roster against the site list. |

### Follow-ups, with reasons

| # | class | finding | why not now |
|---|---|---|---|
| F-REV-12 | Follow-up | **CL-4's re-keying gap.** Choosing "the same website at a new address" carries the cursor forward, which prevents the duplication — but it does not rewrite the `external_id` of leads already on file. If the site ever re-sent a lead from before the cursor, it would still arrive as new. | The complete fix is a migration that rewrites the origin prefix of every `deals.external_id` for that workspace, under the partial UNIQUE index added in `drizzle/0005`. That deserves its own verified pass with a real before/after workspace; the carry-the-cursor fix closes the path that actually occurs. Recommend before the first client who moves domain. |
| F-REV-13 | Follow-up | **`tests/RELEASE-CHECKLIST.md` lines 57–60 are stale**: they state first launch shows "an empty Today screen with three starter cards … no setup wizard", which contradicts the shipped three-screen onboarding (`src/features/onboarding/gate.ts`, `OnboardingFlow.tsx`, and README's own description). Found by LR-REV-W2 while sourcing the install-day step list. | Not mine to edit: the release checklist is OPS's file and OPS is closed. It is a factual error in a document Walker runs by hand on release day, so it is handed to CS/LA rather than left implicit. |
| F-REV-14 | Follow-up | **LR-6 (recovery key surfaced in onboarding) is not implemented at this revision.** Confirmed by reading `OnboardingFlow.tsx` and its three screens: nothing references `RecoveryKeyPanel`. | Already assigned to the CS phase by decision LR-6. Restated here because it lands directly on this phase's install-day effort row: until it ships, saving the recovery key is a step that only happens if Walker remembers it in front of the client, and F-OPS-1's fix is optional in practice. |

---

## 6. Acceptance

**C1 — findings with class and reason; Blocker/Required fixed with tests.** Pass.
11 findings in §1, each with its class and the reason for that class. The one
Blocker (F-REV-2) and all seven Required are fixed, each with a test that fails on
the old behaviour. Three Follow-ups are recorded with reasons in §5, none of them
silently dropped.

**C2 — every lifecycle state has a tested owner-facing message and a written
Walker-side procedure.** Pass. Nine states (the six required, plus the unreadable
marker, the address change and the keychain refusal) in §2. Each has a verbatim
string pinned by `tests/unit/leads/pollMessages.test.ts`, behaviour driven through
the real poller in `tests/repo/leads/lifecycle.test.ts`, and a procedure in
OPERATIONS.md "Commercial lifecycle" (CL-1…CL-7). Three states are also exercised
through the real screen in `tests/e2e-mac/specs/leads.e2e.ts`.

**C3 — roster procedure and blank template committed, no real data.** Pass.
`docs/CLIENT-ROSTER-TEMPLATE.md` (blank; nineteen columns, each justified) plus
procedure CL-6. Recommended home:
`/Users/walker_tracy/Desktop/ClearPath Sites/HELIX-CLIENT-ROSTER.md` — verified not
to be a git repository at its top level, so it cannot be pushed. Four things are
named as never going in it: the token value, a recovery key, the client's Anthropic
key, any client CRM data. **No real client name, domain, token or email was copied
into this repository**, from ClearPath Sites or anywhere else.

**C4 — per-client effort table.** Pass. §3: event → steps → minutes → who, plus the
removable-steps table with the network-call judgement on each.

**C5 — decisions list for Walker.** Pass. §4: six decisions, each with what is
already prepared and what is blocked. Nothing consequential was decided on his behalf.

**C6 — gates.** Pass. §7.

---

## 7. Verification

All at `ab8eb4a`, on this machine, macOS. Walker's live workspace was never touched;
the installed app was never launched; no server was left running.

```
npm run typecheck                 clean, exit 0
npx vitest run                    180 passed | 1 skipped (181 files)
                                  2325 passed | 3 skipped | 0 failed
                                  (baseline 2285 + 40 new: 13 pollMessages,
                                   9 siteToken, 17 lifecycle, +1 split test)
cd src-tauri && cargo test        85 + 8 + 10 + 11 + 9 = 123 passed, 0 failed
                                  (unchanged from the OPS baseline; no Rust
                                   was edited this phase)
npm run build                     tsc clean, built in 869ms, exit 0
                                  (only the pre-existing chunking advisories)
E2E_PORT=4280 E2E_OUT=dist-rev npx playwright test \
  -c tests/e2e-mac/playwright.config.ts leads settings
                                  40 passed, 0 failed
git status --porcelain            clean
```

`dist-rev` and `tests/e2e-mac/.cache/results-dist-rev` were removed after the run.

**Tests changed rather than added, both preserving their subject:**

1. `tests/unit/leads/pollerLogRedaction.test.ts` — "still logs the status and the
   failure count for a non-auth failure" injected an HTTP 500, which is now a
   `LeadPollSiteError` rather than a `LeadPollNetworkError`. **Split into two tests**
   rather than relaxed: one asserts a site failure logs its status *and not the
   body*, the other asserts a no-status failure logs the failure count *and not the
   transport detail*. The subject — the log carries enough to act on and no
   third-party text — is asserted more completely than before, not less.
2. `tests/e2e-mac/specs/leads.e2e.ts` F-LB-1 — asserted the malformed-page failure
   surfaced as "has not been able to reach your website". A malformed page is now
   classified as the site's problem and speaks in the shape error's own words. The
   assertion's subject ("a malformed page is a failure, not a success") is untouched
   and still asserted; only the string encoding the *less accurate* classification
   changed, with a comment saying why. The F-LB-6 test was **not** touched: it still
   asserts `/HTTP 401/` reaches the screen (now in the muted detail line) and that
   the stored value is exactly `LeadPollAuthError: HTTP 401`.

**Three fixes were mutation-checked rather than assumed.** Each was confirmed to fail
on the pre-fix behaviour before the fix was kept:

- **F-REV-2 (the 400 loop).** Cursor reset deleted from `recordFailure`: "drops the
  cursor once so the poll is not stuck on it forever" fails with
  `AssertionError: expected 'a-cursor-the-site-cannot-read' to be null`. That is the
  unrecoverable state, reproduced on demand.
- **F-REV-11 (the address change).** `carryCursorFrom` ignored in `saveSiteOrigin`:
  "carries the place-in-the-list over, so no lead arrives twice" fails with
  `AssertionError: expected null to be 'cursor-after-901'` — the new address re-reads
  from the first lead, which is the duplication path.
- **F-REV-1/F-REV-6 (classification).** `classifyPollFailure` reverted to the old
  auth-or-network split: **6 tests fail** across the two files — the three
  classification tests, plus "says the site is not set up yet instead of blaming the
  connection" (404), "drops the cursor once…" (400) and "a site having a bad day is
  reported as the site's error, at once" (5xx).

Each mutation was reverted immediately and the suite re-run green
(`tests/unit/leads` + `tests/repo/leads`, 253 passed) before the next one.

**Not verified, and honestly so:** nothing in this phase ran against a real ClearPath
site, a real network, a real keychain or a real installed build. Every site-side step
in CL-1…CL-5 is marked **needs access** in OPERATIONS.md. The state table's Helix half
is tested; its site half is not.

---

## 8. Deviations

1. **The packet listed six lifecycle states for C2; this return delivers nine.** The
   extra three (unreadable marker, address change, keychain refusal) were found while
   tracing the six and each produced a Required-or-worse finding, so excluding them to
   match the packet's count would have been reporting a narrower product than exists.
2. **F-REV-11 (the address change) was not in the packet's review list**; it surfaced
   from the packet's "site domain changed" line in item 3, which I expected to be a
   documentation answer and which turned out to be data corruption. Scope was widened
   by one fix and three tests.
3. **`src/features/ai/**` was edited** — two copy strings — although the packet's
   ownership line named `src/features/leads`, the settings website section and help
   content. Review item 7 required judging the AI cost claim, and the claim lives in
   `models.ts` and `AiSettingsScreen.tsx`. Flagged because AI is not obviously this
   phase's area. No behaviour was changed; both edits are strings.
4. **Help's website section was rewritten rather than extended.** Its own test caps
   every section at six sentences and the file at exactly six sections, and the
   section was already at six. Rather than weaken either rule, the section was
   recomposed to carry the failure causes and the what-you-keep promise inside the
   same budget. Nothing was dropped: the Reports sentence, the token-storage sentence
   and the polling-schedule sentence all survive.
5. **Two Sonnet workers were used, both read-only.** Neither wrote a file; both
   returns were re-checked against the code by the lead before anything was written
   from them. Both flagged `docs/CLIENT-ROSTER-TEMPLATE.md` as an unexpected untracked
   file in their `git status` — that was the lead's own work in progress in the shared
   checkout, not a stray.

---

## 9. Escalations

1. **D-4, code signing, is a spending decision** and is now escalated by two phases
   (SEC's §8 and this one's §3/§4). It is the largest single reduction in recurring
   per-client effort available, and it cannot be coded around.
2. **D-5, the opt-in update check**, needs Walker's answer because it touches a stated
   promise. Nothing was built. The recommended shape (a manual button, no background
   call) is in §3.
3. **F-REV-13**: `tests/RELEASE-CHECKLIST.md` lines 57–60 are factually wrong about
   first launch. OPS owns that file and is closed; handed to CS/LA.
4. **F-REV-14**: LR-6 is not implemented, and it lands on this phase's install-day
   effort. Confirmed with CS's phase in mind, not fixed here.
5. **No CONTRACTS.md change was needed.** The site endpoint contract is unchanged —
   this phase changed how Helix *reacts* to the statuses that contract already
   defines, not the contract.

---

## 10. Handoff

**Nothing running.** No servers, no background processes, no `tools/fake-site`
instance. `dist-rev` and its Playwright cache removed. Working tree clean.

**Five commits, local on `main`, nothing pushed** (Fable pushes):

| commit | what |
|---|---|
| `8ec6a0f` | `fix(leads)` — six failure kinds, one copy module, the 400 cursor reset |
| `6531158` | `fix(settings)` — Test connection honesty, readable errors, token cleaning, the address-change question |
| `13d271b` | `test(leads)` — the lifecycle suite and four new e2e tests |
| `c1345ae` | `docs(copy)` — the AI cost claim, who pays, what a client keeps |
| `ab8eb4a` | `docs(ops)` — the Commercial lifecycle section and the roster template |

**For CS (next phase):**
- LR-6 is genuinely not implemented; it is now also an effort-table line item (F-REV-14).
- The onboarding flow is where the recovery key and the second backup folder should
  be prompted; both are install-day steps today that only happen if Walker remembers.
- Help's six-section, six-sentence budget is fully spent on the website section. Any
  further website guidance needs a different home, or a decision to change that rule.
- `docs/CLIENT-ROSTER-TEMPLATE.md` is the internal onboarding checklist's natural
  companion; CS's checklist should say "fill the roster row" as a step.

**For LA:** the nine-state table in OPERATIONS.md is the acceptance matrix for the
"integration and commercial states" row of the launch matrix. Every row has a test
name against it. The site half of each state has never been exercised against a real
ClearPath site — that is the one commercial check this phase could not perform.
