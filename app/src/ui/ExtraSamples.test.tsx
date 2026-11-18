// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLES } from "../core/samples";
import { SamplesDialog } from "./SamplesDialog";
import { Welcome } from "./Welcome";

// the samples of EXTRA_SAMPLES_DIR of a build (#255)
vi.mock("virtual:extra-samples", () => ({
  builtIn: true,
  default: [
    {
      id: "seal-ring",
      title: "Seal ring",
      description: "Pressed into a groove.",
      topics: ["2D"],
      files: ["ring.vtu"],
    },
  ],
}));

afterEach(cleanup);

describe("extra samples (#255)", () => {
  it("are a section of their own after the built-in samples", () => {
    const onOpen = vi.fn(async () => {});
    render(
      <Welcome onImportMesh={vi.fn()} onOpen={vi.fn()} onOpenSample={onOpen} />,
    );
    const builtIn = screen.getByRole("list", { name: "Samples" });
    expect(within(builtIn).getAllByRole("button")).toHaveLength(SAMPLES.length);
    const more = screen.getByRole("list", { name: "More samples" });
    expect(within(more).getByRole("heading").textContent).toBe("Seal ring");
    fireEvent.click(within(more).getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: "seal-ring" }),
    );
    cleanup();

    render(
      <SamplesDialog modified={false} onOpen={onOpen} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Samples" });
    const list = within(dialog).getByRole("list", { name: "More samples" });
    expect(list.textContent).toContain("Pressed into a groove.");
  });
});
