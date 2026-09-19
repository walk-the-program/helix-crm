# Helix CRM build status

Agents append dated entries here. Newest at the bottom.

---

## 2026-09-18 — Foundations (Rust) agent

### Did

**`src-tauri/Cargo.toml`** — pinned to versions that resolve on crates.io today:
tauri 2.11.5 (feature `protocol-asset`, required by the asset-protocol scope),
tauri-plugin-fs 2.5.2, -dialog 2.7.3, -opener 2.5.5, -log 2.9.1, -http 2.6.1,
-single-instance 2.4.4 (behind a `cfg(not(android|ios))` target block),
rusqlite 0.40.2 `bundled` (SQLite 3.x via libsqlite3-sys 0.38.2),
keyring 3.6.3 `apple-native,windows-native`, reqwest 0.12.28 with
`default-features = false, features = ["rustls-tls","json"]`, serde, serde_json,
thiserror 2, base64 0.23, mime_guess 2, uuid 1.26 `v7`, tempfile 3 as a dev-dep.
reqwest is deliberately held at 0.12 rather than 0.13: that is the version
tauri-plugin-http already links, so only one copy of reqwest compiles. (0.13
also renamed the feature `rustls-tls` to `rustls`.)

**`src-tauri/src/db.rs`** — the database pipe, with the state-machine diagram in
the module header. `Mutex<Option<Connection>>` plus a separate `backup_guard`.
All ten commands are `#[tauri::command(async)]`. Structured as a plain `Db`
struct with the commands as thin wrappers, so the pipe is testable without a
Tauri app.
- `db_open` creates parent dirs, closes any previous connection first, sets
  `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- `db_close` is idempotent: rolls back any open transaction, runs
  `PRAGMA wal_checkpoint(TRUNCATE)`, drops the connection.
- `db_query` returns rows as arrays in select order. NULL→null, INTEGER→number,
  REAL→number, TEXT→string, BLOB→array of bytes. Params accept
  null/number/string/bool (binds 0/1)/byte array, and also an object keyed by
  index, because a `Uint8Array` that gets JSON-stringified on the way through
  IPC arrives in that shape.
- `db_batch` uses BEGIN..COMMIT in autocommit and a uniquely named
  SAVEPOINT..RELEASE inside an open transaction; on error it unwinds only its
  own work and reports which statement number failed.
- `db_backup` opens a second `SQLITE_OPEN_READ_ONLY` connection, `VACUUM INTO`
  a `.tmp`, then renames. `db_close` and `db_open` take `backup_guard` first, so
  a close always waits for an in-flight backup. Lock order is always
  backup_guard → state.
- `db_info` reports path, size, `sqlite_compileoption_used('ENABLE_FTS5')` and
  `sqlite_version()`.

**`src-tauri/src/secrets.rs`** — `secret_set/get/delete` over keyring, service
`helix`, user `<workspaceId>:<kind>`. A missing entry reads back as `null`
rather than an error; deleting a missing entry succeeds. No plaintext fallback.

**`src-tauri/src/leads.rs`** — `leads_fetch(cursor, limit)`. Reads
`settings.site_origin` (a JSON string) from the open connection, derives the
workspace id from the open DB path, reads the `site` secret, GETs
`<origin>/api/crm/leads` with `Authorization: Bearer`, 15 s timeout, limit
clamped to 1..=200. Origin must be `https://` or `http://` on `127.0.0.1` /
`localhost`. Non-2xx → `HTTP_STATUS` with the status in the message; everything
else → `NET_ERROR`.

**`src-tauri/src/files.rs`** — `copy_in(src)` copies into
`<workspaceDir>/attachments/<uuidv7>.<ext>` (destination chosen in Rust),
refuses > 50 MB with `IO_ERROR`, returns `{ storedName, bytes, mime }`.
`app_paths()` returns `{ appData, workspacesDir }` from `app_data_dir`.

**`src-tauri/src/error.rs`** — one `AppError { code, message }` serialising
exactly the codes in CONTRACTS.md.

**`src-tauri/src/lib.rs`** — registers single-instance first (focuses the
existing `main` window), then fs, dialog, opener, http. The log plugin is
registered in `setup()` where the app data path can be resolved: rotating file
at `<appData>/logs/helix.log`, `KeepSome(7)`, 4 MB per file, plus a launch-time
sweep of log files older than 7 days.

**`src-tauri/tauri.conf.json`** — window `main` 1280x820, minWidth 1024,
minHeight 700; CSP exactly as specified; asset protocol enabled and scoped to
`$APPDATA/workspaces/**/attachments/**`.

**`src-tauri/capabilities/default.json`** — fs limited to `$APPDATA` recursive
(dialog-selected paths are added to the fs scope at runtime by the dialog
plugin); dialog open/save; opener `open-url` restricted to https/mailto/tel/sms
and `open-path` to `$APPDATA/workspaces/**`; http scoped to
`https://api.anthropic.com/*` only; log. `opener:default` is deliberately NOT
used because it also allows plain `http://*`.

**`src-tauri/tests/db_tests.rs`** — 10 integration tests against the `Db`
struct in a temp dir. **`.github/workflows/ci.yml`** — `js` on ubuntu (npm ci,
typecheck, test) and `rust` matrix macOS + Windows (`cargo test` in src-tauri,
debug only). **`.github/workflows/release.yml`** — on tag `v*`, tauri-action
matrix macOS aarch64 + x86_64 and Windows, unsigned, uploading to a draft
release.

### Verified

```
$ cd src-tauri && cargo build
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.83s

$ cargo test
     Running unittests src/lib.rs
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
     Running unittests src/main.rs
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
     Running tests/db_tests.rs
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
   Doc-tests helix_crm_lib
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

$ cargo clippy --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.75s
    (no warnings, no errors)
```

The 10 db tests: query/execute round trip with full type mapping and select
order; batch commits with the summed change count; batch rolls back atomically
on a mid-batch error leaving nothing and returning to autocommit; batch inside
an open transaction uses a savepoint and the outer transaction survives, stays
writable and commits; begin/commit/rollback state errors; backup writes a valid
DB that a second `Db` can open and read, leaves no `.tmp`, and a concurrent
`close` waits for it; DB_CLOSED from every command after close and before first
open; FTS5 reported by `db_info` and exercised with a real `MATCH`; open twice
switches files without losing committed data; WAL and foreign_keys applied on
open. Plus 12 unit tests covering timestamp formatting, backup reason slugging,
param conversion, origin validation, workspace-id derivation, settings-value
parsing, attachment extension safety, the 50 MB refusal and the mime guess.

Two behaviours were confirmed against SQLite directly before relying on them: a
bound parameter is accepted in `VACUUM INTO ?1`, and `VACUUM INTO` works on a
read-only connection and sees WAL-committed rows.

### Not done

- No macOS keychain round-trip test. `keyring` hits the real login keychain,
  which prompts and pollutes the developer's keychain, and CI runners have no
  unlocked keychain. `secrets.rs` is covered only by a validation test. Needs a
  manual check on first run.
- No `leads_fetch` test against a live endpoint: `tools/fake-site` is another
  agent's deliverable. Only the pure helpers (origin validation, workspace-id
  derivation, settings parsing) are tested.
- `cargo build` only. Never ran `npm run tauri dev` or a release build, so the
  app has not been launched and the capability set has not been exercised at
  runtime — only validated at build time by `tauri-build`.
- CI is unrun: the workflows have not executed on GitHub yet. The Windows
  `cargo test` leg in particular is unproven.
- Ubuntu is excluded from the CI rust matrix (no Tauri Linux system deps).

### Contract changes needed

None blocking. Four interpretations to confirm, each a place CONTRACTS.md was
silent rather than contradicted:

1. **`db_rollback` outside a transaction returns `TX_STATE`.** The contract
   annotates `db_begin` and `db_commit` with TX_STATE but leaves `db_rollback`
   bare. Rolling back with nothing open is now an error, matching SQLite. If the
   TS write lock calls `rollback()` defensively in a `catch`, it must tolerate
   TX_STATE or check first.
2. **Backup file names use dashes in the time**, `2026-09-18T19-05-03Z-<reason>.db`,
   not `19:05:03`. Windows rejects `:` in file names, so a literal ISO timestamp
   was not possible. The reason is also slugged, and a same-second collision
   gets a `-2` suffix.
3. **`leads_fetch` omits `after` entirely when the cursor is null** rather than
   sending `after=`. `tools/fake-site` and the ClearPath template endpoint
   should treat a missing `after` as "from the beginning".
4. **`db_info.sizeBytes` is the main DB file plus its `-wal` file.** Before a
   checkpoint most of a busy workspace lives in the WAL, and the Diagnostics
   screen showing a near-empty number would be misleading.

One implementation note for whoever builds `src/db/client.ts`: `db_open`
returns the path absolutised but **not** canonicalised. On Windows
`canonicalize` produces a `\\?\C:\...` extended-length path, which would leak
into Diagnostics and stop matching the path the frontend passed in.
