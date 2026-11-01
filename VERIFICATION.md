# Verification

## Scope
Read-only first version. User-facing scope: glyph welcome → automatic dashboard, existing Hermes Kanban, summary and running task list. No mutation endpoints, task dispatch, independent task database, remote-script loader, or automatic client update.

## Checks performed
- Backend unittest suite: 14 passing tests, including unknown statuses, metadata errors, missing/corrupt DB, public task field allowlist, write attempts rejected, GET-only routing and plugin metadata.
- Real current-board read: default board, eight native columns, all empty. Database/WAL/SHM hashes unchanged before and after.
- Frontend tests: response validation, glyph timing, XSS-safe text rendering, responsive widths, automatic welcome exit, reduced-motion behavior, error/loading/empty/stale views.
- Built plugin browser harness: imports and registration exercised using a test SDK. Not a native Hermes client verification.
- Hallmark static and rendered checks: zero findings after correcting a small-screen button wrap. Browser screenshot checks run at multiple desktop/mobile widths.
- npm audit: no reported vulnerabilities in installed development dependencies at build time.
- Native `plugins doctor`: runtime discovery, manifest parsing, import and registration passed; zero tools and zero hooks.

## Honest limits
- Windows Desktop loading and private Git installation/update must be checked on the user's machine.
- The real board is empty. Populated-board rendering is verified with explicit test fixtures, not invented production activity.
- Run summaries may be from a previous attempt. Assignee counts do not prove agent process liveness.
- Native gateway route switching is represented by a test SDK for browser regressions; the actual client remains an acceptance check.
