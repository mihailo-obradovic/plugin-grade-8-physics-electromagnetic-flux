import { createRoot } from 'react-dom/client';
import { useRef, useState, useEffect } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';

// src/index.tsx
var PREFIX = "pl-g8-physics-electromagnetic-flux-";
var c = (name) => PREFIX + name;
var SCENE_W = 800;
var SCENE_H = 340;
var COIL_CX = 400;
var COIL_CY = 210;
var COIL_HALF_W = 100;
var COIL_HALF_H = 60;
var COIL_TURNS = 6;
var MAGNET_W = 120;
var MAGNET_H = 44;
var MAGNET_MIN_X = 60;
var MAGNET_MAX_X = 740;
var FLUX_SIGMA = 110;
var CHART_H = 120;
var HISTORY_SECS = 5;
var CURRENT_SMOOTH_TAU = 0.06;
var CURRENT_SCALE = 0.15;
var CURRENT_TRIGGER = 0.08;
var CURRENT_QUIET = 0.04;
var CHECK_MS_MOVE = 100;
var CHECK_MS_STILL = 600;
var CHECK_DECAY_RATE = 0.35;
var CHECKPOINT_LABELS = [
  "Induce a current by pushing the magnet into the coil.",
  "Induce the opposite current by pulling the magnet out.",
  "Hold the magnet still inside the coil \u2014 current returns to zero."
];
function fluxAt(magnetCenter, polarity) {
  const dx = magnetCenter - COIL_CX;
  return polarity * Math.exp(-(dx * dx) / (FLUX_SIGMA * FLUX_SIGMA));
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function Exercise({ context }) {
  const svgRef = useRef(null);
  const [magnetX, setMagnetX] = useState(120);
  const [polarity, setPolarity] = useState(1);
  const [flux, setFlux] = useState(0);
  const [current, setCurrent] = useState(0);
  const [history, setHistory] = useState([]);
  const [checkpoints, setCheckpoints] = useState([false, false, false]);
  const magnetXRef = useRef(magnetX);
  const polarityRef = useRef(polarity);
  const prevFluxRef = useRef(0);
  const prevMagnetXRef = useRef(magnetX);
  const smoothedIRef = useRef(0);
  const lastTimeMsRef = useRef(null);
  const startTimeMsRef = useRef(null);
  const historyRef = useRef([]);
  const rafRef = useRef(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const stillTimerRef = useRef(0);
  const inTimerRef = useRef(0);
  const outTimerRef = useRef(0);
  const checkpointsRef = useRef([false, false, false]);
  useEffect(() => {
    function step(nowMs) {
      if (startTimeMsRef.current === null) startTimeMsRef.current = nowMs;
      const nowSec2 = (nowMs - startTimeMsRef.current) / 1e3;
      const lastMs = lastTimeMsRef.current;
      const dtSec = lastMs === null ? 0 : Math.max(1e-3, (nowMs - lastMs) / 1e3);
      lastTimeMsRef.current = nowMs;
      const f = fluxAt(magnetXRef.current, polarityRef.current);
      const rawI = lastMs === null ? 0 : -(f - prevFluxRef.current) / dtSec;
      prevFluxRef.current = f;
      const alpha = 1 - Math.exp(-dtSec / CURRENT_SMOOTH_TAU);
      smoothedIRef.current += alpha * (rawI - smoothedIRef.current);
      const displayI = clamp(smoothedIRef.current * CURRENT_SCALE, -1, 1);
      historyRef.current.push({ t: nowSec2, flux: f, current: displayI });
      const cutoff = nowSec2 - HISTORY_SECS;
      while (historyRef.current.length > 0 && historyRef.current[0].t < cutoff) {
        historyRef.current.shift();
      }
      const insideCoil = Math.abs(magnetXRef.current - COIL_CX) < COIL_HALF_W;
      const dtMs = dtSec * 1e3;
      const absI = Math.abs(displayI);
      const inductionSign = displayI * polarityRef.current;
      const pushingIn = absI > CURRENT_TRIGGER && inductionSign < 0;
      const pullingOut = absI > CURRENT_TRIGGER && inductionSign > 0;
      prevMagnetXRef.current = magnetXRef.current;
      if (pushingIn) {
        inTimerRef.current += dtMs;
        if (inTimerRef.current >= CHECK_MS_MOVE && !checkpointsRef.current[0]) {
          checkpointsRef.current = [true, checkpointsRef.current[1], checkpointsRef.current[2]];
          setCheckpoints(checkpointsRef.current);
        }
      } else {
        inTimerRef.current = Math.max(0, inTimerRef.current - dtMs * CHECK_DECAY_RATE);
      }
      if (pullingOut) {
        outTimerRef.current += dtMs;
        if (outTimerRef.current >= CHECK_MS_MOVE && !checkpointsRef.current[1]) {
          checkpointsRef.current = [checkpointsRef.current[0], true, checkpointsRef.current[2]];
          setCheckpoints(checkpointsRef.current);
        }
      } else {
        outTimerRef.current = Math.max(0, outTimerRef.current - dtMs * CHECK_DECAY_RATE);
      }
      if (Math.abs(f) > 0.3 && Math.abs(displayI) < CURRENT_QUIET && insideCoil) {
        stillTimerRef.current += dtMs;
        if (stillTimerRef.current >= CHECK_MS_STILL && !checkpointsRef.current[2]) {
          checkpointsRef.current = [checkpointsRef.current[0], checkpointsRef.current[1], true];
          setCheckpoints(checkpointsRef.current);
        }
      } else {
        stillTimerRef.current = 0;
      }
      setFlux(f);
      setCurrent(displayI);
      setHistory(historyRef.current.slice());
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);
  useEffect(() => {
    const done = checkpoints[0] && checkpoints[1] && checkpoints[2];
    const score = (checkpoints[0] ? 1 : 0) + (checkpoints[1] ? 1 : 0) + (checkpoints[2] ? 1 : 0);
    context.reportProgress({ score: score / 3, completed: done });
  }, [checkpoints, context]);
  function toSvgX(clientX) {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    return (clientX - rect.left) * (SCENE_W / rect.width);
  }
  function handlePointerDown(event) {
    const svgX = toSvgX(event.clientX);
    dragOffsetRef.current = svgX - magnetXRef.current;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event) {
    if (!draggingRef.current) return;
    const svgX = toSvgX(event.clientX);
    const next = clamp(svgX - dragOffsetRef.current, MAGNET_MIN_X, MAGNET_MAX_X);
    magnetXRef.current = next;
    setMagnetX(next);
  }
  function handlePointerUp(event) {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }
  function handleFlip() {
    const next = polarityRef.current === 1 ? -1 : 1;
    polarityRef.current = next;
    setPolarity(next);
  }
  const nowSec = history.length > 0 ? history[history.length - 1].t : 0;
  function toChartX(t) {
    return (t - (nowSec - HISTORY_SECS)) / HISTORY_SECS * SCENE_W;
  }
  function toChartY(v) {
    return CHART_H / 2 - v * (CHART_H / 2 - 10);
  }
  const fluxPoints = history.map((s) => `${toChartX(s.t).toFixed(1)},${toChartY(s.flux).toFixed(1)}`).join(" ");
  const currentPoints = history.map((s) => `${toChartX(s.t).toFixed(1)},${toChartY(s.current).toFixed(1)}`).join(" ");
  const needleAngle = current * 55;
  const allDone = checkpoints[0] && checkpoints[1] && checkpoints[2];
  const leftFill = polarity === 1 ? "#dc2626" : "#2563eb";
  const rightFill = polarity === 1 ? "#2563eb" : "#dc2626";
  const leftLabel = polarity === 1 ? "N" : "S";
  const rightLabel = polarity === 1 ? "S" : "N";
  const coilTurnStep = COIL_HALF_W * 2 / (COIL_TURNS - 1);
  const coilTurns = Array.from(
    { length: COIL_TURNS },
    (_, i) => COIL_CX - COIL_HALF_W + i * coilTurnStep
  );
  const coilActive = Math.abs(current) > 0.05;
  const coilStroke = current > 0 ? "#dc2626" : "#2563eb";
  return /* @__PURE__ */ jsxs("div", { className: c("root"), children: [
    /* @__PURE__ */ jsx("div", { className: c("scene-wrap"), children: /* @__PURE__ */ jsxs(
      "svg",
      {
        ref: svgRef,
        viewBox: `0 0 ${SCENE_W} ${SCENE_H}`,
        className: c("scene"),
        role: "img",
        "aria-label": "Bar magnet next to a wire coil with a galvanometer above it. Drag the magnet to induce a current.",
        children: [
          /* @__PURE__ */ jsxs("g", { transform: `translate(${COIL_CX}, 60)`, children: [
            /* @__PURE__ */ jsx(
              "rect",
              {
                x: -48,
                y: -42,
                width: 96,
                height: 72,
                rx: 8,
                className: c("gv-body")
              }
            ),
            /* @__PURE__ */ jsx("text", { x: 0, y: -22, textAnchor: "middle", className: c("gv-title"), children: "Galvanometer" }),
            /* @__PURE__ */ jsx("line", { x1: -30, y1: 22, x2: 30, y2: 22, className: c("gv-scale") }),
            /* @__PURE__ */ jsx("text", { x: -30, y: 38, textAnchor: "middle", className: c("gv-tick"), children: "\u2212" }),
            /* @__PURE__ */ jsx("text", { x: 0, y: 38, textAnchor: "middle", className: c("gv-tick"), children: "0" }),
            /* @__PURE__ */ jsx("text", { x: 30, y: 38, textAnchor: "middle", className: c("gv-tick"), children: "+" }),
            /* @__PURE__ */ jsxs("g", { transform: `rotate(${needleAngle} 0 22)`, children: [
              /* @__PURE__ */ jsx("line", { x1: 0, y1: 22, x2: 0, y2: -14, className: c("gv-needle") }),
              /* @__PURE__ */ jsx("circle", { cx: 0, cy: 22, r: 3.5, className: c("gv-pivot") })
            ] })
          ] }),
          /* @__PURE__ */ jsx(
            "path",
            {
              d: `M ${COIL_CX - COIL_HALF_W} ${COIL_CY} L ${COIL_CX - COIL_HALF_W} 100 L ${COIL_CX - 24} 100 L ${COIL_CX - 24} 60`,
              className: c("coil-wire"),
              style: coilActive ? { stroke: coilStroke } : void 0
            }
          ),
          /* @__PURE__ */ jsx(
            "path",
            {
              d: `M ${COIL_CX + COIL_HALF_W} ${COIL_CY} L ${COIL_CX + COIL_HALF_W} 100 L ${COIL_CX + 24} 100 L ${COIL_CX + 24} 60`,
              className: c("coil-wire"),
              style: coilActive ? { stroke: coilStroke } : void 0
            }
          ),
          coilTurns.map((x, i) => /* @__PURE__ */ jsx(
            "ellipse",
            {
              cx: x,
              cy: COIL_CY,
              rx: 14,
              ry: COIL_HALF_H,
              className: c("coil-turn"),
              style: coilActive ? { stroke: coilStroke, opacity: 0.55 + Math.abs(current) * 0.45 } : void 0
            },
            i
          )),
          /* @__PURE__ */ jsx("g", { transform: `translate(${magnetX}, ${COIL_CY})`, children: [35, 62, 92, 128].map((ry) => /* @__PURE__ */ jsx(
            "ellipse",
            {
              cx: 0,
              cy: 0,
              rx: MAGNET_W / 2 + ry * 0.55,
              ry,
              className: c("field-line")
            },
            ry
          )) }),
          /* @__PURE__ */ jsxs("g", { transform: `translate(${magnetX - MAGNET_W / 2}, ${COIL_CY - MAGNET_H / 2})`, children: [
            /* @__PURE__ */ jsx(
              "rect",
              {
                x: 0,
                y: 0,
                width: MAGNET_W / 2,
                height: MAGNET_H,
                rx: 4,
                className: c("magnet-half"),
                style: { fill: leftFill }
              }
            ),
            /* @__PURE__ */ jsx(
              "rect",
              {
                x: MAGNET_W / 2,
                y: 0,
                width: MAGNET_W / 2,
                height: MAGNET_H,
                rx: 4,
                className: c("magnet-half"),
                style: { fill: rightFill }
              }
            ),
            /* @__PURE__ */ jsx(
              "text",
              {
                x: MAGNET_W / 4,
                y: MAGNET_H / 2 + 7,
                textAnchor: "middle",
                className: c("magnet-label"),
                children: leftLabel
              }
            ),
            /* @__PURE__ */ jsx(
              "text",
              {
                x: 3 * MAGNET_W / 4,
                y: MAGNET_H / 2 + 7,
                textAnchor: "middle",
                className: c("magnet-label"),
                children: rightLabel
              }
            )
          ] }),
          /* @__PURE__ */ jsx(
            "rect",
            {
              x: magnetX - MAGNET_W / 2 - 12,
              y: COIL_CY - MAGNET_H / 2 - 12,
              width: MAGNET_W + 24,
              height: MAGNET_H + 24,
              className: c("magnet-hit"),
              onPointerDown: handlePointerDown,
              onPointerMove: handlePointerMove,
              onPointerUp: handlePointerUp,
              onPointerCancel: handlePointerUp
            }
          )
        ]
      }
    ) }),
    /* @__PURE__ */ jsxs("div", { className: c("controls"), children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: c("flip-button"), onClick: handleFlip, children: "Flip magnet" }),
      /* @__PURE__ */ jsxs(
        "div",
        {
          className: c("flux-gauge"),
          "aria-label": `Magnetic flux through the coil: ${flux.toFixed(2)}`,
          children: [
            /* @__PURE__ */ jsx("div", { className: c("flux-title"), children: "Flux \u03A6" }),
            /* @__PURE__ */ jsxs("div", { className: c("flux-bar"), children: [
              /* @__PURE__ */ jsx("div", { className: c("flux-zero") }),
              /* @__PURE__ */ jsx(
                "div",
                {
                  className: c("flux-fill"),
                  style: {
                    width: `${Math.abs(flux) * 50}%`,
                    left: flux >= 0 ? "50%" : `${50 - Math.abs(flux) * 50}%`,
                    background: flux >= 0 ? "#dc2626" : "#2563eb"
                  }
                }
              )
            ] })
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxs(
      "svg",
      {
        viewBox: `0 0 ${SCENE_W} ${CHART_H}`,
        className: c("chart"),
        role: "img",
        "aria-label": "Chart of flux and induced current over the last few seconds",
        children: [
          /* @__PURE__ */ jsx(
            "line",
            {
              x1: 0,
              y1: CHART_H / 2,
              x2: SCENE_W,
              y2: CHART_H / 2,
              className: c("chart-axis")
            }
          ),
          /* @__PURE__ */ jsx("polyline", { points: fluxPoints, className: c("chart-flux") }),
          /* @__PURE__ */ jsx("polyline", { points: currentPoints, className: c("chart-current") }),
          /* @__PURE__ */ jsxs("g", { children: [
            /* @__PURE__ */ jsx("rect", { x: 12, y: 10, width: 20, height: 4, className: c("chart-flux-swatch") }),
            /* @__PURE__ */ jsx("text", { x: 38, y: 19, className: c("chart-legend-text"), children: "Flux \u03A6" }),
            /* @__PURE__ */ jsx("rect", { x: 110, y: 10, width: 20, height: 4, className: c("chart-current-swatch") }),
            /* @__PURE__ */ jsx("text", { x: 136, y: 19, className: c("chart-legend-text"), children: "Current I" })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ jsx("ul", { className: c("checklist"), children: CHECKPOINT_LABELS.map((label, i) => /* @__PURE__ */ jsxs(
      "li",
      {
        className: checkpoints[i] ? `${c("check-item")} ${c("check-done")}` : c("check-item"),
        children: [
          /* @__PURE__ */ jsx("span", { className: c("check-mark"), "aria-hidden": "true", children: checkpoints[i] ? "\u2713" : "\u25CB" }),
          /* @__PURE__ */ jsx("span", { children: label })
        ]
      },
      label
    )) }),
    allDone && /* @__PURE__ */ jsx("div", { className: c("banner"), role: "status", children: "Nice \u2014 you just demonstrated Faraday\u2019s law: the induced current follows the change in flux, not the flux itself." })
  ] });
}
var roots = /* @__PURE__ */ new WeakMap();
function mount(root, context) {
  const reactRoot = createRoot(root);
  roots.set(root, reactRoot);
  reactRoot.render(/* @__PURE__ */ jsx(Exercise, { context }));
  return () => {
    reactRoot.unmount();
    roots.delete(root);
  };
}

export { mount };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map