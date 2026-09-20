//! Disaster recovery, end to end. Run with:
//!   cargo test --test recovery_tests
//!
//! Everything here works on temp folders. `use_in_memory_store()` keeps every
//! key in a process-lifetime map, so nothing prompts for Keychain access and
//! nothing is left behind on the developer's machine. Walker's real workspace
//! under ~/Library/Application Support is never touched.
//!
//! "A new machine" is simulated by a workspace id this process has never minted
//! a key for, which is exactly what a fresh install looks like to `secrets.rs`:
//! a keychain with no entry for that workspace.
//!
//! ```text
//!   restore_over_the_live_file            the ordinary Restore button, at file level
//!   a_backup_opens_on_a_new_machine       the whole recovery-key journey
//!   a_wrong_key_writes_nothing            a refused adopt leaves no folder, no entry
//!   a_plaintext_file_is_refused           and says which file to pick instead
//!   a_foreign_database_is_refused         the key opened it, but it is not Helix
//!   a_missing_file_is_refused
//!   the_adopted_copy_is_still_encrypted   recovery does not quietly decrypt anything
//!   two_adoptions_do_not_collide          each one is its own workspace
//! ```

use std::path::{Path, PathBuf};

use helix_crm_lib::db::Db;
use helix_crm_lib::recovery::{adopt_backup, format_recovery_key};
use helix_crm_lib::secrets;

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

/// A temp `workspaces` directory, standing in for `<appData>/workspaces`.
fn temp_workspaces_dir() -> (tempfile::TempDir, PathBuf) {
    secrets::use_in_memory_store();
    let dir = tempfile::tempdir().expect("tempdir should be creatable");
    let workspaces = dir.path().join("workspaces");
    std::fs::create_dir_all(&workspaces).expect("workspaces dir");
    (dir, workspaces)
}

/// Build a workspace with a couple of rows in it, the way the app would.
fn seed_workspace(workspaces: &Path, id: &str) -> PathBuf {
    let path = workspaces.join(id).join("helix.db");
    std::fs::create_dir_all(path.parent().expect("parent")).expect("workspace folder");

    let db = Db::new();
    db.open(&path).expect("the workspace should open");
    db.execute(
        "CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        &[],
    )
    .expect("create contacts");
    db.execute(
        "CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
        &[],
    )
    .expect("create schema_migrations");
    db.execute(
        "INSERT INTO contacts (id, name) VALUES (1, 'Dale Mercer'), (2, 'Rita Okafor')",
        &[],
    )
    .expect("insert");
    db.close().expect("close");
    path
}

fn names_in(path: &Path) -> Vec<String> {
    let db = Db::new();
    db.open(path)
        .unwrap_or_else(|e| panic!("{} should open: {e}", path.display()));
    let rows = db
        .query("SELECT name FROM contacts ORDER BY id", &[])
        .expect("select")
        .rows;
    db.close().expect("close");
    rows.iter()
        .filter_map(|r| r.first().and_then(|v| v.as_str()).map(str::to_string))
        .collect()
}

/// The newest .db in the workspace's backups folder.
fn newest_backup(workspace_dir: &Path) -> PathBuf {
    let mut files: Vec<PathBuf> = std::fs::read_dir(workspace_dir.join("backups"))
        .expect("a backups folder should exist")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "db"))
        .collect();
    files.sort();
    files.pop().expect("at least one backup file")
}

fn recovery_key_for(workspace_id: &str) -> String {
    let key = secrets::db_key(workspace_id).expect("the workspace has a key");
    format_recovery_key(&key.expose_for_recovery())
}

// ---------------------------------------------------------------------------
// The ordinary restore, at the level the file copy happens
// ---------------------------------------------------------------------------

/// What Settings -> Backups -> Restore does, minus the React: back up, change
/// something, copy the backup over the live file, reopen. The JS side is
/// covered by its own tests; this is the half that proves the encrypted file
/// really is interchangeable with its backup, which is the assumption the whole
/// restore design rests on.
#[test]
fn restore_over_the_live_file_brings_the_old_rows_back() {
    let (_tmp, workspaces) = temp_workspaces_dir();
    let id = "018f-restore-live";
    let db_path = seed_workspace(&workspaces, id);

    let db = Db::new();
    db.open(&db_path).expect("open");
    let backup = db.backup("scheduled").expect("backup").path;
    db.execute("INSERT INTO contacts (id, name) VALUES (3, 'Sam Pryce')", &[])
        .expect("a change made after the backup");
    assert_eq!(names_in_open(&db).len(), 3);
    db.close().expect("close");

    std::fs::copy(&backup, &db_path).expect("the restore copy");

    assert_eq!(
        names_in(&db_path),
        vec!["Dale Mercer".to_string(), "Rita Okafor".to_string()],
        "the row added after the backup should be gone, and the earlier two back"
    );
    assert!(
        !is_plaintext(&db_path),
        "a restored file must still be encrypted"
    );
}

fn names_in_open(db: &Db) -> Vec<String> {
    db.query("SELECT name FROM contacts ORDER BY id", &[])
        .expect("select")
        .rows
        .iter()
        .filter_map(|r| r.first().and_then(|v| v.as_str()).map(str::to_string))
        .collect()
}

// ---------------------------------------------------------------------------
// The new machine
// ---------------------------------------------------------------------------

/// The whole point of the feature: a laptop is gone, its keychain with it, and
/// all that survives is a backup file and a key on a piece of paper.
#[test]
fn a_backup_opens_on_a_machine_that_has_never_seen_it() {
    let (_tmp, workspaces) = temp_workspaces_dir();
    let old_id = "018f-machine-a";
    let db_path = seed_workspace(&workspaces, old_id);

    let db = Db::new();
    db.open(&db_path).expect("open");
    let _ = db.backup("scheduled").expect("backup");
    db.close().expect("close");

    let key = recovery_key_for(old_id);
    let backup = newest_backup(&workspaces.join(old_id));

    // The new machine: a workspace id no key has ever been minted for, which is
    // what `secrets.rs` sees on a fresh install.
    let new_id = "018f-machine-b";
    assert!(
        !secrets::has_db_key(new_id).expect("the store answers"),
        "the fixture is only honest if the new id starts with no key"
    );

    let adopted = adopt_backup(&workspaces, &backup, &key, new_id).expect("the adopt should work");

    assert_eq!(adopted.workspace_id, new_id);
    assert_eq!(
        names_in(Path::new(&adopted.path)),
        vec!["Dale Mercer".to_string(), "Rita Okafor".to_string()],
        "every row should have come across"
    );
    assert!(
        secrets::has_db_key(new_id).expect("the store answers"),
        "the new machine's keychain should now hold the key, so the next launch \
         opens the workspace without the paper"
    );
}

/// Recovery must not quietly turn an encrypted CRM into a plaintext one.
#[test]
fn the_adopted_copy_is_still_encrypted() {
    let (_tmp, workspaces) = temp_workspaces_dir();
    let old_id = "018f-still-encrypted-a";
    let db_path = seed_workspace(&workspaces, old_id);

    let db = Db::new();
    db.open(&db_path).expect("open");
    let _ = db.backup("scheduled").expect("backup");
    db.close().expect("close");

    let adopted = adopt_backup(
        &workspaces,
        &newest_backup(&workspaces.join(old_id)),
        &recovery_key_for(old_id),
        "018f-still-encrypted-b",
    )
    .expect("adopt");

    assert!(
        !is_plaintext(Path::new(&adopted.path)),
        "the copy must be ciphertext from byte 0"
    );
}

/// A refused adopt must leave the machine exactly as it found it. A half-made
/// workspace folder with a key in the keychain and no readable file in it would
/// be worse than the failure it came from.
#[test]
fn a_wrong_key_writes_nothing() {
    let (_tmp, workspaces) = temp_workspaces_dir();
    let old_id = "018f-wrong-key-a";
    let db_path = seed_workspace(&workspaces, old_id);

    let db = Db::new();
    db.open(&db_path).expect("open");
    let _ = db.backup("scheduled").expect("backup");
    db.close().expect("close");

    let wrong = format_recovery_key(&"ab".repeat(32));
    let new_id = "018f-wrong-key-b";
    let err = adopt_backup(
        &workspaces,
        &newest_backup(&workspaces.join(old_id)),
        &wrong,
        new_id,
    )
    .expect_err("the wrong key must be refused");

    assert!(
        err.message.contains("does not open this file"),
        "the message should name the key, not the file: {}",
        err.message
    );
    assert!(
        !workspaces.join(new_id).exists(),
        "no workspace folder should have been created"
    );
    assert!(
        !secrets::has_db_key(new_id).expect("the store answers"),
        "no key should have been written for a workspace that does not exist"
    );
}

/// The pre-encryption copy `db.rs` sets aside is plaintext and is not what this
/// flow is for. Say which file to pick instead.
#[test]
fn a_plaintext_file_is_refused_with_somewhere_to_go() {
    let (tmp, workspaces) = temp_workspaces_dir();
    let plain = tmp.path().join("2026-09-01T00-00-00Z-pre-encryption.db");
    let conn = rusqlite::Connection::open(&plain).expect("a plaintext db");
    conn.execute_batch("CREATE TABLE contacts (id INTEGER PRIMARY KEY)")
        .expect("schema");
    drop(conn);
    assert!(is_plaintext(&plain), "the fixture must be plaintext");

    let err = adopt_backup(
        &workspaces,
        &plain,
        &format_recovery_key(&"cd".repeat(32)),
        "018f-plaintext",
    )
    .expect_err("a plaintext file must be refused");

    assert!(
        err.message.contains("backups folder"),
        "the message should say where to look: {}",
        err.message
    );
    assert!(!workspaces.join("018f-plaintext").exists());
}

/// The key opened it, so it is encrypted and the key is right, but it is some
/// other SQLite file. Adopting it would make a workspace Helix cannot migrate.
#[test]
fn a_database_that_is_not_helix_is_refused() {
    let (tmp, workspaces) = temp_workspaces_dir();
    let hex = "ef".repeat(32);
    let foreign = tmp.path().join("something-else.db");
    {
        let conn = rusqlite::Connection::open(&foreign).expect("open");
        conn.execute_batch(&format!("PRAGMA key = \"x'{hex}'\""))
            .expect("key");
        conn.execute_batch("CREATE TABLE recipes (id INTEGER PRIMARY KEY)")
            .expect("schema");
    }
    assert!(!is_plaintext(&foreign), "the fixture must be encrypted");

    let err = adopt_backup(
        &workspaces,
        &foreign,
        &format_recovery_key(&hex),
        "018f-foreign",
    )
    .expect_err("a non-Helix database must be refused");

    assert!(
        err.message.contains("not a Helix workspace"),
        "the message should say what is wrong: {}",
        err.message
    );
    assert!(!workspaces.join("018f-foreign").exists());
    assert!(!secrets::has_db_key("018f-foreign").expect("the store answers"));
}

#[test]
fn a_missing_file_is_refused() {
    let (tmp, workspaces) = temp_workspaces_dir();
    let err = adopt_backup(
        &workspaces,
        &tmp.path().join("nothing-here.db"),
        &format_recovery_key(&"12".repeat(32)),
        "018f-missing",
    )
    .expect_err("a missing file must be refused");
    assert!(
        err.message.contains("There is no file at"),
        "{}",
        err.message
    );
}

/// Adopting the same backup twice is a thing an anxious owner will do. Each one
/// is its own workspace, and neither touches the other's key.
#[test]
fn two_adoptions_of_one_backup_do_not_collide() {
    let (_tmp, workspaces) = temp_workspaces_dir();
    let old_id = "018f-twice-a";
    let db_path = seed_workspace(&workspaces, old_id);

    let db = Db::new();
    db.open(&db_path).expect("open");
    let _ = db.backup("scheduled").expect("backup");
    db.close().expect("close");

    let backup = newest_backup(&workspaces.join(old_id));
    let key = recovery_key_for(old_id);

    let one = adopt_backup(&workspaces, &backup, &key, "018f-twice-b").expect("first adopt");
    let two = adopt_backup(&workspaces, &backup, &key, "018f-twice-c").expect("second adopt");

    assert_ne!(one.path, two.path);
    assert_eq!(names_in(Path::new(&one.path)).len(), 2);
    assert_eq!(names_in(Path::new(&two.path)).len(), 2);
}

/// `put_db_key` must never write over a key that is already there: that is the
/// one mistake in this area that destroys a workspace for good.
#[test]
fn an_existing_key_is_never_replaced() {
    let (_tmp, _workspaces) = temp_workspaces_dir();
    let id = "018f-never-replaced";
    let first = secrets::db_key(id).expect("mint");

    let other = helix_crm_lib::secrets::DbKey::from_recovery_hex(&"a9".repeat(32)).expect("parse");
    let err = secrets::put_db_key(id, &other).expect_err("an overwrite must be refused");
    assert!(err.message.contains("already has a database key"), "{}", err.message);

    let again = secrets::db_key(id).expect("read back");
    assert_eq!(
        first.expose_for_recovery(),
        again.expose_for_recovery(),
        "the original key must still be the one on file"
    );
}
