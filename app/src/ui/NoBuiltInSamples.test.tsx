// @vitest-environment happy-dom
// A build without the built-in samples (BUILT_IN_SAMPLES=false, #279): the extra
// samples are the samples, and without any, there is no section and no menu item.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sample } from "../core/samples";
import { ModelStore } from "../core/store";

afterEach(() => {
  cleanup();
  vi.doUnmock("virtual:extra-samples");
  vi.resetModules();
});

const ring: Sample = {
  id: "seal-ring",
  title: "Seal ring",
  description: "Pressed into a groove.",
  topics: ["2D"],
  files: ["ring.vtu"],
};

/** The modules of the app in a build with these extra samples only. */
async function build(extra: Sample[]) {
  vi.resetModules();
  vi.doMock("virtual:extra-samples", () => ({
    builtIn: false,
    default: extra,
  }));
  return {
    samples: await import("../core/samples"),
    Welcome: (await import("./Welcome")).Welcome,
    SamplesDialog: (await import("./SamplesDialog")).SamplesDialog,
    Header: (await import("./Header")).Header,
  };
}

function header(Header: Awaited<ReturnType<typeof build>>["Header"]) {
  render(
    <Header
      store={new ModelStore()}
      fileName="model.felupe.json"
      modified={false}
      onNew={vi.fn()}
      onOpen={vi.fn()}
      onSamples={vi.fn()}
      onSave={vi.fn()}
      onSaveAs={vi.fn()}
      onRename={vi.fn()}
      onShortcuts={vi.fn()}
      onAbout={vi.fn()}
      browserOpen={false}
      onBrowser={vi.fn()}
      exports={[]}
      solve={{ running: false, onSolve: vi.fn(), onCancel: vi.fn() }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  return screen.queryByRole("menuitem", { name: "Samples…" });
}

describe("a build without the built-in samples (#279)", () => {
  it("shows the extra samples as the samples", async () => {
    const { samples, Welcome, SamplesDialog, Header } = await build([ring]);
    expect(samples.SAMPLES).toEqual([]);
    expect(samples.HAS_SAMPLES).toBe(true);
    render(
      <Welcome
        onImportMesh={vi.fn()}
        onOpen={vi.fn()}
        onOpenSample={vi.fn()}
      />,
    );
    const list = screen.getByRole("list", { name: "Samples" });
    expect(within(list).getByRole("heading").textContent).toBe("Seal ring");
    expect(screen.queryByRole("list", { name: "More samples" })).toBeNull();
    expect(screen.getByText("Start from a sample")).toBeTruthy();
    cleanup();

    render(
      <SamplesDialog modified={false} onOpen={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Samples" });
    expect(
      within(dialog).getByRole("list", { name: "Samples" }).textContent,
    ).toContain("Pressed into a groove.");
    expect(within(dialog).queryByText("More samples")).toBeNull();
    cleanup();

    expect(header(Header)).not.toBeNull();
  });

  it("has no samples section and no menu item without any samples", async () => {
    const { samples, Welcome, Header } = await build([]);
    expect(samples.HAS_SAMPLES).toBe(false);
    render(
      <Welcome
        onImportMesh={vi.fn()}
        onOpen={vi.fn()}
        onOpenSample={vi.fn()}
      />,
    );
    expect(screen.queryByRole("list", { name: "Samples" })).toBeNull();
    expect(screen.queryByText("Start from a sample")).toBeNull();
    // still the actions and the links of the welcome panel
    expect(screen.getByRole("button", { name: "Import mesh" })).toBeTruthy();
    cleanup();

    expect(header(Header)).toBeNull();
  });

  it("puts the extra samples after the built-in ones by default", async () => {
    const { sampleSections } = await import("../core/samples");
    const builtIn = [{ ...ring, id: "bushing", title: "Bushing" }];
    expect(sampleSections(builtIn, [ring])).toEqual({
      samples: builtIn,
      more: [ring],
    });
    expect(sampleSections([], [ring])).toEqual({ samples: [ring], more: [] });
    expect(sampleSections([], [])).toEqual({ samples: [], more: [] });
  });
});
