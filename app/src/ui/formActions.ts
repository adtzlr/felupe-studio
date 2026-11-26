// The actions of the hints of the fields of a form (#453), in the dialog of a new
// object and in its properties: *Download template* in the hint of *Script* of a
// material of a file saves the template of the chosen kind (ADR 0025), so a new
// material starts from a file that runs.
import type { MaterialScript } from "../core/commands";
import type { Save } from "../core/save";
import { saveTemplate, TEMPLATE_FILE } from "../core/templates";
import type { CommandType } from "../core/validate";
import type { FieldAction } from "./useCommandForm";

type Actions = Readonly<Record<string, FieldAction>>;

/** The actions of the hints of the form of a command, by the keys of its fields. */
export function formActions(
  type: CommandType,
  save: Save,
): Actions | undefined {
  return type === "material.script" ? templateActions(save) : undefined;
}

/**
 * The action of the hint of *Script*: it saves the template of the *Kind* of the
 * form under the name in *Script*, or `material.py` if it is empty. *Script* then
 * takes the name of the saved file, also one changed in the save dialog, so the
 * material refers to it; a cancelled dialog changes nothing.
 */
function templateActions(save: Save): Actions {
  return {
    file: {
      label: "Download template",
      title:
        "A minimal script of the chosen kind, saved under the name in Script: edit it, then choose it",
      run: async (form, spec) => {
        const { kind, file } = form.draft as Partial<MaterialScript>;
        const name = file || TEMPLATE_FILE;
        let saved;
        try {
          saved = await saveTemplate(save, kind ?? "constitutive", name);
        } catch (error) {
          throw new Error(
            `The template was not saved: ${(error as Error).message}`,
            { cause: error },
          );
        }
        if (saved && saved.name !== file) form.change(spec, saved.name);
      },
    },
  };
}
