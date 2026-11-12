// Load cases of FElupe (fem.dof) on the merged field, like felupe_studio.loadcases
// in Python: their defaults and problems.
import type { Command } from "./commands";

export type Loadcase = Extract<Command, { command: "loadcase.add" }>;

/** Defaults of the axes of a load case (the arguments of fem.dof). */
export const LOADCASE_DEFAULTS: {
  axis: string;
  second: string;
  normal: string;
  clamped: boolean;
  symmetry: boolean;
} = { axis: "x", second: "y", normal: "y", clamped: false, symmetry: true };

type Defaults = typeof LOADCASE_DEFAULTS;

const value = <K extends keyof Defaults>(loadcase: Loadcase, key: K) =>
  ((loadcase as unknown as Record<string, unknown>)[key] ??
    LOADCASE_DEFAULTS[key]) as Defaults[K];

/** The other axis of a load case: the second axis or the normal. */
function otherAxis(loadcase: Loadcase): "second" | "normal" | undefined {
  if (loadcase.type === "biaxial" || loadcase.type === "planar")
    return "second";
  if (loadcase.type === "shear") return "normal";
  return undefined;
}

/** Problems of a load case (messages like in Python). */
export function loadcaseProblems(loadcase: Loadcase): string[] {
  const other = otherAxis(loadcase);
  if (other && value(loadcase, "axis") === value(loadcase, other)) {
    return [
      `load case '${loadcase.name}' needs different axes for 'axis' and '${other}'.`,
    ];
  }
  if (
    loadcase.type !== "shear" &&
    !value(loadcase, "symmetry") &&
    !value(loadcase, "clamped")
  ) {
    return [
      `load case '${loadcase.name}' needs symmetry planes or clamped end faces, otherwise the transversal displacements are free.`,
    ];
  }
  return [];
}

/**
 * The normals of the symmetry planes of a load case, at the zero coordinates: x, y
 * and z of a uniaxial, biaxial or planar load case, the third axis of a shear load
 * case (none without symmetry), like `symmetry_planes()` in Python (#186).
 */
export function loadcasePlanes(loadcase: Loadcase): ("x" | "y" | "z")[] {
  if (!value(loadcase, "symmetry")) return [];
  const axes = ["x", "y", "z"] as const;
  if (loadcase.type !== "shear") return [...axes];
  const used = [value(loadcase, "axis"), value(loadcase, "normal")];
  return axes.filter((a) => !used.includes(a));
}

/** A short description, e.g. `uniaxial x, clamped`. */
export function describeLoadcase(loadcase: Loadcase): string {
  const axes = [value(loadcase, "axis")];
  const other = otherAxis(loadcase);
  if (other) axes.push(value(loadcase, other));
  const flags = [
    ...(loadcase.type !== "shear" && value(loadcase, "clamped")
      ? ["clamped"]
      : []),
    ...(value(loadcase, "symmetry") ? [] : ["no symmetry"]),
  ];
  return [`${loadcase.type} ${axes.join(", ")}`, ...flags].join(" · ");
}

/** Problems of a load case at the fields of a form. */
export function loadcaseFieldErrors(
  loadcase: Loadcase,
): Record<string, string> {
  const other = otherAxis(loadcase);
  if (other && value(loadcase, "axis") === value(loadcase, other)) {
    return { [other]: "Choose an axis other than the first one." };
  }
  if (loadcaseProblems(loadcase).length > 0) {
    return { symmetry: "Use symmetry planes or clamped end faces." };
  }
  return {};
}
