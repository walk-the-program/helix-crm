# The AI module (E1)

Optional, off by default, bring your own Anthropic key, and nothing runs unless
the owner presses a button. This folder holds all of it: the settings screen,
the provider, and the three actions other features mount.

## What another feature imports

Everything below comes from `@/features/ai` (the feature's `index.tsx`). Import
from there, not from the files underneath — those move.

### `<PasteToRecordDialog />`

```tsx
import { PasteToRecordDialog } from "@/features/ai";

<PasteToRecordDialog
  open={open}                       // required, boolean
  onOpenChange={setOpen}            // required, (open: boolean) => void
  initialText="…"                   // optional, prefills the paste box
/>
```

Paste an email, a text or a voicemail transcript; press **Read it**; the
proposed customer and job land in an editable form; **Save customer and job**
writes both in one transaction and shows an Undo-capable toast. A contact that
already matches on email or phone is named above the form before he saves.

The AI feature already mounts one of these on `mod+shift+v` and on the
"Paste an email or text into a record" command, so nothing else has to mount it
for the owner to reach it. Mount your own copy when you want a different entry
point (a Today card, an empty-state button) or a prefilled `initialText`.

### `<DraftFollowUpButton />`

```tsx
import { DraftFollowUpButton } from "@/features/ai";

<DraftFollowUpButton
  dealId={deal.id}                  // required, string
  email={primaryEmail ?? null}      // optional, prefills the mailto: address
/>
```

Renders its own button and dialog. Reads the deal and its timeline, drafts a
short follow-up, and offers **Copy** and **Open in Mail** (a `mailto:` URL
through the opener plugin). Helix never sends mail.

### `<SummarizeButton />`

```tsx
import { SummarizeButton } from "@/features/ai";

<SummarizeButton
  entityType="deal"                 // required: "contact" | "company" | "deal"
  entityId={deal.id}                // required, string
/>
```

Three or four sentences about that record and its timeline, in a dialog, with a
Copy button. The summary is never written into the record.

### Helpers

- `useAi()` — `{ loading, workspaceId, readiness, disabledReason, config, refresh }`.
  `disabledReason` is the one line to show when AI cannot run; it is `null` when
  it can.
- `<AiActionButton />` — a button that disables itself with that reason and a
  link to Settings. Use it if you are adding a fourth action.
- `<AiReason reason={…} />` — just the sentence plus the settings link.

## The rule every one of these follows

When AI is off, the key is missing, or Anthropic rejected the key, **the button
is visible and disabled**, with a one-line reason and a link to
`/settings/ai` — never hidden, never silently inert.

## Inside the folder

| File | What it is |
|---|---|
| `provider.ts` | `AiProvider` and the Anthropic implementation over `fetch`. Injectable fetch; named errors. |
| `errors.ts` | `AiKeyMissing`, `AiKeyRejected`, `AiRequestError`, `AiParseError`. |
| `lib/secrets.ts` | The keychain commands and `KeychainError`. The only place a key is read. |
| `lib/aiSettings.ts` | The stored settings, the masked suffix, and the readiness gate. |
| `lib/models.ts` | The three models offered, and which take `output_config.effort`. |
| `lib/http.ts` | Which `fetch`: plugin-http in the app, the browser's under the e2e harness. |
| `lib/context.ts` | Builds the one record's worth of text a call may send. |
| `lib/proposal.ts` | Writes a confirmed proposal: contact + deal, one transaction. |
| `lib/useAi.ts` | `useAi()` and `runWithProvider()`. |

## What is sent, and when

- Only on a button press. Nothing is on a timer and nothing runs at boot.
- Only the record on screen: one contact, company or deal plus up to the newest
  30 or 40 of its own timeline entries, or the text pasted into the dialog.
- The request goes out through `fetch` from `@tauri-apps/plugin-http`, which
  performs it in Rust. The webview's CSP stays `connect-src 'self'` and the
  capability file scopes the plugin to `https://api.anthropic.com/*`.
- The key travels in the `x-api-key` header, lives in the OS keychain, and is
  never written to SQLite, to `helix.json`, to the log, or into an error.
- What comes back is untrusted data. It is parsed against a schema, shown for
  confirmation, and never executed.
