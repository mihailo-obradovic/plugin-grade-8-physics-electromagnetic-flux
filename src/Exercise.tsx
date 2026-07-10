import { useEffect, useRef, useState } from 'react';

import { exerciseContent } from './content';
import {
  usePluginLocale,
  usePluginTranslations
} from './i18n/usePluginTranslations';

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PluginContext } from './types';

const PREFIX = 'pl-g8-physics-electromagnetic-flux-';
const c = (name: string): string => PREFIX + name;

const SCENE_W = 800;
const SCENE_H = 340;
const COIL_CX = 400;
const COIL_CY = 210;
const COIL_HALF_W = 100;
const COIL_HALF_H = 60;
const COIL_TURNS = 6;
const MAGNET_W = 120;
const MAGNET_H = 44;
const MAGNET_MIN_X = 60;
const MAGNET_MAX_X = 740;
const FLUX_SIGMA = 110;

const CHART_H = 120;
const HISTORY_SECS = 5;
const CURRENT_SMOOTH_TAU = 0.06;
const CURRENT_SCALE = 0.15;
const CURRENT_TRIGGER = 0.08;
const CURRENT_QUIET = 0.04;
const CHECK_MS_MOVE = 100;
const CHECK_MS_STILL = 600;
const CHECK_DECAY_RATE = 0.35;

type Polarity = 1 | -1;
type Checkpoints = [boolean, boolean, boolean];
type Sample = { t: number; flux: number; current: number };

function fluxAt(magnetCenter: number, polarity: Polarity): number {
  const dx = magnetCenter - COIL_CX;
  return polarity * Math.exp(-(dx * dx) / (FLUX_SIGMA * FLUX_SIGMA));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

type Props = {
  context: PluginContext;
};

export default function Exercise({ context }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const locale = usePluginLocale(context.i18n);
  const t = usePluginTranslations(context.i18n);
  const content = exerciseContent[locale];

  const [magnetX, setMagnetX] = useState(120);
  const [polarity, setPolarity] = useState<Polarity>(1);
  const [flux, setFlux] = useState(0);
  const [current, setCurrent] = useState(0);
  const [history, setHistory] = useState<Sample[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoints>([false, false, false]);

  const magnetXRef = useRef(magnetX);
  const polarityRef = useRef<Polarity>(polarity);
  const prevFluxRef = useRef(0);
  const prevMagnetXRef = useRef(magnetX);
  const smoothedIRef = useRef(0);
  const lastTimeMsRef = useRef<number | null>(null);
  const startTimeMsRef = useRef<number | null>(null);
  const historyRef = useRef<Sample[]>([]);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const stillTimerRef = useRef(0);
  const inTimerRef = useRef(0);
  const outTimerRef = useRef(0);
  const checkpointsRef = useRef<Checkpoints>([false, false, false]);

  useEffect(() => {
    function step(nowMs: number) {
      if (startTimeMsRef.current === null) startTimeMsRef.current = nowMs;
      const nowSec = (nowMs - startTimeMsRef.current) / 1000;
      const lastMs = lastTimeMsRef.current;
      const dtSec = lastMs === null ? 0 : Math.max(0.001, (nowMs - lastMs) / 1000);
      lastTimeMsRef.current = nowMs;

      const f = fluxAt(magnetXRef.current, polarityRef.current);
      const rawI = lastMs === null ? 0 : -(f - prevFluxRef.current) / dtSec;
      prevFluxRef.current = f;

      const alpha = 1 - Math.exp(-dtSec / CURRENT_SMOOTH_TAU);
      smoothedIRef.current += alpha * (rawI - smoothedIRef.current);
      const displayI = clamp(smoothedIRef.current * CURRENT_SCALE, -1, 1);

      historyRef.current.push({ t: nowSec, flux: f, current: displayI });
      const cutoff = nowSec - HISTORY_SECS;

      while (historyRef.current.length > 0 && historyRef.current[0].t < cutoff) {
        historyRef.current.shift();
      }

      const insideCoil = Math.abs(magnetXRef.current - COIL_CX) < COIL_HALF_W;
      const dtMs = dtSec * 1000;

      // By Lenz's law, pushing the magnet toward the coil produces a current
      // whose sign opposes the polarity; pulling it away produces the same
      // sign as the polarity. Using the smoothed current (rather than raw
      // per-frame velocity) makes the checkpoint robust to gaps between
      // pointer events, since I persists briefly after motion stops.
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
    const score =
      (checkpoints[0] ? 1 : 0) + (checkpoints[1] ? 1 : 0) + (checkpoints[2] ? 1 : 0);

    context.reportProgress({ score: score / 3, completed: done });
  }, [checkpoints, context]);

  function toSvgX(clientX: number): number {
    const svg = svgRef.current;

    if (!svg) return 0;

    const rect = svg.getBoundingClientRect();

    return (clientX - rect.left) * (SCENE_W / rect.width);
  }

  function handlePointerDown(event: ReactPointerEvent<SVGRectElement>) {
    const svgX = toSvgX(event.clientX);
    dragOffsetRef.current = svgX - magnetXRef.current;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGRectElement>) {
    if (!draggingRef.current) return;

    const svgX = toSvgX(event.clientX);
    const next = clamp(svgX - dragOffsetRef.current, MAGNET_MIN_X, MAGNET_MAX_X);
    magnetXRef.current = next;
    setMagnetX(next);
  }

  function handlePointerUp(event: ReactPointerEvent<SVGRectElement>) {
    draggingRef.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleFlip() {
    const next: Polarity = polarityRef.current === 1 ? -1 : 1;
    polarityRef.current = next;
    setPolarity(next);
  }

  const nowSec = history.length > 0 ? history[history.length - 1].t : 0;

  function toChartX(t: number): number {
    return ((t - (nowSec - HISTORY_SECS)) / HISTORY_SECS) * SCENE_W;
  }

  function toChartY(v: number): number {
    return CHART_H / 2 - v * (CHART_H / 2 - 10);
  }

  const fluxPoints = history
    .map((s) => `${toChartX(s.t).toFixed(1)},${toChartY(s.flux).toFixed(1)}`)
    .join(' ');
  const currentPoints = history
    .map((s) => `${toChartX(s.t).toFixed(1)},${toChartY(s.current).toFixed(1)}`)
    .join(' ');

  const needleAngle = current * 55;
  const allDone = checkpoints[0] && checkpoints[1] && checkpoints[2];

  const leftFill = polarity === 1 ? '#dc2626' : '#2563eb';
  const rightFill = polarity === 1 ? '#2563eb' : '#dc2626';
  const leftLabel = polarity === 1 ? 'N' : 'S';
  const rightLabel = polarity === 1 ? 'S' : 'N';

  const coilTurnStep = (COIL_HALF_W * 2) / (COIL_TURNS - 1);
  const coilTurns = Array.from(
    { length: COIL_TURNS },
    (_, i) => COIL_CX - COIL_HALF_W + i * coilTurnStep
  );

  const coilActive = Math.abs(current) > 0.05;
  const coilStroke = current > 0 ? '#dc2626' : '#2563eb';

  return (
    <div className={c('root')}>
      <div className={c('scene-wrap')}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
          className={c('scene')}
          role="img"
          aria-label={t('sceneAria')}
        >
          <g transform={`translate(${COIL_CX}, 60)`}>
            <rect
              x={-48}
              y={-42}
              width={96}
              height={72}
              rx={8}
              className={c('gv-body')}
            />
            <text x={0} y={-22} textAnchor="middle" className={c('gv-title')}>
              {t('galvanometer')}
            </text>
            <line x1={-30} y1={22} x2={30} y2={22} className={c('gv-scale')} />
            <text x={-30} y={38} textAnchor="middle" className={c('gv-tick')}>−</text>
            <text x={0} y={38} textAnchor="middle" className={c('gv-tick')}>0</text>
            <text x={30} y={38} textAnchor="middle" className={c('gv-tick')}>+</text>

            <g transform={`rotate(${needleAngle} 0 22)`}>
              <line x1={0} y1={22} x2={0} y2={-14} className={c('gv-needle')} />
              <circle cx={0} cy={22} r={3.5} className={c('gv-pivot')} />
            </g>
          </g>

          <path
            d={`M ${COIL_CX - COIL_HALF_W} ${COIL_CY} L ${COIL_CX - COIL_HALF_W} 100 L ${COIL_CX - 24} 100 L ${COIL_CX - 24} 60`}
            className={c('coil-wire')}
            style={coilActive ? { stroke: coilStroke } : undefined}
          />
          <path
            d={`M ${COIL_CX + COIL_HALF_W} ${COIL_CY} L ${COIL_CX + COIL_HALF_W} 100 L ${COIL_CX + 24} 100 L ${COIL_CX + 24} 60`}
            className={c('coil-wire')}
            style={coilActive ? { stroke: coilStroke } : undefined}
          />

          {coilTurns.map((x, i) => (
            <ellipse
              key={i}
              cx={x}
              cy={COIL_CY}
              rx={14}
              ry={COIL_HALF_H}
              className={c('coil-turn')}
              style={
                coilActive
                  ? { stroke: coilStroke, opacity: 0.55 + Math.abs(current) * 0.45 }
                  : undefined
              }
            />
          ))}

          <g transform={`translate(${magnetX}, ${COIL_CY})`}>
            {[35, 62, 92, 128].map((ry) => (
              <ellipse
                key={ry}
                cx={0}
                cy={0}
                rx={MAGNET_W / 2 + ry * 0.55}
                ry={ry}
                className={c('field-line')}
              />
            ))}
          </g>

          <g transform={`translate(${magnetX - MAGNET_W / 2}, ${COIL_CY - MAGNET_H / 2})`}>
            <rect
              x={0}
              y={0}
              width={MAGNET_W / 2}
              height={MAGNET_H}
              rx={4}
              className={c('magnet-half')}
              style={{ fill: leftFill }}
            />
            <rect
              x={MAGNET_W / 2}
              y={0}
              width={MAGNET_W / 2}
              height={MAGNET_H}
              rx={4}
              className={c('magnet-half')}
              style={{ fill: rightFill }}
            />
            <text
              x={MAGNET_W / 4}
              y={MAGNET_H / 2 + 7}
              textAnchor="middle"
              className={c('magnet-label')}
            >
              {leftLabel}
            </text>
            <text
              x={(3 * MAGNET_W) / 4}
              y={MAGNET_H / 2 + 7}
              textAnchor="middle"
              className={c('magnet-label')}
            >
              {rightLabel}
            </text>
          </g>

          <rect
            x={magnetX - MAGNET_W / 2 - 12}
            y={COIL_CY - MAGNET_H / 2 - 12}
            width={MAGNET_W + 24}
            height={MAGNET_H + 24}
            className={c('magnet-hit')}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </svg>
      </div>

      <div className={c('controls')}>
        <button type="button" className={c('flip-button')} onClick={handleFlip}>
          {t('flipMagnet')}
        </button>

        <div
          className={c('flux-gauge')}
          aria-label={t('fluxAria', { value: flux.toFixed(2) })}
        >
          <div className={c('flux-title')}>{t('fluxLabel')}</div>
          <div className={c('flux-bar')}>
            <div className={c('flux-zero')} />
            <div
              className={c('flux-fill')}
              style={{
                width: `${Math.abs(flux) * 50}%`,
                left: flux >= 0 ? '50%' : `${50 - Math.abs(flux) * 50}%`,
                background: flux >= 0 ? '#dc2626' : '#2563eb'
              }}
            />
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${SCENE_W} ${CHART_H}`}
        className={c('chart')}
        role="img"
        aria-label={t('chartAria')}
      >
        <line
          x1={0}
          y1={CHART_H / 2}
          x2={SCENE_W}
          y2={CHART_H / 2}
          className={c('chart-axis')}
        />
        <polyline points={fluxPoints} className={c('chart-flux')} />
        <polyline points={currentPoints} className={c('chart-current')} />

        <g>
          <rect x={12} y={10} width={20} height={4} className={c('chart-flux-swatch')} />
          <text x={38} y={19} className={c('chart-legend-text')}>
            {t('fluxLegend')}
          </text>
          <rect x={110} y={10} width={20} height={4} className={c('chart-current-swatch')} />
          <text x={136} y={19} className={c('chart-legend-text')}>
            {t('currentLegend')}
          </text>
        </g>
      </svg>

      <ul className={c('checklist')}>
        {content.checkpoints.map((label, i) => (
          <li
            key={label}
            className={
              checkpoints[i] ? `${c('check-item')} ${c('check-done')}` : c('check-item')
            }
          >
            <span className={c('check-mark')} aria-hidden="true">
              {checkpoints[i] ? '✓' : '○'}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ul>

      {allDone && (
        <div className={c('banner')} role="status">
          {t('completion')}
        </div>
      )}
    </div>
  );
}
