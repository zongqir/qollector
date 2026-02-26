# Main Window Redesign Design (Scheme C)

Date: 2026-02-26
Scope: Main window full redesign (TitleBar + History Stream + Preview/Collection panel)
Status: Approved

## 1. Goals

- Preserve macOS glass feel while upgrading into a stronger product-grade workspace identity.
- Improve scanning and operation efficiency without sacrificing visual quality.
- Rebuild visual system and interaction rhythm across all three major regions.

## 2. Visual Direction

Design codename: Aqua Archive Pro

Principles:

- Three spatial layers:
  - Layer 0: atmospheric background (subtle gradient + grain)
  - Layer 1: glass containers for global panes
  - Layer 2: high-contrast cards and controls
- Rhythm-first layout:
  - Title bar: brand + global status + quick actions
  - Left pane: search/filter rail + timeline stream + batch command footer
  - Right pane: action header + readable content canvas + metadata strip + tool rail
- Unified typography scale:
  - 11 / 13 / 15 / 20 sizes
  - 400 / 500 / 600 weights
  - tabular numbers for time and counters
- Motion discipline:
  - 120ms / 180ms / 280ms timing system
  - high-value motion only (entry, selection, panel/toolbar transitions)

## 3. Component Blueprint

### 3.1 TitleBar 2.0

- Left: brand block (logo + app title + mode hint)
- Center: status capsule area (panel mode, selected count, always-on-top)
- Right: quick actions (quick input, mini mode, pin, window controls)

### 3.2 History Stream 2.0

- Keep existing data and event behavior, redesign visual hierarchy.
- Stronger top rail readability and clearer filter state expression.
- Card restyling with consistent spacing, depth, and action reveal behavior.
- Sticky-like timeline feeling through separators and grouped cadence.
- Batch action bar remains functional, visually integrated with new system.

### 3.3 Preview Panel 2.0

- Header with clear primary actions and danger separation.
- Content canvas tuned for reading/editing comfort and mode transitions.
- Metadata area and toolbar become stable, predictable interaction zones.
- Unified feedback patterns for copy/open/reveal/delete states.

## 4. State and Data Boundaries

- Domain state unchanged: items, tags, pin/favorite, OCR, sharing.
- UI state reorganized visually: selected, focused, hover, panel mode states.
- Ephemeral feedback standardized: copied/opened/toast/loading indicators.
- Keep current optimistic update model with rollback on failure.

## 5. Error and Degrade Strategy

- Localized error placeholders by pane; avoid full-window blocking overlays.
- Graceful fallback when blur/color-mix/motion capabilities are unavailable.
- Preserve core path availability: browse/search/select/copy/delete.

## 6. Validation Criteria

- Unified token usage and style coherence across title/left/right areas.
- No behavioral regression in major workflows.
- Interaction responsiveness stays within current baseline.
- Mini mode remains consistent with reduced density.

## 7. Implementation Plan

1. Introduce new visual tokens and base pane surfaces.
2. Refactor TitleBar structure and status capsules.
3. Redesign History Stream search rail, cards, and batch footer style.
4. Redesign Preview panel header/content/meta/toolbar style.
5. Verify build and smoke test key interactions.
