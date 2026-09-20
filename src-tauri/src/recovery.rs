//! The recovery key, and opening a backup on a machine that has never seen it.
//!
//! # Why this exists
//!
//! Every workspace file, and every backup of it, is SQLCipher-encrypted with a
//! key that is generated on that machine and kept only in that machine's
//! keychain (`secrets.rs`, decision D18). That is the right answer for a lost
//! laptop and the wrong answer for a dead one: the owner of a single Mac who
//! drops it in a river has thirty days of backups nothing on earth can read,
//! and a workspace folder copied to a new machine will not open either.
//!
//! For a solo trade owner that is the most likely way to lose everything, so
//! the key stops being a secret the app keeps from its owner and becomes a
//! thing the owner can write down.
//!
//! ```text
//!   MACHINE A                                   MACHINE B (new, empty keychain)
//!   ---------                                   ------------------------------
//!   Settings -> Backups
//!     "Show recovery key"                       Settings -> Backups
//!        recovery_key_reveal() ---> HLX1-....      "Open a backup from another machine"
//!        written down / saved to a file                pick <file>.db  + type the key
//!                                                          |
//!   backups/2026-09-20T..-scheduled.db  --copied-->        v
//!   (encrypted with the same key)               workspace_adopt_backup(file, key)
//!                                                 1. the key opens the file?   (no  -> stop, nothing written)
//!                                                 2. it looks like Helix?      (no  -> stop, nothing written)
//!                                                 3. mkdir workspaces/<new id>
//!                                                 4. copy the file in as helix.db
//!                                                 5. put the key in THIS keychain, under the new id
//!                                                 6. prove the copy opens through the keychain
//!                                                    (anything after 3 fails -> the folder and the
//!                                                     keychain entry are both removed again)
//! ```
//!
//! # The trade-off, stated plainly
//!
//! A key the owner can write down is a key an attacker can find written down.
//! The product's threat model (docs/PLAN.md, D18) is a lost or stolen machine
//! and a copied file, not a targeted search of the owner's filing cabinet, and
//! the copy of the key that already exists - the one in the keychain - is
//! exactly as available to anyone who can unlock that Mac. What changes is that
//! the owner now has a second copy under their own control. The screen says so,
//! and the saved file says so.
//!
//! # What this module will not do
//!
//! It never changes a key. `put_db_key` refuses to overwrite, so adopting a
//! backup can only ever write into a workspace id that was minted seconds
//! earlier. There is no "reset my key", because there is no such thing: the
//! bytes are the data.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::Db;
use crate::error::{AppError, AppResult, Code};
use crate::leads::workspace_id_from_db_path;
use crate::secrets::{self, DbKey};

/// SQLite's plaintext file header. A SQLCipher file is ciphertext from byte 0.
const PLAINTEXT_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// Tells a Helix recovery key apart from any other string of hex the owner
/// might paste in, and gives the saved file something to be recognised by.
const PREFIX: &str = "HLX1";

/// Four characters per group: short enough to read back off paper without
/// losing your place, and it divides 64 exactly.
const GROUP: usize = 4;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryKey {
    /// The formatted key: `HLX1-1A2B-...`, sixteen groups of four.
    pub key: String,
    /// The whole text of the file the owner saves, built here so the words the
    /// owner reads on paper and the words on the screen cannot drift apart in
    /// two languages.
    pub file_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptedWorkspace {
    pub workspace_id: String,
    pub path: String,
}

// ---------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------

/// 64 hex characters -> `HLX1-1A2B-3C4D-...`.
///
/// Uppercase, because this is read off a screen and copied onto paper, and
/// grouped, because a 64-character run is unreadable. Nothing about the format
/// is secret: it is the stored key, presented.
pub fn format_recovery_key(hex: &str) -> String {
    let upper = hex.to_ascii_uppercase();
    let mut out = String::with_capacity(PREFIX.len() + upper.len() + upper.len() / GROUP);
    out.push_str(PREFIX);
    for (i, ch) in upper.chars().enumerate() {
        if i % GROUP == 0 {
            out.push('-');
        }
        out.push(ch);
    }
    out
}

/// `HLX1-1A2B-...` (or anything close enough) -> the 64 lowercase hex characters.
///
/// Forgiving about everything that is not the key: the prefix is optional, and
/// dashes, spaces, tabs and newlines are ignored wherever they fall, because a
/// key that has been through a text file, an email and a paste box collects
/// whitespace. Not forgiving about the key itself: a character that is not a
/// hex digit is a typo, and reporting it is better than silently dropping it
/// and then blaming the backup file.
pub fn parse_recovery_key(input: &str) -> AppResult<String> {
    let cleaned: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .collect();
    let upper = cleaned.to_ascii_uppercase();
    let body = upper.strip_prefix(PREFIX).unwrap_or(&upper);

    if body.is_empty() {
        return Err(AppError::secret(
            "Enter the recovery key from the machine this backup came from.",
        ));
    }
    if let Some(bad) = body.chars().find(|c| !c.is_ascii_hexdigit()) {
        return Err(AppError::secret(format!(
            "A recovery key is made of the digits 0-9 and the letters A-F. \
             This one contains {bad:?}. Check it against what you wrote down."
        )));
    }
    if body.len() != 64 {
        return Err(AppError::secret(format!(
            "A recovery key has 64 characters after the dashes are taken out. \
             This one has {}. Check it against what you wrote down.",
            body.len()
        )));
    }
    Ok(body.to_ascii_lowercase())
}

/// The text of the file the owner saves. Plain, printable, and it says what the
/// thing is for and what it is worth to someone who finds it.
pub fn recovery_key_file_contents(workspace_name: &str, key: &str, written_at: &str) -> String {
    format!(
        "Helix CRM recovery key\n\
         ======================\n\n\
         Workspace: {workspace_name}\n\
         Written:   {written_at}\n\n\
         {key}\n\n\
         What this is\n\
         ------------\n\
         Helix keeps your CRM in one encrypted file, and keeps every backup of it\n\
         encrypted the same way. This is the key. Without it, a backup cannot be\n\
         opened on any machine except the one that made it.\n\n\
         What to do with it\n\
         ------------------\n\
         Keep it somewhere that is not this computer: a password manager, a printed\n\
         copy in a drawer, a note in a safe. If this computer is lost, stolen or\n\
         replaced, you will need this key and one of your backup files to get your\n\
         data back.\n\n\
         To use it: install Helix on the new machine, open Settings, then Backups,\n\
         then \"Open a backup from another machine\". Choose the backup file and type\n\
         this key.\n\n\
         Keep it private\n\
         ---------------\n\
         Anyone who has both this key and a copy of one of your backup files can read\n\
         everything in your CRM. Do not email it to yourself and do not store it in\n\
         the same place as your backups.\n"
    )
}

// ---------------------------------------------------------------------------
// Reading a candidate file
// ---------------------------------------------------------------------------

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

/// Open `path` read-only with `key` and prove the key is the right one.
///
/// SQLCipher accepts any key and only finds out when it decrypts page 1, so the
/// read is the test. Read-only because at this point in the flow the file is
/// still the owner's only copy, and nothing should be able to write to it.
fn open_with_key(path: &Path, key: &DbKey) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| {
        AppError::new(
            Code::DbOpenFailed,
            format!("Could not open {}: {}", path.display(), e),
        )
    })?;
    conn.execute_batch(&key.key_pragma()).map_err(|e| {
        AppError::new(
            Code::DbOpenFailed,
            format!("Could not unlock {}: {}", path.display(), e),
        )
    })?;
    conn.query_row("SELECT count(*) FROM sqlite_schema", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| {
        AppError::new(
            Code::DbOpenFailed,
            "That recovery key does not open this file. Check the key, and check \
             that the file came from the workspace the key belongs to. Nothing \
             has been changed."
                .to_string(),
        )
    })?;
    Ok(conn)
}

/// Is this a Helix workspace rather than some other SQLite file the owner picked?
///
/// `schema_migrations` is the migrator's own table and `contacts` is in the very
/// first migration, so between them they identify a Helix file of any version
/// this app has ever written.
fn looks_like_helix(conn: &Connection) -> AppResult<()> {
    let found: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE type = 'table' \
             AND name IN ('schema_migrations', 'contacts')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| AppError::new(Code::DbOpenFailed, format!("Could not read the file: {e}")))?;
    if found == 0 {
        return Err(AppError::new(
            Code::DbOpenFailed,
            "That key opened the file, but it is not a Helix workspace. Choose a \
             .db file from a workspace's backups folder."
                .to_string(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Adopting
// ---------------------------------------------------------------------------

/// Copy an encrypted Helix file into a new workspace on this machine and teach
/// this machine's keychain the key that opens it.
///
/// Split out from the command so the tests can drive it with a temp
/// `workspaces_dir` and an id of their own, the same way `files.rs` splits
/// `copy_into_workspace` out of `copy_in`.
///
/// Order matters and is the same shape as the one-time encryption migration in
/// `db.rs`: prove first, write second, and undo the write if the proof fails
/// afterwards. Nothing is ever deleted from the source.
pub fn adopt_backup(
    workspaces_dir: &Path,
    source: &Path,
    recovery_key: &str,
    new_workspace_id: &str,
) -> AppResult<AdoptedWorkspace> {
    let hex = parse_recovery_key(recovery_key)?;
    let key = DbKey::from_recovery_hex(&hex)?;

    if !source.is_file() {
        return Err(AppError::io(format!(
            "There is no file at {}.",
            source.display()
        )));
    }
    if is_plaintext_file(source) {
        return Err(AppError::new(
            Code::DbOpenFailed,
            "That file is not encrypted, so it is not a backup this key belongs \
             to. Choose a .db file from a workspace's backups folder."
                .to_string(),
        ));
    }

    // Prove it before anything is created.
    {
        let conn = open_with_key(source, &key)?;
        looks_like_helix(&conn)?;
    }

    let dir = workspaces_dir.join(new_workspace_id);
    if dir.exists() {
        return Err(AppError::io(format!(
            "A workspace folder already exists at {}. Helix has not written to it.",
            dir.display()
        )));
    }
    if secrets::has_db_key(new_workspace_id)? {
        return Err(AppError::secret(format!(
            "This machine already has a key for workspace {new_workspace_id}. \
             Helix has not written anything."
        )));
    }

    fs::create_dir_all(&dir)
        .map_err(|e| AppError::io(format!("Could not create {}: {}", dir.display(), e)))?;

    let db_path = dir.join("helix.db");
    let finish = adopt_into(&db_path, source, &key, new_workspace_id);
    if finish.is_err() {
        // Undo both halves. The folder was made by this call and holds nothing
        // but the copy, and the keychain entry is for an id that has never been
        // used, so neither removal can orphan anyone's data. This is the one
        // place in the app allowed to delete a dbkey entry, and only its own.
        let _ = fs::remove_dir_all(&dir);
        let _ = secrets::delete(new_workspace_id, "dbkey");
    }
    finish?;

    Ok(AdoptedWorkspace {
        workspace_id: new_workspace_id.to_string(),
        path: db_path.to_string_lossy().to_string(),
    })
}

/// The part that writes, so the caller above has one place to undo.
fn adopt_into(
    db_path: &Path,
    source: &Path,
    key: &DbKey,
    new_workspace_id: &str,
) -> AppResult<()> {
    fs::copy(source, db_path).map_err(|e| {
        AppError::io(format!(
            "Could not copy the backup to {}: {}",
            db_path.display(),
            e
        ))
    })?;

    secrets::put_db_key(new_workspace_id, key)?;

    // The proof that matters: not "the key I was handed opens the copy", which
    // is already known, but "the key this machine will fetch from its own
    // keychain on the next launch opens the copy". That is the whole point of
    // the exercise, and it is one round trip through the store.
    let stored = secrets::db_key(new_workspace_id)?;
    let conn = open_with_key(db_path, &stored)?;
    looks_like_helix(&conn)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn open_workspace_id(db: &Db) -> AppResult<String> {
    let path: PathBuf = db.open_path().ok_or_else(AppError::db_closed)?;
    workspace_id_from_db_path(&path)
}

/// The recovery key for the workspace that is open right now.
///
/// Deliberately not "for any workspace id the frontend names": the only key the
/// owner can be shown is the one for the file they are looking at.
/// `workspace_name` and `written_at` are display strings for the saved file and
/// nothing else; the key itself comes from the keychain, not from the caller.
#[tauri::command(async)]
pub fn recovery_key_reveal(
    db: State<'_, Db>,
    workspace_name: String,
    written_at: String,
) -> AppResult<RecoveryKey> {
    let workspace_id = open_workspace_id(&db)?;
    let key = secrets::db_key(&workspace_id)?;
    let formatted = format_recovery_key(&key.expose_for_recovery());
    let file_text = recovery_key_file_contents(&workspace_name, &formatted, &written_at);
    Ok(RecoveryKey {
        key: formatted,
        file_text,
    })
}

/// Open a backup that came from another machine, as a new workspace here.
#[tauri::command(async)]
pub fn workspace_adopt_backup(
    app: AppHandle,
    source_path: String,
    recovery_key: String,
) -> AppResult<AdoptedWorkspace> {
    let paths = crate::files::paths(&app)?;
    // Minted here, never taken from JS: this string becomes a folder name.
    let new_workspace_id = uuid::Uuid::now_v7().to_string();
    adopt_backup(
        Path::new(&paths.workspaces_dir),
        Path::new(&source_path),
        &recovery_key,
        &new_workspace_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn the_format_is_grouped_and_prefixed() {
        let formatted = format_recovery_key(HEX);
        assert!(formatted.starts_with("HLX1-"));
        assert_eq!(formatted.matches('-').count(), 16);
        assert_eq!(formatted.len(), 4 + 16 + 64);
        assert!(formatted.contains("0123-4567"));
    }

    #[test]
    fn a_formatted_key_parses_back_to_what_it_came_from() {
        assert_eq!(parse_recovery_key(&format_recovery_key(HEX)).unwrap(), HEX);
    }

    #[test]
    fn whitespace_case_and_a_missing_prefix_are_all_forgiven() {
        let messy = format!("  {}\n", format_recovery_key(HEX).to_ascii_lowercase());
        assert_eq!(parse_recovery_key(&messy).unwrap(), HEX);
        assert_eq!(parse_recovery_key(HEX).unwrap(), HEX);
        assert_eq!(
            parse_recovery_key(&HEX.to_ascii_uppercase()).unwrap(),
            HEX
        );
    }

    #[test]
    fn a_typo_is_named_rather_than_dropped() {
        let mut typo = format_recovery_key(HEX);
        typo.replace_range(5..6, "G");
        let err = parse_recovery_key(&typo).unwrap_err();
        assert!(err.message.contains("0-9"), "{}", err.message);
        assert!(err.message.contains("'G'"), "{}", err.message);
    }

    #[test]
    fn a_short_key_says_how_short() {
        let err = parse_recovery_key("HLX1-0123-4567").unwrap_err();
        assert!(err.message.contains("64"), "{}", err.message);
        assert!(err.message.contains("has 8"), "{}", err.message);
    }

    #[test]
    fn an_empty_key_asks_for_one() {
        let err = parse_recovery_key("   ").unwrap_err();
        assert!(err.message.contains("Enter the recovery key"), "{}", err.message);
    }

    #[test]
    fn the_saved_file_says_what_it_is_and_what_it_is_worth() {
        let text = recovery_key_file_contents("My business", &format_recovery_key(HEX), "2026-09-20");
        assert!(text.contains("HLX1-"));
        assert!(text.contains("My business"));
        assert!(text.contains("Anyone who has both this key"));
        assert!(text.contains("Open a backup from another machine"));
    }
}
