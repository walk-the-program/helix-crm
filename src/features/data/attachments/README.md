# AttachmentList

A drop-in file list for any record. Built by the data agent so the records
feature can put files on a contact, a company or a deal page without
re-implementing the Rust round trip.

```tsx
import { AttachmentList } from "@/features/data/attachments/AttachmentList";

<AttachmentList entityType="contact" entityId={contact.id} />
```

## Props

| Prop | Type | Meaning |
|---|---|---|
| `entityType` | `string` | `"contact"`, `"company"`, `"deal"` — whatever `attachments.entity_type` should say. |
| `entityId` | `string` | The record's id. |
| `compact` | `boolean?` | Drops the card's own "Files" heading and Add button, for a page that already has one. The empty state then carries the Add button instead. |

## Also exported

| Export | Signature | Use |
|---|---|---|
| `copyFileIntoWorkspace` | `(src: string) => Promise<{ storedName, bytes, mime }>` | The `copy_in` command, typed. Call it if you build your own add button. |
| `formatFileSize` | `(bytes: number) => string` | `"1.4 MB"`, tabular-friendly. |

## What it does

- **Add** — opens the file dialog, then calls the Rust command `copy_in(src)`,
  which chooses the destination itself (`<workspaceDir>/attachments/<uuid>.<ext>`)
  and returns `{ storedName, bytes, mime }`. JS never supplies a write path.
  The row is then created through `src/db/repos/attachments.ts`.
- **List** — `attachments.list(entityType, entityId)` through TanStack Query,
  key `dqk.attachments(entityType, entityId)` from
  `src/features/data/lib/queries.ts`. Invalidate that key after any write you
  make yourself.
- **Thumbnails** — images are shown through Tauri's asset protocol:
  `convertFileSrc(<workspaceDir>/attachments/<storedName>)`. The scope in
  `src-tauri/tauri.conf.json` is `$APPDATA/workspaces/**/attachments/**`, so
  nothing outside a workspace can be displayed. Everything else gets a
  document icon.
- **Open** — `plugin-opener`'s `openPath`, limited by the capability file to
  paths inside `$APPDATA/workspaces/**`.
- **Remove** — a soft delete plus a 10-second Undo toast, like every other
  delete in Helix. The file on disk stays until the trash purge removes it;
  `trash.attachmentFilesFor()` lists the stored names the purge must delete
  through Rust first.

## Errors

- **AttachmentTooLarge** — over 50 MB. Shown inline above the list, in
  `--color-danger`, not as a toast: the owner is looking at the list when it
  happens. Rust refuses the copy before the bytes reach JS, and the repository
  refuses the row as well (`MAX_ATTACHMENT_BYTES`), so both paths are covered.
- A failed `openPath` is a toast: the file is still attached, it is the
  computer that could not open it.

## What it does not do

- No drag-and-drop. The record screens own their own drop targets; call
  `copyFileIntoWorkspace(path)` from one if you add it.
- No rename, no folders, no preview beyond the thumbnail.
- No purge. Deleting the file on disk belongs to the trash purge, which needs
  a Rust command that does not exist yet (see docs/STATUS.md, "Contract
  changes needed").
