# Agent Card Map Implementation Plan

> **For agentic workers:** use `executing-plans` for this inline update; track steps below.

**Goal:** Install the approved A card tree in the existing Desktop panel.

**Architecture:** Present the existing row snapshots and live state changes through a session-local card renderer. Retain native `<details>` for history, use plain DOM for accessible SVG status badges and host theme tokens for the card surfaces.

**Tech stack:** OpenCode Desktop 2.3.2, CommonJS, Solid lifecycle, DOM and Node test runner.

**Spec:** [Карта карточек](../specs/2026-11-23-agent-cards-design.md).

## Global constraints

Existing global launcher, Russian UI, no new dependencies in the installed bundle. Preserve existing connection and retry behavior. Implement only variant A.

## Review focus

- A completed parent with an active grandchild stays visible.
- A child resuming work leaves collapsed history immediately.
- An open history remains open after a data refresh.
- A root-only session never counts its main agent as a child.
- Long/custom agent names and tasks remain legible in a narrow pane.

### Task 1: Render and install the card map

**Files:** `src/cards.cjs`, `src/gui.cjs`, `build.cjs`, `test/cards.test.cjs`, `README.md`.
**Interface:** `cardMap(row)` produces a card view model with title, role, state appearance, child count, visible children and finished children. The GUI renders it and preserves native disclosure state per parent and session.

- [ ] Add regression tests for titles and roles, counts, state distinctions, nested grouping, resumption and empty sessions. Run `node --test test/cards.test.cjs` and observe red.
- [ ] Implement the projection; implement the stylesheet and renderer from A; integrate the bundled module. Preserve history disclosure and keyboard focus when rebuilding, and update ordinary badge transitions in place.
- [ ] Run `node --test` and `node build.cjs`. Verify rendered nested cards, narrow widths, status text and icons, empty and long histories, disclosure preservation and resumption using a browser or real Desktop.
- [ ] Update the existing global bundle after verifying its previous hash, confirm the server serves the exact new bytes and test live session data. Commit and push the change to the feature PR.
