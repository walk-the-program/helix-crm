//! Attachments and app paths.
//!
//! `copy_in` chooses the destination in Rust: the frontend passes the file the
//! user picked and gets back a stored name, never a write path. The original
//! path is used for reading and for the extension only; nothing else about it
//! is trusted.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::db::Db;
use crate::error::{AppError, AppResult};

/// Matches the AttachmentTooLarge copy in the error map.
pub const MAX_ATTACHMENT_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    pub stored_name: String,
    pub bytes: u64,
    pub mime: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub app_data: String,
    pub workspaces_dir: String,
}

/// Keep at most a short, lowercase, alphanumeric extension. A file called
/// `notes.tar.gz` stores as `<uuid>.gz`; the display name lives in the
/// `attachments` row, not on disk.
fn safe_extension(src: &Path) -> Option<String> {
    let ext = src.extension()?.to_string_lossy().to_ascii_lowercase();
    let cleaned: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if cleaned.is_empty() || cleaned.len() > 12 {
        None
    } else {
        Some(cleaned)
    }
}

/// How much to read/write in one step of `bounded_copy`. Small enough that a
/// cap violation is caught quickly, large enough not to make an ordinary
/// multi-megabyte attachment slow to copy.
const COPY_CHUNK_BYTES: usize = 256 * 1024;

/// Copies `src` into `dest`, refusing - and cleaning up the partial file -
/// the moment more than `max_bytes` have actually been read, independently
/// of whatever `fs::metadata` reported before the copy started.
///
/// `fs::copy` alone trusts the size it (or its caller) stat'd at the top of
/// the function. This does not: a source that grows between that stat and
/// the finish of the copy - a network-mounted file being appended to, a
/// symlink swapped underneath the copy - would otherwise land a file over
/// the cap on disk with the cap only ever having been checked before a
/// single byte moved (LR-SEC-W1 item 8).
fn bounded_copy(src: &Path, dest: &Path, max_bytes: u64) -> AppResult<u64> {
    let mut reader =
        fs::File::open(src).map_err(|e| AppError::io(format!("Can't read {}: {}", src.display(), e)))?;
    let mut writer = fs::File::create(dest)
        .map_err(|e| AppError::io(format!("Can't write {}: {}", dest.display(), e)))?;

    let mut buf = vec![0u8; COPY_CHUNK_BYTES];
    let mut total: u64 = 0;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| AppError::io(format!("Can't read {}: {}", src.display(), e)))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > max_bytes {
            drop(writer);
            let _ = fs::remove_file(dest);
            return Err(AppError::io(format!(
                "That file grew past the {:.0} MB limit while Helix was copying it.",
                max_bytes as f64 / (1024.0 * 1024.0)
            )));
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| AppError::io(format!("Can't write {}: {}", dest.display(), e)))?;
    }
    writer
        .flush()
        .map_err(|e| AppError::io(format!("Can't write {}: {}", dest.display(), e)))?;
    Ok(total)
}

pub fn copy_into_workspace(workspace_dir: &Path, src: &Path) -> AppResult<StoredFile> {
    let meta = fs::metadata(src)
        .map_err(|e| AppError::io(format!("Can't read {}: {}", src.display(), e)))?;
    if !meta.is_file() {
        return Err(AppError::io(format!(
            "{} is not a file.",
            src.display()
        )));
    }
    let bytes = meta.len();
    if bytes > MAX_ATTACHMENT_BYTES {
        return Err(AppError::io(format!(
            "That file is {:.1} MB. Attachments are limited to 50 MB.",
            bytes as f64 / (1024.0 * 1024.0)
        )));
    }

    let dir = workspace_dir.join("attachments");
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::io(format!("Can't create {}: {}", dir.display(), e)))?;

    let stored_name = match safe_extension(src) {
        Some(ext) => format!("{}.{}", Uuid::now_v7(), ext),
        None => Uuid::now_v7().to_string(),
    };
    let dest = dir.join(&stored_name);

    // The stat above is a fast pre-check, not the enforcement: `bounded_copy`
    // re-checks the same cap against bytes actually moved, so a file that
    // grows after the stat still cannot land on disk over the limit.
    let copied_bytes = bounded_copy(src, &dest, MAX_ATTACHMENT_BYTES)?;

    let mime = mime_guess::from_path(src)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_string();

    Ok(StoredFile {
        stored_name,
        bytes: copied_bytes,
        mime,
    })
}

fn workspace_dir(db: &Db) -> AppResult<PathBuf> {
    db.open_path()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .ok_or_else(AppError::db_closed)
}

pub fn paths(app: &AppHandle) -> AppResult<AppPaths> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::io(format!("Can't work out the app data folder: {e}")))?;
    let workspaces = app_data.join("workspaces");
    fs::create_dir_all(&workspaces)
        .map_err(|e| AppError::io(format!("Can't create {}: {}", workspaces.display(), e)))?;
    Ok(AppPaths {
        app_data: app_data.to_string_lossy().to_string(),
        workspaces_dir: workspaces.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn copy_in(db: State<'_, Db>, src: String) -> AppResult<StoredFile> {
    let dir = workspace_dir(&db)?;
    copy_into_workspace(&dir, Path::new(&src))
}

#[tauri::command(async)]
pub fn app_paths(app: AppHandle) -> AppResult<AppPaths> {
    paths(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_are_reduced_to_something_safe() {
        assert_eq!(safe_extension(Path::new("a.PDF")).as_deref(), Some("pdf"));
        assert_eq!(safe_extension(Path::new("a.tar.gz")).as_deref(), Some("gz"));
        assert_eq!(safe_extension(Path::new("noext")), None);
        assert_eq!(safe_extension(Path::new("a.verylongextension")), None);
        assert_eq!(safe_extension(Path::new("a.p df")).as_deref(), Some("pdf"));
    }

    #[test]
    fn copies_with_a_uuid_name_and_guessed_mime() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("018f-abcd");
        fs::create_dir_all(&ws).unwrap();
        let src = tmp.path().join("quote.pdf");
        fs::File::create(&src).unwrap().write_all(b"%PDF-1.4").unwrap();

        let stored = copy_into_workspace(&ws, &src).unwrap();
        assert!(stored.stored_name.ends_with(".pdf"));
        assert_ne!(stored.stored_name, "quote.pdf");
        assert_eq!(stored.bytes, 8);
        assert_eq!(stored.mime, "application/pdf");
        assert!(ws.join("attachments").join(&stored.stored_name).is_file());
    }

    #[test]
    fn oversize_files_are_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let src = tmp.path().join("big.bin");
        let f = fs::File::create(&src).unwrap();
        f.set_len(MAX_ATTACHMENT_BYTES + 1).unwrap();
        drop(f);

        let err = copy_into_workspace(&ws, &src).unwrap_err();
        assert_eq!(err.code, "IO_ERROR");
        assert!(err.message.contains("50 MB"));
        assert!(!ws.join("attachments").exists());
    }

    #[test]
    fn a_missing_source_is_an_io_error() {
        let tmp = tempfile::tempdir().unwrap();
        let err = copy_into_workspace(tmp.path(), &tmp.path().join("nope.png")).unwrap_err();
        assert_eq!(err.code, "IO_ERROR");
    }

    /* ---------------------------------------------------------------- */
    /* hostile source names (LR-SEC-W1 item 8)                           */
    /*                                                                    */
    /* The destination is always <workspace>/attachments/<uuid>.<ext> -   */
    /* never derived from `src` beyond the extension - so none of these   */
    /* can escape the workspace on write. `src` is only ever read from,   */
    /* and reading a path that merely looks like a traversal string is    */
    /* not itself dangerous; these tests prove the destination stays put  */
    /* and that nothing here panics.                                     */
    /* ---------------------------------------------------------------- */

    #[test]
    fn a_source_path_shaped_like_a_traversal_only_affects_reading_never_the_destination() {
        let tmp = tempfile::tempdir().unwrap();
        let nested = tmp.path().join("a/b");
        fs::create_dir_all(&nested).unwrap();
        let real_file = nested.join("evil.pdf");
        fs::write(&real_file, b"%PDF-1.4").unwrap();

        let ws = tmp.path().join("workspace");
        fs::create_dir_all(&ws).unwrap();

        // Shaped exactly like a hostile `src` string: walks back up out of
        // the workspace and into a sibling directory.
        let traversal_src = ws.join("../a/b/../b/evil.pdf");
        assert!(
            traversal_src.exists(),
            "the traversal path must resolve to the real file for this test to mean anything"
        );

        let stored = copy_into_workspace(&ws, &traversal_src).unwrap();
        let dest = ws.join("attachments").join(&stored.stored_name);
        assert!(dest.is_file());
        assert!(stored.stored_name.ends_with(".pdf"));
        assert_ne!(stored.stored_name, "evil.pdf");
        // The attachments directory holds exactly the one file this copy made.
        assert_eq!(fs::read_dir(ws.join("attachments")).unwrap().count(), 1);
    }

    #[test]
    fn a_source_name_containing_a_literal_backslash_is_handled_safely() {
        // On macOS/Linux a backslash is an ordinary filename character, not
        // a separator, so this creates one real file whose name happens to
        // look like a Windows traversal string (`..\evil.pdf`).
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let src = tmp.path().join("..\\evil.pdf");
        fs::write(&src, b"%PDF-1.4").unwrap();

        let stored = copy_into_workspace(&ws, &src).unwrap();
        assert!(stored.stored_name.ends_with(".pdf"));
        assert!(ws.join("attachments").join(&stored.stored_name).is_file());
    }

    #[test]
    fn a_source_named_like_a_windows_reserved_device_name_is_just_a_file_here() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let src = tmp.path().join("CON");
        fs::write(&src, b"hello").unwrap();

        let stored = copy_into_workspace(&ws, &src).unwrap();
        // No extension to preserve, and the stored file is never itself
        // named "CON" - it is always a fresh UUID.
        assert!(!stored.stored_name.to_ascii_uppercase().contains("CON"));
        assert!(ws.join("attachments").join(&stored.stored_name).is_file());
    }

    #[test]
    fn prn_txt_keeps_its_extension_but_not_its_reserved_stem() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let src = tmp.path().join("PRN.txt");
        fs::write(&src, b"hello").unwrap();

        let stored = copy_into_workspace(&ws, &src).unwrap();
        assert!(stored.stored_name.ends_with(".txt"));
        assert!(!stored.stored_name.to_ascii_uppercase().starts_with("PRN"));
    }

    #[test]
    fn a_trailing_space_in_the_extension_is_dropped() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let src = tmp.path().join("a.pdf ");
        fs::write(&src, b"%PDF-1.4").unwrap();

        let stored = copy_into_workspace(&ws, &src).unwrap();
        assert!(stored.stored_name.ends_with(".pdf"));
        assert!(!stored.stored_name.contains(' '));
    }

    #[cfg(unix)]
    #[test]
    fn a_source_path_with_an_embedded_nul_fails_cleanly_instead_of_panicking() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::{OsStrExt, OsStringExt};

        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();

        let mut bytes = tmp.path().join("bad").into_os_string().into_vec();
        bytes.push(0);
        bytes.extend_from_slice(b"name.pdf");
        let bad = std::path::PathBuf::from(OsStr::from_bytes(&bytes));

        let err = copy_into_workspace(&ws, &bad).unwrap_err();
        assert_eq!(err.code, "IO_ERROR");
    }

    #[test]
    fn a_very_long_source_name_is_handled_without_panicking() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let long_stem = "a".repeat(290);
        let src = tmp.path().join(format!("{long_stem}.pdf"));

        // Some filesystems refuse a component this long outright; either a
        // clean success or a clean IO_ERROR is fine here, a panic is not.
        match fs::write(&src, b"%PDF-1.4") {
            Ok(()) => {
                if let Ok(stored) = copy_into_workspace(&ws, &src) {
                    assert!(stored.stored_name.ends_with(".pdf"));
                    assert!(ws.join("attachments").join(&stored.stored_name).is_file());
                }
            }
            Err(_) => {
                // The filesystem itself refused the fixture; nothing to
                // exercise, but reaching this line already proves no panic.
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /* bounded_copy - the cap is enforced during the copy, not only      */
    /* before it (a stat/copy TOCTOU defence, LR-SEC-W1 item 8)          */
    /* ---------------------------------------------------------------- */

    #[test]
    fn bounded_copy_enforces_the_cap_during_the_copy_not_just_before_it() {
        // Stands in for a stat-time/copy-time race: a caller whose pre-check
        // already passed against a bigger, stale size. `bounded_copy` must
        // still refuse once the bytes it is actually moving cross the
        // limit, and must not leave a partial file behind.
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("grows.bin");
        fs::write(&src, vec![7u8; 10_000]).unwrap();
        let dest = tmp.path().join("out.bin");

        let err = bounded_copy(&src, &dest, 100).unwrap_err();
        assert_eq!(err.code, "IO_ERROR");
        assert!(!dest.exists(), "a partial file must not be left behind");
    }

    #[test]
    fn bounded_copy_succeeds_and_reports_the_real_byte_count() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("ok.bin");
        fs::write(&src, vec![1u8; 500]).unwrap();
        let dest = tmp.path().join("out.bin");

        let n = bounded_copy(&src, &dest, 1000).unwrap();
        assert_eq!(n, 500);
        assert_eq!(fs::metadata(&dest).unwrap().len(), 500);
    }
}
