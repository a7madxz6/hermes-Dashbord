// src/plugin.jsx
import { useState as useState2, useSyncExternalStore } from "react";
import { host, gatewayActivationEpoch, useQuery, useValue, ROUTES_AREA, SIDEBAR_NAV_AREA } from "@hermes/plugin-sdk";

// src/ui.jsx
import React, { useEffect, useRef, useState } from "react";

// src/models.mjs
var capabilityLabels = {
  tools: "\u0623\u062F\u0648\u0627\u062A (Tools)",
  reasoning: "\u0627\u0633\u062A\u062F\u0644\u0627\u0644 (Reasoning)",
  json_mode: "JSON",
  image_input: "\u0625\u062F\u062E\u0627\u0644 \u0635\u0648\u0631 (Image Input)",
  image_output: "\u0625\u062E\u0631\u0627\u062C \u0635\u0648\u0631 (Image Output)",
  audio_input: "\u0625\u062F\u062E\u0627\u0644 \u0635\u0648\u062A (Audio Input)",
  audio_output: "\u0625\u062E\u0631\u0627\u062C \u0635\u0648\u062A (Audio Output)",
  text: "\u0646\u0635 (Text)"
};
function safePrice(val) {
  if (typeof val !== "number" && typeof val !== "string" || typeof val === "string" && !val.trim()) return null;
  const p = Number(val);
  if (!Number.isFinite(p)) return null;
  return p < 0 ? null : p;
}
function normalizeModels(raw) {
  const list = raw?.models ?? raw?.data ?? raw ?? [];
  return (Array.isArray(list) ? list : []).map((m) => {
    const prices = m.prices || {};
    const pricing = m.pricing || {};
    return {
      id: m.id,
      name: m.name || (m.id ? m.id.split("/").pop() : ""),
      provider: m.provider ?? (m.id ? m.id.split("/")[0] : null),
      description: m.description,
      prices: {
        input: safePrice(m.prices ? prices.input : pricing.prompt),
        output: safePrice(m.prices ? prices.output : pricing.completion),
        input_cache_read: safePrice(m.prices ? prices.input_cache_read : pricing.input_cache_read)
      },
      context_length: m.context_length,
      capabilities: [
        .../* @__PURE__ */ new Set([
          ...m.capabilities || [],
          ...(m.architecture?.input_modalities || []).map((mode) => mode === "text" ? "text" : `${mode}_input`),
          ...(m.architecture?.output_modalities || []).map((mode) => mode === "text" ? "text" : `${mode}_output`),
          ...(m.supported_parameters || []).filter((parameter) => ["tools", "reasoning", "json_mode"].includes(parameter))
        ])
      ]
    };
  });
}
function filterByProvider(models, provider) {
  if (!provider) return models;
  return models.filter((m) => m.provider === provider);
}
function filterByCapability(models, capability) {
  if (!capability) return models;
  return models.filter((m) => m.capabilities.includes(capability));
}
function searchModels(models, query) {
  if (!query || !query.trim()) return models;
  const q = query.trim().toLowerCase();
  return models.filter((m) => [m.id, m.name, m.provider, m.description].some(
    (value) => typeof value === "string" && value.toLowerCase().includes(q)
  ));
}
function sortByPrice(models, field, direction) {
  const dir = direction === "desc" ? -1 : 1;
  return [...models].sort((a, b) => {
    const pa = safePrice(a.prices?.[field]);
    const pb = safePrice(b.prices?.[field]);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return (pa - pb) * dir;
  });
}
function calculateCost(rate, inputTokens, outputTokens, inputCacheTokens) {
  const tokenCount = (value) => {
    if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) {
      throw new Error("Token counts must be finite nonnegative integers (0\u20131,000,000,000)");
    }
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0 || count > 1e9) {
      throw new Error("Token counts must be finite nonnegative integers (0\u20131,000,000,000)");
    }
    return count;
  };
  inputTokens = tokenCount(inputTokens);
  outputTokens = tokenCount(outputTokens);
  inputCacheTokens = inputCacheTokens === void 0 ? 0 : tokenCount(inputCacheTokens);
  const componentCost = (field, tokens) => {
    if (tokens === 0) return 0;
    const price = safePrice(rate?.[field]);
    if (price === null) throw new Error(`Unavailable rate: ${field}`);
    const cost = tokens * price;
    if (!Number.isFinite(cost)) throw new Error("Cost must be finite");
    return cost;
  };
  const inputCost = componentCost("input", inputTokens);
  const outputCost = componentCost("output", outputTokens);
  const inputCacheCost = componentCost("input_cache_read", inputCacheTokens ?? 0);
  const total = inputCost + outputCost + inputCacheCost;
  if (!Number.isFinite(total)) throw new Error("Cost must be finite");
  return { inputCost, outputCost, inputCacheCost, total };
}
function formatUsd(value) {
  const price = safePrice(value);
  if (price === null) return "\u063A\u064A\u0631 \u0645\u062A\u0627\u062D";
  return `$${price > 0 && price < 1e-6 ? price.toExponential(6) : price.toFixed(6)}`;
}
function formatPricePerMillion(rate) {
  const price = safePrice(rate);
  return formatUsd(price === null ? null : price * 1e6);
}
function getUniqueProviders(models) {
  return [...new Set(models.map((m) => m.provider).filter(Boolean))].sort();
}
function getUniqueCapabilities(models) {
  return [...new Set(models.flatMap((m) => m.capabilities))].sort();
}
function getCapabilityLabel(key) {
  return capabilityLabels[key] || key;
}

// src/ui.jsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function glyphFrame(elapsed, index, count) {
  const stagger = index / Math.max(1, count - 1) * 440;
  const linear = Math.max(0, Math.min(1, (elapsed - stagger) / 1360));
  return { progress: 1 - Math.pow(1 - linear, 3), done: elapsed >= 2400 };
}
function Welcome({ onDone }) {
  const canvasRef = useRef(null);
  const callback = useRef(onDone);
  callback.current = onDone;
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let completed = false;
    let raf = 0;
    let timer = 0;
    let observer;
    const finish = () => {
      if (disposed || completed) return;
      completed = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      callback.current?.();
    };
    if (media.matches) {
      timer = window.setTimeout(finish, 0);
      return () => {
        disposed = true;
        clearTimeout(timer);
      };
    }
    const context = canvas?.getContext("2d");
    if (!context) {
      timer = window.setTimeout(finish, 0);
      return () => {
        disposed = true;
        clearTimeout(timer);
      };
    }
    const started = performance.now();
    let points = [];
    let width = 0;
    let height = 0;
    let cell = 0;
    let ink = "";
    let accent = "";
    let font = "";
    const glyphs = "HermesDashbord01:+*";
    const draw = (elapsed) => {
      context.clearRect(0, 0, width, height);
      context.font = `500 ${cell * 1.35}px ${font}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const { progress } = glyphFrame(elapsed, i, points.length);
        const scatter = 1 - progress;
        context.globalAlpha = 0.18 + 0.82 * progress;
        context.fillStyle = progress > 0.96 ? ink : accent;
        const letter = progress > 0.96 ? point.letter : glyphs[(i + Math.floor(elapsed / 100)) % glyphs.length];
        context.fillText(letter, point.x + point.dx * scatter, point.y + point.dy * scatter);
      }
      context.globalAlpha = 1;
    };
    const resize = () => {
      if (disposed || completed) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const styles = getComputedStyle(canvas);
      accent = styles.getPropertyValue("--color-accent").trim();
      ink = accent;
      font = styles.getPropertyValue("--font-mono").trim();
      const mask = document.createElement("canvas");
      mask.width = width;
      mask.height = height;
      const pen = mask.getContext("2d", { willReadFrequently: true });
      if (!pen) {
        finish();
        return;
      }
      const size = Math.min(width / 9.5, height / 3.5, 156);
      pen.font = `700 ${size}px ${font}`;
      pen.textAlign = "center";
      pen.textBaseline = "middle";
      pen.fillStyle = ink;
      pen.fillText("Welcome to", width / 2, height / 2 - size * 0.65, width * 0.93);
      pen.fillText("Hermes Dashbord", width / 2, height / 2 + size * 0.65, width * 0.93);
      const pixels = pen.getImageData(0, 0, width, height).data;
      cell = Math.max(2.3, size / 23);
      points = [];
      for (let y = cell / 2; y < height; y += cell * 1.25) {
        for (let x = cell / 2; x < width; x += cell) {
          if (pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] < 96) continue;
          const index = points.length;
          points.push({
            x,
            y,
            dx: Math.sin(index * 127.1) * width * 0.3,
            dy: Math.cos(index * 311.7) * height * 0.45,
            letter: glyphs[index % glyphs.length]
          });
        }
      }
      draw(performance.now() - started);
      setPainted(true);
    };
    const animate = (now) => {
      if (disposed || completed) return;
      draw(now - started);
      if (now - started < 1800) raf = requestAnimationFrame(animate);
    };
    const motionChanged = () => {
      if (media.matches) finish();
    };
    resize();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
    }
    window.addEventListener("resize", resize);
    media.addEventListener("change", motionChanged);
    raf = requestAnimationFrame(animate);
    timer = window.setTimeout(finish, 2400);
    return () => {
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      media.removeEventListener("change", motionChanged);
    };
  }, []);
  return /* @__PURE__ */ jsx("section", { className: "a7m-dashboard a7m-welcome", "data-theme": "a7m-terminal", lang: "en", dir: "ltr", "aria-label": "Welcome to Hermes Dashbord", children: /* @__PURE__ */ jsxs("div", { className: `a7m-welcome-art${painted ? " is-painted" : ""}`, children: [
    /* @__PURE__ */ jsxs("h1", { className: "a7m-welcome-text", children: [
      "Welcome to",
      /* @__PURE__ */ jsx("br", {}),
      "Hermes Dashbord"
    ] }),
    /* @__PURE__ */ jsx("canvas", { ref: canvasRef, "aria-hidden": "true" })
  ] }) });
}
var statusLabels = {
  triage: "\u0641\u0631\u0632",
  todo: "\u0644\u0644\u0639\u0645\u0644",
  scheduled: "\u0645\u062C\u062F\u0648\u0644\u0629",
  ready: "\u062C\u0627\u0647\u0632\u0629",
  running: "\u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630",
  review: "\u0645\u0631\u0627\u062C\u0639\u0629",
  blocked: "\u0645\u062A\u0648\u0642\u0641\u0629",
  done: "\u0645\u0643\u062A\u0645\u0644\u0629",
  archived: "\u0645\u0624\u0631\u0634\u0641\u0629"
};
function valueText(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "\u2014";
}
function dateText(value) {
  if (value === null || value === void 0 || value === "") return "\u2014";
  const date = new Date(typeof value === "number" ? value * 1e3 : value);
  return Number.isNaN(date.getTime()) ? valueText(value) : new Intl.DateTimeFormat("ar", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
function StateLabel({ status }) {
  return /* @__PURE__ */ jsxs("span", { className: "a7m-state", "data-state": status, children: [
    statusLabels[status] || /* @__PURE__ */ jsx("bdi", { dir: "auto", children: valueText(status) }),
    statusLabels[status] && /* @__PURE__ */ jsx("bdi", { className: "a7m-state-code", dir: "ltr", children: status })
  ] });
}
function Task({ task, columnName, compact = false }) {
  const status = task.status || columnName;
  return /* @__PURE__ */ jsxs("details", { className: `a7m-task${compact ? " a7m-task-compact" : ""}`, children: [
    /* @__PURE__ */ jsxs("summary", { children: [
      /* @__PURE__ */ jsxs("span", { className: "a7m-task-meta", children: [
        /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: task.id == null ? "\u2014" : `#${task.id}` }),
        /* @__PURE__ */ jsx("span", { className: "a7m-disclosure", "aria-hidden": "true", children: "+" })
      ] }),
      /* @__PURE__ */ jsx("span", { className: "a7m-task-title", dir: "auto", children: valueText(task.title) }),
      /* @__PURE__ */ jsxs("span", { className: "a7m-task-assignee", children: [
        /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0645\u0633\u0624\u0648\u0644" }),
        /* @__PURE__ */ jsx("bdi", { dir: "auto", children: valueText(task.assignee) })
      ] }),
      /* @__PURE__ */ jsx(StateLabel, { status }),
      compact && task.latest_summary && /* @__PURE__ */ jsxs("span", { className: "a7m-task-preview", children: [
        "\u0622\u062E\u0631 \u0645\u0644\u062E\u0635 \u062A\u0634\u063A\u064A\u0644 \u0645\u062A\u0627\u062D: ",
        /* @__PURE__ */ jsx("bdi", { dir: "auto", children: valueText(task.latest_summary) })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "a7m-task-detail", children: /* @__PURE__ */ jsxs("dl", { children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0622\u062E\u0631 \u0645\u0644\u062E\u0635 \u062A\u0634\u063A\u064A\u0644 \u0645\u062A\u0627\u062D" }),
        /* @__PURE__ */ jsx("dd", { dir: "auto", children: valueText(task.latest_summary) })
      ] }),
      task.body && /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644" }),
        /* @__PURE__ */ jsx("dd", { className: "a7m-task-body", dir: "auto", children: valueText(task.body) })
      ] })
    ] }) })
  ] });
}
function Metric({ label, value, note, state }) {
  return /* @__PURE__ */ jsxs("div", { className: "a7m-metric", "data-state": state, children: [
    /* @__PURE__ */ jsx("dt", { children: label }),
    /* @__PURE__ */ jsx("dd", { dir: "ltr", children: value ?? "\u2014" }),
    note && /* @__PURE__ */ jsx("span", { className: "a7m-metric-note", children: note })
  ] });
}
function LoadingBoard() {
  return /* @__PURE__ */ jsxs("div", { className: "a7m-loading", role: "status", children: [
    /* @__PURE__ */ jsx("p", { children: "\u062C\u0627\u0631\u064D \u0642\u0631\u0627\u0621\u0629 \u0644\u0648\u062D\u0629 Hermes\u2026" }),
    /* @__PURE__ */ jsx("div", { className: "a7m-skeleton-grid", "aria-hidden": "true", children: [0, 1, 2].map((index) => /* @__PURE__ */ jsxs("div", { className: "a7m-skeleton-column", children: [
      /* @__PURE__ */ jsx("span", {}),
      /* @__PURE__ */ jsx("span", {}),
      /* @__PURE__ */ jsx("span", {})
    ] }, index)) })
  ] });
}
function DashboardView({ snapshot, loading, error, refreshing, onRefresh, connection, model, profile, onOpenKanban }) {
  const available = Array.isArray(snapshot?.columns);
  const columns = available ? snapshot.columns : [];
  const allTasks = columns.flatMap((column) => (column.tasks || []).map((task) => ({ ...task, status: task.status || column.name })));
  const tasks = allTasks.filter((task) => task.status !== "archived");
  const running = tasks.filter((task) => task.status === "running");
  const blocked = tasks.filter((task) => task.status === "blocked");
  const assigned = running.filter((task) => typeof task.assignee === "string" && task.assignee.trim());
  const assignees = available && (!running.length || assigned.length) ? new Set(assigned.map((task) => task.assignee)).size : null;
  const connectionValue = typeof connection === "object" && connection !== null ? connection.status : connection;
  const connectionLabels = { open: "\u0645\u062A\u0635\u0644", idle: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644", closed: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644", connected: "\u0645\u062A\u0635\u0644", online: "\u0645\u062A\u0635\u0644", disconnected: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644", offline: "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644", connecting: "\u062C\u0627\u0631\u064D \u0627\u0644\u0627\u062A\u0635\u0627\u0644", reconnecting: "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644", error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644" };
  const connectionLabel = connectionValue === true ? "\u0645\u062A\u0635\u0644" : connectionValue === false ? "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644" : connectionLabels[connectionValue] || valueText(connectionValue);
  const errorMessage = typeof error === "string" ? error : error?.message;
  const openKanban = /* @__PURE__ */ jsx("button", { type: "button", className: "a7m-button a7m-button-secondary", onClick: onOpenKanban, disabled: !onOpenKanban, children: "\u0641\u062A\u062D Kanban \u0627\u0644\u0623\u0635\u0644\u064A" });
  return /* @__PURE__ */ jsx("div", { className: "a7m-dashboard", "data-theme": "a7m-terminal", lang: "ar", dir: "rtl", children: /* @__PURE__ */ jsxs("div", { className: "a7m-shell", children: [
    /* @__PURE__ */ jsxs("header", { className: "a7m-topbar", children: [
      /* @__PURE__ */ jsxs("div", { className: "a7m-brand", children: [
        /* @__PURE__ */ jsx("h1", { dir: "ltr", lang: "en", children: "A7M Dashbord" }),
        /* @__PURE__ */ jsx("span", { className: "a7m-readonly", children: "\u0639\u0631\u0636 \u0641\u0642\u0637" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "a7m-toolbar", children: [
        openKanban,
        /* @__PURE__ */ jsx("button", { type: "button", className: "a7m-button a7m-button-primary", onClick: onRefresh, disabled: refreshing || loading || !onRefresh, "aria-busy": Boolean(refreshing), children: refreshing ? "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u2026" : "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("dl", { className: "a7m-context", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u0627\u062A\u0635\u0627\u0644" }),
        /* @__PURE__ */ jsx("dd", { role: "status", children: /* @__PURE__ */ jsx("bdi", { children: connectionLabel }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u0646\u0645\u0648\u0630\u062C" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: valueText(model) }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: valueText(profile) }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0622\u062E\u0631 \u0642\u0631\u0627\u0621\u0629" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { children: dateText(snapshot?.now) }) })
      ] })
    ] }),
    error && /* @__PURE__ */ jsxs("div", { className: "a7m-notice", role: "alert", children: [
      /* @__PURE__ */ jsx("strong", { children: available ? "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629 \u0642\u062F\u064A\u0645\u0629." : "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0644\u0648\u062D\u0629." }),
      /* @__PURE__ */ jsx("span", { children: errorMessage ? /* @__PURE__ */ jsx("bdi", { dir: "auto", children: errorMessage }) : "\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A." })
    ] }),
    /* @__PURE__ */ jsxs("dl", { className: "a7m-metrics", "aria-label": "\u0645\u0644\u062E\u0635 \u0627\u0644\u0645\u0647\u0627\u0645", children: [
      /* @__PURE__ */ jsx(Metric, { label: "\u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630", value: available ? running.length : null, state: "running" }),
      /* @__PURE__ */ jsx(Metric, { label: "\u0645\u0647\u0627\u0645 \u0645\u062A\u0648\u0642\u0641\u0629", value: available ? blocked.length : null }),
      /* @__PURE__ */ jsx(Metric, { label: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0647\u0627\u0645", value: available ? tasks.length : null, note: "\u0628\u0627\u0633\u062A\u062B\u0646\u0627\u0621 \u0627\u0644\u0645\u0624\u0631\u0634\u0641\u0629" }),
      /* @__PURE__ */ jsx(Metric, { label: "\u0648\u0643\u0644\u0627\u0621 \u0645\u0647\u0627\u0645 \u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630", value: assignees, note: assigned.length < running.length ? "\u0628\u062D\u0633\u0628 \u0627\u0644\u0625\u0633\u0646\u0627\u062F \u0627\u0644\u0645\u062A\u0627\u062D" : "\u0645\u0646 \u0625\u0633\u0646\u0627\u062F \u0627\u0644\u0645\u0647\u0627\u0645\u060C \u0644\u0627 \u062D\u0627\u0644\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644" })
    ] }),
    /* @__PURE__ */ jsxs("main", { className: "a7m-workspace", children: [
      /* @__PURE__ */ jsxs("section", { className: "a7m-board-section", "aria-label": "\u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0647\u0627\u0645", children: [
        /* @__PURE__ */ jsxs("div", { className: "a7m-section-head", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h2", { children: "\u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0647\u0627\u0645" }),
            /* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx("bdi", { dir: "auto", children: valueText(snapshot?.boardLabel) }) })
          ] }),
          /* @__PURE__ */ jsx("span", { className: "a7m-section-note", children: "\u0627\u0644\u062D\u0627\u0644\u0627\u062A \u0645\u0646 Kanban" })
        ] }),
        !available ? loading ? /* @__PURE__ */ jsx(LoadingBoard, {}) : /* @__PURE__ */ jsxs("div", { className: "a7m-empty", children: [
          /* @__PURE__ */ jsx("h3", { children: error ? "\u0627\u0644\u0644\u0648\u062D\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0627\u0644\u0622\u0646" : "\u0644\u0645 \u062A\u0635\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0644\u0648\u062D\u0629 \u0628\u0639\u062F" }),
          /* @__PURE__ */ jsx("p", { children: "\u0623\u0639\u062F \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0623\u0648 \u0627\u0641\u062A\u062D \u0644\u0648\u062D\u0629 Hermes \u0627\u0644\u0623\u0635\u0644\u064A\u0629." }),
          openKanban
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          allTasks.length === 0 && /* @__PURE__ */ jsxs("div", { className: "a7m-empty a7m-empty-board", children: [
            /* @__PURE__ */ jsx("h3", { children: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0647\u0627\u0645 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0644\u0648\u062D\u0629" }),
            /* @__PURE__ */ jsx("p", { children: "\u062A\u0638\u0647\u0631 \u0627\u0644\u0645\u0647\u0627\u0645 \u0647\u0646\u0627 \u0639\u0646\u062F \u0625\u0636\u0627\u0641\u062A\u0647\u0627 \u0641\u064A Kanban \u0627\u0644\u0623\u0635\u0644\u064A." }),
            openKanban
          ] }),
          columns.length > 0 && /* @__PURE__ */ jsx("div", { className: "a7m-board", role: "region", "aria-label": "\u0623\u0639\u0645\u062F\u0629 Kanban\u060C \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u0645\u0631\u064A\u0631 \u0623\u0641\u0642\u064A\u064B\u0627", tabIndex: 0, children: columns.map((column, index) => /* @__PURE__ */ jsxs("section", { className: "a7m-column", "aria-label": valueText(column.name), children: [
            /* @__PURE__ */ jsxs("header", { className: "a7m-column-head", children: [
              /* @__PURE__ */ jsx("h3", { children: /* @__PURE__ */ jsx(StateLabel, { status: column.name }) }),
              /* @__PURE__ */ jsx("span", { className: "a7m-column-count", children: column.tasks?.length ?? "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "a7m-column-tasks", children: [
              (column.tasks || []).map((task, taskIndex) => /* @__PURE__ */ jsx(Task, { task, columnName: column.name }, task.id ?? taskIndex)),
              column.tasks?.length === 0 && /* @__PURE__ */ jsx("p", { className: "a7m-column-empty", children: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0647\u0627\u0645" })
            ] })
          ] }, `${column.name}-${index}`)) })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("aside", { className: "a7m-running", "aria-label": "\u0627\u0644\u0645\u0647\u0627\u0645 \u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630", children: [
        /* @__PURE__ */ jsxs("div", { className: "a7m-section-head", children: [
          /* @__PURE__ */ jsx("h2", { children: "\u064A\u062C\u0631\u064A \u0627\u0644\u0622\u0646" }),
          /* @__PURE__ */ jsx("span", { className: "a7m-running-count", children: available ? running.length : "\u2014" })
        ] }),
        !available ? /* @__PURE__ */ jsx("p", { className: "a7m-aside-empty", children: loading ? "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0647\u0627\u0645\u2026" : "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629." }) : running.length ? /* @__PURE__ */ jsx("div", { className: "a7m-running-list", children: running.map((task, index) => /* @__PURE__ */ jsx(Task, { task, compact: true }, task.id ?? index)) }) : /* @__PURE__ */ jsx("p", { className: "a7m-aside-empty", children: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0647\u0627\u0645 \u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630." }),
        /* @__PURE__ */ jsx("p", { className: "a7m-aside-note", children: "\u0646\u0634\u0627\u0637 \u0627\u0644\u0645\u0647\u0627\u0645 \u0645\u0646 Kanban\u060C \u0648\u0644\u064A\u0633 \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u062A\u0635\u0644\u064A\u0646." })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("footer", { className: "a7m-footer", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        "\u0645\u0635\u062F\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A ",
        /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: "Hermes Kanban" })
      ] }),
      /* @__PURE__ */ jsx("span", { children: "\u0644\u0644\u062A\u0639\u062F\u064A\u0644\u060C \u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0635\u0644\u064A\u0629." })
    ] })
  ] }) });
}
var unavailable = "\u063A\u064A\u0631 \u0645\u062A\u0627\u062D";
var recordedNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
function executionText(value) {
  return typeof value === "string" && value !== "" || typeof value === "number" ? String(value) : unavailable;
}
function UsageFigures({ tokens = {}, cost = {} }) {
  const actual = cost.status === "actual" && recordedNumber(cost.actual);
  const estimated = cost.status === "estimated" && recordedNumber(cost.estimated);
  const amount = actual ? cost.actual : estimated ? cost.estimated : null;
  const total = recordedNumber(tokens.input) && recordedNumber(tokens.output) ? tokens.input + tokens.output : null;
  return /* @__PURE__ */ jsxs("dl", { className: "a7m-execution-fields", children: [
    ["input", "output", "cache_read", "cache_write", "reasoning"].map((key, index) => /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("dt", { children: ["\u0631\u0645\u0648\u0632 \u0627\u0644\u0625\u062F\u062E\u0627\u0644", "\u0631\u0645\u0648\u0632 \u0627\u0644\u0625\u062E\u0631\u0627\u062C", "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646", "\u0643\u062A\u0627\u0628\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646", "\u0631\u0645\u0648\u0632 \u0627\u0644\u062A\u0641\u0643\u064A\u0631"][index] }),
      /* @__PURE__ */ jsx("dd", { children: recordedNumber(tokens[key]) ? tokens[key].toLocaleString("en-US") : unavailable })
    ] }, key)),
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A \xB7 \u0625\u062F\u062E\u0627\u0644 + \u0625\u062E\u0631\u0627\u062C \u0641\u0642\u0637" }),
      /* @__PURE__ */ jsx("dd", { children: total == null ? unavailable : total.toLocaleString("en-US") })
    ] }),
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 USD" }),
      /* @__PURE__ */ jsx("dd", { className: "a7m-execution-cost", children: amount == null ? unavailable : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: formatUsd(amount) }),
        " ",
        /* @__PURE__ */ jsx("span", { className: "a7m-readonly", children: actual ? "\u0641\u0639\u0644\u064A\u0629" : "\u062A\u0642\u062F\u064A\u0631\u064A\u0629" })
      ] }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("dt", { children: "\u0645\u0635\u062F\u0631 \u0627\u0644\u062A\u0643\u0644\u0641\u0629" }),
      /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { children: executionText(cost.source) }) })
    ] })
  ] });
}
function ExecutionRow({ row, external }) {
  const session = external ? row : row.session;
  const fields = [
    ["\u0645\u0635\u062F\u0631 \u0627\u0644\u0633\u062C\u0644", row.source || (external ? "OpenCode" : "kanban")],
    ["\u0645\u0635\u062F\u0631 \u0627\u0644\u062C\u0644\u0633\u0629", session?.source],
    ["\u0627\u0644\u0645\u0647\u0645\u0629", row.task_id],
    ["\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629", row.run_id],
    ["\u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u0646\u0641\u0651\u0630", row.agent],
    ["\u0623\u062F\u0627\u0629 \u0627\u0644\u062A\u0646\u0641\u064A\u0630 / Harness", row.harness],
    ["\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0633\u0624\u0648\u0644 \xB7 \u0644\u064A\u0633 \u0625\u062B\u0628\u0627\u062A \u0647\u0648\u064A\u0629 \u0627\u0644\u0645\u0646\u0641\u0651\u0630", row.profile],
    ["\u062C\u0644\u0633\u0629 \u0627\u0644\u0639\u0627\u0645\u0644", session?.id],
    ["\u0627\u0644\u0628\u062F\u0627\u064A\u0629", external ? dateText(row.time_created == null ? null : new Date(row.time_created).toISOString()) : dateText(row.started_at)],
    ["\u0627\u0644\u0646\u0647\u0627\u064A\u0629", dateText(external ? session?.ended_at : row.ended_at)],
    ["\u0627\u0644\u0646\u062A\u064A\u062C\u0629", row.outcome],
    ["\u0627\u0644\u0645\u0648\u062F\u064A\u0644 \xB7 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u062C\u0644\u0633\u0629", session?.model],
    ["\u0627\u0644\u0645\u0632\u0648\u0651\u062F", session?.provider],
    ["\u0645\u0635\u062F\u0631 \u0627\u0644\u0631\u0628\u0637", session?.mapping_source],
    ["\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u062A\u0641\u0648\u064A\u0636 \u0627\u0644\u0645\u062B\u0628\u062A\u0629", null]
  ];
  return /* @__PURE__ */ jsxs("article", { className: "a7m-execution-row", children: [
    /* @__PURE__ */ jsxs("header", { children: [
      /* @__PURE__ */ jsx("h3", { dir: "auto", children: executionText(row.task_title || row.title) }),
      external ? /* @__PURE__ */ jsxs("span", { children: [
        "\u0622\u062E\u0631 \u0646\u0634\u0627\u0637: ",
        row.time_updated == null ? unavailable : dateText(new Date(row.time_updated).toISOString()),
        " \xB7 \u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629"
      ] }) : /* @__PURE__ */ jsx(StateLabel, { status: row.status })
    ] }),
    /* @__PURE__ */ jsx("dl", { className: "a7m-execution-fields", children: fields.map(([label, value]) => /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("dt", { children: label }),
      /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { dir: "auto", children: value === "\u2014" ? unavailable : executionText(value) }) })
    ] }, label)) }),
    /* @__PURE__ */ jsx(UsageFigures, { tokens: session?.tokens, cost: session?.cost }),
    session?.models?.length > 0 && /* @__PURE__ */ jsxs("details", { className: "a7m-execution-models", children: [
      /* @__PURE__ */ jsxs("summary", { children: [
        "\u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0645\u0633\u062C\u0644\u0629 \u0641\u064A \u0627\u0644\u062C\u0644\u0633\u0629 (",
        session.models.length,
        ")"
      ] }),
      session.models.map((model, index) => /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("p", { children: [
          "\u0627\u0644\u0645\u0648\u062F\u064A\u0644: ",
          /* @__PURE__ */ jsx("bdi", { children: executionText(model.model) }),
          /* @__PURE__ */ jsx("br", {}),
          "\u0627\u0644\u0645\u0632\u0648\u0651\u062F: ",
          /* @__PURE__ */ jsx("bdi", { children: executionText(model.provider) }),
          external && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("br", {}),
            "\u0627\u0644\u0648\u0643\u064A\u0644: ",
            /* @__PURE__ */ jsx("bdi", { children: executionText(model.agent) })
          ] })
        ] }),
        !external && /* @__PURE__ */ jsx(UsageFigures, { tokens: model.tokens, cost: model.cost })
      ] }, index))
    ] }),
    /* @__PURE__ */ jsxs("p", { className: "a7m-execution-provenance", children: [
      "\u0646\u0637\u0627\u0642 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645: ",
      /* @__PURE__ */ jsx("bdi", { children: executionText(session?.usage_scope) }),
      " \xB7 \u0627\u0644\u0623\u0631\u0642\u0627\u0645 \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u062C\u0644\u0633\u0629\u060C \u0648\u0644\u064A\u0633\u062A \u0625\u062B\u0628\u0627\u062A\u064B\u0627 \u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0643\u0644 \u0627\u0633\u062A\u062F\u0639\u0627\u0621 \u0623\u0648 \u0645\u062D\u0627\u0648\u0644\u0629. \u0642\u062F \u062A\u0634\u0645\u0644 \u0639\u0645\u0644\u064B\u0627 \u062E\u0627\u0631\u062C \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629\u061B \u0644\u0627 \u062A\u062C\u0645\u0639 \u062C\u0644\u0633\u0629 \u0645\u0634\u062A\u0631\u0643\u0629 \u0639\u0628\u0631 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0627\u062A. \u0644\u0627 \u062A\u0636\u0627\u0641 \u0631\u0645\u0648\u0632 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0623\u0648 \u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0645\u0631\u0629 \u062B\u0627\u0646\u064A\u0629."
    ] })
  ] });
}
function ExecutionHistory({ data, loading, refreshing, error, page = 1, onPage, onRefresh }) {
  const history = data?.history;
  const external = data?.opencode_history;
  return /* @__PURE__ */ jsxs("div", { className: "a7m-executions", children: [
    /* @__PURE__ */ jsxs("header", { className: "a7m-topbar", children: [
      /* @__PURE__ */ jsxs("div", { className: "a7m-brand", children: [
        /* @__PURE__ */ jsx("h1", { children: "\u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u0648\u0627\u0644\u0633\u062C\u0644" }),
        /* @__PURE__ */ jsx("span", { className: "a7m-readonly", children: "\u0639\u0631\u0636 \u0641\u0642\u0637" })
      ] }),
      /* @__PURE__ */ jsx("button", { className: "a7m-button a7m-button-primary", onClick: onRefresh, disabled: loading || refreshing || !onRefresh, "aria-busy": Boolean(refreshing), children: "\u062A\u062D\u062F\u064A\u062B \u0633\u062C\u0644 \u0627\u0644\u062A\u0646\u0641\u064A\u0630" })
    ] }),
    /* @__PURE__ */ jsxs("dl", { className: "a7m-context", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u0644\u0648\u062D\u0629" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { children: executionText(data?.boardLabel) }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0622\u062E\u0631 \u0642\u0631\u0627\u0621\u0629" }),
        /* @__PURE__ */ jsx("dd", { children: data ? dateText(data.now) : unavailable })
      ] })
    ] }),
    error && /* @__PURE__ */ jsxs("div", { className: "a7m-notice", role: "alert", children: [
      /* @__PURE__ */ jsx("strong", { children: data ? "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629 \u0642\u062F\u064A\u0645\u0629." : "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0633\u062C\u0644 \u0627\u0644\u062A\u0646\u0641\u064A\u0630." }),
      /* @__PURE__ */ jsx("span", { children: error })
    ] }),
    !data ? /* @__PURE__ */ jsx("p", { role: "status", className: "a7m-empty", children: loading ? "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u0633\u062C\u0644 \u0627\u0644\u062A\u0646\u0641\u064A\u0630\u2026" : "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629." }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("section", { "aria-label": "\u062A\u0634\u063A\u064A\u0644\u0627\u062A Kanban \u0627\u0644\u062D\u0627\u0644\u064A\u0629", children: [
        /* @__PURE__ */ jsxs("div", { className: "a7m-section-head", children: [
          /* @__PURE__ */ jsx("h2", { children: "\u064A\u062C\u0631\u064A \u0627\u0644\u0622\u0646 \xB7 Kanban" }),
          /* @__PURE__ */ jsx("span", { className: "a7m-section-note", children: "\u0627\u0644\u062D\u0627\u0644\u0629 \u0645\u0646 \u0633\u062C\u0644 \u0627\u0644\u0645\u0647\u0627\u0645\u060C \u0644\u0627 \u0627\u062A\u0635\u0627\u0644 \u0627\u0644\u0648\u0643\u064A\u0644" })
        ] }),
        data.running?.length ? data.running.map((row) => /* @__PURE__ */ jsx(ExecutionRow, { row }, row.run_id)) : /* @__PURE__ */ jsx("p", { className: "a7m-empty", children: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630." })
      ] }),
      /* @__PURE__ */ jsxs("section", { "aria-label": "\u0633\u062C\u0644 \u0645\u062D\u0627\u0648\u0644\u0627\u062A Kanban", children: [
        /* @__PURE__ */ jsxs("div", { className: "a7m-section-head", children: [
          /* @__PURE__ */ jsx("h2", { children: "\u0633\u062C\u0644 \u0645\u062D\u0627\u0648\u0644\u0627\u062A Kanban" }),
          /* @__PURE__ */ jsxs("span", { className: "a7m-section-note", children: [
            history?.total ?? unavailable,
            " \u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u062D\u0641\u0648\u0638\u0629"
          ] })
        ] }),
        history?.rows?.length ? history.rows.map((row) => /* @__PURE__ */ jsx(ExecutionRow, { row }, row.run_id)) : /* @__PURE__ */ jsx("p", { className: "a7m-empty", children: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629." }),
        /* @__PURE__ */ jsxs("nav", { className: "a7m-catalog-pagination", "aria-label": "\u0635\u0641\u062D\u0627\u062A \u0633\u062C\u0644 \u0627\u0644\u062A\u0646\u0641\u064A\u0630", children: [
          /* @__PURE__ */ jsx("button", { className: "a7m-button a7m-button-secondary", "aria-label": "\u0635\u0641\u062D\u0629 \u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u0633\u0627\u0628\u0642\u0629", disabled: page <= 1 || loading || refreshing, onClick: () => onPage(page - 1), children: "\u0627\u0644\u0633\u0627\u0628\u0642" }),
          /* @__PURE__ */ jsxs("span", { role: "status", children: [
            "\u0635\u0641\u062D\u0629 ",
            page
          ] }),
          /* @__PURE__ */ jsx("button", { className: "a7m-button a7m-button-secondary", "aria-label": "\u0635\u0641\u062D\u0629 \u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u062A\u0627\u0644\u064A\u0629", disabled: !history || page * history.limit >= history.total && (external?.total == null || page * external.limit >= external.total) || loading || refreshing, onClick: () => onPage(page + 1), children: "\u0627\u0644\u062A\u0627\u0644\u064A" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("section", { "aria-label": "\u062C\u0644\u0633\u0627\u062A OpenCode \u0644\u0644\u0645\u0634\u0631\u0648\u0639", children: [
        /* @__PURE__ */ jsx("div", { className: "a7m-section-head", children: /* @__PURE__ */ jsx("h2", { children: "\u062C\u0644\u0633\u0627\u062A OpenCode \u0644\u0644\u0645\u0634\u0631\u0648\u0639" }) }),
        /* @__PURE__ */ jsx("p", { className: "a7m-execution-provenance", children: "\u0645\u0635\u062F\u0631 \u0645\u0633\u062A\u0642\u0644\u061B \u0644\u0627 \u064A\u0648\u062C\u062F \u0631\u0628\u0637 \u0645\u062B\u0628\u062A \u0628\u0645\u062D\u0627\u0648\u0644\u0627\u062A Kanban\u060C \u0648\u0644\u0627 \u064A\u064F\u0633\u062A\u0646\u062A\u062C \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0645\u0646 \u062D\u062F\u0627\u062B\u0629 \u0627\u0644\u0646\u0634\u0627\u0637. \u0627\u0633\u062A\u0647\u0644\u0627\u0643 Hermes \u0645\u0646\u0641\u0635\u0644 \u0648\u0644\u0627 \u064A\u064F\u062C\u0645\u0639 \u0645\u0639 \u0627\u0633\u062A\u0647\u0644\u0627\u0643 \u0627\u0644\u0639\u0627\u0645\u0644." }),
        data.opencode?.length ? data.opencode.map((row) => /* @__PURE__ */ jsx(ExecutionRow, { row, external: true }, row.id)) : /* @__PURE__ */ jsx("p", { className: "a7m-empty", children: external?.status === "available" ? "\u0644\u0627 \u062A\u0648\u062C\u062F \u062C\u0644\u0633\u0627\u062A \u0645\u0646 OpenCode \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629." : external?.status === "disabled" ? "\u0645\u0635\u062F\u0631 OpenCode \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A." : "\u0645\u0635\u062F\u0631 OpenCode \u063A\u064A\u0631 \u0645\u062A\u0627\u062D." })
      ] }),
      /* @__PURE__ */ jsxs("footer", { className: "a7m-footer", children: [
        /* @__PURE__ */ jsxs("span", { children: [
          "\u0627\u0644\u0645\u0635\u062F\u0631: ",
          /* @__PURE__ */ jsx("bdi", { children: "Hermes Kanban \xB7 task_runs / OpenCode" }),
          " \xB7 ",
          dateText(data.now)
        ] }),
        /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0633\u062C\u0644 \u0645\u062D\u0641\u0648\u0638 \u0641\u064A \u0627\u0644\u0645\u0635\u062F\u0631 \u0627\u0644\u0623\u0635\u0644\u064A\u061B \u062D\u0630\u0641\u0647 \u0645\u0646 \u0627\u0644\u0645\u0635\u062F\u0631 \u064A\u0632\u064A\u0644 \u0625\u062A\u0627\u062D\u062A\u0647 \u0647\u0646\u0627." })
      ] })
    ] })
  ] });
}
function ModelRow({ model }) {
  const prices = model.prices || {};
  return /* @__PURE__ */ jsxs("details", { className: "a7m-model-row", children: [
    /* @__PURE__ */ jsxs("summary", { children: [
      /* @__PURE__ */ jsx("span", { className: "a7m-model-name", children: /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: model.name }) }),
      /* @__PURE__ */ jsx("span", { className: "a7m-model-id", dir: "ltr", children: model.id }),
      /* @__PURE__ */ jsx("span", { className: "a7m-model-provider", dir: "ltr", children: model.provider || "\u2014" }),
      /* @__PURE__ */ jsx("span", { className: "a7m-model-price", dir: "ltr", children: formatPricePerMillion(prices.input) }),
      /* @__PURE__ */ jsx("span", { className: "a7m-model-price", dir: "ltr", children: formatPricePerMillion(prices.output) }),
      /* @__PURE__ */ jsx("span", { className: "a7m-model-context", dir: "ltr", children: model.context_length?.toLocaleString("ar") ?? "\u063A\u064A\u0631 \u0645\u062A\u0627\u062D" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "a7m-model-detail", children: [
      model.description && /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("strong", { children: "\u0648\u0635\u0641 \u0627\u0644\u0645\u0632\u0648\u0651\u062F (\u0643\u0645\u0627 \u0646\u064F\u0634\u0631)" }),
        /* @__PURE__ */ jsx("p", { className: "a7m-model-desc", dir: "auto", children: model.description })
      ] }),
      model.capabilities?.length > 0 && /* @__PURE__ */ jsx("div", { className: "a7m-model-caps", children: model.capabilities.map((cap) => /* @__PURE__ */ jsx("span", { className: "a7m-model-cap", children: getCapabilityLabel(cap) }, cap)) })
    ] })
  ] });
}
function ModelCatalog({ models, meta, loading, error, onRefresh }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState("");
  const [capability, setCapability] = useState("");
  const [sortField, setSortField] = useState("input");
  const [sortDir, setSortDir] = useState("asc");
  const [showCalc, setShowCalc] = useState(false);
  const [calcInput, setCalcInput] = useState("1000");
  const [calcOutput, setCalcOutput] = useState("500");
  const [calcCache, setCalcCache] = useState("0");
  const [selectedModel, setSelectedModel] = useState(null);
  const allModels = Array.isArray(models) ? models : [];
  const providers = getUniqueProviders(allModels);
  const capabilities = getUniqueCapabilities(allModels);
  let filtered = searchModels(allModels, query);
  filtered = filterByProvider(filtered, provider || null);
  filtered = filterByCapability(filtered, capability || null);
  filtered = sortByPrice(filtered, sortField, sortDir);
  const total = allModels.length;
  const shown = filtered.length;
  const pageCount = Math.max(1, Math.ceil(shown / 50));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  let costResult = null;
  let costError = null;
  if (showCalc && selectedModel) {
    try {
      const m = allModels.find((m2) => m2.id === selectedModel);
      if (m) {
        costResult = calculateCost(m.prices, calcInput, calcOutput, calcCache);
      }
    } catch (error2) {
      costError = error2.message.includes("rate") ? "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629: \u0633\u0639\u0631 \u0623\u062D\u062F \u0623\u0646\u0648\u0627\u0639 \u0627\u0644\u0631\u0645\u0648\u0632 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629 \u063A\u064A\u0631 \u0645\u0646\u0634\u0648\u0631." : "\u0623\u062F\u062E\u0644 \u0623\u0639\u062F\u0627\u062F \u0631\u0645\u0648\u0632 \u0635\u062D\u064A\u062D\u0629 \u063A\u064A\u0631 \u0633\u0627\u0644\u0628\u0629 \u0645\u0646 0 \u0625\u0644\u0649 1,000,000,000 \u0641\u064A \u062C\u0645\u064A\u0639 \u0627\u0644\u062D\u0642\u0648\u0644.";
    }
  }
  const stale = meta?.stale;
  const fetchedAt = typeof meta?.fetched_at === "number" ? new Date(meta.fetched_at * 1e3) : null;
  const fetchedAtStr = fetchedAt ? new Intl.DateTimeFormat("ar", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(fetchedAt) : null;
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("div", { className: "a7m-catalog", children: [
    /* @__PURE__ */ jsxs("div", { className: "a7m-topbar", children: [
      /* @__PURE__ */ jsxs("div", { className: "a7m-brand", children: [
        /* @__PURE__ */ jsx("h1", { dir: "ltr", lang: "en", children: "A7M Dashbord" }),
        /* @__PURE__ */ jsx("span", { className: "a7m-readonly", children: "\u0639\u0631\u0636 \u0641\u0642\u0637" })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "a7m-toolbar", children: /* @__PURE__ */ jsx("button", { type: "button", className: "a7m-button a7m-button-primary", onClick: onRefresh, disabled: loading || !onRefresh, "aria-busy": Boolean(loading), children: loading ? "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u0645\u064A\u0644\u2026" : "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A" }) })
    ] }),
    /* @__PURE__ */ jsxs("dl", { className: "a7m-context", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0627\u0644\u0645\u0635\u062F\u0631" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { children: meta?.source || "\u2014" }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0622\u062E\u0631 \u062A\u062D\u062F\u064A\u062B" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { children: fetchedAtStr || "\u2014" }) })
      ] }),
      stale && /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("dt", { children: "\u0645\u0644\u0627\u062D\u0638\u0629" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("bdi", { children: "\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u062E\u0632\u0646\u0629 \u0642\u062F\u064A\u0645\u0629 \u0628\u0633\u0628\u0628 \u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B." }) })
      ] })
    ] }),
    error && /* @__PURE__ */ jsx("div", { className: "a7m-notice", role: "alert", children: /* @__PURE__ */ jsx("bdi", { children: error }) }),
    loading && allModels.length === 0 && /* @__PURE__ */ jsx("div", { className: "a7m-loading", role: "status", children: /* @__PURE__ */ jsx("p", { children: "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u062F\u0644\u064A\u0644 \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A\u2026" }) }),
    !loading && allModels.length === 0 && !error && /* @__PURE__ */ jsxs("div", { className: "a7m-empty", children: [
      /* @__PURE__ */ jsx("h3", { children: "\u0644\u0645 \u062A\u0635\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A \u0628\u0639\u062F" }),
      /* @__PURE__ */ jsx("p", { children: "\u0623\u0639\u062F \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0623\u0648 \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u062A\u0635\u0627\u0644." })
    ] }),
    allModels.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { className: "a7m-catalog-tools", children: [
        /* @__PURE__ */ jsxs("div", { className: "a7m-catalog-filters", children: [
          /* @__PURE__ */ jsxs("label", { children: [
            /* @__PURE__ */ jsx("span", { children: "\u0628\u062D\u062B" }),
            /* @__PURE__ */ jsx("input", { type: "search", className: "a7m-catalog-input", dir: "ltr", placeholder: "\u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u2026", value: query, onInput: (e) => {
              setQuery(e.target.value);
              setPage(1);
            } })
          ] }),
          /* @__PURE__ */ jsxs("label", { children: [
            /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0645\u0632\u0648\u0651\u062F" }),
            /* @__PURE__ */ jsxs("select", { "aria-label": "\u0627\u0644\u0645\u0632\u0648\u0651\u062F", className: "a7m-catalog-select", value: provider, onChange: (e) => {
              setProvider(e.target.value);
              setPage(1);
            }, children: [
              /* @__PURE__ */ jsx("option", { value: "", children: "\u0627\u0644\u0643\u0644" }),
              providers.map((p) => /* @__PURE__ */ jsx("option", { value: p, children: p }, p))
            ] })
          ] }),
          /* @__PURE__ */ jsxs("label", { children: [
            /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0625\u0645\u0643\u0627\u0646\u064A\u0627\u062A" }),
            /* @__PURE__ */ jsxs("select", { "aria-label": "\u0627\u0644\u0625\u0645\u0643\u0627\u0646\u064A\u0627\u062A", className: "a7m-catalog-select", value: capability, onChange: (e) => {
              setCapability(e.target.value);
              setPage(1);
            }, children: [
              /* @__PURE__ */ jsx("option", { value: "", children: "\u0627\u0644\u0643\u0644" }),
              capabilities.map((c) => /* @__PURE__ */ jsx("option", { value: c, children: getCapabilityLabel(c) }, c))
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "a7m-catalog-sort", children: [
          /* @__PURE__ */ jsx("label", { htmlFor: "a7m-price-sort", children: "\u062A\u0631\u062A\u064A\u0628 \u062D\u0633\u0628" }),
          /* @__PURE__ */ jsxs("select", { id: "a7m-price-sort", className: "a7m-catalog-select", value: sortField, onChange: (e) => {
            setSortField(e.target.value);
            setPage(1);
          }, children: [
            /* @__PURE__ */ jsx("option", { value: "input", children: "\u0633\u0639\u0631 \u0627\u0644\u0625\u062F\u062E\u0627\u0644" }),
            /* @__PURE__ */ jsx("option", { value: "output", children: "\u0633\u0639\u0631 \u0627\u0644\u0625\u062E\u0631\u0627\u062C" })
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "a7m-button a7m-button-sort", "aria-label": "\u0639\u0643\u0633 \u062A\u0631\u062A\u064A\u0628 \u0627\u0644\u0633\u0639\u0631", onClick: () => {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
            setPage(1);
          }, children: sortDir === "asc" ? "\u2191" : "\u2193" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "a7m-catalog-count", children: /* @__PURE__ */ jsxs("span", { children: [
        "\u0646\u062A\u0627\u0626\u062C ",
        shown,
        " \u0645\u0646 ",
        total,
        " \u0645\u0648\u062F\u064A\u0644 \xB7 \u0639\u0631\u0636 ",
        shown ? (currentPage - 1) * 50 + 1 : 0,
        "\u2013",
        Math.min(currentPage * 50, shown)
      ] }) }),
      /* @__PURE__ */ jsxs("div", { className: "a7m-catalog-table", role: "region", "aria-label": "\u062C\u062F\u0648\u0644 \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A", tabIndex: 0, children: [
        /* @__PURE__ */ jsxs("div", { className: "a7m-catalog-header", children: [
          /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0627\u0633\u0645" }),
          /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0645\u0639\u0631\u0651\u0641" }),
          /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0645\u0632\u0648\u0651\u062F" }),
          /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0625\u062F\u062E\u0627\u0644 $ / \u0645\u0644\u064A\u0648\u0646" }),
          /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0625\u062E\u0631\u0627\u062C $ / \u0645\u0644\u064A\u0648\u0646" }),
          /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0633\u064A\u0627\u0642" })
        ] }),
        filtered.length === 0 ? /* @__PURE__ */ jsx("div", { className: "a7m-catalog-empty", children: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u062A\u0627\u0626\u062C \u062A\u0637\u0627\u0628\u0642 \u0627\u0644\u0628\u062D\u062B." }) : visible.map((m) => /* @__PURE__ */ jsx(ModelRow, { model: m }, m.id))
      ] }),
      /* @__PURE__ */ jsxs("nav", { className: "a7m-catalog-pagination", "aria-label": "\u0635\u0641\u062D\u0627\u062A \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "a7m-button a7m-button-secondary", disabled: currentPage === 1, onClick: () => setPage(currentPage - 1), "aria-label": "\u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629", children: "\u0627\u0644\u0633\u0627\u0628\u0642" }),
        /* @__PURE__ */ jsxs("span", { role: "status", children: [
          "\u0635\u0641\u062D\u0629 ",
          currentPage,
          " \u0645\u0646 ",
          pageCount
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "a7m-button a7m-button-secondary", disabled: currentPage === pageCount, onClick: () => setPage(currentPage + 1), "aria-label": "\u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629", children: "\u0627\u0644\u062A\u0627\u0644\u064A" })
      ] }),
      /* @__PURE__ */ jsxs("details", { className: "a7m-calc-section", onToggle: (e) => {
        setShowCalc(e.target.open);
        if (!e.target.open) setSelectedModel(null);
      }, children: [
        /* @__PURE__ */ jsx("summary", { className: "a7m-calc-head", children: /* @__PURE__ */ jsx("h3", { children: "\u062D\u0627\u0633\u0628\u0629 \u0627\u0644\u062A\u0643\u0644\u0641\u0629" }) }),
        /* @__PURE__ */ jsxs("div", { className: "a7m-calc-body", children: [
          /* @__PURE__ */ jsxs("div", { className: "a7m-calc-fields", children: [
            /* @__PURE__ */ jsxs("label", { children: [
              /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0645\u0648\u062F\u064A\u0644" }),
              /* @__PURE__ */ jsxs("select", { "aria-label": "\u0627\u0644\u0645\u0648\u062F\u064A\u0644", className: "a7m-catalog-select", value: selectedModel || "", onChange: (e) => setSelectedModel(e.target.value), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "\u0627\u062E\u062A\u0631 \u0645\u0648\u062F\u064A\u0644\u2026" }),
                allModels.map((m) => /* @__PURE__ */ jsxs("option", { value: m.id, children: [
                  m.name,
                  " (",
                  m.id,
                  ")"
                ] }, m.id))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              /* @__PURE__ */ jsx("span", { children: "\u0631\u0645\u0648\u0632 \u0627\u0644\u0625\u062F\u062E\u0627\u0644" }),
              /* @__PURE__ */ jsx("input", { type: "number", className: "a7m-catalog-input", dir: "ltr", value: calcInput, onInput: (e) => setCalcInput(e.target.value), min: "0" })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              /* @__PURE__ */ jsx("span", { children: "\u0631\u0645\u0648\u0632 \u0627\u0644\u0625\u062E\u0631\u0627\u062C" }),
              /* @__PURE__ */ jsx("input", { type: "number", className: "a7m-catalog-input", dir: "ltr", value: calcOutput, onInput: (e) => setCalcOutput(e.target.value), min: "0" })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              /* @__PURE__ */ jsx("span", { children: "\u0631\u0645\u0648\u0632 \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646" }),
              /* @__PURE__ */ jsx("input", { type: "number", className: "a7m-catalog-input", dir: "ltr", value: calcCache, onInput: (e) => setCalcCache(e.target.value), min: "0" })
            ] })
          ] }),
          costError && /* @__PURE__ */ jsx("p", { className: "a7m-calc-error a7m-notice", role: "alert", children: costError }),
          costResult && /* @__PURE__ */ jsxs("div", { className: "a7m-calc-result", children: [
            /* @__PURE__ */ jsxs("p", { children: [
              "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0645\u0642\u062F\u0631\u0629: ",
              /* @__PURE__ */ jsxs("bdi", { dir: "ltr", children: [
                formatUsd(costResult.total),
                " USD"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("p", { className: "a7m-calc-detail", children: [
              "\u0627\u0644\u0625\u062F\u062E\u0627\u0644: ",
              /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: formatUsd(costResult.inputCost) }),
              " | \u0627\u0644\u0625\u062E\u0631\u0627\u062C: ",
              /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: formatUsd(costResult.outputCost) }),
              costResult.inputCacheCost > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
                " | \u0630\u0627\u0643\u0631\u0629 \u062A\u062E\u0632\u064A\u0646: ",
                /* @__PURE__ */ jsx("bdi", { dir: "ltr", children: formatUsd(costResult.inputCacheCost) })
              ] })
            ] }),
            /* @__PURE__ */ jsx("p", { className: "a7m-calc-note", children: "\u062A\u0642\u062F\u064A\u0631 \u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0631\u0645\u0648\u0632 \u0641\u0642\u0637 \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u062E\u0627\u0645 \u0644\u0643\u0644 \u0631\u0645\u0632. \u0627\u0644\u0625\u062F\u062E\u0627\u0644 \u063A\u064A\u0631 \u0627\u0644\u0645\u062E\u0632\u0646 \u0645\u0646\u0641\u0635\u0644 \u0639\u0646 \u0631\u0645\u0648\u0632 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062A\u062E\u0632\u064A\u0646\u060C \u0648\u0644\u0627 \u062A\u062C\u0645\u0639 \u0627\u0644\u0631\u0645\u0648\u0632 \u0646\u0641\u0633\u0647\u0627 \u0645\u0631\u062A\u064A\u0646. \u0644\u0627 \u062A\u0634\u0645\u0644 \u0631\u0633\u0648\u0645 \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0623\u0648 \u0627\u0644\u0648\u0633\u0627\u0626\u0637 \u0623\u0648 \u0627\u0644\u0623\u062F\u0648\u0627\u062A." })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("footer", { className: "a7m-footer", children: [
        /* @__PURE__ */ jsxs("span", { children: [
          "\u0645\u0635\u062F\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A: ",
          meta?.source || "\u062F\u0644\u064A\u0644 \u0639\u0627\u0645"
        ] }),
        /* @__PURE__ */ jsx("span", { children: "\u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629 USD \u0644\u0643\u0644 \u0645\u0644\u064A\u0648\u0646 \u0631\u0645\u0632\u061B \u0627\u0644\u062D\u0627\u0633\u0628\u0629 \u062A\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u062E\u0627\u0645 \u0644\u0643\u0644 \u0631\u0645\u0632." })
      ] })
    ] })
  ] }) });
}

// src/data.mjs
function normalizeBoard(value) {
  if (!value || !Array.isArray(value.columns) || !value.columns.every(
    (column) => column && typeof column.name === "string" && Array.isArray(column.tasks) && column.tasks.every((task) => task && typeof task.id === "string" && typeof task.title === "string")
  )) throw new Error("\u0628\u064A\u0627\u0646\u0627\u062A \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0647\u0627\u0645 \u063A\u064A\u0631 \u0645\u062A\u0648\u0627\u0641\u0642\u0629. \u062D\u062F\u0651\u062B \u0647\u064A\u0631\u0645\u0632 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
  return value;
}

// src/style.css
var style_default = '/* Hallmark \xB7 shape: app screen \xB7 theme: Terminal (by request) \xB7 genre: atmospheric \xB7 posture: committed \xB7 signature: native Kanban task ledger \xB7 nav: compact toolbar \xB7 footer: source record \xB7 copy: verbatim \xB7 v2.0.0 */\n/* Hallmark \xB7 pre-emit critique: P4 H4 E4 S4 R5 V3 \xB7 weakest: V, familiar Kanban structure is intentional; native status names remain visible. */\n/* Hallmark \xB7 font waiver: Arabic system face paired with local monospace; bilingual desktop UI requires Arabic shaping without a remote font dependency. */\n/* Hallmark \xB7 user-requested intro: one glyph-mask resolution, 1.8 seconds plus 0.6 seconds hold; reduced motion skips it. Host-owned html/body remain untouched; all tokens and overflow rules are plugin scoped. */\n[data-theme="a7m-terminal"] {\n  --color-paper: #0b110e;\n  --color-paper-2: #111b15;\n  --color-paper-3: #1b2b20;\n  --color-ink: #e6f4e8;\n  --color-ink-2: #c2d8c6;\n  --color-muted: #92ac98;\n  --color-rule: #2a4030;\n  --color-rule-2: #57715e;\n  --color-accent: #a2f58b;\n  --color-accent-ink: #122211;\n  --color-accent-wash: #213b26;\n  --color-focus: var(--color-accent);\n  --font-body: "Segoe UI", Tahoma, sans-serif;\n  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;\n  --space-2xs: 4px;\n  --space-xs: 8px;\n  --space-sm: 12px;\n  --space-md: 16px;\n  --space-lg: 24px;\n  --space-xl: 40px;\n  --space-2xl: 64px;\n  --text-sm: 13px;\n  --text-md: 16px;\n  --text-lg: 18px;\n  --text-title: 22px;\n  --text-figure: 40px;\n  box-sizing: border-box;\n  container: a7m / inline-size;\n  width: 100%;\n  min-width: 0;\n  min-height: 100%;\n  overflow-x: clip;\n  background: var(--color-paper);\n  color: var(--color-ink);\n  font-family: var(--font-body);\n  font-size: var(--text-md);\n  line-height: 1.6;\n  font-variant-numeric: tabular-nums;\n  color-scheme: dark;\n  caret-color: var(--color-accent);\n  scrollbar-color: var(--color-rule-2) var(--color-paper);\n}\n.a7m-dashboard *, .a7m-dashboard *::before, .a7m-dashboard *::after { box-sizing: border-box; }\n.a7m-dashboard ::selection { background: var(--color-accent); color: var(--color-accent-ink); }\n.a7m-dashboard h1, .a7m-dashboard h2, .a7m-dashboard h3 {\n  color: var(--color-ink);\n  margin: 0;\n  min-width: 0;\n  overflow-wrap: break-word;\n  text-wrap: balance;\n  font-weight: 600;\n  line-height: 1.4;\n}\n.a7m-dashboard h1 { font-size: var(--text-title); }\n.a7m-dashboard h2 { font-size: var(--text-lg); }\n.a7m-dashboard h3 { font-size: var(--text-md); }\n.a7m-dashboard p, .a7m-dashboard dl, .a7m-dashboard dd { margin: 0; }\n.a7m-dashboard p { text-wrap: pretty; }\n.a7m-dashboard bdi { overflow-wrap: anywhere; }\n.a7m-dashboard [dir="ltr"] { font-family: var(--font-mono); }\n.a7m-shell { max-width: 1480px; margin-inline: auto; padding: var(--space-lg); }\n.a7m-topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); padding-bottom: var(--space-lg); }\n.a7m-brand { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); min-width: 0; }\n.a7m-brand h1 { font-family: var(--font-mono); font-size: var(--text-title); font-weight: 500; }\n.a7m-readonly { font-size: var(--text-sm); color: var(--color-ink-2); border: 1px solid var(--color-rule-2); padding: 0 var(--space-xs); }\n.a7m-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-xs); }\n.a7m-button {\n  min-height: 44px;\n  padding: var(--space-xs) var(--space-md);\n  border: 1px solid var(--color-rule-2);\n  border-radius: 0;\n  font: 500 var(--text-md)/1.4 var(--font-body);\n  cursor: pointer;\n  text-align: center;\n  white-space: nowrap;\n  overflow-wrap: anywhere;\n}\n.a7m-button-primary { background: var(--color-accent); color: var(--color-accent-ink); border-color: var(--color-accent); }\n.a7m-button-primary:hover:not(:disabled) { background: var(--color-ink); color: var(--color-accent-ink); border-color: var(--color-ink); }\n.a7m-button-secondary { background: var(--color-paper); color: var(--color-ink-2); }\n.a7m-button-secondary:hover:not(:disabled) { background: var(--color-paper-3); color: var(--color-ink); }\n.a7m-button:active:not(:disabled) { transform: translateY(1px); }\n.a7m-button:disabled { opacity: 0.55; cursor: not-allowed; }\n.a7m-button[aria-busy="true"] { cursor: progress; }\n.a7m-dashboard button:focus-visible, .a7m-dashboard summary:focus-visible, .a7m-dashboard [tabindex]:focus-visible {\n  outline: 2px solid var(--color-focus);\n  outline-offset: 3px;\n}\n.a7m-context { display: flex; flex-wrap: wrap; gap: var(--space-sm) var(--space-lg); padding-block: var(--space-sm); border-block: 1px solid var(--color-rule); font-size: var(--text-sm); }\n.a7m-context > div { display: flex; flex-wrap: wrap; gap: var(--space-xs); min-width: 0; }\n.a7m-context dt { color: var(--color-muted); }\n.a7m-context dd { color: var(--color-ink-2); }\n.a7m-notice { display: grid; gap: var(--space-2xs); padding: var(--space-md); margin-top: var(--space-md); border-inline-start: 2px solid var(--color-accent); background: var(--color-accent-wash); color: var(--color-ink); overflow-wrap: anywhere; }\n.a7m-notice span { font-size: var(--text-sm); }\n.a7m-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--color-rule); padding-block: var(--space-lg); }\n.a7m-metric { min-width: 0; padding-inline: var(--space-lg); border-inline-start: 1px solid var(--color-rule); }\n.a7m-metric:first-child { padding-inline-start: 0; border-inline-start: 0; }\n.a7m-metric:last-child { padding-inline-end: 0; }\n.a7m-metric dt { color: var(--color-ink-2); font-size: var(--text-sm); }\n.a7m-metric dd { font-size: var(--text-figure); line-height: 1.35; font-weight: 400; text-align: start; direction: rtl; }\n.a7m-metric[data-state="running"] dd { color: var(--color-accent); }\n.a7m-metric-note { display: block; color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: var(--space-lg); padding-block: var(--space-lg) var(--space-xl); align-items: start; }\n.a7m-board-section, .a7m-running { min-width: 0; }\n.a7m-section-head { display: flex; align-items: baseline; flex-wrap: wrap; justify-content: space-between; gap: var(--space-xs); min-height: 72px; padding-bottom: var(--space-md); }\n.a7m-section-head p { margin-top: var(--space-2xs); color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-section-note { font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-board {\n  display: grid;\n  grid-auto-flow: column;\n  grid-auto-columns: minmax(232px, 1fr);\n  gap: var(--space-md);\n  max-width: 100%;\n  overflow-x: auto;\n  padding: var(--space-2xs) var(--space-2xs) var(--space-md);\n  scroll-snap-type: x proximity;\n  overscroll-behavior-x: contain;\n  scrollbar-width: thin;\n  min-height: 360px;\n  align-items: start;\n}\n.a7m-column { min-width: 0; scroll-snap-align: start; }\n.a7m-column-head { display: flex; justify-content: space-between; align-items: center; min-height: 60px; gap: var(--space-xs); padding-bottom: var(--space-sm); border-bottom: 1px solid var(--color-rule-2); }\n.a7m-column-head h3 { font-size: var(--text-sm); }\n.a7m-state { display: inline-flex; align-items: baseline; gap: var(--space-xs); flex-wrap: wrap; font-size: var(--text-sm); color: var(--color-ink-2); font-weight: 400; overflow-wrap: anywhere; }\n.a7m-state[data-state="running"] { color: var(--color-accent); }\n.a7m-state[data-state="blocked"] { text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 4px; }\n.a7m-state-code { font-size: 11px; color: var(--color-muted); }\n.a7m-column-count { font-family: var(--font-mono); color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-column-tasks { display: grid; gap: var(--space-sm); padding-top: var(--space-sm); }\n.a7m-task { background: var(--color-paper-2); color: var(--color-ink); border: 1px solid var(--color-rule); min-width: 0; }\n.a7m-task > summary { display: flex; flex-direction: column; gap: var(--space-xs); min-height: 44px; padding: var(--space-sm); list-style: none; cursor: pointer; }\n.a7m-task > summary::-webkit-details-marker { display: none; }\n.a7m-task > summary:hover { background: var(--color-paper-3); color: var(--color-ink); }\n.a7m-task > summary:active { background: var(--color-accent-wash); color: var(--color-ink); }\n.a7m-task[open] { border-color: var(--color-rule-2); }\n.a7m-task[open] > summary { background: var(--color-paper-3); color: var(--color-ink); }\n.a7m-task-meta { display: flex; justify-content: space-between; align-items: center; gap: var(--space-xs); font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-disclosure { font-family: var(--font-mono); font-size: var(--text-lg); line-height: 1; }\n.a7m-task[open] .a7m-disclosure { transform: rotate(45deg); }\n.a7m-task-title { display: block; width: 100%; font-weight: 600; font-size: var(--text-md); line-height: 1.55; overflow-wrap: anywhere; }\n.a7m-task-assignee { display: flex; flex-wrap: wrap; gap: var(--space-xs); font-size: var(--text-sm); color: var(--color-ink-2); }\n.a7m-task-assignee > span { color: var(--color-muted); }\n.a7m-task-updated { color: var(--color-muted); font-size: 12px; }\n.a7m-task-detail { border-top: 1px solid var(--color-rule); padding: var(--space-sm); }\n.a7m-task-detail dl { display: grid; gap: var(--space-md); }\n.a7m-task-detail dt { color: var(--color-muted); font-size: var(--text-sm); margin-bottom: var(--space-2xs); }\n.a7m-task-detail dd { font-size: var(--text-sm); overflow-wrap: anywhere; white-space: pre-wrap; }\n.a7m-task-preview { font-size: var(--text-sm); color: var(--color-ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }\n.a7m-column-empty { color: var(--color-muted); padding: var(--space-md) 0; font-size: var(--text-sm); }\n.a7m-running { border-inline-start: 1px solid var(--color-rule); padding-inline-start: var(--space-lg); }\n.a7m-running .a7m-section-head { align-items: baseline; }\n.a7m-running-count { font-family: var(--font-mono); font-size: var(--text-lg); color: var(--color-accent); }\n.a7m-running-list { display: grid; gap: var(--space-md); }\n.a7m-task-compact { border: 0; border-bottom: 1px solid var(--color-rule); background: var(--color-paper); color: var(--color-ink); }\n.a7m-task-compact > summary { padding-inline: var(--space-2xs); }\n.a7m-aside-empty { color: var(--color-ink-2); padding-block: var(--space-md) var(--space-lg); }\n.a7m-aside-note { color: var(--color-muted); font-size: var(--text-sm); padding-top: var(--space-lg); }\n.a7m-empty { padding: var(--space-xl) var(--space-lg); background: var(--color-paper-2); color: var(--color-ink); text-align: start; }\n.a7m-empty p { color: var(--color-ink-2); margin-block: var(--space-xs) var(--space-lg); }\n.a7m-empty-board { margin-bottom: var(--space-lg); }\n.a7m-loading p { color: var(--color-muted); margin-bottom: var(--space-lg); }\n.a7m-skeleton-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-md); }\n.a7m-skeleton-column { display: grid; gap: var(--space-sm); }\n.a7m-skeleton-column span { display: block; height: 96px; background: var(--color-paper-2); }\n.a7m-skeleton-column span:first-child { height: 36px; background: var(--color-paper-3); }\n.a7m-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-xs) var(--space-lg); border-top: 1px solid var(--color-rule); padding-top: var(--space-md); color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-welcome { display: grid; align-items: center; min-height: 480px; height: 100%; }\n.a7m-welcome-art { position: relative; width: 100%; min-height: 360px; height: min(72dvh, 680px); display: grid; place-items: center; }\n.a7m-welcome canvas { position: absolute; inset: 0; width: 100%; height: 100%; }\n.a7m-welcome-text { font-family: var(--font-mono); text-align: center; font-size: clamp(28px, 6cqi, 104px) !important; line-height: 1.3 !important; padding: var(--space-md); }\n.a7m-welcome .is-painted .a7m-welcome-text { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }\n@container a7m (max-width: 1080px) {\n  .a7m-workspace { grid-template-columns: minmax(0, 1fr); }\n  .a7m-running { border-inline-start: 0; border-top: 1px solid var(--color-rule); padding-inline-start: 0; padding-top: var(--space-lg); }\n  .a7m-running-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .a7m-running .a7m-section-head { min-height: 44px; }\n}\n@container a7m (max-width: 640px) {\n  .a7m-shell { padding: var(--space-md); }\n  .a7m-topbar, .a7m-toolbar { width: 100%; }\n  .a7m-toolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .a7m-button { padding-inline: var(--space-xs); }\n  .a7m-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-lg) 0; }\n  .a7m-metric { padding-inline: var(--space-md); }\n  .a7m-metric:nth-child(odd) { padding-inline-start: 0; border-inline-start: 0; }\n  .a7m-metric:nth-child(even) { padding-inline-end: 0; }\n  .a7m-context { column-gap: var(--space-md); }\n  .a7m-running-list { grid-template-columns: minmax(0, 1fr); }\n  .a7m-board { grid-auto-columns: minmax(232px, 86%); min-height: 280px; }\n  .a7m-empty { padding: var(--space-lg) var(--space-md); }\n  .a7m-welcome-art { min-height: 320px; }\n  .a7m-section-note { display: none; }\n}\n@media (prefers-reduced-motion: reduce) {\n  .a7m-dashboard *, .a7m-dashboard *::before, .a7m-dashboard *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }\n  .a7m-welcome canvas { display: none; }\n  .a7m-welcome .is-painted .a7m-welcome-text { position: static; width: auto; height: auto; padding: var(--space-md); clip-path: none; white-space: normal; }\n}\n\n/* Tabs */\n.a7m-tabs { display: flex; gap: var(--space-2xs); border-bottom: 1px solid var(--color-rule); padding-bottom: var(--space-sm); margin-bottom: var(--space-lg); }\n.a7m-tab { background: var(--color-paper); color: var(--color-ink-2); border: 1px solid var(--color-rule-2); padding: var(--space-xs) var(--space-md); font: 500 var(--text-md)/1.4 var(--font-body); cursor: pointer; min-height: 44px; }\n.a7m-tab[aria-selected="true"] { background: var(--color-accent-wash); color: var(--color-ink); border-color: var(--color-accent); }\n.a7m-tab:hover:not([aria-selected="true"]) { background: var(--color-paper-3); color: var(--color-ink); }\n\n/* Execution ledger: existing Terminal tokens, no extra theme. */\n.a7m-tabs { overflow-x: auto; }\n.a7m-tab { flex: none; }\n.a7m-executions { min-width: 0; }\n.a7m-executions > section { margin-bottom: var(--space-lg); }\n.a7m-executions .a7m-section-head { min-height: 44px; padding-top: var(--space-md); }\n.a7m-execution-row { min-width: 0; border-bottom: 1px solid var(--color-rule); padding: var(--space-md) 0; }\n.a7m-execution-row > header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-xs); margin-bottom: var(--space-sm); }\n.a7m-execution-row > header > span, .a7m-execution-provenance { font-size: var(--text-sm); color: var(--color-muted); overflow-wrap: anywhere; }\n.a7m-execution-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-sm); padding-block: var(--space-xs); }\n.a7m-execution-fields > div { min-width: 0; }\n.a7m-execution-fields dt { font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-execution-fields dd { overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }\n.a7m-execution-models { margin-block: var(--space-sm); background: var(--color-paper-2); padding: var(--space-sm); }\n.a7m-execution-models > summary { cursor: pointer; min-height: 44px; }\n.a7m-execution-models > div { margin-top: var(--space-sm); }\n.a7m-execution-provenance { padding-block: var(--space-xs); }\n@container a7m (max-width: 640px) {\n  .a7m-execution-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n}\n\n/* Model catalog */\n.a7m-catalog { min-width: 0; }\n.a7m-catalog-tools { display: flex; flex-wrap: wrap; gap: var(--space-md); align-items: end; padding-bottom: var(--space-md); }\n.a7m-catalog-filters { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; }\n.a7m-catalog-filters label { display: flex; flex-wrap: wrap; gap: var(--space-2xs); align-items: center; font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-catalog-input, .a7m-catalog-select { padding: var(--space-2xs) var(--space-xs); background: var(--color-paper-2); color: var(--color-ink); border: 1px solid var(--color-rule-2); font: 500 var(--text-sm)/1.4 var(--font-mono); min-height: 36px; }\n.a7m-catalog-sort { display: flex; flex-wrap: wrap; gap: var(--space-xs); align-items: center; font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-catalog-sort span { color: var(--color-muted); }\n.a7m-button-sort { min-height: 36px; padding: var(--space-2xs) var(--space-sm); font-size: var(--text-sm); }\n.a7m-catalog-count { font-size: var(--text-sm); color: var(--color-muted); padding-bottom: var(--space-sm); }\n.a7m-catalog-table { display: grid; grid-template-columns: minmax(600px, 1fr); max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; border: 1px solid var(--color-rule); }\n.a7m-catalog-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-sm); padding-block: var(--space-md); }\n.a7m-catalog input:focus-visible, .a7m-catalog select:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; }\n.a7m-catalog-input, .a7m-catalog-select { max-width: 100%; }\n.a7m-model-row summary > span { min-width: 0; overflow-wrap: anywhere; }\n.a7m-catalog-header { display: grid; grid-template-columns: minmax(100px,1fr) minmax(140px,1fr) minmax(80px,auto) repeat(3, minmax(80px,auto)); gap: var(--space-xs); padding: var(--space-sm); background: var(--color-paper-3); font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-catalog-header span { overflow-wrap: anywhere; }\n.a7m-model-row { border-bottom: 1px solid var(--color-rule); background: var(--color-paper); }\n.a7m-model-row > summary { display: grid; grid-template-columns: minmax(100px,1fr) minmax(140px,1fr) minmax(80px,auto) repeat(3, minmax(80px,auto)); gap: var(--space-xs); padding: var(--space-sm); cursor: pointer; list-style: none; min-height: 44px; }\n.a7m-model-row > summary::-webkit-details-marker { display: none; }\n.a7m-model-row > summary:hover { background: var(--color-paper-3); }\n.a7m-model-row[open] > summary { background: var(--color-paper-3); }\n.a7m-model-name { font-weight: 600; font-size: var(--text-md); }\n.a7m-model-id { font-size: 12px; color: var(--color-muted); font-family: var(--font-mono); }\n.a7m-model-provider { font-size: var(--text-sm); color: var(--color-ink-2); font-family: var(--font-mono); }\n.a7m-model-price { font-size: var(--text-sm); color: var(--color-ink-2); font-family: var(--font-mono); direction: ltr; }\n.a7m-model-context { font-size: var(--text-sm); color: var(--color-ink-2); font-family: var(--font-mono); }\n.a7m-model-detail { padding: var(--space-sm); border-top: 1px solid var(--color-rule); }\n.a7m-model-desc { font-size: var(--text-sm); color: var(--color-ink-2); overflow-wrap: anywhere; white-space: pre-wrap; }\n.a7m-model-caps { display: flex; flex-wrap: wrap; gap: var(--space-xs); padding-top: var(--space-sm); }\n.a7m-model-cap { padding: var(--space-2xs) var(--space-xs); background: var(--color-paper-2); border: 1px solid var(--color-rule-2); font-size: 11px; color: var(--color-muted); }\n.a7m-catalog-empty { padding: var(--space-lg); text-align: start; color: var(--color-muted); border-top: 1px solid var(--color-rule); }\n/* Cost calculator */\n.a7m-calc-section { margin-top: var(--space-lg); border: 1px solid var(--color-rule); background: var(--color-paper-2); color: var(--color-ink); }\n.a7m-calc-section > summary { padding: var(--space-sm); cursor: pointer; list-style: none; min-height: 44px; }\n.a7m-calc-section > summary::-webkit-details-marker { display: none; }\n.a7m-calc-head h3 { font-size: var(--text-md); color: var(--color-ink); }\n.a7m-calc-body { padding: var(--space-sm); border-top: 1px solid var(--color-rule); }\n.a7m-calc-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--space-sm); }\n.a7m-calc-fields label { display: flex; flex-direction: column; gap: var(--space-2xs); font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-calc-result { margin-top: var(--space-md); padding: var(--space-sm); background: var(--color-paper-3); }\n.a7m-calc-result p { color: var(--color-ink); font-size: var(--text-md); }\n.a7m-calc-detail { font-size: var(--text-sm); color: var(--color-ink-2); }\n.a7m-calc-note { font-size: var(--text-sm); color: var(--color-muted); margin-top: var(--space-xs); }\n\n@container a7m (max-width: 1080px) {\n  .a7m-catalog-header, .a7m-model-row > summary { grid-template-columns: minmax(80px,1fr) minmax(100px,1fr) minmax(60px,auto) repeat(3, minmax(60px,auto)); }\n}\n@container a7m (max-width: 640px) {\n  .a7m-catalog-header, .a7m-model-row > summary { grid-template-columns: minmax(70px,1fr) minmax(80px,1fr) minmax(50px,auto) minmax(60px,auto) minmax(60px,auto) minmax(60px,auto); }\n  .a7m-catalog-filters { flex-direction: column; }\n  .a7m-calc-fields { grid-template-columns: 1fr; }\n}\n';

// src/plugin.jsx
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function subscribeActivation(onChange) {
  let epoch = gatewayActivationEpoch();
  let frame;
  let disposed = false;
  const check = () => {
    if (disposed) return;
    const next = gatewayActivationEpoch();
    if (next !== epoch) {
      epoch = next;
      onChange();
    }
    if (!disposed) frame = requestAnimationFrame(check);
  };
  frame = requestAnimationFrame(check);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
  };
}
function Dashboard({ ctx }) {
  const [intro, setIntro] = useState2(true);
  const [tab, setTab] = useState2("tasks");
  const [executionPage, setExecutionPage] = useState2({ profile: null, epoch: null, page: 1 });
  const connection = useValue(host.state.gateway);
  const profile = useValue(host.state.profile);
  const model = useValue(host.state.model);
  const epoch = useSyncExternalStore(subscribeActivation, gatewayActivationEpoch);
  const page = executionPage.profile === profile && executionPage.epoch === epoch ? executionPage.page : 1;
  const query = useQuery({
    queryKey: ["a7m-dashboard", profile, epoch],
    queryFn: async () => {
      const scope = { epoch: gatewayActivationEpoch(), profile: host.state.profile.get() };
      const isCurrent = () => scope.epoch === gatewayActivationEpoch() && scope.profile === host.state.profile.get();
      if (scope.epoch !== epoch || scope.profile !== profile) throw new Error("Gateway selection changed");
      const snapshot2 = normalizeBoard(await ctx.rest("/snapshot", { method: "GET", timeoutMs: 12e3 }));
      if (!isCurrent()) throw new Error("Gateway selection changed");
      return { ...scope, snapshot: snapshot2 };
    },
    refetchInterval: 1e4,
    refetchIntervalInBackground: false,
    staleTime: 5e3,
    retry: false
  });
  const modelQuery = useQuery({
    queryKey: ["a7m-dashboard-models", profile, epoch],
    queryFn: async () => {
      const scope = { epoch: gatewayActivationEpoch(), profile: host.state.profile.get() };
      const isCurrent = () => scope.epoch === gatewayActivationEpoch() && scope.profile === host.state.profile.get();
      if (scope.epoch !== epoch || scope.profile !== profile) throw new Error("Gateway selection changed");
      const raw = await ctx.rest("/models", { method: "GET", timeoutMs: 25e3 });
      if (!isCurrent()) throw new Error("Gateway selection changed");
      return { ...scope, models: normalizeModels(raw.models || raw), meta: { source: raw.source, fetched_at: raw.fetched_at, stale: raw.stale } };
    },
    enabled: tab === "models" && !intro,
    refetchInterval: 6e4,
    refetchIntervalInBackground: false,
    staleTime: 3e4,
    retry: false
  });
  const executionQuery = useQuery({
    queryKey: ["a7m-dashboard-executions", profile, epoch, page],
    queryFn: async () => {
      const scope = { epoch: gatewayActivationEpoch(), profile: host.state.profile.get(), page };
      const isCurrent = () => scope.epoch === gatewayActivationEpoch() && scope.profile === host.state.profile.get();
      if (scope.epoch !== epoch || scope.profile !== profile) throw new Error("Gateway selection changed");
      const data = await ctx.rest(`/executions?page=${page}&limit=25`, { method: "GET", timeoutMs: 12e3 });
      if (!isCurrent()) throw new Error("Gateway selection changed");
      const external = data.opencode_history;
      const externalCountValid = Number.isSafeInteger(external?.total) && external.total >= 0 || external?.total === null && ["unavailable", "disabled"].includes(external.status);
      if (!Array.isArray(data.running) || !Array.isArray(data.history?.rows) || !Array.isArray(data.opencode) || data.history.page !== page || data.history.limit !== 25 || !Number.isSafeInteger(data.history.total) || data.history.total < 0 || !externalCountValid || external.page !== page || external.limit !== 25 || !["available", "unavailable", "disabled"].includes(external.status)) throw new Error("Invalid execution history response");
      return { ...scope, data };
    },
    enabled: tab === "executions" && !intro,
    refetchInterval: tab === "executions" && !intro ? 1e4 : false,
    refetchIntervalInBackground: false,
    staleTime: 5e3,
    retry: false
  });
  const executionsData = executionQuery.data?.epoch === gatewayActivationEpoch() && executionQuery.data?.profile === host.state.profile.get() && executionQuery.data?.page === page ? executionQuery.data.data : void 0;
  const snapshot = query.data?.epoch === gatewayActivationEpoch() && query.data?.profile === host.state.profile.get() ? query.data.snapshot : void 0;
  const modelsData = modelQuery.data?.epoch === gatewayActivationEpoch() && modelQuery.data?.profile === host.state.profile.get() ? modelQuery.data : void 0;
  const activeTab = !intro ? tab : "tasks";
  return /* @__PURE__ */ jsxs2(Fragment2, { children: [
    /* @__PURE__ */ jsx2("style", { children: style_default }),
    intro ? /* @__PURE__ */ jsx2(Welcome, { onDone: () => setIntro(false) }) : /* @__PURE__ */ jsx2("div", { className: "a7m-dashboard", "data-theme": "a7m-terminal", lang: "ar", dir: "rtl", children: /* @__PURE__ */ jsxs2("div", { className: "a7m-shell", children: [
      /* @__PURE__ */ jsxs2("nav", { className: "a7m-tabs", role: "tablist", "aria-label": "\u0623\u0642\u0633\u0627\u0645 \u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062D\u0643\u0645", onKeyDown: (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = ["tasks", "models", "executions"];
        const index = tabs.indexOf(tab);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowLeft" ? 1 : 2)) % 3;
        const next = tabs[nextIndex];
        setTab(next);
        event.currentTarget.querySelectorAll('[role="tab"]')[nextIndex].focus();
      }, children: [
        /* @__PURE__ */ jsx2("button", { role: "tab", "aria-selected": activeTab === "tasks", "aria-controls": "tabpanel-tasks", className: "a7m-tab", onClick: () => setTab("tasks"), tabIndex: activeTab === "tasks" ? 0 : -1, children: "\u0627\u0644\u0645\u0647\u0627\u0645" }),
        /* @__PURE__ */ jsx2("button", { role: "tab", "aria-selected": activeTab === "models", "aria-controls": "tabpanel-models", className: "a7m-tab", onClick: () => setTab("models"), tabIndex: activeTab === "models" ? 0 : -1, children: "\u062F\u0644\u064A\u0644 \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A" }),
        /* @__PURE__ */ jsx2("button", { role: "tab", "aria-selected": activeTab === "executions", "aria-controls": "tabpanel-executions", className: "a7m-tab", onClick: () => setTab("executions"), tabIndex: activeTab === "executions" ? 0 : -1, children: "\u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u0648\u0627\u0644\u0633\u062C\u0644" })
      ] }),
      /* @__PURE__ */ jsx2("div", { role: "tabpanel", id: "tabpanel-tasks", "aria-label": "\u0627\u0644\u0645\u0647\u0627\u0645", hidden: activeTab !== "tasks", children: /* @__PURE__ */ jsx2(
        DashboardView,
        {
          snapshot,
          loading: query.isPending,
          refreshing: query.isFetching,
          error: query.error ? "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 Kanban. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0648\u062A\u0641\u0639\u064A\u0644 \u0625\u0636\u0627\u0641\u0629 a7m-dashboard \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645\u060C \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629." : null,
          connection,
          model: typeof model === "string" ? model : model?.name,
          profile: typeof profile === "string" ? profile : profile?.name,
          onRefresh: () => query.refetch(),
          onOpenKanban: () => host.navigate("/kanban")
        }
      ) }),
      /* @__PURE__ */ jsx2("div", { role: "tabpanel", id: "tabpanel-models", "aria-label": "\u062F\u0644\u064A\u0644 \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A", hidden: activeTab !== "models", children: /* @__PURE__ */ jsx2(
        ModelCatalog,
        {
          models: modelsData?.models,
          meta: modelsData?.meta,
          loading: modelQuery.isPending,
          error: modelQuery.error ? "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u062F\u0644\u064A\u0644 \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0639\u0627\u0645. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629." : null,
          onRefresh: () => modelQuery.refetch()
        }
      ) }),
      /* @__PURE__ */ jsx2("div", { role: "tabpanel", id: "tabpanel-executions", "aria-label": "\u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u0648\u0627\u0644\u0633\u062C\u0644", hidden: activeTab !== "executions", children: /* @__PURE__ */ jsx2(
        ExecutionHistory,
        {
          data: executionsData,
          loading: executionQuery.isPending,
          refreshing: executionQuery.isFetching,
          page,
          error: executionQuery.error ? "\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0633\u062C\u0644 \u0627\u0644\u062A\u0646\u0641\u064A\u0630. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629." : null,
          onPage: (page2) => setExecutionPage({ profile, epoch, page: page2 }),
          onRefresh: () => executionQuery.refetch()
        }
      ) })
    ] }) })
  ] });
}
var plugin_default = {
  id: "a7m-dashboard",
  name: "A7M Dashbord",
  defaultEnabled: true,
  register(ctx) {
    ctx.register({ id: "page", area: ROUTES_AREA, data: { path: "/a7m-dashboard" }, render: () => /* @__PURE__ */ jsx2(Dashboard, { ctx }) });
    ctx.register({ id: "nav", area: SIDEBAR_NAV_AREA, data: { path: "/a7m-dashboard", label: "A7M Dashbord", codicon: "dashboard" } });
  }
};
export {
  plugin_default as default
};
