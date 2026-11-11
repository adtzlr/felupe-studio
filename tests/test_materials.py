import inspect
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio.materials import material_call, models, needs_bulk, problems

DOCS = Path(__file__).parents[1] / "docs" / "commands.md"
MODELS = list(models())


def create(model, **changes):
    """The material of a model with its defaults (and a bulk modulus if optional)."""
    parameters = {p.key: p.default for p in models()[model].parameters if p.default}
    if models()[model].optional_bulk:
        parameters["bulk"] = 5000.0
    parameters.update(changes)
    func, args, volumetric = material_call({"model": model, "parameters": parameters})
    umat = eval(f"{func}({', '.join(args)})", {"fem": fem})
    if volumetric:
        umat = umat & eval(f"fem.Volumetric({', '.join(volumetric)})", {"fem": fem})
    return umat


def test_models():
    assert MODELS == [
        "NeoHooke",
        "NeoHookeCompressible",
        "MooneyRivlin",
        "Yeoh",
        "ThirdOrderDeformation",
        "Ogden",
        "ArrudaBoyce",
        "ExtendedTube",
        "LinearElasticLargeStrain",
    ]


@pytest.mark.parametrize("name", MODELS)
def test_parameters_of_felupe(name):
    model = models()[name]
    call = eval(model.call, {"fem": fem})
    keys = set(inspect.signature(call).parameters)
    for p in model.parameters:
        assert p.label and p.description
        assert p.volumetric or p.key in keys, f"{name}: {p.key} not in {keys}"
        assert p.required == (p.default is not None)


@pytest.mark.parametrize("name", MODELS)
def test_defaults_are_stress_free_and_stable(name):
    umat = create(name)
    identity = np.eye(3).reshape(3, 3, 1, 1)
    (stress,) = umat.gradient([identity, None])[:1]
    # the models of the principal stretches perturb equal stretches (tensortrax)
    np.testing.assert_allclose(stress, 0, atol=1e-7)

    # positive shear stiffness for a small shear
    gamma = 1e-6
    sheared = identity.copy()
    sheared[0, 1] = gamma
    (stress,) = umat.gradient([sheared, None])[:1]
    assert stress[0, 1, 0, 0] / gamma > 0


def test_mooney_rivlin_with_c01_zero_is_neo_hooke():
    rng = np.random.default_rng(1)
    F = (np.eye(3) + 0.2 * rng.standard_normal((3, 3))).reshape(3, 3, 1, 1)
    mooney = create("MooneyRivlin", C10=0.5, C01=0.0, bulk=50.0)
    neo = create("NeoHooke", mu=1.0, bulk=50.0)
    np.testing.assert_allclose(
        mooney.gradient([F, None])[0], neo.gradient([F, None])[0], atol=1e-12
    )
    np.testing.assert_allclose(
        mooney.hessian([F, None])[0], neo.hessian([F, None])[0], atol=1e-12
    )


@pytest.mark.parametrize(
    "model, parameters",
    [
        ("Yeoh", {"C10": 0.5, "C20": 0.0, "C30": 0.0}),
        (
            "ThirdOrderDeformation",
            {"C10": 0.5, "C01": 0.0, "C11": 0.0, "C20": 0.0, "C30": 0.0},
        ),
        ("Ogden", {"mu": [1.0], "alpha": [2.0]}),
    ],
)
def test_reduced_models_are_neo_hooke(model, parameters):
    # Yeoh and third-order deformation with C10 only, Ogden with one term and an
    # exponent of 2 (#136)
    rng = np.random.default_rng(1)
    F = (np.eye(3) + 0.2 * rng.standard_normal((3, 3))).reshape(3, 3, 1, 1)
    umat = create(model, **parameters, bulk=50.0)
    neo = create("NeoHooke", mu=1.0, bulk=50.0)
    np.testing.assert_allclose(
        umat.gradient([F, None])[0], neo.gradient([F, None])[0], atol=1e-10
    )


def test_ogden_needs_as_many_exponents_as_moduli():
    ogden = {"model": "Ogden", "parameters": {"mu": [1.0, 0.2], "alpha": [2.0]}}
    assert problems(ogden) == ["mu and alpha need the same number of values."]
    ogden["parameters"]["alpha"].append(-1.5)
    assert problems(ogden) == []
    assert material_call(ogden) == (
        "fem.Hyperelastic",
        ["fem.ogden", "mu=[1.0, 0.2]", "alpha=[2.0, -1.5]"],
        [],
    )


def test_needs_bulk():
    assert needs_bulk({"model": "NeoHooke", "parameters": {"mu": 1}})
    assert not needs_bulk({"model": "NeoHooke", "parameters": {"mu": 1, "bulk": 5}})
    assert needs_bulk({"model": "MooneyRivlin", "parameters": {"C10": 1, "C01": 0}})
    assert not needs_bulk({"model": "NeoHookeCompressible", "parameters": {}})


def test_volumetric_parameter_is_added():
    material = {
        "model": "MooneyRivlin",
        "parameters": {"C10": 0.4, "C01": 0.1, "bulk": 5000.0},
    }
    assert material_call(material) == (
        "fem.Hyperelastic",
        ["fem.mooney_rivlin", "C10=0.4", "C01=0.1"],
        ["bulk=5000.0"],
    )


def test_models_are_documented():
    text = DOCS.read_text(encoding="utf-8")
    for name, model in models().items():
        assert f"`{name}`" in text and model.label in text
