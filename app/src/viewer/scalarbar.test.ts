// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { contourLook, DEFAULT_CONTOUR } from "../core/contour";
import { formatTick, renderScalarBar, tickParameters } from "./scalarbar";

describe("scalar bar of a contour (#139)", () => {
  it("has ticks at the limits of the bands", () => {
    expect(tickParameters(0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(tickParameters(10)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(tickParameters(6)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(formatTick(0.123456)).toBe("0.123");
    expect(formatTick(12345)).toBe("1.23e+4");
  });

  it("shows the title, the map, the ticks and the outside colors", () => {
    const root = document.createElement("div");
    const manual = {
      ...DEFAULT_CONTOUR,
      range: "manual" as const,
      min: 0,
      max: 2,
    };
    const look = contourLook(manual, [0, 2], [-1, 1]);
    renderScalarBar(root, { label: "Displacement [mm]", look });
    const bar = root.querySelector(".fv-bars.app-scalar-bar")!;
    expect(bar.querySelector(".fv-bar-title")!.textContent).toBe(
      "Displacement [mm]",
    );
    expect(
      [...bar.querySelectorAll(".fv-ticks span")].map((t) => t.textContent),
    ).toEqual(["0", "0.5", "1", "1.5", "2"]);
    const below = bar.querySelector<HTMLCanvasElement>(
      "canvas.scalar-outside.below",
    )!;
    expect(below.title).toBe("Below 0");
    expect(bar.querySelector("canvas.scalar-outside.above")).toBeNull();
    expect(bar.querySelector("canvas.scalar-gradient")).toBeTruthy();

    // drawn again, and removed without a contour
    renderScalarBar(root, {
      label: "Strain",
      look: contourLook(DEFAULT_CONTOUR, [0, 1], [0, 1]),
    });
    expect(root.querySelectorAll(".app-scalar-bar")).toHaveLength(1);
    expect(root.querySelector("canvas.scalar-outside")).toBeNull();
    renderScalarBar(root, undefined);
    expect(root.querySelector(".app-scalar-bar")).toBeNull();
  });
});
