import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import {
  boundaryQuantity,
  rampedQuantity,
  resultUnit,
  unitOf,
  unitsOf,
  unitsText,
  valueWithUnit,
  withUnit,
} from "./units";

const settings = (length: "mm" | "m", force: "N" | "kN") =>
  ({
    command: "model.settings",
    name: "settings",
    units: { length, force },
  }) as Command;

describe("units of the model (#132)", () => {
  it("are those of the model settings", () => {
    expect(unitsOf([])).toBeUndefined();
    expect(unitsOf([{ command: "model.settings", name: "s" }])).toBeUndefined();
    expect(unitsOf([settings("m", "kN")])).toEqual({
      length: "m",
      force: "kN",
    });
  });

  it("give the units of the quantities", () => {
    const units = { length: "mm", force: "N" } as const;
    expect(unitOf("length", units)).toBe("mm");
    expect(unitOf("displacement", units)).toBe("mm");
    expect(unitOf("force", units)).toBe("N");
    expect(unitOf("stress", units)).toBe("MPa");
    expect(unitOf("moment", units)).toBe("N mm");
    expect(unitOf("strain", units)).toBeUndefined();
    expect(unitOf("ramped", units)).toBeUndefined();
    expect(unitOf(undefined, units)).toBeUndefined();
    // rotations are always in rad, without units nothing else has a unit
    expect(unitOf("rotation", undefined)).toBe("rad");
    expect(unitOf("stress", undefined)).toBeUndefined();
    const stress = (length: "mm" | "m", force: "N" | "kN") =>
      unitOf("stress", { length, force });
    expect([
      stress("mm", "N"),
      stress("mm", "kN"),
      stress("m", "N"),
      stress("m", "kN"),
    ]).toEqual(["MPa", "GPa", "Pa", "kPa"]);
    expect(unitsText(units)).toBe("mm · N · MPa");
  });

  it("are added to labels and values", () => {
    expect(withUnit("μ", "MPa")).toBe("μ [MPa]");
    expect(withUnit("ν", undefined)).toBe("ν");
    expect(valueWithUnit("8", "mm")).toBe("8 mm");
    expect(valueWithUnit("8", undefined)).toBe("8");
  });

  it("of the results", () => {
    const units = { length: "m", force: "N" } as const;
    expect(resultUnit("displacement", units)).toBe("m");
    expect(resultUnit("displacement_x", units)).toBe("m");
    expect(resultUnit("strain_max", units)).toBeUndefined();
    expect(resultUnit("stress_mises", units)).toBe("Pa");
    expect(resultUnit("stress_max", undefined)).toBeUndefined();
  });

  it("of boundaries and ramped values follow their targets", () => {
    const commands = [
      {
        command: "mpc.add",
        name: "glue",
        points: "top",
        center: "plate",
        constrained: ["x", "y", "z"],
        rotation: "tilt",
      },
      { command: "boundary.add", name: "shift", pointset: "plate" },
      { command: "boundary.add", name: "turn", pointset: "tilt" },
      { command: "loadcase.add", name: "tension", type: "uniaxial" },
      { command: "load.add", name: "pull", points: "plate", force: [1, 0, 0] },
    ] as unknown as Command[];
    expect(boundaryQuantity(commands, "plate")).toBe("displacement");
    expect(boundaryQuantity(commands, "tilt")).toBe("rotation");
    expect(boundaryQuantity(commands, undefined)).toBe("displacement");
    expect(rampedQuantity(commands, "shift")).toBe("displacement");
    expect(rampedQuantity(commands, "turn")).toBe("rotation");
    expect(rampedQuantity(commands, "tension")).toBe("displacement");
    // a point load is ramped by a factor
    expect(rampedQuantity(commands, "pull")).toBeUndefined();
    expect(rampedQuantity(commands, undefined)).toBeUndefined();
  });
});
