# Helix CRM: design research

Written 2026-09-18 by the design agent, before any comp was drawn. Everything in
`docs/DESIGN.md` traces back to something here.

## 1. Who is on the other side of the screen

A solo owner, 40 to 65, running a landscaping crew, a dental office, a med spa, a
plumbing van, a wedding venue, a gym, a church office or a restaurant. He is on a laptop
in a truck cab or at a kitchen table, often at 6:40 in the morning or 8:30 at night. He
is frequently a two-finger typist. The software he already trusts is QuickBooks, Gmail,
and his bank's app. He did not buy a CRM because he wanted a CRM.

The two sentences that govern every screen, from `docs/PLAN.md`:

> He wants to **not lose a lead** and to **remember what he promised**.

### What he scans for

In order, every time he opens the app: **a customer's name**, **a dollar amount**, **what
is due**, **a phone number**. Nothing else earns large type.

### What the evidence says about his eyes and hands

- Presbyopia affects nearly everyone over 50, so a 16 px body minimum is a floor rather
  than a goal, and 18 px is more comfortable for sustained reading.
  ([UX Collective](https://uxdesign.cc/designing-for-older-audiences-checklist-best-practices-b6ca3ec5bcbf),
  [Toptal](https://www.toptal.com/designers/ui/ui-design-for-older-adults))
- WCAG 2.2 requires 4.5:1 for body text and 3:1 for large text and interactive elements;
  Nielsen Norman Group's work on older readers suggests 7:1 or better is materially
  easier for them. ([Toptal](https://www.toptal.com/designers/ui/ui-design-for-older-adults),
  [Kittl](https://www.kittl.com/blogs/mobile-first-typography-wcag-standards-fnt/))
- **Blue fades with age.** The lens yellows and absorbs short wavelengths, so pale blues
  lose apparent contrast for this exact age band.
  ([Adchitects](https://adchitects.co/blog/guide-to-interface-design-for-older-adults),
  [Digital Scientists](https://digitalscientists.com/blog/ux-design-for-seniors-5-tips-2/))
  This is a direct argument against the default SaaS pale-blue accent.
- Line height of at least 1.5× the font size for body text is a WCAG expectation, not a
  stylistic preference. ([Kittl](https://www.kittl.com/blogs/mobile-first-typography-wcag-standards-fnt/))

### What the evidence says about why he would quit

- Poor user adoption is the leading cause of CRM failure, ahead of every technical cause,
  and 20 to 70 per cent of CRM projects miss expectations.
  ([Gain.io](https://gain.io/blog/crm-adoption-challenges-why-sales-teams-fail-to-use-their-crm-and-how-to-fix-it),
  [Sky Soft](https://www.skysoftconnections.com/crm-adoption-failure-why-employees-stop-using-crm/))
- **36 per cent abandon over complexity**; 23 per cent name manual data entry as the
  main obstacle; 42 per cent of SMEs say they lack the skills or training to implement
  one. ([CRM.org](https://crm.org/crmland/crm-statistics),
  [Kick ICT](https://www.kickict.co.uk/news-and-blogs/why-many-crms-fail-to-deliver-full-value-for-smes/),
  [Digital Socius](https://digitalsocius.co.uk/101-crm-statistics-for-businesses-in-2025-adoption-roi-market-trends/))
- `docs/PLAN.md` records the same shape from the other side: one in three small
  businesses drop their CRM within a year and most use under half the features.

The design consequence: **every pixel of chrome is a tax on a person who is already
looking for a reason to stop.** Empty space is not the enemy; unexplained controls are.

### What the software he trusts actually does

Reviews of the tools this audience already pays for — Jobber, Housecall Pro,
ServiceTitan, QuickBooks — agree on the same short list: an interface a non-technical
owner can run with minimal training, a short learning curve, straightforward workflows,
and no complex setup. Jobber is repeatedly described as winning on simplicity and price
for solo operators; Housecall Pro's headline value is that it syncs with QuickBooks,
which is to say: it fits the tool he already trusts rather than replacing it.
([ServiceTitan](https://www.servicetitan.com/blog/job-management-software-for-tradies),
[Jobber comparison](https://www.getjobber.com/comparison/housecall-pro-vs-quickbooks/),
[FieldPulse](https://www.fieldpulse.com/resources/blog/housecall-pro-vs-jobber))

Trust in this category is not earned with visual flourish. It is earned by numbers that
line up, words that say what will happen, and no surprises.

## 2. Three reference patterns, described in words

These are patterns, not products. None of the visual language of any named tool is
copied; what follows is the structural idea each pattern contributes.

### A. The ledger

From accounting software and from the paper it replaced. A full-width table on a white
field. Columns are fixed and meaningful; money is right-aligned, set in tabular figures
so digits stack into columns, and always carries its currency symbol and two decimal
places. Rows are separated by a single hairline, never by alternating fills. The header
row sticks to the top of the scroll container. A totals row sits at the foot and is
visually heavier than the rows above it.

*Why it transfers:* trust in this pattern comes entirely from alignment. A column of
amounts that does not line up reads as sloppy bookkeeping, and this audience has spent
thirty years reading columns of amounts. Helix uses it for contact lists, deal lists,
report tables and the import preview.

*What we reject from it:* nothing about the ledger justifies borders on every cell.
Excessive rules fight the data for attention; a single row separator plus generous
column spacing carries the structure.
([Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables))

### B. The day list

From field-service and dispatch software, and from the paper route sheet on a truck
dashboard. The day is a single vertical list. Each row is anchored by one thing — the
customer's name — set larger than everything else in the row. Beneath it, in smaller
muted type, the detail: address, service, amount. At the right edge of the row, one or
two direct actions with real verbs: Call, Done. The list is grouped by urgency, not by
time-of-day, and overdue work floats above today's work.

*Why it transfers:* it matches how the owner already plans his morning. Helix's Today
screen is this pattern with four groups — needs you, new leads, gone quiet, recent
activity.

*What we reject from it:* dispatch software is usually dark, because it is designed for
a wall-mounted screen in a dim office with several dispatchers reading it at once. A
solo owner in a truck at 6:40 am in full sun is the opposite situation. Light-first wins.

### C. The record with a fixed identity block

From desktop mail and contacts applications. A persistent list on the left; on the
right, a detail pane whose top block never scrolls. That block holds only identity and
action: the name, the company, the phone number as a real control, and the single next
commitment. Everything historical — the timeline, the notes, the files — scrolls
underneath it.
([Windows Developer Blog](https://blogs.windows.com/windowsdeveloper/2017/05/01/master-master-detail-pattern/),
[Oracle Alta patterns](https://www.oracle.com/webfolder/ux/middleware/alta/patterns/MasterDetail.html))

*Why it transfers:* it is the literal answer to both halves of the two-sentence test. The
phone number is how he does not lose the lead. The next step is what he promised.

*What we reject from it:* mail clients put a toolbar of fifteen icons above the detail
pane. Helix's identity block holds at most four controls and every one of them is
labelled with a word.

## 3. Colour research

The stage ramp has to survive colour vision deficiency. The reference set is
**Okabe-Ito**: eight colours chosen empirically by the Color Universal Design
organization so they stay distinguishable under red-green and blue-yellow deficiency,
deliberately avoiding the yellow-green band where confusion is worst. It is the default
categorical palette in Wilke's *Fundamentals of Data Visualization* and is recommended
by *Nature Methods*.
([Figviz reference](https://figviz.com/blog/okabe-ito-palette-hex-codes-full-8-color-reference-with-code-examples-2026-wlt9th1n),
[Vizcept](https://vizcept.com/blog/okabe-ito-palette-guide))

Helix cannot use Okabe-Ito unmodified. Three of its eight colours (orange `#E69F00`,
vermillion `#D55E00`, yellow `#F0E442`) sit in the warm band that this product reserves
for one meaning — "needs you" — and the yellow fails contrast on white outright. So the
ramp was generated instead: hues restricted to 100°–370° in LCh, lightness and chroma
solved numerically to maximise the *worst* pairwise CIE ΔE across normal, protanope,
deuteranope and tritanope simulation (Viénot 1999 matrices). The resulting figures are
recorded in `src/styles/tokens.css` and in `design/review.md`.

The audience finding about blue fading with age applies to the *accent*, not to the
stage ramp: stage colours are always accompanied by the stage's name in full-strength
text, so they are a secondary cue and are held to the 3:1 non-text threshold. The accent
is never a secondary cue, so it is warm and it is dark.

## 4. The two-sentence test, applied screen by screen

For each core screen: does it help him **not lose a lead**, and does it help him
**remember what he promised**? A screen that fails both should not exist.

| Screen | Not lose a lead | Remember what he promised |
|---|---|---|
| **Today** | "New leads" group lists every lead from the last 7 days with no activity yet, each with a Call control on the row. "Gone quiet" lists open deals past their stage's quiet days. Both are lead loss made visible before it happens. | "Needs you" is the top group: overdue tasks first, then today's. Each row names the record it belongs to, so the promise and the person are never separated. |
| **Contact** | The phone number is a control in the fixed identity block, one click from anywhere on the record, with a one-click "log this call" after. It never scrolls away. | The next step sits beside the phone in the same block, in full-strength type. The timeline below is the record of what was actually said, in reverse chronological order. |
| **Pipeline** | Column value totals and counts show where the money is sitting; a deal that stops moving earns the accent rail on its card and turns up on Today. Nothing is hidden behind a filter by default. | Each card carries its next task's due date. A card with no next step shows "No next step" in the accent, which is the only nag in the product. |
| **Import** | This is the screen where leads are *recovered*, not lost: the spreadsheet in his email becomes records. The mapping step shows the real first rows of his real file so he can see his own customers' names before committing. | The dedupe policy is stated in one sentence in plain words, chosen before the run, and the result screen offers the skipped rows back as a CSV. Nothing is silently dropped. |
| **Search** (Cmd/Ctrl+K) | Finds the person by any fragment of name, phone, email or note in under 50 ms, which is the difference between logging a call and not bothering. | Notes and activities are searchable, so "what did I tell the Hendersons about the retaining wall" is answerable. |
| **Tasks** | — (indirect) | The whole screen is this half of the test. Overdue rises to the top; complete without opening; snooze to tomorrow or next week. |
| **Reports** | Leads by source shows which channel is actually producing, so he stops paying for the one that is not. | Average days in stage and conversion between stages tell him where he is dropping the ball as a habit rather than as an incident. |
| **Empty states** | The Today empty state is where a new user decides whether this thing is going to work. It offers the two actions that create the first lead — import a spreadsheet, connect the website — and nothing else. | A list empty state names what the list will hold and the one action that fills it. A zero-result search offers the query back as a new contact. |

## 5. Design consequences, stated as constraints

1. Body text is 16 px minimum and never smaller than 13 px anywhere, including badges.
2. Money is tabular, right-aligned, two decimals, currency symbol present.
3. One warm accent, reserved for "needs you". If it appears somewhere that is not asking
   for the owner's attention, that is a bug.
4. Stage colours never carry meaning alone; the stage name is always present.
5. Nothing in the product asks for money, an upgrade, an account, or an email address.
6. Every destructive action states what will happen in a plain sentence, and every one of
   them is undoable for ten seconds.
7. Light-first. The dark theme is a setting for the person who works at night, not the
   product's identity.
