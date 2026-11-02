"""Tests for GET /models endpoint. Run with Hermes Python: PYTHONPATH=/opt/hermes /opt/hermes/.venv/bin/python -m unittest discover -s tests -p 'test_models_endpoint.py' -v."""
import importlib.util
import io
import json
import time
import unittest
from pathlib import Path
from threading import Thread, Barrier
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]

FIXTURE_MODELS = {
    "data": [
        {
            "id": "openai/gpt-4",
            "name": "GPT-4",
            "description": "Advanced language model",
            "pricing": {"prompt": "0.03", "completion": "0.06", "request": "0.001", "input_cache_read": "0.015"},
            "context_length": 8192,
            "architecture": {"modality": "text->text", "tokenizer": "cl100k_base", "instruct_type": None},
        },
        {
            "id": "anthropic/claude-3-opus",
            "name": "Claude 3 Opus",
            "description": "Most powerful Claude model",
            "pricing": {"prompt": "0.015", "completion": "0.075", "request": "0.001", "input_cache_read": None},
            "context_length": 200000,
            "architecture": {"modality": "text->text", "tokenizer": "claude"},
        },
        {
            "id": "google/gemini-pro",
            "name": "Gemini Pro",
            "description": None,
            "pricing": {"prompt": "0.001", "completion": "0.002", "request": "0.0001", "input_cache_read": "0.001"},
            "context_length": 30720,
            "architecture": {"modality": "text->text"},
        },
    ]
}


class ModelsEndpointTests(unittest.TestCase):
    def test_failed_refresh_backoff_shares_stale_result_and_then_retries(self):
        module, _ = self.api()
        module._cache = module._normalize(FIXTURE_MODELS)
        module._cache['fetched_at'] = 0
        with patch.object(module, '_fetch_models', side_effect=OSError('offline')) as fetch:
            for _ in range(5):
                self.assertTrue(module._get_models()['stale'])
            self.assertEqual(fetch.call_count, 1)
            with patch.object(module.time, 'monotonic', return_value=module._retry_after + 1):
                self.assertTrue(module._get_models()['stale'])
            self.assertEqual(fetch.call_count, 2)

    def api(self):
        path = ROOT / "dashboard/plugin_api.py"
        self.assertTrue(path.is_file())
        spec = importlib.util.spec_from_file_location("a7m_models_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        app = FastAPI()
        app.include_router(module.router)
        return module, TestClient(app, raise_server_exceptions=False)

    def test_models_endpoint_returns_normalized_data(self):
        module, client = self.api()
        body = json.dumps(FIXTURE_MODELS).encode()
        with patch.object(module, "_fetch_models", return_value=json.loads(body)):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("models", data)
        self.assertIn("source", data)
        self.assertIn("fetched_at", data)
        self.assertEqual(len(data["models"]), 3)
        m = data["models"][0]
        self.assertEqual(m["id"], "openai/gpt-4")
        self.assertEqual(m["name"], "GPT-4")
        self.assertEqual(m["prices"]["input"], 0.03)
        self.assertEqual(m["prices"]["output"], 0.06)
        self.assertEqual(m["prices"]["input_cache_read"], 0.015)
        self.assertEqual(m["context_length"], 8192)
        self.assertIn("OpenRouter", data["source"])

    def test_missing_prices_show_as_none(self):
        module, client = self.api()
        raw = {"data": [{"id": "x/y", "name": "Y", "pricing": {}, "context_length": 1000}]}
        with patch.object(module, "_fetch_models", return_value=raw):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        m = response.json()["models"][0]
        self.assertIsNone(m["prices"]["input"])
        self.assertIsNone(m["prices"]["output"])

    def test_negative_prices_treated_as_none(self):
        module, client = self.api()
        raw = {"data": [{"id": "x/y", "name": "Y", "pricing": {"prompt": "-1", "completion": "-0.5"}, "context_length": 1000}]}
        with patch.object(module, "_fetch_models", return_value=raw):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        m = response.json()["models"][0]
        self.assertIsNone(m["prices"]["input"])
        self.assertIsNone(m["prices"]["output"])

    def test_prices_are_finite_nonnegative_numbers_or_none(self):
        module, client = self.api()
        invalid = [True, False, "", " ", "nan", "NaN", "inf", "-inf", "1e309", -1, [], {}, None, 10 ** 400]
        valid = [0, "0", "0.000001", 0.5]
        raw = {"data": [
            {"id": f"test/{i}", "pricing": {"prompt": value, "completion": value, "input_cache_read": value}}
            for i, value in enumerate(invalid + valid)
        ]}
        with patch.object(module, "_fetch_models", return_value=raw):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        models = response.json()["models"]
        self.assertEqual(len(models), len(invalid + valid))
        for model in models[:len(invalid)]:
            self.assertTrue(all(value is None for value in model["prices"].values()), model)
        for model, expected in zip(models[len(invalid):], [0, 0, 0.000001, 0.5]):
            self.assertTrue(all(value == expected for value in model["prices"].values()), model)
        json.dumps(response.json(), allow_nan=False)

    def test_zero_prices_are_preserved(self):
        module, client = self.api()
        raw = {"data": [{"id": "x/free", "name": "Free", "pricing": {"prompt": "0", "completion": "0"}, "context_length": 1000}]}
        with patch.object(module, "_fetch_models", return_value=raw):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        m = response.json()["models"][0]
        self.assertEqual(m["prices"]["input"], 0)
        self.assertEqual(m["prices"]["output"], 0)

    def test_missing_context_length_shows_none(self):
        module, client = self.api()
        raw = {"data": [{"id": "x/y", "name": "Y", "pricing": {"prompt": "0", "completion": "0"}}]}
        with patch.object(module, "_fetch_models", return_value=raw):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        m = response.json()["models"][0]
        self.assertIsNone(m["context_length"])

    def test_cache_serves_without_refetch(self):
        module, client = self.api()
        body = json.dumps(FIXTURE_MODELS).encode()
        fetch_count = [0]

        def fetching():
            fetch_count[0] += 1
            return json.loads(body)

        with patch.object(module, "_fetch_models", side_effect=fetching):
            r1 = client.get("/models")
            r2 = client.get("/models")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.json()["models"][0]["id"], r2.json()["models"][0]["id"])
        self.assertEqual(fetch_count[0], 1)

    def test_stale_data_on_fetch_failure(self):
        module, client = self.api()
        body = json.dumps(FIXTURE_MODELS).encode()
        with patch.object(module, "_fetch_models", return_value=json.loads(body)):
            r1 = client.get("/models")
        self.assertFalse(r1.json().get("stale", False))
        module._cache["fetched_at"] = 0  # force stale for next call
        with patch.object(module, "_fetch_models", side_effect=RuntimeError("network down")):
            r2 = client.get("/models")
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("stale", False))
        self.assertEqual(r2.json()["models"][0]["id"], "openai/gpt-4")

    def test_malformed_catalog_returns_503_instead_of_empty_success(self):
        malformed = [{}, {"error": "upstream failure"}, {"data": None}, {"data": {}},
                     {"data": "bad"}, {"data": []}, [], {"data": [None]},
                     {"data": [{}]}, {"data": [{"id": True}]},
                     {"data": [{"id": "test/x", "architecture": {"input_modalities": "image"}}]},
                     {"data": [{"id": "test/x", "supported_parameters": "tools"}]},
                     {"data": [{"id": "test/x", "context_length": float("nan")}]},
                     {"data": [FIXTURE_MODELS["data"][0], {}]}]
        for raw in malformed:
            with self.subTest(raw=raw):
                module, client = self.api()
                with patch.object(module, "_fetch_models", return_value=raw):
                    response = client.get("/models")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(module._cache, {})

    def test_malformed_refresh_preserves_last_good_data(self):
        module, client = self.api()
        with patch.object(module, "_fetch_models", return_value=FIXTURE_MODELS):
            first = client.get("/models").json()
        module._cache["fetched_at"] = 0
        with patch.object(module, "_fetch_models", return_value={"error": "bad gateway"}):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["stale"])
        self.assertEqual(response.json()["models"], first["models"])
        self.assertEqual(response.json()["fetched_at"], 0)
        self.assertEqual(module._cache["models"], first["models"])

    def test_catalog_keeps_every_entry_and_reports_exact_count(self):
        module, client = self.api()
        entries = [{"id": f"test/model-{i}", "pricing": None} for i in range(1501)]
        # Duplicates are upstream entries too: do not silently deduplicate.
        entries.append(entries[0].copy())
        with patch.object(module, "_fetch_models", return_value={"data": entries}):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result.get("total"), len(entries))
        self.assertEqual([m["id"] for m in result["models"]], [m["id"] for m in entries])
        self.assertEqual(result.get("source_url"), "https://openrouter.ai/api/v1/models")

    def test_cold_failure_returns_503(self):
        module, client = self.api()
        module._cache = {}
        module._cache_lock = __import__("threading").Lock()
        with patch.object(module, "_fetch_models", side_effect=RuntimeError("no data ever")):
            response = client.get("/models")
        self.assertEqual(response.status_code, 503)
        self.assertIn("detail", response.json())

    def test_concurrent_reads_do_not_corrupt(self):
        module, client = self.api()
        body = json.dumps(FIXTURE_MODELS).encode()
        with patch.object(module, "_fetch_models", return_value=json.loads(body)):
            r1 = client.get("/models")
        barrier = Barrier(5)
        results = []

        def worker():
            barrier.wait()
            r = client.get("/models")
            results.append(r.status_code)

        threads = [Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertTrue(all(s == 200 for s in results))

    def test_concurrent_cold_and_expired_requests_share_one_refresh(self):
        for expired in (False, True):
            with self.subTest(expired=expired):
                module, _ = self.api()
                if expired:
                    module._cache = module._normalize(FIXTURE_MODELS)
                    module._cache["fetched_at"] = 0
                barrier = Barrier(8)
                results, errors = [], []

                def fetching():
                    time.sleep(0.05)
                    return FIXTURE_MODELS

                def worker():
                    try:
                        barrier.wait(timeout=3)
                        results.append(module._get_models())
                    except Exception as exc:
                        errors.append(exc)

                with patch.object(module, "_fetch_models", side_effect=fetching) as fetch:
                    threads = [Thread(target=worker) for _ in range(8)]
                    for thread in threads:
                        thread.start()
                    for thread in threads:
                        thread.join(timeout=3)
                self.assertFalse(any(thread.is_alive() for thread in threads))
                self.assertEqual(errors, [])
                self.assertEqual(len(results), 8)
                self.assertEqual(fetch.call_count, 1)
                self.assertTrue(all(len(result["models"]) == 3 for result in results))

    def test_cache_expires_at_ttl_and_rejects_future_timestamp(self):
        for age in (1800, -1):
            with self.subTest(age=age):
                module, client = self.api()
                module._cache = module._normalize(FIXTURE_MODELS)
                module._cache["fetched_at"] = 10000 - age
                with patch.object(module.time, "time", return_value=10000), patch.object(module, "_fetch_models", return_value=FIXTURE_MODELS) as fetch:
                    response = client.get("/models")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(fetch.call_count, 1)
                self.assertEqual(response.json()["fetched_at"], 10000)

    def test_fetched_at_updates_on_refetch_after_ttl(self):
        module, client = self.api()
        body = json.dumps(FIXTURE_MODELS).encode()
        with patch.object(module, "_fetch_models", return_value=json.loads(body)):
            r1 = client.get("/models")
        t1 = r1.json()["fetched_at"]
        module._cache["fetched_at"] = 0  # force stale
        with patch.object(module, "_fetch_models", return_value=json.loads(body)):
            r2 = client.get("/models")
        t2 = r2.json()["fetched_at"]
        self.assertGreaterEqual(t2, t1)

    def test_capabilities_follow_metadata_without_modality_conflation(self):
        module, client = self.api()
        entries = [
            {"id": "test/vision", "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]}, "supported_parameters": ["tools", "reasoning", "structured_outputs"]},
            {"id": "test/generator", "architecture": {"input_modalities": ["text"], "output_modalities": ["image", "audio"]}, "supported_parameters": ["response_format"]},
            {"id": "test/metadata", "architecture": {"modality": "text+audio+video->text"}, "reasoning": {"mandatory": False}},
            {"id": "test/unknown", "description": "Reasoning tools and image generation advertised here", "architecture": None, "supported_parameters": None},
        ]
        with patch.object(module, "_fetch_models", return_value={"data": entries}):
            response = client.get("/models")
        self.assertEqual(response.status_code, 200)
        models = response.json()["models"]
        self.assertEqual(set(models[0].get("capabilities", [])), {"text", "image_input", "tools", "reasoning", "json_mode", "structured_outputs"})
        self.assertEqual(set(models[1]["capabilities"]), {"text", "image_output", "audio_output", "json_mode"})
        self.assertEqual(set(models[2]["capabilities"]), {"text", "audio_input", "video_input", "reasoning"})
        self.assertEqual(models[3]["capabilities"], [])
        self.assertEqual(models[0]["architecture"], entries[0]["architecture"])
        self.assertEqual(models[0]["supported_parameters"], entries[0]["supported_parameters"])
        self.assertEqual(models[2]["reasoning"], entries[2]["reasoning"])
        self.assertEqual(models[0]["input_modalities"], ["text", "image"])
        self.assertEqual(models[0]["output_modalities"], ["text"])
        self.assertEqual(models[2]["input_modalities"], ["text", "audio", "video"])

    def test_fetch_uses_only_fixed_public_url_and_bounded_read(self):
        module, client = self.api()
        raw = io.BytesIO(json.dumps(FIXTURE_MODELS).encode())
        with patch.object(module._models_opener, "open", return_value=raw) as fetch:
            response = client.get("/models?url=https://not-allowed.invalid&limit=1")
        self.assertEqual(response.status_code, 200)
        request = fetch.call_args.args[0]
        self.assertEqual(request.full_url, "https://openrouter.ai/api/v1/models")
        self.assertEqual(request.get_method(), "GET")
        self.assertNotIn("Authorization", request.headers)
        self.assertEqual(fetch.call_args.kwargs["timeout"], 20)
        self.assertEqual(len(response.json()["models"]), 3)
        self.assertEqual(module.TTL, 1800)
        self.assertEqual(module.MAX_BYTES, 10 * 1024 * 1024)

    def test_oversized_and_invalid_json_fail_cleanly(self):
        for body in (b"x" * 33, b"not json", b"{\"data\": []}"):
            with self.subTest(body=body):
                module, client = self.api()
                with patch.object(module, "MAX_BYTES", 32), patch.object(module._models_opener, "open", return_value=io.BytesIO(body)):
                    response = client.get("/models")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(module._cache, {})

    def test_redirects_cannot_change_public_source(self):
        module, _ = self.api()
        handler = getattr(module, "_FixedSourceRedirectHandler", None)
        self.assertIsNotNone(handler, "Public-source requests must not follow redirects")
        request = module.urllib.request.Request(module.MODELS_URL)
        with self.assertRaises(module.urllib.error.HTTPError) as error:
            handler().redirect_request(request, None, 302, "Found", {}, "https://not-allowed.invalid")
        error.exception.close()

    def test_description_is_included_when_present(self):
        module, client = self.api()
        with patch.object(module, "_fetch_models", return_value=json.loads(json.dumps(FIXTURE_MODELS))):
            response = client.get("/models")
        m = response.json()["models"][0]
        self.assertEqual(m["description"], "Advanced language model")


if __name__ == "__main__":
    unittest.main()