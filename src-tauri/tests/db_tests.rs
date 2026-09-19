//! Integration tests for the Helix database pipe (`helix_crm_lib::db`).
//!
//! Each `#[test]` defends one line of the state-machine contract laid out in
//! `db.rs`'s module doc comment. Run with:
//!   cargo test --test db_tests

use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use helix_crm_lib::db::{Db, Statement};
use serde_json::{json, Value as Json};
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Creates a fresh temp dir, opens a `Db` at `<tempdir>/018f-test/helix.db`,
/// and returns the `TempDir` (keep it alive!), the open `Db`, and the absolute
/// path `Db::open` recorded. That path is absolutised but not canonicalised,
/// so callers can compare it directly against `db.info()` and `db.backup()`.
fn open_temp() -> (TempDir, Db, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir should be creatable");
    let path = dir.path().join("018f-test").join("helix.db");
    let db = Db::new();
    db.open(&path).expect("open should succeed on a fresh path");
    let recorded = db
        .open_path()
        .expect("a just-opened db should report an open path");
    (dir, db, recorded)
}

/// Runs a query expected to return exactly one row of one column and pulls
/// out that value.
fn scalar(db: &Db, sql: &str) -> Json {
    let res = db.query(sql, &[]).expect("scalar query should succeed");
    assert_eq!(res.rows.len(), 1, "expected exactly one row from {sql}");
    assert_eq!(res.rows[0].len(), 1, "expected exactly one column from {sql}");
    res.rows[0][0].clone()
}

/// `SELECT COUNT(*) FROM <table>`, as an i64.
fn row_count(db: &Db, table: &str) -> i64 {
    scalar(db, &format!("SELECT COUNT(*) FROM {table}"))
        .as_i64()
        .expect("COUNT(*) should come back as an integer")
}

// ---------------------------------------------------------------------------
// 1. query/execute round trip
// ---------------------------------------------------------------------------

/// Contract: params bind as null/integer/real/string/boolean(as 0-1)/blob,
/// SELECT results map SQLite storage classes back to the matching JSON shape,
/// rows are arrays in select order (not declaration order), and `execute`
/// reports the real per-statement change count, including 0 for a SELECT.
#[test]
fn query_execute_round_trip_maps_types_and_reports_changes() {
    let (_dir, db, _path) = open_temp();

    db.execute(
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER, price REAL, note TEXT, active INTEGER, payload BLOB)",
        &[],
    )
    .expect("create table");

    // One multi-row VALUES insert, with params covering every JSON->SQL type.
    let res = db
        .execute(
            "INSERT INTO widgets (id, name, qty, price, note, active, payload) VALUES \
             (?1, ?2, ?3, ?4, ?5, ?6, ?7), (?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            &[
                json!(1),
                json!("bolt"),
                json!(10),
                json!(1.5),
                Json::Null,
                json!(true),
                json!([1, 2, 3]),
                json!(2),
                json!("nut"),
                json!(20),
                json!(2.5),
                Json::Null,
                json!(false),
                json!([4, 5, 6]),
            ],
        )
        .expect("multi-row insert");
    assert_eq!(res.changes, 2, "a two-row VALUES insert should report 2 changes");

    // Select the columns in a different order than they were declared, and
    // check the returned row is an array in *that* order.
    let selected = db
        .query(
            "SELECT payload, active, note, price, qty, name, id FROM widgets WHERE id = 1",
            &[],
        )
        .expect("select in a reordered column list");
    assert_eq!(selected.rows.len(), 1);
    let row = &selected.rows[0];
    assert_eq!(row[0], json!([1, 2, 3]), "BLOB -> array of byte numbers");
    assert_eq!(row[1], json!(1), "bool true was bound and reads back as integer 1");
    assert_eq!(row[2], Json::Null, "SQLite NULL -> Value::Null");
    assert_eq!(row[3], json!(1.5), "REAL -> number");
    assert_eq!(row[4], json!(10), "INTEGER -> number");
    assert_eq!(row[5], json!("bolt"), "TEXT -> string");
    assert_eq!(row[6], json!(1), "id is last because it was selected last");

    let row2 = db
        .query("SELECT active FROM widgets WHERE id = 2", &[])
        .expect("select row 2");
    assert_eq!(row2.rows[0][0], json!(0), "bool false was bound and reads back as integer 0");

    // UPDATE reports how many rows it actually touched.
    let res = db
        .execute("UPDATE widgets SET qty = qty + 1 WHERE qty >= 10", &[])
        .expect("update both rows");
    assert_eq!(res.changes, 2);

    let res = db
        .execute("UPDATE widgets SET qty = qty + 1 WHERE qty >= 1000", &[])
        .expect("update matching nothing");
    assert_eq!(res.changes, 0, "an UPDATE matching no rows reports 0 changes");

    // A SELECT sent through execute() is drained, not refused, and changes 0.
    let res = db
        .execute("SELECT * FROM widgets", &[])
        .expect("a SELECT should be runnable through execute()");
    assert_eq!(res.changes, 0, "a SELECT through execute() reports 0 changes");
}

// ---------------------------------------------------------------------------
// 2. batch commits
// ---------------------------------------------------------------------------

/// Contract: `batch` run in autocommit wraps its statements in one
/// BEGIN..COMMIT, reports the summed change count, and every row is visible
/// once the call returns.
#[test]
fn batch_commits_and_reports_total_changes() {
    let (_dir, db, _path) = open_temp();
    db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)", &[])
        .expect("create table");

    let statements = vec![
        Statement {
            sql: "INSERT INTO items (id, label) VALUES (?1, ?2)".into(),
            params: vec![json!(1), json!("a")],
        },
        Statement {
            sql: "INSERT INTO items (id, label) VALUES (?1, ?2)".into(),
            params: vec![json!(2), json!("b")],
        },
        Statement {
            sql: "INSERT INTO items (id, label) VALUES (?1, ?2)".into(),
            params: vec![json!(3), json!("c")],
        },
    ];
    let res = db.batch(&statements).expect("an all-good batch should commit");
    assert_eq!(res.changes, 3, "changes should be the sum across all statements");
    assert_eq!(row_count(&db, "items"), 3);

    let labels = db
        .query("SELECT label FROM items ORDER BY id", &[])
        .expect("select after batch");
    assert_eq!(
        labels.rows,
        vec![vec![json!("a")], vec![json!("b")], vec![json!("c")]],
        "every row from the batch should be visible afterwards"
    );
}

// ---------------------------------------------------------------------------
// 3. batch rolls back on a mid-batch error, leaving nothing
// ---------------------------------------------------------------------------

/// Contract: a batch failure unwinds everything the batch itself did (not
/// what came before it), reports SQL_ERROR naming which statement failed,
/// and leaves the connection back in autocommit.
#[test]
fn batch_rolls_back_atomically_on_mid_batch_error() {
    let (_dir, db, _path) = open_temp();
    db.execute(
        "CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT UNIQUE)",
        &[],
    )
    .expect("create table");
    db.execute(
        "INSERT INTO people (id, email) VALUES (?1, ?2)",
        &[json!(1), json!("seed@x.com")],
    )
    .expect("seed row");
    let before = row_count(&db, "people");

    let statements = vec![
        Statement {
            sql: "INSERT INTO people (id, email) VALUES (?1, ?2)".into(),
            params: vec![json!(2), json!("b@x.com")],
        },
        // Fails: email collides with the seed row's UNIQUE column.
        Statement {
            sql: "INSERT INTO people (id, email) VALUES (?1, ?2)".into(),
            params: vec![json!(3), json!("seed@x.com")],
        },
        Statement {
            sql: "INSERT INTO people (id, email) VALUES (?1, ?2)".into(),
            params: vec![json!(4), json!("d@x.com")],
        },
    ];
    let err = db
        .batch(&statements)
        .expect_err("a UNIQUE violation partway through should fail the whole batch");
    assert_eq!(err.code, "SQL_ERROR");
    assert!(
        err.message.contains("Statement 2 of 3"),
        "error message should name the failing statement, got: {}",
        err.message
    );

    assert_eq!(
        row_count(&db, "people"),
        before,
        "a failed batch must leave exactly the rows that existed before it ran"
    );

    // The unwind must land the connection back in autocommit.
    let commit_err = db
        .commit()
        .expect_err("there should be no transaction left open after an unwound batch");
    assert_eq!(commit_err.code, "TX_STATE");
}

// ---------------------------------------------------------------------------
// 4. batch inside an open transaction uses a savepoint
// ---------------------------------------------------------------------------

/// Contract: a batch started while a transaction is already open runs as a
/// SAVEPOINT, so a failed batch rolls back only its own statements and the
/// caller's outer transaction stays live, writable, and committable.
#[test]
fn batch_inside_open_transaction_uses_a_savepoint() {
    let (_dir, db, _path) = open_temp();
    db.execute(
        "CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT UNIQUE)",
        &[],
    )
    .expect("create table");

    db.begin().expect("begin outer transaction");
    db.execute(
        "INSERT INTO people (id, email) VALUES (?1, ?2)",
        &[json!(100), json!("outer1@x.com")],
    )
    .expect("insert directly, before the batch");

    let statements = vec![
        Statement {
            sql: "INSERT INTO people (id, email) VALUES (?1, ?2)".into(),
            params: vec![json!(101), json!("batch1@x.com")],
        },
        // Fails: primary key collides with the row inserted before the batch.
        Statement {
            sql: "INSERT INTO people (id, email) VALUES (?1, ?2)".into(),
            params: vec![json!(100), json!("dup-id@x.com")],
        },
        Statement {
            sql: "INSERT INTO people (id, email) VALUES (?1, ?2)".into(),
            params: vec![json!(102), json!("batch2@x.com")],
        },
    ];
    let err = db
        .batch(&statements)
        .expect_err("a duplicate primary key partway through should fail the batch");
    assert_eq!(err.code, "SQL_ERROR");

    // The outer transaction is untouched: the earlier insert is still there.
    let seen = db
        .query("SELECT email FROM people WHERE id = 100", &[])
        .expect("read inside the still-open outer transaction");
    assert_eq!(seen.rows, vec![vec![json!("outer1@x.com")]]);

    // And the outer transaction can still take more writes.
    db.execute(
        "INSERT INTO people (id, email) VALUES (?1, ?2)",
        &[json!(103), json!("outer2@x.com")],
    )
    .expect("the outer transaction should still accept writes after the batch failed");

    db.commit().expect("the outer transaction should still commit");

    let ids: Vec<i64> = db
        .query("SELECT id FROM people ORDER BY id", &[])
        .expect("select after commit")
        .rows
        .into_iter()
        .map(|r| r[0].as_i64().expect("id should be an integer"))
        .collect();
    assert_eq!(
        ids,
        vec![100, 103],
        "only the rows written outside the batch should survive; none of the batch's rows should"
    );
}

// ---------------------------------------------------------------------------
// 5. transaction state errors
// ---------------------------------------------------------------------------

/// Contract: `begin` while already in a transaction, and `commit`/`rollback`
/// while in autocommit, all fail with TX_STATE and change nothing; a clean
/// begin/insert/rollback leaves no row behind.
#[test]
fn transaction_state_errors_and_rollback_leaves_no_row() {
    let (_dir, db, _path) = open_temp();
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create table");

    db.begin().expect("first begin should succeed");
    let err = db.begin().expect_err("a second begin should be rejected");
    assert_eq!(err.code, "TX_STATE");
    db.rollback().expect("clean up back to autocommit");

    let err = db
        .commit()
        .expect_err("commit with no open transaction should be rejected");
    assert_eq!(err.code, "TX_STATE");

    let err = db
        .rollback()
        .expect_err("rollback with no open transaction should be rejected");
    assert_eq!(err.code, "TX_STATE");

    // A well-formed begin/insert/rollback leaves no trace.
    db.begin().expect("begin");
    db.execute("INSERT INTO t (id) VALUES (?1)", &[json!(1)])
        .expect("insert inside the transaction");
    db.rollback().expect("rollback");
    assert_eq!(row_count(&db, "t"), 0, "a rolled-back insert must not be visible");
}

// ---------------------------------------------------------------------------
// 6. backup produces a valid db file, and close waits for it
// ---------------------------------------------------------------------------

/// Contract: `backup` writes a real SQLite file named with the reason slug
/// into a `backups` folder beside the database, leaves no `.tmp` behind, and
/// `close` waits for an in-flight backup rather than racing it.
#[test]
fn backup_produces_valid_db_and_close_waits_for_it() {
    let (_dir, db, path) = open_temp();
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT)", &[])
        .expect("create table");
    db.execute(
        "INSERT INTO t (id, label) VALUES (?1, ?2)",
        &[json!(1), json!("hello")],
    )
    .expect("seed a row");

    let backup = db.backup("pre-migration").expect("backup should succeed");
    let backup_path = PathBuf::from(&backup.path);
    assert!(backup_path.exists(), "the returned backup path should exist on disk");
    assert_eq!(
        backup_path.extension().and_then(|e| e.to_str()),
        Some("db"),
        "the backup file should end in .db"
    );

    let backups_dir = backup_path.parent().expect("backup has a parent dir");
    assert_eq!(
        backups_dir.file_name().and_then(|n| n.to_str()),
        Some("backups"),
        "the backup should sit inside a backups folder"
    );
    assert_eq!(
        backups_dir.parent(),
        path.parent(),
        "the backups folder should be next to the database file"
    );

    let file_name = backup_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    assert!(
        file_name.contains("pre-migration"),
        "the backup file name should contain the reason slug, got: {file_name}"
    );

    // No .tmp file left behind anywhere in the backups folder.
    for entry in std::fs::read_dir(backups_dir).expect("read backups dir") {
        let entry = entry.expect("dir entry");
        let name = entry.file_name();
        let name = name.to_string_lossy();
        assert!(!name.ends_with(".tmp"), "no .tmp file should remain, found: {name}");
    }

    // The backup is a real, independent database: open it with a second Db.
    let restore = Db::new();
    restore.open(&backup_path).expect("open the backup file");
    let rows = restore
        .query("SELECT label FROM t WHERE id = 1", &[])
        .expect("read the backup's rows");
    assert_eq!(rows.rows, vec![vec![json!("hello")]]);
    restore.close().expect("close the restore handle");

    // close() must wait for an in-flight backup rather than racing it.
    let db = Arc::new(db);
    let backer = Arc::clone(&db);
    let handle = thread::spawn(move || backer.backup("concurrent-close"));
    // A short, bounded pause biases the race so the backup thread has grabbed
    // the backup guard before close() tries to take it too. Either order is
    // legal per the contract; this just keeps the test from being a no-op.
    thread::sleep(Duration::from_millis(20));
    db.close().expect("close should succeed even with a backup in flight");

    let concurrent = handle
        .join()
        .expect("the backup thread should not panic")
        .expect("the concurrent backup should still complete successfully");
    let concurrent_path = PathBuf::from(&concurrent.path);
    assert!(concurrent_path.exists(), "the concurrent backup's file should be intact");
    assert!(!db.is_open(), "the db should be closed after close() returns");
}

// ---------------------------------------------------------------------------
// 7. DB_CLOSED after close
// ---------------------------------------------------------------------------

/// Contract: every command returns DB_CLOSED once the db is closed (or was
/// never opened), and `close` is idempotent.
#[test]
fn db_closed_after_close_and_before_first_open() {
    let (_dir, db, _path) = open_temp();
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create table");
    db.close().expect("close");

    assert_eq!(db.query("SELECT 1", &[]).unwrap_err().code, "DB_CLOSED");
    assert_eq!(db.execute("SELECT 1", &[]).unwrap_err().code, "DB_CLOSED");
    assert_eq!(db.begin().unwrap_err().code, "DB_CLOSED");
    assert_eq!(db.commit().unwrap_err().code, "DB_CLOSED");
    assert_eq!(db.rollback().unwrap_err().code, "DB_CLOSED");
    let one_statement = [Statement {
        sql: "SELECT 1".into(),
        params: vec![],
    }];
    assert_eq!(db.batch(&one_statement).unwrap_err().code, "DB_CLOSED");
    assert_eq!(db.backup("whatever").unwrap_err().code, "DB_CLOSED");
    assert_eq!(db.info().unwrap_err().code, "DB_CLOSED");

    db.close()
        .expect("closing an already-closed db should be Ok, not an error");

    let fresh = Db::new();
    assert_eq!(
        fresh.query("SELECT 1", &[]).unwrap_err().code,
        "DB_CLOSED",
        "a Db that was never opened should behave as closed"
    );
}

// ---------------------------------------------------------------------------
// 8. FTS5 is available
// ---------------------------------------------------------------------------

/// Contract: `info()` reports FTS5 support, a real SQLite version, the open
/// path, and a nonzero size; and FTS5 actually works end to end.
#[test]
fn info_reports_fts5_and_fts5_actually_works() {
    let (_dir, db, path) = open_temp();

    let info = db.info().expect("info");
    assert!(info.fts5, "this build of SQLite should have FTS5 compiled in");
    assert!(!info.sqlite_version.is_empty(), "sqlite_version should be nonempty");
    assert_eq!(info.path, path.to_string_lossy(), "info().path should match the open path");
    assert!(info.size_bytes > 0, "an opened db file should have nonzero size");

    db.execute("CREATE VIRTUAL TABLE docs USING fts5(body)", &[])
        .expect("create an fts5 virtual table");
    db.execute(
        "INSERT INTO docs (body) VALUES (?1)",
        &[json!("the quick brown fox")],
    )
    .expect("insert into the fts5 table");
    db.execute(
        "INSERT INTO docs (body) VALUES (?1)",
        &[json!("a slow green turtle")],
    )
    .expect("insert a non-matching row");

    let hits = db
        .query("SELECT body FROM docs WHERE docs MATCH ?1", &[json!("fox")])
        .expect("fts5 match query");
    assert_eq!(hits.rows, vec![vec![json!("the quick brown fox")]]);
}

// ---------------------------------------------------------------------------
// 9. open twice switches files
// ---------------------------------------------------------------------------

/// Contract: `open` on a second path switches the pipe to that file without
/// closing first, the previous file's data is invisible in the new one, and
/// switching back does not lose what was already committed.
#[test]
fn open_switches_files_without_losing_committed_data() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path_a = dir.path().join("a").join("helix.db");
    let path_b = dir.path().join("b").join("helix.db");

    let db = Db::new();
    db.open(&path_a).expect("open a");
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create table in a");
    db.execute("INSERT INTO t (id) VALUES (1)", &[])
        .expect("insert into a");
    assert_eq!(row_count(&db, "t"), 1);

    // Open B without closing first.
    db.open(&path_b).expect("open b without closing a first");
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create table in b");
    assert_eq!(row_count(&db, "t"), 0, "b should start empty; a's row must not leak in");

    // `open` absolutises but deliberately does not canonicalise, so the path it
    // reports is the one it was handed (no `\\?\` prefix on Windows, no
    // /private/var rewriting on macOS).
    assert_eq!(
        db.open_path(),
        Some(path_b.clone()),
        "open_path() should report exactly the path it was opened with"
    );

    // Re-open A: the committed row must still be there.
    db.open(&path_a).expect("re-open a");
    assert_eq!(
        row_count(&db, "t"),
        1,
        "switching away and back must not lose a's committed data"
    );
}

// ---------------------------------------------------------------------------
// 10. pragmas are applied on open
// ---------------------------------------------------------------------------

/// Contract: `open` configures WAL journaling and enforces foreign keys.
#[test]
fn pragmas_are_applied_on_open() {
    let (_dir, db, _path) = open_temp();
    assert_eq!(scalar(&db, "PRAGMA journal_mode"), json!("wal"));
    assert_eq!(scalar(&db, "PRAGMA foreign_keys"), json!(1));
}
