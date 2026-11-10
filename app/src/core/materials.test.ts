import { describe, expect, it } from "vitest";
import { fieldSpecs, initialDraft } from "./form";
import { MATERIAL_MODELS, needsBulk } from "./materials";
import { validate } from "./validate";

describe("material registry", () => {
  it("reads the models from the schema", () => {
    expect(
      MATERIAL_MODELS.map((m) => [m.name, m.label, m.optionalBulk]),
    ).toEqual([
      ["NeoHooke", "Neo-Hooke", true],
      ["NeoHookeCompressible", "Neo-Hooke (compressible)", false],
      ["MooneyRivlin", "Mooney-Rivlin", true],
      ["LinearElasticLargeStrain", "Linear elastic (large strain)", false],
    ]);
    const mooney = MATERIAL_MODELS[2];
    expect(mooney.parameters).toMatchObject([
      { key: "C10", label: "C₁₀", required: true, default: 0.4 },
      { key: "C01", label: "C₀₁", required: true, default: 0.1 },
      { key: "bulk", label: "K", required: false },
    ]);
  });

  it("knows which materials need a bulk modulus or u-p-J", () => {
    const material = (model: string, parameters: Record<string, number>) =>
      ({ command: "material.add", name: "m", model, parameters }) as Parameters<
        typeof needsBulk
      >[0];
    expect(needsBulk(material("MooneyRivlin", { C10: 1, C01: 0 }))).toBe(true);
    expect(
      needsBulk(material("MooneyRivlin", { C10: 1, C01: 0, bulk: 5 })),
    ).toBe(false);
    expect(
      needsBulk(material("NeoHookeCompressible", { mu: 1, lmbda: 2 })),
    ).toBe(false);
  });

  it("gives forms the labels, hints and defaults of the schema", () => {
    const context = { commands: [] };
    const draft = initialDraft("material.add", context, {
      model: "MooneyRivlin",
    });
    expect(draft).toMatchObject({ parameters: { C10: 0.4, C01: 0.1 } });
    expect(validate([draft as never])).toEqual([]);
    const specs = fieldSpecs("material.add", draft);
    expect(specs.map((s) => [s.label, s.hint, s.placeholder]).slice(2)).toEqual(
      [
        ["C₁₀", "C10: Material parameter of the first invariant", undefined],
        ["C₀₁", "C01: Material parameter of the second invariant", undefined],
        [
          "K",
          "bulk: Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.",
          "none",
        ],
      ],
    );
  });
});
