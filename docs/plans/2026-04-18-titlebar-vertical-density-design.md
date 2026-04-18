## Background

The normal-window titlebar feels visually taller than the button cluster it contains. The issue is not the button icons themselves, but the extra vertical whitespace created by the titlebar container and the button-shell wrapper around the controls.

This affects the shared top chrome used above history, collection, and workbench views, so the adjustment must keep the existing interaction model and avoid introducing a separate layout path for one panel only.

## Approved Direction

Use option A: reduce the outer shell and vertical whitespace while keeping the button hit area effectively unchanged.

## Scope

- Tighten normal-mode titlebar height and vertical padding.
- Tighten the outer control shell around window buttons.
- Tighten the layout-preset shell so both left and right tool clusters keep a consistent visual density.
- Preserve mini-mode sizing as-is unless a shared rule would otherwise regress it.

## Non-Goals

- No restructure of the TitleBar component.
- No icon-size redesign.
- No changes to history, collection, or workbench filtering behavior.

## Validation

- Build passes with the updated CSS.
- Shared titlebar remains aligned in normal mode.
- Mini mode keeps its current compact height and control readability.
