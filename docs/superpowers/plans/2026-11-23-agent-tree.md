# Desktop Agent Tree Implementation Plan

> **For agentic workers:** Use `executing-plans` or `subagent-driven-development` task by task. Check off a step after its result is verified.

**Goal:** Show a live tree of the current conversation’s agents through «Агенты» in the existing left panel in every project in OpenCode Desktop.

**Architecture:** One GUI-only local plugin registers a `session.panel` launcher and a `Panel`. Use the routed session's server client. Discover historical children from sessions by `parentID`, and enrich them with subagent job descriptions and live execution state, keyed by session ID.

**Tech Stack:** OpenCode Desktop 2.3.2 on Windows; CommonJS GUI entry with host-provided Solid, Node's native test runner.

**Spec:** [Approved desktop design](../specs/2026-11-23-agent-tree-design.md)

## Global Constraints

- One global entry in `~/.config/opencode/opencode.jsonc`; Desktop only.
- Russian labels, native menu, single reusable tab per conversation, no edits to projects or app binaries.
- Live updates only for the relevant session tree; historical rows survive reopening.

## Review Focus

1. A long conversation has children beyond the first page; include every page.
2. Two jobs can resume the same child; show one row with its current state.
3. Switching projects during a slow load must not display the previous tree.
4. Losing connection must not be presented as «Пока нет дочерних агентов».
5. An idle session with no confirmed outcome is not a completed run.

### Task 1: Read and project the session tree

**Files:** `src/tree.cjs`, `test/tree.test.cjs`. **Interface:** `loadTree(client, sessionID, signal)` returns the root and nested rows `{id, agent, task, state, children}`. Session endpoints are those confirmed in the installed server’s `/openapi.json`.

- [x] Add fixture tests with a root, paginated siblings, a grandchild, a foreign root, a resumed child and an idle child. Assert hierarchy, uniqueness, latest assignment, and statuses for writing, tool use, success, failure, interruption and idle.
- [x] Run `node --test test/tree.test.cjs`; verify missing implementation makes it fail.
- [x] Implement the loader using session outcome/timestamps for history, current activity for busy sessions and job descriptions for assignments. Propagate errors and cancellation.
- [x] Run the same tests; require all pass. Commit the tested loader.

### Task 2: Register, install and open the Desktop panel

**Files:** `src/gui.cjs`, `build.cjs`, `test/panel.test.cjs`; install `gui-experimental.cjs` to `~/.config/opencode/local-themes/agent-tree/`. The build produces one CommonJS file containing the loader and GUI code. Change only the global plugin list.

- [x] Test the session lifecycle with a deferred old request: select another session before it resolves and assert only new rows appear. Assert failed requests show an error, retry recovers, and closing cancels updates.
- [x] Run `node --test test/panel.test.cjs`; confirm it fails before the panel exists.
- [x] Register «Агенты» with `MenuItem` and `Panel` for Desktop only. Subscribe while mounted, reconcile on session change and reconnection, and render task and status as text with nested rows.
- [x] Run `node --test` and `node build.cjs`; install the bundle and add the global plugin entry. Verify discovery from two project locations.
- [x] Open the actual Desktop launcher and select «Агенты». Verify the panel renders a root, check a historical tree against the server, and record exactly which checks passed. Commit and push plugin changes for review.

**Installation evidence (Windows, Desktop 2.3.2):** UI Automation invoked the native «Агенты» button and found a tab, a list with the main agent, live shell activity, and the no-children hint. In another conversation, 10 visible finished child rows matched the server's saved session titles and successful outcomes. Two distinct project locations reported the global GUI plugin active.

**Post-review:** Four regressions were reproduced and fixed: old outcomes after an unfinished run, lost assignments after job consumption, stale empty hints after a disconnect and parallel tool status. All eight tests pass. Desktop's GUI endpoint served the exact updated bundle, and the updated loader recovered the review agent's assignment and completed state from the live session.
