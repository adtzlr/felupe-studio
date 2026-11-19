// @vitest-environment happy-dom
// The samples of a build are the samples of its folder (#350), e.g. those of
// SAMPLES_DIR: one list in the welcome panel, the dialog and the agent, and without
// any samples, no section and no menu item.
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
  vi.doUnmock("virtual:samples");
  vi.resetModules();
});

const ring: Sample = {
  id: "seal-ring",
  folder: "01_seal-ring",
  title: "Seal ring",
  description: "Pressed into a groove.",
  topics: ["2D"],
  files: ["ring.vtu"],
  thumbnail: false,
};

/** The modules of the app in a build with these samples. */
async function build(list: Sample[]) {
  vi.resetModules();
  vi.doMock("virtual:samples", () => ({ default: list }));
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

describe("the samples of a build (#350)", () => {
  it("are the samples of its folder", async () => {
    const { samples, Welcome, SamplesDialog, Header } = await build([ring]);
    expect(samples.SAMPLES).toEqual([ring]);
    expect(samples.HAS_SAMPLES).toBe(true);
    const onOpen = vi.fn(async () => {});
    render(
      <Welcome onImportMesh={vi.fn()} onOpen={vi.fn()} onOpenSample={onOpen} />,
    );
    const list = screen.getByRole("list", { name: "Samples" });
    expect(within(list).getByRole("heading").textContent).toBe("Seal ring");
    // a sample without a picture of its own shows the placeholder
    const picture = list.querySelector("img.sample-thumbnail");
    expect(picture?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(screen.queryByText("More samples")).toBeNull();
    fireEvent.click(within(list).getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(ring);
    cleanup();

    render(
      <SamplesDialog modified={false} onOpen={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Samples" });
    expect(
      within(dialog).getByRole("list", { name: "Samples" }).textContent,
    ).toContain("Pressed into a groove.");
    cleanup();

    expect(header(Header)).not.toBeNull();
  });

  it("load their files from the folder of the sample", async () => {
    const { samples } = await build([ring]);
    expect(
      samples.sampleUrl(ring, "ring.vtu", "https://example.org/app/"),
    ).toBe("https://example.org/app/samples/01_seal-ring/ring.vtu");
    const own = { ...ring, thumbnail: true };
    expect(samples.thumbnailUrl(own, "https://example.org/app/")).toBe(
      "https://example.org/app/samples/01_seal-ring/thumbnail.svg",
    );
  });

  it("are no section and no menu item without any samples", async () => {
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
});
