//! The capability file and the CSP, asserted as tests.
//!
//! These two files are the app's real enforcement layer, and they are the two
//! places where a security property can be undone by a one-line edit that
//! nothing else notices: no screen breaks, no other test fails, and the loss
//! only shows up in the field. `tauri.conf.json` and
//! `capabilities/default.json` are plain JSON, so reading them back and
//! asserting what they say costs nothing and cannot drift.
//!
//! What each test defends:
//!
//! ```text
//!   the_http_plugin_reaches_anthropic_and_nowhere_else
//!       the AI base URL is a SETTING (src/features/ai/lib/aiSettings.ts), so
//!       the allow-list is the only thing stopping a changed setting from
//!       sending the owner's API key and a customer's notes to another host
//!   the_opener_allows_only_the_four_schemes_a_crm_needs
//!       every external link goes through plugin-opener; file: and
//!       javascript: must never be openable, whatever a stored value says
//!   the_opener_and_asset_scopes_stay_inside_the_app_folder
//!       the webview may read attachments, not the disk
//!   the_csp_has_no_unsafe_script_source
//!       'unsafe-inline' is allowed for styles and nothing else, ever
//!   the_csp_sets_the_directives_that_do_not_fall_back
//!       base-uri / form-action / frame-ancestors / object-src (F-SEC-4)
//!   nothing_dangerous_is_enabled
//!       Tauri's own escape hatches, by the names it gives them
//! ```

use serde_json::Value;

fn read_json(relative: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{} should be readable: {e}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{} should be valid JSON: {e}", path.display()))
}

fn capability() -> Value {
    read_json("capabilities/default.json")
}

fn config() -> Value {
    read_json("tauri.conf.json")
}

/// The permission entries, split into the plain strings ("fs:allow-...") and
/// the scoped objects ({ identifier, allow }).
fn permissions() -> Vec<Value> {
    capability()["permissions"]
        .as_array()
        .expect("permissions should be an array")
        .clone()
}

/// The `allow` list of one scoped permission, by identifier.
fn scope_for(identifier: &str) -> Vec<Value> {
    permissions()
        .into_iter()
        .find(|p| p.get("identifier").and_then(Value::as_str) == Some(identifier))
        .unwrap_or_else(|| panic!("{identifier} should be a scoped permission"))["allow"]
        .as_array()
        .unwrap_or_else(|| panic!("{identifier} should carry an allow list"))
        .clone()
}

fn csp() -> String {
    config()["app"]["security"]["csp"]
        .as_str()
        .expect("the CSP should be a string")
        .to_string()
}

/// One directive out of the CSP, as the list of its sources.
fn directive(name: &str) -> Option<Vec<String>> {
    csp()
        .split(';')
        .map(str::trim)
        .find(|part| part == &name || part.starts_with(&format!("{name} ")))
        .map(|part| {
            part.trim_start_matches(name)
                .split_whitespace()
                .map(str::to_string)
                .collect()
        })
}

// ---------------------------------------------------------------------------
// The two outbound integrations
// ---------------------------------------------------------------------------

/// Helix talks to exactly two hosts: the Anthropic API through
/// `tauri-plugin-http`, and the owner's own website through the `leads_fetch`
/// command in Rust. The site is not in this list on purpose - its origin is a
/// runtime setting, so it is validated in `leads::validate_origin` instead
/// (https anywhere, http only on loopback). Anthropic IS in this list, and it
/// must be the only thing in it.
#[test]
fn the_http_plugin_reaches_anthropic_and_nowhere_else() {
    let urls: Vec<String> = scope_for("http:default")
        .iter()
        .map(|entry| {
            entry["url"]
                .as_str()
                .expect("an http scope entry should carry a url")
                .to_string()
        })
        .collect();

    assert_eq!(
        urls,
        vec!["https://api.anthropic.com/*".to_string()],
        "the http plugin's allow-list is what stops a changed aiBaseUrl setting \
         from sending the owner's API key and a customer's notes somewhere else"
    );
}

#[test]
fn the_opener_allows_only_the_four_schemes_a_crm_needs() {
    let mut urls: Vec<String> = scope_for("opener:allow-open-url")
        .iter()
        .map(|e| e["url"].as_str().expect("a url").to_string())
        .collect();
    urls.sort();

    assert_eq!(
        urls,
        vec![
            "https://*".to_string(),
            "mailto:*".to_string(),
            "sms:*".to_string(),
            "tel:*".to_string(),
        ],
        "a phone number, an email address and a company website are the only \
         things Helix hands to the OS; http:, file:, data: and javascript: are not"
    );
}

#[test]
fn the_opener_and_asset_scopes_stay_inside_the_app_folder() {
    for (identifier, expected) in [
        ("opener:allow-open-path", "$APPDATA/workspaces/**"),
        ("opener:allow-reveal-item-in-dir", "$APPDATA/**"),
    ] {
        let paths: Vec<String> = scope_for(identifier)
            .iter()
            .map(|e| e["path"].as_str().expect("a path").to_string())
            .collect();
        assert_eq!(
            paths,
            vec![expected.to_string()],
            "{identifier} must not reach outside the app data folder"
        );
    }

    let asset = &config()["app"]["security"]["assetProtocol"];
    assert_eq!(asset["enable"], Value::Bool(true));
    assert_eq!(
        asset["scope"],
        serde_json::json!(["$APPDATA/workspaces/**/attachments/**"]),
        "the webview may render an attachment and nothing else on the disk"
    );
}

/// Every filesystem permission is an appdata one. A `$HOME` or `$DOCUMENT`
/// scope would let the webview read the owner's whole machine, and the
/// dialog-picked paths the import and export screens use do not need one.
#[test]
fn the_filesystem_is_scoped_to_the_app_folder() {
    for permission in permissions() {
        let Some(name) = permission.as_str() else {
            continue;
        };
        if !name.starts_with("fs:") {
            continue;
        }
        assert!(
            name.contains("appdata") || name == "fs:create-app-specific-dirs",
            "{name} is a filesystem permission that is not scoped to the app folder"
        );
    }
}

// ---------------------------------------------------------------------------
// The CSP
// ---------------------------------------------------------------------------

/// `'unsafe-inline'` is needed for styles - Radix, sonner and cmdk inject
/// `<style>` elements at runtime - and for nothing else. `'unsafe-eval'` is
/// needed for nothing at all.
#[test]
fn the_csp_has_no_unsafe_script_source() {
    let csp = csp();
    assert!(
        !csp.contains("unsafe-eval"),
        "nothing in Helix evaluates a string as code: {csp}"
    );

    for (name, sources) in csp
        .split(';')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| {
            let mut it = p.split_whitespace();
            (it.next().unwrap_or_default().to_string(), p.to_string())
        })
    {
        if name == "style-src" {
            continue;
        }
        assert!(
            !sources.contains("unsafe-inline"),
            "{name} must not be 'unsafe-inline'; only style-src may be: {sources}"
        );
    }

    assert!(
        directive("script-src").is_none(),
        "script-src is deliberately left to fall back to default-src 'self', so \
         that Tauri's initialisation hash lands where it always has; if it is \
         named here, check that the window still loads before changing this test"
    );
    assert_eq!(
        directive("default-src"),
        Some(vec!["'self'".to_string()]),
        "which means default-src is what actually constrains scripts"
    );
}

/// F-SEC-4. These four do not fall back to `default-src`, so leaving them out
/// left them unset rather than 'self'.
#[test]
fn the_csp_sets_the_directives_that_do_not_fall_back() {
    for (name, expected) in [
        ("base-uri", "'self'"),
        ("form-action", "'none'"),
        ("frame-ancestors", "'none'"),
        ("object-src", "'none'"),
    ] {
        assert_eq!(
            directive(name),
            Some(vec![expected.to_string()]),
            "{name} should be {expected}"
        );
    }
}

/// `connect-src` names no remote host: every request Helix makes is made in
/// Rust and arrives over IPC. If a host appears here, something started
/// talking to the network from the webview.
#[test]
fn the_webview_itself_talks_to_nothing_remote() {
    let sources = directive("connect-src").expect("connect-src should be set");
    for source in &sources {
        assert!(
            matches!(source.as_str(), "'self'" | "ipc:" | "http://ipc.localhost"),
            "{source} is a remote connect-src; requests belong in Rust"
        );
    }
}

// ---------------------------------------------------------------------------
// Tauri's own escape hatches
// ---------------------------------------------------------------------------

#[test]
fn nothing_dangerous_is_enabled() {
    let text = serde_json::to_string(&config()).expect("re-encode");
    for hatch in [
        "dangerousDisableAssetCspModification",
        "dangerousRemoteDomainIpcAccess",
        "dangerousUseHttpScheme",
        "withGlobalTauri",
    ] {
        assert!(
            !text.contains(hatch),
            "{hatch} appears in tauri.conf.json; every one of these widens the \
             webview's reach and none of them has a reason to be here"
        );
    }

    let conf = config();
    let dev_url = conf["build"]["devUrl"].as_str().unwrap_or_default();
    assert!(
        dev_url.starts_with("http://localhost:"),
        "the dev server must be loopback, got {dev_url:?}"
    );
    assert_eq!(
        conf["build"]["frontendDist"], "../dist",
        "the shipped build loads its frontend from disk, never from a URL"
    );
}
