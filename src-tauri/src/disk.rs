//! Whole-disk encryption status, for the Diagnostics screen.
//!
//! SQLCipher (see db.rs) protects the workspace file itself, but that is only
//! half the threat model: a stolen laptop still exposes swap, temp files, and
//! anything else the OS writes to disk unless full-disk encryption is also
//! switched on. This module asks the OS whether it is — FileVault on macOS,
//! BitLocker on Windows — so the owner can see the other half of the picture
//! without opening a terminal.
//!
//! Nothing here may fail the app. The system tools involved (`fdesetup`,
//! `manage-bde`, WMI over PowerShell) can be absent, unsupported on the
//! edition installed, require elevation, hang, or print something we don't
//! recognize. Every one of those is reported as `encrypted: None` with a
//! `detail` explaining what happened, never as a command error.
//!
//! Each tool is named by its ABSOLUTE path rather than left to a PATH or
//! working-directory search. This is a diagnostics screen, not a privileged
//! operation, so the exposure was small - but `Command::new("manage-bde")` on
//! Windows searches the process's current directory before PATH, and a CRM
//! whose window was opened from a downloads folder should not be the reason a
//! planted binary runs. `SystemRoot` is read from the environment rather than
//! hard-coded to `C:\Windows` (F-SEC-8).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskEncryptionStatus {
    pub platform: String,
    pub encrypted: Option<bool>,
    pub detail: String,
}

/// How long we'll wait for a status tool before giving up on it.
const CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// Run a spawned child to completion with a hard timeout, killing it if it
/// overruns. Returns `None` on timeout or if the child couldn't be waited on;
/// killing only ever targets the child this call itself spawned.
fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: std::time::Duration,
) -> Option<std::process::Output> {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                // The child has already exited; wait_with_output reaps it and
                // collects the buffered stdout/stderr.
                return child.wait_with_output().ok();
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(_) => return None,
        }
    }
}

// ---------------------------------------------------------------------------
// macOS: fdesetup
// ---------------------------------------------------------------------------

/// Parses `fdesetup status` output. Tolerant of case and of the
/// deferred-enablement wording ("... but will be enabled after the next
/// restart."), which still means FileVault is off right now.
pub(crate) fn parse_fdesetup_status(output: &str) -> Option<bool> {
    let lower = output.to_ascii_lowercase();
    if lower.contains("filevault is off") {
        Some(false)
    } else if lower.contains("filevault is on") {
        Some(true)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn fdesetup_detail(raw: &str, encrypted: Option<bool>) -> String {
    let lower = raw.to_ascii_lowercase();
    match encrypted {
        Some(true) => "FileVault is on.".to_string(),
        Some(false) if lower.contains("will be enabled after the next restart") => {
            "FileVault is off, but will turn on after the next restart.".to_string()
        }
        Some(false) => "FileVault is off.".to_string(),
        None => "Could not tell whether FileVault is on from fdesetup's output.".to_string(),
    }
}

#[cfg(target_os = "macos")]
fn check_macos() -> DiskEncryptionStatus {
    let platform = "macos".to_string();

    let child = match std::process::Command::new("/usr/bin/fdesetup")
        .arg("status")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            return DiskEncryptionStatus {
                platform,
                encrypted: None,
                detail: format!("Could not run fdesetup: {e}."),
            };
        }
    };

    let Some(output) = wait_with_timeout(child, CHECK_TIMEOUT) else {
        return DiskEncryptionStatus {
            platform,
            encrypted: None,
            detail: "Could not run fdesetup: it did not respond in time.".to_string(),
        };
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}\n{stderr}");

    let encrypted = parse_fdesetup_status(&combined);
    let detail = if encrypted.is_some() {
        fdesetup_detail(&combined, encrypted)
    } else if combined.trim().is_empty() {
        "Could not run fdesetup: it produced no output.".to_string()
    } else {
        "Could not tell whether FileVault is on from fdesetup's output.".to_string()
    };

    DiskEncryptionStatus {
        platform,
        encrypted,
        detail,
    }
}

// ---------------------------------------------------------------------------
// Windows: manage-bde, falling back to WMI over PowerShell
// ---------------------------------------------------------------------------

/// Parses a `manage-bde -status <drive>` block by finding the "Protection
/// Status" line and matching "Protection On" / "Protection Off" on it.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn parse_manage_bde_status(output: &str) -> Option<bool> {
    for line in output.lines() {
        let lower = line.to_ascii_lowercase();
        if !lower.contains("protection status") {
            continue;
        }
        if lower.contains("protection on") {
            return Some(true);
        }
        if lower.contains("protection off") {
            return Some(false);
        }
        return None;
    }
    None
}

/// Parses the numeric `ProtectionStatus` printed by the WMI/PowerShell
/// fallback: 0 = off, 1 or 2 = on, anything else (including unparsable or
/// empty text) = unknown.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn parse_wmi_protection_status(output: &str) -> Option<bool> {
    match output.trim().parse::<i64>() {
        Ok(0) => Some(false),
        Ok(1) | Ok(2) => Some(true),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn system_drive() -> String {
    std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string())
}

/// `<SystemRoot>\System32\<name>`, so neither the current directory nor PATH
/// decides which binary runs.
#[cfg(target_os = "windows")]
fn system32(name: &str) -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    format!("{root}\\System32\\{name}")
}

#[cfg(target_os = "windows")]
fn run_hidden(program: &str, args: &[&str]) -> Option<std::process::Output> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let child = std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;

    wait_with_timeout(child, CHECK_TIMEOUT)
}

#[cfg(target_os = "windows")]
fn check_windows() -> DiskEncryptionStatus {
    let platform = "windows".to_string();
    let drive = system_drive();

    if let Some(output) = run_hidden(&system32("manage-bde.exe"), &["-status", &drive]) {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{stdout}\n{stderr}");
        if let Some(encrypted) = parse_manage_bde_status(&combined) {
            let detail = if encrypted {
                "BitLocker protection is on.".to_string()
            } else {
                "BitLocker protection is off.".to_string()
            };
            return DiskEncryptionStatus {
                platform,
                encrypted: Some(encrypted),
                detail,
            };
        }
        // manage-bde ran but we couldn't read a protection line from it
        // (missing, needs elevation, Home edition without the tool wired up
        // the way we expect) — fall through to the WMI fallback.
    }

    let script = format!(
        "(Get-CimInstance -Namespace root/CIMV2/Security/MicrosoftVolumeEncryption \
         -ClassName Win32_EncryptableVolume -Filter \"DriveLetter='{drive}'\").ProtectionStatus"
    );
    let powershell = system32("WindowsPowerShell\\v1.0\\powershell.exe");
    if let Some(output) = run_hidden(&powershell, &["-NoProfile", "-NonInteractive", "-Command", &script]) {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(encrypted) = parse_wmi_protection_status(&stdout) {
            let detail = if encrypted {
                "BitLocker protection is on (checked via WMI).".to_string()
            } else {
                "BitLocker protection is off (checked via WMI).".to_string()
            };
            return DiskEncryptionStatus {
                platform,
                encrypted: Some(encrypted),
                detail,
            };
        }
    }

    DiskEncryptionStatus {
        platform,
        encrypted: None,
        detail: "Could not tell whether BitLocker is on: tried manage-bde and a WMI check, \
                  neither gave a clear answer."
            .to_string(),
    }
}

// ---------------------------------------------------------------------------
// Other platforms
// ---------------------------------------------------------------------------

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn check_other() -> DiskEncryptionStatus {
    DiskEncryptionStatus {
        platform: std::env::consts::OS.to_string(),
        encrypted: None,
        detail: format!(
            "Disk encryption checks aren't implemented for {}.",
            std::env::consts::OS
        ),
    }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn disk_encryption_status() -> DiskEncryptionStatus {
    #[cfg(target_os = "macos")]
    {
        check_macos()
    }
    #[cfg(target_os = "windows")]
    {
        check_windows()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        check_other()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fdesetup_on() {
        assert_eq!(parse_fdesetup_status("FileVault is On."), Some(true));
    }

    #[test]
    fn fdesetup_off() {
        assert_eq!(parse_fdesetup_status("FileVault is Off."), Some(false));
    }

    #[test]
    fn fdesetup_deferred_is_off() {
        assert_eq!(
            parse_fdesetup_status(
                "FileVault is Off, but will be enabled after the next restart."
            ),
            Some(false)
        );
    }

    #[test]
    fn fdesetup_empty_and_noise_are_unknown() {
        assert_eq!(parse_fdesetup_status(""), None);
        assert_eq!(parse_fdesetup_status("some unrelated error text"), None);
    }

    #[test]
    fn fdesetup_mixed_case() {
        assert_eq!(parse_fdesetup_status("filevault IS ON"), Some(true));
        assert_eq!(parse_fdesetup_status("FileVault Is OFF"), Some(false));
    }

    #[test]
    fn manage_bde_protection_on() {
        let block = "\
BitLocker Drive Encryption: Configuration Tool version 10.0.19041
Copyright (C) 2013 Microsoft Corporation. All rights reserved.

Volume C: [OS]
[OS Volume]

    Size:                 476.63 GB
    BitLocker Version:    2.0
    Conversion Status:    Fully Encrypted
    Percentage Encrypted: 100.0%
    Encryption Method:    XTS-AES 128
    Protection Status:    Protection On
    Lock Status:          Unlocked
    Identification Field: Unknown
    Key Protectors:
        TPM
        Numerical Password";
        assert_eq!(parse_manage_bde_status(block), Some(true));
    }

    #[test]
    fn manage_bde_protection_off() {
        let block = "\
Volume C: [OS]
[OS Volume]

    Size:                 476.63 GB
    Conversion Status:    Fully Decrypted
    Protection Status:    Protection Off
    Lock Status:          Unlocked";
        assert_eq!(parse_manage_bde_status(block), Some(false));
    }

    #[test]
    fn manage_bde_error_is_unknown() {
        let block = "\
BitLocker Drive Encryption: Configuration Tool version 10.0.19041
ERROR: The system cannot find the drive specified.";
        assert_eq!(parse_manage_bde_status(block), None);
    }

    #[test]
    fn wmi_protection_status_values() {
        assert_eq!(parse_wmi_protection_status("0"), Some(false));
        assert_eq!(parse_wmi_protection_status("1"), Some(true));
        assert_eq!(parse_wmi_protection_status("2"), Some(true));
        assert_eq!(parse_wmi_protection_status(""), None);
        assert_eq!(parse_wmi_protection_status("banana"), None);
    }
}
