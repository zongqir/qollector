# Updater Key Rotation and 0.3.8 Release Design

## Background

The current updater signing flow is blocked because the GitHub Actions signing secret and the public key stored in `src-tauri/tauri.conf.json` are no longer aligned. The release workflow already contains an explicit verification step that signs a test payload and verifies it with the repository public key, so the root cause is key mismatch rather than a later packaging failure.

At the same time, the download area in `qollect-site` still falls back to an older package version when `latest.json` cannot be loaded. That fallback should be moved forward together with the application release to avoid showing a stale version on the website.

## Goal

Rotate the Tauri updater signing keypair, publish a new patch release `0.3.8`, and align the website fallback download version with that release.

## Scope

- Generate a new updater private/public keypair.
- Store the new private key and password in GitHub Actions repository secrets.
- Update the public key in `src-tauri/tauri.conf.json`.
- Bump Qollect app version to `0.3.8`.
- Add `0.3.8` release notes in `src/data/release-notes.json`.
- Bump `qollect-site` fallback package version to `0.3.8`.
- Run local build validation for both repositories.
- Push the changes and verify GitHub Release plus R2 metadata.

## Non-Goals

- No unrelated UI or product behavior changes.
- No migration of updater endpoints.
- No changes to release workflow structure unless the rotation exposes a new blocker.

## Execution Plan

1. Generate a new signing keypair locally in a temporary path, then remove the local private key after secrets are updated.
2. Update GitHub repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Replace the updater `pubkey` in `src-tauri/tauri.conf.json`.
4. Update versioned release metadata in Qollect and run `npm run build`.
5. Update `qollect-site` fallback version and run `npm run build`.
6. Commit and push both repositories.
7. Monitor the GitHub Release workflow and verify:
   - `https://github.com/zongqir/qollect/releases/tag/v0.3.8`
   - `https://dl.zongqir.com/latest.json`
   - `https://dl.zongqir.com/release-notes.json`

## Risks and Handling

- If secret update permissions are missing, stop before deleting the generated private key and report the exact blocker.
- If release build fails, fix the failure before pushing further version changes.
- If R2 metadata lags behind GitHub Release, wait for the upload job and verify again before closing the task.
