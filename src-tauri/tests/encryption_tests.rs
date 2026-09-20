//! Integration tests for encryption at rest (docs/PLAN.md "Security and threat
//! model", decision D18). Run with:
//!   cargo test --test encryption_tests
//!
//! Everything here works on temp files. Nothing in this file touches a real
//! workspace, and `use_in_memory_store()` keeps every key in a process-lifetime
//! map, so no test prompts for Keychain access or leaves an entry behind.
//!
//! What each test defends:
//!
//! ```text
//!   key_creation_is_idempotent          one workspace, one key, forever
//!   key_creation_survives_a_race         concurrent first opens agree on a key
//!   a_fresh_workspace_is_encrypted      no plaintext header on a new file
//!   plaintext_is_detected_and_migrated  rows, FTS and the set-aside copy
//!   the_migration_keeps_fts_working     FTS5 survives sqlcipher_export
//!   a_backup_is_encrypted_and_opens     VACUUM INTO writes ciphertext
//!   the_wrong_key_is_refused_clearly    DB_OPEN_FAILED, in plain words
//!   ten_thousand_inserts_in_one_batch   the cost of the cipher, measured
//! ```

use std::path::Path;
use std::time::Instant;

use helix_crm_lib::db::{Db, Statement};
use helix_crm_lib::secrets;
use serde_json::json;
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// SQLite's plaintext file header. An encrypted file is ciphertext from byte 0,
/// so this is the one check that says whether a file on disk is readable by
/// anything that can open it.
const PLAINTEXT_HEADER: &[u8; 16] = b"SQLite format 3\0";

fn first_16_bytes(path: &Path) -> Vec<u8> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)
        .unwrap_or_else(|e| panic!("{} should be readable: {e}", path.display()));
    let mut head = vec![0u8; 16];
    f.read_exact(&mut head)
        .unwrap_or_else(|e| panic!("{} should be at least 16 bytes: {e}", path.display()));
    head
}

fn is_plaintext(path: &Path) -> bool {
    first_16_bytes(path) == PLAINTEXT_HEADER
}

fn temp_workspace(id: &str) -> (TempDir, std::path::PathBuf) {
    secrets::use_in_memory_store();
    let dir = tempfile::tempdir().expect("tempdir should be creatable");
    let path = dir.path().join(id).join("helix.db");
    std::fs::create_dir_all(path.parent().expect("the db has a parent"))
        .expect("the workspace folder should be creatable");
    (dir, path)
}

/// Writes a plaintext SQLite database with a little of everything Helix relies
/// on: a WAL-mode file, an ordinary table with rows, and an FTS5 virtual table
/// with its shadow tables, which is the part of a schema most likely to come
/// across wrong.
///
/// No `PRAGMA key`, so SQLCipher behaves as plain SQLite and the file comes out
/// with the normal header — which is what an existing Helix workspace on disk
/// today looks like.
fn write_plaintext_db(path: &Path) {
    let conn = rusqlite::Connection::open(path).expect("a plaintext db should be creatable");
    conn.pragma_update(None, "journal_mode", "WAL")
        .expect("wal");
    conn.execute_batch(
        "CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         INSERT INTO contacts (id, name) VALUES (1, 'Dale Mercer'), (2, 'Rita Okafor');
         CREATE VIRTUAL TABLE contacts_fts USING fts5(name);
         INSERT INTO contacts_fts (name) SELECT name FROM contacts;",
    )
    .expect("the plaintext schema and rows should be writable");
    drop(conn);

    assert!(
        is_plaintext(path),
        "the fixture itself must be plaintext, or the test proves nothing"
    );
}

fn count(db: &Db, sql: &str) -> i64 {
    db.query(sql, &[])
        .unwrap_or_else(|e| panic!("{sql} should succeed: {e}"))
        .rows
        .first()
        .and_then(|r| r.first())
        .and_then(|v| v.as_i64())
        .unwrap_or_else(|| panic!("{sql} should return one integer"))
}

// ---------------------------------------------------------------------------
// 1. the key
// ---------------------------------------------------------------------------

/// A workspace's key is made once and then found, never remade. If this ever
/// broke, the second launch would generate a new key and the file would be
/// unreadable - so it is the single most important assertion in this file.
#[test]
fn key_creation_is_idempotent() {
    secrets::use_in_memory_store();
    let ws = "018f-idempotent-open";

    let first = secrets::db_key(ws).expect("a fresh workspace gets a key");
    let again = secrets::db_key(ws).expect("the second ask finds the first key");
    assert_eq!(
        first.key_pragma(),
        again.key_pragma(),
        "two calls for one workspace must return the same key"
    );

    // And the whole way round: open, write, close, open again, read it back.
    let (_dir, path) = temp_workspace(ws);
    let db = Db::new();
    db.open(&path).expect("first open");
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create");
    db.execute("INSERT INTO t (id) VALUES (7)", &[])
        .expect("insert");
    db.close().expect("close");

    db.open(&path)
        .expect("the second open must find the same key and read the same file");
    assert_eq!(count(&db, "SELECT id FROM t"), 7);
}

/// The race that matters: several callers asking for a workspace's key at the
/// same moment, none of them finding one yet. If the read and the create are not
/// one critical section, each mints its own key, the last `set` wins, and any
/// file already written with one of the losing keys is unreadable for good. This
/// is a regression test for exactly that - it failed on a CI runner before
/// `db_key` took a lock, and passed on the developer's machine, which is the
/// worst way for a bug like this to behave.
#[test]
fn key_creation_survives_a_race() {
    secrets::use_in_memory_store();
    let ws = "018f-raced";

    let handles: Vec<_> = (0..8)
        .map(|_| std::thread::spawn(move || secrets::db_key(ws).map(|k| k.key_pragma())))
        .collect();

    let pragmas: Vec<String> = handles
        .into_iter()
        .map(|h| {
            h.expect_thread()
                .expect("every thread should get a key, not an error")
        })
        .collect();

    let first = &pragmas[0];
    for (i, p) in pragmas.iter().enumerate() {
        assert_eq!(
            p, first,
            "thread {i} came back with a different key; the get-then-create is not atomic"
        );
    }
    // And the winner is what is actually stored, not just what the threads agreed on.
    assert_eq!(
        &secrets::db_key(ws).expect("read it back").key_pragma(),
        first
    );
}

/// `JoinHandle::join` returns a `Result` whose error is a panic payload, which is
/// noise at the call site. This keeps the test above readable.
trait ExpectThread<T> {
    fn expect_thread(self) -> T;
}

impl<T> ExpectThread<T> for std::thread::JoinHandle<T> {
    fn expect_thread(self) -> T {
        self.join().expect("no thread in this test should panic")
    }
}

// ---------------------------------------------------------------------------
// 2. a new workspace is encrypted from the start
// ---------------------------------------------------------------------------

#[test]
fn a_fresh_workspace_is_encrypted() {
    let (_dir, path) = temp_workspace("018f-fresh");
    let db = Db::new();
    db.open(&path).expect("open a brand new workspace");
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create");
    db.close().expect("close, which also truncates the WAL");

    assert!(
        !is_plaintext(&path),
        "a new workspace file must not start with SQLite's plaintext header; got {:?}",
        String::from_utf8_lossy(&first_16_bytes(&path))
    );

    db.open(&path).expect("reopen");
    let info = db.info().expect("info");
    assert!(info.encrypted, "db_info should report encrypted: true");
    assert!(
        !info.cipher_version.is_empty(),
        "db_info should report a cipher version"
    );
    assert!(
        info.fts5,
        "FTS5 must still be compiled in under SQLCipher - the whole search feature rests on it"
    );
    // Printed so docs/STATUS.md can record which SQLCipher this build links.
    println!(
        "SQLCipher {} on SQLite {}, FTS5 {}",
        info.cipher_version, info.sqlite_version, info.fts5
    );
}

// ---------------------------------------------------------------------------
// 3. the one-time migration
// ---------------------------------------------------------------------------

/// Contract: a plaintext file is detected on open, converted in place, and the
/// plaintext original is set aside in `backups/` under the ordinary backup
/// naming scheme rather than deleted. Rows and the FTS5 table survive, and a
/// second open does not convert anything again.
#[test]
fn plaintext_is_detected_and_migrated() {
    let (_dir, path) = temp_workspace("018f-migrate");
    write_plaintext_db(&path);

    let db = Db::new();
    db.open(&path).expect("opening a plaintext workspace should migrate it, not fail");

    assert!(
        !is_plaintext(&path),
        "after the migration the file in place must be ciphertext"
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM contacts"),
        2,
        "both rows should have come across"
    );
    assert_eq!(
        db.query("SELECT name FROM contacts ORDER BY id", &[])
            .expect("read the migrated rows")
            .rows,
        vec![vec![json!("Dale Mercer")], vec![json!("Rita Okafor")]],
    );

    let info = db.info().expect("info");
    assert!(info.encrypted, "db_info should now report encrypted: true");

    // The plaintext original is set aside, not destroyed.
    let backups = path
        .parent()
        .expect("the db has a parent")
        .join("backups");
    let aside: Vec<_> = std::fs::read_dir(&backups)
        .expect("the migration should have created a backups folder")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with("-pre-encryption.db"))
        .collect();
    assert_eq!(
        aside.len(),
        1,
        "exactly one pre-encryption copy should be there, found {aside:?}"
    );
    let aside_path = backups.join(&aside[0]);
    assert!(
        is_plaintext(&aside_path),
        "the set-aside copy is the original, so it is still plaintext"
    );
    // The name has to match what src/features/data/lib/retention.ts parses, so
    // the Backups screen lists it and the 30-day policy eventually clears it.
    assert!(
        regex_like_backup_name(&aside[0]),
        "{} does not match <iso>T<hh-mm-ss>Z-<reason>.db",
        aside[0]
    );

    // No leftovers from the conversion.
    assert!(
        !path.with_extension("db.enc").exists(),
        "the .enc working file should be gone"
    );

    // Opening again does not convert anything a second time, and it is the
    // moment the plaintext original stops being a safety net and starts being a
    // second unencrypted copy of the whole CRM: it is removed (F-SEC-2).
    db.close().expect("close");
    db.open(&path).expect("reopen the now-encrypted workspace");
    let still: Vec<_> = std::fs::read_dir(&backups)
        .expect("read backups")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with("-pre-encryption.db"))
        .collect();
    assert!(
        still.is_empty(),
        "the plaintext copy must be gone after the encrypted file has opened \
         on its own, found {still:?}"
    );
    assert!(
        !is_plaintext(&path),
        "and the workspace itself must still be the encrypted file"
    );
    assert_eq!(
        count(&db, "SELECT COUNT(*) FROM contacts"),
        2,
        "the rows survive the sweep"
    );
}

/// The sweep is not allowed to touch an ordinary backup, only the plaintext
/// original the one-time migration set aside.
#[test]
fn reopening_removes_the_plaintext_copy_and_nothing_else() {
    let (_dir, path) = temp_workspace("018f-sweep-only-plaintext");
    write_plaintext_db(&path);

    let db = Db::new();
    db.open(&path).expect("migrate on open");
    let backups = path.parent().expect("parent").join("backups");

    // An ordinary encrypted backup, made the way the scheduler makes one.
    let ordinary = db.backup("scheduled").expect("backup").path;
    assert!(std::path::Path::new(&ordinary).is_file());

    db.close().expect("close");
    db.open(&path).expect("reopen");

    let names: Vec<_> = std::fs::read_dir(&backups)
        .expect("read backups")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert!(
        !names.iter().any(|n| n.ends_with("-pre-encryption.db")),
        "the plaintext copy should be gone, found {names:?}"
    );
    assert!(
        std::path::Path::new(&ordinary).is_file(),
        "the ordinary encrypted backup must survive, {names:?}"
    );
    assert!(
        !is_plaintext(std::path::Path::new(&ordinary)),
        "and that surviving backup is encrypted"
    );
}

/// `2026-09-19T12-34-56Z-pre-encryption.db`, without pulling in a regex crate.
fn regex_like_backup_name(name: &str) -> bool {
    let Some(rest) = name.strip_suffix(".db") else {
        return false;
    };
    let bytes = rest.as_bytes();
    if bytes.len() < 21 {
        return false;
    }
    let digits_at = |idxs: &[usize]| idxs.iter().all(|&i| bytes[i].is_ascii_digit());
    digits_at(&[0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18])
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b'-'
        && bytes[16] == b'-'
        && bytes[19] == b'Z'
        && bytes[20] == b'-'
        && rest.ends_with("-pre-encryption")
}

#[test]
fn the_migration_keeps_fts_working() {
    let (_dir, path) = temp_workspace("018f-migrate-fts");
    write_plaintext_db(&path);

    let db = Db::new();
    db.open(&path).expect("migrate on open");

    let hits = db
        .query(
            "SELECT name FROM contacts_fts WHERE contacts_fts MATCH ?1",
            &[json!("Okafor")],
        )
        .expect("the migrated FTS5 table should still be searchable");
    assert_eq!(hits.rows, vec![vec![json!("Rita Okafor")]]);

    // And it still indexes new rows, which is what would break if the shadow
    // tables had come across without their contents lining up.
    db.execute(
        "INSERT INTO contacts_fts (name) VALUES (?1)",
        &[json!("Tomas Whitfield")],
    )
    .expect("insert into the migrated FTS5 table");
    let hits = db
        .query(
            "SELECT name FROM contacts_fts WHERE contacts_fts MATCH ?1",
            &[json!("Whitfield")],
        )
        .expect("search the row just added");
    assert_eq!(hits.rows, vec![vec![json!("Tomas Whitfield")]]);
}

// ---------------------------------------------------------------------------
// 4. backups are encrypted too
// ---------------------------------------------------------------------------

/// Contract: `VACUUM INTO` from a keyed connection writes an encrypted copy, and
/// because the key belongs to the workspace rather than to a file, that copy
/// opens with the same key. That second half is what makes restore work: the
/// frontend copies a backup over `helix.db` and calls `db_open` again.
#[test]
fn a_backup_is_encrypted_and_opens_with_the_same_key() {
    let (_dir, path) = temp_workspace("018f-backup");
    let db = Db::new();
    db.open(&path).expect("open");
    db.execute("CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT)", &[])
        .expect("create");
    db.execute(
        "INSERT INTO contacts (id, name) VALUES (1, ?1)",
        &[json!("Dale Mercer")],
    )
    .expect("insert");

    let backup = db.backup("manual").expect("backup");
    let backup_path = std::path::PathBuf::from(&backup.path);
    assert!(backup_path.exists(), "the backup file should exist");

    let head = first_16_bytes(&backup_path);
    assert_ne!(
        head.as_slice(),
        PLAINTEXT_HEADER.as_slice(),
        "the backup must not be a plaintext dump of an encrypted workspace; \
         its first 16 bytes were {:?}",
        String::from_utf8_lossy(&head)
    );

    // It opens with the workspace key, through the same code path a restore uses:
    // copy the file over the live database, then open the workspace again.
    std::fs::copy(&backup_path, &path).expect("copy the backup over the live file");
    db.close().expect("close before the copy is opened");
    db.open(&path)
        .expect("a restored backup must open with the workspace's key, unchanged");
    assert_eq!(count(&db, "SELECT COUNT(*) FROM contacts"), 1);
    assert!(
        db.info().expect("info").encrypted,
        "the restored file is still encrypted"
    );

    // And directly, as its own workspace file, to prove the copy really is
    // keyed rather than merely unreadable.
    let keyed = rusqlite::Connection::open(&backup_path).expect("open the backup file");
    assert!(
        keyed
            .query_row("SELECT count(*) FROM sqlite_schema", [], |r| r
                .get::<_, i64>(0))
            .is_err(),
        "the backup must not be readable without a key"
    );
}

// ---------------------------------------------------------------------------
// 5. the wrong key
// ---------------------------------------------------------------------------

/// Contract: a workspace file that does not match the key on this machine fails
/// with DB_OPEN_FAILED and a message a person can act on, not a bare SQLite
/// "file is not a database".
#[test]
fn the_wrong_key_is_refused_clearly() {
    let (dir, path) = temp_workspace("018f-right");
    let db = Db::new();
    db.open(&path).expect("open the workspace that owns the key");
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create");
    db.close().expect("close");

    // Same file, different workspace folder, so a different key. The other
    // workspace is opened once first so it HAS a key of its own: that is what
    // makes this the wrong-key case rather than the lost-key case below, which
    // `db_open` now separates and answers differently.
    let other = dir.path().join("018f-wrong").join("helix.db");
    std::fs::create_dir_all(other.parent().expect("parent")).expect("mkdir");
    db.open(&other).expect("mint a key for the other workspace");
    db.close().expect("close");
    std::fs::copy(&path, &other).expect("copy the encrypted file into another workspace");

    let err = db
        .open(&other)
        .expect_err("a file encrypted with another workspace's key must not open");
    assert_eq!(err.code, "DB_OPEN_FAILED");
    assert!(
        err.message.contains("The saved key does not open this workspace"),
        "the message should say so in plain words, got: {}",
        err.message
    );
    assert!(
        !err.message.contains("PRAGMA key"),
        "the message must never carry key material or the pragma, got: {}",
        err.message
    );
}

/// F-SEC-3: the keychain entry is gone but the encrypted file is still there.
///
/// Before this, `db_open` minted a fresh key, wrote it to the keychain, and then
/// failed to open the file with it. Two things were wrong with that. The owner
/// was told the key "does not open this workspace", which reads like the wrong
/// workspace rather than a lost key; and the newly minted key now occupies the
/// entry a keychain restore would have put the real one back into. Neither is
/// recoverable advice. Now nothing is written and the message says what
/// happened.
#[test]
fn a_lost_keychain_entry_is_reported_and_no_new_key_is_minted() {
    let (_dir, path) = temp_workspace("018f-lost-key");
    let db = Db::new();
    db.open(&path).expect("open a fresh workspace");
    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", &[])
        .expect("create");
    db.close().expect("close");
    assert!(!is_plaintext(&path), "the file is encrypted");

    // The owner's keychain lost the item: a restored Mac, a new user account, a
    // "clean up my keychain" afternoon.
    secrets::reset_bundle_cache();
    secrets::delete("018f-lost-key", "dbkey").expect("clear the entry");
    assert!(!secrets::has_db_key("018f-lost-key").expect("probe"));

    let err = db.open(&path).expect_err("there is no key, so it must not open");
    assert_eq!(err.code, "DB_OPEN_FAILED");
    assert!(
        err.message.contains("its key is not in this machine's keychain"),
        "the message should name the real cause, got: {}",
        err.message
    );
    assert!(
        err.message.contains("has not made a new one"),
        "and say that nothing was replaced, got: {}",
        err.message
    );

    // The refusal wrote nothing: a keychain restore can still put the real key
    // back into an entry Helix has not occupied.
    assert!(
        !secrets::has_db_key("018f-lost-key").expect("probe"),
        "db_open must not have minted a replacement key"
    );
    assert!(
        !is_plaintext(&path),
        "and the file itself must be untouched"
    );
}

// ---------------------------------------------------------------------------
// 6. what the cipher costs
// ---------------------------------------------------------------------------

/// Not a benchmark, a guard rail: 10,000 single-row inserts in one `db_batch`,
/// in a debug build, under two seconds. This is what decided against
/// `PRAGMA cipher_memory_security = ON` - the default is already comfortable, so
/// there was no reason to reach for the pragma that would have made it slower.
/// The measured number goes in docs/STATUS.md.
#[test]
fn ten_thousand_inserts_in_one_batch_stay_under_two_seconds() {
    let (_dir, path) = temp_workspace("018f-perf");
    let db = Db::new();
    db.open(&path).expect("open");
    db.execute(
        "CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
        &[],
    )
    .expect("create");

    let statements: Vec<Statement> = (0..10_000)
        .map(|i| Statement {
            sql: "INSERT INTO contacts (id, name, email) VALUES (?1, ?2, ?3)".into(),
            params: vec![
                json!(i),
                json!(format!("Contact {i}")),
                json!(format!("contact{i}@example.com")),
            ],
        })
        .collect();

    let started = Instant::now();
    let result = db.batch(&statements).expect("a 10k-statement batch");
    let elapsed = started.elapsed();

    assert_eq!(result.changes, 10_000);
    assert_eq!(count(&db, "SELECT COUNT(*) FROM contacts"), 10_000);
    println!(
        "10,000 inserts in one batch under SQLCipher took {:?} (debug build)",
        elapsed
    );
    assert!(
        elapsed.as_secs_f64() < 2.0,
        "10,000 inserts took {elapsed:?}, which is over the two-second budget"
    );
}
