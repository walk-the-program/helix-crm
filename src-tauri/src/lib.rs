//! The Helix shell.
//!
//! Registers the plugins, the managed database pipe, and every command the
//! frontend can call. Nothing else runs here: screens never touch SQL, and the
//! only paths and origins this process will act on are the ones it works out
//! for itself.

pub mod db;
pub mod error;
pub mod files;
pub mod leads;
pub mod secrets;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::Manager;

/// The log folder keeps a week (`RotationStrategy::KeepSome`), and anything
/// older that survived a crash or a clock change is swept on launch.
const LOG_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MAX_LOG_BYTES: u128 = 4 * 1024 * 1024;

fn log_plugin<R: tauri::Runtime>(dir: PathBuf) -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind};

    let mut builder = Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::Folder {
            path: dir,
            file_name: Some("helix".into()),
        }))
        .rotation_strategy(RotationStrategy::KeepSome(7))
        .max_file_size(MAX_LOG_BYTES)
        .level(tauri_plugin_log::log::LevelFilter::Info);

    if cfg!(debug_assertions) {
        builder = builder.target(Target::new(TargetKind::Stdout));
    }
    builder.build()
}

fn sweep_old_logs(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let is_log = entry
            .path()
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("log"));
        if !is_log {
            continue;
        }
        let too_old = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|m| now.duration_since(m).unwrap_or_default() > LOG_RETENTION)
            .unwrap_or(false);
        if too_old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single instance has to be registered first so a second launch is handed
    // to the running window instead of opening a second copy on the same
    // SQLite file.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(db::Db::new())
        .setup(|app| {
            // The log plugin needs a resolved path, which needs a handle, so it
            // is registered here rather than in the chain above.
            let log_dir = app.path().app_data_dir()?.join("logs");
            std::fs::create_dir_all(&log_dir)?;
            sweep_old_logs(&log_dir);
            app.handle().plugin(log_plugin(log_dir))?;
            tauri_plugin_log::log::info!("Helix {} starting", app.package_info().version);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_close,
            db::db_query,
            db::db_execute,
            db::db_begin,
            db::db_commit,
            db::db_rollback,
            db::db_batch,
            db::db_backup,
            db::db_info,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            leads::leads_fetch,
            files::copy_in,
            files::app_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
