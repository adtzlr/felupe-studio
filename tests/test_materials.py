import functools
import inspect
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio.commands import schema_errors
from felupe_studio.materials import (
    has_volumetric,
    lame_call,
    material_call,
    models,
    needs_bulk,
    problems,
    strain_based,
)

DOCS = Path(__file__).parents[1] / "docs" / "commands.md"
MODELS = list(models())


def create(model, framework=None, strain_exponent=None, mullins=None, **changes):
    """The material of a model with its defaults (and a bulk modulus if optional),
    optionally with the Mullins effect (#346)."""
    parameters = {p.key: p.default for p in models()[model].parameters if p.default}
    if models()[model].optional_bulk:
        parameters["bulk"] = 5000.0
    parameters.update(changes)
    material = {"model": model, "parameters": parameters}
    if framework:
        material["framework"] = framework
    if strain_exponent is not None:
        material["strain_exponent"] = strain_exponent
    if mullins is not None:
        material["mullins"] = mullins
    func, args, volumetric = material_call(material)
    namespace = {"fem": fem, "functools": functools}
    lame = lame_call(material)
    if lame is not None:
        # the Lamé constants λ and μ of a strain-based material (#191)
        exec(f"λ, μ = fem.constitution.lame_converter({', '.join(lame)})", namespace)
    umat = eval(f"{func}({', '.join(args)})", namespace)
    if volumetric:
        umat = umat & eval(f"fem.Volumetric({', '.join(volumetric)})", {"fem": fem})
    return umat


def test_models():
    # in the order of the menus of the ribbon (#259)
    assert MODELS == [
        "LinearElasticSmallStrain",
        "LinearElasticLargeStrain",
        "NeoHooke",
        "NeoHookeCompressible",
        "MooneyRivlin",
        "Yeoh",
        "ThirdOrderDeformation",
        "Ogden",
        "ArrudaBoyce",
        "ExtendedTube",
        "LinearElastic",
        "LinearElasticPlasticIsotropicHardening",
    ]


@pytest.mark.parametrize("name", MODELS)
def test_parameters_of_felupe(name):
    model = models()[name]
    call = eval(model.call, {"fem": fem})
    keys = set(inspect.signature(call).parameters)
    for p in model.parameters:
        assert p.label and p.description
        key = p.argument or p.key
        assert p.volumetric or p.lame or key in keys, f"{name}: {key} not in {keys}"
        assert p.required == (p.default is not None)
    # the Young's modulus and the Poisson's ratio of a strain-based model are its
    # Lamé constants (#191)
    if model.strain:
        assert {"λ", "μ"} <= keys
        assert [p.key for p in model.parameters if p.lame] == ["E", "nu"]


def state(umat):
    """The state variables of a material at a point (none of most models)."""
    statevars = getattr(umat, "x", [None, None])[1]
    if statevars is None:
        return None
    return np.zeros((*np.shape(statevars), 1, 1))


@pytest.mark.parametrize("name", MODELS)
def test_defaults_are_stress_free_and_stable(name):
    umat = create(name)
    identity = np.eye(3).reshape(3, 3, 1, 1)
    (stress,) = umat.gradient([identity, state(umat)])[:1]
    # the models of the principal stretches perturb equal stretches (tensortrax)
    np.testing.assert_allclose(stress, 0, atol=1e-7)

    # positive shear stiffness for a small shear
    gamma = 1e-6
    sheared = identity.copy()
    sheared[0, 1] = gamma
    (stress,) = umat.gradient([sheared, state(umat)])[:1]
    assert stress[0, 1, 0, 0] / gamma > 0


FRAMEWORKS = [
    ("small-strain", None),
    ("total-lagrange", None),
    ("co-rotational", None),
    ("seth-hill", 0),
    ("seth-hill", -2),
]


@pytest.mark.parametrize(("framework", "exponent"), FRAMEWORKS)
def test_strain_based_materials(framework, exponent):
    # fem.MaterialStrain with the Lamé constants of E and ν, in a framework (#191),
    # of a Seth-Hill strain with its strain exponent (FElupe 12.1)
    parameters = {"E": 210000.0, "nu": 0.3, "sigma_y": 250.0, "K": 1000.0}
    material = {
        "model": "LinearElasticPlasticIsotropicHardening",
        "framework": framework,
        "parameters": parameters,
    }
    options = []
    if exponent is not None:
        material["strain_exponent"] = exponent
        options = [f"strain_exponent={exponent}"]
    assert strain_based(material) and not needs_bulk(material)
    assert lame_call(material) == ["E=210000.0", "nu=0.3"]
    assert material_call(material) == (
        "fem.MaterialStrain",
        [
            "fem.linear_elastic_plastic_isotropic_hardening",
            "statevars=(1, (3, 3))",
            f'framework="{framework}"',
            *options,
            "λ=λ",
            "μ=μ",
            "σy=250.0",
            "K=1000.0",
        ],
        [],
    )
    umat = create(material["model"], framework, exponent, **parameters)
    assert umat.framework == framework
    # (FElupe's exponents of the Total Lagrange and the co-rotational frameworks)
    implied = {"total-lagrange": 2, "co-rotational": 1}
    assert umat.strain_exponent == implied.get(framework, exponent)
    lmbda, mu = fem.constitution.lame_converter(E=210000.0, nu=0.3)
    assert umat.kwargs == {"λ": lmbda, "μ": mu, "σy": 250.0, "K": 1000.0}
    # a uniaxial strain beyond the yield stress: the equivalent plastic strain (the
    # first state variable) grows
    F = np.eye(3).reshape(3, 3, 1, 1).copy()
    F[0, 0] += 0.01
    _, statevars = umat.gradient([F, state(umat)])
    assert statevars[0, 0, 0] > 0
    # the linear elastic model has no state variables of its own
    linear = {"model": "LinearElastic", "parameters": {"E": 1.0, "nu": 0.0}}
    assert material_call(linear)[1] == [
        "fem.linear_elastic",
        'framework="small-strain"',
        "λ=λ",
        "μ=μ",
    ]
    assert not strain_based({"model": "NeoHooke", "parameters": {"mu": 1.0}})


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


def test_has_volumetric():
    # the materials that the u-p-J formulation does not take (#417)
    assert not has_volumetric({"model": "NeoHooke", "parameters": {"mu": 1}})
    assert has_volumetric({"model": "NeoHooke", "parameters": {"mu": 1, "bulk": 5}})
    mooney_rivlin = {"C10": 1, "C01": 0}
    assert not has_volumetric({"model": "MooneyRivlin", "parameters": mooney_rivlin})
    assert has_volumetric(
        {"model": "MooneyRivlin", "parameters": {**mooney_rivlin, "bulk": 5}}
    )
    compressible = {"mu": 1, "lmbda": 2}
    assert has_volumetric({"model": "NeoHookeCompressible", "parameters": compressible})
    assert has_volumetric({"model": "LinearElastic", "parameters": {"E": 1, "nu": 0}})


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


def test_strain_exponent_only_with_seth_hill():
    # required with the Seth-Hill framework and allowed only with it (FElupe 12.1)
    from felupe_studio.commands import errors

    def document(**material):
        return {
            "schema_version": 3,
            "commands": [
                {
                    "command": "material.add",
                    "name": "steel",
                    "model": "LinearElastic",
                    "parameters": {"E": 210000.0, "nu": 0.3},
                    **material,
                }
            ],
        }

    assert errors(document(framework="seth-hill", strain_exponent=0)) == []
    assert errors(document(framework="seth-hill"))
    assert errors(document(framework="co-rotational", strain_exponent=1))
    assert errors(document(strain_exponent=0))


# the models with the Mullins effect of Ogden and Roxburgh (#346): those with a strain
# energy function of their isochoric part, not the extended tube, whose parameter
# beta is also a parameter of fem.ogden_roxburgh
MULLINS = ["NeoHooke", "MooneyRivlin", "Yeoh", "ThirdOrderDeformation", "Ogden"]
MULLINS += ["ArrudaBoyce"]
SOFTENING = {"r": 3, "m": 0.2, "beta": 0.1}


def test_models_with_the_mullins_effect():
    assert [name for name in MODELS if models()[name].mullins] == MULLINS
    rubber = {"command": "material.add", "name": "rubber", "mullins": SOFTENING}
    for name in MODELS:
        parameters = {p.key: p.default for p in models()[name].parameters if p.default}
        material = {**rubber, "model": name, "parameters": parameters}
        document = {"schema_version": 3, "commands": [material]}
        assert bool(schema_errors(document)) == (name not in MULLINS), name


@pytest.mark.parametrize("name", MULLINS)
def test_mullins_effect_softens_the_released_material(name):
    # the first loading is that of the material without the Mullins effect, the
    # second one up to the same stretch is softer and the same as the release, and
    # the stretch beyond it is the first loading again (pseudo-elastic, Ogden and
    # Roxburgh); the bulk modulus is not softened (a fem.Volumetric after it)
    elastic = fem.ViewMaterialIncompressible(create(name))
    softened = fem.ViewMaterialIncompressible(create(name, mullins=SOFTENING))
    up = np.linspace(1, 1.5, 6)
    path = np.concatenate([up, up[::-1][1:], up[1:], np.linspace(1.5, 2, 6)[1:]])
    _, reference, _ = elastic.uniaxial(path)
    _, stress, _ = softened.uniaxial(path)
    first, release, second, beyond = (slice(0, 6), slice(5, 11), slice(10, 16), 16)
    np.testing.assert_allclose(stress[first], reference[first], rtol=1e-10)
    assert np.all(stress[second][1:-1] < reference[second][1:-1])
    np.testing.assert_allclose(stress[second], stress[release][::-1], rtol=1e-8)
    np.testing.assert_allclose(stress[beyond:], reference[beyond:], rtol=1e-6)
    if models()[name].optional_bulk:
        material = {"model": name, "parameters": {"bulk": 50.0}, "mullins": SOFTENING}
        assert material_call(material)[2] == ["bulk=50.0"]
