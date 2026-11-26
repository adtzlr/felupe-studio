"""Strain-based functions of Python files (#425, ADR 0025): the template, the generated
script, the rules, the state variables in the results, and the inspection of a
function before a job."""

import json
import shutil
from importlib.resources import files
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio import results, runner
from felupe_studio._helpers import material_function
from felupe_studio.codegen import codegen
from felupe_studio.commands import schema, schema_errors
from felupe_studio.materials import FUNCTIONS
from felupe_studio.rules import problems
from felupe_studio.scripts import DEFORMATION, inspect_material

GOLDEN = Path(__file__).parent / "golden"
TEMPLATE = files("felupe_studio").joinpath("templates/material_strain.py")

# the plasticity of FElupe as a file, of Young's modulus and Poisson's ratio, a
# function that returns other state variables, and one with an error
STEEL = """import felupe as fem
import numpy as np
from felupe.constitution import lame_converter


def material(dε, εn, σn, ζn, E, nu, σy, K, **kwargs):
    λ, μ = lame_converter(E, nu)
    return fem.linear_elastic_plastic_isotropic_hardening(
        dε, εn, σn, ζn, λ, μ, σy, K, **kwargs
    )


def damaged(dε, εn, σn, ζn, E, **kwargs):
    eye = fem.math.identity(dε)
    return E * fem.math.cdya_ik(eye, eye), σn + E * dε, [np.zeros((2, *dε.shape[2:]))]


def broken(dε, εn, σn, ζn, E, **kwargs):
    return E * undefined
"""

PLASTIC = {"E": 210000.0, "nu": 0.3, "σy": 250.0, "K": 1000.0}


def material(**values):
    return {
        "command": "material.script",
        "name": "steel",
        "kind": "strain",
        "file": "steel.py",
        **values,
    }


def at(umat):
    """The stress and the elasticity tensor of a strain-based material at a
    deformation, from a state without a strain and a stress."""
    x = [np.array(DEFORMATION)[..., None, None], np.zeros((*umat.x[-1].shape, 1, 1))]
    return umat.gradient(x)[0], umat.hessian(x)[0]


@pytest.fixture
def steel(tmp_path, monkeypatch):
    (tmp_path / "steel.py").write_text(STEEL, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    return tmp_path


@pytest.mark.parametrize(
    "framework, exponent",
    [("small-strain", None), ("total-lagrange", None), ("co-rotational", None)]
    + [("seth-hill", 0), ("seth-hill", -2)],
)
def test_the_template_is_linear_elastic(framework, exponent):
    # in every framework, like LinearElastic of the registry
    function = material_function(TEMPLATE, "material")
    options = {"framework": framework}
    if exponent is not None:
        options["strain_exponent"] = exponent
    λ, μ = fem.constitution.lame_converter(210000.0, 0.3)
    umat = fem.MaterialStrain(function, E=210000.0, nu=0.3, **options)
    registry = fem.MaterialStrain(fem.linear_elastic, λ=λ, μ=μ, **options)
    for a, b in zip(at(umat), at(registry), strict=True):
        np.testing.assert_allclose(a, b, rtol=1e-12, atol=1e-6)


def test_the_template_in_single_precision():
    # its tangent of the data type of dε, so a model in single precision stays in it
    umat = fem.MaterialStrain(material_function(TEMPLATE, "material"), E=1, nu=0.3)
    x = [np.eye(3, dtype=np.float32)[..., None, None], np.zeros((18, 1, 1), "f4")]
    assert umat.hessian(x)[0].dtype == np.float32


@pytest.mark.parametrize(
    ("model", "dtype"),
    [("LinearElasticPlasticIsotropicHardening", np.float32), ("LinearElastic", float)],
)
def test_the_models_of_the_registry_in_single_precision(
    model, dtype, tmp_path, monkeypatch
):
    # the plasticity cube with the model in single precision (#345): FElupe 12.1.2
    # returns the tangent of the elastic-plastic model in the precision of the strain
    # (adtzlr/felupe#1301), so its linear equation system is in float32 too. The
    # linear elastic model returns it in float64 (adtzlr/felupe#1308), and does not
    # reach a tight tolerance: if this changes, its notes in the guide (Model
    # settings, Limits) change too. The default tolerance of a job converges.
    for path in (GOLDEN / "plasticity_cube").iterdir():
        if path.suffix == ".vtu":
            shutil.copy(path, tmp_path)
    document = json.loads(
        (GOLDEN / "plasticity_cube" / "commands.json").read_text(encoding="utf-8")
    )
    for c in document["commands"]:
        if c["command"] == "model.settings":
            c["precision"] = "single"
        if c["command"] == "material.add":
            c["model"] = model
            if model == "LinearElastic":
                c["parameters"] = {"E": 210000, "nu": 0.3}
        if c["command"] == "job.add":
            del c["tol"]
    monkeypatch.chdir(tmp_path)
    runner.run(document)
    solid, field = runner.LAST["solid_body"], runner.LAST["field_body"]
    assert field[0].values.dtype == np.float32
    assert solid.assemble.matrix(field).dtype == dtype


def plasticity(folder):
    """The golden case of the elastic-plastic model of the registry, with the
    plasticity of FElupe as a file instead."""
    for path in (GOLDEN / "plasticity_cube").iterdir():
        if path.suffix == ".vtu":
            shutil.copy(path, folder)
    (folder / "steel.py").write_text(STEEL, encoding="utf-8")
    document = json.loads(
        (GOLDEN / "plasticity_cube" / "commands.json").read_text(encoding="utf-8")
    )
    commands = document["commands"]
    [i] = [i for i, c in enumerate(commands) if c["command"] == "material.add"]
    commands[i] = material(arguments=PLASTIC, statevars=[1, [3, 3]])
    return document


def test_the_plasticity_of_felupe_as_a_file(tmp_path, monkeypatch):
    # its state variables, the equivalent plastic strain and the plastic strain
    # tensor: the curve of the elastic-plastic model of the registry
    document = plasticity(tmp_path)
    monkeypatch.chdir(tmp_path)
    curve = runner.run(document)["job_1"]
    registry = json.loads(
        (GOLDEN / "plasticity_cube" / "results.json").read_text(encoding="utf-8")
    )["jobs"]["job_1"]
    np.testing.assert_allclose(np.array(curve["y"])[:, 0], registry["force"], 1e-10)
    # its state variables are recorded, for the stress of a restored substep; the
    # equivalent plastic strain is a quantity of the model of the registry only
    assert results._history("body") and not results._plastic("body")
    assert len(results._state["statevars"]["job_1"][-1]["body"]) == 10 + 18
    ranges = json.loads(results.ranges("job_1", "plastic_strain"))["range"]
    assert ranges[-1] == [0, 0]


def test_the_script_of_a_strain_based_function():
    commands = [
        {"command": "parameter.add", "name": "E", "value": 210000.0},
        material(
            arguments={"E": "E", "nu": 0.3, "σy": "E / 840", "K": 1000.0},
            statevars=[1, [3, 3]],
            framework="seth-hill",
            strain_exponent=0,
        ),
    ]
    script = codegen({"schema_version": 3, "commands": commands})
    assert (
        "steel = fem.MaterialStrain(\n"
        '    material_function("steel.py", "material"),\n'
        "    statevars=(1, (3, 3)),\n"
        '    framework="seth-hill",\n'
        "    strain_exponent=0,\n"
        "    E=E,\n"
        "    nu=0.3,\n"
        "    σy=(E / 840),\n"
        "    K=1000.0,\n"
        ")\n"
    ) in script
    # the helper of the functions only, without a volumetric part
    assert "def material_function(" in script
    assert "def run_material_script(" not in script
    assert "fem.Volumetric" not in script
    assert "framework=" in codegen(
        {"schema_version": 3, "commands": [material(arguments={"E": 1.0})]}
    )


def test_the_arguments_of_a_strain_based_function():
    rules = {
        "dε": "'dε' is not an argument of the function to give: fem.MaterialStrain "
        "gives dε, εn, σn, ζn and tangent, and takes material, dim, statevars, "
        "framework, symmetry and strain_exponent itself.",
        "tangent": "'tangent' is not an argument of the function to give",
        "framework": "'framework' is not an argument of the function to give",
        "lambda": "the argument 'lambda' is a keyword of Python.",
    }
    for key, message in rules.items():
        [problem] = problems([material(arguments={key: 1.0})])
        assert message in problem
    # Lamé's constants and the arguments of the Mullins effect of a strain energy
    # function are arguments of a strain-based function
    assert problems([material(arguments={"λ": 1.0, "μ": 2.0, "beta": 3.0})]) == []


def misfits(formulation):
    """The problems of the formulation of a section of a strain-based function."""
    section = {
        "command": "section.add",
        "name": "body",
        "cellset": "all",
        "material": "steel",
        "formulation": formulation,
    }
    return [p for p in problems([material(), section]) if "' uses " in p]


def test_a_strain_based_function_has_a_volumetric_part():
    # like the strain-based models of the registry (#191): the displacement
    # formulation, or the three-field variation (#420)
    assert misfits("u") == misfits("u-p-J-three-field") == []
    [problem] = misfits("u-p-J")
    assert problem.endswith(
        "uses the u-p-J formulation with the strain-based material 'steel' of "
        "'steel.py'. Use the displacement formulation 'u' or 'u-p-J-three-field'."
    )
    [problem] = misfits("u-isochoric")
    assert problem.endswith(
        "uses the formulation u-isochoric with the material 'steel' of 'steel.py', "
        "which has a volumetric part. Use 'u'."
    )


def test_the_inspection_of_a_strain_based_function(steel):
    shutil.copy(TEMPLATE, steel / "linear.py")
    template = material(file="linear.py", arguments={"E": 210000.0, "nu": 0.3})
    assert inspect_material("linear.py", {}, template) == {
        "file": "linear.py",
        "functions": {
            "material": {
                "arguments": [{"name": "E"}, {"name": "nu"}],
                "tangent": True,
            }
        },
        "type": "MaterialStrain(material)",
        "statevars": 0,
    }
    # the state variables of the function, not the strain and the stress of the
    # last state of fem.MaterialStrain
    plastic = material(arguments=PLASTIC, statevars=[1, [3, 3]])
    info = inspect_material("steel.py", {}, plastic)
    assert (info["type"], info["statevars"]) == ("MaterialStrain(material)", 10)
    assert info["functions"]["damaged"] == {
        "arguments": [{"name": "E"}],
        "tangent": True,
    }


def test_a_strain_based_function_that_does_not_fit_its_material(steel):
    def error(**values):
        info = inspect_material("steel.py", {}, material(**values))
        assert "functions" in info
        return info["error"]

    assert error(arguments={"E": 1.0, "c": 2.0}) == (
        "The function material needs a value of its arguments 'nu', 'σy' and 'K'. "
        "It has no argument 'c'."
    )
    # the state variables that a function returns, and those that it unpacks
    assert error(function="damaged", arguments={"E": 1.0}) == (
        "The function damaged returns a state variable of the shape (2,), not those "
        "of statevars (0,). Set statevars to (2,)."
    )
    assert error(arguments=PLASTIC) == (
        "ValueError: not enough values to unpack (expected 2, got 1). It gets the "
        "state variables ζn of the shapes of statevars (0,)."
    )
    # the keyword argument tangent, and the time increment of a step
    (steel / "steel.py").write_text(
        "def material(dε, εn, σn, ζn, dtime):\n    return None, σn, ζn\n"
    )
    assert error() == (
        "The function material takes no keyword argument tangent, which "
        "fem.MaterialStrain gives: end its arguments with **kwargs. It is "
        "time-dependent: a step gives no time increment yet, so give its argument "
        "dtime a value."
    )


def test_the_error_of_a_strain_based_function_with_its_traceback(steel):
    info = inspect_material(
        "steel.py", {}, material(function="broken", arguments={"E": 1.0})
    )
    assert info["error"] == "NameError: name 'undefined' is not defined"
    assert 'steel.py", line 19, in broken' in info["traceback"]
    assert "felupe" not in info["traceback"]


def test_the_schema_of_a_strain_based_function():
    # the shapes of the state variables, and the strain exponent of a Seth-Hill
    # strain only, like the strain-based models of the registry
    def valid(**values):
        return not schema_errors(
            {"schema_version": 3, "commands": [material(**values)]}
        )

    assert valid(statevars=[1, [3, 3]], framework="seth-hill", strain_exponent=0)
    assert valid(statevars=[[3, 3]], framework="co-rotational")
    assert not valid(statevars=[1, [3, 0]])
    assert not valid(statevars=[])
    assert not valid(framework="seth-hill")
    assert not valid(strain_exponent=0)
    assert not valid(bulk=5000)
    # the framework of the strain-based models of the registry
    defs = schema()["$defs"]
    strain, registry = (
        defs[d] for d in ("MaterialScriptStrain", "MaterialLinearElastic")
    )
    for key in ("if", "then", "else"):
        assert strain[key] == registry[key]
    for key in ("framework", "strain_exponent"):
        assert strain["properties"][key] == registry["properties"][key]


def test_the_functions_by_default_are_those_of_the_schema():
    # FUNCTIONS of felupe_studio.materials, like FUNCTIONS of the app
    defs = schema()["$defs"]
    kinds = [
        defs[ref["$ref"].split("/")[-1]] for ref in defs["MaterialScript"]["oneOf"]
    ]
    assert FUNCTIONS == {
        kind["properties"]["kind"]["const"]: kind["properties"]["function"]["default"]
        for kind in kinds
        if "function" in kind["properties"]
    }
