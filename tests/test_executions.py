"""Read-only execution provenance regression tests; all storage is isolated."""
import hashlib
import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from hermes_cli import kanban_db as kb
import hermes_constants

ROOT = Path(__file__).resolve().parents[1]


class ExecutionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.state_home = self.home / 'hermes'
        self.state_home.mkdir()
        env = patch.dict(os.environ, HERMES_KANBAN_HOME=str(self.home), HERMES_HOME=str(self.state_home))
        env.start()
        self.addCleanup(env.stop)
        for key in ('HERMES_KANBAN_DB', 'HERMES_KANBAN_BOARD'):
            os.environ.pop(key, None)
        spec = importlib.util.spec_from_file_location('a7m_exec_test', ROOT / 'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        # Never read real external telemetry during fixture tests.
        self.oc = self.home / 'opencode.db'
        setattr(self.module, '_OPENCODE_DB', self.oc)
        app = FastAPI()
        app.include_router(self.module.router)
        self.client = TestClient(app)

    def database(self, slug='default'):
        path = self.home / 'kanban.db' if slug == 'default' else self.home / 'kanban/boards' / slug / 'kanban.db'
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as conn:
            conn.executescript(kb.SCHEMA_SQL)
        return path

    def runs(self, path):
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("INSERT INTO tasks(id,title,status,created_at,session_id) VALUES('task','عنوان','running',1,'coordinator')")
            for start, end, status in [(1000, None, 'running'), (900, 950, 'done'), (900, 920, 'blocked'), (800, 990, 'scheduled')]:
                conn.execute('INSERT INTO task_runs(task_id,profile,started_at,ended_at,status,outcome,summary,error,claim_lock,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)',
                             ('task', 'default', start, end, status, status if end else None,
                              'private-summary', 'private-error', 'private-lock', '{"prompt":"secret"}'))
            conn.commit()

    def state(self, home=None):
        path = (home or self.state_home) / 'state.db'
        with closing(sqlite3.connect(path)) as conn:
            conn.executescript('''CREATE TABLE sessions(id TEXT PRIMARY KEY, model TEXT, billing_provider TEXT,
                started_at REAL, ended_at REAL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,
                estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT,
                api_call_count INTEGER DEFAULT 0, title TEXT, billing_base_url TEXT);
                CREATE TABLE session_model_usage(session_id TEXT, model TEXT, billing_provider TEXT, task TEXT,
                input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,
                reasoning_tokens INTEGER,estimated_cost_usd REAL,actual_cost_usd REAL,cost_status TEXT,cost_source TEXT);''')
            for sid, cost in [('coordinator', 99), ('worker', 0.03), ('retry', 0.04)]:
                conn.execute('INSERT INTO sessions(id,model,billing_provider,input_tokens,output_tokens,cache_read_tokens,reasoning_tokens,estimated_cost_usd,actual_cost_usd,cost_status,cost_source,api_call_count,title,billing_base_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                             (sid, sid + '-model', 'provider', 500, 100, 50, 10, 0.02, cost, 'actual', 'provider', 2, 'private-session-prompt', 'https://private-path'))
            conn.commit()
        return path

    def marker(self, path, run_id=2, sid='worker', db=None, task='task', payload=None):
        with closing(sqlite3.connect(path)) as conn:
            conn.execute('INSERT INTO task_events(task_id,run_id,kind,payload,created_at) VALUES(?,?,?,?,?)',
                         (task, run_id, 'owner_admitted', payload if payload is not None else json.dumps({'session_id': sid, 'db': str(db or self.state_home / 'state.db'), 'pid': 123, 'request_id': 'secret-request'}), 100))
            conn.commit()

    def get(self, query=''):
        response = self.client.get('/executions' + query)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_read_only_rows_pagination_reload_and_allowlist(self):
        path = self.database()
        self.runs(path)
        before = path.read_bytes()
        data = self.get('?limit=2')
        self.assertEqual(data['board'], 'default')
        self.assertEqual([r['run_id'] for r in data['running']], [1])
        self.assertEqual([r['run_id'] for r in data['history']['rows']], [3, 2])
        self.assertEqual(data['history']['total'], 3)
        self.assertEqual([r['run_id'] for r in self.get('?page=2&limit=2')['history']['rows']], [4])
        self.assertEqual(self.get('?page=3&limit=2')['history']['rows'], [])
        self.assertEqual(self.get('?limit=2')['history'], data['history'])
        row = data['history']['rows'][0]
        self.assertEqual(set(row), {'run_id','task_id','task_title','profile','step_key','status','outcome','started_at','ended_at','source','agent','harness','session'})
        self.assertIsNone(row['session'])
        self.assertIsNone(row['agent'])
        text = json.dumps(data)
        for private in ['private-', 'secret', 'claim_lock', 'worker_pid', 'metadata', 'error', 'summary']:
            self.assertNotIn(private, text)
        self.assertEqual(path.read_bytes(), before)

    def test_empty_board_and_missing_source_do_not_create_storage(self):
        response = self.client.get('/executions')
        self.assertEqual(response.status_code, 503)
        self.assertFalse((self.home / 'kanban.db').exists())
        self.database()
        data = self.get()
        self.assertEqual(data['running'], [])
        self.assertEqual(data['history']['total'], 0)
        self.assertEqual(data['opencode'], [])
        self.assertEqual(data['opencode_history']['status'], 'unavailable')
        self.assertIsNone(data['opencode_history']['total'])
        self.assertFalse((self.state_home / 'state.db').exists())
        self.assertFalse(self.oc.exists())

    def test_exact_owner_marker_not_coordinator_and_retries_distinct(self):
        path = self.database()
        self.runs(path)
        state = self.state()
        self.marker(path, 2, 'worker')
        self.marker(path, 3, 'retry')
        before = [p.read_bytes() for p in (path, state)]
        data = self.get()
        self.assertIsNone(data['running'][0]['session'])
        rows = {r['run_id']: r for r in data['history']['rows']}
        for rid, sid, cost in [(2, 'worker', 0.03), (3, 'retry', 0.04)]:
            session = rows[rid]['session']
            self.assertEqual(session['id'], sid)
            self.assertEqual(session['model'], sid + '-model')
            self.assertEqual(session['cost']['actual'], cost)
            self.assertEqual(session['cost']['status'], 'actual')
            self.assertEqual(session['tokens']['total'], 600)
            self.assertEqual(session['usage_scope'], 'session')
            self.assertEqual(session['model_scope'], 'session')
            self.assertEqual(session['mapping_source'], 'task_events.owner_admitted')
        self.assertIsNone(rows[4]['session'])
        self.assertNotIn('coordinator', json.dumps(data))
        self.assertNotIn('private-', json.dumps(data))
        self.assertEqual([p.read_bytes() for p in (path, state)], before)

    def test_marker_rejects_foreign_missing_malformed_and_wrong_task(self):
        path = self.database()
        self.runs(path)
        self.state()
        for payload in ['{bad', '[]', '{}', '{"session_id": "worker"}',
                        json.dumps({'session_id': 'worker', 'db': str(self.home / 'foreign/state.db')}),
                        json.dumps({'session_id': ['worker'], 'db': str(self.state_home / 'state.db')})]:
            self.marker(path, payload=payload)
            self.assertTrue(all(r['session'] is None for r in self.get()['history']['rows']))
        self.marker(path, run_id=3, task='wrong')
        self.assertTrue(all(r['session'] is None for r in self.get()['history']['rows']))

    def test_context_home_override_is_used_not_process_environment(self):
        path = self.database()
        self.runs(path)
        self.state()
        other = self.home / 'profiles' / 'other'
        other.mkdir(parents=True)
        self.state(other)
        self.marker(path, db=other / 'state.db')
        with patch.object(hermes_constants, 'get_hermes_home', return_value=other):
            data = self.get()
        self.assertEqual(next(r for r in data['history']['rows'] if r['run_id'] == 2)['session']['id'], 'worker')
        self.assertIsNone(next(r for r in self.get()['history']['rows'] if r['run_id'] == 2)['session'])

    def test_session_model_breakdown_and_unknown_cost_not_zero(self):
        path = self.database()
        self.runs(path)
        state = self.state()
        self.marker(path)
        with closing(sqlite3.connect(state)) as conn:
            conn.execute("UPDATE sessions SET cost_status='unknown', actual_cost_usd=0, estimated_cost_usd=0 WHERE id='worker'")
            for model, status, actual, estimate in [('model-a', 'actual', 0, 0), ('model-b', 'estimated', 0, 0.08)]:
                conn.execute('INSERT INTO session_model_usage(session_id,model,billing_provider,input_tokens,output_tokens,cost_status,actual_cost_usd,estimated_cost_usd) VALUES(?,?,?,?,?,?,?,?)',
                             ('worker', model, 'provider', 40, 10, status, actual, estimate))
            for key in ('title', 'billing_base_url', 'cost_source'):
                conn.execute(f"UPDATE sessions SET {key}='private-source' WHERE id='worker'")
            conn.commit()
        data = self.get()
        self.assertNotIn('private-source', json.dumps(data))
        session = next(r for r in data['history']['rows'] if r['run_id'] == 2)['session']
        self.assertEqual([m['model'] for m in session['models']], ['model-a', 'model-b'])
        self.assertEqual(session['models'][0]['cost']['actual'], 0)
        self.assertIsNone(session['models'][0]['cost']['estimated'])
        self.assertEqual(session['models'][1]['cost']['estimated'], 0.08)
        self.assertIsNone(session['models'][1]['cost']['actual'])
        self.assertEqual(session['cost']['status'], 'unavailable')
        self.assertIsNone(session['cost']['actual'])
        self.assertIsNone(session['cost']['estimated'])
        with closing(sqlite3.connect(state)) as conn:
            conn.execute("UPDATE sessions SET api_call_count=0,input_tokens=0,output_tokens=0,cache_read_tokens=0,reasoning_tokens=0 WHERE id='retry'")
            conn.commit()
        self.marker(path, 3, 'retry')
        session = next(r for r in self.get()['history']['rows'] if r['run_id'] == 3)['session']
        self.assertIsNone(session['model'])
        self.assertIsNone(session['tokens']['input'])
        self.assertIsNone(session['tokens']['total'])

    def test_usage_validation_no_infinity_negative_or_bool(self):
        self.assertIsNone(self.module._safe_int(True))
        self.assertIsNone(self.module._safe_int(-1))
        self.assertIsNone(self.module._safe_int(float('inf')))
        self.assertIsNone(self.module._safe_float(-0.1))
        self.assertEqual(self.module._safe_int(0), 0)

    def opencode(self):
        with closing(sqlite3.connect(self.oc)) as conn:
            conn.executescript('''CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,path TEXT,title TEXT,agent TEXT,
                model TEXT,cost REAL DEFAULT 0,tokens_input INTEGER DEFAULT 0,tokens_output INTEGER DEFAULT 0,
                tokens_reasoning INTEGER DEFAULT 0,tokens_cache_read INTEGER DEFAULT 0,tokens_cache_write INTEGER DEFAULT 0,
                time_created INTEGER,time_updated INTEGER);
                CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);''')
            for sid, directory, path in [('oc-1', str(ROOT), None), ('oc-2', str(ROOT), None),
                                         ('foreign', '/other/project', str(ROOT))]:
                conn.execute('INSERT INTO session(id,directory,path,title,time_created,time_updated) VALUES(?,?,?,?,1000,2000)',
                             (sid, directory, path, 'OC title'))
            for mid, session, data in [('m1', 'oc-1', {'role': 'assistant', 'modelID': 'model-a', 'providerID': 'provider', 'agent': 'coder', 'cost': 0,
                    'tokens': {'input': 100, 'output': 20, 'reasoning': 5, 'cache': {'read': 30, 'write': 4}}, 'content': 'private-prompt', 'path': '/private'}),
                    ('m2', 'oc-1', {'role': 'assistant', 'modelID': 'model-b', 'providerID': 'provider', 'agent': 'coder', 'cost': 0.01,
                    'tokens': {'input': 50, 'output': 10, 'reasoning': 0, 'cache': {'read': 2, 'write': 0}}}),
                    ('u1', 'oc-1', {'role': 'user', 'cost': 99, 'tokens': {'input': 999}, 'content': 'private-prompt'})]:
                conn.execute('INSERT INTO message VALUES(?,?,?)', (mid, session, json.dumps(data)))
            conn.commit()

    def test_opencode_message_telemetry_project_scope_and_exact_pagination(self):
        self.database()
        self.opencode()
        before = self.oc.read_bytes()
        data = self.get('?limit=1')
        self.assertEqual(data['opencode_history'], {'total': 2, 'page': 1, 'limit': 1, 'status': 'available'})
        self.assertEqual(data['opencode'][0]['id'], 'oc-2')
        self.assertIsNone(data['opencode'][0]['cost']['actual'])
        self.assertIsNone(data['opencode'][0]['tokens']['input'])
        data = self.get('?page=2&limit=1')
        row = data['opencode'][0]
        self.assertEqual(row['id'], 'oc-1')
        self.assertEqual(row['agent'], 'coder')
        self.assertIsNone(row['model'])
        self.assertEqual([m['model'] for m in row['models']], ['model-a', 'model-b'])
        self.assertEqual(row['tokens']['input'], 150)
        self.assertEqual(row['tokens']['total'], 180)
        self.assertEqual(row['tokens']['cache_read'], 32)
        self.assertEqual(row['cost']['actual'], 0.01)
        self.assertEqual(row['cost']['status'], 'actual')
        self.assertEqual(row['status'], 'last_activity')
        self.assertIsNone(row['mapping_source'])
        self.assertEqual(row['usage_scope'], 'session')
        for private in ['private-', '/private', 'foreign', 'directory', 'content', 'path']:
            self.assertNotIn(private, json.dumps(data))
        self.assertEqual(self.oc.read_bytes(), before)
        self.assertEqual(self.get('?page=3&limit=1')['opencode'], [])

    def test_opencode_missing_metrics_and_actual_zero_are_distinct(self):
        self.database()
        self.opencode()
        with closing(sqlite3.connect(self.oc)) as conn:
            conn.execute('INSERT INTO message VALUES(?,?,?)', ('zero', 'oc-2', json.dumps({'role': 'assistant', 'cost': 0, 'tokens': {'input': 0}})))
            conn.execute('INSERT INTO message VALUES(?,?,?)', ('missing', 'oc-1', json.dumps({'role': 'assistant', 'modelID': 'model-a'})))
            conn.commit()
        rows = {r['id']: r for r in self.get()['opencode']}
        self.assertEqual(rows['oc-2']['cost']['actual'], 0)
        self.assertEqual(rows['oc-2']['tokens']['input'], 0)
        self.assertIsNone(rows['oc-2']['tokens']['output'])
        self.assertIsNone(rows['oc-2']['tokens']['total'])
        self.assertIsNone(rows['oc-1']['tokens']['input'])
        self.assertIsNone(rows['oc-1']['cost']['actual'])

    def test_rollup_default_cost_zero_is_unknown_without_message_evidence(self):
        self.database()
        self.opencode()
        with closing(sqlite3.connect(self.oc)) as conn:
            conn.execute("UPDATE session SET tokens_input=10,tokens_output=5 WHERE id='oc-2'")
            conn.commit()
        row = next(r for r in self.get()['opencode'] if r['id'] == 'oc-2')
        self.assertEqual(row['tokens']['total'], 15)
        self.assertIsNone(row['cost']['actual'])
        self.assertEqual(row['cost']['status'], 'unavailable')

    def test_orphan_attempt_retained_with_exact_history_count(self):
        path = self.database()
        self.runs(path)
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("DELETE FROM tasks WHERE id='task'")
            conn.commit()
        data = self.get()
        self.assertEqual(data['history']['total'], 3)
        self.assertEqual(len(data['history']['rows']), 3)
        self.assertIsNone(data['history']['rows'][0]['task_title'])

    def test_shared_session_is_explicit_session_scope_not_per_attempt(self):
        path = self.database()
        self.runs(path)
        self.state()
        self.marker(path, 2, 'worker')
        self.marker(path, 3, 'worker')
        sessions = [r['session'] for r in self.get()['history']['rows'] if r['session']]
        self.assertEqual([s['id'] for s in sessions], ['worker', 'worker'])
        self.assertTrue(all(s['usage_scope'] == 'session' for s in sessions))

    def test_all_source_connections_are_read_only_and_query_only(self):
        path = self.database()
        self.runs(path)
        self.state()
        self.marker(path)
        self.opencode()
        connect = sqlite3.connect
        connections = []
        def read_only(database, *args, **kwargs):
            self.assertIn('?mode=ro', database)
            self.assertTrue(kwargs.get('uri'))
            conn = connect(database, *args, **kwargs)
            statements = []
            conn.set_trace_callback(statements.append)
            connections.append(statements)
            return conn
        with patch.object(self.module.sqlite3, 'connect', side_effect=read_only):
            self.get()
        self.assertEqual(len(connections), 3)
        for statements in connections:
            self.assertTrue(any(s.replace(' ', '').lower() == 'pragmaquery_only=on' for s in statements))
            self.assertFalse(any(s.lstrip().upper().startswith(('UPDATE', 'DELETE', 'INSERT', 'CREATE')) for s in statements))

    def test_nondefault_profile_does_not_open_opencode(self):
        self.database()
        self.opencode()
        other = self.home / 'profiles' / 'other'
        with patch.object(hermes_constants, 'get_hermes_home', return_value=other):
            data = self.get()
        self.assertEqual(data['opencode'], [])
        self.assertEqual(data['opencode_history']['status'], 'disabled')

    def test_invalid_pagination_and_mutating_methods(self):
        self.database()
        for query in ['?page=0', '?page=-1', '?limit=0', '?limit=101', '?page=x', '?limit=1.5', '?page=99999999999999999999999999']:
            self.assertEqual(self.client.get('/executions' + query).status_code, 422, query)
        for method in ('post', 'put', 'patch', 'delete'):
            self.assertEqual(getattr(self.client, method)('/executions').status_code, 405)

    def test_archived_and_current_board_isolation(self):
        path = self.database()
        self.runs(path)
        other = self.database('other')
        (other.parent / 'board.json').write_text(json.dumps({'name': 'Other', 'archived': False}))
        (self.home / 'kanban/current').write_text('other')
        self.assertEqual(self.get()['history']['total'], 0)
        (other.parent / 'board.json').write_text(json.dumps({'name': 'Other', 'archived': True}))
        self.assertEqual(self.client.get('/executions').status_code, 404)


if __name__ == '__main__':
    unittest.main()
