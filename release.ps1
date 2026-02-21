#!/usr/bin/env pwsh
# PasteHarbor Release Script
# Usage:
#   .\release.ps1 generate-key     - Generate signing key pair (first time only)
#   .\release.ps1 build             - Build with signing and generate latest.json
#   .\release.ps1 build -SkipSign   - Build without signing (dev testing)

param(
    [Parameter(Position = 0)]
    [ValidateSet("generate-key", "build")]
    [string]$Command = "build",

    [switch]$SkipSign
)

$ErrorActionPreference = "Stop"

$KEY_DIR = "$env:USERPROFILE\.tauri"
$PRIVATE_KEY_PATH = "$KEY_DIR\clipbox.key"
$PUBLIC_KEY_PATH = "$KEY_DIR\clipbox.key.pub"
$TAURI_CONF = "src-tauri\tauri.conf.json"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   $msg" -ForegroundColor Yellow }

# ---------- generate-key ----------
function Invoke-GenerateKey {
    Write-Step "Generating Tauri signing key pair"

    if (Test-Path $PRIVATE_KEY_PATH) {
        Write-Warn "Key already exists at $PRIVATE_KEY_PATH"
        $confirm = Read-Host "Overwrite? (y/N)"
        if ($confirm -ne "y") {
            Write-Host "Aborted." -ForegroundColor Red
            return
        }
    }

    if (!(Test-Path $KEY_DIR)) { New-Item -ItemType Directory -Path $KEY_DIR | Out-Null }

    npx tauri signer generate -w $PRIVATE_KEY_PATH
    if ($LASTEXITCODE -ne 0) { throw "Key generation failed" }

    Write-Ok "Private key: $PRIVATE_KEY_PATH"
    Write-Ok "Public key:  $PUBLIC_KEY_PATH"

    # Read public key and patch tauri.conf.json
    if (Test-Path $PUBLIC_KEY_PATH) {
        $pubkey = (Get-Content $PUBLIC_KEY_PATH -Raw).Trim()
        $conf = Get-Content $TAURI_CONF -Raw | ConvertFrom-Json -Depth 20
        $conf.plugins.updater.pubkey = $pubkey
        $conf | ConvertTo-Json -Depth 20 | Set-Content $TAURI_CONF -Encoding UTF8
        Write-Ok "Public key written to $TAURI_CONF plugins.updater.pubkey"
    }

    Write-Step "Done. Keep $PRIVATE_KEY_PATH safe and never commit it."
}

# ---------- build ----------
function Invoke-Build {
    Write-Step "Reading version from $TAURI_CONF"
    $conf = Get-Content $TAURI_CONF -Raw | ConvertFrom-Json -Depth 20
    $version = $conf.version
    Write-Ok "Version: $version"

    if (!$SkipSign) {
        # Validate signing key
        if (!(Test-Path $PRIVATE_KEY_PATH)) {
            throw "Signing key not found at $PRIVATE_KEY_PATH. Run: .\release.ps1 generate-key"
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $PRIVATE_KEY_PATH -Raw
        if (!$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
            $secPwd = Read-Host "Enter signing key password (or press Enter if none)" -AsSecureString
            $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd)
            $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        }
        Write-Ok "Signing key loaded"
    } else {
        Write-Warn "Skipping code signing (dev mode)"
    }

    Write-Step "Building Tauri application"
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
    Write-Ok "Build complete"

    # Locate build artifacts
    $bundleDir = "src-tauri\target\release\bundle"
    $nsisDir = "$bundleDir\nsis"

    $installer = Get-ChildItem "$nsisDir\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$installer) { throw "No installer found in $nsisDir" }
    Write-Ok "Installer: $($installer.Name)"

    $sig = Get-ChildItem "$nsisDir\*.exe.sig" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$SkipSign -and !$sig) { throw "No .sig file found. Signing may have failed." }

    # Generate latest.json for GitHub Releases updater endpoint
    Write-Step "Generating latest.json"
    $releaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $sigContent = if ($sig) { (Get-Content $sig.FullName -Raw).Trim() } else { "" }

    $latestJson = @{
        version = "v$version"
        notes   = "Release v$version"
        pub_date = $releaseDate
        platforms = @{
            "windows-x86_64" = @{
                signature = $sigContent
                url       = "https://github.com/zongqir/clipbox/releases/download/v$version/$($installer.Name)"
            }
        }
    } | ConvertTo-Json -Depth 10

    $outputDir = "release-artifacts"
    if (!(Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir | Out-Null }

    $latestJson | Set-Content "$outputDir\latest.json" -Encoding UTF8
    Copy-Item $installer.FullName "$outputDir\" -Force
    if ($sig) { Copy-Item $sig.FullName "$outputDir\" -Force }

    Write-Ok "Artifacts ready in $outputDir\"
    Write-Host ""
    Write-Step "Upload these files to GitHub Release v$version :"
    Get-ChildItem $outputDir | ForEach-Object { Write-Host "   - $($_.Name)" -ForegroundColor White }
    Write-Host ""
    Write-Host "   gh release create v$version $outputDir\* --title `"v$version`" --notes `"Release v$version`"" -ForegroundColor DarkGray
    Write-Host ""
}

# ---------- dispatch ----------
switch ($Command) {
    "generate-key" { Invoke-GenerateKey }
    "build"        { Invoke-Build }
}

