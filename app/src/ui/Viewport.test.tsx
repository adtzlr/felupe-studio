// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../core/commands";
import { type Inspection, MeshFiles } from "../core/meshfiles";
import { ModelStore } from "../core/store";
import type { Scene, ViewerHandle } from "../vendor/felupe-viewer/viewer.js";
import { viewportContent } from "../viewer/layers";
import { CATEGORICAL, CONTROL_COLOR } from "../viewer/palette";
import { type CreateViewer, HIGHLIGHT } from "../viewer/viewer";
import type { MeshSurface } from "../worker/protocol";
import { Viewport } from "./Viewport";

afterEach(cleanup);

const surface: MeshSurface = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2]),
  edges: new Uint32Array([0, 1, 1, 2, 2, 0]),
  owners: new Uint32Array([0]),
  nodes: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  cells: 1,
};

const mesh = (name: string, file: string): Command => ({
  command: "mesh.import",
  name,
  file,
});

/** Mesh files whose inspection waits for `release()` of slow.vtu. */
function meshFiles() {
  let release: () => void = () => {};
  const files = new MeshFiles(async (name): Promise<Inspection> => {
    if (name === "slow.vtu") {
      await new Promise<void>((resolve) => (release = resolve));
    }
    if (name === "broken.vtu") {
      return { info: { file: name, error: "meshio could not read it." } };
    }
    const solid = {
      cell_type: "tetra",
      cells: 1,
      bounds: [
        [0, 0, 0],
        [1, 1, 0],
      ] as [number[], number[]],
      tags: [],
    };
    if (name === "tilted.vtu") {
      const positions = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      return {
        info: { file: name, solids: [solid] },
        surfaces: { tetra: { ...surface, positions } },
      };
    }
    if (name === "hex.vtu") {
      // two faces of two hexahedrons in the plane z = 0 (#142)
      const positions = new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0,
      ]);
      return {
        info: {
          file: name,
          solids: [{ ...solid, cell_type: "hexahedron", cells: 2 }],
        },
        surfaces: {
          hexahedron: {
            positions,
            triangles: new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2]),
            faces: new Uint32Array([0, 0, 1, 1]),
            edges: new Uint32Array(),
            owners: new Uint32Array([0, 0, 1, 1]),
            nodes: Float64Array.from(positions),
            cells: 2,
          },
        },
      };
    }
    if (name === "hybrid.vtu") {
      return {
        info: {
          file: name,
          solids: [solid, { ...solid, cell_type: "hexahedron" }],
        },
        surfaces: { tetra: surface, hexahedron: surface },
      };
    }
    return {
      info: { file: name, solids: [solid] },
      surfaces: { tetra: surface },
    };
  });
  return { files, release: () => release() };
}

function fakeViewer() {
  const root = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  root.appendChild(canvas);
  const handle = {
    root,
    // looking from +z onto the triangle in the xy-plane
    camera: {
      basis: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      target: [0.25, 0.25, 0],
      radius: 1,
      zoom: 1,
      parallel: true,
    },
    update: vi.fn<(scene: Scene, options?: { keepView?: boolean }) => void>(),
    setView: vi.fn<(view: string | null) => void>(),
    dispose: vi.fn(),
  };
  const create = vi.fn(() => handle as ViewerHandle);
  return { handle, create: create as unknown as CreateViewer, calls: create };
}

describe("viewport content", () => {
  it("shows the read meshes in the colors of their position", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    await files.add("b.vtu", new Uint8Array());
    const commands = [mesh("a", "a.vtu"), mesh("b", "b.vtu")];
    const all = viewportContent(commands, files, new Set());
    expect(all.meshes.map((m) => [m.name, m.color])).toEqual([
      ["a", CATEGORICAL[0]],
      ["b", CATEGORICAL[1]],
    ]);
    expect(all.message).toBeUndefined();
    // hiding a mesh does not repaint the others
    const some = viewportContent(commands, files, new Set(["a"]));
    expect(some.meshes.map((m) => [m.name, m.color])).toEqual([
      ["b", CATEGORICAL[1]],
    ]);
    expect(viewportContent(commands, files, new Set(["a", "b"])).message).toBe(
      "All meshes are hidden.",
    );
  });

  it("shows the cells of the cell type of a mesh", async () => {
    const { files } = meshFiles();
    await files.add("hybrid.vtu", new Uint8Array());
    const typed = (
      name: string,
      cell_type: "tetra" | "hexahedron",
    ): Command => ({
      command: "mesh.import",
      name,
      file: "hybrid.vtu",
      cell_type,
    });
    const content = viewportContent(
      [typed("a", "tetra"), typed("b", "hexahedron"), mesh("c", "hybrid.vtu")],
      files,
      new Set(),
    );
    // c has no cell type, but the file has two: not shown (a note explains it)
    expect(content.meshes.map((m) => m.name)).toEqual(["a", "b"]);
  });

  it("explains why nothing is shown", async () => {
    const { files, release } = meshFiles();
    expect(viewportContent([], files, new Set()).message).toBe(
      "Import a mesh to see it here.",
    );
    const missing = viewportContent([mesh("a", "a.vtu")], files, new Set());
    expect(missing.message).toMatch(/not loaded/);

    const pending = files.add("slow.vtu", new Uint8Array());
    const reading = viewportContent([mesh("a", "slow.vtu")], files, new Set());
    expect(reading).toMatchObject({
      reading: ["slow.vtu"],
      message: "Reading slow.vtu …",
    });
    release();
    await pending;

    await files.add("broken.vtu", new Uint8Array());
    expect(
      viewportContent([mesh("a", "broken.vtu")], files, new Set()).message,
    ).toMatch(/not loaded/);
  });
});

describe("Viewport", () => {
  it("creates the viewer for the first mesh and updates it", async () => {
    const { files } = meshFiles();
    const store = new ModelStore();
    const viewer = fakeViewer();
    const view = (hidden: ReadonlySet<string> = new Set()) => (
      <Viewport
        store={store}
        files={files}
        hidden={hidden}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view());
    expect(screen.getByText("Import a mesh to see it here.")).toBeTruthy();
    expect(viewer.calls).not.toHaveBeenCalled();
    expect(screen.queryByRole("toolbar")).toBeNull();

    await act(async () => {
      store.apply({ type: "add", command: mesh("a", "a.vtu") });
      await files.add("a.vtu", new Uint8Array());
    });
    rerender(view());
    await act(async () => {});
    expect(viewer.calls).toHaveBeenCalledTimes(1);
    const scene = viewer.handle.update.mock.lastCall![0];
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0]).toMatchObject({ color: CATEGORICAL[0] });
    expect(screen.queryByText("Import a mesh to see it here.")).toBeNull();

    // camera presets
    fireEvent.click(
      screen.getByRole("button", { name: "View onto the xz-plane" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(viewer.handle.setView.mock.calls).toEqual([["xz"], [null]]);

    // the nodes of the meshes (#91)
    const nodes = screen.getByRole("button", { name: "Nodes" });
    expect(nodes.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(nodes);
    await act(async () => {});
    expect(nodes.getAttribute("aria-pressed")).toBe("true");
    expect(
      viewer.handle.update.mock.lastCall![0].objects.map((o) => o.type),
    ).toEqual(["surface", "points"]);
    fireEvent.click(nodes);
    await act(async () => {});
    expect(viewer.handle.update.mock.lastCall![0].objects).toHaveLength(1);

    // the keys of the view (#129): 1 to 4 set the views, F fits, N shows the nodes;
    // not while typing
    fireEvent.keyDown(document.body, { key: "2" });
    fireEvent.keyDown(document.body, { key: "f" });
    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
    expect(viewer.handle.setView.mock.calls.slice(2)).toEqual([["xy"], [null]]);
    fireEvent.keyDown(document.body, { key: "n" });
    await act(async () => {});
    expect(nodes.getAttribute("aria-pressed")).toBe("true");
    const select = screen.getByRole("combobox", { name: "Color by" });
    fireEvent.keyDown(select, { key: "n" });
    await act(async () => {});
    expect(nodes.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document.body, { key: "N" });
    await act(async () => {});
    expect(nodes.getAttribute("aria-pressed")).toBe("false");
    expect(nodes.title).toBe("Show the nodes of the meshes (N)");

    // hiding the mesh empties the scene, the viewer stays
    rerender(view(new Set(["a"])));
    await act(async () => {});
    expect(viewer.handle.update.mock.lastCall![0].objects).toEqual([]);
    expect(screen.getByText("All meshes are hidden.")).toBeTruthy();
    expect(viewer.calls).toHaveBeenCalledTimes(1);

    // effects are cleaned up after the unmount
    cleanup();
    await vi.waitFor(() => expect(viewer.handle.dispose).toHaveBeenCalled());
  });

  it("colors by the chosen kind of object", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply([
      { type: "add", command: mesh("a", "a.vtu") },
      {
        type: "add",
        command: { command: "cellset.from_file", name: "all", mesh: "a" },
      },
    ]);
    const viewer = fakeViewer();
    render(
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        createViewer={viewer.create}
      />,
    );
    await act(async () => {});
    const select = screen.getByLabelText("Color by") as HTMLSelectElement;
    // the model has cell sets, but no sections
    expect(select.value).toBe("cellset");
    const legend = () => viewer.handle.update.mock.lastCall![0].legend;
    expect(legend()).toEqual([{ label: "all", color: CATEGORICAL[0] }]);

    fireEvent.change(select, { target: { value: "mesh" } });
    await act(async () => {});
    expect(select.value).toBe("mesh");
    expect(legend()).toBeNull();
  });

  it("shows point sets and creates one of a picked face", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply([
      { type: "add", command: mesh("a", "a.vtu") },
      {
        type: "add",
        command: {
          command: "pointset.add",
          name: "left",
          select: { axis: "x", value: 0 },
        },
      },
    ]);
    const viewer = fakeViewer();
    const create = vi.fn();
    const view = (selected?: string) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        selected={selected}
        onCreatePointSet={create}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view());
    await act(async () => {});
    const markers = () =>
      viewer.handle.update.mock.lastCall![0].objects.filter(
        (o) => o.type === "points",
      );
    // two points at x = 0, with an outline
    expect(markers().map((m) => [m.color, m.positions.size])).toEqual([
      ["#11151c", 6],
      ["#f2f4f8", 6],
    ]);
    rerender(view("left"));
    await act(async () => {});
    expect(markers()[1].color).toBe(HIGHLIGHT);

    // a click onto the triangle picks the plane z = 0
    const canvas = viewer.handle.root.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }),
      );
    });
    const panel = screen.getByRole("status", { name: "Picked face" });
    // the plane is the bound of the (flat) mesh: stored as the bound (#181)
    expect(panel.textContent).toContain("Plane z = 0 (min) · 3 points");
    fireEvent.click(screen.getByRole("button", { name: "Create point set" }));
    expect(create).toHaveBeenCalledWith({
      name: "z_min",
      select: { bound: "min", axis: "z" },
    });
    expect(screen.queryByRole("status", { name: "Picked face" })).toBeNull();
  });

  it("warns about nodes of a point set that the meshes do not have (#92)", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply([
      { type: "add", command: mesh("a", "a.vtu") },
      {
        type: "add",
        command: {
          command: "pointset.add",
          name: "corners",
          select: {
            points: [
              [1, 0, 0],
              [5, 5, 0.5],
            ],
          },
        },
      },
    ]);
    const viewer = fakeViewer();
    const view = (selected?: string) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        selected={selected}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view());
    await act(async () => {});
    // the node at (1, 0, 0) is drawn
    const points = viewer.handle.update.mock.lastCall![0].objects.filter(
      (o) => o.type === "points",
    );
    expect(points.map((m) => m.positions.size)).toEqual([3, 3]);
    expect(screen.queryByText(/no node at/)).toBeNull();
    rerender(view("corners"));
    await act(async () => {});
    expect(screen.getByText("corners: no node at (5, 5, 0.5)")).toBeTruthy();
  });

  it("picks nodes and creates a point set of them (#93)", async () => {
    localStorage.removeItem("felupe-studio.tip.pick");
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply([
      { type: "add", command: mesh("a", "a.vtu") },
      {
        type: "add",
        command: {
          command: "pointset.add",
          name: "corners",
          select: { points: [[0, 1, 0]] },
        },
      },
    ]);
    const viewer = fakeViewer();
    const create = vi.fn();
    const view = (selected?: string) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        selected={selected}
        onCreatePointSet={create}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view());
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Nodes" }));
    await act(async () => {});
    expect(screen.getByRole("note", { name: "Tip" }).textContent).toContain(
      "Click a node",
    );
    const canvas = viewer.handle.root.querySelector("canvas")!;
    // the nodes (0, 0, 0) and (1, 0, 0) are drawn at (38.6, 61.4) and (84.1, 61.4)
    const click = (x: number, y: number, shiftKey = false) =>
      act(async () => {
        canvas.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: x,
            clientY: y,
            shiftKey,
          }),
        );
      });
    await click(40, 60);
    const panel = () => screen.getByRole("status", { name: "Picked nodes" });
    expect(panel().textContent).toContain("Node (0, 0, 0)");
    // the picked node is highlighted
    const points = viewer.handle.update.mock.lastCall![0].objects.filter(
      (o) => o.type === "points",
    );
    expect(points.at(-1)).toMatchObject({ color: HIGHLIGHT });
    await click(83, 60, true);
    expect(panel().textContent).toContain("2 nodes");
    await click(39, 62, true);
    expect(panel().textContent).toContain("Node (1, 0, 0)");
    await click(40, 60, true);

    // the selected point set by nodes takes the picked nodes
    rerender(view("corners"));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Add to corners" }));
    expect(store.get("corners")).toMatchObject({
      select: {
        points: [
          [0, 1, 0],
          [1, 0, 0],
          [0, 0, 0],
        ],
      },
    });
    expect(screen.queryByRole("status", { name: "Picked nodes" })).toBeNull();

    await click(40, 60);
    fireEvent.click(screen.getByRole("button", { name: "Create point set" }));
    expect(create).toHaveBeenCalledWith({
      name: "node",
      select: { points: [[0, 0, 0]] },
    });
    // a click beside a node picks a face and clears the nodes
    await click(40, 60);
    await click(60, 45);
    expect(screen.queryByRole("status", { name: "Picked nodes" })).toBeNull();
    expect(screen.getByRole("status", { name: "Picked face" })).toBeTruthy();
  });

  it("draws control points and selects one on a click (#95)", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply([
      { type: "add", command: mesh("a", "a.vtu") },
      {
        type: "add",
        command: {
          command: "point.add",
          name: "control",
          coordinates: [-0.5, 0, 0],
        },
      },
      {
        type: "add",
        command: {
          command: "point.add",
          name: "corner",
          coordinates: [0, 0, 0],
        },
      },
    ]);
    const viewer = fakeViewer();
    const onSelect = vi.fn();
    const view = (selected?: string, hidden: string[] = []) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set(hidden)}
        selected={selected}
        onSelect={onSelect}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view());
    await act(async () => {});
    const markers = () =>
      viewer.handle.update.mock
        .lastCall![0].objects.filter((o) => o.type === "points")
        .map((m) => [m.color, m.positions.size]);
    // two control points with an outline, also without the nodes
    expect(markers()).toEqual([
      ["#11151c", 6],
      [CONTROL_COLOR, 6],
    ]);
    // (-0.5, 0, 0) is drawn at (15.9, 61.4), beside the triangle
    const canvas = viewer.handle.root.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 16, clientY: 61 }),
      );
    });
    expect(onSelect).toHaveBeenCalledWith("control");
    rerender(view("control"));
    await act(async () => {});
    expect(markers().at(-1)).toEqual([HIGHLIGHT, 3]);
    expect(screen.queryByText(/is at a node/)).toBeNull();
    // a control point at a node is merged with it
    rerender(view("corner"));
    await act(async () => {});
    expect(screen.getByText(/corner is at a node of the meshes/)).toBeTruthy();
    // hidden control points are neither drawn nor picked
    rerender(view(undefined, ["control", "corner"]));
    await act(async () => {});
    expect(markers()).toEqual([]);
  });

  it("offers control points at the center of point sets, faces and nodes (#96)", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply([
      { type: "add", command: mesh("a", "a.vtu") },
      {
        type: "add",
        command: {
          command: "pointset.add",
          name: "bottom",
          select: { axis: "y", value: 0 },
        },
      },
    ]);
    const viewer = fakeViewer();
    const create = vi.fn();
    const view = (selected?: string) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        selected={selected}
        onCreateControlPoint={create}
        createViewer={viewer.create}
        showNodes
      />
    );
    const { rerender } = render(view("bottom"));
    await act(async () => {});
    // the selected point set: (0, 0, 0) and (1, 0, 0)
    const panel = screen.getByRole("status", { name: "Selected point set" });
    expect(panel.textContent).toContain(
      "bottom · 2 points · center (0.5, 0, 0)",
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Control point at center" }),
    );
    expect(create).toHaveBeenLastCalledWith({
      name: "control_bottom",
      coordinates: [0.5, 0, 0],
    });

    // a picked face: the plane z = 0 with all three nodes
    rerender(view());
    await act(async () => {});
    const canvas = viewer.handle.root.querySelector("canvas")!;
    const click = (x: number, y: number) =>
      act(async () => {
        canvas.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
        );
      });
    await click(55, 45);
    const face = screen.getByRole("status", { name: "Picked face" });
    fireEvent.click(
      within(face).getByRole("button", { name: "Control point at center" }),
    );
    expect(create).toHaveBeenLastCalledWith({
      name: "control_z_min",
      coordinates: [0.5, 0.5, 0],
    });

    // a picked node
    await click(40, 60);
    const nodes = screen.getByRole("status", { name: "Picked nodes" });
    fireEvent.click(
      within(nodes).getByRole("button", { name: "Control point at center" }),
    );
    expect(create).toHaveBeenLastCalledWith({
      name: "control",
      coordinates: [0, 0, 0],
    });
  });

  it("draws the boundaries and load cases (#82)", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply(
      [
        mesh("a", "a.vtu"),
        {
          command: "pointset.add",
          name: "left",
          select: { axis: "x", value: 0 },
        },
        {
          command: "pointset.add",
          name: "right",
          select: { axis: "x", value: 1 },
        },
        {
          command: "boundary.add",
          name: "fixed",
          pointset: "left",
          constrained: ["x", "y"],
        },
        {
          command: "boundary.add",
          name: "move",
          pointset: "right",
          constrained: ["x"],
        },
        {
          command: "step.add",
          name: "step_1",
          ramp: { num: 2, items: [{ target: "move", end: 0.5 }] },
        },
      ].map((command) => ({
        type: "add" as const,
        command: command as Command,
      })),
    );
    const viewer = fakeViewer();
    const view = (hidden: string[], selected?: string) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set(hidden)}
        selected={selected}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view([]));
    await act(async () => {});
    const lines = () =>
      viewer.handle.update.mock
        .lastCall![0].objects.filter((o) => o.type === "lines")
        .map((o) => [o.color, o.positions.size / 6]);
    // strokes in x and y at the two points of x = 0, an arrow (five segments) at
    // the point of x = 1
    expect(lines()).toEqual([
      ["#d62728", 2],
      ["#2ca02c", 2],
      ["#f5a524", 5],
    ]);
    rerender(view(["move"], "fixed"));
    await act(async () => {});
    expect(lines()).toEqual([[HIGHLIGHT, 4]]);
  });

  it("draws symmetry planes and warns about planes without nodes (#186)", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply(
      [
        mesh("a", "a.vtu"),
        { command: "symmetry.add", name: "half", axes: ["x"] },
        { command: "symmetry.add", name: "off", axes: ["y", "z"], y: 5 },
      ].map((command) => ({
        type: "add" as const,
        command: command as Command,
      })),
    );
    const viewer = fakeViewer();
    const view = (selected?: string) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        selected={selected}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view());
    await act(async () => {});
    const lines = () =>
      viewer.handle.update.mock
        .lastCall![0].objects.filter((o) => o.type === "lines")
        .map((o) => [o.color, o.positions.size / 6]);
    // strokes in x at the two points of x = 0, in z at the three points of z = 0
    expect(lines()).toEqual([
      ["#d62728", 2],
      ["#1f77b4", 3],
    ]);
    expect(screen.queryByText(/no node of the meshes/)).toBeNull();
    rerender(view("off"));
    await act(async () => {});
    expect(lines()).toEqual([
      ["#d62728", 2],
      [HIGHLIGHT, 3],
    ]);
    expect(screen.getAllByRole("status").map((e) => e.textContent)).toEqual([
      "off: no node of the meshes on the plane y = 5",
    ]);
  });

  it("shows a tip about picking until the first pick", async () => {
    localStorage.removeItem("felupe-studio.tip.pick");
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply({ type: "add", command: mesh("a", "a.vtu") });
    const viewer = fakeViewer();
    const view = (
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        createViewer={viewer.create}
      />
    );
    render(view);
    await act(async () => {});
    expect(screen.getByRole("note", { name: "Tip" }).textContent).toContain(
      "Click faces to pick their surfaces for a point set or a face set",
    );
    const canvas = viewer.handle.root.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }),
      );
    });
    expect(screen.queryByRole("note", { name: "Tip" })).toBeNull();
    expect(localStorage.getItem("felupe-studio.tip.pick")).toBe("seen");

    // not shown again
    cleanup();
    render(view);
    await act(async () => {});
    expect(screen.queryByRole("note", { name: "Tip" })).toBeNull();
  });

  it("forgets the tip when it is dismissed", async () => {
    localStorage.removeItem("felupe-studio.tip.pick");
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply({ type: "add", command: mesh("a", "a.vtu") });
    render(
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        createViewer={fakeViewer().create}
      />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the tip" }));
    expect(screen.queryByRole("note", { name: "Tip" })).toBeNull();
    expect(localStorage.getItem("felupe-studio.tip.pick")).toBe("seen");
  });

  it("explains faces that are not normal to an axis", async () => {
    const { files } = meshFiles();
    await files.add("tilted.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply({ type: "add", command: mesh("a", "tilted.vtu") });
    const viewer = fakeViewer();
    // looking along -(1, 1, 1) onto the triangle in the plane x + y + z = 1
    const s2 = Math.SQRT1_2;
    const s6 = 1 / Math.sqrt(6);
    const s3 = 1 / Math.sqrt(3);
    Object.assign(viewer.handle.camera, {
      basis: [
        [-s2, s2, 0],
        [-s6, -s6, 2 * s6],
        [s3, s3, s3],
      ],
      target: [1 / 3, 1 / 3, 1 / 3],
    });
    render(
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        onCreatePointSet={vi.fn()}
        createViewer={viewer.create}
      />,
    );
    await act(async () => {});
    const canvas = viewer.handle.root.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }),
      );
    });
    const panel = screen.getByRole("status", { name: "Picked face" });
    expect(panel.textContent).toContain("not normal to x, y or z");
    expect(
      screen.queryByRole("button", { name: "Create point set" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear the picked face" }),
    );
    expect(screen.queryByRole("status", { name: "Picked face" })).toBeNull();
  });

  it("hides the toolbar without WebGL2", async () => {
    const { files } = meshFiles();
    await files.add("a.vtu", new Uint8Array());
    const store = new ModelStore();
    store.apply({ type: "add", command: mesh("a", "a.vtu") });
    const viewer = fakeViewer();
    delete (viewer.handle as Partial<typeof viewer.handle>).setView;
    render(
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        createViewer={viewer.create}
      />,
    );
    await act(async () => {});
    expect(viewer.calls).toHaveBeenCalled();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("creates face sets of a plane or of picked faces (#142)", async () => {
    const { files } = meshFiles();
    await files.add("hex.vtu", new Uint8Array());
    const store = new ModelStore();
    for (const command of [
      mesh("block", "hex.vtu"),
      { command: "cellset.from_file", name: "all", mesh: "block" },
      { command: "material.add", name: "rubber", model: "NeoHooke" },
      {
        command: "section.add",
        name: "body",
        cellset: "all",
        material: "rubber",
        formulation: "u",
      },
    ] as Command[]) {
      store.apply({ type: "add", command });
    }
    const viewer = fakeViewer();
    const create = vi.fn();
    const createPoints = vi.fn();
    const view = (selected?: string) => (
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        selected={selected}
        onCreateFaceSet={create}
        onCreatePointSet={createPoints}
        createViewer={viewer.create}
      />
    );
    const { rerender } = render(view());
    await act(async () => {});
    const canvas = viewer.handle.root.querySelector("canvas")!;
    const click = async (x: number, y: number, shiftKey = false) =>
      act(async () => {
        canvas.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: x,
            clientY: y,
            shiftKey,
          }),
        );
      });

    // a face: the connected surface of its section up to the feature angle, here
    // the plane z = 0 of both faces (#189)
    await click(50, 50);
    const panel = () => screen.getByRole("status", { name: "Picked faces" });
    expect(panel().textContent).toContain(
      "Plane z = 0 (min) · 2 faces of body · 6 points",
    );
    const angle = within(panel()).getByLabelText(
      "Feature angle",
    ) as HTMLSelectElement;
    expect(angle.value).toBe("30");
    fireEvent.change(angle, { target: { value: "60" } });
    expect(localStorage.getItem("felupe-studio.feature-angle")).toBe("60");
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Create face set" }),
    );
    expect(create).toHaveBeenLastCalledWith({
      name: "faces_z_min",
      section: "body",
      select: { axis: "z", value: 0 },
    });
    await click(50, 50);
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Create point set" }),
    );
    expect(createPoints).toHaveBeenLastCalledWith({
      name: "z_min",
      select: { bound: "min", axis: "z" },
    });
    localStorage.removeItem("felupe-studio.feature-angle");

    // faces picked with Shift, highlighted; a part of the plane is stored by the
    // centers of its faces
    await click(50, 50, true);
    expect(panel().textContent).toContain(
      "Part of the plane z = 0 · 1 face of body · 4 points",
    );
    await click(94, 50, true);
    expect(panel().textContent).toContain("2 faces of body");
    const surfaces = () =>
      viewer.handle.update.mock.lastCall![0].objects.filter(
        (o) => o.type === "surface" && o.color === HIGHLIGHT,
      );
    expect(surfaces()).toHaveLength(1);
    await click(94, 50, true);
    expect(panel().textContent).toContain("1 face of body");
    await click(94, 50, true);
    await click(50, 50, true);
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Create face set" }),
    );
    expect(create).toHaveBeenLastCalledWith({
      name: "faces",
      section: "body",
      select: { centers: [[1.5, 0.5, 0]] },
    });
    expect(screen.queryByRole("status", { name: "Picked faces" })).toBeNull();

    // a face set is drawn, the selected one highlighted; a center without a face
    store.apply({
      type: "add",
      command: {
        command: "faceset.add",
        name: "top",
        section: "body",
        select: {
          centers: [
            [0.5, 0.5, 0],
            [3, 0.5, 0],
          ],
        },
      } as Command,
    });
    rerender(view());
    await act(async () => {});
    const faceObjects = () =>
      viewer.handle.update.mock.lastCall![0].objects.filter(
        (o) => o.type === "surface" && o.opacity !== undefined && o.opacity < 1,
      );
    expect(faceObjects().map((o) => o.color)).toEqual(["#f2f4f8"]);
    rerender(view("top"));
    await act(async () => {});
    expect(faceObjects().map((o) => o.color)).toEqual([HIGHLIGHT]);
    expect(
      screen.getByText(/top: no face with the center \(3, 0.5, 0\)/),
    ).toBeTruthy();
  });

  it("combines picked surfaces, deselects and excludes them (#195)", async () => {
    const { files } = meshFiles();
    await files.add("hex.vtu", new Uint8Array());
    const store = new ModelStore();
    for (const command of [
      mesh("block", "hex.vtu"),
      { command: "cellset.from_file", name: "all", mesh: "block" },
      { command: "material.add", name: "rubber", model: "NeoHooke" },
      {
        command: "section.add",
        name: "body",
        cellset: "all",
        material: "rubber",
        formulation: "u",
      },
    ] as Command[]) {
      store.apply({ type: "add", command });
    }
    const viewer = fakeViewer();
    const createPoints = vi.fn();
    const createFaces = vi.fn();
    render(
      <Viewport
        store={store}
        files={files}
        hidden={new Set()}
        onCreatePointSet={createPoints}
        onCreateFaceSet={createFaces}
        createViewer={viewer.create}
      />,
    );
    await act(async () => {});
    const canvas = viewer.handle.root.querySelector("canvas")!;
    const pointer = (type: string, x: number, y: number, shiftKey = false) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 2,
          clientX: x,
          clientY: y,
          shiftKey,
        }),
      );
    const click = async (x: number, y: number, shiftKey = false) =>
      act(async () => {
        canvas.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: x,
            clientY: y,
            shiftKey,
          }),
        );
      });
    const right = async (x: number, y: number, shiftKey = false, to = x) =>
      act(async () => {
        pointer("pointerdown", x, y, shiftKey);
        pointer("pointerup", to, y, shiftKey);
      });
    const panel = () => screen.queryByRole("status", { name: "Picked faces" });
    const colors = () =>
      viewer.handle.update.mock
        .lastCall![0].objects.filter(
          (o) =>
            o.type === "surface" && o.opacity !== undefined && o.opacity < 1,
        )
        .map((o) => o.color);

    // a left click picks the plane of both faces, a right click deselects it
    await click(50, 50);
    expect(panel()!.textContent).toContain(
      "Plane z = 0 (min) · 2 faces of body",
    );
    // a drag with the right button pans and does not pick
    await right(94, 50, false, 60);
    expect(panel()).not.toBeNull();
    await right(94, 50);
    expect(panel()).toBeNull();
    // a second right click excludes it: no points to create
    await right(94, 50);
    expect(panel()!.textContent).toContain(
      "0 patches · 1 excluded · 0 faces · 0 points",
    );
    expect(colors()).toEqual(["#8b0000"]);
    const button = (name: string) =>
      within(panel()!).getByRole("button", { name }) as HTMLButtonElement;
    expect(button("Create point set").disabled).toBe(true);
    expect(button("Create face set").disabled).toBe(true);
    // a left click selects it again
    await click(50, 50);
    expect(panel()!.textContent).toContain(
      "Plane z = 0 (min) · 2 faces of body",
    );
    expect(colors()).toEqual([HIGHLIGHT]);
    // Escape clears the picked faces
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(panel()).toBeNull();

    // single faces with Shift: one selected, the other excluded, which removes the
    // points of the edge between them
    await click(50, 50, true);
    await right(94, 50, true);
    expect(panel()!.textContent).toContain(
      "Part of the plane z = 0 · 1 patch · 1 excluded · 1 face of body · 2 points",
    );
    expect(colors()).toEqual([HIGHLIGHT, "#8b0000"]);
    fireEvent.click(button("Create point set"));
    expect(createPoints).toHaveBeenLastCalledWith({
      name: "surface",
      select: {
        points: [
          [0, 0, 0],
          [0, 1, 0],
        ],
      },
    });
    expect(panel()).toBeNull();

    // *Exclude* for touch screens: taps act as right clicks, the panel stays
    await click(50, 50);
    fireEvent.click(button("Exclude"));
    expect(button("Exclude").getAttribute("aria-pressed")).toBe("true");
    await click(50, 50);
    expect(panel()!.textContent).toContain("No faces picked · 0 faces");
    await click(50, 50);
    expect(panel()!.textContent).toContain("1 excluded");
    expect(button("Exclude").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Exclude"));
    await click(50, 50);
    expect(panel()!.textContent).toContain(
      "Plane z = 0 (min) · 2 faces of body",
    );
    // the background keeps the picked faces
    await click(99, 99);
    expect(panel()).not.toBeNull();
  });
});
