//! A second copy of the backups, in a folder the owner chooses.
//!
//! `db_backup` writes every backup next to the live database, inside the
//! workspace folder. That is a backup of a mistake - a deleted contact, a bad
//! import, a restore gone wrong - and it is not a backup of a disk. One failed
//! SSD, one stolen laptop, one spilled coffee, and thirty days of backups go
//! with the original.
//!
//! So: one setting, one folder, one command.
//!
//! ```text
//!   <workspace>/backups/                      <chosen folder>/Helix backups/<workspace id>/
//!     2026-09-20T06-00-00Z-scheduled.db  -->    2026-09-20T06-00-00Z-scheduled.db
//!     2026-09-20T12-00-00Z-scheduled.db  -->    2026-09-20T12-00-00Z-scheduled.db
//!     (2026-09-13...  pruned by retention)      (removed here too)
//! ```
//!
//! The destination is made to MATCH the source rather than accumulate, so the
//! thirty-day retention the app already applies is the only retention rule that
//! exists. Otherwise a synced folder grows forever and nobody notices until
//! iCloud says it is full.
//!
//! What it will and will not delete: only files directly inside
//! `<chosen folder>/Helix backups/<workspace id>/`, only files ending in `.db`,
//! and only when the source folder no longer has a file of that name. A folder
//! Helix created, holding files Helix wrote. It never touches anything the
//! owner put there and never recurses.
//!
//! This adds no network call. A synced folder is the owner's own Dropbox,
//! iCloud Drive or OneDrive doing what it already does with every other folder
//! on the machine; Helix writes a file and stops. The copy is the same
//! SQLCipher-encrypted file, so what reaches the sync provider is ciphertext,
//! and opening it anywhere else needs the recovery key (`recovery.rs`).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};

/// The folder Helix makes inside whatever the owner picked, so its files are
/// never mixed in with theirs.
const MIRROR_ROOT: &str = "Helix backups";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorResult {
    /// Where the copies went, so the screen can show it back.
    pub path: String,
    pub copied: u32,
    pub removed: u32,
    /// Files that could not be copied, by name and reason. A drive that is not
    /// plugged in is one entry, not an exception: the backup itself succeeded
    /// and the owner needs to be told, not stopped.
    pub failed: Vec<String>,
}

fn is_backup_file(name: &str) -> bool {
    name.ends_with(".db") && !name.starts_with('.')
}

/// True when `inner` is `outer` or sits underneath it, after both have been
/// resolved as far as the filesystem allows.
fn is_inside(inner: &Path, outer: &Path) -> bool {
    let a = fs::canonicalize(inner).unwrap_or_else(|_| inner.to_path_buf());
    let b = fs::canonicalize(outer).unwrap_or_else(|_| outer.to_path_buf());
    a.starts_with(&b)
}

/// Make `dest` hold exactly the `.db` files `source` holds.
///
/// Split out from the command so the tests can drive it with two temp folders.
pub fn mirror_folder(source: &Path, dest: &Path) -> AppResult<MirrorResult> {
    fs::create_dir_all(dest)
        .map_err(|e| AppError::io(format!("Could not create {}: {}", dest.display(), e)))?;

    let mut wanted: HashSet<String> = HashSet::new();
    let mut copied = 0u32;
    let mut failed: Vec<String> = Vec::new();

    let entries = fs::read_dir(source).map_err(|e| {
        AppError::io(format!(
            "Could not read the backups folder {}: {}",
            source.display(),
            e
        ))
    })?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_backup_file(&name) || !entry.path().is_file() {
            continue;
        }
        wanted.insert(name.clone());

        let from = entry.path();
        let to = dest.join(&name);

        // A backup file never changes after it is written, so a copy that is
        // already there with the same size is the same copy. This is what keeps
        // a six-hourly mirror from rewriting thirty days of files onto a sync
        // provider every time.
        let same = fs::metadata(&to)
            .ok()
            .zip(fs::metadata(&from).ok())
            .map(|(a, b)| a.len() == b.len())
            .unwrap_or(false);
        if same {
            continue;
        }

        match fs::copy(&from, &to) {
            Ok(_) => copied += 1,
            Err(e) => failed.push(format!("{name}: {e}")),
        }
    }

    // Anything here that is not there any more: the app's own retention has
    // dropped it, and this folder follows.
    let mut removed = 0u32;
    if let Ok(existing) = fs::read_dir(dest) {
        for entry in existing.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_backup_file(&name) || wanted.contains(&name) || !entry.path().is_file() {
                continue;
            }
            if fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }

    Ok(MirrorResult {
        path: dest.to_string_lossy().to_string(),
        copied,
        removed,
        failed,
    })
}

/// Copy the open workspace's backups into `dest_dir`.
///
/// The source is derived in Rust from the open database's path, the same way
/// `copy_in` derives the attachments folder: JS names the destination and
/// nothing else.
#[tauri::command(async)]
pub fn backup_mirror(db: State<'_, Db>, dest_dir: String) -> AppResult<MirrorResult> {
    let db_path = db.open_path().ok_or_else(AppError::db_closed)?;
    let workspace_dir = db_path
        .parent()
        .ok_or_else(|| AppError::io("The open database has no folder."))?
        .to_path_buf();
    let workspace_id = workspace_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string());

    let source = workspace_dir.join("backups");
    if !source.is_dir() {
        return Err(AppError::io(
            "This workspace has no backups yet. Take one first.",
        ));
    }

    let chosen = PathBuf::from(&dest_dir);
    if !chosen.is_dir() {
        return Err(AppError::io(format!(
            "Helix cannot reach {dest_dir}. If it is on a drive or a shared folder, \
             connect it and try again."
        )));
    }
    if is_inside(&chosen, &workspace_dir) {
        return Err(AppError::io(
            "Choose a folder outside the workspace. A second copy on the same \
             disk is not a second copy.",
        ));
    }

    mirror_folder(&source, &chosen.join(MIRROR_ROOT).join(workspace_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        out.sort();
        out
    }

    #[test]
    fn it_copies_what_is_missing_and_removes_what_is_gone() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("backups");
        let dest = tmp.path().join("mirror");
        write(&source.join("2026-09-20T06-00-00Z-scheduled.db"), b"one");
        write(&dest.join("2026-09-01T06-00-00Z-scheduled.db"), b"old");

        let result = mirror_folder(&source, &dest).unwrap();

        assert_eq!(result.copied, 1);
        assert_eq!(result.removed, 1);
        assert!(result.failed.is_empty());
        assert_eq!(names(&dest), vec!["2026-09-20T06-00-00Z-scheduled.db"]);
    }

    #[test]
    fn a_file_already_there_is_not_copied_again() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("backups");
        let dest = tmp.path().join("mirror");
        write(&source.join("a.db"), b"same bytes");

        assert_eq!(mirror_folder(&source, &dest).unwrap().copied, 1);
        let second = mirror_folder(&source, &dest).unwrap();
        assert_eq!(second.copied, 0, "a backup file never changes after it is written");
        assert_eq!(second.removed, 0);
    }

    #[test]
    fn it_leaves_the_owners_own_files_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("backups");
        let dest = tmp.path().join("mirror");
        write(&source.join("a.db"), b"x");
        write(&dest.join("tax return.pdf"), b"not ours");
        write(&dest.join("notes.txt"), b"not ours");

        let result = mirror_folder(&source, &dest).unwrap();

        assert_eq!(result.removed, 0);
        assert_eq!(names(&dest), vec!["a.db", "notes.txt", "tax return.pdf"]);
    }

    #[test]
    fn the_destination_is_created_if_it_is_not_there() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("backups");
        write(&source.join("a.db"), b"x");
        let dest = tmp.path().join("drive").join("Helix backups").join("018f");

        mirror_folder(&source, &dest).unwrap();
        assert!(dest.join("a.db").is_file());
    }

    #[test]
    fn a_missing_source_folder_is_an_error_rather_than_a_silent_success() {
        let tmp = tempfile::tempdir().unwrap();
        let err = mirror_folder(&tmp.path().join("nope"), &tmp.path().join("mirror")).unwrap_err();
        assert!(err.message.contains("Could not read the backups folder"));
    }
}
