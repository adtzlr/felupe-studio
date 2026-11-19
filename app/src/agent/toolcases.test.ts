import { describe, expect, it } from "vitest";
import cases from "../../../tests/data/tool_cases.json";
import fixture from "../../../tests/data/two_sections.json";
import type { CommandList } from "../core/commands";
import { MeshFiles } from "../core/meshfiles";
import { resolveCommands } from "../core/resolve";
import { ModelStore } from "../core/store";
import { symmetryNotes } from "../core/symmetry";
import { type AgentHost, agentTools } from "./tools";

/** The app with the commands of a case, its notes those of the symmetry planes. */
function host(): AgentHost {
  const store = new ModelStore(structuredClone(fixture) as CommandList);
  return {
    store,
    files: new MeshFiles(),
    notes: () => symmetryNotes(resolveCommands(store.commands).commands),
    modified: () => false,
    samples: async () => [],
    openSample: async () => {},
    solveBlocker: () => undefined,
    solve: async () => {},
    selection: () => ({ selected: [], workspace: "model" }),
    select: () => {},
    show: () => ({ workspace: "model" }),
    picture: async () => undefined,
    trustScript: async () => false,
  };
}

const KEYS = ["added", "updated", "deleted", "index", "errors", "notes"];

describe("the tools of the agent bridge answer like the MCP server (#258)", () => {
  // the shared cases of felupe_studio.mcp.Session (tests/data/make_tool_cases.py)
  it.each(cases.map((c) => [c.name, c] as const))("%s", async (_, c) => {
    const app = host();
    const call = agentTools(app);
    for (const step of c.steps) {
      const expected = step.answer as Record<string, unknown>;
      const answer = call(
        step.tool,
        structuredClone(step.arguments) as Record<string, unknown>,
        () => {},
      );
      if ("refused" in expected) {
        const message = expected.refused as string;
        await expect(answer).rejects.toThrow(
          message.endsWith(": ") ? new RegExp(`^${message}`) : message,
        );
        continue;
      }
      const result = (await answer) as Record<string, unknown>;
      const kept = Object.fromEntries(
        KEYS.filter((key) => key in result).map((key) => [key, result[key]]),
      );
      expect({
        ...kept,
        commands: app.store.commands.map((command) => command.name),
      }).toEqual(expected);
    }
  });
});
