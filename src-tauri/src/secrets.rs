//! Secrets live in the OS keychain, never in SQLite and never in a config file.
//!
//! macOS Keychain and Windows Credential Manager, reached through the `keyring`
//! crate with the native backends selected explicitly (keyring 3 ships none by
//! default). Service `helix`, user `<workspaceId>:<kind>`, so two workspaces
//! pointed at two different sites keep separate tokens.
//!
//! Known gotcha, documented for the user in CONTRIBUTING: an unsigned macOS
//! build changes identity on every rebuild, so the Keychain prompt reappears
//! after each dev build until signing (TODO E5) lands.
//!
//! There is no plaintext fallback. If the keychain is unavailable the caller
//! gets SECRET_ERROR and the features that need a secret stay switched off.

use keyring::Entry;
use serde::Serialize;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "helix";

#[derive(Debug, Clone, Serialize)]
pub struct SecretValue {
    pub value: Option<String>,
}

/// `kind` is `"anthropic"` or `"site"`. It is validated rather than trusted so
/// the frontend cannot invent an unbounded set of keychain entries.
fn entry(workspace_id: &str, kind: &str) -> AppResult<Entry> {
    if workspace_id.trim().is_empty() {
        return Err(AppError::secret("No workspace id was given."));
    }
    if !matches!(kind, "anthropic" | "site") {
        return Err(AppError::secret(format!(
            "Unknown secret kind {kind:?}; expected \"anthropic\" or \"site\"."
        )));
    }
    let user = format!("{workspace_id}:{kind}");
    Entry::new(SERVICE, &user).map_err(|e| {
        AppError::secret(format!(
            "Can't reach the keychain for {user}: {e}"
        ))
    })
}

pub fn set(workspace_id: &str, kind: &str, value: &str) -> AppResult<()> {
    entry(workspace_id, kind)?
        .set_password(value)
        .map_err(|e| AppError::secret(format!("Can't save the key securely on this machine: {e}")))
}

/// A missing entry is not an error: it is `None`, which is what "no token yet"
/// looks like to the settings screen.
pub fn get(workspace_id: &str, kind: &str) -> AppResult<SecretValue> {
    match entry(workspace_id, kind)?.get_password() {
        Ok(value) => Ok(SecretValue { value: Some(value) }),
        Err(keyring::Error::NoEntry) => Ok(SecretValue { value: None }),
        Err(e) => Err(AppError::secret(format!("Can't read from the keychain: {e}"))),
    }
}

/// Deleting something that is not there succeeds, so the settings screen can
/// clear a field without checking first.
pub fn delete(workspace_id: &str, kind: &str) -> AppResult<()> {
    match entry(workspace_id, kind)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::secret(format!(
            "Can't remove the key from the keychain: {e}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn secret_set(workspace_id: String, kind: String, value: String) -> AppResult<()> {
    set(&workspace_id, &kind, &value)
}

#[tauri::command(async)]
pub fn secret_get(workspace_id: String, kind: String) -> AppResult<SecretValue> {
    get(&workspace_id, &kind)
}

#[tauri::command(async)]
pub fn secret_delete(workspace_id: String, kind: String) -> AppResult<()> {
    delete(&workspace_id, &kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_is_validated() {
        assert!(entry("ws", "anthropic").is_ok());
        assert!(entry("ws", "site").is_ok());
        let err = entry("ws", "../../root").unwrap_err();
        assert_eq!(err.code, "SECRET_ERROR");
        assert!(entry("", "site").is_err());
    }
}
