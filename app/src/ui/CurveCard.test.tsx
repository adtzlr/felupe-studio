// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../core/commands";
import { startProgress } from "../core/jobs";
import type { Finished, ResultView } from "../core/results";
import { CurveCard } from "./CurveCard";

// a compression test: negative displacements and forces in z
const run: Finished = {
  state: "finished",
  commands: [
    {
      command: "job.add",
      name: "job_1",
      steps: ["step_1"],
      curve: "move",
    } as Command,
  ],
  progress: { ...startProgress(), plan: { job_1: [4] } },
  results: {
    job_1: {
      substeps: 4,
      time: 1,
      x: [
        [0, 0, 0],
        [0.01, 0, -0.1],
        [0.02, 0, -1],
        [0.03, 0, -10],
      ],
      y: [
        [0, 0, 0],
        [0, 0, -0.5],
        [0, 0, -5],
        [0, 0, -50],
      ],
    },
  },
};

function Card({ initial }: { initial?: Partial<ResultView> }) {
  const [view, setView] = useState<ResultView>({
    job: "job_1",
    substep: 4,
    quantity: "displacement",
    scale: 1,
    undeformed: true,
    curve: true,
    ...initial,
  });
  return (
    <CurveCard run={run} view={view} onChange={setView} download={vi.fn()} />
  );
}

const card = () =>
  screen.getByRole("region", { name: "Force-displacement curve" });
const ticks = (axis: "x" | "y") =>
  [...card().querySelectorAll(".ticks text:not(.axis-label)")]
    .filter((t) =>
      axis === "x"
        ? t.getAttribute("text-anchor") === "middle"
        : t.getAttribute("text-anchor") === "end",
    )
    .map((t) => t.textContent);
const labels = () =>
  [...card().querySelectorAll(".axis-label")].map((l) => l.textContent);

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("the axes of the curve card (#197)", () => {
  it("plots the largest component by default, any other on request", () => {
    render(<Card />);
    expect(card().textContent).toContain("Force–displacement · move");
    expect(labels()).toEqual(["Displacement uz", "Force Fz"]);
    const x = within(card()).getByLabelText(
      "Horizontal axis",
    ) as HTMLSelectElement;
    expect(x.value).toBe("uz");
    expect([...x.options].map((o) => o.textContent)).toEqual([
      "ux",
      "uy",
      "uz",
      "Fx",
      "Fy",
      "Fz",
      "Substep",
    ]);
    fireEvent.change(x, { target: { value: "ux" } });
    fireEvent.change(within(card()).getByLabelText("Vertical axis"), {
      target: { value: "uz" },
    });
    expect(card().textContent).toContain("Displacement–displacement");
    expect(labels()).toEqual(["Displacement ux", "Displacement uz"]);
  });

  it("negates values, uses log scales and fixed ranges, and keeps them", () => {
    const { unmount } = render(<Card />);
    fireEvent.click(
      within(card()).getByRole("button", { name: "Curve settings" }),
    );
    const popover = screen.getByRole("dialog", { name: "Curve settings" });
    const [horizontal, vertical] = within(popover).getAllByRole("group");
    expect(horizontal.textContent).toContain("Horizontal axis · uz");
    // a compression as positive values, on log scales
    fireEvent.click(within(horizontal).getByLabelText("Negate"));
    fireEvent.click(within(vertical).getByLabelText("Negate"));
    expect(labels()).toEqual(["Displacement −uz", "Force −Fz"]);
    expect(ticks("y").at(-1)).toBe("50");
    fireEvent.click(within(horizontal).getByLabelText("Log"));
    fireEvent.click(within(vertical).getByLabelText("Log"));
    expect(labels()).toEqual(["Displacement −uz (log)", "Force −Fz (log)"]);
    expect(ticks("x")).toEqual(["0.1", "1", "10"]);
    expect(ticks("y")).toEqual(["0.1", "1", "10", "100"]);
    // the zero of the first substep is left out
    expect(card().textContent).toContain("zeros are left out");
    // a fixed range starts with the shown one
    fireEvent.click(within(vertical).getByLabelText("Fixed range"));
    const [min, max] = within(vertical).getAllByRole(
      "textbox",
    ) as HTMLInputElement[];
    expect([min.value, max.value]).toEqual(["0.1", "100"]);
    fireEvent.input(min, { target: { value: "1" } });
    fireEvent.input(max, { target: { value: "10" } });
    expect(ticks("y")).toEqual(["1", "10"]);
    // a log scale needs positive limits
    fireEvent.input(min, { target: { value: "0" } });
    expect(within(vertical).getByText(/limits are positive/)).toBeTruthy();
    expect(ticks("y")).toEqual(["0.1", "1", "10", "100"]);
    // the table has the negated values
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(card()).getByRole("button", { name: "Table" }));
    const rows = within(card()).getAllByRole("row");
    expect(rows[0].textContent).toBe("Substep−uz−Fz");
    expect(rows[4].textContent).toBe("41050");
    // kept in the browser
    unmount();
    render(<Card />);
    expect(labels()).toEqual(["Displacement −uz (log)", "Force −Fz (log)"]);
    const button = within(card()).getByRole("button", {
      name: "Curve settings",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Curve settings" })).getByRole(
        "button",
        { name: "Defaults" },
      ),
    );
    expect(labels()).toEqual(["Displacement uz", "Force Fz"]);
  });

  it("shows the values of both axes when hovering", () => {
    render(<Card initial={{ curveX: "substep", curveY: "Fz" }} />);
    const svg = within(card()).getByRole("img");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 336, height: 200 }) as DOMRect;
    // the last substep at the right
    fireEvent.pointerMove(svg, { clientX: 320, clientY: 100 });
    const tooltip = card().querySelector(".curve-tooltip")!;
    expect(tooltip.textContent).toContain("Fz = -50");
    expect(tooltip.textContent).toContain("Substep 4 · step_1");
    expect(tooltip.textContent).not.toContain("uz");
  });
});
