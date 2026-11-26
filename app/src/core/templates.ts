// The templates of the scripts of user-defined materials (ADR 0025): files of the
// package felupe_studio, which a golden case runs, so a template that no longer runs
// fails CI. *Download template* of the properties of a material saves them (#423,
// #424).
import constitutive from "../../../python/felupe_studio/templates/material_constitutive.py?raw";
import hyperelastic from "../../../python/felupe_studio/templates/material_hyperelastic.py?raw";
import type { MaterialScript } from "./commands";

/** The template of the script of a material, by its kind. */
export const TEMPLATES: Record<MaterialScript["kind"], string> = {
  constitutive,
  // a strain energy function of tensortrax (#424)
  hyperelastic,
};
