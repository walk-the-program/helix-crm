<#
.SYNOPSIS
    Downloads the msedgedriver build that matches the machine's installed
    WebView2 Evergreen runtime, for Helix CRM's Windows e2e suite.

.DESCRIPTION
    tauri-driver drives a Tauri app's WebView2 control by forwarding WebDriver
    commands to msedgedriver, the WebDriver server for Microsoft Edge /
    WebView2. As with Chrome/chromedriver, msedgedriver refuses to drive a
    WebView2 runtime whose version does not match its own, so the driver has
    to be re-resolved on whatever machine (CI runner or a dev's Windows VM)
    is going to run the suite.

    This script:
      1. Reads the installed WebView2 Evergreen runtime version, first from
         the registry (HKLM, then HKCU), then - if the registry lookup fails -
         from the version folder name under the WebView2 install directory.
      2. Downloads the msedgedriver win64 zip for that exact version.
      3. If that exact version has not been published as a driver yet (which
         happens right after a WebView2 release), retries against the latest
         published driver for the same MAJOR version, resolved from that
         version's LATEST_RELEASE_<major>_WINDOWS pointer file.
      4. Expands the driver into -OutDir and reports its path.

    Re-running this script is cheap: if a driver matching the target version
    is already present in -OutDir, the download is skipped.

.PARAMETER OutDir
    Directory to download and extract msedgedriver.exe into. Defaults to
    "<script directory>\..\.drivers", i.e. tests\e2e-win\.drivers - the same
    location wdio.conf.ts falls back to when MSEDGEDRIVER_PATH is not set.

.EXAMPLE
    .\match-msedgedriver.ps1

    Detects the installed WebView2 version, downloads the matching
    msedgedriver into tests\e2e-win\.drivers, prints its path, and (when run
    inside GitHub Actions) writes it to $env:GITHUB_OUTPUT as
    "msedgedriver-path".

.EXAMPLE
    .\match-msedgedriver.ps1 -OutDir C:\drivers

    Same, but extracts into C:\drivers instead of the default location.
#>
[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path $PSScriptRoot '..\.drivers')
)

$ErrorActionPreference = 'Stop'

# The msedgedriver.microsoft.com endpoints are plain HTTPS with no exotic
# ciphers, but PowerShell 5.1's default SecurityProtocol on some Windows
# images does not include TLS 1.2, which makes Invoke-WebRequest fail with a
# generic "could not create SSL/TLS secure channel" error. Force it on.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$webview2ClientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$registryPaths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webview2ClientId",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webview2ClientId"
)

function Get-WebView2VersionFromRegistry {
    foreach ($registryPath in $registryPaths) {
        try {
            if (Test-Path -Path $registryPath) {
                $pv = (Get-ItemProperty -Path $registryPath -Name 'pv' -ErrorAction Stop).pv
                if ($pv) {
                    return $pv.Trim()
                }
            }
        } catch {
            # Try the next registry path (or fall through to the filesystem
            # fallback below) instead of failing here.
            Write-Verbose "Could not read 'pv' from ${registryPath}: $($_.Exception.Message)"
        }
    }
    return $null
}

function Get-WebView2VersionFromFilesystem {
    $installRoot = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'
    if (-not (Test-Path -Path $installRoot)) {
        return $null
    }

    $versionDir = Get-ChildItem -Path $installRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+(\.\d+){3}$' } |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1

    if ($versionDir) {
        return $versionDir.Name
    }
    return $null
}

function Get-EdgeDriverZipUrl {
    param([Parameter(Mandatory)][string]$Version)
    return "https://msedgedriver.microsoft.com/$Version/edgedriver_win64.zip"
}

function Invoke-EdgeDriverDownload {
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$DestinationZip
    )

    $url = Get-EdgeDriverZipUrl -Version $Version
    Write-Host "Downloading $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $DestinationZip -UseBasicParsing
        return $true
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -eq 404) {
            return $false
        }
        throw
    }
}

# --- Resolve the installed WebView2 runtime version -------------------------

$webview2Version = Get-WebView2VersionFromRegistry
if (-not $webview2Version) {
    Write-Verbose 'WebView2 version not found in the registry; checking the EdgeWebView install directory instead.'
    $webview2Version = Get-WebView2VersionFromFilesystem
}

if (-not $webview2Version) {
    $checked = $registryPaths -join '; '
    throw ("Could not determine the installed WebView2 runtime version. Checked the registry " +
        "($checked) and '%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application'. " +
        "Is the WebView2 Evergreen runtime installed on this machine?")
}

Write-Host "Installed WebView2 runtime version: $webview2Version"

# --- Skip the download if we already have a matching driver -----------------

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$OutDir = (Resolve-Path -Path $OutDir).Path
$driverExePath = Join-Path $OutDir 'msedgedriver.exe'
$versionMarkerPath = Join-Path $OutDir 'DRIVER_VERSION.txt'

$alreadyCurrent = (Test-Path -Path $driverExePath) -and (Test-Path -Path $versionMarkerPath) -and
    ((Get-Content -Path $versionMarkerPath -Raw).Trim() -eq $webview2Version)

if ($alreadyCurrent) {
    Write-Host "msedgedriver $webview2Version already present at $driverExePath; skipping download."
} else {
    $zipPath = Join-Path $OutDir 'edgedriver_win64.zip'
    $resolvedVersion = $webview2Version

    $downloaded = Invoke-EdgeDriverDownload -Version $webview2Version -DestinationZip $zipPath
    if (-not $downloaded) {
        $majorVersion = $webview2Version.Split('.')[0]
        Write-Host "No driver published for exact version $webview2Version; falling back to the latest $majorVersion.x release."

        $latestReleaseUrl = "https://msedgedriver.microsoft.com/LATEST_RELEASE_${majorVersion}_WINDOWS"

        # This pointer file is served as UTF-16 with a byte-order mark, not
        # plain ASCII/UTF-8. Decoding it as text with the wrong encoding
        # leaves embedded null bytes / a leading BOM character in the
        # "version" string, which then fails to match any real release.
        $rawBytes = (New-Object Net.WebClient).DownloadData($latestReleaseUrl)
        # U+FEFF (the BOM) is a format character, not whitespace, so a plain
        # .Trim() would leave it in place - strip it explicitly first, then
        # trim the surrounding whitespace/newline.
        $resolvedVersion = [Text.Encoding]::Unicode.GetString($rawBytes).TrimStart([char]0xFEFF).Trim()

        if (-not $resolvedVersion) {
            throw "Could not resolve a msedgedriver release for major version $majorVersion from $latestReleaseUrl"
        }
        Write-Host "Latest published driver for major version ${majorVersion}: $resolvedVersion"

        $downloaded = Invoke-EdgeDriverDownload -Version $resolvedVersion -DestinationZip $zipPath
        if (-not $downloaded) {
            throw "Failed to download msedgedriver for both the exact version ($webview2Version) and the fallback ($resolvedVersion)."
        }
    }

    Write-Host "Extracting $zipPath to $OutDir"
    Expand-Archive -Path $zipPath -DestinationPath $OutDir -Force
    Remove-Item -Path $zipPath -Force

    # The marker records the RUNTIME version this driver was fetched for, not
    # the driver's own version: after a fallback those differ, and keying the
    # skip-the-download check on the driver version would re-download on every
    # run until the exact driver was finally published.
    Set-Content -Path $versionMarkerPath -Value $webview2Version -NoNewline
    if ($resolvedVersion -ne $webview2Version) {
        Write-Host "Driver version $resolvedVersion is serving WebView2 runtime $webview2Version."
    }
}

if (-not (Test-Path -Path $driverExePath)) {
    throw "msedgedriver.exe was not found at $driverExePath after download/extraction."
}

# --- Report the result --------------------------------------------------

if ($env:GITHUB_OUTPUT) {
    Add-Content -Path $env:GITHUB_OUTPUT -Value "msedgedriver-path=$driverExePath"
}

Write-Output $driverExePath
