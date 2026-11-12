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

/** The objects that 2D models do not have yet. */
const NOT_IN_2D: Partial<Record<Command["command"], string>> = {
  "faceset.add": "Face sets",
  "pressure.add": "Pressures",
  "mpc.add": "Multi-point constraints",
  "point.add": "Control points",
};

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
 * the command that has them: a 2D model has 2D cells and no z components, and not
 * yet all objects of a 3D model.
 */
export function analysisProblems(
  cmd: Command,
  analysis: Analysis,
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
  const missing = NOT_IN_2D[cmd.command];
  if (missing) {
    return [
      {
        message: `${missing} are not available in 2D models yet: remove '${name}' or make the model 3D.`,
      },
    ];
  }
  const z = (message: string, field: string) => [{ message, field }];
  switch (cmd.command) {
    case "boundary.add":
      return cmd.constrained.includes("z")
        ? z(
            `boundary '${name}' constrains z, which a 2D model does not have.`,
            "constrained",
          )
        : [];
    case "load.add":
      return cmd.force[2] !== 0
        ? z(
            `point load '${name}' has a force in z, which a 2D model does not have.`,
            "force",
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
