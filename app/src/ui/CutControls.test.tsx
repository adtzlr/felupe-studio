// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cut } from "../worker/protocol";
import { boundsOf, CutControls, shownCut, sliderOf } from "./CutControls";

afterEach(cleanup);

describe("the slider of a cut (#395)", () => {
  it("has about a hundred steps of a power of ten", () => {
    const slider = sliderOf(-0.013, 2.4);
    expect(slider).toMatchObject({ min: -0.02, max: 2.4, step: 0.01 });
    expect(slider.round(0.30000000000000004)).toBe(0.3);
    expect(sliderOf(0, 250)).toMatchObject({ min: 0, max: 250, step: 1 });
    // a flat model
    expect(sliderOf(5, 5)).toMatchObject({ min: 5, max: 5, step: 0.01 });
  });

  it("spans the bounds of the nodes", () => {
    expect(boundsOf([])).toBeUndefined();
    expect(
      boundsOf([Float64Array.from([0, 1, 2, -1, 3, 0]), [2, 0, 1]]),
    ).toEqual({ min: [-1, 0, 0], max: [2, 3, 2] });
  });

  it("is no cut by z of a 2D model", () => {
    const cut: Cut = { axis: "z", value: 0, half: "+" };
    expect(shownCut(cut, false)).toBe(cut);
    expect(shownCut(cut, true)).toBeUndefined();
    expect(shownCut({ ...cut, axis: "y" }, true)).toEqual({
      ...cut,
      axis: "y",
    });
  });
});

describe("Cut of the view toolbar (#395)", () => {
  const bounds = { min: [0, -1, 0], max: [2, 1, 4] } as Parameters<
    typeof CutControls
  >[0]["bounds"];

  it("chooses an axis at the middle of the model, or no cut", () => {
    const onCut = vi.fn();
    render(
      <CutControls
        cut={undefined}
        onCut={onCut}
        bounds={bounds}
        planar={false}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Cut" });
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual(["No cut", "Cut x", "Cut y", "Cut z"]);
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.change(select, { target: { value: "z" } });
    expect(onCut).toHaveBeenLastCalledWith({ axis: "z", value: 2, half: "+" });
    cleanup();

    // a 2D model is not cut by z
    render(
      <CutControls
        cut={{ axis: "z", value: 1, half: "-" }}
        onCut={onCut}
        bounds={bounds}
        planar
      />,
    );
    const planar = screen.getByRole("combobox", { name: "Cut" });
    expect((planar as HTMLSelectElement).value).toBe("");
    expect([...planar.querySelectorAll("option")]).toHaveLength(3);
    fireEvent.change(planar, { target: { value: "x" } });
    expect(onCut).toHaveBeenLastCalledWith({ axis: "x", value: 1, half: "+" });
    fireEvent.change(planar, { target: { value: "" } });
    expect(onCut).toHaveBeenLastCalledWith(undefined);
  });

  it("moves the plane by its slider and its field, and hides the other half", () => {
    const onCut = vi.fn();
    const cut: Cut = { axis: "y", value: 0, half: "+" };
    const view = (value: Cut) => (
      <CutControls cut={value} onCut={onCut} bounds={bounds} planar={false} />
    );
    const { rerender } = render(view(cut));
    const slider = screen.getByRole("slider", {
      name: "Position of the cut along y",
    }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(["-1", "1", "0.01"]);
    const field = screen.getByRole("spinbutton", {
      name: "Coordinate of the cut, y",
    }) as HTMLInputElement;
    // the field follows the slider, a new cut when it stops
    fireEvent.input(slider, { target: { value: "0.37" } });
    expect(field.value).toBe("0.37");
    expect(onCut).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: "0.37" } });
    expect(onCut).toHaveBeenLastCalledWith({ ...cut, value: 0.37 });
    rerender(view({ ...cut, value: 0.37 }));
    // a typed coordinate, not a wrong one
    fireEvent.input(field, { target: { value: "-0.125" } });
    fireEvent.change(field, { target: { value: "-0.125" } });
    expect(onCut).toHaveBeenLastCalledWith({ ...cut, value: -0.125 });
    fireEvent.input(field, { target: { value: "" } });
    fireEvent.change(field, { target: { value: "" } });
    expect(onCut).toHaveBeenCalledTimes(2);
    expect(field.value).toBe("0.37");

    const half = screen.getByRole("button", { name: "Hide y >" });
    expect(half.title).toBe(
      "Hide the half y > 0.37; click to hide y < 0.37 instead",
    );
    fireEvent.click(half);
    expect(onCut).toHaveBeenLastCalledWith({ ...cut, value: 0.37, half: "-" });
    rerender(view({ ...cut, half: "-" }));
    expect(screen.getByRole("button", { name: "Hide y <" })).toBeTruthy();
  });
});
