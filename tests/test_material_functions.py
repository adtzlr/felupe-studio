"""Strain energy functions of Python files (#424, ADR 0025): the helper of the script,
the generated script, the rules, and the inspection of a function before a job."""

import json
import shutil
from importlib.resources import files
from pathlib import Path

import felupe as fem
import numpy as np
import pytest

from felupe_studio import runner
from felupe_studio._helpers import material_function
from felupe_studio.codegen import codegen
from felupe_studio.rules import problems
from felupe_studio.scripts import DEFORMATION, inspect_material

GOLDEN = Path(__file__).parent / "golden" / "bar_material_function"
TEMPLATE = files("felupe_studio").joinpath("templates/material_hyperelastic.py")

EXTRA = """import tensortrax.math as tm


def strain_energy(C, mu, k=0.5):
    I1 = tm.linalg.det(C) ** (-1 / 3) * tm.trace(C)
    return mu / 2 * (I1 - 3) + k * (I1 - 3) ** 2


def aged(C, statevars, mu):
    I1 = tm.linalg.det(C) ** (-1 / 3) * tm.trace(C)
    return mu / 2 * (I1 - 3), statevars


def broken(C, mu):
    return mu * undefined
"""


def document():
    return json.loads((GOLDEN / "commands.json").read_text(encoding="utf-8"))


def material(**values):
    return {
        "command": "material.script",
        "name": "soft",
        "kind": "hyperelastic",
        "file": "soft.py",
        **values,
    }


def at(umat):
    """The stress and the elasticity tensor of a material at a deformation."""
    x = [np.array(DEFORMATION)[..., None, None], np.zeros((0, 1, 1))]
    return umat.gradient(x)[0], umat.hessian(x)[0]


@pytest.fixture
def extra(tmp_path, monkeypatch):
    (tmp_path / "soft.py").write_text(EXTRA, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_the_template_is_neo_hooke():
    function = material_function(TEMPLATE, "strain_energy")
    umat = fem.Hyperelastic(function, mu=2.0) & fem.Volumetric(bulk=40.0)
    for a, b in zip(at(umat), at(fem.NeoHooke(mu=2.0, bulk=40.0)), strict=True):
        np.testing.assert_allclose(a, b, rtol=1e-12, atol=1e-14)


def test_a_function_that_the_file_does_not_have(extra):
    message = "has no function 'neo'. Its functions: strain_energy, aged, broken."
    with pytest.raises(ValueError, match=message):
        material_function("soft.py", "neo")


def test_the_script_of_a_function_with_an_expression():
    commands = document()["commands"]
    [i] = [i for i, c in enumerate(commands) if c["command"] == "material.script"]
    commands[i] = {**commands[i], "arguments": {"mu": "mu", "k": "mu / 10"}}
    script = codegen({"schema_version": 3, "commands": commands})
    assert (
        "rubber = fem.Hyperelastic(\n"
        '    material_function("material_hyperelastic.py", "strain_energy"), '
        "mu=mu, k=(mu / 10)\n)\n"
    ) in script
    assert "rubber &= fem.Volumetric(bulk=bulk)\n" in script
    # the helper of the functions only, not that of constitutive models
    assert "def material_function(" in script
    assert "def run_material_script(" not in script
    assert "import functools" not in script


def test_the_script_of_a_function_with_the_mullins_effect():
    commands = document()["commands"]
    [i] = [i for i, c in enumerate(commands) if c["command"] == "material.script"]
    commands[i] = {**commands[i], "mullins": {"r": 3, "m": 1, "beta": 0.1}}
    script = codegen({"schema_version": 3, "commands": commands})
    assert script.count("import functools\n") == 1
    assert (
        "functools.partial(\n"
        "        fem.ogden_roxburgh,\n"
        '        material=material_function("material_hyperelastic.py", '
        '"strain_energy"),\n'
        "    ),\n"
    ) in script
    assert "    nstatevars=1,\n" in script


def test_the_mullins_effect_of_a_function_is_a_result(tmp_path, monkeypatch):
    # the largest strain energy density of the load history, like a model of the
    # registry (#346)
    document_ = document()
    commands = document_["commands"]
    [i] = [i for i, c in enumerate(commands) if c["command"] == "material.script"]
    commands[i] = {**commands[i], "mullins": {"r": 3, "m": 1, "beta": 0.1}}
    shutil.copy(GOLDEN / "material_hyperelastic.py", tmp_path)
    monkeypatch.chdir(tmp_path)
    runner.run(document_)
    from felupe_studio import results

    ranges = json.loads(results.ranges("job_1", "mullins_energy"))["range"]
    assert ranges[0] == [0, 0] and ranges[-1][1] > 0


def test_the_arguments_of_a_function(extra):
    rules = {
        "C": "'C' is not an argument of the function to give: fem.Hyperelastic gives",
        "nstatevars": "'nstatevars' is not an argument of the function to give",
        "lambda": "the argument 'lambda' is a keyword of Python.",
    }
    for key, message in rules.items():
        [problem] = problems([material(arguments={key: 1.0})])
        assert message in problem
    # the arguments of the Mullins effect
    softened = material(arguments={"beta": 1.0}, mullins={"r": 3, "m": 1, "beta": 0.1})
    [problem] = problems([softened])
    assert "the argument 'beta' is one of the Mullins effect" in problem
    [problem] = problems([{**softened, "arguments": {}, "nstatevars": 2}])
    assert "a function with state variables has no Mullins effect" in problem
    assert problems([material(arguments={"μ": 1.0, "k": 2.0})]) == []


def misfits(commands):
    """The problems of the formulations of the sections."""
    return [p for p in problems(commands) if "' uses " in p]


def test_a_function_is_isochoric_without_a_bulk_modulus():
    def section(formulation, **values):
        return [
            material(**values),
            {
                "command": "section.add",
                "name": "body",
                "cellset": "all",
                "material": "soft",
                "formulation": formulation,
            },
        ]

    [problem] = misfits(section("u"))
    assert problem.endswith(
        "uses the displacement formulation with the material 'soft' of 'soft.py' "
        "without a volumetric part. Use 'u-p-J' with the bulk modulus of the "
        "section, or add 'bulk' to the material."
    )
    [problem] = misfits(section("u-p-J", bulk=50))
    assert problem.endswith(
        "which has a volumetric part. Use the displacement formulation 'u' or "
        "'u-p-J-three-field', or remove 'bulk' from the material."
    )
    assert misfits(section("u", bulk=50)) == []


def test_the_inspection_of_a_function(extra):
    info = inspect_material("soft.py", {}, material(arguments={"mu": 1.0}, bulk=50))
    assert info == {
        "file": "soft.py",
        "functions": {
            "strain_energy": {
                "arguments": [{"name": "mu"}, {"name": "k", "default": 0.5}],
                "statevars": False,
            },
            "aged": {"arguments": [{"name": "mu"}], "statevars": True},
            "broken": {"arguments": [{"name": "mu"}], "statevars": False},
        },
        "type": "Hyperelastic(strain_energy) & Volumetric",
        "statevars": 0,
    }
    # with the Mullins effect, and with state variables of its own
    softened = material(arguments={"mu": 1.0}, mullins={"r": 3, "m": 1, "beta": 0.1})
    info = inspect_material("soft.py", {}, softened)
    assert info["type"] == "Hyperelastic(ogden_roxburgh(strain_energy))"
    assert info["statevars"] == 1
    aged = material(function="aged", arguments={"mu": 1.0}, nstatevars=2)
    info = inspect_material("soft.py", {}, aged)
    assert (info["type"], info["statevars"]) == ("Hyperelastic(aged)", 2)


def test_a_function_that_does_not_fit_its_material(extra):
    def error(**values):
        info = inspect_material("soft.py", {}, material(**values))
        assert "traceback" not in info and "functions" in info
        return info["error"]

    assert error(arguments={"k": 1.0, "c": 2.0}, nstatevars=1) == (
        "The function strain_energy of 'soft.py' needs a value of its argument 'mu'. "
        "It has no argument 'c'. It takes no state variables (its second argument "
        "is not statevars). Remove nstatevars."
    )
    assert error(function="aged", arguments={"mu": 1.0}) == (
        "The function aged of 'soft.py' takes state variables: set their number, "
        "nstatevars."
    )
    assert error(
        function="aged", arguments={"mu": 1.0}, mullins={"r": 3, "m": 1, "beta": 0.1}
    ) == (
        "The function aged of 'soft.py' takes state variables, which the Mullins "
        "effect does not pass to it. Remove the Mullins effect."
    )
    # a function that the file does not have
    assert error(function="neo") == (
        "ValueError: The script 'soft.py' has no function 'neo'. Its functions: "
        "strain_energy, aged, broken."
    )


def test_the_error_of_a_function_with_its_traceback(extra):
    info = inspect_material(
        "soft.py", {}, material(function="broken", arguments={"mu": 1})
    )
    assert info["error"] == "NameError: name 'undefined' is not defined"
    assert 'soft.py", line 15, in broken' in info["traceback"]
    assert "felupe" not in info["traceback"]
    # an error of the file: no functions
    (extra / "soft.py").write_text("import tensortrax.math as tm\n\n1 / 0\n")
    info = inspect_material("soft.py", {}, material())
    assert info["error"] == "ZeroDivisionError: division by zero"
    assert "functions" not in info


def test_functions_run_only_if_trusted(tmp_path):
    pytest.importorskip("mcp")
    from mcp.server.mcpserver.exceptions import ToolError

    from felupe_studio.mcp import Session

    folder = tmp_path / "bar"
    shutil.copytree(GOLDEN, folder)
    (folder / "commands.json").rename(folder / "bar.felupe.json")
    session = Session()
    session.open_project(folder / "bar.felupe.json")
    with pytest.raises(ToolError, match="runs Python code"):
        session.inspect_material("rubber")
    text = (folder / "material_hyperelastic.py").read_text(encoding="utf-8")
    session.write_file("material_hyperelastic.py", text)
    # the arguments with the parameters of the model, changed by the call
    session.update_command("rubber", {"arguments": {"mu": "mu", "k": "mu"}})
    info = session.inspect_material("rubber", {"mu": 2.0})
    assert info["error"] == (
        "The function strain_energy of 'material_hyperelastic.py' has no argument 'k'."
    )
    session.update_command("rubber", {"arguments": {"mu": "2 * mu"}})
    info = session.inspect_material("rubber", {"mu": -1.0})
    assert info["type"] == "Hyperelastic(strain_energy) & Volumetric"
    assert session.solve()["job_1"]["substeps"] == 6
