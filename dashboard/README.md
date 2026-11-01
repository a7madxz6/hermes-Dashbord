# A7M read-only backend

`GET /api/plugins/a7m-dashboard/snapshot` (Desktop: `ctx.rest('/snapshot')`) returns:

- `board`: current canonical board slug, resolved once per request.
- `boardLabel`: its canonical display name.
- `columns`: `{name, tasks}` for every `DEFAULT_WORKFLOW` column, including empty ones, followed by extra columns for unknown task statuses. Unknown statuses are preserved verbatim, not dropped or remapped. Archived tasks are excluded by the canonical reader.
- Each task exposes exactly `id`, `title`, `status`, `assignee`, `body`, and `latest_summary`. No automatic dataclass serialization: claim tokens, workspace paths, session identifiers, and other internal fields are excluded even when populated.
- `now`: Unix seconds.
- `workers`: `{count, source: "database", label: "Database-reported workers"}`. Counts open run records with a PID whose task is running; **not process liveness**.

No query parameters, board switching, arbitrary filesystem paths, mutation routes, database creation, migrations, config reads, or worker processes. Extra query parameters cannot select a database. The SQLite connection uses `mode=ro`, `query_only=ON`, a read transaction, and closes after each request. Missing/uninitialized/incompatible databases and propagated board lookup, metadata decoding, or path errors return a generic 503 without exception details. Intended HTTP errors pass through unchanged; archived current boards return 404. The canonical metadata reader retains its own defaults for missing/malformed JSON. Board metadata is limited to name/slug in the response; task fields use the explicit display allowlist above. Treat task content as private user data.

## Installation recommendation (not performed)

Ship the package as `a7m-dashboard`, with this directory beside root `plugin.yaml`, root `__init__.py`, and the Desktop author's `desktop/plugin.js`. Native agent plugins are opt-in (`kind: standalone`); install disabled using the native installer's `--no-enable` flag. Only after explicit user approval, enable `a7m-dashboard` on the backend host and toggle its Desktop contribution on the machine actually running Desktop. These are separate gates. Do not start a separate unauthenticated FastAPI server: the Hermes host provides authentication and the `/api/plugins/a7m-dashboard` namespace.

Backend discovery requires **`dashboard/manifest.json` with `api: plugin_api.py`**, not a `dashboard` field in `plugin.yaml`. The hidden manifest is for the backend namespace, not a web-dashboard UI bundle. No standalone web-dashboard UI is supplied.

## Tests

```sh
PYTHONPATH=/opt/hermes /opt/hermes/.venv/bin/python -m unittest discover -s tests -p test_backend.py -v
```

Uses standard-library unittest because pytest is not installed in the inspected runtime. Fixtures create databases only in temporary directories; no production initialization helper is called. Tests cover display-field serialization/summaries, populated private-field exclusion, canonical and unknown statuses, archived exclusion, database-reported workers, hashes, read-only rejection even with query_only disabled, metadata minimization, invalid UTF-8 metadata, board/path failures with generic 503 responses, preserved archived-board 404, one-time board resolution, GET-only routes, missing/corrupt/partial schemas, and native packaging.

The real current `default` board was probed read-only: HTTP 200, all eight canonical columns empty, zero database-reported workers, exact canonical task match, database/WAL/SHM SHA-256 hashes unchanged. This is genuinely empty stored data, not a fabricated fallback.

## Sources inspected

- `hermes_cli/kanban_workflow.py:114–142`: canonical workflow order (currently `triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`, `review`, `done`). Do not hardcode seven columns.
- `hermes_cli/kanban_db.py:422–565, 594–659, 1421–1451, 4166–4188`: current-board/path resolution, Task serialization, task listing, latest nonempty run summary.
- `hermes_cli/kanban_db_boards.py:38–66`: read-only display metadata.
- `plugins/kanban/dashboard/plugin_api.py:920–933`: database-reported worker predicate. Its `get_board`/connection helpers initialize databases and are intentionally **not reused**.
- `hermes_cli/web_server_dashboard.py:524–596`: manifest discovery and backend API path.
- `hermes_cli/plugins_manifest.py:347–386, 531–566`: native standalone manifest parsing.
- [Native plugins](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins), [shared backend namespace](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard#backend-api-routes), [Desktop SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk).

Not verified: installed/enabled host routing or Desktop visibility; no installation, activation, configuration change, Git operation, or publication was performed.
