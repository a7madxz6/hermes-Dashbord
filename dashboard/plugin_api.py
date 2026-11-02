"""Read-only current-board snapshot and public model catalog, mounted by Hermes's authenticated plugin host."""
import json
import math
import hermes_constants
from contextlib import closing
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
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


_PROJECT_DIR = str(Path("/opt/data/projects/hermes-Dashbord").resolve())
_OPENCODE_DB = Path("/opt/data/.local/share/opencode/opencode.db")
_TOKEN_RULE = "input + output; cache and reasoning not added"


def _state_db_path():
    return hermes_constants.get_hermes_home().resolve() / "state.db"


def _safe_str(val):
    return val if isinstance(val, str) else None


def _safe_int(val):
    if type(val) is int and val >= 0:
        return val
    if type(val) is float and math.isfinite(val) and val >= 0 and val.is_integer():
        return int(val)
    return None


def _safe_float(val):
    return val if type(val) in (int, float) and math.isfinite(val) and val >= 0 else None


def _tokens(row, prefix="", suffix=""):
    values = {key: _safe_int(row.get(prefix + key + suffix))
              for key in ("input", "output", "cache_read", "cache_write", "reasoning")}
    return {**values,
            "total": (values["input"] + values["output"]
                      if values["input"] is not None and values["output"] is not None else None),
            "total_rule": _TOKEN_RULE}


def _cost(row):
    status = row.get("cost_status")
    actual = _safe_float(row.get("actual_cost_usd")) if status == "actual" else None
    estimate = _safe_float(row.get("estimated_cost_usd")) if status == "estimated" else None
    return {"actual": actual, "estimated": estimate,
            "status": "actual" if actual is not None else "estimated" if estimate is not None else "unavailable",
            "currency": "USD", "source": (row.get("cost_source")
                if row.get("cost_source") in ("OpenCode.message", "OpenCode.session") else "Hermes.persisted_usage")}


def _format_session(row):
    # A requested route and default zero counters do not prove an API call occurred.
    recorded = (_safe_int(row.get("api_call_count")) or 0) > 0 or any(
        (_safe_int(row.get(key + "_tokens")) or 0) > 0
        for key in ("input", "output", "cache_read", "cache_write", "reasoning"))
    return {"id": row["id"], "model": _safe_str(row.get("model")) if recorded else None,
            "source": "Hermes", "model_scope": "session", "models": [],
            "usage_scope": "session", "mapping_source": "task_events.owner_admitted",
            "started_at": row.get("started_at"), "ended_at": row.get("ended_at"),
            "tokens": _tokens(row if recorded else {}, suffix="_tokens"), "cost": _cost(row)}


def _resolve_session_map(conn, runs):
    """Exact admitted attempt -> current-profile session; never use tasks.session_id."""
    if not runs:
        return {}
    state_path = _state_db_path()
    if not state_path.is_file():
        return {}
    try:
        # One latest marker per exact task/run pair, including retries independently.
        markers = conn.execute("""SELECT e.task_id, e.run_id, e.payload FROM task_events e
            JOIN task_runs r ON r.id=e.run_id AND r.task_id=e.task_id
            WHERE e.kind='owner_admitted' AND e.id=(SELECT MAX(n.id) FROM task_events n
                WHERE n.task_id=e.task_id AND n.run_id=e.run_id AND n.kind='owner_admitted')""").fetchall()
        requested = {(r["task_id"], r["run_id"]) for r in runs}
        bindings = {}
        for marker in markers:
            if (marker["task_id"], marker["run_id"]) not in requested:
                continue
            try:
                payload = json.loads(marker["payload"])
                if (not isinstance(payload, dict) or not isinstance(payload.get("session_id"), str)
                        or not payload["session_id"] or not isinstance(payload.get("db"), str)
                        or Path(payload["db"]).resolve() != state_path):
                    continue
                bindings[marker["run_id"]] = payload["session_id"]
            except (TypeError, ValueError, OSError, RuntimeError):
                continue
        sessions = {}
        ids = sorted(set(bindings.values()))
        with closing(sqlite3.connect(state_path.as_uri() + "?mode=ro", uri=True)) as owner:
            owner.row_factory = sqlite3.Row
            owner.execute("PRAGMA query_only=ON")
            owner.execute("BEGIN")
            # Batch below SQLite's variable limit even with many open attempts.
            for start in range(0, len(ids), 500):
                batch = ids[start:start + 500]
                placeholders = ",".join("?" for _ in batch)
                for row in owner.execute(f"SELECT * FROM sessions WHERE id IN ({placeholders})", batch):
                    sessions[row["id"]] = _format_session(dict(row))
                if owner.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_model_usage'").fetchone():
                    rows = owner.execute(f"SELECT * FROM session_model_usage WHERE session_id IN ({placeholders}) ORDER BY model,billing_provider,task", batch)
                    for row in rows:
                        usage = dict(row)
                        if usage["session_id"] in sessions:
                            sessions[usage["session_id"]]["models"].append({
                                "model": _safe_str(usage.get("model")),
                                "provider": _safe_str(usage.get("billing_provider")),
                                "tokens": _tokens(usage, suffix="_tokens"), "cost": _cost(usage)})
        return {rid: sessions[sid] for rid, sid in bindings.items() if sid in sessions}
    except (sqlite3.Error, OSError, ValueError, RuntimeError):
        return {}


def _complete_sum(values):
    return sum(values) if values and all(v is not None for v in values) else None


def _format_opencode(row, messages):
    models = []
    for msg in messages:
        model = {"model": _safe_str(msg.get("modelID")), "provider": _safe_str(msg.get("providerID")),
                 "agent": _safe_str(msg.get("agent"))}
        if model not in models:
            models.append(model)
    if messages:
        counters = []
        for msg in messages:
            raw = msg.get("tokens")
            raw = raw if isinstance(raw, dict) else {}
            cache = raw.get("cache")
            cache = cache if isinstance(cache, dict) else {}
            counters.append(_tokens(dict(raw, cache_read=cache.get("read"), cache_write=cache.get("write"))))
        tokens = _tokens({key: _complete_sum([c[key] for c in counters])
                          for key in ("input", "output", "cache_read", "cache_write", "reasoning")})
        cost = _cost({"actual_cost_usd": _complete_sum([_safe_float(m.get("cost")) for m in messages]),
                      "cost_status": "actual", "cost_source": "OpenCode.message"})
    else:
        # shortcut: rollup defaults are indistinguishable from unrecorded usage; require positive counters.
        recorded = any((_safe_int(row.get("tokens_" + k)) or 0) > 0 for k in ("input", "output", "reasoning", "cache_read", "cache_write"))
        tokens = _tokens(row if recorded else {}, prefix="tokens_")
        rollup_cost = _safe_float(row.get("cost"))
        cost = _cost({"actual_cost_usd": rollup_cost if recorded and rollup_cost else None,
                      "cost_status": "actual", "cost_source": "OpenCode.session"})
        if recorded:
            models = [{"model": _safe_str(row.get("model")), "provider": None, "agent": _safe_str(row.get("agent"))}]
    identities = {}
    for key in ("model", "provider", "agent"):
        values = {m[key] for m in models}
        identities[key] = next(iter(values)) if len(values) == 1 else None
    return {"id": row["id"], "title": _safe_str(row.get("title")), "source": "OpenCode",
            **identities, "models": models, "harness": "OpenCode", "usage_scope": "session",
            "mapping_source": None, "status": "last_activity", "time_created": row.get("time_created"),
            "time_updated": row.get("time_updated"), "tokens": tokens, "cost": cost}


def _read_opencode_sessions(page, limit):
    paging = {"total": None, "page": page, "limit": limit, "status": "unavailable"}
    if hermes_constants.profile_name_for_home(hermes_constants.get_hermes_home()) != "default":
        return [], dict(paging, status="disabled")
    if not _OPENCODE_DB.is_file():
        return [], paging
    try:
        with closing(sqlite3.connect(_OPENCODE_DB.resolve().as_uri() + "?mode=ro", uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            # directory is canonical project ownership; path must never broaden this filter.
            total = conn.execute("SELECT COUNT(*) FROM session WHERE directory=?", (_PROJECT_DIR,)).fetchone()[0]
            rows = conn.execute("SELECT * FROM session WHERE directory=? ORDER BY time_created DESC,id DESC LIMIT ? OFFSET ?",
                                (_PROJECT_DIR, limit, (page - 1) * limit)).fetchall()
            messages = {row["id"]: [] for row in rows}
            if rows and conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message'").fetchone():
                placeholders = ",".join("?" for _ in rows)
                for msg in conn.execute(f"SELECT session_id,data FROM message WHERE session_id IN ({placeholders}) ORDER BY id", list(messages)):
                    try:
                        data = json.loads(msg["data"])
                    except (ValueError, TypeError):
                        # Corrupt telemetry invalidates aggregates, rather than silently undercounting.
                        data = {"role": "assistant"}
                    if isinstance(data, dict) and data.get("role") == "assistant":
                        messages[msg["session_id"]].append(data)
            result = [_format_opencode(dict(row), messages[row["id"]]) for row in rows]
        return result, dict(paging, total=total, status="available")
    except (sqlite3.Error, OSError, ValueError, RuntimeError):
        return [], paging


def _format_run(row, session_map):
    return {"run_id": row["run_id"], "task_id": row["task_id"], "task_title": row["task_title"],
            "profile": row["profile"], "step_key": row["step_key"], "status": row["status"],
            "outcome": row["outcome"], "started_at": row["started_at"], "ended_at": row["ended_at"],
            "source": "kanban", "agent": None, "harness": "Hermes", "session": session_map.get(row["run_id"])}


@router.get("/executions")
def executions(page: int = Query(1, ge=1, le=92233720368547758), limit: int = Query(25, ge=1, le=100)):
    try:
        board = kanban_db.get_current_board()
        metadata = kanban_db.read_board_metadata(board)
        if metadata.get("archived"):
            raise HTTPException(404, "Current Kanban board is archived.")
        path = kanban_db.kanban_db_path(board).resolve()
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            # LEFT JOIN retains canonical attempts even if their task has been removed.
            select = """SELECT r.id AS run_id,r.task_id,t.title AS task_title,r.profile,r.step_key,
                r.status,r.outcome,r.started_at,r.ended_at FROM task_runs r LEFT JOIN tasks t ON t.id=r.task_id """
            running = conn.execute(select + "WHERE r.ended_at IS NULL ORDER BY r.started_at DESC,r.id DESC").fetchall()
            total = conn.execute("SELECT COUNT(*) FROM task_runs WHERE ended_at IS NOT NULL").fetchone()[0]
            history = conn.execute(select + "WHERE r.ended_at IS NOT NULL ORDER BY r.started_at DESC,r.id DESC LIMIT ? OFFSET ?",
                                   (limit, (page - 1) * limit)).fetchall()
            sessions = _resolve_session_map(conn, running + history)
            result = {"board": board, "boardLabel": metadata["name"],
                      "running": [_format_run(row, sessions) for row in running],
                      "history": {"rows": [_format_run(row, sessions) for row in history],
                                  "total": total, "page": page, "limit": limit}, "now": int(time.time())}
        result["opencode"], result["opencode_history"] = _read_opencode_sessions(page, limit)
        return result
    except HTTPException:
        raise
    except (sqlite3.Error, OSError, ValueError, RuntimeError) as exc:
        raise HTTPException(503, "بيانات التنفيذ غير متاحة حالياً.") from exc
