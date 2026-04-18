## Background

The history search rail still feels visually tall even after tightening the titlebar. The main issue is the upper whitespace inside the rail shell, not the input height or icon-button hit target.

## Approved Direction

Use option A: only reduce the top-side whitespace of the search rail shell while keeping the search input and action buttons at their current interactive size.

## Scope

- Reduce the top padding of the shared history search rail shell in normal mode.
- Rebalance compact and cozy density overrides so the same direction holds across densities.
- Keep mini mode stable unless a shared top-padding rule needs a small follow-up adjustment.

## Non-Goals

- No reduction of search input height.
- No reduction of icon-button size.
- No changes to favorites, tags, type filters, or backend filtering behavior.

## Validation

- Frontend build passes.
- The history search rail feels tighter at the top edge in normal mode.
- Mini mode remains readable and tappable.
