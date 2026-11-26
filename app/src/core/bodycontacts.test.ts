// The contact between bodies in the app (felupe-contact, #462): the tree, a new
// contact, the steps that leave out its sections and the warnings of a run.
import { describe, expect, it } from "vitest";
import fixture from "../../../tests/data/two_sections.json";
import type { Command, CommandList } from "./commands";
import { initialDraft } from "./form";
import { advance, startProgress } from "./jobs";
import { offIn } from "./steps";
import { deriveTree } from "./tree";
import { validate } from "./validate";

const commands = (fixture as CommandList).commands;

const contact = {
  command: "bodycontact.add",
  name: "touch",
  section: "section_soft",
  primary: "section_hard",
  self_contact: true,
} as Command;

describe("a contact between bodies", () => {
  it("is a contact of the tree, with its sections", () => {
    const model = [...commands, contact];
    expect(validate(model)).toEqual([]);
    const group = deriveTree(model).find((n) => n.id === "group:contact");
    expect(group?.children.map((c) => [c.label, c.detail, c.icon])).toEqual([
      ["touch", "section_soft → section_hard · self-contact", "contact"],
    ]);
  });

  it("takes the last section and the one before as its primary one", () => {
    const draft = initialDraft("bodycontact.add", { commands });
    expect([draft.name, draft.section, draft.primary]).toEqual([
      "contact_1",
      "section_soft",
      "section_hard",
    ]);
  });

  it("is off in a step that leaves out one of its sections", () => {
    const model = [...commands, contact];
    expect(offIn({ sections: ["section_soft"] }, model)).toEqual(["touch"]);
    expect(
      offIn({ sections: ["section_hard", "section_soft"] }, model),
    ).toEqual([]);
    expect(offIn({}, model)).toEqual([]);
    // one section with itself
    const own = { ...contact, primary: undefined } as Command;
    expect(offIn({ sections: ["section_soft"] }, [own])).toEqual([]);
  });

  it("keeps the warnings of a run, also those before its start", () => {
    let progress = advance(startProgress(), {
      event: "warning",
      message: "no contact will be detected",
    });
    progress = advance(progress, {
      event: "start",
      jobs: ["job_1"],
      substeps: { job_1: [5] },
    });
    expect(progress.warnings).toEqual(["no contact will be detected"]);
    expect(progress.jobs).toEqual(["job_1"]);
  });
});
