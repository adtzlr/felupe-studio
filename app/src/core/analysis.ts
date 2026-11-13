// The type of the analysis of a model (#175): 3D, or 2D as plane strain or
// axisymmetric, like `analysis_problems()` of felupe_studio.commands.
import type { Command } from "./commands";

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

/** The type of the analysis of a command list (the default is 3D). */
export function analysisOf(commands: readonly Command[]): Analysis {
  const settings = commands.find((c) => c.command === "model.settings");
  return settings?.command === "model.settings"
    ? (settings.analysis ?? "3d")
    : "3d";
}

/** Whether a type of analysis is 2D. */
export const is2d = (analysis: Analysis) => analysis !== "3d";

/**
 * The problems of a command in a model of a type of analysis, with the field of
 * the command that has them: a 2D model has 2D cells and no z components, except
 * the rotation about z of the `rotations` (the rotation points of constraints).
 */
export function analysisProblems(
  cmd: Command,
  analysis: Analysis,
  rotations: ReadonlySet<string> = new Set(),
): { message: string; field?: string }[] {
  const name = cmd.name;
  const cellType =
    cmd.command === "mesh.import" || cmd.command === "mesh.script"
      ? cmd.cell_type
      : undefined;
  if (analysis === "3d") {
    return cellType && !CELLS_3D.includes(cellType)
      ? [
          {
            message: `mesh '${name}' takes ${cellType} cells, which are 2D cells: set the analysis of the settings to plane strain or axisymmetric.`,
            field: "cell_type",
          },
        ]
      : [];
  }
  if (cellType && CELLS_3D.includes(cellType)) {
    return [
      {
        message: `mesh '${name}' takes ${cellType} cells, but a 2D model has 2D cells.`,
        field: "cell_type",
      },
    ];
  }
  const z = (message: string, field: string) => [{ message, field }];
  switch (cmd.command) {
    case "boundary.add": {
      // the rotation about z of a rotation point
      if (rotations.has(cmd.pointset)) {
        const other = cmd.constrained.find((a) => a !== "z");
        return other
          ? z(
              `boundary '${name}' constrains ${other} of the rotation point '${cmd.pointset}': the rotation point of a 2D model has the rotation about z only.`,
              "constrained",
            )
          : [];
      }
      return cmd.constrained.includes("z")
        ? z(
            `boundary '${name}' constrains z, which a 2D model does not have.`,
            "constrained",
          )
        : [];
    }
    case "load.add":
      // the moment about z at a rotation point
      if (rotations.has(cmd.points)) {
        return cmd.force[0] !== 0 || cmd.force[1] !== 0
          ? z(
              `point load '${name}' at the rotation point '${cmd.points}' has a component in x or y: the rotation point of a 2D model has the moment about z only.`,
              "force",
            )
          : [];
      }
      return cmd.force[2] !== 0
        ? z(
            `point load '${name}' has a force in z, which a 2D model does not have.`,
            "force",
          )
        : [];
    case "point.add":
      return cmd.coordinates[2] !== 0
        ? z(
            `control point '${name}' has a z coordinate: the points of a 2D model are in the plane z = 0.`,
            "coordinates",
          )
        : [];
    case "mpc.add":
      if (cmd.constrained.includes("z"))
        return z(
          `constraint '${name}' connects z, which a 2D model does not have.`,
          "constrained",
        );
      return cmd.rotation !== undefined && analysis === "axisymmetric"
        ? z(
            `constraint '${name}' has a rotation point: a rotation about z is no motion of an axisymmetric model.`,
            "rotation",
          )
        : [];
    case "symmetry.add":
      return cmd.axes.includes("z")
        ? z(
            `symmetry '${name}' has a plane normal to z, which a 2D model does not have.`,
            "axes",
          )
        : [];
    case "loadcase.add": {
      const values = cmd as unknown as Record<string, unknown>;
      const key = ["axis", "second", "normal"].find((k) => values[k] === "z");
      return key
        ? z(
            `load case '${name}' has the axis z in '${key}', which a 2D model does not have.`,
            key,
          )
        : [];
    }
    case "faceset.add": {
      const select = cmd.select;
      if ("axis" in select && select.axis === "z")
        return z(
          `face set '${name}' selects by z, which a 2D model does not have.`,
          "select.axis",
        );
      if ("centers" in select && select.centers.some((c) => c[2] !== 0))
        return z(
          `face set '${name}' has centers with a z coordinate: the edges of a 2D model are in the plane z = 0.`,
          "select.centers",
        );
      return [];
    }
    case "pointset.add": {
      const select = cmd.select;
      if (("value" in select || "bound" in select) && select.axis === "z")
        return z(
          `point set '${name}' selects by z, which a 2D model does not have.`,
          "select.axis",
        );
      if ("radius" in select && select.axis !== "z")
        return z(
          `point set '${name}' selects by a radius about ${select.axis}: in a 2D model, a radius is about z (a circle in the xy-plane).`,
          "select.axis",
        );
      if ("points" in select && select.points.some((p) => p[2] !== 0))
        return z(
          `point set '${name}' has points with a z coordinate: the points of a 2D model are in the plane z = 0.`,
          "select.points",
        );
      return [];
    }
    default:
      return [];
  }
}
