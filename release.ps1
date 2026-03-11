#!/usr/bin/env pwsh
# PasteHarbor One-Click Release
# Usage: .\release.ps1
# Does everything: key generation (if needed) -> build -> sign -> upload to GitHub

$ErrorActionPreference = "Stop"
$env:CI = "true"

$KEY_DIR = "$env:USERPROFILE\.tauri"
$PRIVATE_KEY_PATH = "$KEY_DIR\clipbox.key"
$PUBLIC_KEY_PATH = "$KEY_DIR\clipbox.key.pub"
$TAURI_CONF = "src-tauri\tauri.conf.json"
$OUTPUT_DIR = "release-artifacts"
$GITHUB_REPO = "zongqir/qollect"
$R2_BUCKET = "qollect"
$R2_PUBLIC_URL = "https://dl.135070.xyz"
$RELEASE_NOTES_PATH = "src\data\release-notes.json"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   $msg" -ForegroundColor Yellow }
function Normalize-Version([string]$rawVersion) {
    if ([string]::IsNullOrWhiteSpace($rawVersion)) { return "" }
    return ($rawVersion.Trim() -replace '^[vV]', '')
}

# ===== Step 1: Ensure signing key exists =====
if (!(Test-Path $PRIVATE_KEY_PATH)) {
    Write-Step "First run detected - generating signing key pair"
    if (!(Test-Path $KEY_DIR)) { New-Item -ItemType Directory -Path $KEY_DIR | Out-Null }

    $bootstrapSigningPassword = if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) { "" } else { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD }
    npx tauri signer generate --ci -p "$bootstrapSigningPassword" -w $PRIVATE_KEY_PATH
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

if (Test-Path $PUBLIC_KEY_PATH) {
    $pubkey = (Get-Content $PUBLIC_KEY_PATH -Raw).Trim()
    if ((!$currentPubkey -or $currentPubkey -eq "") -or ($currentPubkey.Trim() -ne $pubkey)) {
        $conf.plugins.updater.pubkey = $pubkey
        $conf | ConvertTo-Json -Depth 20 | Set-Content $TAURI_CONF -Encoding UTF8
        Write-Ok "Public key synced to tauri.conf.json"
        # Re-read after write
        $conf = Get-Content $TAURI_CONF -Raw | ConvertFrom-Json -Depth 20
    } else {
        Write-Ok "Public key already configured"
    }
} else {
    Write-Warn "Public key file not found: $PUBLIC_KEY_PATH"
}

$version = $conf.version
Write-Ok "Version: $version"

$releaseNotesForUpdater = "Release v$version"
$releaseNotesForGitHub = "Release v$version"
$releaseNotesZh = $null
$releaseNotesEn = $null
$releaseChangelogUrl = $null

if (Test-Path $RELEASE_NOTES_PATH) {
    try {
        $notesData = Get-Content $RELEASE_NOTES_PATH -Raw | ConvertFrom-Json -Depth 20
        $normalizedVersion = Normalize-Version $version
        $releaseNote = $notesData.releases |
            Where-Object { (Normalize-Version $_.version) -eq $normalizedVersion } |
            Select-Object -First 1

        if ($releaseNote) {
            $summaryZh = $releaseNote.summary.'zh-CN'
            $summaryEn = $releaseNote.summary.'en-US'
            $highlightsZh = @($releaseNote.highlights.'zh-CN') | Where-Object { $_ -and $_.Trim() -ne "" }
            $highlightsEn = @($releaseNote.highlights.'en-US') | Where-Object { $_ -and $_.Trim() -ne "" }

            if ($highlightsZh.Count -gt 0) {
                $releaseNotesZh = ($highlightsZh | ForEach-Object { "- $_" }) -join "`n"
            } elseif ($summaryZh) {
                $releaseNotesZh = $summaryZh
            }

            if ($highlightsEn.Count -gt 0) {
                $releaseNotesEn = ($highlightsEn | ForEach-Object { "- $_" }) -join "`n"
            } elseif ($summaryEn) {
                $releaseNotesEn = $summaryEn
            }

            $releaseNotesForUpdater = if ($releaseNotesEn) { $releaseNotesEn } elseif ($releaseNotesZh) { $releaseNotesZh } else { $releaseNotesForUpdater }

            $releaseChangelogUrl = if ($releaseNote.changelogUrl) { $releaseNote.changelogUrl } elseif ($notesData.changelogUrl) { $notesData.changelogUrl } else { $null }

            $githubLines = @()
            if ($summaryEn) {
                $githubLines += "## What's New"
                $githubLines += ""
                $githubLines += $summaryEn
                if ($highlightsEn.Count -gt 0) {
                    $githubLines += ""
                    $githubLines += ($highlightsEn | ForEach-Object { "- $_" })
                }
                $githubLines += ""
            }
            if ($summaryZh) {
                $githubLines += "## 更新内容"
                $githubLines += ""
                $githubLines += $summaryZh
                if ($highlightsZh.Count -gt 0) {
                    $githubLines += ""
                    $githubLines += ($highlightsZh | ForEach-Object { "- $_" })
                }
                $githubLines += ""
            }
            if ($releaseChangelogUrl) {
                $githubLines += "[Full Changelog]($releaseChangelogUrl)"
            }

            $releaseNotesForGitHub = (($githubLines -join "`n").Trim())
            if ([string]::IsNullOrWhiteSpace($releaseNotesForGitHub)) {
                $releaseNotesForGitHub = $releaseNotesForUpdater
            }

            Write-Ok "Loaded release notes from $RELEASE_NOTES_PATH"
        } else {
            Write-Warn "No entry for version $version in $RELEASE_NOTES_PATH, fallback to default notes"
        }
    } catch {
        Write-Warn "Failed to parse $RELEASE_NOTES_PATH, fallback to default notes"
    }
} else {
    Write-Warn "Release notes file not found: $RELEASE_NOTES_PATH"
}

# ===== Step 3: Load signing key =====
Write-Step "Loading signing key"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $PRIVATE_KEY_PATH -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
}
Write-Ok "Signing key loaded"

# Verify signing env vars are set
if (!$env:TAURI_SIGNING_PRIVATE_KEY) { throw "TAURI_SIGNING_PRIVATE_KEY is empty" }

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
if (Test-Path $RELEASE_NOTES_PATH) {
    Copy-Item $RELEASE_NOTES_PATH "$OUTPUT_DIR\release-notes.json" -Force
    Write-Ok "release-notes.json copied"
}

$releaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$sigContent = (Get-Content $sig.FullName -Raw).Trim()

$latestJson = @{
    version   = "v$version"
    notes     = $releaseNotesForUpdater
    notes_zh  = if ($releaseNotesZh) { $releaseNotesZh } else { $releaseNotesForUpdater }
    notes_en  = if ($releaseNotesEn) { $releaseNotesEn } else { $releaseNotesForUpdater }
    changelog_url = $releaseChangelogUrl
    pub_date  = $releaseDate
    platforms = @{
        "windows-x86_64" = @{
            signature = $sigContent
            url       = "$R2_PUBLIC_URL/releases/v$version/$($installer.Name)"
        }
    }
} | ConvertTo-Json -Depth 10

$latestJson | Set-Content "$OUTPUT_DIR\latest.json" -Encoding UTF8
Write-Ok "latest.json generated (R2 URL)"

# ===== Step 6: Upload to GitHub Release =====
Write-Step "Uploading to GitHub Release v$version"

# Check gh CLI
if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Warn "gh CLI not found. Install from https://cli.github.com"
    Write-Warn "Then run manually:"
    Write-Host "   gh release create v$version $OUTPUT_DIR\* --repo $GITHUB_REPO --title `"v$version`" --notes-file <notes.txt>" -ForegroundColor DarkGray
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
gh release create "v$version" @files --repo $GITHUB_REPO --title "v$version" --notes $releaseNotesForGitHub
if ($LASTEXITCODE -ne 0) { throw "GitHub release upload failed" }

Write-Ok "Release v$version published!"
Write-Host "`n   https://github.com/$GITHUB_REPO/releases/tag/v$version`n" -ForegroundColor Green

# ===== Step 7: Upload to Cloudflare R2 =====
Write-Step "Uploading to Cloudflare R2 ($R2_PUBLIC_URL)"

if (!(Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Warn "wrangler CLI not found. Install: npm install -g wrangler"
    Write-Warn "Then login: wrangler login"
    Write-Warn "Skipping R2 upload."
} else {
    # Upload installer to releases/v{version}/
    wrangler r2 object put "$R2_BUCKET/releases/v$version/$($installer.Name)" --file "$OUTPUT_DIR\$($installer.Name)" --remote
    if ($LASTEXITCODE -ne 0) { Write-Warn "R2 upload installer failed" }
    else { Write-Ok "Uploaded installer to R2" }

    # Upload signature
    wrangler r2 object put "$R2_BUCKET/releases/v$version/$($sig.Name)" --file "$OUTPUT_DIR\$($sig.Name)" --remote
    if ($LASTEXITCODE -ne 0) { Write-Warn "R2 upload signature failed" }
    else { Write-Ok "Uploaded signature to R2" }

    # Upload latest.json to root (updater endpoint)
    wrangler r2 object put "$R2_BUCKET/latest.json" --file "$OUTPUT_DIR\latest.json" --content-type "application/json" --remote
    if ($LASTEXITCODE -ne 0) { Write-Warn "R2 upload latest.json failed" }
    else { Write-Ok "Uploaded latest.json to R2" }

    # Upload release notes index for website changelog rendering
    if (Test-Path "$OUTPUT_DIR\release-notes.json") {
        wrangler r2 object put "$R2_BUCKET/release-notes.json" --file "$OUTPUT_DIR\release-notes.json" --content-type "application/json" --remote
        if ($LASTEXITCODE -ne 0) { Write-Warn "R2 upload release-notes.json failed" }
        else { Write-Ok "Uploaded release-notes.json to R2" }
    }

    Write-Ok "R2 upload complete: $R2_PUBLIC_URL/latest.json"
}
