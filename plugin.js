// src/plugin.jsx
import { useState as useState2, useSyncExternalStore } from "react";
import { host, gatewayActivationEpoch, useQuery, useValue, ROUTES_AREA, SIDEBAR_NAV_AREA } from "@hermes/plugin-sdk";

// src/ui.jsx
import React, { useEffect, useRef, useState } from "react";
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

// src/data.mjs
function normalizeBoard(value) {
  if (!value || !Array.isArray(value.columns) || !value.columns.every(
    (column) => column && typeof column.name === "string" && Array.isArray(column.tasks) && column.tasks.every((task) => task && typeof task.id === "string" && typeof task.title === "string")
  )) throw new Error("\u0628\u064A\u0627\u0646\u0627\u062A \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0647\u0627\u0645 \u063A\u064A\u0631 \u0645\u062A\u0648\u0627\u0641\u0642\u0629. \u062D\u062F\u0651\u062B \u0647\u064A\u0631\u0645\u0632 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.");
  return value;
}

// src/style.css
var style_default = '/* Hallmark \xB7 shape: app screen \xB7 theme: Terminal (by request) \xB7 genre: atmospheric \xB7 posture: committed \xB7 signature: native Kanban task ledger \xB7 nav: compact toolbar \xB7 footer: source record \xB7 copy: verbatim \xB7 v2.0.0 */\n/* Hallmark \xB7 pre-emit critique: P4 H4 E4 S4 R5 V3 \xB7 weakest: V, familiar Kanban structure is intentional; native status names remain visible. */\n/* Hallmark \xB7 font waiver: Arabic system face paired with local monospace; bilingual desktop UI requires Arabic shaping without a remote font dependency. */\n/* Hallmark \xB7 user-requested intro: one glyph-mask resolution, 1.8 seconds plus 0.6 seconds hold; reduced motion skips it. Host-owned html/body remain untouched; all tokens and overflow rules are plugin scoped. */\n[data-theme="a7m-terminal"] {\n  --color-paper: #0b110e;\n  --color-paper-2: #111b15;\n  --color-paper-3: #1b2b20;\n  --color-ink: #e6f4e8;\n  --color-ink-2: #c2d8c6;\n  --color-muted: #92ac98;\n  --color-rule: #2a4030;\n  --color-rule-2: #57715e;\n  --color-accent: #a2f58b;\n  --color-accent-ink: #122211;\n  --color-accent-wash: #213b26;\n  --color-focus: var(--color-accent);\n  --font-body: "Segoe UI", Tahoma, sans-serif;\n  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;\n  --space-2xs: 4px;\n  --space-xs: 8px;\n  --space-sm: 12px;\n  --space-md: 16px;\n  --space-lg: 24px;\n  --space-xl: 40px;\n  --space-2xl: 64px;\n  --text-sm: 13px;\n  --text-md: 16px;\n  --text-lg: 18px;\n  --text-title: 22px;\n  --text-figure: 40px;\n  box-sizing: border-box;\n  container: a7m / inline-size;\n  width: 100%;\n  min-width: 0;\n  min-height: 100%;\n  overflow-x: clip;\n  background: var(--color-paper);\n  color: var(--color-ink);\n  font-family: var(--font-body);\n  font-size: var(--text-md);\n  line-height: 1.6;\n  font-variant-numeric: tabular-nums;\n  color-scheme: dark;\n  scrollbar-color: var(--color-rule-2) var(--color-paper);\n}\n.a7m-dashboard *, .a7m-dashboard *::before, .a7m-dashboard *::after { box-sizing: border-box; }\n.a7m-dashboard ::selection { background: var(--color-accent); color: var(--color-accent-ink); }\n.a7m-dashboard h1, .a7m-dashboard h2, .a7m-dashboard h3 {\n  color: var(--color-ink);\n  margin: 0;\n  min-width: 0;\n  overflow-wrap: break-word;\n  text-wrap: balance;\n  font-weight: 600;\n  line-height: 1.4;\n}\n.a7m-dashboard h1 { font-size: var(--text-title); }\n.a7m-dashboard h2 { font-size: var(--text-lg); }\n.a7m-dashboard h3 { font-size: var(--text-md); }\n.a7m-dashboard p, .a7m-dashboard dl, .a7m-dashboard dd { margin: 0; }\n.a7m-dashboard p { text-wrap: pretty; }\n.a7m-dashboard bdi { overflow-wrap: anywhere; }\n.a7m-dashboard [dir="ltr"] { font-family: var(--font-mono); }\n.a7m-shell { max-width: 1480px; margin-inline: auto; padding: var(--space-lg); }\n.a7m-topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-md); padding-bottom: var(--space-lg); }\n.a7m-brand { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); min-width: 0; }\n.a7m-brand h1 { font-family: var(--font-mono); font-size: var(--text-title); font-weight: 500; }\n.a7m-readonly { font-size: var(--text-sm); color: var(--color-ink-2); border: 1px solid var(--color-rule-2); padding: 0 var(--space-xs); }\n.a7m-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-xs); }\n.a7m-button {\n  min-height: 44px;\n  padding: var(--space-xs) var(--space-md);\n  border: 1px solid var(--color-rule-2);\n  border-radius: 0;\n  font: 500 var(--text-md)/1.4 var(--font-body);\n  cursor: pointer;\n  text-align: center;\n  white-space: nowrap;\n  overflow-wrap: anywhere;\n}\n.a7m-button-primary { background: var(--color-accent); color: var(--color-accent-ink); border-color: var(--color-accent); }\n.a7m-button-primary:hover:not(:disabled) { background: var(--color-ink); color: var(--color-accent-ink); border-color: var(--color-ink); }\n.a7m-button-secondary { background: var(--color-paper); color: var(--color-ink-2); }\n.a7m-button-secondary:hover:not(:disabled) { background: var(--color-paper-3); color: var(--color-ink); }\n.a7m-button:active:not(:disabled) { transform: translateY(1px); }\n.a7m-button:disabled { opacity: 0.55; cursor: not-allowed; }\n.a7m-button[aria-busy="true"] { cursor: progress; }\n.a7m-dashboard button:focus-visible, .a7m-dashboard summary:focus-visible, .a7m-dashboard [tabindex]:focus-visible {\n  outline: 2px solid var(--color-focus);\n  outline-offset: 3px;\n}\n.a7m-context { display: flex; flex-wrap: wrap; gap: var(--space-sm) var(--space-lg); padding-block: var(--space-sm); border-block: 1px solid var(--color-rule); font-size: var(--text-sm); }\n.a7m-context > div { display: flex; flex-wrap: wrap; gap: var(--space-xs); min-width: 0; }\n.a7m-context dt { color: var(--color-muted); }\n.a7m-context dd { color: var(--color-ink-2); }\n.a7m-notice { display: grid; gap: var(--space-2xs); padding: var(--space-md); margin-top: var(--space-md); border-inline-start: 2px solid var(--color-accent); background: var(--color-accent-wash); color: var(--color-ink); overflow-wrap: anywhere; }\n.a7m-notice span { font-size: var(--text-sm); }\n.a7m-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--color-rule); padding-block: var(--space-lg); }\n.a7m-metric { min-width: 0; padding-inline: var(--space-lg); border-inline-start: 1px solid var(--color-rule); }\n.a7m-metric:first-child { padding-inline-start: 0; border-inline-start: 0; }\n.a7m-metric:last-child { padding-inline-end: 0; }\n.a7m-metric dt { color: var(--color-ink-2); font-size: var(--text-sm); }\n.a7m-metric dd { font-size: var(--text-figure); line-height: 1.35; font-weight: 400; text-align: start; direction: rtl; }\n.a7m-metric[data-state="running"] dd { color: var(--color-accent); }\n.a7m-metric-note { display: block; color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: var(--space-lg); padding-block: var(--space-lg) var(--space-xl); align-items: start; }\n.a7m-board-section, .a7m-running { min-width: 0; }\n.a7m-section-head { display: flex; align-items: baseline; flex-wrap: wrap; justify-content: space-between; gap: var(--space-xs); min-height: 72px; padding-bottom: var(--space-md); }\n.a7m-section-head p { margin-top: var(--space-2xs); color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-section-note { font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-board {\n  display: grid;\n  grid-auto-flow: column;\n  grid-auto-columns: minmax(232px, 1fr);\n  gap: var(--space-md);\n  max-width: 100%;\n  overflow-x: auto;\n  padding: var(--space-2xs) var(--space-2xs) var(--space-md);\n  scroll-snap-type: x proximity;\n  overscroll-behavior-x: contain;\n  scrollbar-width: thin;\n  min-height: 360px;\n  align-items: start;\n}\n.a7m-column { min-width: 0; scroll-snap-align: start; }\n.a7m-column-head { display: flex; justify-content: space-between; align-items: center; min-height: 60px; gap: var(--space-xs); padding-bottom: var(--space-sm); border-bottom: 1px solid var(--color-rule-2); }\n.a7m-column-head h3 { font-size: var(--text-sm); }\n.a7m-state { display: inline-flex; align-items: baseline; gap: var(--space-xs); flex-wrap: wrap; font-size: var(--text-sm); color: var(--color-ink-2); font-weight: 400; overflow-wrap: anywhere; }\n.a7m-state[data-state="running"] { color: var(--color-accent); }\n.a7m-state[data-state="blocked"] { text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 4px; }\n.a7m-state-code { font-size: 11px; color: var(--color-muted); }\n.a7m-column-count { font-family: var(--font-mono); color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-column-tasks { display: grid; gap: var(--space-sm); padding-top: var(--space-sm); }\n.a7m-task { background: var(--color-paper-2); color: var(--color-ink); border: 1px solid var(--color-rule); min-width: 0; }\n.a7m-task > summary { display: flex; flex-direction: column; gap: var(--space-xs); min-height: 44px; padding: var(--space-sm); list-style: none; cursor: pointer; }\n.a7m-task > summary::-webkit-details-marker { display: none; }\n.a7m-task > summary:hover { background: var(--color-paper-3); color: var(--color-ink); }\n.a7m-task > summary:active { background: var(--color-accent-wash); color: var(--color-ink); }\n.a7m-task[open] { border-color: var(--color-rule-2); }\n.a7m-task[open] > summary { background: var(--color-paper-3); color: var(--color-ink); }\n.a7m-task-meta { display: flex; justify-content: space-between; align-items: center; gap: var(--space-xs); font-size: var(--text-sm); color: var(--color-muted); }\n.a7m-disclosure { font-family: var(--font-mono); font-size: var(--text-lg); line-height: 1; }\n.a7m-task[open] .a7m-disclosure { transform: rotate(45deg); }\n.a7m-task-title { display: block; width: 100%; font-weight: 600; font-size: var(--text-md); line-height: 1.55; overflow-wrap: anywhere; }\n.a7m-task-assignee { display: flex; flex-wrap: wrap; gap: var(--space-xs); font-size: var(--text-sm); color: var(--color-ink-2); }\n.a7m-task-assignee > span { color: var(--color-muted); }\n.a7m-task-updated { color: var(--color-muted); font-size: 12px; }\n.a7m-task-detail { border-top: 1px solid var(--color-rule); padding: var(--space-sm); }\n.a7m-task-detail dl { display: grid; gap: var(--space-md); }\n.a7m-task-detail dt { color: var(--color-muted); font-size: var(--text-sm); margin-bottom: var(--space-2xs); }\n.a7m-task-detail dd { font-size: var(--text-sm); overflow-wrap: anywhere; white-space: pre-wrap; }\n.a7m-task-preview { font-size: var(--text-sm); color: var(--color-ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }\n.a7m-column-empty { color: var(--color-muted); padding: var(--space-md) 0; font-size: var(--text-sm); }\n.a7m-running { border-inline-start: 1px solid var(--color-rule); padding-inline-start: var(--space-lg); }\n.a7m-running .a7m-section-head { align-items: baseline; }\n.a7m-running-count { font-family: var(--font-mono); font-size: var(--text-lg); color: var(--color-accent); }\n.a7m-running-list { display: grid; gap: var(--space-md); }\n.a7m-task-compact { border: 0; border-bottom: 1px solid var(--color-rule); background: var(--color-paper); color: var(--color-ink); }\n.a7m-task-compact > summary { padding-inline: var(--space-2xs); }\n.a7m-aside-empty { color: var(--color-ink-2); padding-block: var(--space-md) var(--space-lg); }\n.a7m-aside-note { color: var(--color-muted); font-size: var(--text-sm); padding-top: var(--space-lg); }\n.a7m-empty { padding: var(--space-xl) var(--space-lg); background: var(--color-paper-2); color: var(--color-ink); text-align: start; }\n.a7m-empty p { color: var(--color-ink-2); margin-block: var(--space-xs) var(--space-lg); }\n.a7m-empty-board { margin-bottom: var(--space-lg); }\n.a7m-loading p { color: var(--color-muted); margin-bottom: var(--space-lg); }\n.a7m-skeleton-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-md); }\n.a7m-skeleton-column { display: grid; gap: var(--space-sm); }\n.a7m-skeleton-column span { display: block; height: 96px; background: var(--color-paper-2); }\n.a7m-skeleton-column span:first-child { height: 36px; background: var(--color-paper-3); }\n.a7m-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-xs) var(--space-lg); border-top: 1px solid var(--color-rule); padding-top: var(--space-md); color: var(--color-muted); font-size: var(--text-sm); }\n.a7m-welcome { display: grid; align-items: center; min-height: 480px; height: 100%; }\n.a7m-welcome-art { position: relative; width: 100%; min-height: 360px; height: min(72dvh, 680px); display: grid; place-items: center; }\n.a7m-welcome canvas { position: absolute; inset: 0; width: 100%; height: 100%; }\n.a7m-welcome-text { font-family: var(--font-mono); text-align: center; font-size: clamp(28px, 6cqi, 104px) !important; line-height: 1.3 !important; padding: var(--space-md); }\n.a7m-welcome .is-painted .a7m-welcome-text { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }\n@container a7m (max-width: 1080px) {\n  .a7m-workspace { grid-template-columns: minmax(0, 1fr); }\n  .a7m-running { border-inline-start: 0; border-top: 1px solid var(--color-rule); padding-inline-start: 0; padding-top: var(--space-lg); }\n  .a7m-running-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .a7m-running .a7m-section-head { min-height: 44px; }\n}\n@container a7m (max-width: 640px) {\n  .a7m-shell { padding: var(--space-md); }\n  .a7m-topbar, .a7m-toolbar { width: 100%; }\n  .a7m-toolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .a7m-button { padding-inline: var(--space-xs); }\n  .a7m-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-lg) 0; }\n  .a7m-metric { padding-inline: var(--space-md); }\n  .a7m-metric:nth-child(odd) { padding-inline-start: 0; border-inline-start: 0; }\n  .a7m-metric:nth-child(even) { padding-inline-end: 0; }\n  .a7m-context { column-gap: var(--space-md); }\n  .a7m-running-list { grid-template-columns: minmax(0, 1fr); }\n  .a7m-board { grid-auto-columns: minmax(232px, 86%); min-height: 280px; }\n  .a7m-empty { padding: var(--space-lg) var(--space-md); }\n  .a7m-welcome-art { min-height: 320px; }\n  .a7m-section-note { display: none; }\n}\n@media (prefers-reduced-motion: reduce) {\n  .a7m-dashboard *, .a7m-dashboard *::before, .a7m-dashboard *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }\n  .a7m-welcome canvas { display: none; }\n  .a7m-welcome .is-painted .a7m-welcome-text { position: static; width: auto; height: auto; padding: var(--space-md); clip-path: none; white-space: normal; }\n}\n';

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
  const connection = useValue(host.state.gateway);
  const profile = useValue(host.state.profile);
  const model = useValue(host.state.model);
  const epoch = useSyncExternalStore(subscribeActivation, gatewayActivationEpoch);
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
  const snapshot = query.data?.epoch === gatewayActivationEpoch() && query.data?.profile === host.state.profile.get() ? query.data.snapshot : void 0;
  return /* @__PURE__ */ jsxs2(Fragment2, { children: [
    /* @__PURE__ */ jsx2("style", { children: style_default }),
    intro ? /* @__PURE__ */ jsx2(Welcome, { onDone: () => setIntro(false) }) : /* @__PURE__ */ jsx2(
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
    )
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
