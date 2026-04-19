# History Flow Card Surface Design

## Goal

Reduce the visual fragmentation of the history flow by moving from obvious bordered cards toward a softer continuous surface. Cards should still feel interactive, but their boundaries should recede in the default state.

## Design Direction

- Use an "ambient cards" treatment for history items.
- Default state should feel closer to a continuous content stream than a stack of boxed tiles.
- Hover, selected, multi-selected, and keyboard-focused states should retain clear affordance and hierarchy.

## Scope

- History flow cards only.
- No structural changes.
- No behavior changes.
- No collection/workbench visual refactor in this pass.

## Visual Changes

- Weaken default card border contrast.
- Reduce default shadow weight and lift.
- Remove or significantly soften the top highlight line that reinforces the box shape.
- Keep content padding and scanning rhythm stable to avoid layout regressions.
- Preserve stronger feedback for hover/selected/focused states.

## Validation

- Desktop normal mode: history flow should read as a continuous stream.
- Mini mode: should remain readable without losing tap clarity.
- Selected and multi-selected cards must still stand out clearly.
- Hover state should still feel actionable, but less "boxed" in default state.
