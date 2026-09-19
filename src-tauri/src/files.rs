//! Attachments and app paths.
//!
//! `copy_in` chooses the destination in Rust: the frontend passes the file the
//! user picked and gets back a stored name, never a write path. The original
//! path is used for reading and for the extension only; nothing else about it
//! is trusted.

use std::fs;
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

    fs::copy(src, &dest)
        .map_err(|e| AppError::io(format!("Can't copy into {}: {}", dir.display(), e)))?;

    let mime = mime_guess::from_path(src)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_string();

    Ok(StoredFile {
        stored_name,
        bytes,
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
    use std::io::Write;

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
}
