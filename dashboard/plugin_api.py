"""Read-only current-board snapshot, mounted by Hermes's authenticated plugin host."""
from contextlib import closing
import sqlite3
import time

from fastapi import APIRouter, HTTPException
from hermes_cli import kanban_db
from hermes_cli.kanban_workflow import DEFAULT_WORKFLOW

router = APIRouter()


@router.get("/snapshot")
def snapshot():
    try:
        board = kanban_db.get_current_board()
        metadata = kanban_db.read_board_metadata(board)
        if metadata.get("archived"):
            raise HTTPException(404, "Current Kanban board is archived.")
        path = kanban_db.kanban_db_path(board).resolve()
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only = ON")
            conn.execute("BEGIN")
            tasks = kanban_db.list_tasks(conn)
            summaries = kanban_db.latest_summaries(conn, [task.id for task in tasks])
            worker_count = conn.execute(
                "SELECT COUNT(*) FROM task_runs r JOIN tasks t ON t.id = r.task_id "
                "WHERE r.ended_at IS NULL AND r.worker_pid IS NOT NULL AND t.status = 'running'"
            ).fetchone()[0]
            columns = {name: [] for name in DEFAULT_WORKFLOW.keys()}
            for task in tasks:
                columns.setdefault(task.status, []).append({
                    "id": task.id,
                    "title": task.title,
                    "status": task.status,
                    "assignee": task.assignee,
                    "body": task.body,
                    "latest_summary": summaries.get(task.id),
                })
    except HTTPException:
        raise
    except (sqlite3.Error, OSError, ValueError, RuntimeError) as exc:
        # ValueError includes UnicodeError; RuntimeError covers pathlib symlink loops.
        raise HTTPException(503, "Current Kanban board is unavailable or uninitialized.") from exc
    return {
        "board": board,
        "boardLabel": metadata["name"],
        "workers": {"count": worker_count, "source": "database", "label": "Database-reported workers"},
        "columns": [{"name": name, "tasks": tasks} for name, tasks in columns.items()],
        "now": int(time.time()),
    }
