// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { LabelLayer } from "./labels";

describe("labels at points of the view (#140)", () => {
  it("are buttons at their projected points, moved with the camera", () => {
    const root = document.createElement("div");
    const clicks = vi.fn();
    root.addEventListener("click", clicks);
    let shift = 0;
    const project = vi.fn((p: number[]) =>
      p[2] < 0 ? undefined : ([p[0] + shift, p[1]] as [number, number]),
    );
    const layer = new LabelLayer(root, project);
    const select = vi.fn();
    layer.set([
      {
        id: "max",
        position: [10, 20, 0],
        text: "Max. 3 MPa",
        detail: ["Cell 4 of body"],
        tone: "max",
        onClick: select,
      },
      { id: "min", position: [0, 0, -1], text: "Min. 1 MPa", tone: "min" },
    ]);
    const labels = root.querySelectorAll<HTMLButtonElement>(
      ".fv-labels .fv-label",
    );
    expect([...labels].map((l) => l.textContent)).toEqual([
      "Max. 3 MPa",
      "Min. 1 MPa",
    ]);
    expect(labels[0].className).toBe("fv-label max");
    expect(labels[0].style.transform).toBe("translate(10px, 20px)");
    // behind the camera
    expect(labels[1].hidden).toBe(true);

    // a click selects, and is not a click into the view
    labels[0].click();
    expect(select).toHaveBeenCalledTimes(1);
    expect(clicks).not.toHaveBeenCalled();

    // expanded with the details; the camera moved
    shift = 5;
    layer.set([
      {
        id: "max",
        position: [10, 20, 0],
        text: "Max. 3 MPa",
        detail: ["Cell 4 of body"],
        expanded: true,
      },
    ]);
    const [label] = root.querySelectorAll<HTMLButtonElement>(".fv-label");
    expect(label).toBe(labels[0]);
    expect([...label.children].map((c) => c.textContent)).toEqual([
      "Max. 3 MPa",
      "Cell 4 of body",
    ]);
    expect(label.getAttribute("aria-expanded")).toBe("true");
    expect(label.style.transform).toBe("translate(15px, 20px)");
    expect(root.querySelectorAll(".fv-label")).toHaveLength(1);

    layer.set([]);
    expect(root.querySelectorAll(".fv-label")).toHaveLength(0);
    layer.dispose();
    expect(root.querySelector(".fv-labels")).toBeNull();
  });

  it("take the nearest anchor not behind faces once the camera rests", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    const project = (p: number[]) => [p[0], p[1]] as [number, number];
    // the camera looks along -z: a larger z is nearer; hidden: the given anchors
    let hidden = [1];
    const occluded = vi.fn((p: number[]) => hidden.includes(p[2]));
    const layer = new LabelLayer(root, project, {
      depth: (p) => -p[2],
      occluded,
    });
    const label = {
      id: "max",
      position: [0, 0, 0] as [number, number, number],
      anchors: [
        [1, 2, 0],
        [3, 4, 1],
        [5, 6, -1],
      ] as [number, number, number][],
      text: "Max. 3 MPa",
    };
    layer.set([label]);
    const [element] = root.querySelectorAll<HTMLButtonElement>(".fv-label");
    // the nearest while the camera moves
    expect(element.style.transform).toBe("translate(3px, 4px)");
    vi.advanceTimersByTime(200);
    // the nearest one in front of the faces
    expect(element.style.transform).toBe("translate(1px, 2px)");
    expect(element.classList.contains("occluded")).toBe(false);

    // all of them behind faces: the nearest one, dimmed (kept while it changes)
    hidden = [1, 0, -1];
    layer.set([{ ...label, expanded: true }]);
    vi.advanceTimersByTime(200);
    expect(element.style.transform).toBe("translate(3px, 4px)");
    expect(element.classList.contains("occluded")).toBe(true);
    layer.set([{ ...label }]);
    expect(element.classList.contains("occluded")).toBe(true);
    layer.dispose();
    vi.useRealTimers();
  });
});
