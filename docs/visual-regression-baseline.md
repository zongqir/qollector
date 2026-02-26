# Visual Regression Baseline

This repository now includes a minimal visual regression pipeline under `scripts/visual-regression`.

## What it does

1. Capture baseline screenshots:
`npm run visual:baseline:capture`

2. Capture current screenshots:
`npm run visual:current:capture`

3. Compare baseline vs current:
`npm run visual:diff`

4. Run capture+compare in one command:
`npm run visual:check`

## Output layout

- `output/playwright/baseline/`: committed or shared baseline images
- `output/playwright/current/`: latest captured images
- `output/playwright/diff/`: generated diff overlays for changed files
- `output/playwright/report.json`: machine-readable summary

`current`, `diff`, and `report.json` are ignored by git.

## Prerequisites

1. Install Playwright runtime:
`npm install -D playwright`

2. Install Chromium browser once:
`npx playwright install chromium`

## Optional environment variables

- `VISUAL_BASELINE_BASE_URL`: target url (default `http://127.0.0.1:4173`)
- `VISUAL_BASELINE_PORT`: local port for auto-started dev server (default `4173`)
- `VISUAL_BASELINE_SERVER_CMD`: override dev server command
- `VISUAL_BASELINE_SKIP_SERVER=1`: skip auto server startup
- `VISUAL_DIFF_THRESHOLD`: per-channel pixel sensitivity (default `16`)
- `VISUAL_MAX_CHANGED_RATIO`: max allowed changed ratio (default `0.0015`)

## Notes

- Capture script auto-starts `npm run dev` unless `VISUAL_BASELINE_SKIP_SERVER=1`.
- Baseline includes multiple deterministic scenarios:
`desktop-main`, `desktop-shortcut-help`, `desktop-density-compact`, `desktop-mini-mode`, `mobile-main`.
- If `report.json` has failures, inspect matching files in `output/playwright/diff/`.
