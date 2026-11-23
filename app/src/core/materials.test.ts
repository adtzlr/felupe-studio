import { describe, expect, it } from "vitest";
import { fieldSpecs, initialDraft } from "./form";
import {
  MATERIAL_MODELS,
  hasVolumetric,
  materialProblems,
  needsBulk,
} from "./materials";
import { validate } from "./validate";

describe("material registry", () => {
  it("reads the models from the schema", () => {
    expect(
      MATERIAL_MODELS.map((m) => [m.name, m.label, m.optionalBulk]),
    ).toEqual([
      ["LinearElasticSmallStrain", "Linear elastic (small strain)", false],
      ["LinearElasticLargeStrain", "Linear elastic (large strain)", false],
      ["NeoHooke", "Neo-Hooke", true],
      ["NeoHookeCompressible", "Neo-Hooke (compressible)", false],
      ["MooneyRivlin", "Mooney-Rivlin", true],
      ["Yeoh", "Yeoh", true],
      ["ThirdOrderDeformation", "Third-order deformation", true],
      ["Ogden", "Ogden", true],
      ["ArrudaBoyce", "Arruda-Boyce", true],
      ["ExtendedTube", "Extended tube", true],
      ["LinearElastic", "Linear elastic", false],
      [
        "LinearElasticPlasticIsotropicHardening",
        "Elastic-plastic, isotropic hardening",
        false,
      ],
    ]);
    // the menus of the ribbon (#136), by the kind of material (#259)
    expect(MATERIAL_MODELS.map((m) => m.group)).toEqual([
      ...Array(2).fill("Linear elasticity"),
      ...Array(8).fill("Hyperelasticity"),
      ...Array(2).fill("Strain-based elasticity"),
    ]);
    // strain-based models (#191), the elastic-plastic one with state variables
    expect(
      MATERIAL_MODELS.filter((m) => m.strain).map((m) => [m.name, m.statevars]),
    ).toEqual([
      ["LinearElastic", false],
      ["LinearElasticPlasticIsotropicHardening", true],
    ]);
    const mooney = MATERIAL_MODELS.find((m) => m.name === "MooneyRivlin")!;
    expect(mooney.parameters).toMatchObject([
      { key: "C10", label: "C₁₀", required: true, default: 0.4 },
      { key: "C01", label: "C₀₁", required: true, default: 0.1 },
      { key: "bulk", label: "K", required: false },
    ]);
  });

  it("needs as many exponents as moduli of Ogden (#136)", () => {
    const ogden = MATERIAL_MODELS.find((m) => m.name === "Ogden")!;
    expect(ogden.sameLength).toEqual(["mu", "alpha"]);
    expect(ogden.parameters.slice(0, 2)).toMatchObject([
      { key: "mu", label: "μᵢ", default: [1, 0.2] },
      { key: "alpha", label: "αᵢ", default: [1.7, -1.5] },
    ]);
    const material = (parameters: Record<string, unknown>) =>
      ({
        command: "material.add",
        name: "m",
        model: "Ogden",
        parameters,
      }) as Parameters<typeof materialProblems>[0];
    expect(materialProblems(material({ mu: [1, 0.2], alpha: [2] }))).toEqual([
      {
        message: "mu and alpha need the same number of values.",
        field: "parameters.alpha",
      },
    ]);
    expect(materialProblems(material({ mu: [1], alpha: [2] }))).toEqual([]);
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
    // the materials that the u-p-J formulation does not take (#417)
    expect(hasVolumetric(material("NeoHooke", { mu: 1 }))).toBe(false);
    expect(hasVolumetric(material("NeoHooke", { mu: 1, bulk: 5 }))).toBe(true);
    expect(
      hasVolumetric(material("MooneyRivlin", { C10: 1, C01: 0, bulk: 5 })),
    ).toBe(true);
    expect(
      hasVolumetric(material("NeoHookeCompressible", { mu: 1, lmbda: 2 })),
    ).toBe(true);
    expect(hasVolumetric(material("LinearElastic", { E: 1, nu: 0 }))).toBe(
      true,
    );
  });

  it("gives forms the labels, hints and defaults of the schema", () => {
    const context = { commands: [] };
    const draft = initialDraft("material.add", context, {
      model: "MooneyRivlin",
    });
    expect(draft).toMatchObject({ parameters: { C10: 0.4, C01: 0.1 } });
    expect(validate([draft as never])).toEqual([]);
    const specs = fieldSpecs("material.add", draft);
    // the key of a symbol is in the tooltip of the label, not in the hint (#137)
    expect(
      specs.map((s) => [s.label, s.symbolOf, s.hint, s.placeholder]).slice(2),
    ).toEqual([
      ["C₁₀", "C10", "Material parameter of the first invariant", undefined],
      ["C₀₁", "C01", "Material parameter of the second invariant", undefined],
      [
        "K",
        "bulk",
        "Bulk modulus. Without it, the material is incompressible and needs the u-p-J formulation.",
        "none",
      ],
      // the option of the Mullins effect (#346)
      [
        "Mullins effect",
        undefined,
        "Softer after the first loading, up to the largest strain energy density of the load history (Ogden-Roxburgh)",
        undefined,
      ],
    ]);
  });
});
