// The type of the analysis of a model (#175): 3D, or 2D as plane strain or
// axisymmetric, and the rules of a 2D model, like felupe_studio.analysis with the
// same names. A 2D model has 2D cells and no z components, except the rotation
// about z of the rotation points of the constraints. The rule of a command type
// (`PLANAR`) returns the first problem of the command.
import type { Command } from "./commands";
import type { Problem } from "./rules";

export type Analysis = "3d" | "plane-strain" | "axisymmetric";

/** The cell types of the solid cells of 3D models; 2D models have 2D cells. */
export const CELLS_3D = [
  "tetra",
  "tetra10",
  "hexahedron",
  "hexahedron20",
  "hexahedron27",
];

/** The cell types of the cells of 2D models. */
export const CELLS_2D = ["triangle", "triangle6", "quad", "quad8", "quad9"];

/**
 * The type of the analysis of a command list (the default is 3D), of the commands
 * or of other lists of them, e.g. of the dimensions of the meshes.
 */
export function analysisOf(
  commands: readonly { command: string; analysis?: Analysis }[],
): Analysis {
  const settings = commands.find((c) => c.command === "model.settings");
  return settings?.analysis ?? "3d";
}

/** Whether a type of analysis is 2D. */
export const is2d = (analysis: Analysis) => analysis !== "3d";

type CommandOf<K extends Command["command"]> = Extract<Command, { command: K }>;

/** A rule of a 2D model of a command type. */
type PlanarRule<K extends Command["command"]> = (
  cmd: CommandOf<K>,
  analysis: Analysis,
  rotations: ReadonlySet<string>,
) => Problem[];

const problem = (message: string, field: string): Problem[] => [
  { message, field },
];

/** A boundary of a rotation point constrains its rotation about z only. */
const planarBoundary: PlanarRule<"boundary.add"> = (cmd, _, rotations) => {
  if (rotations.has(cmd.pointset)) {
    const other = cmd.constrained.find((a) => a !== "z");
    return other
      ? problem(
          `boundary '${cmd.name}' constrains ${other} of the rotation point '${cmd.pointset}': the rotation point of a 2D model has the rotation about z only.`,
          "constrained",
        )
      : [];
  }
  return cmd.constrained.includes("z")
    ? problem(
        `boundary '${cmd.name}' constrains z, which a 2D model does not have.`,
        "constrained",
      )
    : [];
};

/** A point load at a rotation point is a moment about z only. */
const planarLoad: PlanarRule<"load.add"> = (cmd, _, rotations) => {
  if (rotations.has(cmd.points)) {
    return cmd.force[0] !== 0 || cmd.force[1] !== 0
      ? problem(
          `point load '${cmd.name}' at the rotation point '${cmd.points}' has a component in x or y: the rotation point of a 2D model has the moment about z only.`,
          "force",
        )
      : [];
  }
  return cmd.force[2] !== 0
    ? problem(
        `point load '${cmd.name}' has a force in z, which a 2D model does not have.`,
        "force",
      )
    : [];
};

const planarPoint: PlanarRule<"point.add"> = (cmd) =>
  cmd.coordinates[2] !== 0
    ? problem(
        `control point '${cmd.name}' has a z coordinate: the points of a 2D model are in the plane z = 0.`,
        "coordinates",
      )
    : [];

/** The planes of rigid surfaces are lines, the cylinders circles about z. */
const planarRigid: PlanarRule<"rigid.add"> = (cmd) => {
  const shape = cmd.shape as { normal?: number[]; axis?: number[] };
  if (cmd.coordinates[2] !== 0)
    return problem(
      `rigid surface '${cmd.name}' has a z coordinate: the points of a 2D model are in the plane z = 0.`,
      "coordinates",
    );
  if (shape.normal && shape.normal[2] !== 0)
    return problem(
      `rigid surface '${cmd.name}' has a normal with a z component: the planes of a 2D model are lines in the xy-plane.`,
      "shape.normal",
    );
  if (shape.axis && (shape.axis[0] !== 0 || shape.axis[1] !== 0))
    return problem(
      `rigid surface '${cmd.name}' has an axis that is not z: the cylinders of a 2D model are circles in the xy-plane.`,
      "shape.axis",
    );
  return [];
};

/** A constraint connects x and y, with a rotation point not axisymmetric. */
const planarConstraint: PlanarRule<"mpc.add"> = (cmd, analysis) => {
  if (cmd.constrained.includes("z"))
    return problem(
      `constraint '${cmd.name}' connects z, which a 2D model does not have.`,
      "constrained",
    );
  return cmd.rotation !== undefined && analysis === "axisymmetric"
    ? problem(
        `constraint '${cmd.name}' has a rotation point: a rotation about z is no motion of an axisymmetric model.`,
        "rotation",
      )
    : [];
};

/**
 * The directions of a Cartesian constraint are in the xy-plane: e1 without a z
 * component, and e2 is e1 turned by 90° about z (#421).
 */
const planarCartesian: PlanarRule<"cartesian.add"> = (cmd) => {
  if (cmd.e1[2] !== 0)
    return problem(
      `Cartesian constraint '${cmd.name}' has e1 with a z component: the directions of a 2D model are in the xy-plane.`,
      "e1",
    );
  if (cmd.e2 !== undefined)
    return problem(
      `Cartesian constraint '${cmd.name}' has e2: in a 2D model, e2 is e1 turned by 90° about z.`,
      "e2",
    );
  return cmd.constrained.includes("3")
    ? problem(
        `Cartesian constraint '${cmd.name}' constrains direction 3, which a 2D model does not have.`,
        "constrained",
      )
    : [];
};

/**
 * A cylindrical constraint of a 2D model is in polar coordinates about z, not
 * offered in an axisymmetric model (#422).
 */
const planarCylindrical: PlanarRule<"cylindrical.add"> = (cmd, analysis) => {
  if (analysis === "axisymmetric")
    return problem(
      `cylindrical constraint '${cmd.name}' is in an axisymmetric model, whose radius is y and which has no direction around its axis: hold or move the points radially (y) or axially (x) by a boundary.`,
      "points",
    );
  if ((cmd.center ?? [0, 0, 0])[2] !== 0)
    return problem(
      `cylindrical constraint '${cmd.name}' has a center with a z coordinate: the points of a 2D model are in the plane z = 0.`,
      "center",
    );
  const axis = cmd.axis ?? [0, 0, 1];
  if (axis[0] !== 0 || axis[1] !== 0)
    return problem(
      `cylindrical constraint '${cmd.name}' has an axis that is not z: the axis of a 2D model is z, with the directions r and theta in the xy-plane.`,
      "axis",
    );
  return cmd.constrained.includes("z")
    ? problem(
        `cylindrical constraint '${cmd.name}' constrains z, which a 2D model does not have.`,
        "constrained",
      )
    : [];
};

const planarSymmetry: PlanarRule<"symmetry.add"> = (cmd) =>
  cmd.axes.includes("z")
    ? problem(
        `symmetry '${cmd.name}' has a plane normal to z, which a 2D model does not have.`,
        "axes",
      )
    : [];

const planarLoadcase: PlanarRule<"loadcase.add"> = (cmd) => {
  const values = cmd as unknown as Record<string, unknown>;
  const key = ["axis", "second", "normal"].find((k) => values[k] === "z");
  return key
    ? problem(
        `load case '${cmd.name}' has the axis z in '${key}', which a 2D model does not have.`,
        key,
      )
    : [];
};

const planarFaceset: PlanarRule<"faceset.add"> = (cmd) => {
  const select = cmd.select;
  if ("axis" in select && select.axis === "z")
    return problem(
      `face set '${cmd.name}' selects by z, which a 2D model does not have.`,
      "select.axis",
    );
  if ("centers" in select && select.centers.some((c) => c[2] !== 0))
    return problem(
      `face set '${cmd.name}' has centers with a z coordinate: the edges of a 2D model are in the plane z = 0.`,
      "select.centers",
    );
  return [];
};

const planarPointset: PlanarRule<"pointset.add"> = (cmd) => {
  const select = cmd.select;
  if (("value" in select || "bound" in select) && select.axis === "z")
    return problem(
      `point set '${cmd.name}' selects by z, which a 2D model does not have.`,
      "select.axis",
    );
  if ("radius" in select && select.axis !== "z")
    return problem(
      `point set '${cmd.name}' selects by a radius about ${select.axis}: in a 2D model, a radius is about z (a circle in the xy-plane).`,
      "select.axis",
    );
  if ("points" in select && select.points.some((p) => p[2] !== 0))
    return problem(
      `point set '${cmd.name}' has points with a z coordinate: the points of a 2D model are in the plane z = 0.`,
      "select.points",
    );
  return [];
};

/** The rules of a 2D model by command type. */
export const PLANAR: { [K in Command["command"]]?: PlanarRule<K> } = {
  "boundary.add": planarBoundary,
  "load.add": planarLoad,
  "point.add": planarPoint,
  "rigid.add": planarRigid,
  "mpc.add": planarConstraint,
  "cartesian.add": planarCartesian,
  "cylindrical.add": planarCylindrical,
  "symmetry.add": planarSymmetry,
  "loadcase.add": planarLoadcase,
  "faceset.add": planarFaceset,
  "pointset.add": planarPointset,
};

/**
 * The problems of a command in a model of a type of analysis, with the field of
 * the command that has them: a 2D model has 2D cells and no z components, except
 * the rotation about z of the `rotations` (the rotation points of constraints).
 * The 2D cells of a mesh of a file or of a script in a 3D model are a construction
 * mesh (#438), without cell sets.
 */
export function analysisProblems(
  cmd: Command,
  analysis: Analysis,
  rotations: ReadonlySet<string> = new Set(),
): Problem[] {
  const cellType =
    cmd.command === "mesh.import" || cmd.command === "mesh.script"
      ? cmd.cell_type
      : undefined;
  if (analysis === "3d") return [];
  if (cellType && CELLS_3D.includes(cellType)) {
    return problem(
      `mesh '${cmd.name}' takes ${cellType} cells, but a 2D model has 2D cells.`,
      "cell_type",
    );
  }
  // the rule of the type of the command (a union of the rules of all types)
  const rule = PLANAR[cmd.command] as
    PlanarRule<typeof cmd.command> | undefined;
  return rule ? rule(cmd as never, analysis, rotations) : [];
}
