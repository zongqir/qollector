#!/usr/bin/env pwsh
# PasteHarbor One-Click Release
# Usage: .\release.ps1
# Does everything: key generation (if needed) -> build -> sign -> upload to GitHub

$ErrorActionPreference = "Stop"

$KEY_DIR = "$env:USERPROFILE\.tauri"
$PRIVATE_KEY_PATH = "$KEY_DIR\clipbox.key"
$PUBLIC_KEY_PATH = "$KEY_DIR\clipbox.key.pub"
$TAURI_CONF = "src-tauri\tauri.conf.json"
$OUTPUT_DIR = "release-artifacts"
$GITHUB_REPO = "zongqir/clipbox"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   $msg" -ForegroundColor Yellow }

# ===== Step 1: Ensure signing key exists =====
if (!(Test-Path $PRIVATE_KEY_PATH)) {
    Write-Step "First run detected - generating signing key pair"
    if (!(Test-Path $KEY_DIR)) { New-Item -ItemType Directory -Path $KEY_DIR | Out-Null }

    npx tauri signer generate -w $PRIVATE_KEY_PATH
    if ($LASTEXITCODE -ne 0) { throw "Key generation failed" }

    Write-Ok "Private key: $PRIVATE_KEY_PATH"
    Write-Ok "Public key:  $PUBLIC_KEY_PATH"
} else {
    Write-Step "Signing key found"
    Write-Ok $PRIVATE_KEY_PATH
}

# ===== Step 2: Sync public key into tauri.conf.json if needed =====
Write-Step "Checking pubkey in $TAURI_CONF"
$conf = Get-Content $TAURI_CONF -Raw | ConvertFrom-Json -Depth 20
$currentPubkey = $conf.plugins.updater.pubkey

if ((!$currentPubkey -or $currentPubkey -eq "") -and (Test-Path $PUBLIC_KEY_PATH)) {
    $pubkey = (Get-Content $PUBLIC_KEY_PATH -Raw).Trim()
    $conf.plugins.updater.pubkey = $pubkey
    $conf | ConvertTo-Json -Depth 20 | Set-Content $TAURI_CONF -Encoding UTF8
    Write-Ok "Public key written to tauri.conf.json"
    # Re-read after write
    $conf = Get-Content $TAURI_CONF -Raw | ConvertFrom-Json -Depth 20
} else {
    Write-Ok "Public key already configured"
}

$version = $conf.version
Write-Ok "Version: $version"

# ===== Step 3: Load signing key =====
Write-Step "Loading signing key"
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $PRIVATE_KEY_PATH -Raw
if (!$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $secPwd = Read-Host "Signing key password (Enter if none)" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd)
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}
Write-Ok "Signing key loaded"

# ===== Step 4: Build =====
Write-Step "Building Tauri application (this may take a while)"
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Write-Ok "Build complete"

# ===== Step 5: Collect artifacts + generate latest.json =====
Write-Step "Collecting build artifacts"
$nsisDir = "src-tauri\target\release\bundle\nsis"

$installer = Get-ChildItem "$nsisDir\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$installer) { throw "No installer found in $nsisDir" }

$sig = Get-ChildItem "$nsisDir\*.exe.sig" -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$sig) { throw "No .sig file found - signing may have failed" }

Write-Ok "Installer: $($installer.Name)"
Write-Ok "Signature: $($sig.Name)"

if (Test-Path $OUTPUT_DIR) { Remove-Item "$OUTPUT_DIR\*" -Force }
else { New-Item -ItemType Directory -Path $OUTPUT_DIR | Out-Null }

Copy-Item $installer.FullName "$OUTPUT_DIR\" -Force
Copy-Item $sig.FullName "$OUTPUT_DIR\" -Force

$releaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$sigContent = (Get-Content $sig.FullName -Raw).Trim()

$latestJson = @{
    version   = "v$version"
    notes     = "Release v$version"
    pub_date  = $releaseDate
    platforms = @{
        "windows-x86_64" = @{
            signature = $sigContent
            url       = "https://github.com/$GITHUB_REPO/releases/download/v$version/$($installer.Name)"
        }
    }
} | ConvertTo-Json -Depth 10

$latestJson | Set-Content "$OUTPUT_DIR\latest.json" -Encoding UTF8
Write-Ok "latest.json generated"

# ===== Step 6: Upload to GitHub Release =====
Write-Step "Uploading to GitHub Release v$version"

# Check gh CLI
if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Warn "gh CLI not found. Install from https://cli.github.com"
    Write-Warn "Then run manually:"
    Write-Host "   gh release create v$version $OUTPUT_DIR\* --repo $GITHUB_REPO --title `"v$version`" --notes `"Release v$version`"" -ForegroundColor DarkGray
    exit 0
}

# Delete existing release with same tag if any
gh release view "v$version" --repo $GITHUB_REPO 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Warn "Release v$version already exists, overwriting..."
    gh release delete "v$version" --repo $GITHUB_REPO --yes 2>$null
    git tag -d "v$version" 2>$null
    git push origin ":refs/tags/v$version" 2>$null
}

$files = Get-ChildItem "$OUTPUT_DIR\*" | ForEach-Object { $_.FullName }
gh release create "v$version" @files --repo $GITHUB_REPO --title "v$version" --notes "Release v$version"
if ($LASTEXITCODE -ne 0) { throw "GitHub release upload failed" }

Write-Ok "Release v$version published!"
Write-Host "`n   https://github.com/$GITHUB_REPO/releases/tag/v$version`n" -ForegroundColor Green
