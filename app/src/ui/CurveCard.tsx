import { useState } from "preact/hooks";
import {
  axisTicks,
  type CurveAxis,
  curveCsv,
  curveQuantities,
  type CurvePoint,
  curveOf,
  type CurveSettings as Settings,
  defaultSeries,
  finitePoints,
  linePath,
  loadCurve,
  nearest,
  plottedPoints,
  saveCurve,
  scale,
  type Series,
  SERIES,
  type SeriesLabel,
  seriesLabel,
  seriesName,
} from "../core/curve";
import {
  type Finished,
  formatValue,
  type ResultView,
  stepOf,
} from "../core/results";
import { valueWithUnit } from "../core/units";
import { CurveSettings } from "./CurveSettings";

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

/** A tick label of an axis: the power of ten of an exponent on a log scale. */
const tickOf = (value: number, axis: CurveAxis) =>
  axis.scale === "log" ? tick(10 ** value) : tick(value);

/** The symbol of a series with its component as a subscript, e.g. −F_x. */
function SeriesSymbol({
  label,
  negate,
}: {
  label: SeriesLabel;
  negate?: boolean;
}) {
  if (!label.symbol) return <>{label.quantity}</>;
  return (
    <>
      {negate ? "−" : ""}
      {label.symbol}
      <sub>{label.component}</sub>
    </>
  );
}

/** The label of an axis: quantity, symbol, unit and a log scale. */
function AxisLabel({ label, axis }: { label: SeriesLabel; axis: CurveAxis }) {
  return (
    <>
      {label.quantity}
      {label.symbol && (
        <>
          {" "}
          {axis.negate ? "−" : ""}
          {label.symbol}
          <tspan class="sub" dy="3">
            {label.component}
          </tspan>
          <tspan dy="-3">{label.unit ? ` [${label.unit}]` : ""}</tspan>
        </>
      )}
      {axis.scale === "log" && <tspan class="muted"> (log)</tspan>}
    </>
  );
}

/** A name of a series for texts, e.g. "the displacement ux" or "the substep". */
const spoken = (label: SeriesLabel) =>
  `${label.quantity.toLowerCase()}${label.symbol ? ` ${label.symbol}${label.component}` : ""}`;

/**
 * The curve of the job of the results view (#29): by default the reaction force
 * over the displacement of the curve boundary, per substep; the quantities of both
 * axes, their scales, negated values and ranges can be chosen (#197). The current
 * substep is marked; hovering shows the values of the nearest substep, a click
 * selects it.
 */
export function CurveCard({ run, view, onChange, download }: Props) {
  const [hover, setHover] = useState<number>();
  const [table, setTable] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadCurve);
  const result = run.results[view.job];
  if (!result?.x || !result.y) return null;
  const changeSettings = (next: Settings) => {
    setSettings(next);
    saveCurve(next);
  };
  const [defaultX, defaultY] = defaultSeries(result);
  const xSeries = view.curveX ?? defaultX;
  const ySeries = view.curveY ?? defaultY;
  // the moment over the rotation of a rotation point (#98)
  const q = curveQuantities(run.commands, view.job);
  const xLabel = seriesLabel(xSeries, q);
  const yLabel = seriesLabel(ySeries, q);
  const points = curveOf(result, xSeries, ySeries);
  // the points as plotted: negated, logarithms on a log scale
  const plot = plottedPoints(points, settings);
  const shown = finitePoints(plot);
  const boundary = run.commands.find(
    (c) => c.command === "job.add" && c.name === view.job,
  );
  const curve = boundary?.command === "job.add" ? boundary.curve : undefined;
  const title =
    xSeries === defaultX && ySeries === defaultY
      ? q.title
      : `${yLabel.quantity}–${xLabel.quantity.toLowerCase()}`;

  const xAxis = axisTicks(
    shown.map((p) => p.u),
    settings.x,
  );
  const yAxis = axisTicks(
    shown.map((p) => p.f),
    settings.y,
  );
  const x = scale(xAxis.domain, [MARGIN.left, WIDTH - MARGIN.right]);
  const y = scale(yAxis.domain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const current = plot[view.substep - 1];
  const hovered = hover === undefined ? undefined : points[hover];
  const hoveredPlot = hover === undefined ? undefined : plot[hover];
  const set = (change: Partial<ResultView>) => onChange({ ...view, ...change });
  // the shown ranges in the values of the axes, for a fixed range
  const range = (domain: [number, number], axis: CurveAxis) =>
    (axis.scale === "log" ? domain.map((d) => 10 ** d) : domain) as [
      number,
      number,
    ];
  // values that a log scale cannot show, or shows by their absolute values
  const logNote = (["x", "y"] as const)
    .filter((id) => settings[id].scale === "log")
    .some((id) =>
      points.some((p) => {
        const v = id === "x" ? p.u : p.f;
        return v !== null && (settings[id].negate ? -v : v) <= 0;
      }),
    );

  const pick = (event: PointerEvent) => {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / (box.width || WIDTH)) * WIDTH;
    const py = ((event.clientY - box.top) / (box.height || HEIGHT)) * HEIGHT;
    return nearest(plot, px, x, py, y);
  };
  const marker = (point: CurvePoint | undefined, cls: string) =>
    point && point.u !== null && point.f !== null ? (
      <circle
        class={cls}
        cx={x(point.u)}
        cy={y(point.f)}
        r={5}
        clip-path={`url(#curve-clip-${view.job})`}
      />
    ) : null;
  const value = (v: number | null, label: SeriesLabel) =>
    v === null ? "–" : label.symbol ? formatValue(v) : String(v);
  const select = (id: "x" | "y", chosen: Series) => (
    <label class="curve-axis">
      <span>{id}</span>
      <select
        aria-label={id === "x" ? "Horizontal axis" : "Vertical axis"}
        value={chosen}
        onChange={(event) =>
          set({
            [id === "x" ? "curveX" : "curveY"]: event.currentTarget
              .value as Series,
          })
        }
      >
        {SERIES.map((s) => (
          <option key={s} value={s}>
            {seriesName(s, q)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section
      class="curve-card"
      aria-label={`${q.title.replace("–", "-")} curve`}
    >
      <div class="curve-head">
        <h2>
          {title}
          {curve && <span class="muted"> · {curve}</span>}
        </h2>
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
      <div class="curve-axes">
        {select("x", xSeries)}
        {select("y", ySeries)}
        <CurveSettings
          settings={settings}
          onChange={changeSettings}
          names={{
            x: seriesName(xSeries, q),
            y: seriesName(ySeries, q),
          }}
          current={{
            x: range(xAxis.domain, settings.x),
            y: range(yAxis.domain, settings.y),
          }}
        />
      </div>
      {table ? (
        <div class="curve-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Substep</th>
                {[
                  [xSeries, xLabel, settings.x],
                  [ySeries, yLabel, settings.y],
                ]
                  .filter(([s]) => s !== "substep")
                  .map(([s, label, axis]) => (
                    <th key={s as string} scope="col">
                      <SeriesSymbol
                        label={label as SeriesLabel}
                        negate={(axis as CurveAxis).negate}
                      />
                      {(label as SeriesLabel).unit &&
                        ` [${(label as SeriesLabel).unit}]`}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => {
                const sign = (v: number | null, axis: CurveAxis) =>
                  v !== null && axis.negate ? -v : v;
                return (
                  <tr
                    key={point.substep}
                    aria-current={
                      point.substep === view.substep ? "true" : undefined
                    }
                    onClick={() => set({ substep: point.substep })}
                  >
                    <td>{point.substep}</td>
                    {xSeries !== "substep" && (
                      <td>{value(sign(point.u, settings.x), xLabel)}</td>
                    )}
                    {ySeries !== "substep" && (
                      <td>{value(sign(point.f, settings.y), yLabel)}</td>
                    )}
                  </tr>
                );
              })}
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
            aria-label={`${yLabel.quantity}${yLabel.symbol ? ` ${yLabel.symbol}${yLabel.component}` : ""} over the ${spoken(xLabel)}, ${points.length} substeps`}
            onPointerMove={(event) => setHover(pick(event))}
            onPointerLeave={() => setHover(undefined)}
            onClick={(event) => {
              const index = pick(event as unknown as PointerEvent);
              if (index !== undefined) set({ substep: index + 1 });
            }}
          >
            <defs>
              <clipPath id={`curve-clip-${view.job}`}>
                <rect
                  x={MARGIN.left}
                  y={MARGIN.top - 6}
                  width={WIDTH - MARGIN.left - MARGIN.right}
                  height={HEIGHT - MARGIN.top - MARGIN.bottom + 12}
                />
              </clipPath>
            </defs>
            <g class="grid">
              {xAxis.ticks.map((t) => (
                <line
                  key={`x${t}`}
                  x1={x(t)}
                  x2={x(t)}
                  y1={y(yAxis.domain[0])}
                  y2={MARGIN.top}
                />
              ))}
              {yAxis.ticks.map((t) => (
                <line
                  key={`y${t}`}
                  class={
                    t === 0 && settings.y.scale === "linear"
                      ? "zero"
                      : undefined
                  }
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={y(t)}
                  y2={y(t)}
                />
              ))}
            </g>
            <g class="ticks">
              {xAxis.ticks.map((t) => (
                <text
                  key={`x${t}`}
                  x={x(t)}
                  y={HEIGHT - MARGIN.bottom + 14}
                  text-anchor="middle"
                >
                  {tickOf(t, settings.x)}
                </text>
              ))}
              {yAxis.ticks.map((t) => (
                <text
                  key={`y${t}`}
                  x={MARGIN.left - 6}
                  y={y(t) + 3.5}
                  text-anchor="end"
                >
                  {tickOf(t, settings.y)}
                </text>
              ))}
              <text
                class="axis-label"
                x={(MARGIN.left + WIDTH - MARGIN.right) / 2}
                y={HEIGHT - 4}
                text-anchor="middle"
              >
                <AxisLabel label={xLabel} axis={settings.x} />
              </text>
              <text class="axis-label" x={MARGIN.left} y={12}>
                <AxisLabel label={yLabel} axis={settings.y} />
              </text>
            </g>
            <path
              class="curve"
              d={linePath(plot, x, y)}
              clip-path={`url(#curve-clip-${view.job})`}
            />
            {hoveredPlot && hoveredPlot.u !== null && (
              <line
                class="crosshair"
                x1={x(hoveredPlot.u)}
                x2={x(hoveredPlot.u)}
                y1={y(yAxis.domain[0])}
                y2={MARGIN.top}
              />
            )}
            {marker(hoveredPlot, "hover-point")}
            {marker(current, "current-point")}
          </svg>
          {hovered &&
            hoveredPlot &&
            hoveredPlot.u !== null &&
            hoveredPlot.f !== null && (
              <div
                class="curve-tooltip"
                style={{
                  left: `${Math.min(x(hoveredPlot.u) + 10, WIDTH - 130)}px`,
                  top: `${Math.max(y(hoveredPlot.f) - 46, 0)}px`,
                }}
              >
                {(
                  [
                    [yLabel, hovered.f, settings.y],
                    [xLabel, hovered.u, settings.x],
                  ] as const
                )
                  .filter(([label, v]) => label.symbol && v !== null)
                  .map(([label, v, axis], i) => {
                    const text = (
                      <>
                        <SeriesSymbol label={label} negate={axis.negate} /> ={" "}
                        {valueWithUnit(
                          formatValue(axis.negate ? -v! : v!),
                          label.unit,
                        )}
                      </>
                    );
                    return (
                      <span key={i}>
                        {i === 0 ? <strong>{text}</strong> : text}
                        <br />
                      </span>
                    );
                  })}
                <span class="muted">
                  Substep {hovered.substep} ·{" "}
                  {stepOf(run, view.job, hovered.substep).name}
                </span>
              </div>
            )}
          {logNote && (
            <p class="curve-note muted">
              A log scale shows the absolute values; zeros are left out.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
