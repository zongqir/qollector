# Style System Boundary and Token Rules

## Purpose

This document defines style ownership boundaries and token whitelist rules used by the style guard. The objective is to stop new style debt while migrating legacy styles incrementally.

## Ownership Boundaries

### `src/styles/workspace.css`

- Scope: legacy workspace styles during migration.
- Rule: do not add new business styles here unless required for compatibility.
- Allowed work: token replacement, dead-rule cleanup, extraction to component styles.

### `src/styles/polish.css`

- Scope: visual polish (micro-interaction, perceived depth, fine-grain transitions).
- Rule: do not define layout structure or core interaction behavior here.
- Rule: do not override component behavior states that belong to domain styles.

### `src/styles/titlebar.css`

- Scope: titlebar only (`.titlebar*` namespace and direct descendants).
- Rule: no generic/global utility selectors.

### Component style files (`search-bar.css`, `date-dropdown.css`, etc.)

- Scope: local component visuals and states.
- Rule: prefer component-local styles over adding to `workspace.css`.

## Token Whitelist

### State Colors

- Use `--state-*` variables for status UI:
  - examples: `--state-success-*`, `--state-warning-*`, `--state-error-*`.
- Do not add literal `#hex`, `rgb/rgba`, `hsl/hsla` in component rules.

### Motion and Easing

- Use `--motion-*` for duration values.
- Use `--ease-*` for easing curves.
- Do not add literal motion values such as:
  - `0.15s`, `120ms`
  - `ease`, `ease-in-out`, `linear`, `cubic-bezier(...)`, `steps(...)`

## Exception Rule

Use inline marker `/* style-guard-allow */` only when a literal is unavoidable (platform rendering, brand-specific locked value, or temporary compatibility patch).

Example:

```css
.legacy-host-fix {
  border-color: rgba(255, 255, 255, 0.35); /* style-guard-allow */
}
```

Exceptions should be rare and reviewed.

## Enforcement

- Local report: `npm run lint:styles`
- Local strict: `npm run lint:styles:strict`
- Baseline update (intentional only): `npm run lint:styles:baseline`

`lint:styles:strict` is wired into CI release workflow and blocks net-new debt.
