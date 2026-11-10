import { useState } from "preact/hooks";
import {
  AXES,
  curveCsv,
  type CurvePoint,
  curveOf,
  finitePoints,
  linePath,
  nearest,
  niceTicks,
  scale,
} from "../core/curve";
import {
  type Finished,
  formatValue,
  largestAxis,
  type ResultView,
  stepOf,
} from "../core/results";

interface Props {
  run: Finished;
  view: ResultView;
  onChange: (view: ResultView) => void;
  download: (name: string, text: string) => void;
}

// the size of the chart in pixels and the margins of the plot area
const WIDTH = 336;
const HEIGHT = 200;
const MARGIN = { top: 22, right: 14, bottom: 34, left: 50 };

/** A tick label: compact, without floating noise. */
const tick = (value: number) =>
  Math.abs(value) >= 1e4 || (value !== 0 && Math.abs(value) < 1e-3)
    ? value.toExponential(1)
    : String(Number(value.toPrecision(6)));

/**
 * The force-displacement curve of the job of the results view: the reaction force
 * over the displacement of the curve boundary, per substep. The current substep is
 * marked; hovering shows the values of the nearest substep, a click selects it.
 */
export function CurveCard({ run, view, onChange, download }: Props) {
  const [hover, setHover] = useState<number>();
  const [table, setTable] = useState(false);
  const result = run.results[view.job];
  if (!result?.x || !result.y) return null;
  const axis = view.axis ?? largestAxis(result);
  const name = AXES[axis] ?? String(axis);
  const points = curveOf(result, axis);
  const shown = finitePoints(points);
  const boundary = run.commands.find(
    (c) => c.command === "job.add" && c.name === view.job,
  );
  const curve = boundary?.command === "job.add" ? boundary.curve : undefined;

  const xTicks = niceTicks(
    Math.min(0, ...shown.map((p) => p.u)),
    Math.max(0, ...shown.map((p) => p.u)),
  );
  const yTicks = niceTicks(
    Math.min(0, ...shown.map((p) => p.f)),
    Math.max(0, ...shown.map((p) => p.f)),
  );
  const x = scale(
    [xTicks[0], xTicks[xTicks.length - 1]],
    [MARGIN.left, WIDTH - MARGIN.right],
  );
  const y = scale(
    [yTicks[0], yTicks[yTicks.length - 1]],
    [HEIGHT - MARGIN.bottom, MARGIN.top],
  );
  const current = points[view.substep - 1];
  const hovered = hover === undefined ? undefined : points[hover];
  const set = (change: Partial<ResultView>) => onChange({ ...view, ...change });

  const pick = (event: PointerEvent) => {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / (box.width || WIDTH)) * WIDTH;
    return nearest(points, px, x);
  };
  const marker = (point: CurvePoint | undefined, cls: string) =>
    point && point.u !== null && point.f !== null ? (
      <circle class={cls} cx={x(point.u)} cy={y(point.f)} r={5} />
    ) : null;

  return (
    <section class="curve-card" aria-label="Force-displacement curve">
      <div class="curve-head">
        <h2>
          Force–displacement
          {curve && <span class="muted"> · {curve}</span>}
        </h2>
        <select
          aria-label="Component"
          value={axis}
          onChange={(event) => set({ axis: Number(event.currentTarget.value) })}
        >
          {AXES.map((a, i) => (
            <option key={a} value={i}>
              {a}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="link-button"
          aria-pressed={table}
          onClick={() => setTable(!table)}
        >
          Table
        </button>
        <button
          type="button"
          class="link-button"
          title="Download the curve (all components) as CSV"
          onClick={() => download(`${view.job}.csv`, curveCsv(run, view.job))}
        >
          CSV
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Close the curve"
          onClick={() => set({ curve: false })}
        >
          ×
        </button>
      </div>
      {table ? (
        <div class="curve-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Substep</th>
                <th scope="col">
                  u<sub>{name}</sub>
                </th>
                <th scope="col">
                  F<sub>{name}</sub>
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr
                  key={point.substep}
                  aria-current={
                    point.substep === view.substep ? "true" : undefined
                  }
                  onClick={() => set({ substep: point.substep })}
                >
                  <td>{point.substep}</td>
                  <td>{point.u === null ? "–" : formatValue(point.u)}</td>
                  <td>{point.f === null ? "–" : formatValue(point.f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="curve-plot">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width={WIDTH}
            height={HEIGHT}
            role="img"
            aria-label={`Force F${name} over the displacement u${name}, ${points.length} substeps`}
            onPointerMove={(event) => setHover(pick(event))}
            onPointerLeave={() => setHover(undefined)}
            onClick={(event) => {
              const index = pick(event as unknown as PointerEvent);
              if (index !== undefined) set({ substep: index + 1 });
            }}
          >
            <g class="grid">
              {xTicks.map((t) => (
                <line
                  key={`x${t}`}
                  x1={x(t)}
                  x2={x(t)}
                  y1={y(yTicks[0])}
                  y2={MARGIN.top}
                />
              ))}
              {yTicks.map((t) => (
                <line
                  key={`y${t}`}
                  class={t === 0 ? "zero" : undefined}
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={y(t)}
                  y2={y(t)}
                />
              ))}
            </g>
            <g class="ticks">
              {xTicks.map((t) => (
                <text
                  key={`x${t}`}
                  x={x(t)}
                  y={HEIGHT - MARGIN.bottom + 14}
                  text-anchor="middle"
                >
                  {tick(t)}
                </text>
              ))}
              {yTicks.map((t) => (
                <text
                  key={`y${t}`}
                  x={MARGIN.left - 6}
                  y={y(t) + 3.5}
                  text-anchor="end"
                >
                  {tick(t)}
                </text>
              ))}
              <text
                class="axis-label"
                x={(MARGIN.left + WIDTH - MARGIN.right) / 2}
                y={HEIGHT - 4}
                text-anchor="middle"
              >
                Displacement u
                <tspan class="sub" dy="3">
                  {name}
                </tspan>
              </text>
              <text class="axis-label" x={MARGIN.left} y={12}>
                Force F
                <tspan class="sub" dy="3">
                  {name}
                </tspan>
              </text>
            </g>
            <path class="curve" d={linePath(points, x, y)} />
            {hovered && hovered.u !== null && (
              <line
                class="crosshair"
                x1={x(hovered.u)}
                x2={x(hovered.u)}
                y1={y(yTicks[0])}
                y2={MARGIN.top}
              />
            )}
            {marker(hovered, "hover-point")}
            {marker(current, "current-point")}
          </svg>
          {hovered && hovered.u !== null && hovered.f !== null && (
            <div
              class="curve-tooltip"
              style={{
                left: `${Math.min(x(hovered.u) + 10, WIDTH - 130)}px`,
                top: `${Math.max(y(hovered.f) - 46, 0)}px`,
              }}
            >
              <strong>
                F<sub>{name}</sub> = {formatValue(hovered.f)}
              </strong>
              <br />u<sub>{name}</sub> = {formatValue(hovered.u)}
              <br />
              <span class="muted">
                Substep {hovered.substep} ·{" "}
                {stepOf(run, view.job, hovered.substep).name}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
