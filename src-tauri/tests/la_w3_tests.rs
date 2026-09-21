//! LA-W3 (parent LR-LA): independent adversarial verification of failure and
//! recovery, run directly against this revision rather than trusting a prior
//! phase's return.
//!
//! J8a needs proof "the keychain item is byte-identical afterwards" — not an
//! inference from the in-memory store every other Rust test in this repo
//! uses (`secrets::use_in_memory_store()`, so `cargo test` never touches a
//! real keychain). The one test below is the deliberate exception: it talks
//! to the REAL macOS keychain, under a workspace id that cannot collide with
//! a real installation (`newId()` mints ids from `src/lib/ids.ts`'s alphabet,
//! never this literal prefix), and it deletes what it created in a `Drop`
//! guard so a panic mid-assertion still leaves nothing behind. It never
//! touches Walker's real workspace ids and never touches the
//! `com.clearpathdigital.helix` application data folder — only a keychain
//! entry this test both creates and destroys within one process lifetime.
//!
//! This file is the ONLY thing in `src-tauri/tests/` that does not call
//! `secrets::use_in_memory_store()`, on purpose: that call flips a
//! process-global `AtomicBool` for the lifetime of the test binary, so mixing
//! it with a real-keychain test in the same binary would make the real test's
//! outcome depend on test order. Keeping this file real-keychain-only avoids
//! that entirely.
//!
//! Run with: `cargo test --test la_w3_tests`

use keyring::Entry;

const SERVICE: &str = "helix";

/// Deletes the credential on drop, so a failed assertion mid-test still
/// cleans up. `let _guard = Cleanup(entry);` at the top of a test is enough.
struct Cleanup(Entry);
impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = self.0.delete_credential();
    }
}

/// A workspace id no real installation can ever mint: `newId()`
/// (`src/lib/ids.ts`) never produces this prefix, and it further carries the
/// process id and a static counter so two test runs racing on the same
/// machine still cannot collide with each other, let alone with a real
/// workspace.
fn fake_workspace_id(label: &str) -> String {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!(
        "zz-la-w3-adversarial-{}-{}-{}",
        std::process::id(),
        n,
        label
    )
}

/// J8a. `secrets::get`/`secrets::db_key` must refuse a bundle item that
/// exists but will not parse as JSON, and the item on the real keychain must
/// be byte-for-byte identical after the refusal — proven by reading the raw
/// password back through `keyring` directly, not by trusting the refusal
/// alone.
#[test]
fn j8a_real_keychain_unreadable_bundle_is_refused_and_byte_identical() {
    let ws = fake_workspace_id("bundle-corrupt");
    let user = format!("{ws}:bundle");
    let entry = Entry::new(SERVICE, &user).expect("a real keychain entry should be constructible");
    let _cleanup = Cleanup(Entry::new(SERVICE, &user).expect("entry"));

    let corrupt = "{not json, this is not a bundle at all";
    entry
        .set_password(corrupt)
        .expect("seeding the corrupt item on the real keychain should succeed");

    let before = entry
        .get_password()
        .expect("the corrupt item should still be readable as raw bytes before the refusal");
    assert_eq!(before, corrupt);

    // Exercise the REAL refusal path in secrets.rs, against the REAL
    // keychain (no use_in_memory_store() anywhere in this file).
    let get_err = helix_crm_lib::secrets::get(&ws, "site")
        .expect_err("a corrupt bundle must be refused, not read as empty");
    assert_eq!(get_err.code, "SECRET_ERROR");
    assert!(
        get_err.message.contains("will not replace them"),
        "the message must say why nothing was written: {}",
        get_err.message
    );

    let db_key_err = helix_crm_lib::secrets::db_key(&ws)
        .expect_err("db_key must also refuse rather than mint a fresh key over a corrupt bundle");
    assert_eq!(db_key_err.code, "SECRET_ERROR");

    // The byte-identical proof the packet asked for: read the RAW item back
    // through keyring directly, independent of secrets.rs's own cache, and
    // compare it byte for byte against what was written before the refusal.
    let after = entry
        .get_password()
        .expect("the item must still be readable after the refusal");
    assert_eq!(
        before, after,
        "the damaged keychain item must be byte-identical after the refusal"
    );
    assert_eq!(after, corrupt);
}

/// A sibling of the test above at the OS level only (no secrets.rs
/// involved): proves the raw mechanism the refusal depends on — that
/// `keyring`'s macOS backend returns exactly the bytes it was given, with no
/// normalisation, truncation or re-encoding that could make "byte-identical"
/// true by accident of a lossless round trip rather than by the refusal
/// actually writing nothing.
#[test]
fn j8a_keychain_round_trip_preserves_arbitrary_bytes_exactly() {
    let ws = fake_workspace_id("roundtrip");
    let user = format!("{ws}:bundle");
    let entry = Entry::new(SERVICE, &user).expect("entry");
    let _cleanup = Cleanup(Entry::new(SERVICE, &user).expect("entry"));

    // Punctuation, braces, a NUL-free control-ish character, and non-ASCII —
    // the shapes an actually-corrupted bundle could plausibly contain.
    let payload = "{\"dbkey\":\"\u{0}not-hex\", broken\t\u{feff}\u{1}\u{2}";
    entry.set_password(payload).expect("set");
    let read_back = entry.get_password().expect("get");
    assert_eq!(read_back, payload);
}
