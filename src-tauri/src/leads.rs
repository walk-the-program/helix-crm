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

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::secrets;

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_LIMIT: u32 = 200;

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

    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .use_rustls_tls()
        .build()
        .map_err(|e| AppError::net(format!("Could not start the request: {e}")))?;

    let response = client
        .get(url)
        .bearer_auth(&token)
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
        let body = response.text().await.unwrap_or_default();
        let mut detail: String = body.chars().take(200).collect();
        if detail.trim().is_empty() {
            detail = status
                .canonical_reason()
                .unwrap_or("no details")
                .to_string();
        }
        return Err(AppError::http_status(status.as_u16(), detail));
    }

    response
        .json::<LeadPage>()
        .await
        .map_err(|e| AppError::net(format!("The site's answer was not the expected shape: {e}")))
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
    use std::path::Path;

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
}
