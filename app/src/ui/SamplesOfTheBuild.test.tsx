// @vitest-environment happy-dom
// The samples of an app are its list samples/index.json (#350), e.g. of a build with
// SAMPLES_DIR: one list in the welcome panel, the dialog and the agent, and without
// any samples, no section and no menu item.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INDEX, type Sample } from "../core/samples";
import { ModelStore } from "../core/store";
import { App } from "./App";
import { SamplesDialog } from "./SamplesDialog";
import { Welcome } from "./Welcome";

afterEach(cleanup);

const ring: Sample = {
  id: "seal-ring",
  folder: "01_seal-ring",
  title: "Seal ring",
  description: "Pressed into a groove.",
  topics: ["2D"],
  files: ["ring.vtu"],
  thumbnail: false,
};

/** A server of the app with this list of samples, or without one. */
const server = (list?: Sample[]) =>
  vi.fn(async (url: string | URL | Request) =>
    list && String(url).endsWith(INDEX)
      ? new Response(JSON.stringify(list))
      : new Response("", { status: 404 }),
  ) as unknown as typeof fetch;

/** The item File ▸ Samples… of the header, if there is one. */
function samplesItem() {
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  const item = screen.queryByRole("menuitem", { name: "Samples…" });
  fireEvent.click(screen.getByRole("button", { name: "File" }));
  return item;
}

describe("the samples of an app (#350)", () => {
  it("are the samples of its list", async () => {
    const get = server([ring]);
    render(<App store={new ModelStore()} fetchSample={get} />);
    const list = await screen.findByRole("list", { name: "Samples" });
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/\/samples\/index\.json$/),
    );
    expect(within(list).getByRole("heading").textContent).toBe("Seal ring");
    // a sample without a picture of its own shows the placeholder
    const picture = list.querySelector("img.sample-thumbnail");
    expect(picture?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(screen.queryByText("More samples")).toBeNull();
    expect(samplesItem()).not.toBeNull();
  });

  it("are no section and no menu item without a list", async () => {
    const get = server();
    render(<App store={new ModelStore()} fetchSample={get} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: "Samples" })).toBeNull();
    expect(screen.queryByText("Start from a sample")).toBeNull();
    // still the actions and the links of the welcome panel
    const welcome = screen.getByRole("region", { name: /^Welcome/ });
    expect(
      within(welcome).getByRole("button", { name: "Import mesh" }),
    ).toBeTruthy();
    expect(samplesItem()).toBeNull();
  });

  it("are shown by the welcome panel and the dialog", () => {
    const onOpen = vi.fn(async () => {});
    render(
      <Welcome
        onImportMesh={vi.fn()}
        onOpen={vi.fn()}
        onOpenSample={onOpen}
        samples={[ring]}
      />,
    );
    const list = screen.getByRole("list", { name: "Samples" });
    fireEvent.click(within(list).getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(ring);
    cleanup();

    render(
      <SamplesDialog
        modified={false}
        samples={[ring]}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Samples" });
    expect(
      within(dialog).getByRole("list", { name: "Samples" }).textContent,
    ).toContain("Pressed into a groove.");
  });
});
