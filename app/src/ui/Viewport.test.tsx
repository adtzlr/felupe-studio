// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../core/commands";
import { type Inspection, MeshFiles } from "../core/meshfiles";
import { ModelStore } from "../core/store";
import type { Scene, ViewerHandle } from "../vendor/felupe-viewer/viewer.js";
import { viewportContent } from "../viewer/layers";
import { CATEGORICAL } from "../viewer/palette";
import type { CreateViewer } from "../viewer/viewer";
import type { MeshSurface } from "../worker/protocol";
import { Viewport } from "./Viewport";

afterEach(cleanup);

const surface: MeshSurface = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2]),
  edges: new Uint32Array([0, 1, 1, 2, 2, 0]),
  owners: new Uint32Array([0]),
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
  const handle = {
    root: document.createElement("div"),
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
});
