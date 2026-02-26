# Style System Phase 1 Design (2026-02-27)

## 1. Context

Current style layer has obvious overlap and override competition. The largest files are:

- `src/styles/workspace.css` (3175 lines)
- `src/styles/polish.css` (1060 lines)
- `src/styles/titlebar.css` (412 lines)

Hardcoded values are still spread across multiple style files (`#hex`, `rgba(...)`, literal motion durations/easing), which weakens theme consistency and raises maintenance cost.

## 2. Goals and Non-Goals

### Goals

- Establish style ownership boundaries for core style files.
- Enforce a token whitelist for state colors and motion timing.
- Introduce a lint-time guard to block new hardcoded color and motion literals.
- Build a baseline so legacy debt can be paid down incrementally instead of in one large migration.

### Non-Goals

- No behavioral changes to SearchBar/CollectionPanel filter logic in this phase.
- No timeline visual redesign in this phase.
- No empty-state interaction redesign in this phase.

## 3. Considered Approaches

### A. Guard + Baseline (recommended)

- Add a style guard script with `report` and `strict` modes.
- Store a baseline snapshot of current violations.
- In strict mode, fail only on violations beyond baseline.

Pros:

- Immediate prevention of debt growth.
- Safe rollout without blocking ongoing feature work.

Cons:

- Baseline file needs periodic maintenance.

### B. Big-bang cleanup first

- Replace all hardcoded values before adding guardrails.

Pros:

- Clean codebase immediately.

Cons:

- High regression risk and long freeze window.

### C. CI-only regex checks without baseline

- Add direct checks and fail on any hardcoded match.

Pros:

- Simple implementation.

Cons:

- Not practical with current debt volume.

Decision: choose **Approach A**.

## 4. Design

### 4.1 Architecture

- `scripts/check-style-tokens.mjs`
  - Scan `src/styles/**/*.css`.
  - Detect:
    - hardcoded colors (`#hex`, `rgb/rgba`, `hsl/hsla`)
    - literal motion duration/easing in `transition`/`animation` declarations
  - Support:
    - `--mode=report`: print current issues and exit 0
    - `--mode=strict`: compare against baseline and fail on net-new issues
    - `--update-baseline`: rewrite baseline file
  - Respect opt-out marker: `/* style-guard-allow */`.

- `scripts/style-guard-baseline.json`
  - Contains signature counts for current debt.
  - Used by strict mode to allow existing debt and block new debt.

- `package.json`
  - `lint:styles`
  - `lint:styles:strict`
  - `lint:styles:baseline`

- `.github/workflows/release.yml`
  - Add style guard strict check after `npm ci`.

### 4.2 Ownership Boundary

- `workspace.css`: legacy/transition zone; avoid new business styles.
- `polish.css`: visual polish only; no layout or behavior overrides.
- `titlebar.css`: titlebar scope only (`.titlebar*` namespace).
- Future component work should move toward dedicated component style files.

### 4.3 Token Whitelist

- State color: `--state-*` only.
- Motion: `--motion-*` and `--ease-*` only.
- New semantic surface/text/border values should use semantic vars, not literal color values.
- Exceptions require inline `/* style-guard-allow */` comment.

## 5. Data Flow and Failure Handling

### Data Flow

1. CI/local task runs style guard.
2. Script scans CSS files and emits issue list.
3. Strict mode compares issue signatures to baseline.
4. If new signatures exceed baseline counts, command exits with non-zero code.

### Failure Handling

- Missing baseline in strict mode: fail fast with clear remediation.
- Invalid baseline schema: fail fast.
- Allowed exceptions are explicitly annotated at code location.

## 6. Testing Strategy

- Local:
  - `npm run lint:styles` to view total debt.
  - `npm run lint:styles:strict` to ensure zero net-new debt.
- CI:
  - Enforce `lint:styles:strict` in release workflow.
- Rollout:
  - Start with baseline-based strict enforcement.
  - Incrementally reduce baseline through component-focused migrations.

## 7. Success Criteria

- Style guard runs in local and CI.
- Net-new hardcoded colors/motion literals are blocked.
- Ownership and token rules are documented and usable by contributors.
- Existing debt can be reduced gradually without blocking unrelated work.
