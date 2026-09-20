//! Secrets live in the OS keychain, never in SQLite and never in a config file.
//!
//! macOS Keychain and Windows Credential Manager, reached through the `keyring`
//! crate with the native backends selected explicitly (keyring 3 ships none by
//! default). Service `helix`, user `<workspaceId>:<kind>`, so two workspaces
//! pointed at two different sites keep separate tokens.
//!
//! Three kinds:
//!
//! ```text
//!   "anthropic"  the API key         set/read/cleared by the AI settings screen
//!   "site"       the site bearer     set/read/cleared by the site connection screen
//!   "dbkey"      the SQLCipher key   created by db_open, never crosses to JS
//! ```
//!
//! `dbkey` is the odd one out and is deliberately asymmetric: `db.rs` reads and
//! creates it through [`db_key`], but the three `secret_*` commands refuse the
//! kind outright, so the frontend can neither read a workspace's database key
//! nor overwrite it nor delete it. That last one matters: archiving a workspace
//! clears its "anthropic" and "site" entries, and if the same code could reach
//! "dbkey" it would make the archived file permanently unreadable.
//!
//! Known gotcha, documented for the user in CONTRIBUTING: an unsigned macOS
//! build changes identity on every rebuild, so the Keychain prompt reappears
//! after each dev build until signing (TODO E5) lands.
//!
//! There is no plaintext fallback. If the keychain is unavailable the caller
//! gets SECRET_ERROR and the features that need a secret stay switched off. The
//! one exception is the in-memory store below, which exists so `cargo test` and
//! a dev run never touch the developer's real login keychain; it is compiled
//! out of release builds entirely.

use keyring::Entry;
use serde::Serialize;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "helix";

/// 256-bit keys: SQLCipher's raw-key form is exactly 32 bytes.
const DB_KEY_BYTES: usize = 32;

#[derive(Debug, Clone, Serialize)]
pub struct SecretValue {
    pub value: Option<String>,
}

// ---------------------------------------------------------------------------
// The database key
// ---------------------------------------------------------------------------

/// A workspace's SQLCipher key, as the 64 lowercase hex characters SQLCipher's
/// raw-key syntax wants.
///
/// The point of the newtype is that it cannot be printed. `Debug` redacts, there
/// is no `Display`, no `Serialize`, and no getter that hands out the hex on its
/// own — only the two pragma fragments that have to reach SQLite. Its buffer is
/// zeroed on drop, which is housekeeping rather than a real defence: SQLCipher
/// keeps its own copy of the key material, and scrubbing that would need
/// `PRAGMA cipher_memory_security = ON` (see `db.rs` for why it is off).
pub struct DbKey(Vec<u8>);

impl DbKey {
    /// `PRAGMA key = "x'<hex>'"`. The raw-key form, so there is no KDF to run on
    /// every open: 32 bytes in means 32 bytes used, and opening a workspace costs
    /// nothing measurable.
    pub fn key_pragma(&self) -> String {
        format!("PRAGMA key = \"x'{}'\"", self.hex())
    }

    /// The `KEY "x'<hex>'"` clause for `ATTACH DATABASE`, used by the one-time
    /// plaintext migration.
    pub fn attach_key_clause(&self) -> String {
        format!("KEY \"x'{}'\"", self.hex())
    }

    fn hex(&self) -> &str {
        // The buffer is only ever filled from `to_hex`, which emits ASCII.
        std::str::from_utf8(&self.0).unwrap_or("")
    }

    fn from_hex_string(hex: String) -> AppResult<Self> {
        let trimmed = hex.trim();
        if trimmed.len() != DB_KEY_BYTES * 2 || !trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(AppError::secret(
                "The stored database key is not in the expected form. \
                 It was not created by this app, or it has been edited.",
            ));
        }
        Ok(Self(trimmed.to_ascii_lowercase().into_bytes()))
    }
}

/// Cloned only by `db_backup`, which needs the key on its own short-lived
/// connection without holding the database lock for the whole copy. The clone
/// zeroes itself on drop like the original.
impl Clone for DbKey {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl std::fmt::Debug for DbKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DbKey(<redacted>)")
    }
}

impl Drop for DbKey {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[usize::from(b >> 4)] as char);
        out.push(DIGITS[usize::from(b & 0x0f)] as char);
    }
    out
}

/// The key for `workspace_id`, created on first ask and stable forever after.
///
/// Idempotent: two calls for the same workspace return the same key, because the
/// second one finds the first one's entry. A workspace's file is unreadable
/// without this entry, so nothing in the app ever deletes it.
///
/// The read and the create are one critical section. Without the lock, two
/// callers that both find no entry each mint a key and the second `set` wins,
/// which leaves whatever the first caller already wrote with its key unreadable
/// for good. That is the worst failure this module can produce, and it showed up
/// as a flaky `cargo test` on a CI runner before the lock was added. One global
/// mutex is enough: this is called once per `db_open`, so there is nothing to
/// contend over.
///
/// It does not close the same race across two processes. It does not have to:
/// the single-instance plugin in `lib.rs` means there is only ever one Helix on
/// a machine, and it is the only thing that asks for these keys.
pub fn db_key(workspace_id: &str) -> AppResult<DbKey> {
    static CREATE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one_at_a_time = CREATE.lock().unwrap_or_else(|p| p.into_inner());

    if let Some(existing) = get(workspace_id, "dbkey")?.value {
        return DbKey::from_hex_string(existing);
    }

    let mut bytes = [0u8; DB_KEY_BYTES];
    getrandom::fill(&mut bytes).map_err(|e| {
        AppError::secret(format!(
            "Could not get random bytes from the operating system to make this \
             workspace's database key: {e}"
        ))
    })?;
    let hex = to_hex(&bytes);
    bytes.fill(0);

    set(workspace_id, "dbkey", &hex)?;
    DbKey::from_hex_string(hex)
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
//
// ONE KEYCHAIN ITEM PER WORKSPACE (round 3, acceptance criterion 9).
//
// Walker's report: launching a new build asks for Keychain access twice. The
// cause is not a duplicated call. macOS authorises a keychain ITEM against the
// binary that asks for it, and an unsigned build gets a fresh identity on every
// rebuild — so the count of prompts on the first launch of a new build is
// simply the count of DISTINCT items that build reads. A workspace with a
// database key and a site token is two items, so two prompts.
//
// The fix that actually bounds the number is to stop spending an item per
// secret. A workspace now keeps ONE item, `<workspaceId>:bundle`, holding a
// small JSON object of kind -> value. It is read once per run and cached for
// the lifetime of the process, so however many secrets the app wants, the OS is
// asked at most once.
//
// Migration is lazy and one-directional. When the bundle has no entry for a
// kind, the old per-kind item is read; if it is there, it is folded into the
// bundle and the old item is removed once the bundle write has succeeded. So
// the single launch that migrates an existing install still pays one prompt per
// legacy item it actually touches, and every launch after that pays one in
// total. A fresh install never has legacy items, and `get_password` on an item
// that does not exist returns NoEntry without prompting, so the probe is free.
//
// The ORDER of the two operations matters and is not negotiable: the legacy
// item is deleted only after the bundle write returns Ok. Losing a dbkey makes
// a workspace's file unreadable forever, which is the worst thing this module
// can do.
//
// Signing removes the prompt entirely, which is the real cure: a signed,
// notarised build keeps one stable code identity across versions, so the ACL
// the owner approves once stays approved for every later build. Until TODO E5
// lands, one prompt per build is the floor, and this is how we sit on it.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// The single item each workspace keeps. Not a `kind` the frontend can name:
/// `js_kind` below refuses everything except "anthropic" and "site".
const BUNDLE_KIND: &str = "bundle";

/// `kind` is validated rather than trusted so the frontend cannot invent an
/// unbounded set of keychain entries. `"dbkey"` is accepted here because
/// `db.rs` needs it; the commands at the bottom of this file refuse it.
fn entry(workspace_id: &str, kind: &str) -> AppResult<Entry> {
    let user = user_name(workspace_id, kind)?;
    Entry::new(SERVICE, &user)
        .map_err(|e| AppError::secret(format!("Can't reach the keychain for {user}: {e}")))
}

fn user_name(workspace_id: &str, kind: &str) -> AppResult<String> {
    if workspace_id.trim().is_empty() {
        return Err(AppError::secret("No workspace id was given."));
    }
    if !matches!(kind, "anthropic" | "site" | "dbkey" | "bundle") {
        return Err(AppError::secret(format!(
            "Unknown secret kind {kind:?}; expected \"anthropic\" or \"site\"."
        )));
    }
    Ok(format!("{workspace_id}:{kind}"))
}

/* --- the raw item operations: the only three that touch the OS ----------- */

fn raw_get(workspace_id: &str, kind: &str) -> AppResult<Option<String>> {
    let user = user_name(workspace_id, kind)?;
    #[cfg(debug_assertions)]
    if memory_store_selected() {
        return Ok(memory::get(&user));
    }
    let _ = &user;
    match entry(workspace_id, kind)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::secret(format!("Can't read from the keychain: {e}"))),
    }
}

fn raw_set(workspace_id: &str, kind: &str, value: &str) -> AppResult<()> {
    let user = user_name(workspace_id, kind)?;
    #[cfg(debug_assertions)]
    if memory_store_selected() {
        memory::set(&user, value);
        return Ok(());
    }
    let _ = &user;
    entry(workspace_id, kind)?
        .set_password(value)
        .map_err(|e| AppError::secret(format!("Can't save the key securely on this machine: {e}")))
}

fn raw_delete(workspace_id: &str, kind: &str) -> AppResult<()> {
    let user = user_name(workspace_id, kind)?;
    #[cfg(debug_assertions)]
    if memory_store_selected() {
        memory::delete(&user);
        return Ok(());
    }
    let _ = &user;
    match entry(workspace_id, kind)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::secret(format!(
            "Can't remove the key from the keychain: {e}"
        ))),
    }
}

/* --- the bundle ----------------------------------------------------------- */

type Bundle = HashMap<String, String>;

fn bundle_cache() -> &'static Mutex<HashMap<String, Bundle>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Bundle>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_bundle(workspace_id: &str) -> Option<Bundle> {
    let cache = bundle_cache().lock().unwrap_or_else(|p| p.into_inner());
    cache.get(workspace_id).cloned()
}

fn cache_bundle(workspace_id: &str, bundle: &Bundle) {
    let mut cache = bundle_cache().lock().unwrap_or_else(|p| p.into_inner());
    cache.insert(workspace_id.to_string(), bundle.clone());
}

/// Forget the cache, so the next read hits the store again. Only the tests need
/// this; the running app wants the cache to live for the whole process.
#[cfg(debug_assertions)]
pub fn reset_bundle_cache() {
    bundle_cache()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clear();
}

/// The workspace's one item, read at most once per run.
///
/// A bundle that will not parse is treated as empty rather than as an error: it
/// was not written by this app, and refusing to start is a worse answer than
/// asking the owner to reconnect a site. The dbkey is protected from that by
/// the legacy fall-back below and, once written here, by the fact that nothing
/// rewrites the item except this module.
fn load_bundle(workspace_id: &str) -> AppResult<Bundle> {
    if let Some(cached) = cached_bundle(workspace_id) {
        return Ok(cached);
    }
    let bundle: Bundle = match raw_get(workspace_id, BUNDLE_KIND)? {
        Some(json) => serde_json::from_str(&json).unwrap_or_default(),
        None => Bundle::new(),
    };
    cache_bundle(workspace_id, &bundle);
    Ok(bundle)
}

fn save_bundle(workspace_id: &str, bundle: &Bundle) -> AppResult<()> {
    let json = serde_json::to_string(bundle)
        .map_err(|e| AppError::secret(format!("Could not encode the workspace's secrets: {e}")))?;
    raw_set(workspace_id, BUNDLE_KIND, &json)?;
    cache_bundle(workspace_id, bundle);
    Ok(())
}

pub fn set(workspace_id: &str, kind: &str, value: &str) -> AppResult<()> {
    // Validate before anything is written, so a bad kind never reaches the store.
    user_name(workspace_id, kind)?;
    let mut bundle = load_bundle(workspace_id)?;
    bundle.insert(kind.to_string(), value.to_string());
    save_bundle(workspace_id, &bundle)?;
    // Best effort: an old per-kind item left behind is stale, not dangerous,
    // and failing the write because the cleanup failed would be worse.
    let _ = raw_delete(workspace_id, kind);
    Ok(())
}

/// A missing entry is not an error: it is `None`, which is what "no token yet"
/// looks like to the settings screen, and what "this workspace has no database
/// key yet" looks like to `db_open`.
pub fn get(workspace_id: &str, kind: &str) -> AppResult<SecretValue> {
    user_name(workspace_id, kind)?;
    let bundle = load_bundle(workspace_id)?;
    if let Some(value) = bundle.get(kind) {
        return Ok(SecretValue {
            value: Some(value.clone()),
        });
    }

    // Not in the bundle. Either this workspace predates the bundle, or the
    // secret genuinely is not set. `raw_get` answers both without minting
    // anything, and an absent item does not prompt.
    let legacy = raw_get(workspace_id, kind)?;
    let Some(value) = legacy else {
        return Ok(SecretValue { value: None });
    };

    let mut migrated = bundle;
    migrated.insert(kind.to_string(), value.clone());
    // Write first, delete second. Never the other way round.
    save_bundle(workspace_id, &migrated)?;
    let _ = raw_delete(workspace_id, kind);
    Ok(SecretValue { value: Some(value) })
}

/// Deleting something that is not there succeeds, so the settings screen can
/// clear a field without checking first.
pub fn delete(workspace_id: &str, kind: &str) -> AppResult<()> {
    user_name(workspace_id, kind)?;
    let mut bundle = load_bundle(workspace_id)?;
    if bundle.remove(kind).is_some() {
        save_bundle(workspace_id, &bundle)?;
    }
    raw_delete(workspace_id, kind)
}

// ---------------------------------------------------------------------------
// The dev/test in-memory store (never compiled into a release build)
// ---------------------------------------------------------------------------

/// Switches this process to the in-memory store described in [`memory`].
///
/// Called by the Rust test suite so `cargo test` neither prompts for Keychain
/// access nor leaves entries behind on the developer's machine, and so the
/// tests pass on a CI runner with no usable credential store at all. Idempotent
/// and safe to call from several threads.
///
/// Only exists in debug builds. `cfg(debug_assertions)` is the right gate
/// rather than `cfg(test)` because the integration tests in `tests/` link this
/// crate as a dependency, where `cfg(test)` is off.
#[cfg(debug_assertions)]
pub fn use_in_memory_store() {
    memory::FORCED.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(debug_assertions)]
fn memory_store_selected() -> bool {
    use std::sync::atomic::Ordering;
    if memory::FORCED.load(Ordering::Relaxed) {
        return true;
    }
    // Read once, never written: a dev run can opt in from the environment
    // without a recompile. `HELIX_INSECURE_KEY_STORE=memory` throws the keys
    // away when the process exits, which for a scratch workspace is the point.
    static FROM_ENV: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FROM_ENV.get_or_init(|| {
        std::env::var("HELIX_INSECURE_KEY_STORE")
            .map(|v| v.eq_ignore_ascii_case("memory"))
            .unwrap_or(false)
    })
}

/// A process-lifetime map standing in for the OS credential store.
///
/// Insecure by construction — the values sit in plain memory and vanish on
/// exit — which is exactly why the whole module is behind
/// `cfg(debug_assertions)` and cannot be reached from a release build.
#[cfg(debug_assertions)]
mod memory {
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Mutex, OnceLock};

    pub(super) static FORCED: AtomicBool = AtomicBool::new(false);

    fn map() -> &'static Mutex<HashMap<String, String>> {
        static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        MAP.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn lock() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
        map().lock().unwrap_or_else(|p| p.into_inner())
    }

    pub(super) fn set(user: &str, value: &str) {
        lock().insert(user.to_string(), value.to_string());
    }

    pub(super) fn get(user: &str) -> Option<String> {
        lock().get(user).cloned()
    }

    pub(super) fn delete(user: &str) {
        lock().remove(user);
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// The kinds the frontend is allowed to name. `"dbkey"` is not one of them: a
/// workspace's database key is created and read in Rust and never crosses the
/// IPC boundary in either direction.
fn js_kind(kind: &str) -> AppResult<()> {
    if kind == "dbkey" {
        return Err(AppError::secret(
            "A workspace's database key is managed by Helix and cannot be read, \
             replaced or removed from here.",
        ));
    }
    if !matches!(kind, "anthropic" | "site") {
        return Err(AppError::secret(format!(
            "Unknown secret kind {kind:?}; expected \"anthropic\" or \"site\"."
        )));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn secret_set(workspace_id: String, kind: String, value: String) -> AppResult<()> {
    js_kind(&kind)?;
    set(&workspace_id, &kind, &value)
}

#[tauri::command(async)]
pub fn secret_get(workspace_id: String, kind: String) -> AppResult<SecretValue> {
    js_kind(&kind)?;
    get(&workspace_id, &kind)
}

#[tauri::command(async)]
pub fn secret_delete(workspace_id: String, kind: String) -> AppResult<()> {
    js_kind(&kind)?;
    delete(&workspace_id, &kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every test in this module and in `tests/db_tests.rs` runs against the
    /// in-memory store, so none of them prompts for or writes to a real
    /// keychain.
    fn memory() {
        use_in_memory_store();
    }

    #[test]
    fn kind_is_validated() {
        assert!(entry("ws", "anthropic").is_ok());
        assert!(entry("ws", "site").is_ok());
        assert!(entry("ws", "dbkey").is_ok());
        let err = entry("ws", "../../root").unwrap_err();
        assert_eq!(err.code, "SECRET_ERROR");
        assert!(entry("", "site").is_err());
    }

    #[test]
    fn js_cannot_name_the_database_key() {
        assert!(js_kind("anthropic").is_ok());
        assert!(js_kind("site").is_ok());
        for bad in ["dbkey", "DBKEY-ish", "", "../x"] {
            let err = js_kind(bad).unwrap_err();
            assert_eq!(err.code, "SECRET_ERROR", "{bad} should have been refused");
        }
        // The three commands are the ones the contract exposes, so check the
        // refusal all the way through them rather than only through the helper.
        assert!(secret_get("ws".into(), "dbkey".into()).is_err());
        assert!(secret_set("ws".into(), "dbkey".into(), "beef".into()).is_err());
        assert!(secret_delete("ws".into(), "dbkey".into()).is_err());
    }

    #[test]
    fn db_key_is_created_once_and_then_reused() {
        memory();
        let ws = "018f-secrets-idempotent";
        let first = db_key(ws).expect("a fresh workspace should get a key");
        let second = db_key(ws).expect("the second ask should find the first key");
        assert_eq!(
            first.key_pragma(),
            second.key_pragma(),
            "db_key must be idempotent: a second open has to find the same key"
        );

        // 32 bytes as 64 lowercase hex characters, wrapped in SQLCipher's raw
        // key syntax so no KDF runs on open.
        let pragma = first.key_pragma();
        assert!(pragma.starts_with("PRAGMA key = \"x'"));
        assert!(pragma.ends_with("'\""));
        let hex = pragma
            .trim_start_matches("PRAGMA key = \"x'")
            .trim_end_matches("'\"");
        assert_eq!(hex.len(), 64);
        assert!(hex.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));

        let other = db_key("018f-secrets-other").expect("a second workspace gets its own key");
        assert_ne!(
            first.key_pragma(),
            other.key_pragma(),
            "two workspaces must not share a key"
        );
    }

    #[test]
    fn a_key_is_never_printable() {
        memory();
        let key = db_key("018f-secrets-redacted").expect("key");
        assert_eq!(format!("{key:?}"), "DbKey(<redacted>)");
    }

    #[test]
    fn a_mangled_stored_key_is_refused() {
        memory();
        let ws = "018f-secrets-mangled";
        set(ws, "dbkey", "not-hex").expect("the store accepts any string");
        let err = db_key(ws).unwrap_err();
        assert_eq!(err.code, "SECRET_ERROR");
        assert!(err.message.contains("not in the expected form"));
    }

    /// Acceptance criterion 9: however many secrets a workspace has, the OS is
    /// asked for ONE item. Counting store touches is the closest a test can get
    /// to counting Keychain prompts, and it is the right proxy: macOS prompts
    /// per item, per binary identity.
    #[test]
    fn every_secret_lives_in_one_item() {
        memory();
        reset_bundle_cache();
        let ws = "018f-secrets-one-item";

        let _ = db_key(ws).expect("key");
        set(ws, "site", "site-token").expect("site");
        set(ws, "anthropic", "sk-ant-x").expect("anthropic");

        // One item, holding all three.
        assert!(raw_get(ws, "bundle").expect("bundle").is_some());
        for kind in ["dbkey", "site", "anthropic"] {
            assert!(
                raw_get(ws, kind).expect("legacy").is_none(),
                "{kind} must not keep an item of its own"
            );
        }

        assert_eq!(get(ws, "site").unwrap().value.as_deref(), Some("site-token"));
        assert_eq!(
            get(ws, "anthropic").unwrap().value.as_deref(),
            Some("sk-ant-x")
        );
    }

    /// An install made by an older build keeps its per-kind items. The first
    /// read folds each one into the bundle and removes it, and the value is
    /// never lost on the way.
    #[test]
    fn a_legacy_per_kind_item_is_folded_into_the_bundle() {
        memory();
        reset_bundle_cache();
        let ws = "018f-secrets-legacy";
        let hex = "a".repeat(64);
        raw_set(ws, "dbkey", &hex).expect("write the old-style item");
        raw_set(ws, "site", "old-token").expect("write the old-style item");

        // db_open's path: it must find the existing key, not mint a new one.
        let key = db_key(ws).expect("key");
        assert!(key.key_pragma().contains(&hex));
        assert!(raw_get(ws, "dbkey").expect("legacy dbkey").is_none());

        assert_eq!(get(ws, "site").unwrap().value.as_deref(), Some("old-token"));
        assert!(raw_get(ws, "site").expect("legacy site").is_none());
        assert!(raw_get(ws, "bundle").expect("bundle").is_some());
    }

    #[test]
    fn the_bundle_is_read_once_and_then_cached() {
        memory();
        reset_bundle_cache();
        let ws = "018f-secrets-cached";
        set(ws, "site", "t").expect("set");

        // Tear the item out from under the cache: a cached run must not notice.
        raw_delete(ws, "bundle").expect("remove the item behind the cache");
        assert_eq!(get(ws, "site").unwrap().value.as_deref(), Some("t"));

        // And a fresh run does notice, so the cache is a cache and not a store.
        reset_bundle_cache();
        assert_eq!(get(ws, "site").unwrap().value, None);
    }

    #[test]
    fn deleting_clears_the_kind_and_leaves_the_others() {
        memory();
        reset_bundle_cache();
        let ws = "018f-secrets-delete";
        set(ws, "site", "t").expect("set");
        set(ws, "anthropic", "k").expect("set");

        delete(ws, "site").expect("delete");
        assert_eq!(get(ws, "site").unwrap().value, None);
        assert_eq!(get(ws, "anthropic").unwrap().value.as_deref(), Some("k"));
        // Deleting what is not there still succeeds.
        delete(ws, "site").expect("second delete");
    }

    #[test]
    fn an_unreadable_bundle_does_not_stop_the_app() {
        memory();
        reset_bundle_cache();
        let ws = "018f-secrets-garbled";
        raw_set(ws, "bundle", "{not json").expect("write");
        assert_eq!(get(ws, "site").unwrap().value, None);
    }

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xff, 0xa0]), "000fffa0");
        assert_eq!(to_hex(&[]), "");
    }
}
