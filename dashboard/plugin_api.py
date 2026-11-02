"""Read-only current-board snapshot and public model catalog, mounted by Hermes's authenticated plugin host."""
import json
import math
from contextlib import closing
import sqlite3
import threading
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException
from hermes_cli import kanban_db
from hermes_cli.kanban_workflow import DEFAULT_WORKFLOW

router = APIRouter()

MODELS_URL = "https://openrouter.ai/api/v1/models"
SOURCE_LABEL = "كتالوج OpenRouter العام، ليس قائمة الموديلات المتاحة بحسابك ولا فاتورة Nous"
TTL = 1800  # 30 min
FETCH_TIMEOUT = 20
MAX_BYTES = 10 * 1024 * 1024

_cache = {}
_retry_after = 0.0
_cache_lock = threading.Lock()


def _safe_price(val):
    if isinstance(val, bool) or not isinstance(val, (str, int, float)):
        return None
    try:
        p = float(val)
    except (ValueError, TypeError, OverflowError):
        return None
    return p if math.isfinite(p) and p >= 0 else None


def _normalize(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), list) or not raw["data"]:
        raise ValueError("Invalid or empty public model catalog")
    models = []
    for m in raw["data"]:
        if not isinstance(m, dict) or not isinstance(m.get("id"), str) or not m["id"].strip():
            raise ValueError("Invalid model entry")
        prices = m.get("pricing")
        architecture = m.get("architecture")
        parameters = m.get("supported_parameters")
        reasoning = m.get("reasoning")
        for value in (prices, architecture, reasoning):
            if value is not None and not isinstance(value, dict):
                raise ValueError("Invalid model metadata")
        prices = prices if prices is not None else {}
        architecture = architecture if architecture is not None else {}
        parameters = parameters if parameters is not None else []
        if not isinstance(parameters, list) or any(not isinstance(p, str) for p in parameters):
            raise ValueError("Invalid supported parameters")
        for field in ("name", "description"):
            if m.get(field) is not None and not isinstance(m[field], str):
                raise ValueError("Invalid model text")
        context = m.get("context_length")
        if context is not None and (type(context) is not int or context < 0):
            raise ValueError("Invalid context length")
        modality = architecture.get("modality") or ""
        if not isinstance(modality, str):
            raise ValueError("Invalid modality")
        modality = modality.split("->")
        inputs = architecture.get("input_modalities")
        outputs = architecture.get("output_modalities")
        if inputs is None:
            inputs = modality[0].split("+") if len(modality) == 2 else []
        if outputs is None:
            outputs = modality[1].split("+") if len(modality) == 2 else []
        for modalities in (inputs, outputs):
            if not isinstance(modalities, list) or any(not isinstance(item, str) or not item for item in modalities):
                raise ValueError("Invalid modalities")
        capabilities = set()
        for direction, modalities in (("input", inputs), ("output", outputs)):
            for item in modalities:
                capabilities.add("text" if item == "text" else f"{item}_{direction}")
        if "tools" in parameters:
            capabilities.add("tools")
        if any(p in parameters for p in ("reasoning", "reasoning_effort", "include_reasoning")) or reasoning:
            capabilities.add("reasoning")
        if any(p in parameters for p in ("response_format", "structured_outputs")):
            capabilities.add("json_mode")
        if "structured_outputs" in parameters:
            capabilities.add("structured_outputs")
        models.append({
            "id": m.get("id"),
            "name": m.get("name") or (m.get("id") or "").split("/")[-1],
            "provider": (m.get("id") or "").split("/")[0] if m.get("id") else None,
            "description": m.get("description"),
            "prices": {
                "input": _safe_price(prices.get("prompt")),
                "output": _safe_price(prices.get("completion")),
                "input_cache_read": _safe_price(prices.get("input_cache_read")),
            },
            "context_length": m.get("context_length"),
            "architecture": architecture,
            "input_modalities": inputs,
            "output_modalities": outputs,
            "supported_parameters": parameters,
            "reasoning": reasoning,
            "capabilities": sorted(capabilities),
        })
    now = int(time.time())
    result = {"models": models, "total": len(models), "fetched_at": now, "stale": False,
              "source": SOURCE_LABEL, "source_url": MODELS_URL}
    # Validate before caching; malformed metadata must not poison last-good data.
    json.dumps(result, allow_nan=False)
    return result


class _FixedSourceRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Public catalog redirects are disabled", headers, fp)


_models_opener = urllib.request.build_opener(_FixedSourceRedirectHandler())


def _fetch_models():
    req = urllib.request.Request(MODELS_URL, headers={"Accept": "application/json", "User-Agent": "a7m-dashboard/0.1.0"})
    with _models_opener.open(req, timeout=FETCH_TIMEOUT) as resp:
        raw = resp.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise RuntimeError("Response too large")
    return json.loads(raw)


def _get_models():
    global _cache, _retry_after
    # Serialize refreshes as well as publication: concurrent cold/expired reads
    # must not issue duplicate upstream requests or overwrite a newer snapshot.
    with _cache_lock:
        age = time.time() - _cache.get("fetched_at", 0)
        if _cache and 0 <= age < TTL:
            return dict(_cache, stale=False)
        if time.monotonic() < _retry_after:
            if _cache:
                return dict(_cache, stale=True)
            raise RuntimeError('Public catalog retry is cooling down')
        try:
            fresh = _normalize(_fetch_models())
            _cache = fresh
            _retry_after = 0.0
            return dict(fresh)
        except Exception:
            _retry_after = time.monotonic() + 60
            if _cache:
                return dict(_cache, stale=True)
            raise


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


@router.get("/models")
def models():
    try:
        return _get_models()
    except Exception:
        raise HTTPException(503, "تعذر الاتصال بدليل الموديلات العام. لا توجد بيانات سابقة متاحة.")
