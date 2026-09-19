//! The single error type crossing the IPC boundary.
//!
//! Every Rust command in Helix returns `Result<T, AppError>`, and `AppError`
//! serialises as `{ "code": "...", "message": "..." }` exactly as
//! `docs/CONTRACTS.md` specifies. The TypeScript side switches on `code`; the
//! `message` is for humans and the log, never for control flow.

use serde::Serialize;

/// The closed set of error codes from `docs/CONTRACTS.md`.
///
/// Keep this list and the contract in lockstep. Adding a code is a contract
/// change and must be reported to the orchestrator, not made unilaterally.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    /// A database command arrived while no connection is open.
    DbClosed,
    /// `db_open` could not open or configure the file.
    DbOpenFailed,
    /// SQLite rejected the statement, or a parameter could not be bound.
    SqlError,
    /// `db_begin` inside a transaction, or `db_commit`/`db_rollback` outside one.
    TxState,
    /// `db_backup` could not produce the backup file.
    BackupFailed,
    /// Filesystem trouble: unreadable source, oversize attachment, bad path.
    IoError,
    /// The OS keychain refused or is unavailable.
    SecretError,
    /// DNS, TLS, timeout: the request never produced a response.
    NetError,
    /// A response arrived with a non-2xx status; the status is in the message.
    HttpStatus,
    /// SQLite was built without FTS5.
    #[allow(dead_code)]
    FtsMissing,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::DbClosed => "DB_CLOSED",
            Code::DbOpenFailed => "DB_OPEN_FAILED",
            Code::SqlError => "SQL_ERROR",
            Code::TxState => "TX_STATE",
            Code::BackupFailed => "BACKUP_FAILED",
            Code::IoError => "IO_ERROR",
            Code::SecretError => "SECRET_ERROR",
            Code::NetError => "NET_ERROR",
            Code::HttpStatus => "HTTP_STATUS",
            Code::FtsMissing => "FTS_MISSING",
        }
    }
}

/// The error the frontend sees.
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self {
            code: code.as_str(),
            message: message.into(),
        }
    }

    pub fn db_closed() -> Self {
        Self::new(
            Code::DbClosed,
            "No database is open. Helix is switching workspaces or restoring a backup.",
        )
    }

    pub fn sql(message: impl Into<String>) -> Self {
        Self::new(Code::SqlError, message)
    }

    pub fn tx_state(message: impl Into<String>) -> Self {
        Self::new(Code::TxState, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(Code::IoError, message)
    }

    pub fn secret(message: impl Into<String>) -> Self {
        Self::new(Code::SecretError, message)
    }

    pub fn net(message: impl Into<String>) -> Self {
        Self::new(Code::NetError, message)
    }

    /// The contract requires the numeric status to travel inside the message.
    pub fn http_status(status: u16, message: impl AsRef<str>) -> Self {
        Self::new(
            Code::HttpStatus,
            format!("HTTP {} from the site: {}", status, message.as_ref()),
        )
    }

    /// True when this error carries the given code. Used by the tests.
    pub fn is(&self, code: Code) -> bool {
        self.code == code.as_str()
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::sql(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::io(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
