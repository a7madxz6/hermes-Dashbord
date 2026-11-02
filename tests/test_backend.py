"""Run with Hermes's Python: python -m unittest discover -s tests -p test_backend.py -v."""
from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc
from hermes_cli.kanban_workflow import DEFAULT_WORKFLOW

ROOT = Path(__file__).resolve().parents[1]


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = patch.dict(os.environ, {"HERMES_KANBAN_HOME": str(self.home)})
        self.env.start()
        self.addCleanup(self.env.stop)
        for key in ("HERMES_KANBAN_DB", "HERMES_KANBAN_BOARD"):
            os.environ.pop(key, None)

    def api(self):
        path = ROOT / "dashboard/plugin_api.py"
        self.assertTrue(path.is_file(), "read-only snapshot backend is missing")
        spec = importlib.util.spec_from_file_location("a7m_test_backend", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        app = FastAPI()
        app.include_router(module.router)
        return module, TestClient(app, raise_server_exceptions=False)

    def database(self, slug="default"):
        path = self.home / "kanban.db" if slug == "default" else self.home / "kanban/boards" / slug / "kanban.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as conn:
            conn.executescript(kb.SCHEMA_SQL)
        return path

    def test_empty_initialized_board_has_all_canonical_columns(self):
        self.database()
        _, client = self.api()
        before = int(time.time())
        response = client.get("/snapshot")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["columns"], [{"name": name, "tasks": []} for name in DEFAULT_WORKFLOW.keys()])
        self.assertEqual(data["board"], "default")
        self.assertEqual(data["boardLabel"], "Default")
        self.assertIsInstance(data["now"], int)
        self.assertGreaterEqual(data["now"], before)
        self.assertLessEqual(data["now"], int(time.time()))

    def test_missing_or_uninitialized_database_is_503_without_writes(self):
        _, client = self.api()
        path = self.home / "kanban.db"
        for content in (None, b"", b"not a SQLite database"):
            with self.subTest(content=content):
                if content is not None:
                    path.write_bytes(content)
                before = {p.relative_to(self.home): p.read_bytes() for p in self.home.rglob("*") if p.is_file()}
                response = client.get("/snapshot")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"detail": "Current Kanban board is unavailable or uninitialized."})
                self.assertEqual(before, {p.relative_to(self.home): p.read_bytes() for p in self.home.rglob("*") if p.is_file()})

    def test_populated_snapshot_matches_canonical_reads_and_worker_count(self):
        path = self.database()
        with closing(sqlite3.connect(path)) as conn:
            conn.executemany("INSERT INTO tasks(id,title,status,created_at) VALUES(?,?,?,?)",
                             [(name, "Task " + name, name, 100) for name in [*DEFAULT_WORKFLOW.keys(), "archived"]])
            conn.executemany("INSERT INTO task_runs(task_id,started_at,ended_at,worker_pid,summary,status) VALUES(?,?,?,?,?,'running')", [
                ("running", 100, 110, 123, "old"),
                ("running", 120, 130, 123, "new"),
                ("running", 140, None, 123, ""),
                ("todo", 140, None, 456, None),
                ("running", 150, None, None, None),
            ])
            conn.commit()
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        _, client = self.api()
        response = client.get("/snapshot")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        counts = {column["name"]: len(column["tasks"]) for column in data["columns"]}
        self.assertEqual(counts, {name: 1 for name in DEFAULT_WORKFLOW.keys()})
        running = next(c["tasks"][0] for c in data["columns"] if c["name"] == "running")
        self.assertEqual(running["latest_summary"], "new")
        self.assertEqual(data["workers"], {"count": 1, "source": "database", "label": "Database-reported workers"})
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            tasks = kb.list_tasks(conn)
            summaries = kb.latest_summaries(conn, [task.id for task in tasks])
            self.assertEqual(
                {task["id"]: task for column in data["columns"] for task in column["tasks"]},
                {task.id: {"id": task.id, "title": task.title, "status": task.status,
                           "assignee": task.assignee, "body": task.body,
                           "latest_summary": summaries.get(task.id)} for task in tasks},
            )
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)

    def test_tasks_expose_only_display_fields_even_with_populated_internals(self):
        path = self.database()
        private = {"claim_lock": "secret-claim-token", "workspace_path": "/private/workspace",
                   "tenant": "private-tenant", "idempotency_key": "private-idempotency",
                   "session_id": "private-session", "result": "private-result",
                   "last_failure_error": "private-error", "claim_expires": 999,
                   "worker_pid": 123, "created_by": "private-creator"}
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("INSERT INTO tasks(id,title,status,body,assignee,created_at) "
                         "VALUES('display','Display task','todo','Visible body','owner',100)")
            conn.execute("UPDATE tasks SET " + ", ".join(f"{key} = ?" for key in private),
                         list(private.values()))
            conn.execute("INSERT INTO task_runs(task_id,started_at,summary,status) "
                         "VALUES('display',100,'Visible summary','done')")
            conn.commit()
        _, client = self.api()
        response = client.get("/snapshot")
        self.assertEqual(response.status_code, 200)
        task = next(c["tasks"][0] for c in response.json()["columns"] if c["name"] == "todo")
        for key, value in private.items():
            self.assertNotIn(key, task)
            if isinstance(value, str):
                self.assertNotIn(value, response.text)
        self.assertEqual(task, {"id": "display", "title": "Display task", "status": "todo",
                                "assignee": "owner", "body": "Visible body",
                                "latest_summary": "Visible summary"})

    def test_unknown_statuses_are_preserved_after_canonical_columns(self):
        path = self.database()
        rows = [("custom-1", "Custom one", "waiting-external", 100),
                ("custom-2", "Custom two", "waiting-external", 101),
                ("future", "Future task", "future-state", 102)]
        with closing(sqlite3.connect(path)) as conn:
            conn.executemany("INSERT INTO tasks(id,title,status,created_at) VALUES(?,?,?,?)", rows)
            conn.commit()
        before = path.read_bytes()
        _, client = self.api()
        response = client.get("/snapshot")
        self.assertEqual(response.status_code, 200)
        columns = response.json()["columns"]
        canonical = list(DEFAULT_WORKFLOW.keys())
        self.assertEqual([c["name"] for c in columns[:len(canonical)]], canonical)
        extras = {c["name"]: c["tasks"] for c in columns[len(canonical):]}
        self.assertEqual(set(extras), {"waiting-external", "future-state"})
        self.assertEqual({t["id"] for t in extras["waiting-external"]}, {"custom-1", "custom-2"})
        self.assertEqual([t["id"] for t in extras["future-state"]], ["future"])
        for status, tasks in extras.items():
            self.assertTrue(all(t["status"] == status for t in tasks))
        self.assertEqual(path.read_bytes(), before)

    def test_invalid_utf8_metadata_returns_clean_503_without_writes(self):
        path = self.database("team")
        metadata = path.parent / "board.json"
        metadata.write_bytes(b'{"name":"\xff"}')
        (self.home / "kanban/current").write_text("team")
        before = {p.relative_to(self.home): p.read_bytes() for p in self.home.rglob("*") if p.is_file()}
        _, client = self.api()
        response = client.get("/snapshot")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Current Kanban board is unavailable or uninitialized."})
        self.assertEqual(before, {p.relative_to(self.home): p.read_bytes() for p in self.home.rglob("*") if p.is_file()})

    def test_board_lookup_and_metadata_path_errors_return_clean_503(self):
        self.database()
        _, client = self.api()
        for helper in ("get_current_board", "read_board_metadata", "kanban_db_path"):
            for error in (OSError("/private/path"), ValueError("private-invalid-value"),
                          UnicodeError("private-invalid-encoding")):
                with self.subTest(helper=helper, error=type(error).__name__):
                    with patch.object(kb, helper, side_effect=error):
                        response = client.get("/snapshot")
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json(), {"detail": "Current Kanban board is unavailable or uninitialized."})

    def test_path_resolution_and_uri_errors_return_clean_503(self):
        self.database()
        _, client = self.api()
        for operation, error in (("resolve", OSError("/private/path")),
                                 ("resolve", RuntimeError("Symlink loop at /private/path")),
                                 ("as_uri", ValueError("private-invalid-path"))):
            with self.subTest(operation=operation, error=type(error).__name__):
                with patch.object(kb, "read_board_metadata", return_value={"name": "Default"}), \
                     patch.object(kb, "kanban_db_path") as path:
                    if operation == "resolve":
                        path.return_value.resolve.side_effect = error
                    else:
                        path.return_value.resolve.return_value.as_uri.side_effect = error
                    response = client.get("/snapshot")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"detail": "Current Kanban board is unavailable or uninitialized."})

    def test_archived_current_board_is_unavailable(self):
        self.database("retired")
        meta = self.home / "kanban/boards/retired/board.json"
        meta.write_text(json.dumps({"name": "Retired", "archived": True}))
        (self.home / "kanban/current").write_text("retired")
        _, client = self.api()
        response = client.get("/snapshot")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Current Kanban board is archived."})

    def test_current_board_is_pinned_once_and_only_public_metadata_returned(self):
        self.database("team")
        (self.home / "kanban/boards/team/board.json").write_text(json.dumps({
            "name": "فريق العمليات", "default_workdir": "/private/work", "secret": "never-return",
        }))
        (self.home / "kanban/current").write_text("team")
        module, client = self.api()
        with patch.object(kb, "get_current_board", wraps=kb.get_current_board) as current:
            response = client.get("/snapshot?board=../../elsewhere&path=/private/db")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(current.call_count, 1)
        self.assertEqual(response.json()["board"], "team")
        self.assertEqual(response.json()["boardLabel"], "فريق العمليات")
        self.assertNotIn("/private", response.text)
        self.assertNotIn("never-return", response.text)
        expected_routes = sorted([("/executions", {"GET"}), ("/models", {"GET"}), ("/snapshot", {"GET"})])
        self.assertEqual(sorted((route.path, route.methods) for route in module.router.routes), expected_routes)
        for method in ("post", "put", "patch", "delete"):
            self.assertEqual(getattr(client, method)("/snapshot").status_code, 405)

    def test_connection_rejects_writes_without_initializing_or_migrating(self):
        path = self.database()
        module, client = self.api()
        canonical_list = kb.list_tasks
        connections = []

        def inspect_connection(conn):
            connections.append(conn)
            self.assertEqual(conn.execute("PRAGMA query_only").fetchone()[0], 1)
            self.assertTrue(conn.in_transaction)
            with self.assertRaisesRegex(sqlite3.OperationalError, "readonly"):
                conn.execute("CREATE TABLE forbidden(value)")
            conn.execute("PRAGMA query_only = OFF")
            with self.assertRaisesRegex(sqlite3.OperationalError, "readonly"):
                conn.execute("CREATE TABLE still_forbidden(value)")
            conn.execute("PRAGMA query_only = ON")
            return canonical_list(conn)

        before = hashlib.sha256(path.read_bytes()).hexdigest()
        with patch.object(kb, "list_tasks", side_effect=inspect_connection), \
             patch.object(kb, "init_db", side_effect=AssertionError("must not initialize")), \
             patch.object(kbc, "connect", side_effect=AssertionError("must not use write connection")):
            self.assertEqual(client.get("/snapshot").status_code, 200)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        self.assertEqual(len(connections), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            connections[0].execute("SELECT 1")

    def test_native_plugin_manifest_and_registration_are_inert(self):
        from hermes_cli.plugins_manifest import parse_manifest_file

        self.assertTrue((ROOT / "plugin.yaml").is_file(), "native plugin manifest missing")
        manifest = parse_manifest_file(ROOT / "plugin.yaml", ROOT, "user", "")
        self.assertIsNotNone(manifest)
        self.assertEqual(manifest.name, "a7m-dashboard")
        self.assertEqual(manifest.kind, "standalone")
        self.assertEqual(manifest.provides_tools, [])
        self.assertEqual(manifest.provides_hooks, [])
        spec = importlib.util.spec_from_file_location("a7m_registration", ROOT / "__init__.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertIsNone(module.register(object()))
        dashboard = json.loads((ROOT / "dashboard/manifest.json").read_text())
        self.assertEqual(dashboard["name"], manifest.name)
        self.assertEqual(dashboard["api"], "plugin_api.py")
        self.assertTrue(dashboard["tab"]["hidden"])

    def test_current_named_board_without_database_is_not_empty_success(self):
        directory = self.home / "kanban/boards/team"
        directory.mkdir(parents=True)
        (directory / "board.json").write_text('{"name":"Team"}')
        (self.home / "kanban/current").write_text("team")
        _, client = self.api()
        self.assertEqual(client.get("/snapshot").status_code, 503)
        self.assertFalse((directory / "kanban.db").exists())

    def test_partial_schema_is_not_migrated(self):
        path = self.database()
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("DROP TABLE task_runs")
            conn.commit()
        before = path.read_bytes()
        _, client = self.api()
        self.assertEqual(client.get("/snapshot").status_code, 503)
        self.assertEqual(before, path.read_bytes())


if __name__ == "__main__":
    unittest.main()
