// The cards and the tooltip of the results (#312): the value under the pointer
// with the units of the model (#132), the control points of the substep (#101),
// and the minimum and the maximum of a contour (#140).
import { formatValue } from "../core/results";
import { type Units, unitOf, valueWithUnit } from "../core/units";
import type { ProbeInfo } from "../viewer/probe";
import type {
  ResultExtreme,
  ResultPoint,
  ResultScene,
} from "../worker/protocol";

/** The value under the pointer, at a position of the view. */
export interface Hover {
  x: number;
  y: number;
  /** The width of the view, to keep the tooltip inside. */
  width: number;
  /** The value of a surface, or a control point (#101). */
  info?: ProbeInfo;
  point?: ResultPoint;
  /** The position of the point of a value at the points, in the view. */
  ring?: [number, number];
}

export const value = (v: number | null) => (v === null ? "–" : formatValue(v));

/** The minimum and the maximum of a contour (#140). */
export type Extreme = "min" | "max";
export const EXTREMES: readonly Extreme[] = ["min", "max"];

/** The value of an extreme like the value under the pointer. */
export function extremeInfo(
  scene: ResultScene,
  extreme: ResultExtreme,
): ProbeInfo {
  const point = extreme.at === "point";
  return {
    label: scene.label,
    value: extreme.value,
    where: `${point ? "Node" : "Cell"} ${extreme.index} of ${extreme.section}`,
    ...(point ? { displacement: extreme.displacement } : {}),
    atPoint: point,
  };
}

/** The symbols of the values of a control point: of a rotation point φ and M. */
const symbols = (point: ResultPoint) =>
  point.rotation ? (["φ", "M"] as const) : (["u", "F"] as const);

/** The units of the values of a control point (#132); rotations are in rad. */
const pointUnits = (point: ResultPoint, units: Units | undefined) =>
  point.rotation
    ? [unitOf("rotation", units), unitOf("moment", units)]
    : [unitOf("displacement", units), unitOf("force", units)];

/** A vector, without the round-off noise of components near zero. */
const vector = (v: readonly number[] | undefined) => {
  if (!v) return "–";
  const max = Math.max(...v.map(Math.abs));
  const clean = v.map((c) => (Math.abs(c) <= 1e-9 * max ? 0 : c));
  return `(${clean.map((c) => value(c)).join(", ")})`;
};

/**
 * The tooltip of the value under the pointer, and the ring of its point, with the
 * units of the model (#132).
 */
export function ProbeTooltip({
  hover,
  units,
  unit,
}: {
  hover: Hover;
  units?: Units;
  /** The unit of the quantity of the contour. */
  unit?: string;
}) {
  const { x, y, width, info, point, ring } = hover;
  const left = x + 14 + 240 > width ? Math.max(x - 254, 0) : x + 14;
  return (
    <>
      {ring && (
        <div
          class="probe-ring"
          style={{ left: `${ring[0]}px`, top: `${ring[1]}px` }}
        />
      )}
      <div
        class="probe-tooltip"
        role="tooltip"
        style={{ left: `${left}px`, top: `${y + 14}px` }}
      >
        {point ? (
          <>
            <strong>{point.name}</strong>
            <br />
            {symbols(point)[0]} ={" "}
            {valueWithUnit(
              vector(point.displacement),
              pointUnits(point, units)[0],
            )}
            <br />
            {symbols(point)[1]} ={" "}
            {valueWithUnit(vector(point.force), pointUnits(point, units)[1])}
            <br />
            <span class="muted">
              {point.rotation ? "Rotation point" : "Control point"}
            </span>
          </>
        ) : (
          info && (
            <>
              <strong>
                {info.label} ={" "}
                {valueWithUnit(
                  value(info.value),
                  info.value === null ? undefined : unit,
                )}
              </strong>
              {info.displacement && (
                <>
                  <br />u ={" "}
                  {valueWithUnit(
                    `(${info.displacement.map((c) => value(c)).join(", ")})`,
                    unitOf("displacement", units),
                  )}
                </>
              )}
              <br />
              <span class="muted">{info.where}</span>
            </>
          )
        )}
      </div>
    </>
  );
}

/** The displacements and forces of the control points of the substep (#101). */
export function PointsCard({
  points,
  units,
  onClose,
}: {
  points: readonly ResultPoint[];
  units?: Units;
  onClose: () => void;
}) {
  return (
    <section class="points-card" aria-label="Control points">
      <div class="curve-head">
        <h2>Control points</h2>
        <button
          type="button"
          class="icon-button"
          aria-label="Close the control points"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Point</th>
            <th scope="col">Displacement</th>
            <th scope="col">Force</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.name}>
              <th scope="row">{p.name}</th>
              <td>
                {symbols(p)[0]} ={" "}
                {valueWithUnit(vector(p.displacement), pointUnits(p, units)[0])}
              </td>
              <td>
                {symbols(p)[1]} ={" "}
                {valueWithUnit(vector(p.force), pointUnits(p, units)[1])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">
        Of a rotation point: the rotation φ in rad and the moment M. All
        substeps: Export ▸ Control points (CSV).
      </p>
    </section>
  );
}
