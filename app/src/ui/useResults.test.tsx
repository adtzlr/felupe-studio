// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "../core/commands";
import { JobRunner } from "../core/jobs";
import { ModelStore } from "../core/store";
import type { Cut } from "../worker/protocol";
import { useResults } from "./useResults";

/** The live settings of the run of a model with a cut of the view. */
async function liveSettings(commands: readonly Command[], cut?: Cut) {
  localStorage.clear();
  // a run that goes on
  const run = vi.fn(() => new Promise<never>(() => {}));
  const jobs = new JobRunner({ run, importResults: vi.fn(), restart: vi.fn() });
  const store = new ModelStore({
    ...(fixture as CommandList),
    commands: [...commands, ...(fixture as CommandList).commands],
  });
  const { result } = renderHook(() =>
    useResults({ store, jobs, workspace: "model", cut }),
  );
  void result.current.solve();
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  return (run.mock.calls[0] as unknown[])[2];
}

describe("the live scenes of a run (#395)", () => {
  const cut: Cut = { axis: "z", value: 0.5, half: "-" };

  it("are cut like the view", async () => {
    expect(await liveSettings([], cut)).toEqual({
      quantity: "displacement",
      method: "cells",
      cut,
    });
    expect(await liveSettings([])).toEqual({
      quantity: "displacement",
      method: "cells",
    });
  });

  it("are not cut by z of a 2D model", async () => {
    const planar = {
      command: "model.settings",
      name: "settings",
      analysis: "plane-strain",
    } as Command;
    expect(await liveSettings([planar], cut)).toEqual({
      quantity: "displacement",
      method: "cells",
    });
    expect(await liveSettings([planar], { ...cut, axis: "y" })).toEqual({
      quantity: "displacement",
      method: "cells",
      cut: { ...cut, axis: "y" },
    });
  });
});
