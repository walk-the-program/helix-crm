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
        // Take the backup guard first: opening closes whatever was open, and
        // closing must not race a backup. Same order as `close`.
        let _backup = lock(&self.backup_guard);
        let mut state = lock(&self.state);

        if let Some(prev) = state.take() {
            shutdown(prev);
        }

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

        let conn = Connection::open(path).map_err(|e| {
            AppError::new(
                Code::DbOpenFailed,
                format!("Could not open {}: {}", path.display(), e),
            )
        })?;

        configure(&conn).map_err(|e| {
            AppError::new(
                Code::DbOpenFailed,
                format!("Could not configure {}: {}", path.display(), e.message),
            )
        })?;

        // Absolutised but deliberately not canonicalised: on Windows
        // `canonicalize` hands back a `\\?\C:\...` extended-length path, which
        // would then show up in Diagnostics and stop matching the path the
        // frontend passed in.
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(path))
                .unwrap_or_else(|_| path.to_path_buf())
        };
        let shown = path.to_string_lossy().to_string();
        *state = Some(OpenDb { conn, path });
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
        let src = {
            let state = lock(&self.state);
            state
                .as_ref()
                .ok_or_else(AppError::db_closed)?
                .path
                .clone()
        };

        let dir = src
            .parent()
            .ok_or_else(|| AppError::new(Code::BackupFailed, "The database has no parent folder."))?
            .join("backups");
        fs::create_dir_all(&dir).map_err(|e| {
            AppError::new(
                Code::BackupFailed,
                format!("Could not create {}: {}", dir.display(), e),
            )
        })?;

        let stem = format!("{}-{}", utc_stamp(SystemTime::now()), sanitise(reason));
        let mut dest = dir.join(format!("{stem}.db"));
        let mut n = 2;
        while dest.exists() {
            dest = dir.join(format!("{stem}-{n}.db"));
            n += 1;
        }
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

        Ok(DbInfo {
            path: open.path.to_string_lossy().to_string(),
            size_bytes,
            fts5: fts5 != 0,
            sqlite_version,
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
