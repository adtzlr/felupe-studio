// The templates of the scripts of user-defined materials (ADR 0025): files of the
// package felupe_studio, which a golden case runs, so a template that no longer runs
// fails CI. *Download template* of the properties of a material saves them (#423,
// #424, #425), and so does the link in the hint of *Script* of its form (#453).
import constitutive from "../../../python/felupe_studio/templates/material_constitutive.py?raw";
import hyperelastic from "../../../python/felupe_studio/templates/material_hyperelastic.py?raw";
import strain from "../../../python/felupe_studio/templates/material_strain.py?raw";
import type { MaterialScript } from "./commands";
import type { Save, Saved } from "./save";

/** The template of the script of a material, by its kind. */
export const TEMPLATES: Record<MaterialScript["kind"], string> = {
  constitutive,
  // a strain energy function of tensortrax (#424)
  hyperelastic,
  // a strain-based function of fem.MaterialStrain (#425)
  strain,
};

/** The name of a template of a material without a name of its file yet (#453). */
export const TEMPLATE_FILE = "material.py";

/**
 * Save the template of a kind under a name, with the save dialog where the browser
 * has one, else as a download: the saved file, or undefined if the dialog was
 * cancelled.
 */
export function saveTemplate(
  save: Save,
  kind: MaterialScript["kind"],
  name: string,
): Promise<Saved | undefined> {
  return save(
    { name, kind: "project" },
    () => new Blob([TEMPLATES[kind]], { type: "text/x-python" }),
  );
}
