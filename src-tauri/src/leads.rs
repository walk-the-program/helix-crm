//! The website lead poll.
//!
//! This is a custom command rather than a `tauri-plugin-http` call because the
//! plugin's scope is static and the site origin is a runtime setting: a user
//! can point Helix at their own domain without the app shipping a capability
//! for it. Everything the request needs is read in Rust, so the frontend never
//! handles the token and cannot aim the request at an arbitrary host.
//!
//! ```text
//!   settings.site_origin (value_json, a JSON string)  ----+
//!   keychain "helix" / "<workspaceId>:site"  -------------+--> GET {origin}/api/crm/leads
//!   workspaceId = the folder holding the open helix.db  --+        ?after=<cursor>&limit=<n>
//!                                                                 Authorization: Bearer <token>
//!   2xx  -> { leads, nextCursor }
//!   4xx/5xx -> HTTP_STATUS (status in the message; the poller stops on 401/403)
//!   timeout/DNS/TLS -> NET_ERROR (the poller backs off)
//! ```
//!
//! ## Hardening against a hostile or broken site (LR-SEC-W1, 2026-09-20)
//!
//! The feed is a public form on the other end: its answer is untrusted input
//! from the internet, not from an account Helix controls. Everything below
//! `fetch_page_with_limits` exists to survive that without a memory blow-up,
//! a stuck poller, or silent bad data:
//!
//!   - the response body is read with a hard byte cap, enforced while
//!     reading (`read_capped_body`), not just against `Content-Length` -
//!     that header is not itself trustworthy;
//!   - redirects are never followed (`redirect::Policy::none()`), so the
//!     origin validation in `validate_origin` cannot be sidestepped by a
//!     3xx after the fact;
//!   - the raw bytes are depth-checked (`json_depth_within_limit`) before
//!     `serde_json` ever parses them, because serde's recursive descent has
//!     no depth limit of its own and a stack overflow is a process abort no
//!     `Result` can catch;
//!   - the parsed page is bounds-checked (`enforce_bounds`): more leads than
//!     the contract allows, or an identity-bearing field (`id`, `email`,
//!     `phone`) longer than a sane length, rejects the whole page; a
//!     display-only field (`name`, `service`, `pageUrl`, `message`) is
//!     truncated instead, with a note for `message` since that one holds
//!     what a customer actually typed. Every field also has NUL bytes and
//!     bidi override/embedding characters stripped - neither has a
//!     legitimate reason to be in a name or a message, and both are classic
//!     disguise tools;
//!   - a non-2xx response never carries the site's own body back into an
//!     auth failure (401/403): a site's own auth-rejection body commonly
//!     echoes the credential it just rejected, and that must never reach
//!     `lead_sync.last_error` or the plaintext log file the owner might
//!     email to support. Other statuses keep a short, redacted snippet.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::secrets;

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_LIMIT: u32 = 200;

/// Hard cap on the bytes read from a `leads_fetch` response, enforced while
/// reading rather than after: a hostile or compromised site can otherwise
/// stream gigabytes into memory before anything gets a chance to object.
///
/// Sized against a realistic full page, not the worst case every field cap
/// in `enforce_bounds` allows at once: 200 leads at typical sizes (a name, an
/// email, a short message) run tens of kilobytes in total, so 5 MB leaves
/// generous room for a verbose real answer while still refusing a page that
/// pads every field toward its individual maximum on every one of 200 leads
/// - which is itself the hostile shape this module exists to catch, not a
/// legitimate response this cap should have to let through.
const MAX_RESPONSE_BYTES: u64 = 5 * 1024 * 1024;

/// JSON nesting deeper than this cannot be a real lead page - the deepest a
/// legitimate response goes is object -> `leads` array -> lead object, three
/// levels - so this exists purely to stop a hand-crafted `[[[[...]]]]` body
/// from recursing `serde_json`'s descent parser toward a stack overflow,
/// which is a process-ending abort no `Result` can catch.
const MAX_JSON_DEPTH: usize = 64;

const MAX_ID_LEN: usize = 200;
const MAX_NAME_LEN: usize = 200;
const MAX_EMAIL_LEN: usize = 320;
const MAX_PHONE_LEN: usize = 64;
const MAX_SERVICE_LEN: usize = 200;
const MAX_PAGE_URL_LEN: usize = 2048;
const MAX_MESSAGE_LEN: usize = 10_000;

const MESSAGE_TRUNCATION_NOTE: &str =
    "\n[Message shortened - the rest was cut off because it was unusually long.]";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lead {
    pub id: String,
    pub created_at: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeadPage {
    pub leads: Vec<Lead>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// HTTPS anywhere; plain HTTP only on the loopback host, which is how
/// `tools/fake-site` is reached in development and e2e.
pub fn validate_origin(origin: &str) -> AppResult<String> {
    let trimmed = origin.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::net(
            "No website is connected yet. Add your site address in Settings.",
        ));
    }
    let url = reqwest::Url::parse(trimmed)
        .map_err(|e| AppError::net(format!("{trimmed:?} is not a valid web address: {e}")))?;

    let host = url.host_str().unwrap_or_default();
    let ok = match url.scheme() {
        "https" => !host.is_empty(),
        "http" => matches!(host, "127.0.0.1" | "localhost"),
        _ => false,
    };
    if !ok {
        return Err(AppError::net(format!(
            "{trimmed} must start with https:// (http:// is only allowed for localhost during development)."
        )));
    }
    Ok(trimmed.to_string())
}

/// The workspace id is the folder that holds the open database:
/// `<workspacesDir>/<uuid>/helix.db`.
pub fn workspace_id_from_db_path(path: &std::path::Path) -> AppResult<String> {
    path.parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::secret(format!(
                "Could not work out the workspace id from {}",
                path.display()
            ))
        })
}

/// `settings.value_json` holds JSON, so a text setting arrives quoted. Older
/// rows written as bare text are accepted too rather than failing the poll.
pub fn parse_setting_string(value_json: &str) -> String {
    serde_json::from_str::<String>(value_json)
        .unwrap_or_else(|_| value_json.trim().trim_matches('"').to_string())
}

fn read_origin(db: &Db) -> AppResult<String> {
    let rows = db
        .query(
            "SELECT value_json FROM settings WHERE key = ?1",
            &[serde_json::Value::String("site_origin".into())],
        )?
        .rows;

    let raw = rows
        .first()
        .and_then(|r| r.first())
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            AppError::net("No website is connected yet. Add your site address in Settings.")
        })?;

    validate_origin(&parse_setting_string(raw))
}

/// Reads a response body with a hard ceiling, aborting mid-stream rather than
/// after the fact. `Content-Length` is checked by the caller when present,
/// but it is only a header the site chose to send - not itself trustworthy -
/// so the real limit is enforced against bytes actually received.
async fn read_capped_body(mut response: reqwest::Response, cap: u64) -> AppResult<Vec<u8>> {
    let hint = response.content_length().unwrap_or(0).min(cap) as usize;
    let mut buf: Vec<u8> = Vec::with_capacity(hint.min(1024 * 1024));
    loop {
        let chunk = response
            .chunk()
            .await
            .map_err(|e| AppError::net(format!("The site's answer stopped partway through: {e}")))?;
        let Some(chunk) = chunk else { break };
        if (buf.len() as u64) + (chunk.len() as u64) > cap {
            return Err(AppError::net(format!(
                "Your website sent more than {} of data for one page of leads. Nothing was saved; check the site's lead feed.",
                format_bytes(cap)
            )));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

fn format_bytes(n: u64) -> String {
    if n >= 1024 * 1024 {
        format!("{:.1} MB", n as f64 / (1024.0 * 1024.0))
    } else if n >= 1024 {
        format!("{:.1} KB", n as f64 / 1024.0)
    } else {
        format!("{n} bytes")
    }
}

/// A linear, non-recursive scan for the deepest `{`/`[` nesting in `bytes`,
/// used only to reject an absurd body before serde's own recursive-descent
/// parser ever sees it. It does not validate JSON - `serde_json` still does
/// that - only bounds how deep the brackets go, ignoring anything inside a
/// quoted string so a legitimate message containing literal `[[[` text is
/// never miscounted.
fn json_depth_within_limit(bytes: &[u8], max_depth: usize) -> bool {
    let mut depth: usize = 0;
    let mut in_string = false;
    let mut escaped = false;
    for &b in bytes {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' | b'[' => {
                depth += 1;
                if depth > max_depth {
                    return false;
                }
            }
            b'}' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    true
}

fn is_bidi_control(c: char) -> bool {
    matches!(
        c,
        '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'
    )
}

/// Strips NUL and bidi override/embedding characters that have no legitimate
/// reason to be in a name, an email, a phone number or a message, and are
/// exactly the tool a disguised label uses (a right-to-left override making
/// `evil.exe` read as something safer).
fn sanitize_text(s: &str) -> String {
    s.chars()
        .filter(|c| *c != '\u{0}' && !is_bidi_control(*c))
        .collect()
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

fn strip_option(field: &mut Option<String>) {
    if let Some(s) = field {
        *s = sanitize_text(s);
    }
}

fn truncate_option(field: &mut Option<String>, max_chars: usize, note: Option<&str>) {
    if let Some(s) = field {
        if char_len(s) > max_chars {
            let mut truncated: String = s.chars().take(max_chars).collect();
            if let Some(note) = note {
                truncated.push_str(note);
            }
            *s = truncated;
        }
    }
}

/// Runs once, right after a page deserialises, before a single byte of it
/// reaches the frontend. Two different failure shapes on purpose:
///
///  - `id`, `email` and `phone` identify something (a deal's `external_id`,
///    a contact's dedupe key). Silently truncating one of these could make
///    two different values collide on a shared prefix and merge two
///    unrelated leads - worse than losing the page - so an oversized one
///    rejects the whole page instead.
///  - `name`, `service`, `pageUrl` and `message` are display text with no
///    identity role. They are truncated in place; `message` gets a trailing
///    note so the cut is visible on the deal's timeline instead of quietly
///    losing the end of what a customer typed - a 10,001-character message
///    must not cost the owner the lead, nor should a 2 MB one land in
///    SQLite verbatim.
///
/// The lead count is checked first: a server that ignores the requested
/// `limit` and answers with more than the contract's own ceiling is either
/// broken or hostile either way, and there is no safe partial application of
/// "the first 200 of however many it sent".
fn enforce_bounds(mut page: LeadPage) -> AppResult<LeadPage> {
    if page.leads.len() > MAX_LIMIT as usize {
        return Err(AppError::net(format!(
            "Your website sent {} leads in one answer; Helix only ever asks for {}. Nothing was saved; check the site's lead feed.",
            page.leads.len(),
            MAX_LIMIT
        )));
    }

    for lead in &mut page.leads {
        lead.id = sanitize_text(&lead.id);
        strip_option(&mut lead.name);
        strip_option(&mut lead.email);
        strip_option(&mut lead.phone);
        strip_option(&mut lead.service);
        strip_option(&mut lead.page_url);
        strip_option(&mut lead.message);

        if char_len(&lead.id) > MAX_ID_LEN {
            return Err(AppError::net(format!(
                "Your website sent a lead id longer than {MAX_ID_LEN} characters. Nothing was saved; check the site's lead feed."
            )));
        }
        if let Some(email) = &lead.email {
            if char_len(email) > MAX_EMAIL_LEN {
                return Err(AppError::net(format!(
                    "Your website sent an email address longer than {MAX_EMAIL_LEN} characters. Nothing was saved; check the site's lead feed."
                )));
            }
        }
        if let Some(phone) = &lead.phone {
            if char_len(phone) > MAX_PHONE_LEN {
                return Err(AppError::net(format!(
                    "Your website sent a phone number longer than {MAX_PHONE_LEN} characters. Nothing was saved; check the site's lead feed."
                )));
            }
        }

        truncate_option(&mut lead.name, MAX_NAME_LEN, None);
        truncate_option(&mut lead.service, MAX_SERVICE_LEN, None);
        truncate_option(&mut lead.page_url, MAX_PAGE_URL_LEN, None);
        truncate_option(
            &mut lead.message,
            MAX_MESSAGE_LEN,
            Some(MESSAGE_TRUNCATION_NOTE),
        );
    }
    Ok(page)
}

/// Redacts a word immediately following "bearer" or "token" (either casing),
/// on top of the exact-token replacement in `fetch_page_with_limits`. A site
/// that echoes a rejected credential back re-cased, quoted, or otherwise not
/// byte-for-byte what Helix sent would otherwise still leak it into
/// `lead_sync.last_error` or the log (LR-SEC-W1 item 9). This is diagnostic
/// text, not something the owner acts on, so collapsing its whitespace costs
/// nothing real.
fn redact_bearer_like(text: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut redact_next = false;
    for word in text.split_whitespace() {
        if redact_next {
            out.push("[redacted]".to_string());
            redact_next = false;
            continue;
        }
        let bare = word.trim_matches(|c: char| !c.is_alphanumeric());
        if bare.eq_ignore_ascii_case("bearer") || bare.eq_ignore_ascii_case("token") {
            redact_next = true;
        }
        out.push(word.to_string());
    }
    out.join(" ")
}

/// Everything a diagnostic snippet of a non-2xx body must never carry: the
/// literal token Helix sent, and anything shaped like one.
fn redact_diagnostic_text(text: &str, secret: &str) -> String {
    let exact = if secret.is_empty() {
        text.to_string()
    } else {
        text.replace(secret, "[redacted]")
    };
    redact_bearer_like(&exact)
}

/// Everything from "we have a URL and a token" through to a validated,
/// bounded `LeadPage`. Split out from `fetch` so tests can drive it directly
/// against a local test server without a real database or keychain entry,
/// and parameterised on the byte cap and JSON depth limit so a test can use
/// small values and stay fast without touching the production constants.
async fn fetch_page_with_limits(
    url: reqwest::Url,
    token: &str,
    cap: u64,
    max_depth: usize,
) -> AppResult<LeadPage> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .use_rustls_tls()
        // The origin is already validated (https, or http on loopback only)
        // in `validate_origin`. A redirect could otherwise send this same
        // request - Authorization header included, whenever the host and
        // port do not change - somewhere the owner never configured, which
        // would make that validation pointless. `Policy::none()` turns any
        // 3xx into an ordinary response, which the status check below
        // already turns into a readable HTTP_STATUS error without this
        // module ever following it.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::net(format!("Could not start the request: {e}")))?;

    let response = client
        .get(url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AppError::net("The site did not answer within 15 seconds.")
            } else {
                AppError::net(format!("Could not reach the site: {e}"))
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let status_u16 = status.as_u16();
        let detail = if status_u16 == 401 || status_u16 == 403 {
            // Never surface the site's own response body for an auth
            // failure: plenty of frameworks echo the rejected credential
            // straight back ("invalid token: hx_live_abc123"), and that must
            // never reach lead_sync.last_error or the plaintext log file the
            // owner might send to support (LR-SEC-W1 item 9, 2026-09-20).
            "no details".to_string()
        } else {
            let body = read_capped_body(response, cap).await.unwrap_or_default();
            let text = String::from_utf8_lossy(&body);
            let snippet: String = text.chars().take(200).collect();
            let redacted = redact_diagnostic_text(&snippet, token);
            if redacted.trim().is_empty() {
                status
                    .canonical_reason()
                    .unwrap_or("no details")
                    .to_string()
            } else {
                redacted
            }
        };
        return Err(AppError::http_status(status_u16, detail));
    }

    if let Some(len) = response.content_length() {
        if len > cap {
            return Err(AppError::net(format!(
                "Your website sent {} of data for one page of leads; Helix stops reading past {}.",
                format_bytes(len),
                format_bytes(cap)
            )));
        }
    }

    let body = read_capped_body(response, cap).await?;

    if !json_depth_within_limit(&body, max_depth) {
        return Err(AppError::net(
            "Your website's answer was nested far deeper than a lead page should ever be. Nothing was saved; check the site's lead feed.",
        ));
    }

    let page: LeadPage = serde_json::from_slice(&body)
        .map_err(|e| AppError::net(format!("The site's answer was not the expected shape: {e}")))?;

    enforce_bounds(page)
}

async fn fetch_page(url: reqwest::Url, token: &str) -> AppResult<LeadPage> {
    fetch_page_with_limits(url, token, MAX_RESPONSE_BYTES, MAX_JSON_DEPTH).await
}

pub async fn fetch(db: &Db, cursor: Option<String>, limit: u32) -> AppResult<LeadPage> {
    // Everything that touches the connection or the keychain happens before the
    // first await, so no lock is held across the request.
    let origin = read_origin(db)?;
    let db_path = db.open_path().ok_or_else(AppError::db_closed)?;
    let workspace_id = workspace_id_from_db_path(&db_path)?;

    let token = secrets::get(&workspace_id, "site")?.value.ok_or_else(|| {
        AppError::secret("No site token is stored for this workspace. Add it in Settings.")
    })?;

    let limit = limit.clamp(1, MAX_LIMIT);
    let mut url = reqwest::Url::parse(&format!("{origin}/api/crm/leads"))
        .map_err(|e| AppError::net(format!("Could not build the request URL: {e}")))?;
    {
        let mut q = url.query_pairs_mut();
        if let Some(c) = cursor.as_deref().filter(|c| !c.is_empty()) {
            q.append_pair("after", c);
        }
        q.append_pair("limit", &limit.to_string());
    }

    fetch_page(url, &token).await
}

#[tauri::command(async)]
pub async fn leads_fetch(
    db: State<'_, Db>,
    cursor: Option<String>,
    limit: u32,
) -> AppResult<LeadPage> {
    fetch(&db, cursor, limit).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration as StdDuration;

    #[test]
    fn origins_are_checked() {
        assert_eq!(
            validate_origin("https://example.com/").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            validate_origin(" http://127.0.0.1:4711 ").unwrap(),
            "http://127.0.0.1:4711"
        );
        assert!(validate_origin("http://localhost:4711").is_ok());

        for bad in [
            "",
            "http://example.com",
            "ftp://example.com",
            "javascript:alert(1)",
            "example.com",
        ] {
            let err = validate_origin(bad).unwrap_err();
            assert_eq!(err.code, "NET_ERROR", "{bad} should have been refused");
        }
    }

    #[test]
    fn workspace_id_comes_from_the_folder() {
        let p = Path::new("/Users/x/Application Support/helix/workspaces/018f-abcd/helix.db");
        assert_eq!(workspace_id_from_db_path(p).unwrap(), "018f-abcd");
    }

    #[test]
    fn settings_values_are_json_strings() {
        assert_eq!(
            parse_setting_string("\"https://example.com\""),
            "https://example.com"
        );
        assert_eq!(
            parse_setting_string("https://example.com"),
            "https://example.com"
        );
    }

    /* ---------------------------------------------------------------- */
    /* enforce_bounds - lead count and field caps                       */
    /* ---------------------------------------------------------------- */

    fn blank_lead(id: &str) -> Lead {
        Lead {
            id: id.to_string(),
            created_at: "2026-03-01T00:00:00Z".to_string(),
            name: None,
            email: None,
            phone: None,
            service: None,
            message: None,
            page_url: None,
        }
    }

    #[test]
    fn a_page_with_more_leads_than_the_contract_allows_is_refused() {
        let leads: Vec<Lead> = (0..201).map(|i| blank_lead(&format!("id-{i}"))).collect();
        let page = LeadPage {
            leads,
            next_cursor: None,
        };
        let err = enforce_bounds(page).unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        assert!(err.message.contains("201"));
    }

    #[test]
    fn exactly_the_limit_is_accepted() {
        let leads: Vec<Lead> = (0..200).map(|i| blank_lead(&format!("id-{i}"))).collect();
        let page = LeadPage {
            leads,
            next_cursor: None,
        };
        assert!(enforce_bounds(page).is_ok());
    }

    #[test]
    fn an_oversized_id_rejects_the_whole_page() {
        let mut lead = blank_lead(&"x".repeat(MAX_ID_LEN + 1));
        lead.name = Some("Bob".to_string());
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let err = enforce_bounds(page).unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        assert!(err.message.contains("id"));
    }

    #[test]
    fn an_id_at_exactly_the_cap_is_accepted() {
        let lead = blank_lead(&"x".repeat(MAX_ID_LEN));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        assert!(enforce_bounds(page).is_ok());
    }

    #[test]
    fn an_oversized_email_rejects_the_whole_page_rather_than_truncating() {
        // Truncating an identity field could make two different overlong
        // emails collide on a shared prefix and merge two unrelated
        // contacts - worse than losing the page.
        let mut lead = blank_lead("lead-1");
        lead.email = Some(format!("{}@example.com", "x".repeat(MAX_EMAIL_LEN)));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let err = enforce_bounds(page).unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        assert!(err.message.contains("email"));
    }

    #[test]
    fn an_oversized_phone_rejects_the_whole_page() {
        let mut lead = blank_lead("lead-1");
        lead.phone = Some("1".repeat(MAX_PHONE_LEN + 1));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let err = enforce_bounds(page).unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        assert!(err.message.contains("phone"));
    }

    #[test]
    fn an_oversized_name_is_truncated_not_rejected() {
        let mut lead = blank_lead("lead-1");
        lead.name = Some("n".repeat(MAX_NAME_LEN + 50));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let result = enforce_bounds(page).unwrap();
        assert_eq!(result.leads[0].name.as_deref().unwrap().len(), MAX_NAME_LEN);
    }

    #[test]
    fn an_oversized_service_and_page_url_are_truncated() {
        let mut lead = blank_lead("lead-1");
        lead.service = Some("s".repeat(MAX_SERVICE_LEN + 10));
        lead.page_url = Some(format!(
            "https://example.com/{}",
            "p".repeat(MAX_PAGE_URL_LEN)
        ));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let result = enforce_bounds(page).unwrap();
        assert_eq!(
            char_len(result.leads[0].service.as_deref().unwrap()),
            MAX_SERVICE_LEN
        );
        assert_eq!(
            char_len(result.leads[0].page_url.as_deref().unwrap()),
            MAX_PAGE_URL_LEN
        );
    }

    #[test]
    fn a_10_001_character_message_is_shortened_with_a_visible_note_not_dropped() {
        let mut lead = blank_lead("lead-1");
        lead.message = Some("m".repeat(MAX_MESSAGE_LEN + 1));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let result = enforce_bounds(page).unwrap();
        // The lead survives - this is the whole point, unlike id/email/phone.
        assert_eq!(result.leads.len(), 1);
        let msg = result.leads[0].message.as_deref().unwrap();
        assert!(msg.starts_with(&"m".repeat(MAX_MESSAGE_LEN)));
        assert!(msg.contains("shortened"));
    }

    #[test]
    fn a_two_megabyte_message_never_lands_verbatim() {
        let mut lead = blank_lead("lead-1");
        lead.message = Some("m".repeat(2 * 1024 * 1024));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let result = enforce_bounds(page).unwrap();
        let msg = result.leads[0].message.as_deref().unwrap();
        assert!(msg.len() < 2 * 1024 * 1024);
    }

    #[test]
    fn a_message_at_exactly_the_cap_is_left_alone_with_no_note() {
        let mut lead = blank_lead("lead-1");
        lead.message = Some("m".repeat(MAX_MESSAGE_LEN));
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let result = enforce_bounds(page).unwrap();
        assert_eq!(
            result.leads[0].message.as_deref().unwrap(),
            "m".repeat(MAX_MESSAGE_LEN)
        );
    }

    #[test]
    fn a_nul_byte_and_a_bidi_override_are_stripped_from_every_field() {
        let mut lead = blank_lead("lead-1\u{0}");
        lead.name = Some("evil\u{202E}exe.gpj".to_string());
        lead.message = Some("hello\u{0}world".to_string());
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let result = enforce_bounds(page).unwrap();
        assert!(!result.leads[0].id.contains('\u{0}'));
        assert!(!result.leads[0].name.as_deref().unwrap().contains('\u{202E}'));
        assert!(!result.leads[0].message.as_deref().unwrap().contains('\u{0}'));
    }

    #[test]
    fn a_four_byte_emoji_is_not_mangled_by_truncation() {
        let mut lead = blank_lead("lead-1");
        // An emoji is one `char` in Rust even though it is 4 bytes of UTF-8,
        // so truncating by character count never splits it mid-codepoint.
        let mut name = "🙂".repeat(MAX_NAME_LEN + 5);
        name.push_str("tail");
        lead.name = Some(name);
        let page = LeadPage {
            leads: vec![lead],
            next_cursor: None,
        };
        let result = enforce_bounds(page).unwrap();
        let out = result.leads[0].name.as_deref().unwrap();
        assert_eq!(char_len(out), MAX_NAME_LEN);
        assert!(out.chars().all(|c| c == '🙂'));
    }

    /* ---------------------------------------------------------------- */
    /* json_depth_within_limit                                          */
    /* ---------------------------------------------------------------- */

    #[test]
    fn a_normal_lead_page_is_well_within_the_depth_limit() {
        let body = br#"{"leads":[{"id":"1","createdAt":"x","name":"Bob"}],"nextCursor":null}"#;
        assert!(json_depth_within_limit(body, MAX_JSON_DEPTH));
    }

    #[test]
    fn deeply_nested_arrays_are_refused_before_parsing() {
        let mut body = "[".repeat(MAX_JSON_DEPTH + 50);
        body.push_str(&"]".repeat(MAX_JSON_DEPTH + 50));
        assert!(!json_depth_within_limit(body.as_bytes(), MAX_JSON_DEPTH));
    }

    #[test]
    fn brackets_inside_a_quoted_string_do_not_count_toward_depth() {
        let body = format!(
            r#"{{"leads":[{{"id":"1","message":"{}"}}]}}"#,
            "[".repeat(MAX_JSON_DEPTH + 50)
        );
        assert!(json_depth_within_limit(body.as_bytes(), MAX_JSON_DEPTH));
    }

    /* ---------------------------------------------------------------- */
    /* shape failures caught by plain serde deserialisation              */
    /* ---------------------------------------------------------------- */

    #[test]
    fn an_empty_object_fails_to_deserialise_because_leads_is_required() {
        assert!(serde_json::from_slice::<LeadPage>(b"{}").is_err());
    }

    #[test]
    fn a_null_leads_field_fails_to_deserialise() {
        assert!(serde_json::from_slice::<LeadPage>(br#"{"leads":null}"#).is_err());
    }

    #[test]
    fn a_non_string_id_fails_to_deserialise() {
        assert!(serde_json::from_slice::<LeadPage>(
            br#"{"leads":[{"id":{"a":1},"createdAt":"x"}]}"#
        )
        .is_err());
    }

    #[test]
    fn a_non_json_body_fails_to_deserialise_regardless_of_content_type() {
        assert!(serde_json::from_slice::<LeadPage>(b"<html>not json</html>").is_err());
    }

    /* ---------------------------------------------------------------- */
    /* redaction                                                        */
    /* ---------------------------------------------------------------- */

    #[test]
    fn the_exact_token_is_redacted_out_of_a_diagnostic_snippet() {
        let out = redact_diagnostic_text("invalid token: hx_live_abc123", "hx_live_abc123");
        assert!(!out.contains("hx_live_abc123"));
    }

    #[test]
    fn a_bearer_shaped_value_is_redacted_even_when_it_is_not_the_exact_token() {
        // The site re-cased or re-quoted the credential rather than echoing
        // it byte for byte; the exact-match replacement alone would miss it.
        let out = redact_diagnostic_text("Bearer HX_LIVE_ABC123 is not recognised", "hx_live_abc123");
        assert!(!out.to_lowercase().contains("hx_live_abc123"));
    }

    #[test]
    fn ordinary_text_with_no_credential_shape_is_left_readable() {
        let out = redact_diagnostic_text("internal server error", "hx_live_abc123");
        assert_eq!(out, "internal server error");
    }

    /* ---------------------------------------------------------------- */
    /* network-level behaviour against a real local server               */
    /* ---------------------------------------------------------------- */

    /// Binds an ephemeral loopback port, accepts exactly one connection,
    /// drains the request up to the blank line ending its headers (this is
    /// always a GET with no body, so nothing more is needed), and writes
    /// `response` verbatim. Write errors are ignored: several tests make the
    /// client hang up early on purpose (the byte cap tripping mid-stream),
    /// and the server side does not need to know that happened.
    fn spawn_http_server(response: Vec<u8>) -> (SocketAddr, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let addr = listener.local_addr().expect("local addr");
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let _ = stream.set_read_timeout(Some(StdDuration::from_millis(500)));
                let mut buf = [0u8; 4096];
                let mut seen = Vec::new();
                loop {
                    match stream.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            seen.extend_from_slice(&buf[..n]);
                            if seen.windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
        });
        (addr, handle)
    }

    fn leads_url(addr: SocketAddr) -> reqwest::Url {
        reqwest::Url::parse(&format!("http://{addr}/api/crm/leads")).unwrap()
    }

    #[test]
    fn a_content_length_over_the_cap_is_refused_before_any_body_is_read() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 999999999\r\n\r\n".to_vec();
        let (addr, handle) = spawn_http_server(response);
        let result = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "tok",
            1024,
            64,
        ));
        let err = result.unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        assert!(err.message.contains("KB") || err.message.contains("MB") || err.message.contains("bytes"));
        handle.join().unwrap();
    }

    #[test]
    fn a_body_that_exceeds_the_cap_mid_stream_is_refused_with_no_content_length() {
        let mut response =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n".to_vec();
        // No Content-Length: the client must read-until-close, and the cap
        // must trip on bytes actually received, not on a header.
        response.extend(std::iter::repeat(b'a').take(20_000));
        let (addr, handle) = spawn_http_server(response);
        let result = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "tok",
            1024,
            64,
        ));
        let err = result.unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        handle.join().unwrap();
    }

    #[test]
    fn a_small_valid_page_within_the_cap_succeeds() {
        let body = br#"{"leads":[{"id":"1","createdAt":"2026-01-01T00:00:00Z","name":"Bob","email":null,"phone":null,"service":null,"message":null,"pageUrl":null}],"nextCursor":null}"#;
        let mut response =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n".to_vec();
        response.extend_from_slice(body);
        let (addr, handle) = spawn_http_server(response);
        let page = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "tok",
            MAX_RESPONSE_BYTES,
            MAX_JSON_DEPTH,
        ))
        .unwrap();
        assert_eq!(page.leads.len(), 1);
        assert_eq!(page.leads[0].id, "1");
        handle.join().unwrap();
    }

    #[test]
    fn a_redirect_is_never_followed_and_the_target_is_never_contacted() {
        let contacted = Arc::new(AtomicBool::new(false));
        let redirect_listener = TcpListener::bind("127.0.0.1:0").expect("bind redirect target");
        let redirect_addr = redirect_listener.local_addr().unwrap();
        let contacted_clone = contacted.clone();
        let redirect_handle = std::thread::spawn(move || {
            redirect_listener
                .set_nonblocking(true)
                .expect("nonblocking");
            let deadline = std::time::Instant::now() + StdDuration::from_millis(400);
            while std::time::Instant::now() < deadline {
                if redirect_listener.accept().is_ok() {
                    contacted_clone.store(true, Ordering::SeqCst);
                    break;
                }
                std::thread::sleep(StdDuration::from_millis(10));
            }
        });

        let response = format!(
            "HTTP/1.1 302 Found\r\nLocation: http://{redirect_addr}/api/crm/leads\r\nContent-Length: 0\r\n\r\n"
        )
        .into_bytes();
        let (addr, handle) = spawn_http_server(response);

        let result = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "tok",
            MAX_RESPONSE_BYTES,
            MAX_JSON_DEPTH,
        ));
        let err = result.unwrap_err();
        assert_eq!(err.code, "HTTP_STATUS");
        assert!(err.message.contains("302"));

        handle.join().unwrap();
        redirect_handle.join().unwrap();
        assert!(
            !contacted.load(Ordering::SeqCst),
            "the redirect target must never receive a connection"
        );
    }

    #[test]
    fn a_401_body_that_echoes_the_token_never_reaches_the_error_message() {
        let response = b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":\"invalid token: secret-token-xyz\"}".to_vec();
        let (addr, handle) = spawn_http_server(response);
        let result = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "secret-token-xyz",
            MAX_RESPONSE_BYTES,
            MAX_JSON_DEPTH,
        ));
        let err = result.unwrap_err();
        assert_eq!(err.code, "HTTP_STATUS");
        assert!(!err.message.contains("secret-token-xyz"));
        handle.join().unwrap();
    }

    #[test]
    fn a_500_body_has_the_token_redacted_but_otherwise_keeps_its_detail() {
        let response = b"HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nboom: secret-token-xyz did something".to_vec();
        let (addr, handle) = spawn_http_server(response);
        let result = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "secret-token-xyz",
            MAX_RESPONSE_BYTES,
            MAX_JSON_DEPTH,
        ));
        let err = result.unwrap_err();
        assert_eq!(err.code, "HTTP_STATUS");
        assert!(!err.message.contains("secret-token-xyz"));
        assert!(err.message.contains("boom"));
        handle.join().unwrap();
    }

    #[test]
    fn a_non_json_body_with_a_json_content_type_fails_closed() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n<html>not json</html>".to_vec();
        let (addr, handle) = spawn_http_server(response);
        let result = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "tok",
            MAX_RESPONSE_BYTES,
            MAX_JSON_DEPTH,
        ));
        let err = result.unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        handle.join().unwrap();
    }

    #[test]
    fn deeply_nested_json_over_the_network_fails_closed_before_parsing() {
        let mut json = "[".repeat(MAX_JSON_DEPTH + 100);
        json.push_str(&"]".repeat(MAX_JSON_DEPTH + 100));
        let mut response =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n".to_vec();
        response.extend_from_slice(json.as_bytes());
        let (addr, handle) = spawn_http_server(response);
        let result = tauri::async_runtime::block_on(fetch_page_with_limits(
            leads_url(addr),
            "tok",
            MAX_RESPONSE_BYTES,
            MAX_JSON_DEPTH,
        ));
        let err = result.unwrap_err();
        assert_eq!(err.code, "NET_ERROR");
        assert!(err.message.contains("nested"));
        handle.join().unwrap();
    }
}
