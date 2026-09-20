//! The database pipe.
//!
//! One `rusqlite::Connection` behind a mutex, exposed to the frontend as a
//! handful of `#[tauri::command(async)]` calls. Not `tauri-plugin-sql`: that one
//! runs statements on an sqlx pool, so `BEGIN` and `COMMIT` can land on
//! different connections and a read from the UI mid-import breaks the
//! transaction. Because one connection serialises every caller, callers never
//! see `SQLITE_BUSY`; they queue.
//!
//! ```text
//!                         db_open(path)
//!        +----------+  (closes any previous first) +------------------------+
//!        |          | ---------------------------> |         OPEN           |
//!        |  CLOSED  |                              |      (autocommit)      |
//!        |          | <--------------------------- |                        |
//!        +----------+   db_close()                 +------------------------+
//!             ^         waits for in-flight            |   ^            |
//!             |         db_backup, then                |   |            |
//!             |         wal_checkpoint(TRUNCATE)       |   |            |
//!             |                                        |   |            |
//!   every db_* command here                  db_begin  |   | db_commit  | db_batch
//!   returns DB_CLOSED                                  |   | db_rollback|  (BEGIN..COMMIT,
//!                                                      v   |            |   ROLLBACK on error)
//!                                          +------------------------+   |
//!                                          |     OPEN, IN A TX      | <-+
//!                                          |   (not autocommit)     |
//!                                          +------------------------+
//!                                              |          ^
//!                                    db_batch  |          |  RELEASE
//!                                  SAVEPOINT b |          |  (ROLLBACK TO b + RELEASE b
//!                                              v          |   on any error, outer tx lives)
//!                                          +------------------------+
//!                                          |   OPEN, IN A SAVEPOINT |
//!                                          +------------------------+
//!
//!   Illegal edges, each returning TX_STATE and changing nothing:
//!     db_begin    while already in a tx
//!     db_commit   while in autocommit
//!     db_rollback while in autocommit
//!
//!   db_backup runs on a SECOND, read-only connection (VACUUM INTO a .tmp file,
//!   then rename) so it never blocks the pipe. It holds `backup_guard`, and
//!   db_open/db_close take that guard first, which is how "close waits for an
//!   in-flight backup" is enforced. Lock order is always backup_guard -> state;
//!   nothing ever takes them the other way round.
//! ```
//!
//! # Encryption at rest
//!
//! Every workspace file is SQLCipher-encrypted (docs/PLAN.md "Security and threat
//! model", decision D18). The key is 32 random bytes per workspace, made on the
//! first open and kept in the OS keychain under `<workspaceId>:dbkey`; see
//! `secrets.rs`. It is never logged, never written to disk, and never crosses to
//! JS. Because the key belongs to the workspace rather than to a file, every file
//! inside the workspace folder - the live database and every backup - opens with
//! the same key, which is what makes restore a plain file copy.
//!
//! ```text
//!   db_open(path)
//!     |
//!     +-- workspaceId = the folder holding the file      (leads::workspace_id_from_db_path)
//!     +-- key = keychain "<workspaceId>:dbkey", created if absent
//!     |
//!     +-- first 16 bytes == "SQLite format 3\0" ?
//!     |     |
//!     |     yes: ONE-TIME MIGRATION, under the same backup guard as db_backup
//!     |       1. open the plaintext file, no key
//!     |       2. ATTACH '<path>.enc' AS enc KEY "x'<hex>'"
//!     |       3. SELECT sqlcipher_export('enc'); DETACH enc
//!     |       4. checkpoint and close the plaintext file
//!     |       5. prove '<path>.enc' opens with the key and carries the same tables
//!     |       6. rename the plaintext to backups/<iso>Z-pre-encryption.db
//!     |       7. rename '<path>.enc' into place  (step 6 is undone if this fails)
//!     |     no: nothing to convert. If the keychain has no key for an existing
//!     |         file the open is REFUSED rather than minting one that cannot
//!     |         work; and the plaintext copy step 6 set aside on an earlier
//!     |         launch is deleted, because the file has now opened on its own
//!     |         and the copy is only a second unencrypted CRM on disk.
//!     |
//!     +-- PRAGMA key = "x'<hex>'"   FIRST, before any other statement
//!     +-- prove the key opens it    (SQLITE_NOTADB here means the wrong key)
//!     +-- journal_mode=WAL, foreign_keys=ON, busy_timeout
//! ```
//!
//! The raw-key (`x'...'`) form is deliberate: it hands SQLCipher the 32 bytes
//! directly instead of a passphrase, so the 256,000-round PBKDF2 never runs and
//! opening a workspace stays instant.
//!
//! `PRAGMA cipher_memory_security` is left at the SQLCipher 4 default, which is
//! OFF. Turning it on makes SQLite allocate through its own locked, wiped pages;
//! it costs a large fraction of every read and write, and what it buys is
//! protection against an attacker who can already read this process's memory or
//! a swap file. That is not the threat D18 is about, which is a lost laptop, a
//! copied file, a backup drive. The batch-insert smoke test in
//! `tests/encryption_tests.rs` records what the default costs.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as Json};
use tauri::State;

use crate::error::{AppError, AppResult, Code};
use crate::leads::workspace_id_from_db_path;
use crate::secrets::{self, DbKey};

/// Attachments and backups aside, this is the only place SQL touches the disk.
const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct OpenResult {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    /// Rows are arrays in select order, which is what Drizzle's proxy driver
    /// expects. Joins must alias duplicate column names.
    pub rows: Vec<Vec<Json>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecuteResult {
    pub changes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
    pub fts5: bool,
    pub sqlite_version: String,
    /// The file on disk is SQLCipher-encrypted: the connection is keyed and the
    /// file does not start with SQLite's plaintext header.
    pub encrypted: bool,
    /// `PRAGMA cipher_version`, currently `"4.14.0 community"`. Empty on a build with
    /// no SQLCipher, which is also the only way `encrypted` can be false.
    pub cipher_version: String,
}

/// One statement in a `db_batch`.
#[derive(Debug, Clone, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

// ---------------------------------------------------------------------------
// The pipe
// ---------------------------------------------------------------------------

struct OpenDb {
    conn: Connection,
    path: PathBuf,
    /// Kept so `db_backup`'s second connection can key itself without a second
    /// trip to the keychain (which on an unsigned macOS build is also a second
    /// permission prompt). Dropped, and zeroed, with the rest of `OpenDb`.
    key: DbKey,
}

/// The managed state. Commands are thin wrappers over these methods so the
/// pipe can be tested without a Tauri app (see `tests/db_tests.rs`).
pub struct Db {
    state: Mutex<Option<OpenDb>>,
    /// Held for the whole of `db_backup`. `open` and `close` take it first.
    backup_guard: Mutex<()>,
    /// Makes each batch's savepoint name unique, so a future nested batch
    /// can never release the wrong savepoint.
    savepoint_seq: AtomicU64,
}

impl Default for Db {
    fn default() -> Self {
        Self::new()
    }
}

/// A poisoned mutex means a previous caller panicked mid-statement. The
/// connection itself is still valid, so recover the guard rather than
/// bringing the whole app down.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl Db {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(None),
            backup_guard: Mutex::new(()),
            savepoint_seq: AtomicU64::new(0),
        }
    }

    /// The path of the open database, if any. Used by `leads.rs` (to derive the
    /// workspace id) and `files.rs` (to derive the attachments folder).
    pub fn open_path(&self) -> Option<PathBuf> {
        lock(&self.state).as_ref().map(|o| o.path.clone())
    }

    pub fn is_open(&self) -> bool {
        lock(&self.state).is_some()
    }

    // -- lifecycle ----------------------------------------------------------

    pub fn open(&self, path: &Path) -> AppResult<OpenResult> {
        // Take the backup guard first: opening closes whatever was open, closing
        // must not race a backup, and the plaintext migration below is itself a
        // backup-shaped operation. Same order as `close`.
        let _backup = lock(&self.backup_guard);
        let mut state = lock(&self.state);

        if let Some(prev) = state.take() {
            shutdown(prev);
        }

        // Absolutised before anything else, because the workspace id - and so the
        // key - is the name of the folder holding the file. Deliberately not
        // canonicalised: on Windows `canonicalize` hands back a `\\?\C:\...`
        // extended-length path, which would then show up in Diagnostics and stop
        // matching the path the frontend passed in.
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(path))
                .unwrap_or_else(|_| path.to_path_buf())
        };

        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| {
                    AppError::new(
                        Code::DbOpenFailed,
                        format!("Could not create {}: {}", parent.display(), e),
                    )
                })?;
            }
        }

        // The key first: without it there is nothing to open. A keychain that
        // refuses answers SECRET_ERROR, which is the truthful code - the file is
        // fine, the machine's credential store is not.
        let workspace_id = workspace_id_from_db_path(&path)?;
        let plaintext = is_plaintext_file(&path);

        // A file that is already encrypted and a keychain with no key for it is
        // the one combination where minting is wrong. `db_key` would happily
        // make a new key, write it to the keychain, and then fail to open the
        // file with it - overwriting the "no key here" state that a keychain
        // restore could still have fixed, and reporting it as a mismatch rather
        // than as the loss it is. Answer honestly and change nothing.
        if has_content(&path) && !plaintext && !secrets::has_db_key(&workspace_id)? {
            return Err(AppError::new(
                Code::DbOpenFailed,
                format!(
                    "This workspace is encrypted, but its key is not in this \
                     machine's keychain. Helix has not made a new one: a new key \
                     cannot open an old file. The key is saved under \"helix\" for \
                     this workspace - restore it from a backup of this machine, or \
                     open the workspace on the machine that created it. Nothing in \
                     {} has been changed.",
                    path.display()
                ),
            ));
        }

        let key = secrets::db_key(&workspace_id)?;

        if plaintext {
            encrypt_in_place(&path, &key)?;
        }

        let conn = Connection::open(&path).map_err(|e| {
            AppError::new(
                Code::DbOpenFailed,
                format!("Could not open {}: {}", path.display(), e),
            )
        })?;

        // PRAGMA key before every other statement, including the pragmas in
        // `configure`: SQLCipher will not accept it once the file has been read.
        apply_key(&conn, &key, &path)?;

        configure(&conn).map_err(|e| {
            AppError::new(
                Code::DbOpenFailed,
                format!("Could not configure {}: {}", path.display(), e.message),
            )
        })?;

        // The encrypted file has now opened with the stored key on a launch that
        // did no converting, which is the only proof the one-time migration can
        // ever get. Past that point the plaintext original it set aside is not a
        // safety net, it is a second, unencrypted copy of the whole CRM sitting
        // next to the encrypted one.
        if !plaintext {
            purge_plaintext_set_aside(&path);
        }

        let shown = path.to_string_lossy().to_string();
        *state = Some(OpenDb { conn, path, key });
        Ok(OpenResult { path: shown })
    }

    /// Idempotent: closing an already-closed pipe is not an error, because the
    /// frontend calls it defensively on workspace switch and restore.
    pub fn close(&self) -> AppResult<()> {
        let _backup = lock(&self.backup_guard);
        let mut state = lock(&self.state);
        if let Some(open) = state.take() {
            shutdown(open);
        }
        Ok(())
    }

    // -- reads and writes ---------------------------------------------------

    pub fn query(&self, sql: &str, params: &[Json]) -> AppResult<QueryResult> {
        let state = lock(&self.state);
        let open = state.as_ref().ok_or_else(AppError::db_closed)?;
        let values = to_sql_values(params)?;

        let mut stmt = open.conn.prepare(sql)?;
        let ncols = stmt.column_count();
        let mut rows = stmt.query(rusqlite::params_from_iter(values.iter()))?;

        let mut out: Vec<Vec<Json>> = Vec::new();
        while let Some(row) = rows.next()? {
            let mut cells = Vec::with_capacity(ncols);
            for i in 0..ncols {
                cells.push(from_sql_value(row.get_ref(i)?));
            }
            out.push(cells);
        }
        Ok(QueryResult { rows: out })
    }

    pub fn execute(&self, sql: &str, params: &[Json]) -> AppResult<ExecuteResult> {
        let state = lock(&self.state);
        let open = state.as_ref().ok_or_else(AppError::db_closed)?;
        let changes = exec_one(&open.conn, sql, params)?;
        Ok(ExecuteResult { changes })
    }

    // -- transactions -------------------------------------------------------

    pub fn begin(&self) -> AppResult<()> {
        let state = lock(&self.state);
        let open = state.as_ref().ok_or_else(AppError::db_closed)?;
        if !open.conn.is_autocommit() {
            return Err(AppError::tx_state("A transaction is already open."));
        }
        open.conn.execute_batch("BEGIN")?;
        Ok(())
    }

    pub fn commit(&self) -> AppResult<()> {
        let state = lock(&self.state);
        let open = state.as_ref().ok_or_else(AppError::db_closed)?;
        if open.conn.is_autocommit() {
            return Err(AppError::tx_state("No transaction is open to commit."));
        }
        open.conn.execute_batch("COMMIT")?;
        Ok(())
    }

    pub fn rollback(&self) -> AppResult<()> {
        let state = lock(&self.state);
        let open = state.as_ref().ok_or_else(AppError::db_closed)?;
        if open.conn.is_autocommit() {
            return Err(AppError::tx_state("No transaction is open to roll back."));
        }
        open.conn.execute_batch("ROLLBACK")?;
        Ok(())
    }

    /// All-or-nothing. In autocommit it is its own transaction; inside one it is
    /// a savepoint, so a failed batch leaves the caller's transaction usable.
    pub fn batch(&self, statements: &[Statement]) -> AppResult<ExecuteResult> {
        let state = lock(&self.state);
        let open = state.as_ref().ok_or_else(AppError::db_closed)?;
        if statements.is_empty() {
            return Ok(ExecuteResult { changes: 0 });
        }

        let nested = !open.conn.is_autocommit();
        let sp = format!(
            "helix_batch_{}",
            self.savepoint_seq.fetch_add(1, Ordering::Relaxed)
        );

        if nested {
            open.conn.execute_batch(&format!("SAVEPOINT \"{sp}\""))?;
        } else {
            open.conn.execute_batch("BEGIN")?;
        }

        let mut changes: u64 = 0;
        let mut failure: Option<AppError> = None;
        for (i, st) in statements.iter().enumerate() {
            match exec_one(&open.conn, &st.sql, &st.params) {
                Ok(n) => changes += n,
                Err(e) => {
                    failure = Some(AppError::new(
                        Code::SqlError,
                        format!("Statement {} of {}: {}", i + 1, statements.len(), e.message),
                    ));
                    break;
                }
            }
        }

        match failure {
            Some(err) => {
                // Unwind. Some errors (SQLITE_FULL, SQLITE_IOERR) make SQLite
                // roll the transaction back by itself, so check before undoing
                // it again: an unconditional ROLLBACK would fail there and mask
                // the disk-full message the user actually needs to see.
                let unwind = if open.conn.is_autocommit() {
                    Ok(())
                } else if nested {
                    open.conn
                        .execute_batch(&format!("ROLLBACK TO \"{sp}\"; RELEASE \"{sp}\";"))
                } else {
                    open.conn.execute_batch("ROLLBACK")
                };
                if let Err(e) = unwind {
                    return Err(AppError::sql(format!(
                        "{} (and the rollback failed: {})",
                        err.message, e
                    )));
                }
                Err(err)
            }
            None => {
                if nested {
                    open.conn.execute_batch(&format!("RELEASE \"{sp}\""))?;
                } else {
                    open.conn.execute_batch("COMMIT")?;
                }
                Ok(ExecuteResult { changes })
            }
        }
    }

    // -- backup and diagnostics --------------------------------------------

    /// JS never supplies a destination: the path is derived from the open
    /// database so a compromised frontend cannot write anywhere it likes.
    pub fn backup(&self, reason: &str) -> AppResult<BackupResult> {
        let _backup = lock(&self.backup_guard);

        // Read the path and let go of the state lock immediately: the copy runs
        // on its own connection and must not block reads and writes.
        let (src, key) = {
            let state = lock(&self.state);
            let open = state.as_ref().ok_or_else(AppError::db_closed)?;
            (open.path.clone(), open.key.clone())
        };

        let dest = new_backup_path(&src, reason, Code::BackupFailed)?;
        let tmp = dest.with_extension("db.tmp");
        let _ = fs::remove_file(&tmp);

        let ro = Connection::open_with_flags(
            &src,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| {
            AppError::new(
                Code::BackupFailed,
                format!("Could not open {} read-only: {}", src.display(), e),
            )
        })?;
        // Keyed before anything else, exactly as in `open`. It matters twice
        // over: without it the read fails, and with it `VACUUM INTO` writes the
        // copy through the same cipher, so the backup on disk is encrypted with
        // the workspace key rather than being a plaintext dump of it.
        ro.execute_batch(&key.key_pragma()).map_err(|e| {
            AppError::new(
                Code::BackupFailed,
                format!("Could not unlock {} for the backup: {}", src.display(), e),
            )
        })?;
        ro.busy_timeout(BUSY_TIMEOUT).ok();

        let result = ro
            .execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])
            .map_err(|e| {
                AppError::new(
                    Code::BackupFailed,
                    format!("Could not write {}: {}", tmp.display(), e),
                )
            });
        drop(ro);

        if let Err(e) = result {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }

        fs::rename(&tmp, &dest).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            AppError::new(
                Code::BackupFailed,
                format!("Could not rename the backup into place: {e}"),
            )
        })?;

        Ok(BackupResult {
            path: dest.to_string_lossy().to_string(),
        })
    }

    pub fn info(&self) -> AppResult<DbInfo> {
        let state = lock(&self.state);
        let open = state.as_ref().ok_or_else(AppError::db_closed)?;

        let fts5: i64 = open
            .conn
            .query_row("SELECT sqlite_compileoption_used('ENABLE_FTS5')", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        let sqlite_version: String =
            open.conn
                .query_row("SELECT sqlite_version()", [], |r| r.get(0))
                .unwrap_or_else(|_| rusqlite::version().to_string());

        // The honest on-disk footprint: before a checkpoint most of a busy
        // workspace lives in the WAL, and Diagnostics shows this number.
        let mut size_bytes = fs::metadata(&open.path).map(|m| m.len()).unwrap_or(0);
        let wal = PathBuf::from(format!("{}-wal", open.path.to_string_lossy()));
        if let Ok(m) = fs::metadata(&wal) {
            size_bytes += m.len();
        }

        // `cipher_version` is empty on a build with no SQLCipher; `encrypted`
        // reads the file rather than trusting the connection, so a workspace that
        // somehow escaped the migration reports the truth.
        let cipher_version: String = open
            .conn
            .query_row("PRAGMA cipher_version", [], |r| r.get(0))
            .unwrap_or_default();
        let encrypted = !cipher_version.trim().is_empty() && !is_plaintext_file(&open.path);

        Ok(DbInfo {
            path: open.path.to_string_lossy().to_string(),
            size_bytes,
            fts5: fts5 != 0,
            sqlite_version,
            encrypted,
            cipher_version: cipher_version.trim().to_string(),
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// `<dbDir>/backups/<iso>Z-<reason>.db`, with a `-<n>` suffix if a file of that
/// name is already there. Shared by `db_backup` and by the one-time encryption
/// migration so both land in the scheme `src/features/data/lib/retention.ts`
/// parses: the plaintext copy the migration sets aside is an ordinary backup as
/// far as the Backups screen and the 30-day policy are concerned.
fn new_backup_path(src: &Path, reason: &str, code: Code) -> AppResult<PathBuf> {
    let dir = src
        .parent()
        .ok_or_else(|| AppError::new(code, "The database has no parent folder."))?
        .join("backups");
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::new(code, format!("Could not create {}: {}", dir.display(), e)))?;

    let stem = format!("{}-{}", utc_stamp(SystemTime::now()), sanitise(reason));
    let mut dest = dir.join(format!("{stem}.db"));
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{stem}-{n}.db"));
        n += 1;
    }
    Ok(dest)
}

/// SQLite's 16-byte file header, which an encrypted file does not have: from the
/// first byte, a SQLCipher file is ciphertext. Read rather than inferred, so the
/// migration triggers on the one thing that actually decides it.
const PLAINTEXT_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// True only for a file that exists, is long enough to have a header, and starts
/// with SQLite's. A missing or empty file is a workspace about to be created; an
/// unreadable one answers false and fails loudly a moment later, in `open`, with
/// the OS's own message rather than a guess from here.
fn is_plaintext_file(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = fs::File::open(path) else {
        return false;
    };
    let mut head = [0u8; PLAINTEXT_HEADER.len()];
    match f.read_exact(&mut head) {
        Ok(()) => &head == PLAINTEXT_HEADER,
        Err(_) => false,
    }
}

/// `PRAGMA key`, then one read to prove the key was the right one.
///
/// SQLCipher accepts any key without complaint - it only finds out when it tries
/// to decrypt page 1 - so the read is not optional. `SQLITE_NOTADB` from here
/// means the file is encrypted with a different key (or is not a database at
/// all), which is the one failure a user can act on: the keychain entry for this
/// workspace is gone or belongs to a different file.
fn apply_key(conn: &Connection, key: &DbKey, path: &Path) -> AppResult<()> {
    conn.execute_batch(&key.key_pragma()).map_err(|e| {
        AppError::new(
            Code::DbOpenFailed,
            format!("Could not unlock {}: {}", path.display(), e),
        )
    })?;

    conn.query_row("SELECT count(*) FROM sqlite_schema", [], |r| {
        r.get::<_, i64>(0)
    })
    .map(|_| ())
    .map_err(|e| {
        AppError::new(
            Code::DbOpenFailed,
            format!(
                "The saved key does not open this workspace ({}). Its key is \
                 missing from this machine's keychain, or the file belongs to \
                 another workspace. The underlying error was: {e}",
                path.display()
            ),
        )
    })
}

/// True for a file that exists and has bytes in it. A missing or zero-length
/// file is a workspace about to be created, not one whose key is lost.
fn has_content(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false)
}

/// The suffix [`encrypt_in_place`] gives the plaintext original it sets aside.
const SET_ASIDE_SUFFIX: &str = "-pre-encryption.db";

/// Delete any plaintext original the one-time migration set aside, once the
/// encrypted file has opened with the stored key on a later launch.
///
/// The set-aside copy used to rely on the ordinary 30-day backup retention,
/// which left a complete, unencrypted copy of a client's CRM on disk for a
/// month - and forever on a workspace that is never backed up again, because
/// retention always keeps the newest file. It is also no longer the only way
/// back: the launch that converted the workspace took an ordinary backup
/// afterwards, and that one is encrypted with the workspace key.
///
/// Best effort on purpose. A file that cannot be removed is logged and the
/// workspace still opens; failing the open would be a worse answer than a copy
/// that survives until the next launch.
fn purge_plaintext_set_aside(db_path: &Path) {
    let Some(dir) = db_path.parent().map(|p| p.join("backups")) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_set_aside = path
            .file_name()
            .map(|n| n.to_string_lossy().ends_with(SET_ASIDE_SUFFIX))
            .unwrap_or(false);
        if !is_set_aside {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => tauri_plugin_log::log::info!(
                "Removed the plaintext copy the one-time encryption set aside"
            ),
            Err(e) => tauri_plugin_log::log::warn!(
                "Could not remove the plaintext copy set aside by the one-time encryption: {e}"
            ),
        }
    }
}

/// The one-time plaintext -> SQLCipher migration, run from `open` while it holds
/// `backup_guard`.
///
/// Nothing is destroyed here: the plaintext file is renamed into the `backups`
/// folder as `<iso>Z-pre-encryption.db`, so a conversion that went wrong can be
/// recovered by restoring it. It does not stay. The next launch - the first one
/// that opens the encrypted file without converting anything - removes it
/// ([`purge_plaintext_set_aside`]). It used to be left to the ordinary 30-day
/// backup retention, which meant a complete unencrypted copy of a client's CRM
/// lived on disk for a month, and forever on a workspace that is never backed
/// up again, because retention always keeps the newest file.
fn encrypt_in_place(path: &Path, key: &DbKey) -> AppResult<()> {
    let failed = |message: String| AppError::new(Code::DbOpenFailed, message);

    let enc = PathBuf::from(format!("{}.enc", path.to_string_lossy()));
    // A previous attempt that died between the export and the rename.
    let _ = fs::remove_file(&enc);

    {
        let plain = Connection::open(path)
            .map_err(|e| failed(format!("Could not open {} to encrypt it: {e}", path.display())))?;
        plain.busy_timeout(BUSY_TIMEOUT).ok();

        // The path goes into SQL as a literal because ATTACH ... KEY is not a
        // place bound parameters are guaranteed to reach; single quotes are
        // doubled the way SQLite expects.
        let quoted = enc.to_string_lossy().replace('\'', "''");
        let attach = format!(
            "ATTACH DATABASE '{quoted}' AS helix_enc {}",
            key.attach_key_clause()
        );
        plain
            .execute_batch(&attach)
            .map_err(|e| failed(format!("Could not start the encrypted copy: {e}")))?;

        // sqlcipher_export returns a row, so it goes through query_row.
        let export = plain
            .query_row("SELECT sqlcipher_export('helix_enc')", [], |r| {
                r.get::<_, Option<i64>>(0)
            })
            .map(|_| ())
            .map_err(|e| failed(format!("Could not write the encrypted copy: {e}")));

        let detach = plain.execute_batch("DETACH DATABASE helix_enc");
        export?;
        detach.map_err(|e| failed(format!("Could not close the encrypted copy: {e}")))?;

        // Fold the WAL back into the plaintext file before it is moved, so no
        // orphan -wal is left pointing at a file that is no longer there.
        let _ = plain.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    }

    // Prove the copy before anything is moved. A file that will not open with
    // the key, or that came out empty when the source was not, is a failed
    // migration and the plaintext stays exactly where it is.
    verify_encrypted_copy(path, &enc, key).inspect_err(|_| {
        let _ = fs::remove_file(&enc);
    })?;

    let aside = new_backup_path(path, "pre-encryption", Code::DbOpenFailed)?;
    fs::rename(path, &aside).map_err(|e| {
        let _ = fs::remove_file(&enc);
        failed(format!(
            "Could not set {} aside as {}: {e}",
            path.display(),
            aside.display()
        ))
    })?;
    // A clean close removes these, but a crashed previous run may have left them.
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(PathBuf::from(format!(
            "{}{suffix}",
            path.to_string_lossy()
        )));
    }

    if let Err(e) = fs::rename(&enc, path) {
        // Put the workspace back the way it was rather than leaving no file at
        // all: the next launch retries the migration.
        let _ = fs::rename(&aside, path);
        let _ = fs::remove_file(&enc);
        return Err(failed(format!(
            "Could not move the encrypted copy into place: {e}"
        )));
    }

    Ok(())
}

/// Opens the freshly written encrypted file with the key and checks it carries
/// the same number of schema objects as the plaintext source.
fn verify_encrypted_copy(src: &Path, enc: &Path, key: &DbKey) -> AppResult<()> {
    let failed = |message: String| AppError::new(Code::DbOpenFailed, message);

    let objects = |conn: &Connection| -> rusqlite::Result<i64> {
        conn.query_row("SELECT count(*) FROM sqlite_schema", [], |r| r.get(0))
    };

    let plain = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| failed(format!("Could not re-read {}: {e}", src.display())))?;
    let before =
        objects(&plain).map_err(|e| failed(format!("Could not count {}: {e}", src.display())))?;
    drop(plain);

    let copy = Connection::open_with_flags(enc, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| failed(format!("Could not re-read the encrypted copy: {e}")))?;
    apply_key(&copy, key, enc)?;
    let after = objects(&copy)
        .map_err(|e| failed(format!("Could not count the encrypted copy: {e}")))?;
    drop(copy);

    if after != before {
        return Err(failed(format!(
            "The encrypted copy of {} came out with {after} tables and indexes \
             instead of {before}, so it was thrown away and nothing was changed.",
            src.display()
        )));
    }
    Ok(())
}

fn configure(conn: &Connection) -> AppResult<()> {
    // journal_mode returns a row, so it cannot go through pragma_update.
    let mode: String = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
    debug_assert!(
        mode.eq_ignore_ascii_case("wal") || mode.eq_ignore_ascii_case("memory"),
        "journal_mode came back as {mode}"
    );
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    Ok(())
}

/// Roll back anything still open, truncate the WAL, then drop the connection.
/// Every step is best-effort: a close must always finish.
fn shutdown(open: OpenDb) {
    if !open.conn.is_autocommit() {
        let _ = open.conn.execute_batch("ROLLBACK");
    }
    let _ = open.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    drop(open.conn);
}

/// Runs one statement and reports how many rows it changed.
///
/// Rows are drained rather than refused so that statements which return a row
/// (`PRAGMA foreign_key_check`, `PRAGMA optimize`) can be sent through
/// `db_execute` without a special case. The change count is the delta of
/// `total_changes`, which is exact per statement; a statement that changes
/// nothing reports 0 rather than inheriting the previous statement's count.
fn exec_one(conn: &Connection, sql: &str, params: &[Json]) -> AppResult<u64> {
    let before = conn.total_changes();
    let values = to_sql_values(params)?;
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(values.iter()))?;
    while rows.next()?.is_some() {}
    Ok(conn.total_changes().saturating_sub(before))
}

fn to_sql_values(params: &[Json]) -> AppResult<Vec<SqlValue>> {
    params
        .iter()
        .enumerate()
        .map(|(i, v)| to_sql_value(v).map_err(|m| AppError::sql(format!("Parameter {}: {m}", i + 1))))
        .collect()
}

/// `null | number | string | boolean | Uint8Array`, per the contract. Booleans
/// bind as 0/1. A `Uint8Array` arrives either as an array of byte values or, if
/// it was stringified on the way through the IPC bridge, as an object keyed by
/// index; both are accepted so the frontend never has to care.
fn to_sql_value(v: &Json) -> Result<SqlValue, String> {
    match v {
        Json::Null => Ok(SqlValue::Null),
        Json::Bool(b) => Ok(SqlValue::Integer(i64::from(*b))),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(SqlValue::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(SqlValue::Real(f))
            } else {
                Err(format!("{n} does not fit in a SQLite number"))
            }
        }
        Json::String(s) => Ok(SqlValue::Text(s.clone())),
        Json::Array(items) => {
            let mut bytes = Vec::with_capacity(items.len());
            for item in items {
                bytes.push(byte_of(item)?);
            }
            Ok(SqlValue::Blob(bytes))
        }
        Json::Object(map) => Ok(SqlValue::Blob(bytes_from_index_map(map)?)),
    }
}

fn byte_of(v: &Json) -> Result<u8, String> {
    v.as_u64()
        .and_then(|n| u8::try_from(n).ok())
        .ok_or_else(|| format!("expected a byte (0-255), got {v}"))
}

fn bytes_from_index_map(map: &Map<String, Json>) -> Result<Vec<u8>, String> {
    let mut indexed: Vec<(usize, u8)> = Vec::with_capacity(map.len());
    for (k, v) in map {
        let i: usize = k
            .parse()
            .map_err(|_| "objects are not valid parameters; send null, a number, a string, a boolean, or a Uint8Array".to_string())?;
        indexed.push((i, byte_of(v)?));
    }
    indexed.sort_unstable_by_key(|(i, _)| *i);
    Ok(indexed.into_iter().map(|(_, b)| b).collect())
}

/// NULL -> null, INTEGER/REAL -> number, TEXT -> string, BLOB -> array of bytes.
fn from_sql_value(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(Number::from(i)),
        ValueRef::Real(f) => Number::from_f64(f).map_or(Json::Null, Json::Number),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|byte| Json::Number((*byte).into())).collect()),
    }
}

/// Backup file names must survive Windows, which rejects `:`, so the ISO
/// timestamp uses dashes in the time: `2026-09-18T19-05-03Z`.
fn utc_stamp(now: SystemTime) -> String {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}Z",
        y,
        m,
        d,
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

/// Howard Hinnant's days-from-civil, inverted. Avoids pulling in a date crate
/// for the one timestamp this app formats in Rust.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// The reason travels into a file name, so it is reduced to a safe slug.
fn sanitise(reason: &str) -> String {
    let slug: String = reason
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    let mut out = String::new();
    let mut last_dash = false;
    for c in slug.chars().take(40) {
        if c == '-' {
            if !last_dash {
                out.push(c);
            }
            last_dash = true;
        } else {
            out.push(c);
            last_dash = false;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "backup".to_string()
    } else {
        out
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn db_open(db: State<'_, Db>, path: String) -> AppResult<OpenResult> {
    db.open(Path::new(&path))
}

#[tauri::command(async)]
pub fn db_close(db: State<'_, Db>) -> AppResult<()> {
    db.close()
}

#[tauri::command(async)]
pub fn db_query(db: State<'_, Db>, sql: String, params: Vec<Json>) -> AppResult<QueryResult> {
    db.query(&sql, &params)
}

#[tauri::command(async)]
pub fn db_execute(db: State<'_, Db>, sql: String, params: Vec<Json>) -> AppResult<ExecuteResult> {
    db.execute(&sql, &params)
}

#[tauri::command(async)]
pub fn db_begin(db: State<'_, Db>) -> AppResult<()> {
    db.begin()
}

#[tauri::command(async)]
pub fn db_commit(db: State<'_, Db>) -> AppResult<()> {
    db.commit()
}

#[tauri::command(async)]
pub fn db_rollback(db: State<'_, Db>) -> AppResult<()> {
    db.rollback()
}

#[tauri::command(async)]
pub fn db_batch(db: State<'_, Db>, statements: Vec<Statement>) -> AppResult<ExecuteResult> {
    db.batch(&statements)
}

#[tauri::command(async)]
pub fn db_backup(db: State<'_, Db>, reason: String) -> AppResult<BackupResult> {
    db.backup(&reason)
}

#[tauri::command(async)]
pub fn db_info(db: State<'_, Db>) -> AppResult<DbInfo> {
    db.info()
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn stamp_is_windows_safe_and_correct() {
        // 2026-09-18T19:05:03Z
        let t = UNIX_EPOCH + Duration::from_secs(1_789_758_303);
        let s = utc_stamp(t);
        assert_eq!(s, "2026-09-18T19-05-03Z");
        assert!(!s.contains(':'));
    }

    #[test]
    fn epoch_formats() {
        assert_eq!(utc_stamp(UNIX_EPOCH), "1970-01-01T00-00-00Z");
    }

    #[test]
    fn reason_becomes_a_slug() {
        assert_eq!(sanitise("pre-migration"), "pre-migration");
        assert_eq!(sanitise("Before Restore!"), "before-restore");
        assert_eq!(sanitise("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitise(""), "backup");
        assert_eq!(sanitise("///"), "backup");
    }

    #[test]
    fn params_convert() {
        assert_eq!(to_sql_value(&Json::Bool(true)).unwrap(), SqlValue::Integer(1));
        assert_eq!(
            to_sql_value(&Json::Bool(false)).unwrap(),
            SqlValue::Integer(0)
        );
        assert_eq!(to_sql_value(&Json::Null).unwrap(), SqlValue::Null);
        assert_eq!(
            to_sql_value(&serde_json::json!([1, 2, 255])).unwrap(),
            SqlValue::Blob(vec![1, 2, 255])
        );
        assert_eq!(
            to_sql_value(&serde_json::json!({"1": 9, "0": 8})).unwrap(),
            SqlValue::Blob(vec![8, 9])
        );
        assert!(to_sql_value(&serde_json::json!({"a": 1})).is_err());
        assert!(to_sql_value(&serde_json::json!([300])).is_err());
    }
}
