# Client roster — blank template

Helix keeps no record of who is running it. There is no account, no licence,
no telemetry and no phone-home, by design (`docs/DESIGN.md` §2.10, the
launch-readiness record §1). So the only place that can answer "which client
has Helix, on what, connected to which site, since when" is a file somebody
keeps by hand. This is that file, empty.

**Copy this file out of the repository before you use it.** This repository is
public and AGPL. A filled-in roster holds client names, site addresses and
install history, and none of that belongs in a public repository. The
recommended home is:

```
/Users/walker_tracy/Desktop/ClearPath Sites/HELIX-CLIENT-ROSTER.md
```

That folder is not a git repository at its top level (each template underneath
it is its own repo), it already holds the other cross-client notes
(`FOR-THE-NEXT-AGENT.md`), and it is the folder open whenever a site is being
built — which is when a row changes. Do not put it inside
`ClearPath Sites/templates/<anything>`; those are repositories and they get
pushed.

## What never goes in this file

These four are the whole rule, and the reason the roster is safe to keep in
plain Markdown on one laptop:

- **Never the token value.** Record that a token was issued and when. The value
  itself lives in exactly two places: the site's own environment (Replit
  Secrets or `.env`) and the client's OS keychain. A roster is not a third.
- **Never a recovery key.** That is the client's key to their own encrypted
  workspace. Record whether they saved it; never what it is.
- **Never the client's Anthropic API key**, or any other credential of theirs.
- **Never a client's CRM data** — no contact names, no lead counts copied out
  of their machine. Row counts at import are fine; they are Walker's own
  handover record.

## The columns

One row per client. Every column is something Walker can answer without the
client's machine in front of him, except where the column says "ask".

| Column | What goes in it | Why it is here |
|---|---|---|
| Business | The client's business name, as on the site | The key for everything else |
| Site template | Which of the eighteen (`templates/CRM-ENDPOINT-STATUS.md`) | Tells you which `toCrmLead` mapping their leads came through when a field looks wrong |
| Site address | The `https://…` origin the client pasted into Helix | Must match Settings → Website exactly; a changed domain is a silent break |
| Site host | Where it is deployed | Where you go to change the env var |
| Endpoint on? | yes / no — is `CRM_API_TOKEN` actually set on the deployed site | An unset token is a 401 for every request; this is the single most common cause of "no leads" |
| Token issued | Date | Starts the clock on everything below |
| Token handed over how | The channel actually used (see `docs/OPERATIONS.md`, "Commercial lifecycle") | If it went by plain email, you know a rotation is owed |
| Token rotated | Date of each rotation, newest first | A rotation means their Helix stopped until they pasted the new one — this column is what you check when they say leads went quiet |
| Helix installed | Date | |
| OS | macOS (version, Intel or Apple silicon) or Windows (version) | Decides which installer they need and which half of the release checklist applies |
| Helix version | The version they are actually running, not the latest released | There is no auto-update; this column is the only thing that knows they are behind |
| Workspace name | What they called it on first run | Makes a support conversation about "my file" concrete |
| Recovery key saved | yes / no / unknown — **ask, never record the key** | If no, a dead laptop takes every encrypted backup with it (`sec.md` F-OPS-1) |
| Second backup folder | yes / no, and roughly where (e.g. "iCloud Drive") | The first copy is inside the workspace folder; a second copy elsewhere is what survives the machine |
| Import done | Date and row count | Their starting position |
| Own Anthropic key | yes / no | If no, the AI buttons are off for them, and that is a support question waiting to happen |
| Last contact | Date and one line | |
| Status | prospect / installed / connected / paused / offboarded | |
| Offboarded | Date and what was done to the token and the site | Closes the row honestly |

## The blank table

Copy from here down.

<!-- HELIX CLIENT ROSTER — begin -->

| Business | Site template | Site address | Site host | Endpoint on? | Token issued | Token handed over how | Token rotated | Helix installed | OS | Helix version | Workspace name | Recovery key saved | Second backup folder | Import done | Own Anthropic key | Last contact | Status | Offboarded |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

<!-- HELIX CLIENT ROSTER — end -->

## Per-client notes

Under the table, one short section per client for anything a column cannot
hold — what broke, what was promised, what they asked for. Format:

```
### <Business>

- YYYY-MM-DD — what happened, what was done.
```

## When each column changes

The procedure that owns each of these is in `docs/OPERATIONS.md` under
"Commercial lifecycle". In short:

- **Install day** — fill the whole row. Anything left blank on install day
  tends to stay blank.
- **Every Helix release you tell a client about** — update "Helix version"
  only once they confirm they installed it, not when you sent the link. The
  column is worthless if it records intent.
- **Every token rotation** — add the date, and confirm the client's Helix is
  polling again before you consider the rotation finished.
- **Every support contact** — "Last contact", and a note if it was not
  trivial.
- **Offboarding** — set "Status" to offboarded and write what happened to the
  token. Keep the row. A client whose site is gone still has Helix and all
  their data, and may still call.
